/**
 * Scene-reflection environment for mesh objects.
 *
 * Instead of rendering 6 separate cubemap faces (which requires a working
 * probe camera), we grab the already-rendered scene frame from SuperSplat's
 * colorTarget and reproject it into an envAtlas using PlayCanvas's own
 * reprojectTexture utility. The result is an approximate but real scene
 * reflection that updates on demand.
 */

import {
    ADDRESS_CLAMP_TO_EDGE,
    EnvLighting,
    FILTER_LINEAR,
    PIXELFORMAT_RGBA8,
    Texture,
    TEXTUREPROJECTION_EQUIRECT,
    reprojectTexture
} from 'playcanvas';

import { Scene } from './scene';

let lastAtlas: Texture | null = null;

/**
 * Capture current rendered scene frame and build a pre-filtered envAtlas.
 * Returns the atlas, or null if the render target isn't ready.
 */
const captureSceneEnv = (scene: Scene): Texture | null => {
    const cam: any = scene.camera;

    // grab the scene's own rendered color buffer (RGBA16F, screen-space)
    const srcTex: Texture | null =
        cam?.colorTarget?.colorBuffer ??
        cam?.mainTarget?.colorBuffer ??
        null;

    if (!srcTex) {
        console.warn('[envCapture] no render target available yet');
        return null;
    }

    const device = scene.app.graphicsDevice;

    try {
        // reproject the screen texture into an equirectangular format
        // so EnvLighting can prefilter it for IBL
        const equirect = new Texture(device, {
            name: 'sceneEquirect',
            width: 512, height: 256,
            format: PIXELFORMAT_RGBA8,
            projection: TEXTUREPROJECTION_EQUIRECT,
            addressU: ADDRESS_CLAMP_TO_EDGE,
            addressV: ADDRESS_CLAMP_TO_EDGE,
            mipmaps: false,
            minFilter: FILTER_LINEAR,
            magFilter: FILTER_LINEAR,
        });

        // blit/reproject the scene color into the equirect texture
        reprojectTexture(srcTex, equirect, { numSamples: 8 });

        // build specular pre-filtered atlas from the equirect
        const atlas = EnvLighting.generatePrefilteredAtlas([equirect]);
        equirect.destroy();

        if (lastAtlas) lastAtlas.destroy();
        lastAtlas = atlas;

        return atlas ?? null;

    } catch (e) {
        console.error('[envCapture] failed:', e);
        return null;
    }
};

export { captureSceneEnv };
