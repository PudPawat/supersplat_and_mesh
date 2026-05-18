import { Container, Label, SelectInput, SliderInput, VectorInput } from '@playcanvas/pcui';
import { Vec3 } from 'playcanvas';

import { Events } from '../events';
import { MeshElement, MeshMaterialPreset } from '../mesh-element';
import { Tooltips } from './tooltips';

// ─────────────────────────────────────────────────────────────────────────────
// MeshPanel — expandable bottom tab panel (same pattern as TimelinePanel /
// DataPanel).  Hidden by default; shown when the MESH tab in the status bar
// is toggled.
// ─────────────────────────────────────────────────────────────────────────────

class MeshPanel extends Container {
    constructor(events: Events, _tooltips: Tooltips, args = {}) {
        args = { ...args, id: 'mesh-panel' };
        super(args);

        // Prevent clicks / scroll from reaching the canvas / camera controller
        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach(n =>
            this.dom.addEventListener(n, (e: Event) => e.stopPropagation())
        );

        // ── tiny helpers ────────────────────────────────────────────────────

        // icon/text button
        const iconBtn = (icon: string, title: string): HTMLElement => {
            const b = document.createElement('div');
            b.className = 'mesh-btn';
            b.textContent = icon;
            b.title = title;
            return b;
        };

        // small caps label
        const capsLabel = (text: string): HTMLElement => {
            const l = document.createElement('span');
            l.className = 'mesh-caps';
            l.textContent = text;
            return l;
        };

        // thin vertical separator
        const sep = (): HTMLElement => {
            const d = document.createElement('div');
            d.className = 'mesh-sep';
            return d;
        };

        // group wrapper
        const group = (id?: string): HTMLElement => {
            const g = document.createElement('div');
            g.className = 'mesh-group';
            if (id) g.id = id;
            return g;
        };

        // ── ROW 1: Add + Objects + Mode ─────────────────────────────────────
        const row1 = document.createElement('div');
        row1.className = 'mesh-row';

        // ── group: Add shapes ──
        const addGrp = group();
        addGrp.appendChild(capsLabel('Add'));

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
            btn.addEventListener('click', () => events.fire('mesh.beginPlace', type));
            addGrp.appendChild(btn);
        });

        const importBtn = iconBtn('+', 'Import GLB / GLTF file');
        importBtn.classList.add('mesh-btn-accent');
        importBtn.style.fontSize = '18px';
        importBtn.addEventListener('click', () => events.fire('mesh.import'));
        addGrp.appendChild(importBtn);

        const carBtn = iconBtn('🚗', 'Load Audi R8 sample car');
        carBtn.style.fontSize = '17px';
        carBtn.addEventListener('click', () => {
            const url = new URL('./static/assets/audi_r8.glb', document.baseURI).toString();
            events.fire('mesh.importUrl', url, 'audi_r8.glb', 'Audi R8');
        });
        addGrp.appendChild(carBtn);

        row1.appendChild(addGrp);
        row1.appendChild(sep());

        // ── group: Object list ──
        const objGrp = group('mesh-obj-grp');
        objGrp.appendChild(capsLabel('Objects'));

        const listScroll = document.createElement('div');
        listScroll.id = 'mesh-obj-list';
        objGrp.appendChild(listScroll);

        row1.appendChild(objGrp);
        row1.appendChild(sep());

        // ── group: Gizmo mode ──
        const modeGrp = group();
        modeGrp.appendChild(capsLabel('Mode'));

        const gizmoModes = [
            { mode: 'translate', icon: '✥', title: 'Move (T)'   },
            { mode: 'rotate',    icon: '↻', title: 'Rotate (R)' },
            { mode: 'scale',     icon: '⇲', title: 'Scale (S)'  },
        ];
        const modeBtns = new Map<string, HTMLElement>();

        gizmoModes.forEach(({ mode, icon, title }) => {
            const btn = iconBtn(icon, title);
            btn.addEventListener('click', () => {
                modeBtns.forEach((b, m) => b.classList.toggle('active', m === mode));
                events.fire('mesh.gizmo.mode', mode);
            });
            modeGrp.appendChild(btn);
            modeBtns.set(mode, btn);
        });
        modeBtns.get('translate')!.classList.add('active');

        row1.appendChild(modeGrp);
        this.dom.appendChild(row1);

        // ── ROW 2: Transform + Material (hidden until object selected) ───────
        const row2 = document.createElement('div');
        row2.className = 'mesh-row';
        row2.id = 'mesh-row2';
        row2.style.display = 'none';

        // ── group: Transform P / R / S ──
        const tfGrp = group();
        tfGrp.id = 'mesh-tf-grp';

        const makeVecRow = (lbl: string, step: number, def: [number, number, number]): VectorInput => {
            const wrap = document.createElement('div');
            wrap.className = 'mesh-tf-row';
            const l = document.createElement('span');
            l.className = 'mesh-tf-lbl';
            l.textContent = lbl;
            wrap.appendChild(l);
            const vec = new VectorInput({ dimensions: 3, precision: 3, step, placeholder: ['X', 'Y', 'Z'], value: def, enabled: false });
            vec.dom.classList.add('mesh-vec');
            wrap.appendChild(vec.dom);
            tfGrp.appendChild(wrap);
            return vec;
        };

        const posVec = makeVecRow('P', 0.01, [0, 0, 0]);
        const rotVec = makeVecRow('R', 1,    [0, 0, 0]);
        const sclVec = makeVecRow('S', 0.01, [1, 1, 1]);

        row2.appendChild(tfGrp);
        row2.appendChild(sep());

        // ── group: Material ──
        const matGrp = group();
        matGrp.id = 'mesh-mat-grp';
        matGrp.appendChild(capsLabel('Material'));

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
        presetSelect.dom.style.width = '75px';
        matGrp.appendChild(presetSelect.dom);

        const makeSlider = (lbl: string, min: number, max: number, val: number): SliderInput => {
            const col = document.createElement('div');
            col.className = 'mesh-slider-col';
            const l = document.createElement('span');
            l.className = 'mesh-slider-lbl';
            l.textContent = lbl;
            col.appendChild(l);
            const s = new SliderInput({ min, max, step: 0.01, value: val });
            s.dom.classList.add('mesh-slider');
            col.appendChild(s.dom);
            matGrp.appendChild(col);
            return s;
        };

        const opacitySlider = makeSlider('Opacity', 0, 1, 1.0);
        const reflSlider    = makeSlider('Reflect',  0, 1, 1.0);
        const roughSlider   = makeSlider('Rough',    0, 1, 0.0);
        const metalSlider   = makeSlider('Metal',    0, 1, 1.0);

        const captureBtn = iconBtn('↺', 'Re-capture reflection');
        captureBtn.addEventListener('click', () => selectedMesh?.captureReflection());
        matGrp.appendChild(captureBtn);

        row2.appendChild(matGrp);
        this.dom.appendChild(row2);

        // ── STATE ────────────────────────────────────────────────────────────
        let selectedMesh: MeshElement | null = null;
        let panelUpdating = false;
        const meshItems = new Map<MeshElement, HTMLElement>();

        const showRow2 = (on: boolean) => {
            row2.style.display = on ? 'flex' : 'none';
            posVec.enabled = rotVec.enabled = sclVec.enabled = on;
        };

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
            meshItems.forEach((chip, m) => chip.classList.toggle('active', m === mesh));
            showRow2(!!mesh);
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

        // ── Object chip ──────────────────────────────────────────────────────
        const addMeshChip = (mesh: MeshElement) => {
            const chip = document.createElement('div');
            chip.className = 'mesh-chip';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'mesh-chip-name';
            nameSpan.textContent = mesh.name;

            const visBtn = document.createElement('span');
            visBtn.className = 'mesh-chip-btn';
            visBtn.textContent = '👁';
            visBtn.title = 'Toggle visibility';

            const delBtn = document.createElement('span');
            delBtn.className = 'mesh-chip-btn';
            delBtn.textContent = '✕';
            delBtn.title = 'Remove';

            chip.appendChild(nameSpan);
            chip.appendChild(visBtn);
            chip.appendChild(delBtn);
            listScroll.appendChild(chip);
            meshItems.set(mesh, chip);

            chip.addEventListener('click', () => selectMesh(mesh));
            visBtn.addEventListener('click', (e: Event) => {
                e.stopPropagation();
                mesh.visible = !mesh.visible;
                visBtn.style.opacity = mesh.visible ? '1' : '0.3';
            });
            delBtn.addEventListener('click', (e: Event) => {
                e.stopPropagation();
                if (selectedMesh === mesh) selectMesh(null);
                meshItems.delete(mesh);
                chip.remove();
                events.fire('mesh.removed', mesh);
                mesh.destroy();
            });
        };

        // ── Transform → mesh ─────────────────────────────────────────────────
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

        // ── Material → mesh ───────────────────────────────────────────────────
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

        // ── Event wiring ──────────────────────────────────────────────────────
        events.on('mesh.added', (mesh: MeshElement) => { addMeshChip(mesh); selectMesh(mesh); });
        events.on('mesh.transform.changed', (mesh: MeshElement) => { if (mesh === selectedMesh) updateTf(mesh); });
        events.on('mesh.select', (mesh: MeshElement | null) => selectMesh(mesh));

        // Keyboard shortcuts (T/R/S for gizmo mode, Escape to cancel placement)
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement) return;
            const k = e.key.toLowerCase();
            if      (k === 't') { modeBtns.get('translate')?.click(); }
            else if (k === 'r') { modeBtns.get('rotate')?.click(); }
            else if (k === 's') { modeBtns.get('scale')?.click(); }
            else if (e.key === 'Escape') { events.fire('mesh.cancelPlace'); }
        });
    }
}

export { MeshPanel };
