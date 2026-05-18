/**
 * MeshGizmo — attaches TranslateGizmo / RotateGizmo / ScaleGizmo to the selected
 * MeshElement's pivot entity.  Fires 'mesh.transform.changed' whenever the user
 * drags a handle so the transform panel can stay in sync.
 */

import { Entity, Mat4, RotateGizmo, ScaleGizmo, TranslateGizmo, Vec3 } from 'playcanvas';

import { Events } from './events';
import { MeshElement } from './mesh-element';
import { Scene } from './scene';

type GizmoMode = 'translate' | 'rotate' | 'scale';

class MeshGizmo {
    private translate: TranslateGizmo;
    private rotate:    RotateGizmo;
    private scale:     ScaleGizmo;
    private mode: GizmoMode = 'translate';
    private mesh: MeshElement | null = null;

    constructor(scene: Scene, events: Events) {
        const cam   = scene.camera.camera;
        const layer = scene.gizmoLayer;

        this.translate = new TranslateGizmo(cam, layer);
        this.rotate    = new RotateGizmo(cam, layer);
        this.scale     = new ScaleGizmo(cam, layer);

        // Keep gizmo a constant screen-space size
        const resize = () => {
            const s = 1200 / Math.max(scene.canvas.clientWidth, scene.canvas.clientHeight);
            this.translate.size = s;
            this.rotate.size    = s;
            this.scale.size     = s;
        };
        resize();
        events.on('camera.resize', resize);

        // The camera controller attaches to 'canvas-container' and calls
        // setPointerCapture on pointerdown, which steals all subsequent pointermove
        // events away from PlayCanvas's gizmo.  Fix: record the active pointerId in
        // a capture-phase listener that fires BEFORE the camera's bubble-phase
        // handler, then release capture as soon as a gizmo drag starts so the
        // gizmo receives the pointermove stream normally.
        // We also stop pointermove propagation from the canvas up to canvas-container
        // so the camera doesn't orbit while we're dragging.

        const canvas = scene.canvas;
        const canvasContainer = document.getElementById('canvas-container') as HTMLElement;

        let activePointerId = -1;

        // Capture phase on the container fires before the camera's bubble handler.
        canvasContainer.addEventListener('pointerdown', (e: PointerEvent) => {
            activePointerId = e.pointerId;
        }, true);

        // Prevent pointermove from bubbling to canvas-container (camera orbit).
        // stopPropagation at the canvas level still lets PlayCanvas's own gizmo
        // handlers on the canvas run (they are at-target, not caught by this).
        const blockMove = (e: PointerEvent) => { e.stopPropagation(); };

        [this.translate, this.rotate, this.scale].forEach(g => {
            g.on('render:update', () => { scene.forceRender = true; });

            g.on('transform:start', () => {
                // Release the camera's pointer capture so the canvas
                // (and PlayCanvas's gizmo) receives pointermove / pointerup.
                if (activePointerId !== -1) {
                    try { canvasContainer.releasePointerCapture(activePointerId); } catch (_) { /* ignore */ }
                }
                // Block pointermove from reaching camera-container while dragging.
                canvas.addEventListener('pointermove', blockMove, true);
            });

            g.on('transform:end', () => {
                // Remove the blocker — pointerup bubbles normally so the camera
                // controller can reset its pressedButton state.
                canvas.removeEventListener('pointermove', blockMove, true);
            });

            g.on('transform:move', () => {
                const m = this.mesh;
                if (!m?.pivot) return;
                events.fire('mesh.transform.changed', m);
                scene.forceRender = true;
            });
        });

        // External events
        events.on('mesh.selected', (m: MeshElement | null) => this._select(m));
        events.on('mesh.gizmo.mode', (mode: GizmoMode) => this._setMode(mode));
        events.on('mesh.gizmo.detach', () => this._detachAll());

        // Match SuperSplat's coordinate-space toggle
        events.on('tool.coordSpace', (cs: string) => {
            this.translate.coordSpace = cs as 'local' | 'world';
            this.rotate.coordSpace    = cs as 'local' | 'world';
            this.scale.coordSpace     = cs as 'local' | 'world';
        });
    }

    private _detachAll() {
        if (this.translate.nodes.length) this.translate.detach();
        if (this.rotate.nodes.length)    this.rotate.detach();
        if (this.scale.nodes.length)     this.scale.detach();
    }

    private _attach() {
        this._detachAll();
        if (!this.mesh?.pivot) return;
        const g = this.mode === 'translate' ? this.translate
                : this.mode === 'rotate'    ? this.rotate
                : this.scale;
        g.attach([this.mesh.pivot]);
    }

    private _select(mesh: MeshElement | null) {
        this.mesh = mesh;
        if (mesh) this._attach();
        else      this._detachAll();
    }

    private _setMode(mode: GizmoMode) {
        this.mode = mode;
        this._attach();
    }
}

export { MeshGizmo };
