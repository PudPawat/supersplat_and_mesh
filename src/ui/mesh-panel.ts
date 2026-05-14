import { Container, Label, SelectInput, SliderInput, VectorInput } from '@playcanvas/pcui';
import { Vec3 } from 'playcanvas';

import { Events } from '../events';
import { MeshElement, MeshMaterialPreset } from '../mesh-element';
import { Tooltips } from './tooltips';

class MeshPanel extends Container {
    constructor(events: Events, tooltips: Tooltips, args = {}) {
        args = { ...args, id: 'mesh-bar', class: 'mesh-bar-root' };
        super(args);
        // Force absolute positioning so PCUI doesn't push canvas around
        this.dom.style.position = 'absolute';

        // Prevent canvas from receiving pointer events through this bar
        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach(n =>
            this.dom.addEventListener(n, (e: Event) => e.stopPropagation())
        );

        // ── helper: thin vertical divider ──────────────────────────────────
        const sep = () => new Container({ class: 'mesh-bar-sep' });

        // ── helper: section wrapper ─────────────────────────────────────────
        const section = (id?: string) => {
            const c = new Container({ class: 'mesh-bar-section' });
            if (id) c.dom.id = id;
            return c;
        };

        // ── helper: icon button ─────────────────────────────────────────────
        const iconBtn = (icon: string, title: string, cls = 'mesh-bar-btn') => {
            const b = new Container({ class: cls });
            b.dom.textContent = icon;
            b.dom.title = title;
            return b;
        };

        // ══════════════════════════════════════════════════════════════════
        // SECTION 1 — Add shapes
        // ══════════════════════════════════════════════════════════════════
        const addSection = section();
        addSection.append(new Label({ class: 'mesh-bar-label', text: 'Add' }));

        const shapes = [
            { type: 'sphere',   icon: '⬤',  title: 'Sphere'   },
            { type: 'box',      icon: '⬛',  title: 'Box'      },
            { type: 'cylinder', icon: '⬭',  title: 'Cylinder' },
            { type: 'cone',     icon: '▲',  title: 'Cone'     },
            { type: 'bullet',   icon: '🔫', title: 'Bullet'   },
            { type: 'wave',     icon: '〰', title: 'Wave ring' },
        ];
        shapes.forEach(({ type, icon, title }) => {
            const btn = iconBtn(icon, `Place ${title}`);
            btn.on('click', () => events.fire('mesh.beginPlace', type));
            addSection.append(btn);
        });

        const importBtn = iconBtn('+', 'Import GLB/GLTF', 'mesh-bar-btn mesh-bar-btn-import');
        importBtn.on('click', () => events.fire('mesh.import'));
        addSection.append(importBtn);

        // ══════════════════════════════════════════════════════════════════
        // SECTION 2 — Object list / selection indicator
        // ══════════════════════════════════════════════════════════════════
        const listSection = section('mesh-bar-list-section');
        listSection.append(new Label({ class: 'mesh-bar-label', text: 'Objects' }));
        const listContainer = new Container({ id: 'mesh-bar-list' });
        listSection.append(listContainer);

        // ══════════════════════════════════════════════════════════════════
        // SECTION 3 — Gizmo mode  (hidden until mesh selected)
        // ══════════════════════════════════════════════════════════════════
        const gizmoSection = section('mesh-bar-gizmo');
        gizmoSection.append(new Label({ class: 'mesh-bar-label', text: 'Mode' }));

        const gizmoModes = [
            { mode: 'translate', icon: '✥', title: 'Move (T)'   },
            { mode: 'rotate',    icon: '↻', title: 'Rotate (R)' },
            { mode: 'scale',     icon: '⇲', title: 'Scale (S)'  },
        ];
        const gizmoBtns: Map<string, Container> = new Map();
        gizmoModes.forEach(({ mode, icon, title }) => {
            const btn = iconBtn(icon, title, 'mesh-bar-btn mesh-bar-mode-btn');
            btn.on('click', () => {
                gizmoBtns.forEach((b, m) => b.dom.classList.toggle('active', m === mode));
                events.fire('mesh.gizmo.mode', mode);
            });
            gizmoSection.append(btn);
            gizmoBtns.set(mode, btn);
        });
        gizmoBtns.get('translate')?.dom.classList.add('active');

        // ══════════════════════════════════════════════════════════════════
        // SECTION 4 — Transform  (hidden until mesh selected)
        // ══════════════════════════════════════════════════════════════════
        const tfSection = section('mesh-bar-tf');

        const makeVec = (lbl: string, step = 0.01, def: [number,number,number] = [0,0,0]) => {
            const row = new Container({ class: 'mesh-bar-tf-row' });
            row.append(new Label({ class: 'mesh-bar-tf-label', text: lbl }));
            const vec = new VectorInput({
                dimensions: 3,
                precision: 3,
                step,
                placeholder: ['X','Y','Z'],
                value: def,
                enabled: false,
                class: 'mesh-bar-vec',
            });
            row.append(vec);
            tfSection.append(row);
            return vec;
        };

        const posVec = makeVec('P', 0.01, [0, 0, 0]);
        const rotVec = makeVec('R', 1,    [0, 0, 0]);
        const sclVec = makeVec('S', 0.01, [1, 1, 1]);

        // ══════════════════════════════════════════════════════════════════
        // SECTION 5 — Material  (hidden until mesh selected)
        // ══════════════════════════════════════════════════════════════════
        const matSection = section('mesh-bar-mat');
        matSection.append(new Label({ class: 'mesh-bar-label', text: 'Material' }));

        const presetSelect = new SelectInput({
            class: 'mesh-bar-select',
            options: [
                { v: 'glass',   t: 'Glass'   },
                { v: 'mirror',  t: 'Mirror'  },
                { v: 'metal',   t: 'Metal'   },
                { v: 'plastic', t: 'Plastic' },
                { v: 'gold',    t: 'Gold'    },
                { v: 'wave',    t: 'Wave'    },
                { v: 'custom',  t: 'Custom'  },
            ],
            value: 'mirror',
        });
        matSection.append(presetSelect);

        const makeSlider = (label: string, min: number, max: number, val: number) => {
            const row = new Container({ class: 'mesh-bar-slider-row' });
            row.append(new Label({ class: 'mesh-bar-slider-label', text: label }));
            const s = new SliderInput({ class: 'mesh-bar-slider', min, max, step: 0.01, value: val });
            row.append(s);
            matSection.append(row);
            return s;
        };

        const opacitySlider  = makeSlider('Opacity',      0, 1, 1.0);
        const reflSlider     = makeSlider('Reflect',      0, 1, 1.0);
        const roughSlider    = makeSlider('Rough',        0, 1, 0.0);
        const metalSlider    = makeSlider('Metal',        0, 1, 1.0);

        // capture btn
        const captureBtn = iconBtn('↺', 'Re-capture scene reflection', 'mesh-bar-btn');
        captureBtn.on('click', () => selectedMesh?.captureReflection());
        matSection.append(captureBtn);

        // ══════════════════════════════════════════════════════════════════
        // ASSEMBLE BAR
        // ══════════════════════════════════════════════════════════════════
        this.append(addSection);
        this.append(sep());
        this.append(listSection);
        this.append(sep());
        this.append(gizmoSection);
        this.append(sep());
        this.append(tfSection);
        this.append(sep());
        this.append(matSection);

        // ══════════════════════════════════════════════════════════════════
        // STATE
        // ══════════════════════════════════════════════════════════════════
        let selectedMesh: MeshElement | null = null;
        let panelUpdating = false;
        const meshItems = new Map<MeshElement, Container>();

        const setSelectionVisible = (on: boolean) => {
            gizmoSection.dom.classList.toggle('hidden', !on);
            tfSection.dom.classList.toggle('hidden', !on);
            matSection.dom.classList.toggle('hidden', !on);
            posVec.enabled = rotVec.enabled = sclVec.enabled = on;
        };
        setSelectionVisible(false);

        const v3 = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

        const updateTf = (mesh: MeshElement) => {
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
            setSelectionVisible(!!mesh);
            if (mesh) {
                updateTf(mesh);
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
            const item   = new Container({ class: 'mesh-bar-item' });
            const text   = new Label({ class: 'mesh-bar-item-name', text: mesh.name });
            const visBtn = iconBtn('👁', 'Toggle visibility', 'mesh-bar-item-btn');
            const delBtn = iconBtn('✕', 'Remove',             'mesh-bar-item-btn');

            item.append(text); item.append(visBtn); item.append(delBtn);
            listContainer.append(item);
            meshItems.set(mesh, item);

            item.on('click', () => selectMesh(mesh));
            visBtn.on('click', (e: Event) => {
                e.stopPropagation();
                mesh.visible = !mesh.visible;
                visBtn.dom.style.opacity = mesh.visible ? '1' : '0.35';
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

        // ── transform inputs → mesh ─────────────────────────────────────
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
        const applyScl = () => {
            if (panelUpdating || !selectedMesh) return;
            const [x, y, z] = sclVec.value as number[];
            selectedMesh.setScale(new Vec3(x, y, z));
            events.fire('mesh.transform.changed', selectedMesh);
        };

        posVec.inputs.forEach(i => i.on('change', applyPos));
        rotVec.inputs.forEach(i => i.on('change', applyRot));
        sclVec.inputs.forEach(i => i.on('change', applyScl));

        // ── material inputs → mesh ──────────────────────────────────────
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

        // ── events ──────────────────────────────────────────────────────
        events.on('mesh.added', (mesh: MeshElement) => {
            addMeshItem(mesh);
            selectMesh(mesh);
        });

        events.on('mesh.transform.changed', (mesh: MeshElement) => {
            if (mesh === selectedMesh) updateTf(mesh);
        });

        events.on('mesh.select', (mesh: MeshElement | null) => selectMesh(mesh));

        // keyboard gizmo shortcuts
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (!selectedMesh) return;
            if (e.target instanceof HTMLInputElement) return;
            const k = e.key.toLowerCase();
            if (k === 't') {
                gizmoBtns.forEach((b, m) => b.dom.classList.toggle('active', m === 'translate'));
                events.fire('mesh.gizmo.mode', 'translate');
            } else if (k === 'r') {
                gizmoBtns.forEach((b, m) => b.dom.classList.toggle('active', m === 'rotate'));
                events.fire('mesh.gizmo.mode', 'rotate');
            } else if (k === 's') {
                gizmoBtns.forEach((b, m) => b.dom.classList.toggle('active', m === 'scale'));
                events.fire('mesh.gizmo.mode', 'scale');
            } else if (e.key === 'Escape') {
                events.fire('mesh.cancelPlace');
            }
        });
    }
}

export { MeshPanel };
