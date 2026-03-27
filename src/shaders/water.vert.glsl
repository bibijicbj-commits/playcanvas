attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv0;

uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;

void main(void) {
    vec4 worldPos = matrix_model * vec4(aPosition, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize((matrix_model * vec4(aNormal, 0.0)).xyz);
    vUv = aUv0;
    gl_Position = matrix_viewProjection * worldPos;
}

