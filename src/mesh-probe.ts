/**
 * Reflection probe: renders the real 3DGS scene from the object's world position.
 *
 * Root cause of why naive setPosition() fails:
 *   Camera.onUpdate() calls mainCamera.setLocalPosition() + setLocalEulerAngles() every frame.
 *   We override that by hooking 'prerender' (fires AFTER update, BEFORE the actual draw).
 *
 * Sequence per capture face:
 *   update → [controller sets camera] → prerender → [we override camera] → render → postrender → read
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

// 6 orthogonal cube-map faces: front/back/right/left/up/down
// Using the full set avoids black patches in reflections that look up or down.
const CAPTURE_EULERS: Array<[number, number, number]> = [
    [   0,   0, 0],   // front  (-Z)
    [   0, 180, 0],   // back   (+Z)
    [   0,  90, 0],   // right  (+X)
    [   0, 270, 0],   // left   (-X)
    [ -90,   0, 0],   // up     (+Y)
    [  90,   0, 0],   // down   (-Y)
];

/**
 * Capture the 3DGS scene from worldPos.
 * Uses the main camera pipeline (framePasses) — the only path that renders 3DGS correctly.
 * Screen is frozen during capture (finalPass disabled) so no flicker is visible.
 */

// Mutex: only one probe may run at a time.  Concurrent probes corrupt the
// camera position and leave finalPass permanently disabled.
let _probeRunning = false;

export const captureReflectionProbe = async (scene: Scene, worldPos: Vec3): Promise<Texture | null> => {
    if (_probeRunning) {
        console.warn('[reflProbe] already running — skipping concurrent request');
        return null;
    }

    const cam: any = scene.camera;
    const entity   = cam?.mainCamera;          // the camera Entity
    const colorTarget: RenderTarget = cam?.colorTarget;
    const finalPass = cam?.finalPass;

    if (!entity || !colorTarget || !finalPass) {
        console.warn('[reflProbe] camera not ready, aborting');
        return null;
    }

    const device = scene.app.graphicsDevice;

    _probeRunning = true;

    // Save camera/render-helper state so we can restore perfectly.
    // Reflection probes must capture only the real scene, not editor helpers.
    // Otherwise bright X/Y/Z transform gizmos or colored grid axes get baked into
    // the envAtlas and appear as red/green/blue streaks on glossy car paint.
    const savedPos = entity.getLocalPosition().clone();
    const savedRot = new Quat();
    savedRot.copy(entity.getLocalRotation());
    const savedFinalPassEnabled = finalPass.enabled;
    const savedRenderOverlays = scene.camera.renderOverlays;
    const savedGizmoLayerEnabled = scene.gizmoLayer.enabled;

    // Freeze screen output — user sees a still frame while we capture.
    // Hide debug overlays and gizmos only for the probe frames.
    finalPass.enabled = false;
    scene.camera.renderOverlays = false;
    scene.gizmoLayer.enabled = false;

    const equirects: Texture[] = [];

    try {
        for (const [pitch, yaw, roll] of CAPTURE_EULERS) {
            scene.forceRender = true;

            // Hook 'prerender' to override the camera controller RIGHT before the draw
            await new Promise<void>(resolve => {
                scene.app.once('prerender', () => {
                    entity.setLocalPosition(worldPos.x, worldPos.y, worldPos.z);
                    entity.setLocalEulerAngles(pitch, yaw, roll);
                    // Refit clipping planes for THIS face direction — the camera's
                    // normal update already ran with the user's view direction, so
                    // without this the probe faces looking away from the scene get
                    // wrong (too-tight) clip planes and capture a black frame.
                    scene.camera.fitClippingPlanes(entity.getLocalPosition(), entity.forward);
                    resolve();
                });
            });

            // Now wait for the frame to actually finish rendering at our position
            await new Promise<void>(resolve => {
                scene.app.once('postrender', resolve);
            });

            const srcTex = colorTarget.colorBuffer;
            if (!srcTex) continue;

            try {
                const eq = new Texture(device, {
                    name: 'probeEq',
                    width: 256, height: 128,
                    format: PIXELFORMAT_RGBA8,
                    projection: TEXTUREPROJECTION_EQUIRECT,
                    mipmaps: false,
                    minFilter: FILTER_LINEAR,
                    magFilter: FILTER_LINEAR,
                    addressU: ADDRESS_CLAMP_TO_EDGE,
                    addressV: ADDRESS_CLAMP_TO_EDGE,
                });
                reprojectTexture(srcTex, eq, { numSamples: 4 });
                equirects.push(eq);
                console.log(`[reflProbe] face ${pitch},${yaw} captured`);
            } catch (e) {
                console.warn('[reflProbe] reproject failed:', e);
            }
        }

        if (equirects.length === 0) {
            console.warn('[reflProbe] no faces captured — check console for errors');
            return null;
        }

        try {
            const atlas = EnvLighting.generatePrefilteredAtlas(equirects);
            equirects.forEach(t => t.destroy());
            console.log('[reflProbe] envAtlas ready:', atlas != null);
            return atlas ?? null;
        } catch (e) {
            equirects.forEach(t => t.destroy());
            console.error('[reflProbe] atlas failed:', e);
            return null;
        }
    } finally {
        // ALWAYS restore camera, helper visibility, and screen output, even if an error occurred
        entity.setLocalPosition(savedPos.x, savedPos.y, savedPos.z);
        entity.setLocalRotation(savedRot);
        scene.camera.renderOverlays = savedRenderOverlays;
        scene.gizmoLayer.enabled = savedGizmoLayerEnabled;
        finalPass.enabled = savedFinalPassEnabled;
        scene.forceRender = true;
        _probeRunning = false;
    }
};
