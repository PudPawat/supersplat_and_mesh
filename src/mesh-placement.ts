/**
 * Click-to-place (Option A).
 *
 * Clicking a shape button activates placement mode (crosshair cursor).
 * The NEXT left-click in the viewport places the object at that world position.
 * Right-click or Escape cancels.
 *
 * No ghost mesh — keeps it simple and reliable.
 */

import { BoundingBox, Entity, Mat4, Vec3, Vec4 } from 'playcanvas';

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

/**
 * Walk an entity's render hierarchy and return the combined world-space
 * bounding sphere.  Falls back to null if the entity has no render components
 * (e.g. pivot-only entities before geometry is loaded).
 */
const worldBoundSphere = (root: Entity): { center: Vec3; radius: number } | null => {
    const box = new BoundingBox();
    let found = false;

    const walk = (e: Entity) => {
        const r = (e as any).render;
        if (r?.meshInstances) {
            for (const mi of r.meshInstances) {
                if (!mi.aabb) continue;
                if (!found) {
                    box.copy(mi.aabb);
                    found = true;
                } else {
                    box.add(mi.aabb);
                }
            }
        }
        for (let i = 0; i < e.children.length; i++) {
            walk(e.children[i] as Entity);
        }
    };
    walk(root);

    if (!found) return null;
    return {
        center: box.center.clone(),
        radius: box.halfExtents.length()
    };
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

            // Use actual world-space render bounds so GLB containers (like the
            // car at scale 0.1 with large internal geometry) can be clicked.
            // Fall back to the scale-based estimate for pivot-only entities.
            const bound = worldBoundSphere(pivot);
            const scl   = pivot.getLocalScale();
            const center = bound?.center ?? pivot.getPosition();
            const radius = bound?.radius ?? Math.max(scl.x, scl.y, scl.z) * 0.75;

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
