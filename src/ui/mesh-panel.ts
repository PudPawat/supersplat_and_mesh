import { Container, Label, NumericInput, SelectInput, SliderInput, VectorInput } from '@playcanvas/pcui';
import { Quat, Vec3 } from 'playcanvas';

import { Events } from '../events';
import { MeshElement, MeshMaterialPreset } from '../mesh-element';
import { Tooltips } from './tooltips';

class MeshPanel extends Container {
    constructor(events: Events, tooltips: Tooltips, args = {}) {
        args = { ...args, id: 'mesh-panel', class: 'panel' };
        super(args);

        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach(n =>
            this.dom.addEventListener(n, (e: Event) => e.stopPropagation())
        );

        // ── header ─────────────────────────────────────────────────────────
        const header   = new Container({ class: 'panel-header' });
        const icon     = new Label({ class: 'panel-header-icon', text: '' });
        const label    = new Label({ class: 'panel-header-label', text: 'Mesh Objects' });
        const importBtn = new Container({ class: 'panel-header-button' });
        importBtn.dom.textContent = '+';
        importBtn.dom.title = 'Import GLB/GLTF';
        importBtn.on('click', () => events.fire('mesh.import'));
        header.append(icon); header.append(label); header.append(importBtn);
        this.append(header);

        // ── shape buttons (Option A — click-to-place) ───────────────────────
        const primRow   = new Container({ class: 'mesh-prim-row' });
        const primLabel = new Label({ class: 'mesh-prim-label', text: 'Add shape:' });
        primRow.append(primLabel);

        const shapes = [
            { type: 'sphere', icon: '⬤' },
            { type: 'box',    icon: '⬛' },
            { type: 'cylinder', icon: '⬭' },
            { type: 'cone',   icon: '▲' },
        ];
        shapes.forEach(({ type, icon }) => {
            const btn = new Container({ class: 'mesh-prim-btn' });
            btn.dom.textContent = icon;
            btn.dom.title = `Place ${type} — click in viewport`;
            // Fire beginPlace so click-to-place mode activates
            btn.on('click', () => events.fire('mesh.beginPlace', type));
            primRow.append(btn);
        });
        this.append(primRow);

        // ── mesh list ───────────────────────────────────────────────────────
        const listContainer = new Container({ id: 'mesh-list' });
        this.append(listContainer);

        // ── gizmo mode toolbar (Option C) ────────────────────────────────────
        const gizmoRow = new Container({ class: 'mesh-prim-row' });
        const gizmoLabel = new Label({ class: 'mesh-prim-label', text: 'Transform:' });
        gizmoRow.append(gizmoLabel);

        const gizmoModes = [
            { mode: 'translate', icon: '✥', title: 'Move (T)' },
            { mode: 'rotate',    icon: '↻', title: 'Rotate (R)' },
            { mode: 'scale',     icon: '⇲', title: 'Scale (S)' },
        ];
        const gizmoBtns: Map<string, Container> = new Map();
        gizmoModes.forEach(({ mode, icon, title }) => {
            const btn = new Container({ class: 'mesh-prim-btn' });
            btn.dom.textContent = icon;
            btn.dom.title = title;
            btn.on('click', () => {
                gizmoBtns.forEach((b, m) => b.dom.classList.toggle('active', m === mode));
                events.fire('mesh.gizmo.mode', mode);
            });
            gizmoRow.append(btn);
            gizmoBtns.set(mode, btn);
        });
        // Default: translate active
        gizmoBtns.get('translate')?.dom.classList.add('active');
        this.append(gizmoRow);

        // ── transform section (Option B) ─────────────────────────────────────
        const tfSection = new Container({ class: 'panel-header' });
        const tfLabel   = new Label({ class: 'panel-header-label', text: 'Transform' });
        tfSection.append(tfLabel);
        this.append(tfSection);

        const makeRow = (lbl: string) => {
            const row = new Container({ class: 'color-panel-row' });
            row.append(new Label({ text: lbl, class: 'color-panel-row-label' }));
            return row;
        };

        const posRow = makeRow('Position');
        const posVec = new VectorInput({ dimensions: 3, precision: 3,
            placeholder: ['X', 'Y', 'Z'], value: [0, 0, 0], enabled: false });
        posRow.append(posVec);
        this.append(posRow);

        const rotRow = makeRow('Rotation');
        const rotVec = new VectorInput({ dimensions: 3, precision: 1,
            placeholder: ['X', 'Y', 'Z'], value: [0, 0, 0], enabled: false });
        rotRow.append(rotVec);
        this.append(rotRow);

        const sclRow = makeRow('Scale');
        const sclVec = new VectorInput({ dimensions: 3, precision: 3,
            placeholder: ['X', 'Y', 'Z'], value: [1, 1, 1], enabled: false });
        sclRow.append(sclVec);
        this.append(sclRow);

        // ── material editor ─────────────────────────────────────────────────
        const matEditor = new Container({ id: 'mesh-mat-editor' });
        const matHeaderRow = new Container({ class: 'panel-header' });
        const matHeader    = new Label({ class: 'panel-header-label', text: 'Material' });
        const captureBtn   = new Container({ class: 'panel-header-button' });
        captureBtn.dom.textContent = '↺';
        captureBtn.dom.title = 'Capture scene reflection from object position';
        captureBtn.on('click', () => selectedMesh?.captureReflection());
        matHeaderRow.append(matHeader); matHeaderRow.append(captureBtn);
        matEditor.append(matHeaderRow);

        const makeSlider = (min: number, max: number, step: number, value: number) =>
            new SliderInput({ class: 'color-panel-row-slider', min, max, step, value });

        const presetRow    = makeRow('Preset');
        const presetSelect = new SelectInput({
            options: [
                { v: 'glass',   t: 'Glass'   },
                { v: 'mirror',  t: 'Mirror'  },
                { v: 'metal',   t: 'Metal'   },
                { v: 'plastic', t: 'Plastic' },
                { v: 'custom',  t: 'Custom'  },
            ],
            value: 'mirror'
        });
        presetRow.append(presetSelect);
        matEditor.append(presetRow);

        const opacityRow  = makeRow('Opacity');      const opacitySlider = makeSlider(0, 1, 0.01, 1.0);
        const reflRow     = makeRow('Reflectivity'); const reflSlider    = makeSlider(0, 1, 0.01, 1.0);
        const roughRow    = makeRow('Roughness');    const roughSlider   = makeSlider(0, 1, 0.01, 0.0);
        const metalRow    = makeRow('Metalness');    const metalSlider   = makeSlider(0, 1, 0.01, 1.0);

        opacityRow.append(opacitySlider); matEditor.append(opacityRow);
        reflRow.append(reflSlider);       matEditor.append(reflRow);
        roughRow.append(roughSlider);     matEditor.append(roughRow);
        metalRow.append(metalSlider);     matEditor.append(metalRow);
        this.append(matEditor);

        // ── state ───────────────────────────────────────────────────────────
        let selectedMesh: MeshElement | null = null;
        let panelUpdating = false;
        const meshItems = new Map<MeshElement, Container>();

        // ── helpers ─────────────────────────────────────────────────────────
        const setTfEnabled = (on: boolean) => {
            posVec.enabled = rotVec.enabled = sclVec.enabled = on;
        };

        const v3 = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

        const updateTfPanel = (mesh: MeshElement) => {
            panelUpdating = true;
            posVec.value = v3(mesh.getPosition());
            rotVec.value = v3(mesh.getRotationEuler());
            sclVec.value = v3(mesh.getScale());
            panelUpdating = false;
        };

        const selectMesh = (mesh: MeshElement | null) => {
            selectedMesh = mesh;
            meshItems.forEach((item, m) =>
                item.dom.classList.toggle('selected', m === mesh)
            );
            setTfEnabled(!!mesh);
            if (mesh) {
                updateTfPanel(mesh);
                const o = mesh.materialOptions;
                presetSelect.value  = o.preset;
                opacitySlider.value = o.opacity;
                reflSlider.value    = o.reflectivity;
                roughSlider.value   = o.roughness;
                metalSlider.value   = o.metalness;
            }
            events.fire('mesh.selected', mesh);
        };

        const addMeshItem = (mesh: MeshElement) => {
            const item   = new Container({ class: ['splat-item', 'visible'] });
            const text   = new Label({ class: 'splat-item-text', text: mesh.name });
            const visBtn = new Container({ class: 'splat-item-visible' });
            visBtn.dom.textContent = '👁';
            visBtn.dom.title = 'Toggle visibility';
            const delBtn = new Container({ class: 'splat-item-delete' });
            delBtn.dom.textContent = '✕';
            delBtn.dom.title = 'Remove';

            item.append(text); item.append(visBtn); item.append(delBtn);
            listContainer.append(item);
            meshItems.set(mesh, item);

            item.on('click', () => selectMesh(mesh));

            visBtn.on('click', (e: Event) => {
                e.stopPropagation();
                mesh.visible = !mesh.visible;
            });

            delBtn.on('click', (e: Event) => {
                e.stopPropagation();
                if (selectedMesh === mesh) selectMesh(null);
                meshItems.delete(mesh);
                item.destroy();
                events.fire('mesh.removed', mesh);
                mesh.destroy();
            });
        };

        // ── transform inputs → mesh ─────────────────────────────────────────
        const applyPos = () => {
            if (panelUpdating || !selectedMesh) return;
            const [x, y, z] = posVec.value as number[];
            selectedMesh.setPosition(new Vec3(x, y, z));
            events.fire('mesh.transform.changed', selectedMesh);
        };
        const applyRot = () => {
            if (panelUpdating || !selectedMesh) return;
            const [x, y, z] = rotVec.value as number[];
            selectedMesh.setRotationEuler(new Vec3(x, y, z));
            events.fire('mesh.transform.changed', selectedMesh);
        };
        const applySclVec = () => {
            if (panelUpdating || !selectedMesh) return;
            const [x, y, z] = sclVec.value as number[];
            selectedMesh.setScale(new Vec3(x, y, z));
            events.fire('mesh.transform.changed', selectedMesh);
        };

        posVec.inputs.forEach(i => i.on('change', applyPos));
        rotVec.inputs.forEach(i => i.on('change', applyRot));
        sclVec.inputs.forEach(i => i.on('change', applySclVec));

        // ── material inputs → mesh ──────────────────────────────────────────
        const applyMat = () => {
            if (!selectedMesh) return;
            selectedMesh.setMaterialOptions({
                preset:       presetSelect.value as MeshMaterialPreset,
                opacity:      opacitySlider.value,
                reflectivity: reflSlider.value,
                roughness:    roughSlider.value,
                metalness:    metalSlider.value,
            });
        };

        presetSelect.on('change', (v: string) => {
            selectedMesh?.setMaterialOptions({ preset: v as MeshMaterialPreset });
            if (selectedMesh) {
                const o = selectedMesh.materialOptions;
                opacitySlider.value = o.opacity;
                reflSlider.value    = o.reflectivity;
                roughSlider.value   = o.roughness;
                metalSlider.value   = o.metalness;
            }
        });
        opacitySlider.on('change', applyMat);
        reflSlider.on('change', applyMat);
        roughSlider.on('change', applyMat);
        metalSlider.on('change', applyMat);

        // ── event listeners ─────────────────────────────────────────────────

        // new mesh created (placement or import)
        events.on('mesh.added', (mesh: MeshElement) => {
            addMeshItem(mesh);
            selectMesh(mesh);
        });

        // gizmo moved the mesh → sync panel
        events.on('mesh.transform.changed', (mesh: MeshElement) => {
            if (mesh === selectedMesh) updateTfPanel(mesh);
        });

        // click-selection from viewport
        events.on('mesh.select', (mesh: MeshElement | null) => {
            selectMesh(mesh);
        });

        // keyboard shortcuts for gizmo mode
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (!selectedMesh) return;
            if (e.target instanceof HTMLInputElement) return;
            if (e.key === 't' || e.key === 'T') {
                gizmoBtns.forEach((b, m) => b.dom.classList.toggle('active', m === 'translate'));
                events.fire('mesh.gizmo.mode', 'translate');
            } else if (e.key === 'r' || e.key === 'R') {
                gizmoBtns.forEach((b, m) => b.dom.classList.toggle('active', m === 'rotate'));
                events.fire('mesh.gizmo.mode', 'rotate');
            } else if (e.key === 's' || e.key === 'S') {
                gizmoBtns.forEach((b, m) => b.dom.classList.toggle('active', m === 'scale'));
                events.fire('mesh.gizmo.mode', 'scale');
            } else if (e.key === 'Escape') {
                events.fire('mesh.cancelPlace');
            }
        });
    }
}

export { MeshPanel };
