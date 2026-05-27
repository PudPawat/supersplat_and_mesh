import { Container, Label, SelectInput, SliderInput, VectorInput } from '@playcanvas/pcui';
import { Vec3 } from 'playcanvas';

import { Events } from '../events';
import { MeshElement, MeshMaterialPreset } from '../mesh-element';
import { Tooltips } from './tooltips';

// ─────────────────────────────────────────────────────────────────────────────
// MeshPanel — vertical scrollable panel, shown when MESH tab is active.
// Sections: Add Shapes | Objects | Gizmo Mode | Transform | Material
// ─────────────────────────────────────────────────────────────────────────────

class MeshPanel extends Container {
    constructor(events: Events, _tooltips: Tooltips, args = {}) {
        args = { ...args, id: 'mesh-panel' };
        super(args);

        // Stop pointer events from leaking to the canvas
        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach(n =>
            this.dom.addEventListener(n, (e: Event) => e.stopPropagation())
        );

        // ── Helpers ─────────────────────────────────────────────────────────

        // Small caps section heading
        const heading = (text: string): HTMLElement => {
            const h = document.createElement('div');
            h.className = 'mp-heading';
            h.textContent = text;
            return h;
        };

        // Thin horizontal rule between sections
        const rule = (): HTMLElement => {
            const r = document.createElement('div');
            r.className = 'mp-rule';
            return r;
        };

        // Icon / emoji button
        const iconBtn = (icon: string, title: string): HTMLElement => {
            const b = document.createElement('div');
            b.className = 'mp-btn';
            b.textContent = icon;
            b.title = title;
            return b;
        };

        // Scrollable content wrapper (the actual scroller)
        const scroll = document.createElement('div');
        scroll.id = 'mesh-panel-scroll';
        this.dom.appendChild(scroll);

        // Helper: append a section into the scroll area
        const section = (id?: string): HTMLElement => {
            const s = document.createElement('div');
            s.className = 'mp-section';
            if (id) s.id = id;
            scroll.appendChild(s);
            return s;
        };

        // ══════════════════════════════════════════════════════════════════════
        // SECTION 1 — Add shapes
        // ══════════════════════════════════════════════════════════════════════
        const addSec = section('mp-add');
        addSec.appendChild(heading('Add Shape'));

        const shapeRow = document.createElement('div');
        shapeRow.className = 'mp-btn-row';

        const shapes = [
            { type: 'sphere',   icon: '⬤',  title: 'Sphere'   },
            { type: 'box',      icon: '⬛',  title: 'Box'      },
            { type: 'cylinder', icon: '⬭',  title: 'Cylinder' },
            { type: 'cone',     icon: '▲',  title: 'Cone'     },
            { type: 'bullet',   icon: '🔫', title: 'Bullet'   },
            { type: 'wave',     icon: '〰', title: 'Wave'     },
        ];

        shapes.forEach(({ type, icon, title }) => {
            const btn = iconBtn(icon, `Place ${title}`);
            const lbl = document.createElement('span');
            lbl.className = 'mp-btn-label';
            lbl.textContent = title;
            const wrap = document.createElement('div');
            wrap.className = 'mp-shape-wrap';
            wrap.appendChild(btn);
            wrap.appendChild(lbl);
            wrap.addEventListener('click', () => events.fire('mesh.beginPlace', type));
            shapeRow.appendChild(wrap);
        });
        addSec.appendChild(shapeRow);

        // Import + Car buttons
        const importRow = document.createElement('div');
        importRow.className = 'mp-btn-row';

        const importBtn = iconBtn('+', 'Import GLB / GLTF file');
        importBtn.classList.add('mp-btn-accent');
        importBtn.style.fontSize = '20px';
        const importLbl = document.createElement('span');
        importLbl.className = 'mp-btn-label';
        importLbl.textContent = 'Import';
        const importWrap = document.createElement('div');
        importWrap.className = 'mp-shape-wrap';
        importWrap.appendChild(importBtn);
        importWrap.appendChild(importLbl);
        importWrap.addEventListener('click', () => events.fire('mesh.import'));

        const carBtn = iconBtn('🚗', 'Load Audi R8 sample car');
        carBtn.style.fontSize = '18px';
        const carLbl = document.createElement('span');
        carLbl.className = 'mp-btn-label';
        carLbl.textContent = 'Audi R8';
        const carWrap = document.createElement('div');
        carWrap.className = 'mp-shape-wrap';
        carWrap.appendChild(carBtn);
        carWrap.appendChild(carLbl);
        carWrap.addEventListener('click', () => {
            const url = new URL('./static/assets/audi_r8.glb', document.baseURI).toString();
            events.fire('mesh.importUrl', url, 'audi_r8.glb', 'Audi R8');
        });

        importRow.appendChild(importWrap);
        importRow.appendChild(carWrap);
        addSec.appendChild(importRow);

        // ══════════════════════════════════════════════════════════════════════
        // SECTION 2 — Objects
        // ══════════════════════════════════════════════════════════════════════
        scroll.appendChild(rule());
        const objSec = section('mp-objects');
        objSec.appendChild(heading('Objects'));

        const objList = document.createElement('div');
        objList.id = 'mp-obj-list';
        objSec.appendChild(objList);

        // ══════════════════════════════════════════════════════════════════════
        // SECTION 3 — Gizmo mode
        // ══════════════════════════════════════════════════════════════════════
        scroll.appendChild(rule());
        const modeSec = section('mp-mode');
        modeSec.appendChild(heading('Gizmo Mode'));

        const modeRow = document.createElement('div');
        modeRow.className = 'mp-btn-row';

        const gizmoModes = [
            { mode: 'translate', icon: '✥', label: 'Move'   },
            { mode: 'rotate',    icon: '↻', label: 'Rotate' },
            { mode: 'scale',     icon: '⇲', label: 'Scale'  },
        ];
        const modeBtns = new Map<string, HTMLElement>();

        gizmoModes.forEach(({ mode, icon, label }) => {
            const btn = iconBtn(icon, `${label} (${label[0]})`);
            const lbl = document.createElement('span');
            lbl.className = 'mp-btn-label';
            lbl.textContent = label;
            const wrap = document.createElement('div');
            wrap.className = 'mp-shape-wrap';
            wrap.appendChild(btn);
            wrap.appendChild(lbl);
            wrap.addEventListener('click', () => {
                modeBtns.forEach((b, m) => {
                    b.classList.toggle('active', m === mode);
                });
                events.fire('mesh.gizmo.mode', mode);
            });
            modeRow.appendChild(wrap);
            modeBtns.set(mode, btn);
        });
        modeBtns.get('translate')!.classList.add('active');
        modeSec.appendChild(modeRow);

        // ══════════════════════════════════════════════════════════════════════
        // SECTION 4 — Reflection (always visible — global settings)
        // ══════════════════════════════════════════════════════════════════════
        scroll.appendChild(rule());
        const reflSec = section('mp-refl');
        reflSec.appendChild(heading('Reflection'));

        // ── Reflection mode toggle (SSR vs Probe) ────────────────────────────
        const reflModeRow = document.createElement('div');
        reflModeRow.className = 'mp-field-row';
        const reflModeLbl = document.createElement('span');
        reflModeLbl.className = 'mp-field-lbl';
        reflModeLbl.textContent = 'Mode';
        reflModeLbl.title = 'SSR = Screen-Space (real-time). Probe = Cubemap capture (accurate, angle-independent).';
        reflModeRow.appendChild(reflModeLbl);

        // Two-button toggle: [SSR]  [Probe]
        const reflModeWrap = document.createElement('div');
        reflModeWrap.style.cssText = 'display:flex;gap:4px;flex:1;';
        const ssrBtn = document.createElement('div');
        ssrBtn.className = 'mp-mode-btn active';
        ssrBtn.textContent = 'SSR';
        ssrBtn.title = 'Screen-Space Reflections (real-time, may miss off-screen objects)';
        const probeBtn = document.createElement('div');
        probeBtn.className = 'mp-mode-btn';
        probeBtn.textContent = 'Probe';
        probeBtn.title = 'Cubemap probe capture (full 360°, click Re-capture to update)';
        reflModeWrap.appendChild(ssrBtn);
        reflModeWrap.appendChild(probeBtn);
        reflModeRow.appendChild(reflModeWrap);
        reflSec.appendChild(reflModeRow);

        // ── Probe shape toggle (Cube / Sphere) — shown only in probe mode ────
        const probeShapeRow = document.createElement('div');
        probeShapeRow.className = 'mp-field-row';
        const probeShapeLbl = document.createElement('span');
        probeShapeLbl.className = 'mp-field-lbl';
        probeShapeLbl.textContent = 'Probe Shape';
        probeShapeLbl.title = 'Cube: 6 axis-aligned faces (fast). Sphere: higher resolution + more samples (slower, smoother on curved surfaces).';
        probeShapeRow.appendChild(probeShapeLbl);

        const probeShapeWrap = document.createElement('div');
        probeShapeWrap.style.cssText = 'display:flex;gap:4px;flex:1;';
        const cubeShapeBtn = document.createElement('div');
        cubeShapeBtn.className = 'mp-mode-btn active';
        cubeShapeBtn.textContent = 'Cube';
        cubeShapeBtn.title = '6 axis-aligned captures, 256px faces — fast';
        const sphereShapeBtn = document.createElement('div');
        sphereShapeBtn.className = 'mp-mode-btn';
        sphereShapeBtn.textContent = 'Sphere';
        sphereShapeBtn.title = '6 captures, 512px faces, 16× samples — smoother on curved surfaces';
        probeShapeWrap.appendChild(cubeShapeBtn);
        probeShapeWrap.appendChild(sphereShapeBtn);
        probeShapeRow.appendChild(probeShapeWrap);
        reflSec.appendChild(probeShapeRow);

        // Reflection far-clip slider
        const clipRow2 = document.createElement('div');
        clipRow2.className = 'mp-field-row';
        const clipLbl2 = document.createElement('span');
        clipLbl2.className = 'mp-field-lbl';
        clipLbl2.textContent = 'Reflect Clip';
        clipLbl2.title = 'Far clip multiplier used when capturing reflections. Raise this if the reflection has black patches.';
        clipRow2.appendChild(clipLbl2);
        const clipSlider2 = new SliderInput({ min: 1, max: 100, step: 1, value: 5 });
        clipSlider2.dom.classList.add('mp-slider');
        clipRow2.appendChild(clipSlider2.dom);
        reflSec.appendChild(clipRow2);

        // Re-capture button
        const captureRow = document.createElement('div');
        captureRow.className = 'mp-capture-row';
        const captureBtn = document.createElement('div');
        captureBtn.className = 'mp-capture-btn';
        captureBtn.textContent = '↺  Re-capture Reflection';
        captureBtn.addEventListener('click', () => selectedMesh?.captureReflection());
        captureRow.appendChild(captureBtn);
        reflSec.appendChild(captureRow);

        // ══════════════════════════════════════════════════════════════════════
        // SECTION 5 — Transform (hidden until object selected)
        // ══════════════════════════════════════════════════════════════════════
        scroll.appendChild(rule());
        const tfSec = section('mp-tf');
        tfSec.appendChild(heading('Transform'));

        const makeVecRow = (lbl: string, step: number, def: [number, number, number]): VectorInput => {
            const row = document.createElement('div');
            row.className = 'mp-vec-row';
            const l = document.createElement('span');
            l.className = 'mp-vec-lbl';
            l.textContent = lbl;
            row.appendChild(l);
            const vec = new VectorInput({ dimensions: 3, precision: 3, step, placeholder: ['X', 'Y', 'Z'], value: def, enabled: false });
            vec.dom.classList.add('mp-vec');
            row.appendChild(vec.dom);
            tfSec.appendChild(row);
            return vec;
        };

        const posVec = makeVecRow('Position', 0.01, [0, 0, 0]);
        const rotVec = makeVecRow('Rotation', 1,    [0, 0, 0]);
        const sclVec = makeVecRow('Scale',    0.01, [1, 1, 1]);

        // ══════════════════════════════════════════════════════════════════════
        // SECTION 6 — Material (hidden until object selected)
        // ══════════════════════════════════════════════════════════════════════
        scroll.appendChild(rule());
        const matSec = section('mp-mat');
        matSec.appendChild(heading('Material'));

        // Preset row
        const presetRow = document.createElement('div');
        presetRow.className = 'mp-field-row';
        const presetLbl = document.createElement('span');
        presetLbl.className = 'mp-field-lbl';
        presetLbl.textContent = 'Preset';
        const presetSelect = new SelectInput({
            options: [
                { v: 'original', t: 'Original (GLB)' },
                { v: 'glass',    t: 'Glass'   },
                { v: 'mirror',   t: 'Mirror'  },
                { v: 'metal',    t: 'Metal'   },
                { v: 'plastic',  t: 'Plastic' },
                { v: 'gold',     t: 'Gold'    },
                { v: 'wave',     t: 'Wave'    },
                { v: 'custom',   t: 'Custom'  },
            ],
            value: 'mirror',
        });
        presetSelect.dom.classList.add('mp-select');
        presetRow.appendChild(presetLbl);
        presetRow.appendChild(presetSelect.dom);
        matSec.appendChild(presetRow);

        // Slider factory
        const makeSlider = (lbl: string, min: number, max: number, val: number): SliderInput => {
            const row = document.createElement('div');
            row.className = 'mp-field-row';
            const l = document.createElement('span');
            l.className = 'mp-field-lbl';
            l.textContent = lbl;
            row.appendChild(l);
            const s = new SliderInput({ min, max, step: 0.01, value: val });
            s.dom.classList.add('mp-slider');
            row.appendChild(s.dom);
            matSec.appendChild(row);
            return s;
        };

        const opacitySlider = makeSlider('Opacity',     0, 1, 1.0);
        const reflSlider    = makeSlider('Reflectivity', 0, 1, 1.0);
        const roughSlider   = makeSlider('Roughness',   0, 1, 0.0);
        const metalSlider   = makeSlider('Metalness',   0, 1, 1.0);

        // ── STATE ────────────────────────────────────────────────────────────
        let selectedMesh: MeshElement | null = null;
        let panelUpdating = false;
        const meshItems = new Map<MeshElement, HTMLElement>();

        const showTfMat = (on: boolean) => {
            tfSec.style.display  = on ? '' : 'none';
            matSec.style.display = on ? '' : 'none';
            posVec.enabled = rotVec.enabled = sclVec.enabled = on;
        };
        showTfMat(false);
        // reflSec is always visible — no hide call needed

        const v3 = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

        const updateTf = (mesh: MeshElement) => {
            panelUpdating = true;
            posVec.value = v3(mesh.getPosition());
            rotVec.value = v3(mesh.getRotationEuler());
            sclVec.value = v3(mesh.getScale());
            panelUpdating = false;
        };

        // Defined here (before selectMesh) so selectMesh can call it.
        const setProbeShape = (shape: 'cube' | 'sphere') => {
            cubeShapeBtn.classList.toggle('active', shape === 'cube');
            sphereShapeBtn.classList.toggle('active', shape === 'sphere');
        };

        const selectMesh = (mesh: MeshElement | null) => {
            selectedMesh = mesh;
            meshItems.forEach((chip, m) => chip.classList.toggle('active', m === mesh));
            showTfMat(!!mesh);
            if (mesh) {
                updateTf(mesh);
                const o = mesh.materialOptions;
                presetSelect.value  = o.preset;
                opacitySlider.value = o.opacity;
                reflSlider.value    = o.reflectivity;
                roughSlider.value   = o.roughness;
                metalSlider.value   = o.metalness;
                // sync probe shape toggle to the current global shape
                setProbeShape(events.invoke('mesh.probeShape') ?? 'cube');
            }
            events.fire('mesh.selected', mesh);
        };

        // ── Object row in the Objects section ────────────────────────────────
        const addMeshRow = (mesh: MeshElement) => {
            const row = document.createElement('div');
            row.className = 'mp-obj-row';

            const icon = document.createElement('span');
            icon.className = 'mp-obj-icon';
            icon.textContent = mesh.name.toLowerCase().includes('audi') ? '🚗' :
                               mesh.name.toLowerCase().includes('bullet') ? '🔫' :
                               mesh.name.toLowerCase().includes('wave') ? '〰' : '◈';

            const name = document.createElement('span');
            name.className = 'mp-obj-name';
            name.textContent = mesh.name;

            const visBtn = document.createElement('span');
            visBtn.className = 'mp-obj-btn';
            visBtn.textContent = '👁';
            visBtn.title = 'Toggle visibility';

            const delBtn = document.createElement('span');
            delBtn.className = 'mp-obj-btn mp-obj-del';
            delBtn.textContent = '✕';
            delBtn.title = 'Remove';

            row.appendChild(icon);
            row.appendChild(name);
            row.appendChild(visBtn);
            row.appendChild(delBtn);
            objList.appendChild(row);
            meshItems.set(mesh, row);

            row.addEventListener('click', () => selectMesh(mesh));
            visBtn.addEventListener('click', (e: Event) => {
                e.stopPropagation();
                mesh.visible = !mesh.visible;
                visBtn.style.opacity = mesh.visible ? '1' : '0.35';
            });
            delBtn.addEventListener('click', (e: Event) => {
                e.stopPropagation();
                if (selectedMesh === mesh) selectMesh(null);
                meshItems.delete(mesh);
                row.remove();
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

        // Reflect Clip → drives the camera far-clip multiplier used during probe capture
        clipSlider2.on('change', (value: number) => {
            events.fire('camera.setClipFarMult', value);
        });
        // Keep in sync if changed from View panel
        events.on('camera.clipFarMult', (value: number) => {
            clipSlider2.value = value;
        });

        // ── Reflection mode toggle wiring ─────────────────────────────────────
        const setReflMode = (mode: 'ssr' | 'probe') => {
            ssrBtn.classList.toggle('active', mode === 'ssr');
            probeBtn.classList.toggle('active', mode === 'probe');
            // Re-capture + clip slider + probe shape only relevant in probe mode
            const probeOnly = mode === 'probe' ? '' : 'none';
            captureRow.style.display    = probeOnly;
            clipRow2.style.display      = probeOnly;
            probeShapeRow.style.display = probeOnly;
        };

        ssrBtn.addEventListener('click', () => {
            events.fire('mesh.setReflectionMode', 'ssr');
        });
        probeBtn.addEventListener('click', () => {
            events.fire('mesh.setReflectionMode', 'probe');
        });

        events.on('mesh.reflectionMode.changed', (mode: string) => {
            setReflMode(mode as 'ssr' | 'probe');
        });

        // Initialise from current global mode
        const initMode: string = events.invoke('mesh.reflectionMode') ?? 'ssr';
        setReflMode(initMode as 'ssr' | 'probe');

        // Initialise probe shape toggle
        const initShape: string = events.invoke('mesh.probeShape') ?? 'cube';
        setProbeShape(initShape as 'cube' | 'sphere');

        // ── Probe shape toggle wiring ─────────────────────────────────────────
        cubeShapeBtn.addEventListener('click', () => {
            events.fire('mesh.setProbeShape', 'cube');
        });
        sphereShapeBtn.addEventListener('click', () => {
            events.fire('mesh.setProbeShape', 'sphere');
        });

        events.on('mesh.probeShape.changed', (shape: string) => {
            setProbeShape(shape as 'cube' | 'sphere');
        });

        // ── Events ────────────────────────────────────────────────────────────
        events.on('mesh.added', (mesh: MeshElement) => { addMeshRow(mesh); selectMesh(mesh); });
        events.on('mesh.transform.changed', (mesh: MeshElement) => { if (mesh === selectedMesh) updateTf(mesh); });
        events.on('mesh.select', (mesh: MeshElement | null) => selectMesh(mesh));

        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement) return;
            const k = e.key.toLowerCase();
            if      (k === 't') modeBtns.get('translate')?.click();
            else if (k === 'r') modeBtns.get('rotate')?.click();
            else if (k === 's') modeBtns.get('scale')?.click();
            else if (e.key === 'Escape') events.fire('mesh.cancelPlace');
        });
    }
}

export { MeshPanel };
