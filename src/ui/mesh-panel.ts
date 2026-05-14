import { Container, Label, SelectInput, SliderInput } from '@playcanvas/pcui';

import { Events } from '../events';
import { MeshElement, MeshMaterialPreset } from '../mesh-element';
import { Tooltips } from './tooltips';

class MeshPanel extends Container {
    constructor(events: Events, tooltips: Tooltips, args = {}) {
        args = {
            ...args,
            id: 'mesh-panel',
            class: 'panel'
        };

        super(args);

        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach((name) => {
            this.dom.addEventListener(name, (e: Event) => e.stopPropagation());
        });

        // ── header ─────────────────────────────────────────────────────────────
        const header = new Container({ class: 'panel-header' });
        const icon  = new Label({ class: 'panel-header-icon', text: '' });
        const label = new Label({ class: 'panel-header-label', text: 'Mesh Objects' });

        const importBtn = new Container({ class: 'panel-header-button' });
        importBtn.dom.textContent = '+';
        importBtn.dom.title = 'Import GLB/GLTF file';
        importBtn.on('click', () => events.fire('mesh.import'));

        header.append(icon);
        header.append(label);
        header.append(importBtn);
        this.append(header);

        // ── primitive shape buttons ────────────────────────────────────────────
        const primRow = new Container({ class: 'mesh-prim-row' });
        const primLabel = new Label({ class: 'mesh-prim-label', text: 'Add shape:' });
        primRow.append(primLabel);

        const shapes = [
            { type: 'sphere',   icon: '⬤' },
            { type: 'box',      icon: '⬛' },
            { type: 'cylinder', icon: '⬭' },
            { type: 'cone',     icon: '▲' },
        ];
        shapes.forEach(({ type, icon }) => {
            const btn = new Container({ class: 'mesh-prim-btn' });
            btn.dom.textContent = icon;
            btn.dom.title = type;
            btn.on('click', () => events.fire('mesh.addPrimitive', type));
            primRow.append(btn);
        });
        this.append(primRow);

        // ── mesh list ──────────────────────────────────────────────────────────
        const listContainer = new Container({ id: 'mesh-list' });
        this.append(listContainer);

        // ── material editor ────────────────────────────────────────────────────
        const matEditor = new Container({ id: 'mesh-mat-editor' });

        const matHeaderRow = new Container({ class: 'panel-header' });
        const matHeader = new Label({ class: 'panel-header-label', text: 'Material' });
        const captureBtn = new Container({ class: 'panel-header-button' });
        captureBtn.dom.textContent = '↺';
        captureBtn.dom.title = 'Re-capture scene reflection from object position';
        captureBtn.on('click', () => selectedMesh?.captureReflection());
        matHeaderRow.append(matHeader);
        matHeaderRow.append(captureBtn);
        matEditor.append(matHeaderRow);

        const makeRow = (labelText: string) => {
            const row = new Container({ class: 'color-panel-row' });
            row.append(new Label({ text: labelText, class: 'color-panel-row-label' }));
            return row;
        };
        const makeSlider = (min: number, max: number, step: number, value: number) =>
            new SliderInput({ class: 'color-panel-row-slider', min, max, step, value });

        const presetRow = makeRow('Preset');
        const presetSelect = new SelectInput({
            options: [
                { v: 'glass',   t: 'Glass'   },
                { v: 'mirror',  t: 'Mirror'  },
                { v: 'metal',   t: 'Metal'   },
                { v: 'plastic', t: 'Plastic' },
                { v: 'custom',  t: 'Custom'  }
            ],
            value: 'mirror'
        });
        presetRow.append(presetSelect);
        matEditor.append(presetRow);

        const opacityRow = makeRow('Opacity');
        const opacitySlider = makeSlider(0, 1, 0.01, 0.4);
        opacityRow.append(opacitySlider);
        matEditor.append(opacityRow);

        const reflRow = makeRow('Reflectivity');
        const reflSlider = makeSlider(0, 1, 0.01, 0.9);
        reflRow.append(reflSlider);
        matEditor.append(reflRow);

        const roughRow = makeRow('Roughness');
        const roughSlider = makeSlider(0, 1, 0.01, 0.0);
        roughRow.append(roughSlider);
        matEditor.append(roughRow);

        const metalRow = makeRow('Metalness');
        const metalSlider = makeSlider(0, 1, 0.01, 0.0);
        metalRow.append(metalSlider);
        matEditor.append(metalRow);

        this.append(matEditor);

        // ── state ──────────────────────────────────────────────────────────────
        let selectedMesh: MeshElement | null = null;
        const meshItems = new Map<MeshElement, Container>();

        const selectMesh = (mesh: MeshElement | null) => {
            selectedMesh = mesh;
            meshItems.forEach((item, m) => {
                if (m === mesh) item.class.add('selected');
                else item.class.remove('selected');
            });
            if (mesh) {
                const o = mesh.materialOptions;
                presetSelect.value  = o.preset;
                opacitySlider.value = o.opacity;
                reflSlider.value    = o.reflectivity;
                roughSlider.value   = o.roughness;
                metalSlider.value   = o.metalness;
            }
        };

        const addMeshItem = (mesh: MeshElement) => {
            const item = new Container({ class: ['splat-item', 'visible'] });
            const text = new Label({ class: 'splat-item-text', text: mesh.name });

            const visBtn = new Container({ class: 'splat-item-visible' });
            visBtn.dom.textContent = '👁';
            visBtn.dom.title = 'Toggle visibility';

            const delBtn = new Container({ class: 'splat-item-delete' });
            delBtn.dom.textContent = '✕';
            delBtn.dom.title = 'Remove';

            item.append(text);
            item.append(visBtn);
            item.append(delBtn);
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
                mesh.destroy();
            });
        };

        events.on('mesh.added', (mesh: MeshElement) => {
            addMeshItem(mesh);
            selectMesh(mesh);
            // auto-capture after scene has rendered (1s gives splats time to appear)
            setTimeout(() => mesh.captureReflection(), 1000);
        });

        const applyMat = () => {
            if (!selectedMesh) return;
            selectedMesh.setMaterialOptions({
                preset:       presetSelect.value as MeshMaterialPreset,
                opacity:      opacitySlider.value,
                reflectivity: reflSlider.value,
                roughness:    roughSlider.value,
                metalness:    metalSlider.value
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
    }
}

export { MeshPanel };
