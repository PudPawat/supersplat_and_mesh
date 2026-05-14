import {
    BLEND_NORMAL,
    Asset,
    BoundingBox,
    Entity,
    Material,
    Quat,
    StandardMaterial,
    Texture,
    Vec3
} from 'playcanvas';

import { Element, ElementType } from './element';
import { captureSceneEnv } from './mesh-cubemap';
import { captureReflectionProbe } from './mesh-probe';
import { ssrChunk } from './shaders/ssr-shader';
import { Scene } from './scene';

export type MeshMaterialPreset = 'glass' | 'mirror' | 'metal' | 'plastic' | 'custom';

export interface MeshMaterialOptions {
    preset: MeshMaterialPreset;
    opacity: number;
    tintR: number;
    tintG: number;
    tintB: number;
    reflectivity: number;
    metalness: number;
    roughness: number;
}

const PRESETS: Record<MeshMaterialPreset, Partial<MeshMaterialOptions>> = {
    glass:   { opacity: 0.75, tintR: 0.88, tintG: 0.96, tintB: 1.00, reflectivity: 1.0,  metalness: 0.3, roughness: 0.0 },
    mirror:  { opacity: 1.0,  tintR: 0.95, tintG: 0.95, tintB: 0.95, reflectivity: 1.0,  metalness: 1.0, roughness: 0.0 },
    metal:   { opacity: 1.0,  tintR: 0.9,  tintG: 0.85, tintB: 0.75, reflectivity: 0.7,  metalness: 1.0, roughness: 0.2 },
    plastic: { opacity: 1.0,  tintR: 1.0,  tintG: 0.3,  tintB: 0.3,  reflectivity: 0.2,  metalness: 0.0, roughness: 0.4 },
    custom:  { opacity: 1.0,  tintR: 1.0,  tintG: 1.0,  tintB: 1.0,  reflectivity: 0.5,  metalness: 0.0, roughness: 0.2 }
};

const defaultOptions = (): MeshMaterialOptions => ({
    preset: 'mirror', ...(PRESETS['mirror'] as MeshMaterialOptions)
});

export type MeshSource =
    | { kind: 'primitive'; type: string }
    | { kind: 'container'; asset: Asset };

class MeshElement extends Element {
    source: MeshSource;
    pivot: Entity;
    _name: string;
    _visible = true;
    materialOptions: MeshMaterialOptions;
    private _material: StandardMaterial | null = null;
    private _envAtlas: Texture | null = null;

    constructor(source: MeshSource, name: string) {
        super(ElementType.model);
        this.source = source;
        this._name = name;
        this.materialOptions = defaultOptions();
    }

    get name() { return this._name; }
    set name(v: string) { this._name = v; }

    get visible() { return this._visible; }
    set visible(v: boolean) {
        this._visible = v;
        if (this.pivot) this.pivot.enabled = v;
    }

    add() {
        const scene = this.scene as Scene;

        this.pivot = new Entity(this._name);

        if (this.source.kind === 'primitive') {
            // use render component — same as sphere-shape.ts / box-shape.ts
            this.pivot.addComponent('render', {
                type: this.source.type
            });
            scene.contentRoot.addChild(this.pivot);

            // set layer AFTER adding to scene (matches supersplat pattern)
            this.pivot.render.layers = [scene.meshLayer.id];

            this._buildMaterial();
            this._applyToRender(this.pivot);

        } else {
            // GLB / GLTF container
            scene.contentRoot.addChild(this.pivot);
            const resource = (this.source.asset.resource as any);
            if (resource?.instantiateRenderEntity) {
                const child: Entity = resource.instantiateRenderEntity({ castShadows: false });
                this.pivot.addChild(child);
                this._buildMaterial();
                this._walkAndApply(this.pivot);
            }
        }
    }

    remove() {
        if (this.pivot) {
            this.pivot.destroy();
            this.pivot = null;
        }
        if (this._material) {
            this._material.destroy();
            this._material = null;
        }
        if (this._envAtlas) {
            this._envAtlas.destroy();
            this._envAtlas = null;
        }
    }

    /**
     * Capture a reflection probe from this object's world position.
     * Renders the 3DGS scene from 6 directions (off-screen) and builds an IBL atlas.
     * Falls back to the main-camera screen capture if the probe fails.
     */
    async captureReflection() {
        const scene = this.scene as Scene;
        if (!scene || !this.pivot) return;

        const worldPos = this.pivot.getPosition().clone();
        console.log('[MeshElement] starting reflection probe at', worldPos.toString(), 'for', this._name);

        let atlas = await captureReflectionProbe(scene, worldPos);

        if (!atlas) {
            console.warn('[MeshElement] probe failed, falling back to screen capture for', this._name);
            atlas = captureSceneEnv(scene);
        }

        if (atlas) {
            if (this._envAtlas) this._envAtlas.destroy();
            this._envAtlas = atlas;
            this._buildMaterial();
            this._walkAndApply(this.pivot);
            console.log('[MeshElement] reflection applied for', this._name);
        } else {
            console.warn('[MeshElement] all capture methods failed for', this._name);
        }
    }

    setMaterialOptions(opts: Partial<MeshMaterialOptions>) {
        if (opts.preset && opts.preset !== this.materialOptions.preset) {
            Object.assign(this.materialOptions, PRESETS[opts.preset]);
        }
        Object.assign(this.materialOptions, opts);
        if (this.pivot) {
            this._buildMaterial();
            this._walkAndApply(this.pivot);
        }
    }

    private _buildMaterial() {
        const o = this.materialOptions;

        // Recreate material when switching to/from SSR so chunks update
        const scene = this.scene as Scene;
        const ssrTexture = scene ? (scene as any).ssrPass?.ssrSceneTexture : null;
        const useSSR = !!ssrTexture;

        if (!this._material) {
            this._material = new StandardMaterial();
        }
        const mat = this._material;

        mat.diffuse.set(o.tintR, o.tintG, o.tintB);
        mat.opacity = o.opacity;
        mat.useMetalness = true;
        mat.metalness = o.metalness;
        mat.gloss = 1 - o.roughness;
        mat.reflectivity = o.reflectivity;
        mat.specular.set(1, 1, 1);
        mat.emissive.set(o.tintR * 0.04, o.tintG * 0.04, o.tintB * 0.04);

        if (useSSR) {
            // SSR: inject the screen-space reflection chunk
            (mat as any).chunks = { ...((mat as any).chunks ?? {}), reflectionEnvPS: ssrChunk };
            mat.setParameter('uSSRScene', ssrTexture);
        } else if (this._envAtlas) {
            // Probe fallback
            mat.envAtlas = this._envAtlas;
            mat.useSkybox = false;
        } else {
            mat.envAtlas = null;
            mat.useSkybox = true;
        }

        if (o.opacity < 1.0) {
            mat.blendType = BLEND_NORMAL;
            mat.depthWrite = false;
        } else {
            mat.blendType = 0;
            mat.depthWrite = true;
        }
        mat.update();
    }

    private _applyToRender(entity: Entity) {
        const r = (entity as any).render;
        if (r?.meshInstances) {
            for (const mi of r.meshInstances) {
                mi.material = this._material as unknown as Material;
            }
        }
    }

    private _walkAndApply(entity: Entity) {
        this._applyToRender(entity);
        for (let i = 0; i < entity.children.length; i++) {
            this._walkAndApply(entity.children[i] as Entity);
        }
    }

    get worldBound(): BoundingBox | null { return null; }

    move(position?: Vec3, rotation?: Quat, scale?: Vec3) {
        if (!this.pivot) return;
        if (position) this.pivot.setPosition(position);
        if (rotation) this.pivot.setRotation(rotation);
        if (scale)    this.pivot.setLocalScale(scale);
    }
}

export { MeshElement };
