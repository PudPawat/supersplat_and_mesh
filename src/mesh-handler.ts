import { Asset, path } from 'playcanvas';

import { ElementType } from './element';
import { Events } from './events';
import { MeshElement, MeshSource } from './mesh-element';
import { Scene } from './scene';

const CONTAINER_EXTS = new Set(['.glb', '.gltf']);
const MESH_EXTENSIONS = new Set(['.glb', '.gltf']);

const isMeshFile = (filename: string) => {
    return MESH_EXTENSIONS.has(path.getExtension(filename).toLowerCase());
};

// primitive shapes available without file loading
const PRIMITIVES = ['sphere', 'box', 'cylinder', 'capsule', 'cone', 'torus', 'plane'];

const initMeshHandler = (scene: Scene, events: Events) => {

    // add primitive shape directly (no file needed)
    events.on('mesh.addPrimitive', (type: string) => {
        const source: MeshSource = { kind: 'primitive', type };
        const mesh = new MeshElement(source, type);
        scene.add(mesh).then(() => events.fire('mesh.added', mesh));
    });

    // when the 3DGS scene finishes loading, re-capture reflections for all mesh objects
    events.on('stopSpinner', () => {
        const hasSplats = scene.getElementsByType(ElementType.splat).length > 0;
        if (!hasSplats) return;
        // wait 2 frames for the splat to fully render before capturing
        setTimeout(() => {
            const meshElements = scene.getElementsByType(ElementType.model) as MeshElement[];
            meshElements.forEach(m => {
                if (m instanceof MeshElement) m.captureReflection();
            });
        }, 1000);
    });

    // open file picker for GLB/GLTF
    events.on('mesh.import', async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.glb,.gltf';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (file) await loadMeshFile(file, scene, events);
        };
        input.click();
    });

    // drag-drop support
    events.on('drop.file', async (file: File) => {
        if (isMeshFile(file.name)) {
            await loadMeshFile(file, scene, events);
        }
    });

    events.function('mesh.primitives', () => PRIMITIVES);
};

const loadMeshFile = async (file: File, scene: Scene, events: Events) => {
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
                scene.add(mesh).then(() => {
                    events.fire('mesh.added', mesh);
                    resolve();
                });
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

export { initMeshHandler, isMeshFile };
