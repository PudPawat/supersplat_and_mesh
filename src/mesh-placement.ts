/**
 * Click-to-place (Option A).
 *
 * When the user clicks a shape button the panel fires 'mesh.beginPlace'.
 * We enter placement mode: the cursor changes, a ghost preview tracks
 * the mouse, and the first click in the viewport creates the object.
 *
 * World position is computed by:
 *   1. Unprojecting the mouse position to a 3-D ray
 *   2. Intersecting the ray with the horizontal plane at the scene's
 *      bounding-box centre Y (floor / table surface)
 *   3. Falling back to the camera's current focal distance if the ray
 *      is nearly horizontal
 */

import { Mat4, Vec3, Vec4 } from 'playcanvas';

import { Events } from './events';
import { MeshElement, MeshSource } from './mesh-element';
import { Scene } from './scene';

const _invVP = new Mat4();
const _vp    = new Mat4();

/** Unproject a screen pixel → world-space position at the given NDC-depth. */
const unproject = (ndcX: number, ndcY: number, ndcZ: number, cam: any): Vec3 => {
    _vp.mul2(cam.projectionMatrix, cam.viewMatrix);
    _invVP.copy(_vp).invert();
    const v = new Vec4(ndcX, ndcY, ndcZ, 1);
    _invVP.transformVec4(v, v);
    return new Vec3(v.x / v.w, v.y / v.w, v.z / v.w);
};

/** Get world placement position from a mouse event. */
const worldFromMouse = (e: MouseEvent, scene: Scene): Vec3 => {
    const cam    = (scene.camera as any).mainCamera?.camera;
    if (!cam) return new Vec3();

    const canvas = scene.canvas;
    const rect   = canvas.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
    const ny = ((e.clientY - rect.top)  / rect.height) * -2 + 1;

    const near = unproject(nx, ny, -1, cam);
    const far  = unproject(nx, ny,  1, cam);
    const dir  = new Vec3().sub2(far, near).normalize();

    // Intersect with scene bounding-box centre Y (floor plane)
    const targetY = scene.bound?.center?.y ?? 0;
    if (Math.abs(dir.y) > 0.001) {
        const t = (targetY - near.y) / dir.y;
        if (t > 0 && t < 1000) {
            return new Vec3(near.x + dir.x * t, targetY, near.z + dir.z * t);
        }
    }

    // Fallback: focal point distance along ray
    const d = (scene.camera as any).distanceTween?.value?.distance *
              ((scene.camera as any).sceneRadius ?? 1);
    return new Vec3(near.x + dir.x * d, near.y + dir.y * d, near.z + dir.z * d);
};

const initMeshPlacement = (scene: Scene, events: Events) => {
    let placementType: string | null = null;
    let ghostMesh: MeshElement | null = null;
    const canvas = scene.canvas;

    const cancelPlacement = () => {
        if (!placementType) return;
        placementType = null;
        canvas.style.cursor = '';

        if (ghostMesh) {
            ghostMesh.destroy();
            ghostMesh = null;
        }
        canvas.removeEventListener('mousemove', onMove);
        canvas.removeEventListener('click', onClick);
        canvas.removeEventListener('contextmenu', onCancel);
    };

    const onMove = (e: MouseEvent) => {
        const pos = worldFromMouse(e, scene);
        if (ghostMesh?.pivot) {
            ghostMesh.pivot.setPosition(pos);
            scene.forceRender = true;
        }
    };

    const onClick = (e: MouseEvent) => {
        if (!placementType) return;
        e.stopPropagation();

        const pos  = worldFromMouse(e, scene);
        const type = placementType;
        cancelPlacement();

        // Fire the actual creation event with the chosen position
        events.fire('mesh.addPrimitive', type, pos);
    };

    const onCancel = (e: MouseEvent) => {
        e.preventDefault();
        cancelPlacement();
    };

    // Triggered by shape buttons
    events.on('mesh.beginPlace', async (type: string) => {
        cancelPlacement();

        placementType = type;
        canvas.style.cursor = 'crosshair';

        // Create a semi-transparent ghost so the user can see where it will land
        const source: MeshSource = { kind: 'primitive', type };
        ghostMesh = new MeshElement(source, `${type}-preview`);
        ghostMesh.materialOptions = {
            ...ghostMesh.materialOptions,
            opacity: 0.35,
            preset: 'custom'
        };
        await scene.add(ghostMesh);
        events.fire('mesh.ghost.added', ghostMesh);

        canvas.addEventListener('mousemove', onMove);
        canvas.addEventListener('click', onClick);
        canvas.addEventListener('contextmenu', onCancel);
    });

    events.on('mesh.cancelPlace', cancelPlacement);

    // Click-selection of existing mesh objects (ray vs bounding sphere)
    canvas.addEventListener('click', (e: MouseEvent) => {
        if (placementType) return;   // handled by onClick above

        const cam    = (scene.camera as any).mainCamera?.camera;
        if (!cam) return;

        const rect = canvas.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
        const ny = ((e.clientY - rect.top)  / rect.height) * -2 + 1;

        const near = unproject(nx, ny, -1, cam);
        const far  = unproject(nx, ny,  1, cam);
        const dir  = new Vec3().sub2(far, near).normalize();

        // Find closest mesh hit
        let bestDist = Infinity;
        let bestMesh: MeshElement | null = null;

        events.invoke('mesh.list', (mesh: MeshElement) => {
            const pivot = mesh.pivot;
            if (!pivot || !mesh.visible) return;

            const center  = pivot.getPosition();
            const scl     = pivot.getLocalScale();
            const radius  = Math.max(scl.x, scl.y, scl.z) * 0.75;

            // Ray-sphere intersection
            const oc  = new Vec3().sub2(near, center);
            const a   = dir.dot(dir);
            const b   = 2 * oc.dot(dir);
            const c   = oc.dot(oc) - radius * radius;
            const dis = b * b - 4 * a * c;

            if (dis >= 0) {
                const t = (-b - Math.sqrt(dis)) / (2 * a);
                if (t > 0.01 && t < bestDist) {
                    bestDist = t;
                    bestMesh = mesh;
                }
            }
        });

        if (bestMesh) {
            events.fire('mesh.click.select', bestMesh);
        }
    });
};

export { initMeshPlacement, worldFromMouse };
