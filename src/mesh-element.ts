import {
    BLEND_NORMAL,
    Asset,
    BoundingBox,
    Entity,
    Material,
    Quat,
    SHADERLANGUAGE_GLSL,
    StandardMaterial,
    Texture,
    Vec3
} from 'playcanvas';

import { Element, ElementType } from './element';
import { captureSceneEnv } from './mesh-cubemap';
import { captureReflectionProbe } from './mesh-probe';
import { ssrChunk } from './shaders/ssr-shader';
import { Scene } from './scene';

// 'original' keeps the GLB / GLTF per-part look, but this version still adds
// reflection-friendly PBR settings through cloned materials. The raw imported
// materials are never mutated, so switching presets remains safe.
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

type SemanticMaterialProfile = {
    color: [number, number, number];
    opacity?: number;
    metalness?: number;
    roughness?: number;
    reflectivity?: number;
    emissive?: [number, number, number];
};

// Presets are treated mostly as SURFACE presets for imported GLB models.
// Plastic / Metal / Mirror / Glass preserve body / glass / wheel colors.
const PRESETS: Record<MeshMaterialPreset, Partial<MeshMaterialOptions>> = {
    original: { opacity: 1.0,  tintR: 1.0, tintG: 1.0, tintB: 1.0, reflectivity: 0.35, metalness: 0.0, roughness: 0.22 },
    glass:    { opacity: 0.55, tintR: 1.0, tintG: 1.0, tintB: 1.0, reflectivity: 0.90, metalness: 0.0, roughness: 0.02 },
    mirror:   { opacity: 1.0,  tintR: 1.0, tintG: 1.0, tintB: 1.0, reflectivity: 1.0,  metalness: 1.0, roughness: 0.0  },
    metal:    { opacity: 1.0,  tintR: 1.0, tintG: 1.0, tintB: 1.0, reflectivity: 0.75, metalness: 1.0, roughness: 0.16 },
    plastic:  { opacity: 1.0,  tintR: 1.0, tintG: 1.0, tintB: 1.0, reflectivity: 0.22, metalness: 0.0, roughness: 0.42 },
    custom:   { opacity: 1.0,  tintR: 1.0, tintG: 1.0, tintB: 1.0, reflectivity: 0.55, metalness: 0.0, roughness: 0.18 },
    gold:     { opacity: 1.0,  tintR: 1.0, tintG: 0.78, tintB: 0.18, reflectivity: 1.0,  metalness: 1.0, roughness: 0.05 },
    wave:     { opacity: 0.22, tintR: 0.82, tintG: 0.96, tintB: 1.0, reflectivity: 0.9,  metalness: 0.15, roughness: 0.0  },
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

    /** True while the imported model should keep its original per-part visual identity. */
    private _useOriginalMaterials = false;
    /** Shared material for primitive meshes, which do not have imported sub-materials. */
    private _material: StandardMaterial | null = null;
    /** Raw imported GLB / GLTF material by mesh instance. Used as the immutable source of truth. */
    private _originalMaterials = new WeakMap<any, Material>();
    /** Reflected visual-original clone by raw original material. */
    private _originalDisplayByOriginal = new Map<Material, Material>();
    private _originalDisplayMaterials: StandardMaterial[] = [];
    /** Enhanced preset clone by raw original material. */
    private _enhancedByOriginal = new Map<Material, StandardMaterial>();
    private _enhancedMaterials: StandardMaterial[] = [];
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
                this.pivot.addComponent('render', {
                    type: this.source.type
                });
                scene.contentRoot.addChild(this.pivot);
                this.pivot.render.layers = [scene.meshLayer.id];

                this._buildMaterial();
                this._applyToRender(this.pivot);
            }
        } else {
            // Imported GLB / GLTF: keep one material per imported mesh part.
            // We clone those materials so color/texture stay intact while reflection
            // envAtlas / PBR values can be applied safely.
            this._useOriginalMaterials = true;
            Object.assign(this.materialOptions, PRESETS.original, { preset: 'original' as MeshMaterialPreset });

            scene.contentRoot.addChild(this.pivot);
            const resource = (this.source.asset.resource as any);
            if (resource?.instantiateRenderEntity) {
                const child: Entity = resource.instantiateRenderEntity({ castShadows: false });
                this.pivot.addChild(child);
                this._walkSetLayer(this.pivot, scene);
                this._rememberOriginalMaterials(this.pivot);
                this._restoreOriginalMaterials();
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
        this._destroyEnhancedMaterials();
        this._destroyOriginalDisplayMaterials();
        if (this._envAtlas) {
            this._envAtlas.destroy();
            this._envAtlas = null;
        }
    }

    /**
     * Capture a reflection probe from this object's world position.
     * Important fix: hide the object during probe capture, otherwise a probe
     * taken from inside a car often captures the car itself instead of the room.
     */
    async captureReflection() {
        const scene = this.scene as Scene;
        if (!scene || !this.pivot) return;

        const worldPos = this.pivot.getPosition().clone();
        const wasEnabled = this.pivot.enabled;
        console.log('[MeshElement] starting reflection probe at', worldPos.toString(), 'for', this._name);

        let atlas: Texture | null = null;

        try {
            // Avoid self-reflection and avoid blocking the 3DGS background.
            this.pivot.enabled = false;
            atlas = await captureReflectionProbe(scene, worldPos);
        } finally {
            this.pivot.enabled = wasEnabled;
        }

        if (!atlas) {
            console.warn('[MeshElement] probe failed, falling back to screen capture for', this._name);
            atlas = captureSceneEnv(scene);
        }

        if (atlas) {
            if (this._envAtlas) this._envAtlas.destroy();
            this._envAtlas = atlas;

            // Recreate the currently visible material clones so the new envAtlas
            // is actually assigned. This now works for Original(GLB), not only
            // Mirror/Metal/Custom presets.
            this._refreshVisibleMaterials();
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

        if (!this.pivot) return;

        if (opts.preset === 'original') {
            this._useOriginalMaterials = true;
            this._restoreOriginalMaterials();
            return;
        }

        if (opts.preset) {
            this._useOriginalMaterials = false;
        }

        if (this._useOriginalMaterials) {
            // Allows sliders such as reflectivity / roughness to affect Original(GLB)
            // while preserving original colors and material separation.
            this._restoreOriginalMaterials();
        } else {
            this._applyCurrentMaterialToHierarchy();
        }
    }

    private _refreshVisibleMaterials() {
        if (!this.pivot) return;

        if (this._useOriginalMaterials) {
            const old = this._originalDisplayMaterials;
            this._originalDisplayMaterials = [];
            this._originalDisplayByOriginal.clear();
            this._walkRestoreOriginal(this.pivot);
            for (const mat of old) mat.destroy();
        } else {
            this._applyCurrentMaterialToHierarchy();
        }
    }

    private _buildMaterial() {
        const o = this.materialOptions;

        if (!this._material) {
            this._material = new StandardMaterial();
        }
        const mat = this._material;

        mat.diffuse.set(o.tintR, o.tintG, o.tintB);
        mat.emissive.set(o.tintR * 0.04, o.tintG * 0.04, o.tintB * 0.04);
        this._applySurfaceOptions(mat, o.opacity);
    }

    /** Apply preset reflectivity / roughness / opacity while preserving existing color maps. */
    private _applySurfaceOptions(mat: StandardMaterial, opacity: number, preserveImportedTransparency = false) {
        const o = this.materialOptions;
        const originalBlendType = mat.blendType;

        mat.opacity = Math.max(0, Math.min(1, opacity));
        mat.useMetalness = true;
        mat.metalness = o.metalness;
        mat.gloss = 1 - o.roughness;
        mat.reflectivity = o.reflectivity;
        mat.specular.set(1, 1, 1);
        this._attachEnvironment(mat);

        if (mat.opacity < 1.0 || (preserveImportedTransparency && originalBlendType !== 0)) {
            mat.blendType = originalBlendType !== 0 ? originalBlendType : BLEND_NORMAL;
            mat.depthWrite = false;
        } else {
            mat.blendType = 0;
            mat.depthWrite = true;
        }
        mat.update();
    }

    /** Prefer the captured reflection probe. Use SSR only before a probe is available. */
    private _attachEnvironment(mat: StandardMaterial) {
        if (this._envAtlas) {
            mat.envAtlas = this._envAtlas;
            mat.useSkybox = false;
            return;
        }

        const scene = this.scene as Scene;
        const ssrTexture = scene ? (scene as any).ssrPass?.ssrSceneTexture : null;
        if (ssrTexture) {
            mat.getShaderChunks(SHADERLANGUAGE_GLSL).set('reflectionEnvPS', ssrChunk);
            (mat as any).shaderChunksVersion = '2.6';
            mat.setParameter('uSSRScene', ssrTexture);
        } else {
            mat.envAtlas = null;
            mat.useSkybox = true;
        }
    }

    private _addRenderChild(scene: Scene, name: string, type: string,
        px: number, py: number, pz: number,
        sx: number, sy: number, sz: number
    ): Entity {
        const e = new Entity(name);
        e.setLocalPosition(px, py, pz);
        e.setLocalScale(sx, sy, sz);
        this.pivot.addChild(e);
        e.addComponent('render', { type });
        e.render.layers = [scene.meshLayer.id];
        return e;
    }

    private _buildBulletGeometry(scene: Scene) {
        console.log('[MeshElement] building bullet geometry');
        this._addRenderChild(scene, 'bullet-body', 'cylinder',  0,  0,       0,  0.24, 0.7,  0.24);
        this._addRenderChild(scene, 'bullet-tip',  'cone',      0,  0.5,     0,  0.24, 0.3,  0.24);
        this._addRenderChild(scene, 'bullet-base', 'sphere',    0, -0.35,    0,  0.24, 0.08, 0.24);
    }

    private _buildWaveGeometry(scene: Scene) {
        console.log('[MeshElement] building wave geometry');
        const rings = [0.4, 0.65, 0.92, 1.22, 1.56, 1.94];
        rings.forEach((r, i) => {
            const thickness = 0.06 - i * 0.006;
            const e = new Entity(`wave-ring-${i}`);
            e.setLocalScale(r, thickness, r);
            this.pivot.addChild(e);
            e.addComponent('render', { type: 'torus' });
            e.render.layers = [scene.meshLayer.id];
        });
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

    /** Capture raw imported material on every mesh instance so it can be restored or cloned exactly. */
    private _rememberOriginalMaterials(entity: Entity) {
        const r = (entity as any).render;
        if (r?.meshInstances) {
            for (const mi of r.meshInstances) {
                if (mi.material && !this._originalMaterials.has(mi)) {
                    this._originalMaterials.set(mi, mi.material as Material);
                }
            }
        }
        for (let i = 0; i < entity.children.length; i++) {
            this._rememberOriginalMaterials(entity.children[i] as Entity);
        }
    }

    /** Restore imported GLB / GLTF per-part colors, now with reflection environment attached. */
    private _restoreOriginalMaterials() {
        if (!this.pivot) return;
        const oldEnhanced = this._enhancedMaterials;
        this._enhancedMaterials = [];
        this._enhancedByOriginal.clear();
        this._walkRestoreOriginal(this.pivot);
        for (const mat of oldEnhanced) mat.destroy();
    }

    private _walkRestoreOriginal(entity: Entity) {
        const r = (entity as any).render;
        if (r?.meshInstances) {
            for (const mi of r.meshInstances) {
                const original = this._originalMaterials.get(mi);
                if (original) {
                    mi.material = this._getOriginalDisplayMaterial(original);
                }
            }
        }
        for (let i = 0; i < entity.children.length; i++) {
            this._walkRestoreOriginal(entity.children[i] as Entity);
        }
    }

    private _destroyEnhancedMaterials() {
        for (const mat of this._enhancedMaterials) {
            mat.destroy();
        }
        this._enhancedMaterials = [];
        this._enhancedByOriginal.clear();
    }

    private _destroyOriginalDisplayMaterials() {
        for (const mat of this._originalDisplayMaterials) {
            mat.destroy();
        }
        this._originalDisplayMaterials = [];
        this._originalDisplayByOriginal.clear();
    }

    /** Apply the current preset. GLB containers get per-original-material clones; primitives use one shared material. */
    private _applyCurrentMaterialToHierarchy() {
        if (!this.pivot) return;

        if (this.source.kind === 'container') {
            const oldEnhanced = this._enhancedMaterials;
            this._enhancedMaterials = [];
            this._enhancedByOriginal.clear();

            this._walkAndApplyEnhanced(this.pivot);

            for (const mat of oldEnhanced) {
                mat.destroy();
            }
            return;
        }

        this._buildMaterial();
        this._walkAndApply(this.pivot);
    }

    private _getOriginalDisplayMaterial(original: Material): Material {
        const cached = this._originalDisplayByOriginal.get(original);
        if (cached) return cached;

        if (!(original instanceof StandardMaterial)) {
            this._originalDisplayByOriginal.set(original, original);
            return original;
        }

        const mat = original.clone() as StandardMaterial;
        mat.name = `${original.name || 'GLB material'} + reflected-original`;

        const fallbackNeeded = this._needsSemanticColorFallback(original);
        if (fallbackNeeded) {
            this._applySemanticFallback(mat, original.name || '', true);
        } else {
            this._applyOriginalReflectionProfile(mat, original.name || '');
        }

        mat.update();
        this._originalDisplayByOriginal.set(original, mat);
        this._originalDisplayMaterials.push(mat);
        return mat;
    }

    private _needsSemanticColorFallback(mat: StandardMaterial): boolean {
        // If the model has a diffuse/base-color texture or meaningful non-neutral diffuse color,
        // the GLB already contains real color information. Do not override it.
        if (this._hasBaseColorSource(mat)) return false;
        if (!this._isNeutralDefaultDiffuse(mat)) return false;
        return this._semanticProfileForMaterial(mat.name || '') !== null;
    }

    private _hasBaseColorSource(mat: StandardMaterial): boolean {
        const m = mat as any;
        return !!(m.diffuseMap || m.baseColorMap || m.opacityMap || m.emissiveMap);
    }

    private _isNeutralDefaultDiffuse(mat: StandardMaterial): boolean {
        const r = mat.diffuse.r;
        const g = mat.diffuse.g;
        const b = mat.diffuse.b;
        const maxDelta = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
        const avg = (r + g + b) / 3;
        return maxDelta < 0.035 && avg > 0.55;
    }

    private _semanticProfileForMaterial(name: string): SemanticMaterialProfile | null {
        const n = name.toLowerCase();

        if (/glass|window|windshield|windscreen|透明|กระจก/.test(n)) {
            return {
                color: [0.42, 0.62, 0.72],
                opacity: 0.36,
                metalness: 0.0,
                roughness: 0.015,
                reflectivity: 0.90
            };
        }
        if (/rubber|tyre|tire|tyyre|kauçuk|kaucuk|ยาง/.test(n)) {
            return {
                color: [0.012, 0.012, 0.014],
                opacity: 1.0,
                metalness: 0.0,
                roughness: 0.78,
                reflectivity: 0.06
            };
        }
        if (/black|carbon|karbon|wire|grille|grill|interior|สีดำ/.test(n)) {
            return {
                color: [0.018, 0.018, 0.02],
                opacity: 1.0,
                metalness: /wire|carbon|karbon/.test(n) ? 0.25 : 0.0,
                roughness: /carbon|karbon/.test(n) ? 0.28 : 0.45,
                reflectivity: /carbon|karbon/.test(n) ? 0.32 : 0.12
            };
        }
        if (/steel|chrome|alum|aliminyum|metal|brake|disc|rim|wheel|ล้อ|โลหะ/.test(n)) {
            return {
                color: [0.62, 0.62, 0.60],
                opacity: 1.0,
                metalness: 0.9,
                roughness: 0.12,
                reflectivity: 0.70
            };
        }
        if (/paint|body|carpaint|สีรถ/.test(n)) {
            return {
                color: [0.72, 0.025, 0.025],
                opacity: 1.0,
                metalness: 0.0,
                roughness: 0.16,
                reflectivity: 0.48
            };
        }
        if (/led|light|lamp|headlight|ไฟ/.test(n)) {
            return {
                color: [1.0, 0.96, 0.82],
                opacity: 1.0,
                metalness: 0.0,
                roughness: 0.08,
                reflectivity: 0.35,
                emissive: [0.45, 0.40, 0.28]
            };
        }

        return null;
    }

    private _applySemanticFallback(mat: StandardMaterial, name: string, includeEnvironment = false) {
        const profile = this._semanticProfileForMaterial(name);
        if (!profile) return;

        const [r, g, b] = profile.color;
        mat.diffuse.set(r, g, b);
        this._applyMaterialProfile(mat, profile, includeEnvironment);
    }

    private _applyOriginalReflectionProfile(mat: StandardMaterial, name: string) {
        const profile = this._semanticProfileForMaterial(name);
        if (profile) {
            // Keep imported color / texture. Only use semantic PBR behavior.
            this._applyMaterialProfile(mat, {
                ...profile,
                color: [mat.diffuse.r, mat.diffuse.g, mat.diffuse.b]
            }, true);
            return;
        }

        // Generic reflective car-paint fallback for named parts that do not match.
        const o = this.materialOptions;
        mat.opacity = Math.max(0, Math.min(1, mat.opacity * o.opacity));
        mat.useMetalness = true;
        mat.metalness = Math.max(mat.metalness, Math.min(o.metalness, 0.25));
        mat.gloss = Math.max(mat.gloss, 1 - o.roughness);
        mat.reflectivity = Math.max(mat.reflectivity, o.reflectivity);
        mat.specular.set(1, 1, 1);
        this._attachEnvironment(mat);

        if (mat.opacity < 1.0 || mat.blendType !== 0) {
            mat.blendType = mat.blendType !== 0 ? mat.blendType : BLEND_NORMAL;
            mat.depthWrite = false;
        } else {
            mat.blendType = 0;
            mat.depthWrite = true;
        }
    }

    private _applyMaterialProfile(mat: StandardMaterial, profile: SemanticMaterialProfile, includeEnvironment: boolean) {
        mat.opacity = profile.opacity ?? mat.opacity;
        mat.useMetalness = true;
        mat.metalness = profile.metalness ?? mat.metalness;
        mat.gloss = 1 - (profile.roughness ?? (1 - mat.gloss));
        mat.reflectivity = profile.reflectivity ?? mat.reflectivity;
        mat.specular.set(1, 1, 1);

        if (profile.emissive) {
            mat.emissive.set(profile.emissive[0], profile.emissive[1], profile.emissive[2]);
        }

        if (includeEnvironment) {
            this._attachEnvironment(mat);
        }

        if (mat.opacity < 1.0 || mat.blendType !== 0) {
            mat.blendType = mat.blendType !== 0 ? mat.blendType : BLEND_NORMAL;
            mat.depthWrite = false;
        } else {
            mat.blendType = 0;
            mat.depthWrite = true;
        }
    }

    private _shouldApplyPresetTintToImported(): boolean {
        // For imported GLB models, most presets should modify only surface response.
        // Gold/Wave are intentional stylized recolor presets.
        return this.materialOptions.preset === 'gold' || this.materialOptions.preset === 'wave';
    }

    /** Clone one material per original material, preserving the imported model's per-part colors/textures. */
    private _getEnhancedMaterial(original: Material): StandardMaterial {
        let mat = this._enhancedByOriginal.get(original);
        if (mat) return mat;

        const o = this.materialOptions;
        const displayBase = this._getOriginalDisplayMaterial(original);

        if (displayBase instanceof StandardMaterial) {
            mat = displayBase.clone() as StandardMaterial;
            mat.name = `${displayBase.name || 'GLB material'} + ${o.preset}`;

            if (this._shouldApplyPresetTintToImported()) {
                mat.diffuse.set(
                    mat.diffuse.r * o.tintR,
                    mat.diffuse.g * o.tintG,
                    mat.diffuse.b * o.tintB
                );
            }

            // Preserve original alpha differences, e.g. glass remains different from the body.
            this._applySurfaceOptions(mat, mat.opacity * o.opacity, true);
        } else {
            mat = new StandardMaterial();
            mat.name = `${original.name || 'Imported material'} + ${o.preset}`;
            mat.diffuse.set(o.tintR, o.tintG, o.tintB);
            mat.emissive.set(o.tintR * 0.04, o.tintG * 0.04, o.tintB * 0.04);
            this._applySurfaceOptions(mat, o.opacity);
        }

        this._enhancedByOriginal.set(original, mat);
        this._enhancedMaterials.push(mat);
        return mat;
    }

    private _walkAndApplyEnhanced(entity: Entity) {
        const r = (entity as any).render;
        if (r?.meshInstances) {
            for (const mi of r.meshInstances) {
                const original = this._originalMaterials.get(mi) ?? (mi.material as Material);
                if (!this._originalMaterials.has(mi) && original) {
                    this._originalMaterials.set(mi, original);
                }
                if (original) {
                    mi.material = this._getEnhancedMaterial(original);
                }
            }
        }
        for (let i = 0; i < entity.children.length; i++) {
            this._walkAndApplyEnhanced(entity.children[i] as Entity);
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
