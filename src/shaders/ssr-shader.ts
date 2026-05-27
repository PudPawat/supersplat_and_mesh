/**
 * SSR replacement for PlayCanvas's reflectionEnvPS chunk.
 *
 * Drop-in override for StandardMaterial.chunks.reflectionEnvPS.
 * Keeps the same function signature: addReflection(vec3 reflDir, float gloss)
 *
 * Strategy — two-layer reflection:
 *
 *   1. Screen-Space Reflection (SSR): march from the fragment's screen UV
 *      toward the projected reflected direction.  When a non-background pixel
 *      is found the SSR color is used (real-time, updates every frame).
 *
 *   2. Probe fallback: if the reflected ray points off-screen (or behind the
 *      camera), fall back to the pre-captured envAtlas (probe) so the surface
 *      never shows solid black.  This calls the same atlas-sampling math as
 *      PlayCanvas's default reflectionEnvPS — all helper functions
 *      (cubeMapProject, toSphericalUv, mapShinyUv, mapRoughnessUv,
 *      processEnvironment) are provided by PlayCanvas's supporting chunks and
 *      are already in scope.
 *
 * Uniforms pushed per-frame from SSRPass.update:
 *   uSSRScene      - scene snapshot taken BEFORE mesh pass (no self-reflection)
 *   uSSRViewProj   - camera view-projection matrix
 *   uSSRScreenSize - viewport size in pixels
 */

// language=glsl
const ssrChunk = /* glsl */`

#ifndef ENV_ATLAS
#define ENV_ATLAS
    uniform sampler2D texture_envAtlas;
#endif
uniform sampler2D uSSRScene;
uniform mat4      uSSRViewProj;
uniform vec2      uSSRScreenSize;
uniform float     material_reflectivity;

// ── Probe fallback: replicate PlayCanvas calcReflection without shinyMipLevel ──
// (All dependencies — cubeMapProject, toSphericalUv, mapShinyUv, mapRoughnessUv,
//  processEnvironment, atlasSize — are injected by PlayCanvas's own chunks.)
vec3 ssrCalcReflection(vec3 reflDir, float gloss) {
    vec3 dir = cubeMapProject(reflDir) * vec3(-1.0, 1.0, 1.0);
    vec2 uv  = toSphericalUv(dir);

    float level  = saturate(1.0 - gloss) * 5.0;
    float ilevel = floor(level);
    float weight = level - ilevel;

    vec2 uv0, uv1;
    if (ilevel == 0.0) {
        // glossy range: blend between two shiny mip levels
        uv0 = mapShinyUv(uv, 0.0);
        uv1 = mapShinyUv(uv, 1.0);
    } else {
        // rough range: blend between two roughness mip levels
        uv0 = mapRoughnessUv(uv, ilevel);
        uv1 = mapRoughnessUv(uv, ilevel + 1.0);
    }

    vec3 c0 = texture2D(texture_envAtlas, uv0).rgb;
    vec3 c1 = texture2D(texture_envAtlas, uv1).rgb;
    return processEnvironment(mix(c0, c1, weight));
}

void addReflection(vec3 reflDir, float gloss) {

    // ── 1. Try screen-space reflection ──────────────────────────────────────
    vec2 fragUV  = gl_FragCoord.xy / uSSRScreenSize;
    vec4 reflClip = uSSRViewProj * vec4(vPositionW + reflDir * 20.0, 1.0);

    bool  ssrHit   = false;
    vec3  hitColor = vec3(0.0);
    float hitAlpha = 0.0;

    if (reflClip.w > 0.0) {
        vec2 reflUV   = (reflClip.xy / reflClip.w) * 0.5 + 0.5;
        vec2 dir      = reflUV - fragUV;
        float pixelDist = length(dir * uSSRScreenSize);

        float fSteps  = clamp(pixelDist * 0.25, 4.0, 48.0);
        vec2  stepUV  = dir / fSteps;

        for (int i = 1; i <= 48; i++) {
            if (float(i) > fSteps) break;

            vec2 sampleUV = fragUV + stepUV * float(i);
            if (sampleUV.x < 0.0 || sampleUV.x > 1.0 ||
                sampleUV.y < 0.0 || sampleUV.y > 1.0) break;

            vec3 c = texture2D(uSSRScene, sampleUV).rgb;

            // hit threshold — 3DGS scene is never pure black
            if (dot(c, vec3(1.0)) > 0.15) {
                hitColor = c;

                // fade near screen edges
                vec2 edgeD  = min(sampleUV, 1.0 - sampleUV);
                float edge  = smoothstep(0.0, 0.08, min(edgeD.x, edgeD.y));

                // fade for roughness (glossy = sharp, rough = faint)
                float glossFade = smoothstep(0.0, 0.6, gloss);

                hitAlpha = edge * glossFade;
                ssrHit   = true;
                break;
            }
        }
    }

    // ── 2. Compose: SSR hit overrides probe, otherwise fall back to probe ──
    if (ssrHit) {
        dReflection += vec4(hitColor, material_reflectivity * hitAlpha);
    } else {
        // Reflection ray missed screen-space — use probe envAtlas for full
        // 360° coverage so the surface never goes black.
        vec3 envColor = ssrCalcReflection(reflDir, gloss);
        dReflection  += vec4(envColor, material_reflectivity);
    }
}
`;

export { ssrChunk };
