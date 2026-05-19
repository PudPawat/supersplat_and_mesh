# SuperSplat Mesh Overlay — Technical Notes

> Branch: `feature/ssr-reflections`  
> Base: SuperSplat v2.25.x (PlayCanvas + PCUI + TypeScript + Rollup)

---

## 1. Project Goal

Add **interactive 3D mesh objects** (primitive shapes + imported GLB models) that render *on top of* a 3D Gaussian Splatting (3DGS) scene with physically-based reflective materials (mirror, glass, gold, metal, plastic, etc.) and a real-time Screen-Space Reflection (SSR) system.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | PlayCanvas 2.x (WebGL 2) |
| UI Components | PCUI (@playcanvas/pcui) |
| Language | TypeScript 5 |
| Bundler | Rollup + `@rollup/plugin-typescript` |
| 3DGS renderer | SuperSplat's custom splat shader + MRT pipeline |
| Shader authoring | GLSL injected via PlayCanvas `StandardMaterial.chunks` |

---

## 3. New Files Added

```
src/
├── mesh-element.ts       # Core mesh class (MeshElement extends Element)
├── mesh-handler.ts       # Event wiring, asset loading, reflection triggers
├── mesh-gizmo.ts         # TranslateGizmo / RotateGizmo / ScaleGizmo manager
├── mesh-placement.ts     # Click-to-place + click-selection via ray casting
├── mesh-probe.ts         # Multi-view reflection probe (6 cube-map faces)
├── mesh-cubemap.ts       # Screen-space env capture fallback
├── mesh-lighting.ts      # Directional lights + IBL env atlas for meshes
├── shaders/
│   ├── ssr-shader.ts     # GLSL: screen-space reflection chunk
│   └── ssr-mask-shader.ts# GLSL: mask pass (splats only, no mesh)
└── ui/
    ├── mesh-panel.ts     # Bottom tab panel (scrollable DOM sections)
    └── scss/mesh-panel.scss

static/assets/
└── audi_r8.glb           # 27 MB Audi R8 (converted from FBX via assimp)
```

**Modified files:**
- `src/ui/status-bar.ts` — added MESH tab button  
- `src/ui/editor.ts` — added MeshPanel to `mainContainer` flex column  
- `src/scene.ts` — exposed `meshLayer`, `gizmoLayer`, render-target references  
- `rollup.config.mjs` — copy `static/assets/` to dist  

---

## 4. Render Layer Architecture

PlayCanvas uses **named render layers** drawn in priority order. SuperSplat's pipeline:

```
World layer         (splats + default objects)
    ↓
splatLayer          (3DGS splat geometry pass — MRT: color + depth)
    ↓
meshLayer           ← NEW: all MeshElement render components
    ↓
gizmoLayer          ← NEW: TranslateGizmo / RotateGizmo / ScaleGizmo
    ↓
UI layer
```

### Why a separate meshLayer?

The 3DGS splats render in a custom pass. Any mesh on the **World** layer renders before or in the same pass as splats, meaning it gets composited underneath. Moving meshes to `meshLayer` (inserted after `splatLayer`) ensures they always appear in front of the point cloud.

```typescript
// scene.ts — create and insert the new layers
this.meshLayer  = new Layer({ name: 'Mesh',  opaqueSortMode:  SORTMODE_BACK2FRONT });
this.gizmoLayer = new Layer({ name: 'Gizmo', opaqueSortMode: SORTMODE_NONE });
const comp = this.app.scene.layers;
const idx = comp.getLayerIndex(splatLayer) + 1;
comp.insertOpaque(this.meshLayer,  idx);
comp.insertOpaque(this.gizmoLayer, idx + 1);
```

---

## 5. MeshElement (`mesh-element.ts`)

The central class that owns one scene object. It handles two source kinds:

```typescript
export type MeshSource =
  | { kind: 'primitive'; type: string }   // 'sphere', 'box', 'bullet', 'wave', …
  | { kind: 'container'; asset: Asset };  // GLB / GLTF file
```

### 5.1 Material Presets

Seven named presets control the `StandardMaterial` parameters:

| Preset | Opacity | Reflectivity | Metalness | Roughness |
|--------|---------|--------------|-----------|-----------|
| original | 1.0 | — | — | — |
| mirror | 1.0 | 1.0 | 1.0 | 0.0 |
| glass | 0.75 | 1.0 | 0.3 | 0.0 |
| gold | 1.0 | 1.0 | 1.0 | 0.05 |
| metal | 1.0 | 0.7 | 1.0 | 0.2 |
| plastic | 1.0 | 0.2 | 0.0 | 0.4 |
| wave | 0.22 | 0.9 | 0.15 | 0.0 |

### 5.2 Original GLB Materials

For imported GLB/GLTF files, the **original PBR materials, textures, and UV maps** must be preserved. This is done via the `_useOriginalMaterials` flag:

```typescript
// add() — container path
this._useOriginalMaterials = true;
const child = resource.instantiateRenderEntity({ castShadows: false });
this.pivot.addChild(child);
this._walkSetLayer(this.pivot, scene);  // ← layers ONLY, no material override
```

```typescript
// _walkSetLayer — only touch render layers
private _walkSetLayer(entity: Entity, scene: Scene) {
    const r = (entity as any).render;
    if (r && scene?.meshLayer) {
        r.layers = [scene.meshLayer.id];
    }
    for (const child of entity.children) {
        this._walkSetLayer(child as Entity, scene);
    }
}
```

When `_useOriginalMaterials = true`, `_walkAndApply` (which overwrites all materials with the custom `StandardMaterial`) is never called. Setting any non-`'original'` preset via `setMaterialOptions()` clears the flag and switches to the custom material.

### 5.3 Primitive Shapes

Standard PlayCanvas render components cover sphere / box / cylinder / cone / capsule / torus / plane. Two custom composite shapes were added:

**Bullet** — cylinder body + cone tip + flattened sphere base:
```typescript
this._addRenderChild(scene, 'bullet-body', 'cylinder', 0,  0,    0, 0.24, 0.7,  0.24);
this._addRenderChild(scene, 'bullet-tip',  'cone',     0,  0.5,  0, 0.24, 0.3,  0.24);
this._addRenderChild(scene, 'bullet-base', 'sphere',   0, -0.35, 0, 0.24, 0.08, 0.24);
```

**Wave ripple** — 6 concentric torus rings at increasing radii, each very thin on Y:
```typescript
const rings = [0.4, 0.65, 0.92, 1.22, 1.56, 1.94];
rings.forEach((r, i) => {
    const thickness = 0.06 - i * 0.006;   // tapers outward
    e.setLocalScale(r, thickness, r);
    e.addComponent('render', { type: 'torus' });
});
```

---

## 6. Reflection System

Three reflection methods are used, in priority order:

```
SSR (screen-space, real-time)
  → Reflection Probe (multi-view capture, per-mesh)
    → Screen Capture Fallback (single-frame reprojection)
```

### 6.1 Screen-Space Reflections (SSR)

**How it works:**

1. **Mask pass** (`ssr-mask-shader.ts`): Renders splats-only into a separate `ssrSceneTexture`, capturing the 3DGS scene *before* meshes draw. This prevents mesh self-reflection.

2. **SSR chunk** (`ssr-shader.ts`): Replaces PlayCanvas's built-in `reflectionEnvPS` chunk in the `StandardMaterial`. Per-fragment:
   - Computes current fragment screen UV from `gl_FragCoord`
   - Projects `worldPos + reflDir × 20` through `uSSRViewProj` to get a target screen UV
   - Ray-marches from current UV toward target UV (4–48 steps, adaptive)
   - First sample that has non-zero luminance (threshold `> 0.15`) is used as the reflected color
   - Edge-fade (avoid reflections at screen border) and gloss-fade applied
   - Result added to `dReflection`

```glsl
void addReflection(vec3 reflDir, float gloss) {
    vec2 fragUV  = gl_FragCoord.xy / uSSRScreenSize;
    vec4 reflClip = uSSRViewProj * vec4(vPositionW + reflDir * 20.0, 1.0);
    vec2 reflUV  = (reflClip.xy / reflClip.w) * 0.5 + 0.5;
    vec2 dir     = reflUV - fragUV;
    float fSteps = clamp(length(dir * uSSRScreenSize) * 0.25, 4.0, 48.0);
    // ... ray march loop ...
    dReflection += vec4(hitColor, material_reflectivity * edge * glossFade);
}
```

3. **Uniforms updated per frame:** `uSSRScene`, `uSSRViewProj`, `uSSRScreenSize`

### 6.2 Reflection Probe (`mesh-probe.ts`)

When SSR is unavailable (e.g., no scene texture yet), a probe is rendered at the mesh's world position using 6 orthogonal cube-map directions:

```typescript
const CAPTURE_EULERS = [
    [  0,   0, 0],   // front  (-Z)
    [  0, 180, 0],   // back   (+Z)
    [  0,  90, 0],   // right  (+X)
    [  0, 270, 0],   // left   (-X)
    [-90,   0, 0],   // up     (+Y)   ← fixed (was skewed diagonal)
    [ 90,   0, 0],   // down   (-Y)   ← fixed
];
```

> **Bug fixed:** Previous diagonal angles `[-50, 45]` / `[50, 225]` left the top and bottom hemispheres uncaptured, causing **black patches** when viewing a mirror from above or below.

For each face: override camera position/rotation via `prerender` hook → wait for `postrender` → read `colorTarget.colorBuffer` → `reprojectTexture` into an equirectangular texture → after 6 faces, call `EnvLighting.generatePrefilteredAtlas()` to build the final IBL atlas.

### 6.3 Screen Capture Fallback (`mesh-cubemap.ts`)

Simple single-frame fallback: grabs `cam.colorTarget.colorBuffer`, reprojects as equirect (512×256), builds atlas. Fast but only shows the current camera view — used only when the probe fails.

### 6.4 Reflection Trigger Timing

```typescript
// mesh-handler.ts
const registerMesh = (mesh: MeshElement) => {
    meshList.push(mesh);
    events.fire('mesh.added', mesh);
    setTimeout(() => mesh.captureReflection(), 200);  // was 1000ms — now 200ms
};

// Re-capture when a 3DGS splat file loads (spinner stops)
events.on('stopSpinner', () => {
    setTimeout(() => meshList.forEach(m => m.captureReflection()), 1000);
});
```

---

## 7. Lighting (`mesh-lighting.ts`)

Meshes on `meshLayer` are lit by three directional lights scoped to that layer (so they don't affect the splat scene):

| Light | Color (RGB) | Intensity | Euler |
|-------|-------------|-----------|-------|
| Key | warm white (1.0, 0.95, 0.85) | 1.8 | (45, 45, 0) |
| Fill | cool blue (0.5, 0.6, 0.9) | 0.6 | (−25, −135, 0) |
| Back | sky blue (0.7, 0.8, 1.0) | 0.4 | (20, 200, 0) |

A programmatically-generated gradient IBL atlas (warm sky top → dark ground bottom) is also created at startup as a fallback environment until a real probe is captured.

---

## 8. GLB Import (`mesh-handler.ts`)

Two import paths:

**File picker:**
```typescript
const asset = new Asset(file.name, 'container', { url, filename: file.name });
```

**URL (bundled sample models):**
```typescript
const asset = new Asset(displayName, 'container', { url, filename });
//  ↑ displayName = 'Audi R8'         ↑ filename = 'audi_r8.glb'
```

> **Critical:** PlayCanvas selects the GLB importer by the **`filename`** extension, not the display name. Passing `filename: 'Audi R8'` (no `.glb`) silently fails — the asset loads but fires no `load` event. The `filename` parameter must always include the `.glb` extension.

The Audi R8 model was converted from FBX to GLB using:
```bash
assimp export "Models/Audi R8.fbx" audi_r8.glb
# Output: ~27 MB GLB with all textures embedded
```

---

## 9. Gizmo System (`mesh-gizmo.ts`)

Wraps PlayCanvas's `TranslateGizmo`, `RotateGizmo`, and `ScaleGizmo` from `playcanvas-extras`.

### 9.1 Camera Pointer-Capture Bug & Fix

**Root cause:** `camera.ts` creates `PointerController` with `target = document.getElementById('canvas-container')`. On every `pointerdown`, it calls `target.setPointerCapture(event.pointerId)`. This redirects all subsequent `pointermove` events to `canvas-container`, bypassing the inner `<canvas>` where PlayCanvas's gizmo listeners run. Result: dragging a gizmo handle orbited the camera instead of moving the object.

**Fix in `mesh-gizmo.ts`:**

```typescript
const canvasContainer = document.getElementById('canvas-container') as HTMLElement;
let activePointerId = -1;

// 1. Record pointerId in capture phase BEFORE camera's bubble handler runs
canvasContainer.addEventListener('pointerdown', (e) => {
    activePointerId = e.pointerId;
}, true);   // ← capture phase: fires first

const blockMove = (e: PointerEvent) => { e.stopPropagation(); };

g.on('transform:start', () => {
    // 2. Release camera's capture → events flow to canvas (gizmo) again
    try { canvasContainer.releasePointerCapture(activePointerId); } catch (_) {}
    // 3. Stop pointermove bubbling from canvas → canvas-container (no camera orbit)
    canvas.addEventListener('pointermove', blockMove, true);
});

g.on('transform:end', () => {
    // 4. Remove blocker — let pointerup bubble to camera to reset pressedButton state
    canvas.removeEventListener('pointermove', blockMove, true);
});
```

**Why this order works:**

```
pointerdown event fires
 └─ capture phase on canvas-container  → records pointerId         [our listener]
 └─ bubble phase on canvas-container   → setPointerCapture(id)    [camera controller]
 └─ gizmo's handler (PlayCanvas)       → fires transform:start
     └─ transform:start handler        → releasePointerCapture(id)  [our fix]
                                          + add blockMove on canvas

pointermove events (now going to canvas again)
 └─ blockMove on canvas (capture phase) → stopPropagation()        [no orbit]
 └─ gizmo's handler on canvas          → moves the object          ✓
```

### 9.2 Ray-Cast Click Selection

`mesh-placement.ts` implements sphere-ray intersection for click-to-select:

```
ray = unproject(ndc) → worldDir
for each mesh:
    solve  |near + t·dir - center|² = radius²
    t > 0 → hit; pick nearest t
```

---

## 10. Click-to-Place System (`mesh-placement.ts`)

A transparent full-screen `div` overlay (z-index 200, `cursor: crosshair`) is placed over the canvas when placement mode is active. This avoids fighting the camera controller for pointer events:

```typescript
const overlay = document.createElement('div');
overlay.style.cssText = 'position:absolute;inset:0;z-index:200;cursor:crosshair;display:none';
canvas.parentElement?.appendChild(overlay);

overlay.addEventListener('pointerdown', (e) => {
    e.stopPropagation();                   // camera never sees this click
    const pos = worldFromPointer(e, scene); // unproject to world Y-plane
    events.fire('mesh.addPrimitive', type, pos);
});
```

World position is computed by ray-plane intersection at the scene's bounding-box center Y (approximate "floor"):

```typescript
const t = (targetY - near.y) / dir.y;
return new Vec3(near.x + dir.x * t, targetY, near.z + dir.z * t);
```

---

## 11. UI Architecture

### 11.1 Bottom Tab Panel Pattern

The mesh panel follows the same pattern as SuperSplat's existing TIMELINE and SPLAT DATA panels:

```
mainContainer (flex column)
├── canvasContainer          ← WebGL canvas + floating overlays
├── timelinePanel            ← hidden by default
├── dataPanel                ← hidden by default
├── meshPanel                ← NEW, hidden by default
└── statusBar                ← TIMELINE | SPLAT DATA | MESH tabs
```

Toggle logic in `status-bar.ts`:
```typescript
meshButton.on('click', () => {
    setActivePanel(activePanel === 'mesh' ? '' : 'mesh');
});
events.fire('statusBar.panelChanged', panel || null);
```

And in `editor.ts`:
```typescript
events.on('statusBar.panelChanged', (panel) => {
    if (meshPanel) meshPanel.hidden = panel !== 'mesh';
});
```

### 11.2 MeshPanel DOM Structure

The panel is a fixed-height (280px) PCUI `Container` with an inner scrollable `div`. All sections are plain DOM elements (not PCUI Containers) to avoid PCUI layout conflicts:

```
#mesh-panel  (PCUI Container, flex column, 280px)
└── #mesh-panel-scroll  (div, flex:1, overflow-y:auto)
    ├── .mp-section  ← Add Shapes (shape buttons)
    ├── .mp-rule
    ├── .mp-section  ← Objects list (#mp-obj-list)
    ├── .mp-rule
    ├── .mp-section  ← Gizmo Mode (translate / rotate / scale)
    ├── .mp-rule
    ├── .mp-section  ← Transform (Position / Rotation / Scale — VectorInput)
    ├── .mp-rule
    └── .mp-section  ← Material (preset select + sliders)
```

Transform and Material sections show/hide based on selection state.

---

## 12. Problems Encountered & Solutions

### 12.1 Dark Screen on Startup

**Cause A:** PCUI sets `position: relative` on all `Container` elements by default, which shifted the canvas out of view.  
**Fix:** Set inline style `meshPanel.dom.style.position = 'static'` after construction.

**Cause B:** A space character in a PCUI class argument (`new Container({ class: 'foo bar' })`) caused a DOM exception that silently swallowed the entire panel constructor.  
**Fix:** Never use spaces in PCUI `class` arguments; only pass a single class name.

**Cause C:** Service Worker cached the old broken `index.js`.  
**Fix:** Added a JS error overlay to `index.html` and wrapped `MeshPanel` construction in `try/catch` so a broken panel can't break the whole editor.

### 12.2 Car Button Not Loading

**Cause:** `new Asset('Audi R8', 'container', { url, filename: 'Audi R8' })` — `filename` had no extension, so PlayCanvas could not select the GLB container importer. The `load` event never fired.  
**Fix:** Separate `displayName` (UI label) from `filename` (must be `'audi_r8.glb'`).

### 12.3 Car Renders Under Splats

**Cause:** `instantiateRenderEntity()` assigns all render components to the **World** layer, which is composited before the splat pass.  
**Fix:** `_walkSetLayer()` walks the entire entity hierarchy and sets `layers = [scene.meshLayer.id]` on every render component.

### 12.4 Car Lost Its Original Materials

**Cause:** `_walkAndApply()` replaced all GLB materials with our custom `StandardMaterial`.  
**Fix:** Added `_useOriginalMaterials` flag. For containers, only `_walkSetLayer()` runs; `_walkAndApply()` is suppressed.

### 12.5 Gizmo Drag Orbits Camera Instead of Moving Object

**Cause:** `canvas-container.setPointerCapture()` was called in the camera's `pointerdown` handler before `transform:start` could fire, hijacking all `pointermove` events.  
**Fix:** See Section 9.1 — release capture in `transform:start`, block `pointermove` propagation during drag.

### 12.6 Black Patches on Mirror Material

**Cause A (timing):** Reflection probe ran 1 second after mesh was added — 1 second of black.  
**Fix:** Reduced delay to 200ms.

**Cause B (missing directions):** Probe used diagonal angles `[-50, 45]` / `[50, 225]` that missed the straight up/down hemisphere.  
**Fix:** Replaced with 6 proper orthogonal cube-map face directions.

---

## 13. Build & Run

```bash
npm install
npm run build          # Rollup bundle → dist/
npx serve dist         # Serve on localhost:3000
```

> If the browser shows a stale build, unregister the service worker:  
> DevTools → Application → Service Workers → Unregister

---

## 14. Key Learnings

1. **PlayCanvas layer ordering** is the only reliable way to composite mesh objects over 3DGS splats — CSS z-index doesn't apply to WebGL layers.

2. **`setPointerCapture`** at the container level breaks all child element pointer interactions. Never assume DOM events reach child elements once capture is active on an ancestor.

3. **PlayCanvas Asset filename extension** drives importer selection — the `url` can be anything (blob URL, etc.) but `filename` must carry the correct extension.

4. **`instantiateRenderEntity`** preserves the full GLB material graph including PBR textures, UV maps, metalness/roughness maps. Calling `_walkAndApply` after it destroys that work immediately.

5. **Screen-space reflections** on 3DGS are practical — the 3DGS color buffer is already in screen space, making SSR ray-marching a natural fit. The main constraint is that reflections can only show what is visible on screen.

6. **EnvLighting.generatePrefilteredAtlas** expects a list of equirectangular `Texture` objects. A single-face screen capture works but produces directionally-biased reflections; a 6-face orthogonal capture produces unbiased IBL.
