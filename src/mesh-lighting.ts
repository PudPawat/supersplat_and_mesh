import {
    ADDRESS_CLAMP_TO_EDGE,
    Color,
    Entity,
    EnvLighting,
    FILTER_LINEAR,
    PIXELFORMAT_RGBA8,
    TEXTUREPROJECTION_EQUIRECT,
    Texture
} from 'playcanvas';

import { Scene } from './scene';

const buildEnvTexture = (device: any): Texture | null => {
    const W = 512, H = 256;

    const tex = new Texture(device, {
        name: 'meshEnvSource',
        width: W, height: H,
        format: PIXELFORMAT_RGBA8,
        projection: TEXTUREPROJECTION_EQUIRECT,
        addressU: ADDRESS_CLAMP_TO_EDGE,
        addressV: ADDRESS_CLAMP_TO_EDGE,
        mipmaps: false,
        minFilter: FILTER_LINEAR,
        magFilter: FILTER_LINEAR
    });

    try {
        const pixels = tex.lock() as Uint8Array;
        for (let y = 0; y < H; y++) {
            const t = y / H;
            // warm sky above, dark ground below
            const r = t < 0.5 ? Math.round(220 - t * 80) : Math.round(80 - t * 60);
            const g = t < 0.5 ? Math.round(215 - t * 80) : Math.round(75 - t * 55);
            const b = t < 0.5 ? Math.round(240 - t * 80) : Math.round(85 - t * 60);
            for (let x = 0; x < W; x++) {
                const i = (y * W + x) * 4;
                pixels[i]     = Math.max(0, Math.min(255, r));
                pixels[i + 1] = Math.max(0, Math.min(255, g));
                pixels[i + 2] = Math.max(0, Math.min(255, b));
                pixels[i + 3] = 255;
            }
        }
        tex.unlock();
        return tex;
    } catch (e) {
        tex.destroy();
        return null;
    }
};

const setupMeshLighting = (scene: Scene) => {
    const app = scene.app;
    const device = app.graphicsDevice;
    const renderScene = app.scene;

    // brighter ambient so objects are never completely black
    renderScene.ambientLight = new Color(0.45, 0.48, 0.55);

    const addDirLight = (name: string, color: Color, intensity: number, euler: [number, number, number]) => {
        const e = new Entity(name);
        e.addComponent('light', {
            type: 'directional',
            color,
            intensity,
            castShadows: false,
            layers: [scene.meshLayer.id]
        });
        e.setEulerAngles(...euler);
        app.root.addChild(e);
        return e;
    };

    addDirLight('meshKeyLight',  new Color(1.0, 0.95, 0.85), 1.8,  [45, 45, 0]);
    addDirLight('meshFillLight', new Color(0.5,  0.6,  0.9),  0.6, [-25, -135, 0]);
    addDirLight('meshBackLight', new Color(0.7,  0.8,  1.0),  0.4, [20, 200, 0]);

    // build a fallback IBL env atlas from our gradient texture
    try {
        const envSource = buildEnvTexture(device);
        if (envSource) {
            const atlas = EnvLighting.generatePrefilteredAtlas([envSource]);
            envSource.destroy();
            if (atlas) {
                renderScene.envAtlas = atlas;
                console.log('[meshLighting] IBL env atlas ready');
            }
        }
    } catch (e) {
        console.warn('[meshLighting] EnvLighting setup failed:', e);
    }
};

export { setupMeshLighting };
