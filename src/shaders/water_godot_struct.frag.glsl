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
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uFresnelPower;
uniform float uReflectionStrength;
uniform float uSpecularStrength;
uniform float uRoughness;
uniform float uReflectionDistort;
uniform float uReflectionTint;
uniform float uReflectionTexParamsEnabled;
uniform float uUseEnvReflection;

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

    // Follow the original Godot graph: mix two scrolling normal maps first.
    vec3 nTex1 = texture2D(uNormalTex1, baseUv1).rgb;
    vec3 nTex2 = texture2D(uNormalTex2, baseUv2).rgb;
    vec3 nMix = normalize(mix(nTex1, nTex2, 0.5));
    vec3 nTs = unpackNormal(nMix);
    float normalStrength = 0.5 * (uNormalStrength1 + uNormalStrength2);

    // Split the normals:
    // - Nf keeps Fresnel anchored to the camera / plane relationship
    // - Nd carries surface detail for reflection distortion and highlights
    vec3 Nf = normalize(vWorldNormal);
    vec3 Nd = normalize(vWorldNormal + vec3(nTs.x, 0.0, nTs.y) * (normalStrength * 0.65));
    vec3 V = normalize(uCameraPos - vWorldPos);

    float fresnel = fresnelTerm(max(0.001, uFresnelPower), Nf, V);

    // Match the Godot shader semantics: Fresnel directly blends the two water colors.
    vec3 waterCol = mix(uAlbedo, uAlbedo2, fresnel);

    vec2 screenUv = gl_FragCoord.xy / max(uViewport, vec2(1.0));
    vec2 reflUv = screenUv;
    if (uReflectionTexParamsEnabled > 0.5) {
        reflUv += nTs.xy * uReflectionDistort * (0.35 + 0.65 * fresnel);
    }
    reflUv = clamp(reflUv, vec2(0.001), vec2(0.999));

    vec3 reflectDir = reflect(-V, Nd);
    vec2 skyUv = dirToEquirectUv(reflectDir);
    vec3 skyTexCol = texture2D(uSkyTex, skyUv).rgb;
    vec3 skyCubeCol = textureCube(uSkyCube, reflectDir).rgb;
    vec3 skyFallback = mix(vec3(0.08, 0.20, 0.35), vec3(0.72, 0.84, 0.95), clamp(V.y * 0.5 + 0.5, 0.0, 1.0));
    skyFallback = mix(skyFallback, skyTexCol, clamp(uUseSkyTex, 0.0, 1.0));
    skyFallback = mix(skyFallback, skyCubeCol, clamp(uUseSkyCube, 0.0, 1.0));

    float roughness = clamp(uRoughness, 0.0, 1.0);
    float specular = clamp(uSpecularStrength, 0.0, 1.0);

    vec3 finalCol = waterCol;
    if (uUseEnvReflection > 0.5) {
        // Godot handles environment reflections in the spatial/PBR pipeline.
        // Keep this fallback weak so it only stands in for the missing engine path.
        float envReflectionWeight = fresnel * specular * 0.18 * (1.0 - 0.35 * roughness);
        finalCol = mix(finalCol, skyFallback, clamp(envReflectionWeight, 0.0, 1.0));
    }

    // reflection_tex is a separate content layer: distort / tint / strength only affect this path.
    if (uReflectionTexParamsEnabled > 0.5 && uUseReflectionTex > 0.5) {
        vec3 reflectionTexCol = texture2D(uReflectionTex, reflUv).rgb;
        reflectionTexCol = mix(reflectionTexCol, reflectionTexCol * waterCol, clamp(uReflectionTint, 0.0, 1.0));
        float reflectionTexWeight = clamp(uReflectionStrength, 0.0, 1.0) * fresnel;
        if (uUseEnvReflection <= 0.5) {
            reflectionTexWeight *= specular;
        }
        finalCol = mix(finalCol, reflectionTexCol, clamp(reflectionTexWeight, 0.0, 1.0));
    }

    // Godot spatial shader would continue through engine lighting; keep this approximation subtle.
    vec3 L = normalize(-uSunDir);
    vec3 H = normalize(L + V);
    float ndl = max(dot(Nd, L), 0.0);
    float ndh = max(dot(Nd, H), 0.0);
    float specPower = mix(72.0, 10.0, roughness);
    float sunSpec = pow(ndh, specPower) * specular * (1.0 - 0.65 * roughness) * 0.28;
    float hemi = clamp(0.5 + 0.5 * Nd.y, 0.0, 1.0);
    finalCol *= mix(vec3(0.76), vec3(1.0), hemi) * (0.86 + 0.14 * ndl);
    finalCol += uSunColor * sunSpec;
    finalCol += waterCol * max(0.0, uEmissionStrength);

    finalCol = addFog(finalCol);
    finalCol = toneMap(finalCol);
    finalCol = gammaCorrectOutput(finalCol);
    gl_FragColor = vec4(finalCol, uOpacity);
}
