# SuperSplat + Reflective Mesh

[![License](https://img.shields.io/github/license/playcanvas/supersplat)](https://github.com/playcanvas/supersplat/blob/main/LICENSE)

| [Live Demo](https://supersplat-and-mesh-pudpawat.vercel.app/) | [Project Report](docs/index.html) | [Original SuperSplat Editor](https://superspl.at/editor) | [User Guide](https://developer.playcanvas.com/user-manual/gaussian-splatting/editing/supersplat/) |

This project extends the [SuperSplat Editor](https://github.com/playcanvas/supersplat) — a free, browser-based tool for editing 3D Gaussian Splats (3DGS) — with **reflective mesh objects** that can be placed inside a splat scene and reflect the splats around them.

**Live demo:** https://supersplat-and-mesh-pudpawat.vercel.app/

![SuperSplat Editor](https://github.com/user-attachments/assets/b6cbb5cc-d3cc-4385-8c71-ab2807fd4fba)

---

## Motivation

3D Gaussian Splatting and traditional triangle meshes are rendered in fundamentally different ways:

| | **3DGS (SuperSplat)** | **Mesh (PBR / reflections)** |
|---|---|---|
| **Rendering** | Splat rasterization — millions of oriented Gaussians sorted and alpha-blended per pixel | Triangle rasterization with physically based shading |
| **Depth / G-buffer** | No conventional depth buffer or geometry pass | Expects depth, normals, and material buffers for lighting |
| **Reflections** | Splats do not participate in mesh ray tracing or screen-space pipelines by default | Specular reflections need an environment map, ray tracing, or screen-space data |

This creates a practical problem: **you cannot drop a glossy GLB model into a 3DGS scene and expect correct reflections out of the box.** Mesh shaders look for skyboxes, cubemaps, or ray-traced hits — but the splat background is not geometry the mesh renderer understands.

This project bridges that gap by **combining 3DGS rasterization with mesh PBR reflection techniques**, so reflective objects (cars, glass, metal shapes) can sit inside a splat scene and show the splat environment in their reflections.

---

## What We Added

### Mesh objects in a splat scene

- Import **GLB / GLTF** meshes (drag-and-drop or file picker)
- Add **primitive shapes** (sphere, box, cylinder, cone, bullet, wave ripple)
- Load the bundled **Audi R8** sample car from the Mesh panel
- **Click-to-place** placement mode
- **3D transform gizmo** (move / rotate / scale) with numeric transform controls
- Dedicated **Mesh panel** (bottom tab) for object list, gizmo mode, transform, and material settings

### Reflection modes

Two complementary approaches make mesh objects reflect the 3DGS scene:

#### 1. Screen-Space Reflections (SSR) — real-time

- After the splat pass renders, the scene color buffer is **snapshotted before mesh objects draw**
- A custom PlayCanvas shader chunk replaces the standard environment reflection path
- Each frame, mesh materials ray-march in screen space against that snapshot
- Updates live as the camera moves — good for mirrors and glass

#### 2. IBL Reflection Probe — position-based capture

- Renders the 3DGS scene from the mesh object's world position in **6 cubemap directions**
- Reprojects each face to equirectangular format and builds a **prefiltered specular atlas** (`envAtlas`)
- Injected into mesh materials as image-based lighting (IBL)
- Re-captured automatically when the object moves or when a splat scene finishes loading
- Falls back to a single-frame screen capture if the full probe fails

#### 3. Original GLB material preservation

For imported `.glb` files with the **Original (GLB)** preset:

- Original textures, metalness, roughness, and clearcoat are kept untouched
- Only `envAtlas` and `useSkybox = false` are set on the GLB's own `StandardMaterial` instances
- The car paint reflects the captured splat scene without replacing the author's materials

### Material presets

| Preset | Description |
|---|---|
| **Original (GLB)** | Keep imported materials; inject probe IBL only |
| **Glass** | Transparent, high reflectivity |
| **Mirror** | Fully reflective |
| **Metal / Gold / Plastic** | Tuned PBR presets |
| **Wave** | Matrix-style ripple rings |
| **Custom** | Manual slider control |

Sliders: opacity, reflectivity, roughness, metalness, and **Reflect Clip** (far-clip multiplier for probe capture).

### Editor utilities

- **Re-capture Reflection** button in the Mesh panel
- **Hide / Show Axis Helpers** in the Render menu (removes red/green/blue gizmo overlays for cleaner viewport and probe captures)
- Adjustable **Far Clip** in the View panel for wide splat scenes

---

## Methods (Technical Overview)

```
┌─────────────────────────────────────────────────────────────┐
│                     Per-frame render order                   │
├─────────────────────────────────────────────────────────────┤
│  1. Splat pass        → 3DGS rasterization (sorted splats)  │
│  2. SSR snapshot      → copy color buffer (splats only)     │
│  3. Mesh pass         → draw reflective mesh on meshLayer   │
│     └─ SSR chunk      → screen-space ray march vs snapshot  │
│     └─ IBL envAtlas   → specular lookup from probe capture  │
└─────────────────────────────────────────────────────────────┘
```

### Why probe capture is non-trivial

The probe cannot use a separate off-screen camera easily — **the main SuperSplat camera pipeline is the only path that renders 3DGS correctly.** The probe therefore:

1. Freezes the viewport (`finalPass` disabled) so the user sees no flicker
2. Hides gizmos, overlays, and the mesh layer during capture
3. Hooks `prerender` to override camera position/rotation per cubemap face (after the orbit controller runs)
4. Refits clipping planes per face to avoid black patches
5. Reprojects each face and builds a PlayCanvas `EnvLighting` prefiltered atlas

Key source files:

| File | Role |
|---|---|
| `src/mesh-probe.ts` | 6-face IBL probe capture from object position |
| `src/mesh-cubemap.ts` | Single-frame screen capture fallback |
| `src/ssr-pass.ts` | Scene snapshot + per-frame SSR uniforms |
| `src/shaders/ssr-shader.ts` | Custom `reflectionEnvPS` chunk for SSR |
| `src/mesh-element.ts` | Material presets, envAtlas injection, reflection orchestration |
| `src/mesh-handler.ts` | Import, placement, auto re-capture scheduling |
| `src/ui/mesh-panel.ts` | Mesh panel UI |

---

## Using Mesh Features

1. Open the app and load a `.ply` splat scene (or use the bundled sample).
2. Click the **Mesh** tab in the bottom status bar.
3. **Add a shape** or **Import GLB**, or click the **Audi R8** button.
4. Click in the viewport to place (click-to-place mode).
5. Select the object in the Objects list to edit transform and material.
6. Choose a material preset; use **Original (GLB)** for imported models.
7. Click **↺ Re-capture Reflection** if reflections look stale after moving the object.
8. If reflections have black patches, increase **Reflect Clip** or **Far Clip** in the View panel.
9. Use **Render → Hide Axis Helpers** to remove gizmo overlays from the viewport.

---

## Local Development

To initialize a local development environment, ensure you have [Node.js](https://nodejs.org/) 20 or later installed. Follow these steps:

1. Clone the repository:

   ```sh
   git clone https://github.com/PudPawat/supersplat_and_mesh.git
   cd supersplat_and_mesh
   ```

2. Install dependencies:

   ```sh
   npm install
   ```

3. Build SuperSplat and start a local web server:

   ```sh
   npm run develop
   ```

4. Open a web browser tab and make sure network caching is disabled on the network tab and the other application caches are clear:

   - On Safari you can use `Cmd+Option+e` or Develop->Empty Caches.
   - On Chrome ensure the options "Update on reload" and "Bypass for network" are enabled in the Application->Service workers tab:

   <img width="846" alt="Screenshot 2025-04-25 at 16 53 37" src="https://github.com/user-attachments/assets/888bac6c-25c1-4813-b5b6-4beecf437ac9" />

5. Navigate to `http://localhost:3000`

When changes to the source are detected, SuperSplat is rebuilt automatically. Simply refresh your browser to see your changes.

---

## Localizing the SuperSplat Editor

The currently supported languages are available here:

https://github.com/playcanvas/supersplat/tree/main/static/locales

### Adding a New Language

1. Add a new `<locale>.json` file in the `static/locales` directory.

2. Add the locale to the list here:

   https://github.com/playcanvas/supersplat/blob/main/src/ui/localization.ts

### Testing Translations

To test your translations:

1. Run the development server:

   ```sh
   npm run develop
   ```

2. Open your browser and navigate to:

   ```
   http://localhost:3000/?lng=<locale>
   ```

   Replace `<locale>` with your language code (e.g., `fr`, `de`, `es`).

---

## Acknowledgements

This project is built on top of the open-source [SuperSplat Editor](https://github.com/playcanvas/supersplat) by [PlayCanvas](https://playcanvas.com).

SuperSplat is made possible by the PlayCanvas open source community:

<a href="https://github.com/playcanvas/supersplat/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=playcanvas/supersplat" />
</a>

Reflective mesh integration: [PudPawat/supersplat_and_mesh](https://github.com/PudPawat/supersplat_and_mesh).
