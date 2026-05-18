import { Container, Label, SelectInput, SliderInput, VectorInput } from '@playcanvas/pcui';
import { Vec3 } from 'playcanvas';

import { Events } from '../events';
import { MeshElement, MeshMaterialPreset } from '../mesh-element';
import { Tooltips } from './tooltips';

class MeshPanel extends Container {
    constructor(events: Events, tooltips: Tooltips, args = {}) {
        args = { ...args, id: 'mesh-bar' };
        super(args);

        // PCUI forces position:relative — beat it with inline styles
        Object.assign(this.dom.style, {
            position: 'absolute', left: '0', right: '0', bottom: '0', top: 'auto',
            width: '100%', height: '60px', zIndex: '90',
            display: 'flex', flexDirection: 'row', alignItems: 'center',
            padding: '0 8px', overflow: 'hidden',
            background: '#1a1a1a', borderTop: '1px solid #333', boxSizing: 'border-box',
        });

        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach(n =>
            this.dom.addEventListener(n, (e: Event) => e.stopPropagation())
        );

        // ── helpers ─────────────────────────────────────────────────────────
        const sep = (): void => {
            const d = document.createElement('div');
            Object.assign(d.style, { width: '1px', height: '36px', background: '#333', flexShrink: '0', margin: '0 6px' });
            this.dom.appendChild(d);
        };

        const section = (id?: string): Container => {
            const c = new Container({ class: 'mesh-bar-section' });
            if (id) c.dom.id = id;
            Object.assign(c.dom.style, {
                display: 'flex', flexDirection: 'row', alignItems: 'center',
                gap: '4px', padding: '0 4px', flexShrink: '0',
            });
            return c;
        };

        // single-class icon button — NO spaces in class name
        const iconBtn = (icon: string, title: string, extraClass?: string): Container => {
            const b = new Container({ class: 'mesh-bar-btn' });
            if (extraClass) b.dom.classList.add(extraClass);
            b.dom.textContent = icon;
            b.dom.title = title;
            Object.assign(b.dom.style, {
                width: '28px', height: '28px', borderRadius: '4px',
                background: '#2d2d2d', cursor: 'pointer', fontSize: '13px',
                color: '#b3aaac', display: 'flex', alignItems: 'center',
                justifyContent: 'center', flexShrink: '0', userSelect: 'none',
            });
            b.dom.addEventListener('mouseenter', () => { b.dom.style.background = '#444'; });
            b.dom.addEventListener('mouseleave', () => { b.dom.style.background = b.dom.classList.contains('active') ? '#f60' : '#2d2d2d'; });
            return b;
        };

        const barLabel = (text: string): Label => {
            const l = new Label({ class: 'mesh-bar-label', text });
            Object.assign(l.dom.style, { fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: '0' });
            return l;
        };

        // ══════════════════════════════════════════════════════════════════
        // SECTION 1 — Add shapes
        // ══════════════════════════════════════════════════════════════════
        const addSection = section();
        addSection.append(barLabel('Add'));

        const shapes = [
            { type: 'sphere',   icon: '⬤', title: 'Sphere'   },
            { type: 'box',      icon: '⬛', title: 'Box'      },
            { type: 'cylinder', icon: '⬭', title: 'Cylinder' },
            { type: 'cone',     icon: '▲', title: 'Cone'     },
            { type: 'bullet',   icon: '🔫', title: 'Bullet'  },
            { type: 'wave',     icon: '〰', title: 'Wave'    },
        ];
        shapes.forEach(({ type, icon, title }) => {
            const btn = iconBtn(icon, `Place ${title}`);
            btn.on('click', () => events.fire('mesh.beginPlace', type));
            addSection.append(btn);
        });

        const importBtn = iconBtn('+', 'Import GLB/GLTF');
        importBtn.dom.style.background = '#333';
        importBtn.dom.style.color = '#f60';
        importBtn.on('click', () => events.fire('mesh.import'));
        addSection.append(importBtn);

        const carBtn = iconBtn('🚗', 'Load Audi R8 sample car');
        carBtn.dom.style.background = '#333';
        carBtn.dom.style.fontSize = '16px';
        carBtn.on('click', () => {
            const url = new URL('./static/assets/audi_r8.glb', document.baseURI).toString();
            // filename MUST have .glb so PlayCanvas picks the right container importer
            events.fire('mesh.importUrl', url, 'audi_r8.glb', 'Audi R8');
        });
        addSection.append(carBtn);

        // ══════════════════════════════════════════════════════════════════
        // SECTION 2 — Object list
        // ══════════════════════════════════════════════════════════════════
        const listSection = section('mesh-bar-list-section');
        Object.assign(listSection.dom.style, { flexShrink: '1', overflow: 'hidden', maxWidth: '200px' });
        listSection.append(barLabel('Objects'));

        const listInner = new Container({ id: 'mesh-bar-list' });
        Object.assign(listInner.dom.style, {
            display: 'flex', flexDirection: 'row', gap: '4px',
            overflowX: 'auto', flexShrink: '1', maxWidth: '160px',
        });
        listSection.append(listInner);

        // ══════════════════════════════════════════════════════════════════
        // SECTION 3 — Gizmo mode
        // ══════════════════════════════════════════════════════════════════
        const gizmoSection = section('mesh-bar-gizmo');
        gizmoSection.append(barLabel('Mode'));

        const gizmoModes = [
            { mode: 'translate', icon: '✥', title: 'Move (T)'   },
            { mode: 'rotate',    icon: '↻', title: 'Rotate (R)' },
            { mode: 'scale',     icon: '⇲', title: 'Scale (S)'  },
        ];
        const gizmoBtns = new Map<string, Container>();
        gizmoModes.forEach(({ mode, icon, title }) => {
            const btn = iconBtn(icon, title);
            btn.on('click', () => {
                gizmoBtns.forEach((b, m) => {
                    const active = m === mode;
                    b.dom.classList.toggle('active', active);
                    b.dom.style.background = active ? '#f60' : '#2d2d2d';
                    b.dom.style.color = active ? '#000' : '#b3aaac';
                });
                events.fire('mesh.gizmo.mode', mode);
            });
            gizmoSection.append(btn);
            gizmoBtns.set(mode, btn);
        });
        // default: translate active
        const translateBtn = gizmoBtns.get('translate')!;
        translateBtn.dom.classList.add('active');
        translateBtn.dom.style.background = '#f60';
        translateBtn.dom.style.color = '#000';

        // ══════════════════════════════════════════════════════════════════
        // SECTION 4 — Transform
        // ══════════════════════════════════════════════════════════════════
        const tfSection = section('mesh-bar-tf');
        Object.assign(tfSection.dom.style, { flex: '1 1 auto', gap: '8px' });

        const makeVecRow = (lbl: string, step: number, def: [number, number, number]): VectorInput => {
            const row = new Container({ class: 'mesh-bar-tf-row' });
            Object.assign(row.dom.style, { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '4px' });
            const l = new Label({ text: lbl });
            Object.assign(l.dom.style, { fontSize: '10px', fontWeight: '700', color: '#555', width: '12px', flexShrink: '0' });
            row.append(l);
            const vec = new VectorInput({ dimensions: 3, precision: 3, step, placeholder: ['X', 'Y', 'Z'], value: def, enabled: false });
            row.append(vec);
            tfSection.append(row);
            return vec;
        };

        const posVec = makeVecRow('P', 0.01, [0, 0, 0]);
        const rotVec = makeVecRow('R', 1,    [0, 0, 0]);
        const sclVec = makeVecRow('S', 0.01, [1, 1, 1]);

        // ══════════════════════════════════════════════════════════════════
        // SECTION 5 — Material
        // ══════════════════════════════════════════════════════════════════
        const matSection = section('mesh-bar-mat');
        matSection.append(barLabel('Material'));

        const presetSelect = new SelectInput({
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
        Object.assign(presetSelect.dom.style, { width: '80px' });
        matSection.append(presetSelect);

        const makeSliderCol = (lbl: string, min: number, max: number, val: number): SliderInput => {
            const col = new Container({ class: 'mesh-bar-slider-col' });
            Object.assign(col.dom.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px' });
            const l = new Label({ text: lbl });
            Object.assign(l.dom.style, { fontSize: '9px', color: '#555', textTransform: 'uppercase' });
            col.append(l);
            const s = new SliderInput({ min, max, step: 0.01, value: val });
            Object.assign(s.dom.style, { width: '64px' });
            col.append(s);
            matSection.append(col);
            return s;
        };

        const opacitySlider = makeSliderCol('Opacity', 0, 1, 1.0);
        const reflSlider    = makeSliderCol('Reflect',  0, 1, 1.0);
        const roughSlider   = makeSliderCol('Rough',    0, 1, 0.0);
        const metalSlider   = makeSliderCol('Metal',    0, 1, 1.0);

        const captureBtn = iconBtn('↺', 'Re-capture reflection');
        captureBtn.on('click', () => selectedMesh?.captureReflection());
        matSection.append(captureBtn);

        // ══════════════════════════════════════════════════════════════════
        // ASSEMBLE — append then draw separator
        // ══════════════════════════════════════════════════════════════════
        this.append(addSection);  sep();
        this.append(listSection); sep();
        this.append(gizmoSection); sep();
        this.append(tfSection);   sep();
        this.append(matSection);

        // ══════════════════════════════════════════════════════════════════
        // STATE
        // ══════════════════════════════════════════════════════════════════
        let selectedMesh: MeshElement | null = null;
        let panelUpdating = false;
        const meshItems = new Map<MeshElement, Container>();

        const showSelection = (on: boolean): void => {
            [gizmoSection, tfSection, matSection].forEach(s => { s.dom.style.display = on ? 'flex' : 'none'; });
            posVec.enabled = rotVec.enabled = sclVec.enabled = on;
        };
        showSelection(false);

        const v3 = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

        const updateTf = (mesh: MeshElement): void => {
            panelUpdating = true;
            posVec.value = v3(mesh.getPosition());
            rotVec.value = v3(mesh.getRotationEuler());
            sclVec.value = v3(mesh.getScale());
            panelUpdating = false;
        };

        const selectMesh = (mesh: MeshElement | null): void => {
            selectedMesh = mesh;
            meshItems.forEach((item, m) => {
                item.dom.style.background = m === mesh ? '#f60' : '#2d2d2d';
            });
            showSelection(!!mesh);
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

        const addMeshItem = (mesh: MeshElement): void => {
            const item = new Container({ class: 'mesh-bar-item' });
            Object.assign(item.dom.style, {
                display: 'flex', flexDirection: 'row', alignItems: 'center',
                gap: '3px', background: '#2d2d2d', borderRadius: '4px',
                padding: '2px 5px', cursor: 'pointer', flexShrink: '0',
            });

            const nameLabel = new Label({ text: mesh.name });
            Object.assign(nameLabel.dom.style, { fontSize: '10px', color: '#b3aaac', maxWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

            const visBtn = new Label({ text: '👁' });
            Object.assign(visBtn.dom.style, { cursor: 'pointer', fontSize: '11px' });

            const delBtn = new Label({ text: '✕' });
            Object.assign(delBtn.dom.style, { cursor: 'pointer', fontSize: '11px', color: '#666' });

            item.append(nameLabel);
            item.append(visBtn);
            item.append(delBtn);
            listInner.append(item);
            meshItems.set(mesh, item);

            item.on('click', () => selectMesh(mesh));
            visBtn.dom.addEventListener('click', (e: Event) => {
                e.stopPropagation();
                mesh.visible = !mesh.visible;
                visBtn.dom.style.opacity = mesh.visible ? '1' : '0.3';
            });
            delBtn.dom.addEventListener('click', (e: Event) => {
                e.stopPropagation();
                if (selectedMesh === mesh) selectMesh(null);
                meshItems.delete(mesh);
                item.destroy();
                events.fire('mesh.removed', mesh);
                mesh.destroy();
            });
        };

        // ── transform → mesh ────────────────────────────────────────────────
        const applyPos = (): void => {
            if (panelUpdating || !selectedMesh) return;
            const [x, y, z] = posVec.value as number[];
            selectedMesh.setPosition(new Vec3(x, y, z));
            events.fire('mesh.transform.changed', selectedMesh);
        };
        const applyRot = (): void => {
            if (panelUpdating || !selectedMesh) return;
            const [x, y, z] = rotVec.value as number[];
            selectedMesh.setRotationEuler(new Vec3(x, y, z));
            events.fire('mesh.transform.changed', selectedMesh);
        };
        const applyScl = (): void => {
            if (panelUpdating || !selectedMesh) return;
            const [x, y, z] = sclVec.value as number[];
            selectedMesh.setScale(new Vec3(x, y, z));
            events.fire('mesh.transform.changed', selectedMesh);
        };
        posVec.inputs.forEach(i => i.on('change', applyPos));
        rotVec.inputs.forEach(i => i.on('change', applyRot));
        sclVec.inputs.forEach(i => i.on('change', applyScl));

        // ── material → mesh ─────────────────────────────────────────────────
        const applyMat = (): void => {
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

        // ── events ──────────────────────────────────────────────────────────
        events.on('mesh.added', (mesh: MeshElement) => { addMeshItem(mesh); selectMesh(mesh); });
        events.on('mesh.transform.changed', (mesh: MeshElement) => { if (mesh === selectedMesh) updateTf(mesh); });
        events.on('mesh.select', (mesh: MeshElement | null) => selectMesh(mesh));

        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (!selectedMesh || e.target instanceof HTMLInputElement) return;
            const k = e.key.toLowerCase();
            if      (k === 't') { gizmoBtns.get('translate')?.dom.click(); }
            else if (k === 'r') { gizmoBtns.get('rotate')?.dom.click(); }
            else if (k === 's') { gizmoBtns.get('scale')?.dom.click(); }
            else if (e.key === 'Escape') { events.fire('mesh.cancelPlace'); }
        });
    }
}

export { MeshPanel };
