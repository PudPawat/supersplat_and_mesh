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

export type MeshMaterialPreset = 'glass' | 'mirror' | 'metal' | 'plastic' | 'custom' | 'gold' | 'wave';

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
    glass:   { opacity: 0.75, tintR: 0.88, tintG: 0.96, tintB: 1.00, reflectivity: 1.0,  metalness: 0.3,  roughness: 0.0  },
    mirror:  { opacity: 1.0,  tintR: 0.95, tintG: 0.95, tintB: 0.95, reflectivity: 1.0,  metalness: 1.0,  roughness: 0.0  },
    metal:   { opacity: 1.0,  tintR: 0.9,  tintG: 0.85, tintB: 0.75, reflectivity: 0.7,  metalness: 1.0,  roughness: 0.2  },
    plastic: { opacity: 1.0,  tintR: 1.0,  tintG: 0.3,  tintB: 0.3,  reflectivity: 0.2,  metalness: 0.0,  roughness: 0.4  },
    custom:  { opacity: 1.0,  tintR: 1.0,  tintG: 1.0,  tintB: 1.0,  reflectivity: 0.5,  metalness: 0.0,  roughness: 0.2  },
    gold:    { opacity: 1.0,  tintR: 1.0,  tintG: 0.78, tintB: 0.18, reflectivity: 1.0,  metalness: 1.0,  roughness: 0.05 },
    wave:    { opacity: 0.22, tintR: 0.82, tintG: 0.96, tintB: 1.0,  reflectivity: 0.9,  metalness: 0.15, roughness: 0.0  },
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
            if (this.source.type === 'bullet') {
                scene.contentRoot.addChild(this.pivot);
                this._buildBulletGeometry(scene);
                this.setMaterialOptions({ preset: 'gold' });
            } else if (this.source.type === 'wave') {
                scene.contentRoot.addChild(this.pivot);
                this._buildWaveGeometry(scene);
                this.setMaterialOptions({ preset: 'wave' });
            } else {
                // use render component — same as sphere-shape.ts / box-shape.ts
                this.pivot.addComponent('render', {
                    type: this.source.type
                });
                scene.contentRoot.addChild(this.pivot);

                // set layer AFTER adding to scene (matches supersplat pattern)
                this.pivot.render.layers = [scene.meshLayer.id];

                this._buildMaterial();
                this._applyToRender(this.pivot);
            }
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

    private _addRenderChild(scene: Scene, name: string, type: string,
        px: number, py: number, pz: number,
        sx: number, sy: number, sz: number
    ): Entity {
        const e = new Entity(name);
        e.addComponent('render', { type });
        this.pivot.addChild(e);
        e.setLocalPosition(px, py, pz);
        e.setLocalScale(sx, sy, sz);
        e.render.layers = [scene.meshLayer.id];
        return e;
    }

    // ── bullet: elongated cylinder body + cone tip ───────────────────────────
    private _buildBulletGeometry(scene: Scene) {
        // Body (cylinder): radius 0.08, height 0.55
        this._addRenderChild(scene, 'bullet-body', 'cylinder',  0,  0,      0,  0.16, 0.55, 0.16);
        // Tip (cone): radius 0.08, height 0.22, sits on top of body
        this._addRenderChild(scene, 'bullet-tip',  'cone',      0,  0.385,  0,  0.16, 0.22, 0.16);
        // Flat base cap (sphere squashed):
        this._addRenderChild(scene, 'bullet-base', 'sphere',    0, -0.275,  0,  0.16, 0.05, 0.16);
    }

    // ── wave: concentric flat torus rings (Matrix bullet-time ripple) ────────
    private _buildWaveGeometry(scene: Scene) {
        // 6 rings at increasing radii, each very flat in Y
        const rings = [0.4, 0.65, 0.92, 1.22, 1.56, 1.94];
        rings.forEach((r, i) => {
            // thickness tapers off with radius for a natural ripple look
            const thickness = 0.06 - i * 0.006;
            const e = new Entity(`wave-ring-${i}`);
            e.addComponent('render', { type: 'torus' });
            this.pivot.addChild(e);
            // Scale X/Z for ring radius, Y flat, torus inner radius via scale trick
            e.setLocalScale(r, thickness, r);
            e.render.layers = [scene.meshLayer.id];
        });
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

    // ── transform accessors for the panel / gizmo ─────────────────────────

    getPosition(): Vec3 { return this.pivot?.getPosition().clone() ?? new Vec3(); }
    getRotationEuler(): Vec3 {
        const e = new Vec3();
        this.pivot?.getRotation().getEulerAngles(e);
        return e;
    }
    getScale(): Vec3 { return this.pivot?.getLocalScale().clone() ?? new Vec3(1, 1, 1); }

    setPosition(v: Vec3) { this.pivot?.setPosition(v); }
    setRotationEuler(e: Vec3) {
        this.pivot?.setEulerAngles(e.x, e.y, e.z);
    }
    setScale(v: Vec3) { this.pivot?.setLocalScale(v); }
}

export { MeshElement };
