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
//
// ORIENTATION NOTES:
//   In PlayCanvas (default camera looks along -Z, Y-up):
//     pitch = +90 → camera looks UP   (+Y), camera-up = +Z
//     pitch = -90 → camera looks DOWN (-Y), camera-up = -Z
//
//   WebGL cubemap t-axis conventions:
//     +Y face: t increases toward -Z  (camera-up = +Z → face is V-flipped)
//     -Y face: t increases toward +Z  (camera-up = -Z → face is V-flipped)
//   Both up/down faces need a V-flip so reprojectTexture samples correctly.
//   The flipV column drives the uFlipV uniform in the blit shader.
const CUBE_FACE_DATA: Array<{ euler: [number, number, number]; flipV: boolean }> = [
    { euler: [  0,  90, 0], flipV: false },  // face 0: POSITIVE_X  (right +X)
    { euler: [  0, 270, 0], flipV: false },  // face 1: NEGATIVE_X  (left  -X)
    { euler: [ 90,   0, 0], flipV: true  },  // face 2: POSITIVE_Y  (up    +Y) ← pitch=+90 looks UP; V-flip for correct t-axis
    { euler: [-90,   0, 0], flipV: true  },  // face 3: NEGATIVE_Y  (down  -Y) ← pitch=-90 looks DOWN; V-flip for correct t-axis
    { euler: [  0, 180, 0], flipV: false },  // face 4: POSITIVE_Z  (back  +Z)
    { euler: [  0,   0, 0], flipV: false },  // face 5: NEGATIVE_Z  (front -Z)
];

/** Capture geometry for the reflection probe. */
export type ProbeShape = 'cube' | 'sphere';

// Quality settings per probe shape:
//   cube   – 6 axis-aligned faces, 256 px, fast.
//   sphere – same 6 faces but higher resolution + more reprojection samples;
//            produces a smoother, higher-fidelity IBL atlas suited for curved
//            surfaces (spheres, capsules) where cube seams are more visible.
const PROBE_QUALITY: Record<ProbeShape, {
    faceSize:   number;
    numSamples: number;
    equirectW:  number;
    equirectH:  number;
}> = {
    cube:   { faceSize: 256, numSamples:  4, equirectW:  512, equirectH: 256 },
    sphere: { faceSize: 512, numSamples: 16, equirectW: 1024, equirectH: 512 },
};

// ── Crop-blit shader ──────────────────────────────────────────────────────────
// Copies a rectangular UV region (uCrop) of the source into the full quad.
// uFlipV = 1 flips the V coordinate — required for +Y/-Y faces to match
// WebGL's cubemap t-axis convention.
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
    uniform vec4  uCrop;   // (x0, y0, cropW, cropH) in normalised UV space
    uniform float uFlipV;  // 1.0 = flip V axis, 0.0 = no flip
    varying vec2 vUv;
    void main() {
        vec2 st = vUv;
        if (uFlipV > 0.5) st.y = 1.0 - st.y;
        vec2 uv = uCrop.xy + st * uCrop.zw;
        gl_FragColor = texture2D(uBlit, uv);
    }
`;

// ── Mutex: one probe at a time ────────────────────────────────────────────────
let _probeRunning = false;

export const captureReflectionProbe = async (
    scene: Scene,
    worldPos: Vec3,
    shape: ProbeShape = 'cube'
): Promise<Texture | null> => {
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
    const savedPos      = entity.getLocalPosition().clone();
    const savedRot      = new Quat();
    savedRot.copy(entity.getLocalRotation());
    const savedFov      = entity.camera.fov;
    const savedNear     = entity.camera.nearClip;
    const savedFar      = entity.camera.farClip;

    const { faceSize, numSamples, equirectW, equirectH } = PROBE_QUALITY[shape];
    console.log(`[reflProbe] shape=${shape} faceSize=${faceSize} numSamples=${numSamples}`);

    // Build the target cubemap (empty — faces will be filled by blit passes)
    const cubeMap = new Texture(device, {
        name: 'probeCube',
        cubemap: true,
        width:  faceSize,
        height: faceSize,
        format: PIXELFORMAT_RGBA8,
        mipmaps: false,
        minFilter: FILTER_LINEAR,
        magFilter: FILTER_LINEAR,
        addressU: ADDRESS_CLAMP_TO_EDGE,
        addressV: ADDRESS_CLAMP_TO_EDGE,
    });

    // Build the blit quad (shared across all 6 face passes)
    const blitQuad = new ShaderQuad(device, BLIT_VERT, BLIT_FRAG, 'probe-face-blit');
    let blitSrc:   Texture  | null = null;
    let blitCrop:  number[] = [0, 0, 1, 1];
    let blitFlipV: number   = 0;
    const blitPass = new SimpleRenderPass(device, blitQuad, {
        vars: () => ({ uBlit: blitSrc, uCrop: blitCrop, uFlipV: blitFlipV })
    });

    // Freeze the screen while capturing (user sees a still frame, no flicker)
    finalPass.enabled = false;

    try {
        for (let face = 0; face < 6; face++) {
            const { euler: [pitch, yaw, roll], flipV } = CUBE_FACE_DATA[face];

            // ── Steps 1 + 2: set camera in prerender, blit in the SAME frame's postrender ──
            //
            // TIMING NOTE: two separate awaits (prerender then postrender) look correct
            // but are NOT — prerender/render/postrender all fire synchronously inside one
            // rAF callback.  By the time the first await resolves (via a microtask), the
            // postrender for that frame has already fired and we end up capturing frame N+1,
            // where the orbit controller has reset the camera back to the user's view.
            // Fix: register the postrender listener INSIDE the prerender handler so both
            // belong to the same rAF callback and the blit sees the correct render.
            await new Promise<void>((resolve, reject) => {
                scene.app.once('prerender', () => {
                    entity.setLocalPosition(worldPos.x, worldPos.y, worldPos.z);
                    entity.setLocalEulerAngles(pitch, yaw, roll);
                    // 90° FOV: each face covers exactly a quarter-sphere
                    entity.camera.fov = 90;
                    // Fixed near/far for probe capture.
                    // fitClippingPlanes() is tuned for the user's orbit view, not for a
                    // camera sitting at the object centre looking outward — it can produce
                    // a near clip that's too large for close-in geometry (table surface,
                    // floor, walls) and causes those regions to render black in the atlas.
                    entity.camera.nearClip = 0.001;
                    entity.camera.farClip  = 10000;

                    // Register postrender SYNCHRONOUSLY here — guaranteed same frame
                    scene.app.once('postrender', () => {
                        try {
                            const srcTex = colorTarget.colorBuffer;
                            if (!srcTex) { resolve(); return; }

                            const W = srcTex.width;
                            const H = srcTex.height;
                            // Square centre crop captures exactly 90°×90° at 90° vertical FOV
                            const cropPx = Math.min(W, H);
                            blitSrc   = srcTex;
                            blitCrop  = [
                                (W - cropPx) / 2 / W,   // x0  (UV)
                                (H - cropPx) / 2 / H,   // y0  (UV)
                                cropPx / W,             // width  (UV)
                                cropPx / H,             // height (UV)
                            ];
                            blitFlipV = flipV ? 1.0 : 0.0;

                            // GPU-blit into this cube face
                            const faceRT = new RenderTarget({ colorBuffer: cubeMap, face, depth: false });
                            device.setRenderTarget(faceRT);
                            (device as any).updateBegin();
                            blitPass.execute();
                            (device as any).updateEnd();
                            faceRT.destroy();

                            console.log(`[reflProbe] face ${face} (${pitch}°,${yaw}°) captured`);
                        } catch (err) { reject(err); return; }
                        resolve();
                    });
                });
            });
        }

        // ── Step 3: cubemap → equirectangular ────────────────────────────────
        // reprojectTexture with a cubemap source uses sampleCube — this correctly
        // reads all 6 faces and produces a full-sphere equirect image.
        const equirect = new Texture(device, {
            name: 'probeEquirect',
            width: equirectW, height: equirectH,
            format: PIXELFORMAT_RGBA8,
            projection: TEXTUREPROJECTION_EQUIRECT,
            mipmaps: false,
            minFilter: FILTER_LINEAR,
            magFilter: FILTER_LINEAR,
            addressU: ADDRESS_CLAMP_TO_EDGE,
            addressV: ADDRESS_CLAMP_TO_EDGE,
        });
        reprojectTexture(cubeMap, equirect, { numSamples });

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
        entity.camera.fov      = savedFov;
        entity.camera.nearClip = savedNear;
        entity.camera.farClip  = savedFar;
        // Re-fit clipping planes for the restored view direction
        scene.camera.fitClippingPlanes(entity.getLocalPosition(), entity.forward);
        finalPass.enabled = true;
        blitQuad.destroy();
        _probeRunning = false;
    }
};
