/**
 * Click-to-place (Option A).
 *
 * Clicking a shape button activates placement mode (crosshair cursor).
 * The NEXT left-click in the viewport places the object at that world position.
 * Right-click or Escape cancels.
 *
 * No ghost mesh — keeps it simple and reliable.
 */

import { Mat4, Vec3, Vec4 } from 'playcanvas';

import { Events } from './events';
import { MeshElement } from './mesh-element';
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

/** Get world placement position from a pointer event. */
const worldFromPointer = (e: PointerEvent, scene: Scene): Vec3 => {
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

    // Fallback: place 2m in front of the camera along the ray
    const d = 2;
    return new Vec3(near.x + dir.x * d, near.y + dir.y * d, near.z + dir.z * d);
};

const initMeshPlacement = (scene: Scene, events: Events) => {
    let placementType: string | null = null;
    const canvas = scene.canvas;

    // ── overlay element shown in crosshair mode ────────────────────────────
    // A transparent full-screen div sits on top of the canvas so we reliably
    // capture the pointer event without fighting the camera controller.
    const overlay = document.createElement('div');
    overlay.style.cssText = [
        'position:absolute', 'inset:0', 'z-index:200',
        'cursor:crosshair', 'display:none'
    ].join(';');
    canvas.parentElement?.appendChild(overlay);

    const startPlacement = (type: string) => {
        placementType = type;
        overlay.style.display = 'block';
    };

    const cancelPlacement = () => {
        placementType = null;
        overlay.style.display = 'none';
    };

    // Left-click on overlay → place object
    overlay.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.button !== 0) { cancelPlacement(); return; }
        e.stopPropagation();
        const type = placementType;
        cancelPlacement();
        if (!type) return;

        const pos = worldFromPointer(e, scene);
        events.fire('mesh.addPrimitive', type, pos);
    });

    // Right-click cancels
    overlay.addEventListener('contextmenu', (e: Event) => {
        e.preventDefault();
        cancelPlacement();
    });

    // ── event wiring ───────────────────────────────────────────────────────
    events.on('mesh.beginPlace', (type: string) => {
        startPlacement(type);
    });

    events.on('mesh.cancelPlace', cancelPlacement);

    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Escape' && placementType) cancelPlacement();
    });

    // ── click-selection of existing mesh objects ───────────────────────────
    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.button !== 0) return;
        if (placementType) return;   // overlay handles placement clicks

        const cam = (scene.camera as any).mainCamera?.camera;
        if (!cam) return;

        const rect = canvas.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
        const ny = ((e.clientY - rect.top)  / rect.height) * -2 + 1;

        const near = unproject(nx, ny, -1, cam);
        const far  = unproject(nx, ny,  1, cam);
        const dir  = new Vec3().sub2(far, near).normalize();

        let bestDist = Infinity;
        let bestMesh: MeshElement | null = null;

        events.invoke('mesh.list', (mesh: MeshElement) => {
            const pivot = mesh.pivot;
            if (!pivot || !mesh.visible) return;

            const center = pivot.getPosition();
            const scl    = pivot.getLocalScale();
            const radius = Math.max(scl.x, scl.y, scl.z) * 0.75;

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

        if (bestMesh) events.fire('mesh.click.select', bestMesh);
    });
};

export { initMeshPlacement, worldFromPointer as worldFromMouse };
