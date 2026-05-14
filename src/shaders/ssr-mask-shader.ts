/**
 * SSR mask pass — renders mesh objects into a 2-channel RGBA8 buffer:
 *   R = reflectivity   (0..1)
 *   G = roughness      (0..1)
 *   B = metalness      (0..1)
 *   A = 1 if this pixel is a mesh object, 0 otherwise
 *
 * The SSR composite pass reads this mask to decide which pixels need
 * screen-space ray marching applied.
 */

const vertexShader = /* glsl */ `
    attribute vec3  vertex_position;
    attribute vec3  vertex_normal;

    uniform mat4 matrix_model;
    uniform mat4 matrix_viewProjection;
    uniform mat3 matrix_normal;

    varying vec3 vWorldNormal;

    void main() {
        vWorldNormal = normalize(matrix_normal * vertex_normal);
        gl_Position  = matrix_viewProjection * matrix_model * vec4(vertex_position, 1.0);
    }
`;

const fragmentShader = /* glsl */ `
    precision highp float;

    uniform float uReflectivity;
    uniform float uRoughness;
    uniform float uMetalness;

    varying vec3 vWorldNormal;

    void main() {
        gl_FragColor = vec4(uReflectivity, uRoughness, uMetalness, 1.0);
    }
`;

export { vertexShader, fragmentShader };
