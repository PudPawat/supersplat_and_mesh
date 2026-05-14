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

        // Block camera controller while dragging a gizmo handle
        // PlayCanvas fires 'transform:start' / 'transform:end' on TransformGizmo
        const canvas = scene.canvas;
        const blockCamera = (e: PointerEvent) => { e.stopPropagation(); };

        [this.translate, this.rotate, this.scale].forEach(g => {
            g.on('render:update', () => { scene.forceRender = true; });

            g.on('transform:start', () => {
                // Capture pointer so the camera controller never sees these events
                canvas.addEventListener('pointerdown', blockCamera, true);
                canvas.addEventListener('pointermove', blockCamera, true);
                canvas.addEventListener('pointerup',   blockCamera, true);
            });

            g.on('transform:end', () => {
                canvas.removeEventListener('pointerdown', blockCamera, true);
                canvas.removeEventListener('pointermove', blockCamera, true);
                canvas.removeEventListener('pointerup',   blockCamera, true);
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
