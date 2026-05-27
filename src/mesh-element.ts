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
import { captureReflectionProbe, isProbeRunning } from './mesh-probe';
import { ssrChunk } from './shaders/ssr-shader';
import { Scene } from './scene';

// 'original' = keep the GLB's own materials untouched
export type MeshMaterialPreset = 'original' | 'glass' | 'mirror' | 'metal' | 'plastic' | 'custom' | 'gold' | 'wave';

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
    original: { opacity: 0.99, tintR: 1.0,  tintG: 1.0,  tintB: 1.0,  reflectivity: 0.0,  metalness: 0.0,  roughness: 1.0  },
    glass:    { opacity: 0.75, tintR: 0.88, tintG: 0.96, tintB: 1.00, reflectivity: 1.0,  metalness: 0.3,  roughness: 0.0  },
    mirror:   { opacity: 0.99, tintR: 0.95, tintG: 0.95, tintB: 0.95, reflectivity: 1.0,  metalness: 1.0,  roughness: 0.0  },
    metal:    { opacity: 0.99, tintR: 0.9,  tintG: 0.85, tintB: 0.75, reflectivity: 0.7,  metalness: 1.0,  roughness: 0.2  },
    plastic:  { opacity: 0.99, tintR: 1.0,  tintG: 0.3,  tintB: 0.3,  reflectivity: 0.2,  metalness: 0.0,  roughness: 0.4  },
    custom:   { opacity: 0.99, tintR: 1.0,  tintG: 1.0,  tintB: 1.0,  reflectivity: 0.5,  metalness: 0.0,  roughness: 0.2  },
    gold:     { opacity: 0.99, tintR: 1.0,  tintG: 0.78, tintB: 0.18, reflectivity: 1.0,  metalness: 1.0,  roughness: 0.05 },
    wave:     { opacity: 0.22, tintR: 0.82, tintG: 0.96, tintB: 1.0,  reflectivity: 0.9,  metalness: 0.15, roughness: 0.0  },
};

const defaultOptions = (): MeshMaterialOptions => ({
    preset: 'mirror', ...(PRESETS['mirror'] as MeshMaterialOptions)
});

export type MeshSource =
    | { kind: 'primitive'; type: string }
    | { kind: 'container'; asset: Asset };

/** Global reflection mode — shared by all MeshElements in the scene. */
export type ReflectionMode = 'ssr' | 'probe';
let _globalReflectionMode: ReflectionMode = 'ssr';

/** Call this to switch all existing + future mesh materials between SSR and probe. */
export const setGlobalReflectionMode = (mode: ReflectionMode) => {
    _globalReflectionMode = mode;
};

export const getGlobalReflectionMode = (): ReflectionMode => _globalReflectionMode;

/** Global probe shape — shared by all MeshElements in the scene. */
export type { ProbeShape } from './mesh-probe';
import { ProbeShape } from './mesh-probe';
let _globalProbeShape: ProbeShape = 'cube';

export const setGlobalProbeShape = (shape: ProbeShape) => { _globalProbeShape = shape; };
export const getGlobalProbeShape = (): ProbeShape => _globalProbeShape;

class MeshElement extends Element {
    source: MeshSource;
    pivot: Entity;
    _name: string;
    _visible = true;
    materialOptions: MeshMaterialOptions;
    /** True while the GLB's own materials should be shown (preset === 'original') */
    private _useOriginalMaterials = false;
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
            // GLB / GLTF container — preserve ALL original materials, textures, PBR props.
            // Only reassign the render layer so the car draws on top of splats.
            this._useOriginalMaterials = true;
            this.materialOptions.preset = 'original';

            scene.contentRoot.addChild(this.pivot);
            const resource = (this.source.asset.resource as any);
            if (resource?.instantiateRenderEntity) {
                const child: Entity = resource.instantiateRenderEntity({ castShadows: false });
                this.pivot.addChild(child);
                // Set layer only — do NOT touch materials
                this._walkSetLayer(this.pivot, scene);
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

        // If another probe is already running, wait for it to finish then retry.
        // DO NOT fall back to captureSceneEnv here — it would capture a black screen
        // because finalPass is disabled while the other probe is running.
        if (isProbeRunning()) {
            console.log('[MeshElement] probe busy, retrying in 3 s for', this._name);
            setTimeout(() => this.captureReflection(), 3000);
            return;
        }

        const worldPos = this.pivot.getPosition().clone();
        console.log('[MeshElement] starting reflection probe at', worldPos.toString(), 'for', this._name);

        const atlas = await captureReflectionProbe(scene, worldPos, _globalProbeShape);

        if (atlas) {
            if (this._envAtlas) this._envAtlas.destroy();
            this._envAtlas = atlas;
            if (this._useOriginalMaterials) {
                // GLB import: keep all original PBR properties, just swap the env source
                // so the car/object reflects the 3DGS scene instead of the default skybox.
                this._walkAndApplyEnv(this.pivot, atlas);
            } else {
                this._buildMaterial();
                this._walkAndApply(this.pivot);
            }
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

        // Switching away from 'original' → user explicitly wants a custom material
        if (opts.preset && opts.preset !== 'original') {
            this._useOriginalMaterials = false;
        }
        // Switching back to 'original' → restore GLB materials
        if (opts.preset === 'original') {
            this._useOriginalMaterials = true;
        }

        if (this.pivot && !this._useOriginalMaterials) {
            this._buildMaterial();
            this._walkAndApply(this.pivot);
        }
    }

    private _buildMaterial() {
        const o = this.materialOptions;

        // Recreate material when switching to/from SSR so chunks update
        const scene = this.scene as Scene;
        const ssrTexture = scene ? (scene as any).ssrPass?.ssrSceneTexture : null;
        // Use SSR only when: mode is 'ssr' AND the SSR pass is actually running
        const useSSR = _globalReflectionMode === 'ssr' && !!ssrTexture;

        // Recreate material when the mode or SSR availability changes
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
            // SSR mode: screen-space reflections via custom shader chunk.
            // Do NOT touch envAtlas here — PlayCanvas won't generate reflection
            // code at all if there is no env source, which would make the SSR
            // chunk replacement a no-op and the object go black.
            (mat as any).chunks = { reflectionEnvPS: ssrChunk };
            mat.setParameter('uSSRScene', ssrTexture);
        } else if (this._envAtlas) {
            // Probe mode: pre-captured IBL atlas from object's world position
            (mat as any).chunks = {};
            mat.envAtlas = this._envAtlas;
            mat.useSkybox = false;
        } else {
            (mat as any).chunks = {};
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
        // Follow SuperSplat pattern: add to hierarchy first, THEN add component, THEN set layers
        const e = new Entity(name);
        e.setLocalPosition(px, py, pz);
        e.setLocalScale(sx, sy, sz);
        this.pivot.addChild(e);           // must be in scene graph first
        e.addComponent('render', { type });
        e.render.layers = [scene.meshLayer.id];
        return e;
    }

    // ── bullet: elongated cylinder body + cone tip ───────────────────────────
    private _buildBulletGeometry(scene: Scene) {
        console.log('[MeshElement] building bullet geometry');
        // Body (cylinder): total height ~1 unit, radius 0.12
        this._addRenderChild(scene, 'bullet-body', 'cylinder',  0,  0,       0,  0.24, 0.7,  0.24);
        // Pointed tip (cone) sits on top of body
        this._addRenderChild(scene, 'bullet-tip',  'cone',      0,  0.5,     0,  0.24, 0.3,  0.24);
        // Slightly rounded flat base
        this._addRenderChild(scene, 'bullet-base', 'sphere',    0, -0.35,    0,  0.24, 0.08, 0.24);
    }

    // ── wave: concentric flat torus rings (Matrix bullet-time ripple) ────────
    private _buildWaveGeometry(scene: Scene) {
        console.log('[MeshElement] building wave geometry');
        // 6 rings at increasing radii, each very flat in Y
        const rings = [0.4, 0.65, 0.92, 1.22, 1.56, 1.94];
        rings.forEach((r, i) => {
            // thickness tapers off with radius for a natural ripple look
            const thickness = 0.06 - i * 0.006;
            const e = new Entity(`wave-ring-${i}`);
            e.setLocalScale(r, thickness, r);
            this.pivot.addChild(e);
            e.addComponent('render', { type: 'torus' });
            e.render.layers = [scene.meshLayer.id];
        });
    }

    /**
     * Walk the hierarchy and apply an envAtlas (or clear it) on every existing
     * material — used for GLB imports where we want to keep the original PBR
     * properties but still show the probe-captured reflection.
     * atlas = null → restore skybox reflections (e.g. when switching to SSR).
     */
    private _walkAndApplyEnv(entity: Entity, atlas: Texture | null) {
        const r = (entity as any).render;
        if (r?.meshInstances) {
            for (const mi of r.meshInstances) {
                const mat = mi.material as StandardMaterial | null;
                if (!mat) continue;
                if (atlas) {
                    (mat as any).chunks = {};   // clear any stale SSR chunks
                    mat.envAtlas   = atlas;
                    mat.useSkybox  = false;
                } else {
                    (mat as any).chunks = {};
                    mat.envAtlas   = null;
                    mat.useSkybox  = true;
                }
                mat.update();
            }
        }
        for (let i = 0; i < entity.children.length; i++) {
            this._walkAndApplyEnv(entity.children[i] as Entity, atlas);
        }
    }

    /** Reassign layer only — does NOT touch materials. Used for GLB containers. */
    private _walkSetLayer(entity: Entity, scene: Scene) {
        const r = (entity as any).render;
        if (r && scene?.meshLayer) {
            r.layers = [scene.meshLayer.id];
        }
        for (let i = 0; i < entity.children.length; i++) {
            this._walkSetLayer(entity.children[i] as Entity, scene);
        }
    }

    /** Apply our custom material to a single render component. */
    private _applyToRender(entity: Entity) {
        const r = (entity as any).render;
        if (!r?.meshInstances) return;
        for (const mi of r.meshInstances) {
            mi.material = this._material as unknown as Material;
        }
    }

    /** Walk hierarchy and apply our custom material everywhere. */
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
