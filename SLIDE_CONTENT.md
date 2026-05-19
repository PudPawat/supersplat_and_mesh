# Slide Content — Reflective Mesh Objects in a 3D Gaussian Splatting Environment

---

## SLIDE 1 — Title

**Title:**  
Rendering Reflective Mesh Objects in a 3D Gaussian Splatting Scene

**Subtitle:**  
A Multi-Tier Reflection System: SSR · Reflection Probe · IBL Fallback

**Author / Course / Date**

---

## SLIDE 2 — What is 3D Gaussian Splatting?

**Heading:** 3D Gaussian Splatting (3DGS)

**Key points:**
- Represents a real-world scene as millions of 3D Gaussian "splats"
- Each splat = position + covariance (shape/orientation) + opacity + spherical harmonic color
- Rendered by projecting 3D Gaussians onto the screen as 2D ellipses, sorted back-to-front
- Result: **photorealistic novel-view synthesis** at real-time frame rates

**Visual suggestion:**  
Left: photo of a real scene → Right: the same scene rendered with 3DGS (point cloud visualization)

**Key equation (optional):**
```
G(x) = exp( -½ (x - μ)ᵀ Σ⁻¹ (x - μ) )
```
where μ = center, Σ = 3D covariance matrix (controls shape and orientation)

---

## SLIDE 3 — The Core Problem

**Heading:** Challenge — Reflective Objects Don't Belong in a Gaussian World

**Problem statement:**
- 3DGS scenes are **immutable point clouds** — you cannot raytrace into them
- Traditional PBR materials expect a **skybox or cubemap** for reflections
- A 3DGS scene has **no geometry** to reflect off: no mesh normals, no depth buffer (standard)
- Placing a mirror sphere in a 3DGS scene → **black reflections** by default

**Two sub-problems:**
1. **Compositing** — mesh must render *on top of* the splat layer (not get buried inside the point cloud)
2. **Reflection** — the mesh material must reflect the 3DGS scene content plausibly

**Visual suggestion:**  
Side-by-side: mirror ball with black reflection (wrong) vs mirror ball reflecting the 3DGS room (correct)

---

## SLIDE 4 — Render Layer Architecture

**Heading:** Problem 1 — Compositing via Render Layers

**Concept:**  
PlayCanvas uses ordered render layers. Objects in earlier layers draw first (behind later layers).

```
┌──────────────────────┐
│   World Layer        │  ← default, under splats
├──────────────────────┤
│   Splat Layer        │  ← 3DGS rasterisation (MRT pass)
├──────────────────────┤
│   Mesh Layer   ←NEW  │  ← our reflective mesh objects
├──────────────────────┤
│   Gizmo Layer  ←NEW  │  ← transform handles (translate/rotate/scale)
└──────────────────────┘
```

**Key insight:**  
By inserting `meshLayer` immediately after `splatLayer`, mesh objects are always drawn on top of the 3DGS point cloud — no depth-buffer tricks needed.

**Code snippet:**
```typescript
const idx = comp.getLayerIndex(splatLayer) + 1;
comp.insertOpaque(meshLayer,  idx);
comp.insertOpaque(gizmoLayer, idx + 1);
```

---

## SLIDE 5 — PBR Material Model (Theory)

**Heading:** Problem 2 — How PBR Materials Compute Reflections

**The rendering equation (simplified):**
```
L_out(ω_o) = ∫ f_r(ω_i, ω_o) · L_in(ω_i) · cos θ_i dω_i
```
- f_r = BRDF (how surface scatters light)
- L_in = incoming radiance from direction ω_i
- The integral over the hemisphere is what needs to be approximated

**Split-sum approximation (Epic Games, 2013):**
```
L_out ≈  [ ∫ L_in(ω_i) · D(ω_i) dω_i ]  ×  [ F(ω_o) · G(ω_o) ]
           ─────────────────────────────     ──────────────────────
            Pre-filtered environment map        BRDF lookup table
            (what we must provide!)
```

**What this means for us:**  
We must supply a **pre-filtered environment map** (envAtlas) that represents the 3DGS scene as seen from the mesh's position. That is exactly what our reflection pipeline produces.

**Visual suggestion:**  
Diagram: hemisphere over a surface → arrows for ω_i and ω_o → pre-filtered mip levels (rough = blurry mip, smooth = sharp mip)

---

## SLIDE 6 — Reflection Pipeline Overview

**Heading:** Three-Tier Reflection System

```
┌─────────────────────────────────────────────────────────┐
│  Tier 1 — Screen-Space Reflections (SSR)                │
│  Per-fragment, real-time, always correct                │
│  ✓ Dynamic  ✓ No bake cost  ✗ Screen edges = miss       │
├─────────────────────────────────────────────────────────┤
│  Tier 2 — Reflection Probe (multi-view IBL bake)        │
│  6-face cube capture → pre-filtered envAtlas            │
│  ✓ Full sphere  ✓ Accurate IBL  ✗ Re-bake on move       │
├─────────────────────────────────────────────────────────┤
│  Tier 3 — Screen Capture Fallback                       │
│  Single-frame reproject → envAtlas                      │
│  ✓ Fast  ✗ Only front-facing hemisphere                 │
└─────────────────────────────────────────────────────────┘
         Tier 1 preferred → fall back down the chain
```

---

## SLIDE 7 — Tier 1: Screen-Space Reflections (SSR)

**Heading:** SSR — Ray Marching in Screen Space

**Core idea:**  
Instead of tracing rays into 3D geometry, march along the **2D screen** from the current fragment toward the projected reflection direction.

**Algorithm (per fragment):**

```
1. fragUV  = gl_FragCoord.xy / screenSize           // current pixel
2. reflUV  = project(worldPos + reflDir × 20)       // reflected target on screen
3. dir     = reflUV − fragUV                        // march direction
4. steps   = clamp(|dir| × screenSize × 0.25, 4, 48)
5. for i in 1..steps:
     sampleUV = fragUV + dir × (i / steps)
     color    = texture(ssrScene, sampleUV)
     if luminance(color) > 0.15:
         apply edge-fade × gloss-fade
         dReflection += color
         break
```

**Why 3DGS is perfect for SSR:**  
The 3DGS scene is already in screen space as a color buffer. No depth buffer or geometry needed — just sample the pre-rendered frame.

**Key implementation detail:**  
The scene is captured *before* mesh objects render (`ssrSceneTexture`), preventing the mesh from reflecting itself.

**Visual suggestion:**  
Diagram: screen plane with fragUV and reflUV marked, arrows showing march steps, hit point highlighted

---

## SLIDE 8 — SSR Limitations

**Heading:** SSR — What It Cannot Reflect

**Missing information problem:**
- SSR can only reflect things that are **visible on screen**
- Objects behind the camera → black reflection
- Objects occluded by other objects → black
- Screen-edge reflections fade to black

```
Camera frustum
      ┌───────────┐
      │  visible  │  ← SSR works here ✓
      └───────────┘
  ← off-screen →       ← SSR fails here ✗
```

**Our mitigation:**  
- Edge fade: `smoothstep(0.0, 0.08, min(edgeDist.x, edgeDist.y))`  
- Gloss fade: `smoothstep(0.0, 0.6, gloss)` — rough surfaces hide the missing data under blur
- Fall back to probe/IBL for off-screen directions

**Visual suggestion:**  
Mirror ball half-lit by SSR + half showing black at screen edges vs full sphere from probe

---

## SLIDE 9 — Tier 2: Reflection Probe (Multi-View Capture)

**Heading:** Reflection Probe — Image-Based Lighting from 6 Directions

**Concept:**  
Render the 3DGS scene from the mesh's world position toward each of 6 orthogonal directions (a virtual cube camera), then merge into a pre-filtered IBL atlas.

**6 capture directions (cube-map faces):**

| Face | Euler angles | Direction |
|------|-------------|-----------|
| Front | (0°, 0°, 0°) | −Z |
| Back | (0°, 180°, 0°) | +Z |
| Right | (0°, 90°, 0°) | +X |
| Left | (0°, 270°, 0°) | −X |
| Up | (−90°, 0°, 0°) | +Y |
| Down | (+90°, 0°, 0°) | −Y |

**Why this is non-trivial in 3DGS:**  
The 3DGS renderer uses a frame-persistent camera pipeline. To override camera pose *after* the frame update but *before* the draw call, we hook the `prerender` event:

```typescript
scene.app.once('prerender', () => {
    entity.setLocalPosition(worldPos);
    entity.setLocalEulerAngles(pitch, yaw, roll);
    scene.camera.fitClippingPlanes(entity.getLocalPosition(), entity.forward);
});
await new Promise(resolve => scene.app.once('postrender', resolve));
// now read colorTarget.colorBuffer
```

**Visual suggestion:**  
Cube unfolded into 6 faces, each showing a different view of the 3DGS room

---

## SLIDE 10 — Pre-filtered IBL Atlas

**Heading:** From Raw Captures to an IBL Atlas

**Pipeline:**

```
6 × Perspective frame (colorBuffer)
        ↓
6 × Equirectangular texture (256×128 each)
   via reprojectTexture()
        ↓
EnvLighting.generatePrefilteredAtlas()
        ↓
Single envAtlas texture with mip levels:
  mip 0 = sharp (gloss = 1.0, mirror)
  mip 1 = slightly blurred
  mip 2 = more blurred
  ...
  mip N = fully diffuse (gloss = 0.0, matte)
```

**Usage in StandardMaterial:**
```typescript
mat.envAtlas    = atlas;   // our baked probe
mat.useSkybox   = false;
mat.metalness   = 1.0;     // fully metallic = pure reflection
mat.gloss       = 1.0;     // no roughness = sharp mirror
mat.reflectivity = 1.0;
```

PlayCanvas's BRDF shader samples the correct mip level based on `gloss`, giving physically correct results for any roughness value.

**Visual suggestion:**  
Mip pyramid: sharp reflection at top → progressively blurrier toward bottom; material at each roughness level

---

## SLIDE 11 — Probe Re-Capture on Move

**Heading:** Dynamic Probe — Re-baking When the Object Moves

**Problem:**  
A baked IBL atlas is static. Moving the mesh does not update the reflection environment.

**Solution:**  
Re-trigger `captureReflection()` automatically when the user finishes dragging the object:

```typescript
// mesh-gizmo.ts
gizmo.on('transform:end', () => {
    const ssrActive = !!(scene as any).ssrPass?.ssrSceneTexture;
    if (!ssrActive && this.mesh) {
        this.mesh.captureReflection();  // re-bake at new world position
    }
});
```

**Decision logic:**

```
transform:end fires
    │
    ├── SSR active? ──YES──▶ skip (SSR is always live, already correct)
    │
    └── NO ──▶ captureReflection() at new position
                  ├── captureReflectionProbe() [6 async frames]
                  └── fallback: captureSceneEnv() [1 frame]
```

---

## SLIDE 12 — Tier 3: Screen Capture Fallback

**Heading:** Fallback — Single-Frame Screen Reproject

**When used:**  
If the 6-face probe fails (camera not ready, etc.), we fall back to a single-frame capture of the current view.

```typescript
// Grab the already-rendered scene color buffer
const srcTex = cam.colorTarget.colorBuffer;   // RGBA, screen-space
// Reproject as equirectangular
reprojectTexture(srcTex, equirect, { numSamples: 8 });
// Build IBL atlas from the single equirect
const atlas = EnvLighting.generatePrefilteredAtlas([equirect]);
```

**Limitation:**  
The source is a perspective-projected 2D image. Directions outside the current camera frustum have no data — they map to black or repeat at the edges.

**When it's acceptable:**  
Rough/matte surfaces (`gloss < 0.5`) blur the atlas heavily, hiding the missing directions. For mirror-smooth surfaces, the probe is strongly preferred.

---

## SLIDE 13 — Material Presets

**Heading:** Supported Material Presets

| Preset | Opacity | Reflectivity | Metalness | Roughness | Notes |
|--------|---------|-------------|-----------|-----------|-------|
| Mirror | 1.0 | 1.0 | 1.0 | 0.0 | Perfect reflection |
| Glass | 0.75 | 1.0 | 0.3 | 0.0 | Transparent + reflective |
| Gold | 1.0 | 1.0 | 1.0 | 0.05 | Warm tint + near-mirror |
| Metal | 1.0 | 0.7 | 1.0 | 0.2 | Brushed metal |
| Plastic | 1.0 | 0.2 | 0.0 | 0.4 | Diffuse + slight gloss |
| Wave | 0.22 | 0.9 | 0.15 | 0.0 | Water ripple effect |
| Original | — | — | — | — | GLB's own PBR materials |

All presets use PlayCanvas's `StandardMaterial` with `useMetalness = true` (metallic-roughness workflow, same as glTF 2.0).

---

## SLIDE 14 — Pointer Event Problem (Engineering Challenge)

**Heading:** Engineering: Pointer Capture Conflict

**Problem discovered:**  
PlayCanvas's `TranslateGizmo` / `RotateGizmo` listen on the `<canvas>` element. But our camera controller listens on the parent `canvas-container` div and calls `setPointerCapture()` on `pointerdown`.

```
pointerdown on canvas
  └─ bubbles up to canvas-container
      └─ camera calls setPointerCapture(pointerId)
          └─ ALL subsequent pointermove → canvas-container
              └─ gizmo on <canvas> never fires → object doesn't move!
```

**Fix:**
```typescript
// 1. Record pointerId in capture phase (before camera's bubble handler)
canvasContainer.addEventListener('pointerdown', (e) => {
    activePointerId = e.pointerId;
}, true);   // ← capture phase

// 2. On gizmo start: release camera's capture
gizmo.on('transform:start', () => {
    canvasContainer.releasePointerCapture(activePointerId);
    // 3. Block pointermove from bubbling to camera (no orbit)
    canvas.addEventListener('pointermove', blockMove, true);
});
```

---

## SLIDE 15 — System Summary

**Heading:** Complete System Architecture

```
User clicks "Add Mirror Sphere"
        │
        ▼
MeshElement.add()
  • Create PlayCanvas render component on meshLayer
  • Build StandardMaterial (metalness/roughness PBR)
  • captureReflection() after 200ms
        │
        ├── SSR available? → inject ssrChunk into material chunks
        │       per-frame: ray-march in screen space → dReflection
        │
        ├── SSR unavailable → captureReflectionProbe()
        │       6 async renders at object position
        │       → 6 equirect textures → pre-filtered envAtlas
        │       → mat.envAtlas = atlas
        │
        └── Probe failed → captureSceneEnv()
                single frame screen reproject → envAtlas (fallback)

User drags object with gizmo
  • transform:start → releasePointerCapture + block orbit
  • transform:move  → update transform panel
  • transform:end   → re-capture probe at new position
```

---

## SLIDE 16 — Results & Comparison

**Heading:** Visual Results

**Comparison table:**

| Method | Accuracy | Cost | Dynamic | Off-screen |
|--------|----------|------|---------|------------|
| SSR | High (on-screen only) | ~0ms/frame (GPU shader) | ✅ Yes | ❌ Black |
| Probe (6-face) | Full sphere | ~6 frames async | ✅ On move | ✅ Full |
| Fallback | Partial (1 direction) | ~1 frame | ❌ Manual | ❌ Black |

**Visual suggestion (4 screenshots side by side):**
1. No reflection (black)  
2. Screen fallback (partial)  
3. Probe IBL (full sphere, slightly stale)  
4. SSR (real-time, accurate for visible area)

---

## SLIDE 17 — Limitations & Future Work

**Heading:** Limitations & Future Work

**Current limitations:**
- SSR cannot reflect objects outside the camera frustum
- Probe re-bake takes ~6 rendered frames (brief screen freeze)
- No inter-mesh reflections (a mirror ball cannot reflect another mirror ball)
- GLB original materials are not IBL-enhanced (only layer assignment, no probe)

**Future work:**
| Idea | Benefit |
|------|---------|
| Temporal SSR (accumulate frames) | Reduce noise, hide screen-edge artifacts |
| Real-time cube-map render target | Fully live probe (no async bake) |
| Denoised probe blending | Smooth transition between old/new atlas on move |
| Planar reflections | Perfect floor/wall reflections with a reflection matrix |
| Multiple probes per scene | Different env for each mesh based on position |

---

## SLIDE 18 — Key Takeaways

**Heading:** What We Learned

1. **Render layers are the only correct way** to composite meshes over 3DGS — CSS z-index doesn't affect WebGL layer order

2. **3DGS is ideal for SSR** because the scene is already rasterised to a color buffer in screen space — no extra geometry needed

3. **PBR materials need a pre-filtered IBL atlas** — the split-sum approximation requires separate specular and diffuse terms baked at multiple roughness levels

4. **`setPointerCapture` breaks child-element interactivity** — always check which DOM element owns capture before adding event listeners to children

5. **A 3-tier fallback chain** gives robust results: SSR for real-time accuracy, probe for full-sphere coverage, screen capture for zero-cost startup

---

## SLIDE 19 — References

- **Kerbl et al. (2023)** — "3D Gaussian Splatting for Real-Time Radiance Field Rendering", ACM SIGGRAPH 2023  
- **Karis & Games (2013)** — "Real Shading in Unreal Engine 4" (split-sum PBR approximation), SIGGRAPH 2013 Course  
- **McGuire et al. (2017)** — "Screen-Space Ray Tracing", JCGT 2017  
- **Lagarde & de Rousiers (2014)** — "Moving Frostbite to Physically Based Rendering", SIGGRAPH 2014  
- **PlayCanvas Documentation** — TransformGizmo, StandardMaterial, EnvLighting API  
- **WebXR / Pointer Events MDN** — setPointerCapture / releasePointerCapture  

---

> **Presentation notes:**  
> Total slides: 19  
> Recommended order for 15-min talk: 1→2→3→4→5(brief)→6→7→9→10→13→15→16→18  
> For 30-min: all slides in order  
> Slides with code snippets: 4, 7, 9, 11, 12, 14, 15  
