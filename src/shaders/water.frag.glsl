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
uniform float uDiffuseMix;
uniform float uOpacity;

uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uReflectionStrength;
uniform float uSpecularStrength;
uniform float uSpecularPower;
uniform float uFresnelPower;
uniform float uFresnelRadius;
uniform float uFresnelFade;
uniform float uEmissionStrength;
uniform sampler2D uSkyTex;
uniform float uUseSkyTex;
uniform samplerCube uSkyCube;
uniform float uUseSkyCube;

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

void main(void) {
    vec2 uv1 = vUv * uUvScale1 + uUvOffset1;
    vec2 uv2 = vUv * uUvScale2 + uUvOffset2;

    vec3 n1 = unpackNormal(texture2D(uNormalTex1, uv1).xyz) * uNormalStrength1;
    vec3 n2 = unpackNormal(texture2D(uNormalTex2, uv2).xyz) * uNormalStrength2;
    vec2 wave = n1.xy + n2.xy;

    // Keep world normal unchanged when normal strengths are zero.
    vec3 N = normalize(vWorldNormal + vec3(wave.x, 0.0, wave.y));
    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 L = normalize(-uSunDir);
    vec3 H = normalize(L + V);

    float ndv = max(dot(N, V), 0.0001);
    float ndl = max(dot(N, L), 0.0);
    float ndh = max(dot(N, H), 0.0);
    float vdh = max(dot(V, H), 0.0);

    // Map legacy "shininess" control to a roughness-like value.
    float roughness = clamp(sqrt(2.0 / (uSpecularPower + 2.0)), 0.02, 1.0);
    float alpha = roughness * roughness;
    float alpha2 = alpha * alpha;

    // Specular/F0 from legacy Spec Str.
    float specular01 = clamp(uSpecularStrength, 0.0, 1.0);
    float F0 = mix(0.02, 0.12, specular01);
    float fresnel = F0 + (1.0 - F0) * pow(1.0 - ndv, max(1.0, uFresnelPower));

    // GGX-ish microfacet specular for stronger parameter response.
    float denom = ndh * ndh * (alpha2 - 1.0) + 1.0;
    float D = alpha2 / max(PI * denom * denom, 0.0001);
    float k = (roughness + 1.0);
    k = (k * k) / 8.0;
    float Gv = ndv / (ndv * (1.0 - k) + k);
    float Gl = ndl / max(ndl * (1.0 - k) + k, 0.0001);
    float Fh = F0 + (1.0 - F0) * pow(1.0 - vdh, 5.0);
    float spec = (D * Gv * Gl * Fh) / max(4.0 * ndv * max(ndl, 0.0001), 0.0001);

    // User-defined behavior:
    // center = albedo, outer area = albedo2.
    // Fresnel controls ring size, Fres Fade controls transition width.
    float distToCenter = distance(vWorldPos.xz, uCameraPos.xz);
    float ringRadius = max(1.0, uFresnelPower * max(1.0, uFresnelRadius));
    float ringHalfWidth = max(1.0, 0.5 * uFresnelFade);
    float ringMix = smoothstep(ringRadius - ringHalfWidth, ringRadius + ringHalfWidth, distToCenter);
    float diffuseMix = clamp(uDiffuseMix, 0.0, 1.0);
    float colorMix = clamp(ringMix * diffuseMix, 0.0, 1.0);
    vec3 baseColor = mix(uAlbedo, uAlbedo2, colorMix);
    float skyT = clamp(V.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 skyColorFallback = mix(vec3(0.08, 0.20, 0.35), vec3(0.72, 0.84, 0.95), skyT);
    vec3 reflectDir = reflect(-V, N);
    vec2 skyUv = dirToEquirectUv(reflectDir);
    vec3 skyColorTex = texture2D(uSkyTex, skyUv).rgb;
    vec3 skyColorCube = textureCube(uSkyCube, reflectDir).rgb;
    vec3 skyColor = skyColorFallback;
    skyColor = mix(skyColor, skyColorTex, clamp(uUseSkyTex, 0.0, 1.0));
    skyColor = mix(skyColor, skyColorCube, clamp(uUseSkyCube, 0.0, 1.0));

    // Reflection gain from legacy Reflect control, but never hard-zero to preserve normal response.
    float reflectionGain = 0.35 + 0.65 * clamp(uReflectionStrength * 0.5, 0.0, 1.0);
    float reflectionFactor = clamp(fresnel * (1.0 - 0.55 * roughness) * reflectionGain, 0.0, 1.0);
    // Pull reflection slightly toward baseColor to reduce gray/cyan washout.
    vec3 reflectedColor = mix(skyColor, baseColor, 0.22);
    vec3 color = mix(baseColor, reflectedColor, reflectionFactor);

    // Keep wave readability even when reflection is low.
    float hemi = clamp(0.5 + 0.5 * N.y, 0.0, 1.0);
    vec3 diffuseLight = mix(vec3(0.62), vec3(1.0), hemi) * (0.70 + 0.30 * ndl);
    color *= diffuseLight;
    color += uSunColor * spec;

    // Godot-like tendency: normals mainly add darker trough detail rather than bright crests.
    float normalAmp = clamp(0.5 * (uNormalStrength1 + uNormalStrength2), 0.0, 2.0);
    float waveTrough = clamp((1.0 - N.y) * 1.15, 0.0, 1.0);
    float waveDarken = waveTrough * (0.10 + 0.16 * normalAmp);
    color *= (1.0 - waveDarken);

    // Top-down view should read as deeper/darker water.
    float topViewMask = smoothstep(0.72, 0.98, ndv);
    color *= mix(1.0, 0.72, topViewMask);
    color = mix(color, color * uAlbedo, topViewMask * 0.25);
    color += baseColor * uEmissionStrength;

    color = addFog(color);
    color = toneMap(color);
    color = gammaCorrectOutput(color);
    gl_FragColor = vec4(color, uOpacity);
}
