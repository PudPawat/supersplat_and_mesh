/**
 * SSR replacement for PlayCanvas's reflectionEnvPS chunk.
 *
 * Drop-in override for StandardMaterial.chunks.reflectionEnvPS.
 * Keeps the same function signature: addReflection(vec3 reflDir, float gloss)
 *
 * How it works per fragment:
 *   1. Current screen-space UV = gl_FragCoord / screenSize
 *   2. Project (worldPos + reflDir) → screen to get the reflected UV target
 *   3. March from current UV toward the reflected UV in small screen-space steps
 *   4. First step that hits a non-background pixel = the reflected color
 *   5. Edge-fade and gloss-fade the result, add to dReflection
 *
 * Uniforms (set per-frame from SSRPass.update):
 *   uSSRScene      - scene color buffer captured BEFORE mesh objects render (no self-reflection)
 *   uSSRViewProj   - current camera view-projection matrix
 *   uSSRScreenSize - viewport dimensions in pixels
 */

// language=glsl
const ssrChunk = /* glsl */`

uniform sampler2D uSSRScene;
uniform mat4      uSSRViewProj;
uniform vec2      uSSRScreenSize;
uniform float     material_reflectivity;

void addReflection(vec3 reflDir, float gloss) {

    // current fragment screen UV (0..1)
    vec2 fragUV = gl_FragCoord.xy / uSSRScreenSize;

    // project a point along the reflection ray to get target screen UV
    vec4 reflClip = uSSRViewProj * vec4(vPositionW + reflDir * 20.0, 1.0);
    if (reflClip.w <= 0.0) return;
    vec2 reflUV = (reflClip.xy / reflClip.w) * 0.5 + 0.5;

    vec2 dir = reflUV - fragUV;
    float pixelDist = length(dir * uSSRScreenSize);

    // adaptive step count — more steps for long rays, max 48
    float fSteps = clamp(pixelDist * 0.25, 4.0, 48.0);
    vec2  stepUV = dir / fSteps;

    vec3  hitColor = vec3(0.0);
    float hitAlpha = 0.0;

    for (int i = 1; i <= 48; i++) {
        if (float(i) > fSteps) break;

        vec2 sampleUV = fragUV + stepUV * float(i);

        // bail if we march off-screen
        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 ||
            sampleUV.y < 0.0 || sampleUV.y > 1.0) break;

        vec3 c = texture2D(uSSRScene, sampleUV).rgb;

        // hit threshold — 3DGS scene is never pure black
        if (dot(c, vec3(1.0)) > 0.15) {
            hitColor = c;

            // fade near screen edges
            vec2 edgeD = min(sampleUV, 1.0 - sampleUV);
            float edge  = smoothstep(0.0, 0.08, min(edgeD.x, edgeD.y));

            // fade for high roughness (glossy = sharp, rough = faint)
            float glossFade = smoothstep(0.0, 0.6, gloss);

            hitAlpha = edge * glossFade;
            break;
        }
    }

    dReflection += vec4(hitColor, material_reflectivity * hitAlpha);
}
`;

export { ssrChunk };
