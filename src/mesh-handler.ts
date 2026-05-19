import { Asset, Vec3, path } from 'playcanvas';

import { ElementType } from './element';
import { Events } from './events';
import { MeshElement, MeshSource, ReflectionMode, setGlobalReflectionMode, getGlobalReflectionMode } from './mesh-element';
import { MeshGizmo } from './mesh-gizmo';
import { initMeshPlacement } from './mesh-placement';
import { Scene } from './scene';

const MESH_EXTENSIONS = new Set(['.glb', '.gltf']);

const isMeshFile = (filename: string) =>
    MESH_EXTENSIONS.has(path.getExtension(filename).toLowerCase());

const PRIMITIVES = ['sphere', 'box', 'cylinder', 'capsule', 'cone', 'torus', 'plane'];

const initMeshHandler = (scene: Scene, events: Events) => {

    // All live mesh elements (excluding ghosts)
    const meshList: MeshElement[] = [];

    // Gizmo manager
    const gizmo = new MeshGizmo(scene, events);

    // Click-to-place + click-selection
    initMeshPlacement(scene, events);

    // Allow other modules to iterate the mesh list
    events.function('mesh.list', (callback: (m: MeshElement) => void) => {
        meshList.forEach(callback);
    });

    // ── shared "mesh was created" flow ──────────────────────────────────────
    const registerMesh = (mesh: MeshElement) => {
        meshList.push(mesh);
        events.fire('mesh.added', mesh);
        // auto-capture after scene has had a couple of frames to render
        setTimeout(() => mesh.captureReflection(), 200);
    };

    // ── add primitive shape ─────────────────────────────────────────────────
    // Fired with optional position (from click-to-place) or just type
    // Default scales per shape type (scene units are roughly metres)
    const DEFAULT_SCALE: Record<string, number> = {
        sphere:   0.25,
        box:      0.25,
        cylinder: 0.25,
        cone:     0.25,
        capsule:  0.25,
        torus:    0.25,
        plane:    0.5,
        bullet:   0.35,
        wave:     0.6,
    };

    events.on('mesh.addPrimitive', (type: string, position?: Vec3) => {
        const source: MeshSource = { kind: 'primitive', type };
        const mesh = new MeshElement(source, type);
        scene.add(mesh).then(() => {
            if (position) mesh.setPosition(position);
            const s = DEFAULT_SCALE[type] ?? 0.25;
            mesh.setScale(new Vec3(s, s, s));
            registerMesh(mesh);
        });
    });

    // ── shape buttons fire beginPlace instead of direct addPrimitive ────────
    // (The panel buttons were changed to fire 'mesh.beginPlace')
    // If something still fires addPrimitive without a position, that's fine too.

    // ── remove ghost from list when placement completes / cancels ───────────
    events.on('mesh.ghost.added', (ghost: MeshElement) => {
        // ghost is NOT in meshList — it's temporary
    });

    // ── reflection mode toggle ──────────────────────────────────────────────
    events.function('mesh.reflectionMode', () => getGlobalReflectionMode());

    events.on('mesh.setReflectionMode', (mode: ReflectionMode) => {
        setGlobalReflectionMode(mode);
        // Rebuild materials for all live meshes so the change takes effect immediately
        meshList.forEach(m => {
            if (!(m as any)._useOriginalMaterials) {
                (m as any)._buildMaterial();
                (m as any)._walkAndApply((m as any).pivot);
            }
        });
        events.fire('mesh.reflectionMode.changed', mode);
    });

    // ── re-capture reflections when 3DGS scene loads ────────────────────────
    // Run probes sequentially so they don't conflict with each other.
    events.on('stopSpinner', () => {
        const hasSplats = scene.getElementsByType(ElementType.splat).length > 0;
        if (!hasSplats) return;
        setTimeout(async () => {
            for (const m of meshList) {
                await m.captureReflection();
            }
        }, 1000);
    });

    // ── GLB / GLTF import via file picker ───────────────────────────────────
    events.on('mesh.import', async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.glb,.gltf';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (file) await loadMeshFile(file, scene, registerMesh, events);
        };
        input.click();
    });

    // ── Load mesh from URL (e.g. bundled sample models) ─────────────────────
    // filename = 'audi_r8.glb' (used by PlayCanvas importer; must have extension)
    // displayName = 'Audi R8'  (shown in the UI object list)
    events.on('mesh.importUrl', async (url: string, filename: string, displayName?: string) => {
        await loadMeshUrl(url, filename, displayName ?? filename, scene, registerMesh, events);
    });

    // ── drag-drop ───────────────────────────────────────────────────────────
    events.on('drop.file', async (file: File) => {
        if (isMeshFile(file.name)) {
            await loadMeshFile(file, scene, registerMesh, events);
        }
    });

    // ── click-select ────────────────────────────────────────────────────────
    events.on('mesh.click.select', (mesh: MeshElement) => {
        events.fire('mesh.select', mesh);
    });

    // ── remove from list on destroy ─────────────────────────────────────────
    events.on('mesh.removed', (mesh: MeshElement) => {
        const idx = meshList.indexOf(mesh);
        if (idx !== -1) meshList.splice(idx, 1);
        if (events.invoke('mesh.selectedMesh') === mesh) {
            events.fire('mesh.select', null);
        }
    });

    events.function('mesh.primitives', () => PRIMITIVES);
};

const loadMeshFile = async (
    file: File,
    scene: Scene,
    register: (m: MeshElement) => void,
    events: Events
) => {
    events.fire('startSpinner');
    try {
        const url = URL.createObjectURL(file);
        await new Promise<void>((resolve, reject) => {
            const asset = new Asset(file.name, 'container', { url, filename: file.name });
            scene.app.assets.add(asset);

            asset.on('load', () => {
                URL.revokeObjectURL(url);
                const source: MeshSource = { kind: 'container', asset };
                const mesh = new MeshElement(source, file.name);
                scene.add(mesh).then(() => { register(mesh); resolve(); });
            });

            asset.on('error', (err: string) => {
                URL.revokeObjectURL(url);
                reject(new Error(err));
            });

            scene.app.assets.load(asset);
        });
    } catch (err) {
        console.error('Failed to load mesh:', err);
    } finally {
        events.fire('stopSpinner');
    }
};

const loadMeshUrl = async (
    url: string,
    filename: string,       // must include extension e.g. 'audi_r8.glb'
    displayName: string,    // shown in UI e.g. 'Audi R8'
    scene: Scene,
    register: (m: MeshElement) => void,
    events: Events
) => {
    events.fire('startSpinner');
    try {
        await new Promise<void>((resolve, reject) => {
            // filename (with .glb extension) tells PlayCanvas which importer to use
            const asset = new Asset(displayName, 'container', { url, filename });
            scene.app.assets.add(asset);

            asset.on('load', () => {
                const source: MeshSource = { kind: 'container', asset };
                const mesh = new MeshElement(source, displayName);
                scene.add(mesh).then(() => {
                    mesh.setScale(new Vec3(0.1, 0.1, 0.1));
                    register(mesh);
                    resolve();
                });
            });

            asset.on('error', (err: string) => {
                console.error('[loadMeshUrl] asset error:', err);
                reject(new Error(err));
            });

            scene.app.assets.load(asset);
        });
    } catch (err) {
        console.error('Failed to load mesh from URL:', err);
    } finally {
        events.fire('stopSpinner');
    }
};

export { initMeshHandler, isMeshFile };
