/**
 * Probe-based reflection capture: renders the 3DGS scene from the object's
 * world position into a proper 6-face cubemap, then converts to an envAtlas.
 *
 * WHY the old approach produced black patches
 * ───────────────────────────────────────────
 * The previous code called reprojectTexture(2D_perspective_framebuffer, equirect).
 * PlayCanvas treats a 2D source with projection=NONE as a flat UV-mapped image, so
 * the actual scene content (a ~60° perspective cone) ended up squished into the
 * center of the equirect while the rest remained black.
 * generatePrefilteredAtlas(equirects) then used only sources[0] (front face) for
 * ALL specular levels — giving a half-black mirror from most viewing angles.
 *
 * CORRECT approach
 * ────────────────
 * 1. Render 6 faces at exactly 90° FOV (proper cube-map coverage).
 * 2. GPU-blit each face (center-square crop) into one face of a cubemap Texture
 *    via a dedicated RenderTarget.
 * 3. reprojectTexture(cubemap, equirect) — PlayCanvas's sampleCube shader handles
 *    this correctly, giving a full-sphere equirectangular image.
 * 4. generatePrefilteredAtlas([equirect]) builds the IBL atlas from real data.
 */

import {
    ADDRESS_CLAMP_TO_EDGE,
    EnvLighting,
    FILTER_LINEAR,
    PIXELFORMAT_RGBA8,
    Quat,
    RenderTarget,
    Texture,
    TEXTUREPROJECTION_EQUIRECT,
    Vec3,
    reprojectTexture
} from 'playcanvas';

import { Scene } from './scene';
import { ShaderQuad, SimpleRenderPass } from './utils/simple-render-pass';

// ── Cube face order matches WebGL: +X=0, -X=1, +Y=2, -Y=3, +Z=4, -Z=5 ───────
// Euler angles [pitch, yaw, roll] that point the PlayCanvas camera at each face.
const CUBE_FACE_EULERS: Array<[number, number, number]> = [
    [  0,  90, 0],   // face 0: POSITIVE_X  (right  +X)
    [  0, 270, 0],   // face 1: NEGATIVE_X  (left   -X)
    [-90,   0, 0],   // face 2: POSITIVE_Y  (up     +Y)
    [ 90,   0, 0],   // face 3: NEGATIVE_Y  (down   -Y)
    [  0, 180, 0],   // face 4: POSITIVE_Z  (back   +Z)
    [  0,   0, 0],   // face 5: NEGATIVE_Z  (front  -Z)
];

const FACE_SIZE = 256;   // pixels per cube face

// ── Crop-blit shader ──────────────────────────────────────────────────────────
// Copies a rectangular UV region (uCrop) of the source into the full quad.
// Used to extract the square center crop of the perspective framebuffer.
const BLIT_VERT = /* glsl */`
    attribute vec2 vertex_position;
    varying vec2 vUv;
    void main() {
        vUv = vertex_position * 0.5 + 0.5;
        gl_Position = vec4(vertex_position, 0.0, 1.0);
    }
`;
const BLIT_FRAG = /* glsl */`
    precision highp float;
    uniform sampler2D uBlit;
    uniform vec4 uCrop;   // (x0, y0, cropW, cropH) in normalised UV space
    varying vec2 vUv;
    void main() {
        vec2 uv = uCrop.xy + vUv * uCrop.zw;
        gl_FragColor = texture2D(uBlit, uv);
    }
`;

// ── Mutex: one probe at a time ────────────────────────────────────────────────
let _probeRunning = false;

export const captureReflectionProbe = async (scene: Scene, worldPos: Vec3): Promise<Texture | null> => {
    if (_probeRunning) {
        console.warn('[reflProbe] already running — skipping concurrent request');
        return null;
    }

    const cam: any      = scene.camera;
    const entity        = cam?.mainCamera;
    const colorTarget: RenderTarget = cam?.colorTarget;
    const finalPass     = cam?.finalPass;

    if (!entity || !colorTarget || !finalPass) {
        console.warn('[reflProbe] camera not ready, aborting');
        return null;
    }

    const device = scene.app.graphicsDevice;

    _probeRunning = true;

    // Save camera state for full restoration
    const savedPos = entity.getLocalPosition().clone();
    const savedRot = new Quat();
    savedRot.copy(entity.getLocalRotation());
    const savedFov = entity.camera.fov;

    // Build the target cubemap (empty — faces will be filled by blit passes)
    const cubeMap = new Texture(device, {
        name: 'probeCube',
        cubemap: true,
        width:  FACE_SIZE,
        height: FACE_SIZE,
        format: PIXELFORMAT_RGBA8,
        mipmaps: false,
        minFilter: FILTER_LINEAR,
        magFilter: FILTER_LINEAR,
        addressU: ADDRESS_CLAMP_TO_EDGE,
        addressV: ADDRESS_CLAMP_TO_EDGE,
    });

    // Build the blit quad (shared across all 6 face passes)
    const blitQuad = new ShaderQuad(device, BLIT_VERT, BLIT_FRAG, 'probe-face-blit');
    let blitSrc:  Texture  | null = null;
    let blitCrop: number[] = [0, 0, 1, 1];
    const blitPass = new SimpleRenderPass(device, blitQuad, {
        vars: () => ({ uBlit: blitSrc, uCrop: blitCrop })
    });

    // Freeze the screen while capturing (user sees a still frame, no flicker)
    finalPass.enabled = false;

    try {
        for (let face = 0; face < 6; face++) {
            const [pitch, yaw, roll] = CUBE_FACE_EULERS[face];

            // ── Step 1: render the scene at the probe position / direction ────
            await new Promise<void>(resolve => {
                scene.app.once('prerender', () => {
                    entity.setLocalPosition(worldPos.x, worldPos.y, worldPos.z);
                    entity.setLocalEulerAngles(pitch, yaw, roll);
                    // 90° FOV: each face covers exactly a quarter-sphere
                    entity.camera.fov = 90;
                    // Refit clipping planes for this face direction
                    scene.camera.fitClippingPlanes(entity.getLocalPosition(), entity.forward);
                    resolve();
                });
            });

            await new Promise<void>(resolve => {
                scene.app.once('postrender', resolve);
            });

            // ── Step 2: GPU-blit the square center crop → this cube face ─────
            const srcTex = colorTarget.colorBuffer;
            if (!srcTex) continue;

            const W = srcTex.width;
            const H = srcTex.height;
            // At 90° vertical FOV on a W×H viewport the horizontal coverage is
            // 90° × (W/H).  The square H×H center crop captures exactly 90°×90°.
            const cropPx = Math.min(W, H);
            blitSrc  = srcTex;
            blitCrop = [
                (W - cropPx) / 2 / W,   // x0  (UV)
                (H - cropPx) / 2 / H,   // y0  (UV)
                cropPx / W,             // width  (UV)
                cropPx / H,             // height (UV)
            ];

            // A RenderTarget pointing at this specific cube face
            const faceRT = new RenderTarget({ colorBuffer: cubeMap, face, depth: false });
            device.setRenderTarget(faceRT);
            (device as any).updateBegin();
            blitPass.execute();
            (device as any).updateEnd();
            faceRT.destroy();

            console.log(`[reflProbe] face ${face} (${pitch}°,${yaw}°) captured`);
        }

        // ── Step 3: cubemap → equirectangular ────────────────────────────────
        // reprojectTexture with a cubemap source uses sampleCube — this correctly
        // reads all 6 faces and produces a full-sphere equirect image.
        const equirect = new Texture(device, {
            name: 'probeEquirect',
            width: 512, height: 256,
            format: PIXELFORMAT_RGBA8,
            projection: TEXTUREPROJECTION_EQUIRECT,
            mipmaps: false,
            minFilter: FILTER_LINEAR,
            magFilter: FILTER_LINEAR,
            addressU: ADDRESS_CLAMP_TO_EDGE,
            addressV: ADDRESS_CLAMP_TO_EDGE,
        });
        reprojectTexture(cubeMap, equirect, { numSamples: 4 });

        // ── Step 4: prefiltered IBL atlas ─────────────────────────────────────
        const atlas = EnvLighting.generatePrefilteredAtlas([equirect]);
        equirect.destroy();
        cubeMap.destroy();

        console.log('[reflProbe] atlas ready:', atlas != null);
        return atlas ?? null;

    } catch (e) {
        console.error('[reflProbe] failed:', e);
        try { cubeMap.destroy(); } catch (_) {}
        return null;
    } finally {
        // ALWAYS restore — even if an error occurred
        entity.setLocalPosition(savedPos.x, savedPos.y, savedPos.z);
        entity.setLocalRotation(savedRot);
        entity.camera.fov = savedFov;
        finalPass.enabled = true;
        blitQuad.destroy();
        _probeRunning = false;
    }
};
