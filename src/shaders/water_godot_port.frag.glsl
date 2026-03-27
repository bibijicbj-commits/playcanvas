precision highp float;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;

uniform sampler2D uNormalTex1;
uniform sampler2D uNormalTex2;
uniform vec2 uUvOffset1;
uniform vec2 uUvOffset2;
uniform float uUvScale1;
uniform float uUvScale2;
uniform float uNormalStrength1;
uniform float uNormalStrength2;

uniform vec3 uAlbedo;
uniform vec3 uAlbedo2;
uniform float uOpacity;
uniform float uDiffuseMix;
uniform float uEmissionStrength;

uniform vec3 uCameraPos;
uniform float uFresnelPower;
uniform float uReflectionStrength;
uniform float uSpecularStrength;
uniform float uRoughness;
uniform float uReflectionDistort;
uniform float uReflectionTint;

uniform sampler2D uReflectionTex;
uniform float uUseReflectionTex;
uniform sampler2D uSkyTex;
uniform float uUseSkyTex;
uniform samplerCube uSkyCube;
uniform float uUseSkyCube;
uniform vec2 uViewport;

#include "gammaPS"
#include "tonemappingPS"
#include "fogPS"

const float PI = 3.14159265359;

vec3 unpackNormal(vec3 c) {
    return normalize(c * 2.0 - 1.0);
}

vec2 dirToEquirectUv(vec3 dir) {
    vec3 d = normalize(dir);
    float u = atan(d.z, d.x) / (2.0 * PI) + 0.5;
    float v = acos(clamp(d.y, -1.0, 1.0)) / PI;
    return vec2(u, v);
}

float fresnelTerm(float amount, vec3 n, vec3 v) {
    return pow(1.0 - clamp(dot(normalize(n), normalize(v)), 0.0, 1.0), amount);
}

void main(void) {
    vec2 baseUv1 = vUv * uUvScale1 + uUvOffset1;
    vec2 baseUv2 = vUv * uUvScale2 + uUvOffset2;

    // Godot-like two-normal blend
    vec3 nTex1 = texture2D(uNormalTex1, baseUv1).rgb;
    vec3 nTex2 = texture2D(uNormalTex2, baseUv2).rgb;
    vec3 nMix = normalize(mix(nTex1, nTex2, 0.5));
    vec3 nTs = unpackNormal(nMix);
    vec2 wave = nTs.xy * (0.5 * (uNormalStrength1 + uNormalStrength2));

    vec3 N = normalize(vWorldNormal + vec3(wave.x, 0.0, wave.y));
    vec3 V = normalize(uCameraPos - vWorldPos);

    float fresnel = fresnelTerm(max(0.001, uFresnelPower), N, V);

    // Base water color follows godot structure: mix by fresnel
    float colorMix = clamp(fresnel * clamp(uDiffuseMix, 0.0, 1.0), 0.0, 1.0);
    vec3 waterCol = mix(uAlbedo, uAlbedo2, colorMix);

    // Reflection UV (screen-space like Godot planar reflection sampling)
    vec2 screenUv = gl_FragCoord.xy / max(uViewport, vec2(1.0));
    vec2 reflUv = screenUv + nTs.xy * uReflectionDistort * (0.35 + 0.65 * fresnel);
    reflUv = clamp(reflUv, vec2(0.001), vec2(0.999));

    vec3 reflCol = texture2D(uReflectionTex, reflUv).rgb;

    // Fallback reflections when planar reflection texture is not available
    vec3 reflectDir = reflect(-V, N);
    vec2 skyUv = dirToEquirectUv(reflectDir);
    vec3 skyTexCol = texture2D(uSkyTex, skyUv).rgb;
    vec3 skyCubeCol = textureCube(uSkyCube, reflectDir).rgb;
    vec3 skyFallback = mix(vec3(0.08, 0.20, 0.35), vec3(0.72, 0.84, 0.95), clamp(V.y * 0.5 + 0.5, 0.0, 1.0));
    skyFallback = mix(skyFallback, skyTexCol, clamp(uUseSkyTex, 0.0, 1.0));
    skyFallback = mix(skyFallback, skyCubeCol, clamp(uUseSkyCube, 0.0, 1.0));
    reflCol = mix(skyFallback, reflCol, clamp(uUseReflectionTex, 0.0, 1.0));

    // Reflection tint to embed reflection into water color
    reflCol = mix(reflCol, reflCol * waterCol, clamp(uReflectionTint, 0.0, 1.0));

    // Godot-like control feeling: specular + roughness control reflection energy
    float roughness = clamp(uRoughness, 0.0, 1.0);
    float reflectionWeight = clamp(uReflectionStrength, 0.0, 1.0) * fresnel;
    reflectionWeight *= clamp(uSpecularStrength, 0.0, 1.0);
    reflectionWeight *= (1.0 - 0.6 * roughness);

    vec3 finalCol = mix(waterCol, reflCol, clamp(reflectionWeight, 0.0, 1.0));

    // Keep normal mainly as dark detail (less bright wave crests)
    float waveDarken = clamp((1.0 - N.y) * (0.12 + 0.18 * clamp(0.5 * (uNormalStrength1 + uNormalStrength2), 0.0, 2.0)), 0.0, 0.45);
    finalCol *= (1.0 - waveDarken);

    finalCol += waterCol * max(0.0, uEmissionStrength);

    finalCol = addFog(finalCol);
    finalCol = toneMap(finalCol);
    finalCol = gammaCorrectOutput(finalCol);
    gl_FragColor = vec4(finalCol, uOpacity);
}

