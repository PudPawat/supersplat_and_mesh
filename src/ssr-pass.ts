/**
 * SSRPass — manages the two resources needed for real-time screen-space reflections:
 *
 *   1. ssrSceneTexture  — a copy of the scene color buffer captured BEFORE mesh objects
 *      are drawn (so the glass ball sees the 3DGS scene, not itself).
 *
 *   2. Per-frame uniforms — viewProj matrix and screen size are pushed to the GPU scope
 *      each frame so the SSR material chunk always uses the current camera.
 *
 * Usage in Camera:
 *   Between splatPass and meshPass:
 *     ssrPass.captureSceneSnapshot(colorBuffer);   // blit → ssrSceneTexture
 *     ssrPass.updateUniforms(viewProjMatrix, w, h); // push per-frame uniforms
 */

import {
    ADDRESS_CLAMP_TO_EDGE,
    FILTER_LINEAR,
    FILTER_NEAREST,
    Mat4,
    PIXELFORMAT_RGBA8,
    RenderTarget,
    Texture
} from 'playcanvas';

import { Scene } from './scene';
import { ShaderQuad, SimpleRenderPass } from './utils/simple-render-pass';

// Minimal blit shader — copies one texture to the current render target
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
    uniform sampler2D uBlitSrc;
    varying vec2 vUv;
    void main() {
        gl_FragColor = vec4(texture2D(uBlitSrc, vUv).rgb, 1.0);
    }
`;

class SSRPass {
    scene: Scene;
    ssrSceneTexture: Texture;         // scene without mesh objects — used by SSR chunk
    private ssrSceneTarget: RenderTarget;
    private blitPass: SimpleRenderPass;
    private _viewProj = new Mat4();

    constructor(scene: Scene, width: number, height: number) {
        this.scene = scene;
        const device = scene.app.graphicsDevice;

        this.ssrSceneTexture = new Texture(device, {
            name:     'ssrScene',
            width,
            height,
            format:   PIXELFORMAT_RGBA8,
            mipmaps:  false,
            minFilter: FILTER_LINEAR,
            magFilter: FILTER_LINEAR,
            addressU: ADDRESS_CLAMP_TO_EDGE,
            addressV: ADDRESS_CLAMP_TO_EDGE,
        });

        this.ssrSceneTarget = new RenderTarget({
            colorBuffer: this.ssrSceneTexture,
            depth: false,
            autoResolve: false,
        });

        const quad = new ShaderQuad(device, BLIT_VERT, BLIT_FRAG, 'ssr-blit');
        this.blitPass = new SimpleRenderPass(device, quad, {
            vars: () => ({ uBlitSrc: srcForBlit })
        });

        // capture the source reference at blit time
        let srcForBlit: Texture | null = null;
        this._captureRef = (src: Texture) => { srcForBlit = src; };

        scene.app.graphicsDevice;   // ensure device exists
    }

    private _captureRef: (src: Texture) => void;

    /**
     * Blit the current scene color buffer into ssrSceneTexture.
     * Call this AFTER splatPass but BEFORE meshPass so the snapshot
     * contains the 3DGS scene without any mesh objects.
     */
    captureSceneSnapshot(colorBuffer: Texture) {
        const device = this.scene.app.graphicsDevice;
        this._captureRef(colorBuffer);

        device.setRenderTarget(this.ssrSceneTarget);
        device.updateBegin();
        this.blitPass.execute();
        device.updateEnd();
    }

    /**
     * Push per-frame SSR uniforms into the global GPU scope.
     * Must be called before meshPass renders so mesh materials
     * pick up the current camera transform.
     */
    updateUniforms(viewProj: Mat4, width: number, height: number) {
        const scope = this.scene.app.graphicsDevice.scope;
        scope.resolve('uSSRViewProj').setValue(viewProj.data);
        scope.resolve('uSSRScreenSize').setValue([width, height]);
    }

    destroy() {
        this.ssrSceneTexture.destroy();
        this.ssrSceneTarget.destroy();
    }
}

export { SSRPass };
