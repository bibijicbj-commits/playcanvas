import * as pc from 'playcanvas';

export interface WaterLitConfig {
    diffuse: pc.Color;
    diffuse2: pc.Color;
    opacity: number;
    specular: number;
    gloss: number;
    fresnelPower: number;
    fresnelAffectsOpacity: boolean;
    useSkybox: boolean;
    normalMapEnabled: boolean;
    normalDetailMapEnabled: boolean;
    bumpiness: number;
    normalDetailMapBumpiness: number;
    normalUvScale: number;
    normalSpeed1: number;
    normalSpeed2: number;
    blendType: number;
    depthWrite: boolean;
    cull: number;
    useLighting: boolean;
    useFog: boolean;
}

export interface WaterLitResources {
    material: pc.StandardMaterial;
    applyConfig: (config: WaterLitConfig) => void;
    setNormalTextures: (normalA: pc.Texture | null, normalB: pc.Texture | null) => void;
}

const waterLitUserDeclarationPS = `
uniform vec3 uWaterDiffuse2;
uniform float uWaterFresnelPower;

float getWaterFresnel(vec3 normalW, vec3 viewDirW) {
    return pow(1.0 - clamp(dot(normalize(normalW), normalize(viewDirW)), 0.0, 1.0), max(0.001, uWaterFresnelPower));
}

vec3 applyWaterReflectionTint(vec3 reflectionColor, vec3 normalW, vec3 viewDirW) {
    float fresnel = getWaterFresnel(normalW, viewDirW);
    vec3 tintedReflection = reflectionColor * uWaterDiffuse2;
    return mix(reflectionColor, tintedReflection, fresnel);
}
`;

const waterLitForwardBackendPS = `
void evaluateBackend() {

    #ifdef LIT_SSAO
        litArgs_ao *= texture2DLod(ssaoTexture, gl_FragCoord.xy * ssaoTextureSizeInv, 0.0).r;
    #endif

    #ifdef LIT_NEEDS_NORMAL
        #ifdef LIT_SPECULAR
            getReflDir(litArgs_worldNormal, dViewDirW, litArgs_gloss, dTBN);
        #endif

        #ifdef LIT_CLEARCOAT
            ccReflDirW = normalize(-reflect(dViewDirW, litArgs_clearcoat_worldNormal));
        #endif
    #endif

    #ifdef LIT_SPECULAR_OR_REFLECTION
        #ifdef LIT_METALNESS
            float f0 = 1.0 / litArgs_ior;
            f0 = (f0 - 1.0) / (f0 + 1.0);
            f0 *= f0;
            #ifdef LIT_SPECULARITY_FACTOR
                litArgs_specularity = getSpecularModulate(litArgs_specularity, litArgs_albedo, litArgs_metalness, f0, litArgs_specularityFactor);
            #else
                litArgs_specularity = getSpecularModulate(litArgs_specularity, litArgs_albedo, litArgs_metalness, f0, 1.0);
            #endif
            litArgs_albedo = getAlbedoModulate(litArgs_albedo, litArgs_metalness);
        #endif

        #ifdef LIT_IRIDESCENCE
            vec3 iridescenceFresnel = getIridescence(saturate(dot(dViewDirW, litArgs_worldNormal)), litArgs_specularity, litArgs_iridescence_thickness);
        #endif
    #endif

    #ifdef LIT_ADD_AMBIENT
        addAmbient(litArgs_worldNormal);

        #ifdef LIT_SPECULAR
            dDiffuseLight = dDiffuseLight * (1.0 - litArgs_specularity);
        #endif

        #ifdef LIT_SEPARATE_AMBIENT
            vec3 dAmbientLight = dDiffuseLight;
            dDiffuseLight = vec3(0);
        #endif
    #endif

    #ifndef LIT_OLD_AMBIENT
        dDiffuseLight *= material_ambient;
    #endif

    #ifdef LIT_AO
        #ifndef LIT_OCCLUDE_DIRECT
            occludeDiffuse(litArgs_ao);
        #endif
    #endif

    #ifdef LIT_LIGHTMAP
        addLightMap(
            litArgs_lightmap,
            litArgs_lightmapDir,
            litArgs_worldNormal,
            dViewDirW,
            dReflDirW,
            litArgs_gloss,
            litArgs_specularity,
            dVertexNormalW,
            dTBN
        #if defined(LIT_IRIDESCENCE)
            , iridescenceFresnel,
            litArgs_iridescence_intensity
        #endif
        );
    #endif

    #ifdef LIT_LIGHTING || LIT_REFLECTIONS

        #ifdef LIT_REFLECTIONS

            #ifdef LIT_CLEARCOAT
                addReflectionCC(ccReflDirW, litArgs_clearcoat_gloss);

                #ifdef LIT_SPECULAR_FRESNEL
                    ccFresnel = getFresnelCC(dot(dViewDirW, litArgs_clearcoat_worldNormal));
                    ccReflection *= ccFresnel;
                #else
                    ccFresnel = 0.0;
                #endif
            #endif

            #ifdef LIT_SPECULARITY_FACTOR
                ccReflection *= litArgs_specularityFactor;
            #endif

            #ifdef LIT_SHEEN
                addReflectionSheen(litArgs_worldNormal, dViewDirW, litArgs_sheen_gloss);
            #endif

            addReflection(dReflDirW, litArgs_gloss);

        #endif

        #ifdef AREA_LIGHTS
            dSpecularLight *= litArgs_specularity;

            #ifdef LIT_SPECULAR
                calcLTCLightValues(litArgs_gloss, litArgs_worldNormal, dViewDirW, litArgs_specularity, litArgs_clearcoat_gloss, litArgs_clearcoat_worldNormal, litArgs_clearcoat_specularity);
            #endif
        #endif

        #ifdef LIGHT_COUNT > 0
            #include "lightEvaluationPS, LIGHT_COUNT"
        #endif

        #ifdef LIT_CLUSTERED_LIGHTS
            addClusteredLights(litArgs_worldNormal, dViewDirW, dReflDirW,
                #if defined(LIT_CLEARCOAT)
                        ccReflDirW,
                #endif
                        litArgs_gloss, litArgs_specularity, dVertexNormalW, dTBN,
                #if defined(LIT_IRIDESCENCE)
                        iridescenceFresnel,
                #endif
                        litArgs_clearcoat_worldNormal, litArgs_clearcoat_gloss, litArgs_sheen_gloss, litArgs_iridescence_intensity
            );
        #endif

        #ifdef AREA_LIGHTS

            #ifdef LIT_CLEARCOAT
                litArgs_clearcoat_specularity = 1.0;
            #endif

            #ifdef LIT_SPECULAR
                litArgs_specularity = vec3(1);
            #endif

        #endif

        #ifdef LIT_REFRACTION
            addRefraction(
                litArgs_worldNormal,
                dViewDirW,
                litArgs_thickness,
                litArgs_gloss,
                litArgs_specularity,
                litArgs_albedo,
                litArgs_transmission,
                litArgs_ior,
                litArgs_dispersion
                #if defined(LIT_IRIDESCENCE)
                    , iridescenceFresnel,
                    litArgs_iridescence_intensity
                #endif
            );
        #endif
    #endif

    #ifdef LIT_AO
        #ifdef LIT_OCCLUDE_DIRECT
            occludeDiffuse(litArgs_ao);
        #endif

        #if LIT_OCCLUDE_SPECULAR != NONE
            occludeSpecular(litArgs_gloss, litArgs_ao, litArgs_worldNormal, dViewDirW);
        #endif
    #endif

    #if !defined(LIT_OPACITY_FADES_SPECULAR)

        #if LIT_BLEND_TYPE == NORMAL || LIT_BLEND_TYPE == PREMULTIPLIED

            float specLum = dot((dSpecularLight + dReflection.rgb * dReflection.a), vec3( 0.2126, 0.7152, 0.0722 ));
            #ifdef LIT_CLEARCOAT
                specLum += dot(ccSpecularLight * litArgs_clearcoat_specularity + ccReflection * litArgs_clearcoat_specularity, vec3( 0.2126, 0.7152, 0.0722 ));
            #endif
            litArgs_opacity = clamp(litArgs_opacity + gammaCorrectInput(specLum), 0.0, 1.0);

        #endif

        litArgs_opacity *= material_alphaFade;

    #endif

    #ifdef LIT_LIGHTMAP_BAKING
        #ifdef LIT_LIGHTMAP_BAKING_COLOR
            #include "bakeLmEndPS"
        #endif
        #ifdef LIT_LIGHTMAP_BAKING_DIR
            #include "bakeDirLmEndPS"
        #endif
    #else
        #include "endPS"
        #include "outputAlphaPS"
    #endif

    #ifdef LIT_MSDF
        gl_FragColor = applyMsdf(gl_FragColor);
    #endif

    #include "outputPS"
    #include "debugOutputPS"

    #ifdef LIT_SHADOW_CATCHER
        gl_FragColor.rgb = vec3(dShadowCatcher);
    #endif
}
`;

const waterLitReflectionCubePS = `
uniform samplerCube texture_cubeMap;
uniform float material_reflectivity;

vec3 calcReflection(vec3 reflDir, float gloss) {
    vec3 lookupVec = cubeMapProject(reflDir);
    lookupVec.x *= -1.0;
    vec3 reflectionColor = {reflectionDecode}(textureCube(texture_cubeMap, lookupVec));
    return applyWaterReflectionTint(reflectionColor, dNormalW, dViewDirW);
}

void addReflection(vec3 reflDir, float gloss) {
    float fresnel = getWaterFresnel(dNormalW, dViewDirW);
    dReflection += vec4(calcReflection(reflDir, gloss), material_reflectivity * fresnel);
}
`;

const waterLitReflectionSpherePS = `
#ifndef VIEWMATRIX
    #define VIEWMATRIX
    uniform mat4 matrix_view;
#endif
uniform sampler2D texture_sphereMap;
uniform float material_reflectivity;

vec3 calcReflection(vec3 reflDir, float gloss) {
    vec3 reflDirV = (mat3(matrix_view) * reflDir);
    float m = 2.0 * sqrt(dot(reflDirV.xy, reflDirV.xy) + (reflDirV.z + 1.0) * (reflDirV.z + 1.0));
    vec2 sphereMapUv = reflDirV.xy / m + 0.5;
    vec3 reflectionColor = {reflectionDecode}(texture2D(texture_sphereMap, sphereMapUv));
    return applyWaterReflectionTint(reflectionColor, dNormalW, dViewDirW);
}

void addReflection(vec3 reflDir, float gloss) {
    float fresnel = getWaterFresnel(dNormalW, dViewDirW);
    dReflection += vec4(calcReflection(reflDir, gloss), material_reflectivity * fresnel);
}
`;

const waterLitReflectionEnvHQPS = `
#ifndef ENV_ATLAS
    #define ENV_ATLAS
    uniform sampler2D texture_envAtlas;
#endif
uniform samplerCube texture_cubeMap;
uniform float material_reflectivity;

vec3 calcReflection(vec3 reflDir, float gloss) {
    vec3 dir = cubeMapProject(reflDir) * vec3(-1.0, 1.0, 1.0);
    vec2 uv = toSphericalUv(dir);
    float level = saturate(1.0 - gloss) * 5.0;
    float ilevel = floor(level);
    float flevel = level - ilevel;

    vec3 sharp = {reflectionCubemapDecode}(textureCube(texture_cubeMap, dir));
    vec3 roughA = {reflectionDecode}(texture2D(texture_envAtlas, mapRoughnessUv(uv, ilevel)));
    vec3 roughB = {reflectionDecode}(texture2D(texture_envAtlas, mapRoughnessUv(uv, ilevel + 1.0)));
    vec3 reflectionColor = processEnvironment(mix(sharp, mix(roughA, roughB, flevel), min(level, 1.0)));
    return applyWaterReflectionTint(reflectionColor, dNormalW, dViewDirW);
}

void addReflection(vec3 reflDir, float gloss) {
    float fresnel = getWaterFresnel(dNormalW, dViewDirW);
    dReflection += vec4(calcReflection(reflDir, gloss), material_reflectivity * fresnel);
}
`;

const waterLitReflectionEnvPS = `
#ifndef ENV_ATLAS
#define ENV_ATLAS
    uniform sampler2D texture_envAtlas;
#endif
uniform float material_reflectivity;

float shinyMipLevel(vec2 uv) {
    vec2 dx = dFdx(uv);
    vec2 dy = dFdy(uv);
    vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
    vec2 dx2 = dFdx(uv2);
    vec2 dy2 = dFdy(uv2);
    float maxd = min(max(dot(dx, dx), dot(dy, dy)), max(dot(dx2, dx2), dot(dy2, dy2)));
    return clamp(0.5 * log2(maxd) - 1.0 + textureBias, 0.0, 5.0);
}

vec3 calcReflection(vec3 reflDir, float gloss) {
    vec3 dir = cubeMapProject(reflDir) * vec3(-1.0, 1.0, 1.0);
    vec2 uv = toSphericalUv(dir);
    float level = saturate(1.0 - gloss) * 5.0;
    float ilevel = floor(level);
    float level2 = shinyMipLevel(uv * atlasSize);
    float ilevel2 = floor(level2);

    vec2 uv0;
    vec2 uv1;
    float weight;
    if (ilevel == 0.0) {
        uv0 = mapShinyUv(uv, ilevel2);
        uv1 = mapShinyUv(uv, ilevel2 + 1.0);
        weight = level2 - ilevel2;
    } else {
        uv0 = uv1 = mapRoughnessUv(uv, ilevel);
        weight = 0.0;
    }

    vec3 linearA = {reflectionDecode}(texture2D(texture_envAtlas, uv0));
    vec3 linearB = {reflectionDecode}(texture2D(texture_envAtlas, uv1));
    vec3 linear0 = mix(linearA, linearB, weight);
    vec3 linear1 = {reflectionDecode}(texture2D(texture_envAtlas, mapRoughnessUv(uv, ilevel + 1.0)));
    vec3 reflectionColor = processEnvironment(mix(linear0, linear1, level - ilevel));
    return applyWaterReflectionTint(reflectionColor, dNormalW, dViewDirW);
}

void addReflection(vec3 reflDir, float gloss) {
    float fresnel = getWaterFresnel(dNormalW, dViewDirW);
    dReflection += vec4(calcReflection(reflDir, gloss), material_reflectivity * fresnel);
}
`;

export function createWaterLitMaterialSystem(
    app: pc.Application,
    _mainCamera: pc.Entity,
    _waterY: number
): WaterLitResources {
    const material = new pc.StandardMaterial();
    material.name = 'WaterSurfaceDefaultLitMaterial';
    material.useLighting = true;
    material.useSkybox = true;
    material.useFog = true;
    material.useMetalness = false;
    material.enableGGXSpecular = true;
    material.glossInvert = false;
    material.cull = pc.CULLFACE_NONE;
    material.blendType = pc.BLEND_NORMAL;
    material.depthWrite = false;
    material.diffuse.set(0.02, 0.14, 0.25);
    material.opacity = 0.9;
    material.specular.set(0.5, 0.5, 0.5);
    material.gloss = 0.98;
    material.bumpiness = 1.0;
    material.normalDetailMapBumpiness = 1.0;
    material.fresnelModel = pc.FRESNEL_NONE;
    material.shaderChunksVersion = pc.CHUNKAPI_2_8;
    material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('litUserDeclarationPS', waterLitUserDeclarationPS);
    material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('litForwardBackendPS', waterLitForwardBackendPS);
    material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('reflectionCubePS', waterLitReflectionCubePS);
    material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('reflectionSpherePS', waterLitReflectionSpherePS);
    material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('reflectionEnvHQPS', waterLitReflectionEnvHQPS);
    material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('reflectionEnvPS', waterLitReflectionEnvPS);
    material.update();

    let normalMapTexture: pc.Texture | null = null;
    let normalDetailMapTexture: pc.Texture | null = null;
    const normalTiling = new pc.Vec2(1, 1);
    const normalMapOffset = new pc.Vec2(0, 0);
    const normalDetailMapOffset = new pc.Vec2(0, 0);
    const waveDir1 = new pc.Vec2(2.0, 0.0).normalize();
    const waveDir2 = new pc.Vec2(0.0, 1.0).normalize();
    let waveSpeed1 = 0.0125;
    let waveSpeed2 = 0.0175;
    let materialConfigApplied = false;

    const applyConfig = (config: WaterLitConfig) => {
        const normalUvScale = Math.max(0.01, config.normalUvScale);
        waveSpeed1 = config.normalSpeed1;
        waveSpeed2 = config.normalSpeed2;
        normalTiling.set(normalUvScale, normalUvScale);
        material.diffuse.copy(config.diffuse);
        material.setParameter('uWaterDiffuse2', [config.diffuse2.r, config.diffuse2.g, config.diffuse2.b]);
        material.setParameter('uWaterFresnelPower', config.fresnelPower);
        material.opacity = config.opacity;
        material.gloss = Math.min(1, Math.max(0, config.gloss));
        material.specular.set(config.specular, config.specular, config.specular);
        material.useSkybox = config.useSkybox;
        material.normalMap = config.normalMapEnabled ? normalMapTexture : null;
        material.normalDetailMap = config.normalDetailMapEnabled ? normalDetailMapTexture : null;
        material.normalMapTiling = normalTiling;
        material.normalDetailMapTiling = normalTiling;
        material.normalMapOffset = normalMapOffset;
        material.normalDetailMapOffset = normalDetailMapOffset;
        material.bumpiness = config.bumpiness;
        material.normalDetailMapBumpiness = config.normalDetailMapBumpiness;
        material.blendType = config.blendType;
        material.depthWrite = config.depthWrite;
        material.cull = config.cull;
        material.useLighting = config.useLighting;
        material.useFog = config.useFog;
        materialConfigApplied = true;
        material.update();
    };

    const setNormalTextures = (normalA: pc.Texture | null, normalB: pc.Texture | null) => {
        normalMapTexture = normalA;
        normalDetailMapTexture = normalB;
    };

    app.on('update', (dt: number) => {
        if (!materialConfigApplied) {
            return;
        }

        normalMapOffset.x = (normalMapOffset.x + waveDir1.x * waveSpeed1 * dt) % 1;
        normalMapOffset.y = (normalMapOffset.y + waveDir1.y * waveSpeed1 * dt) % 1;
        normalDetailMapOffset.x = (normalDetailMapOffset.x + waveDir2.x * waveSpeed2 * dt) % 1;
        normalDetailMapOffset.y = (normalDetailMapOffset.y + waveDir2.y * waveSpeed2 * dt) % 1;

        if (normalMapOffset.x < 0) normalMapOffset.x += 1;
        if (normalMapOffset.y < 0) normalMapOffset.y += 1;
        if (normalDetailMapOffset.x < 0) normalDetailMapOffset.x += 1;
        if (normalDetailMapOffset.y < 0) normalDetailMapOffset.y += 1;

        material.normalMapOffset = normalMapOffset;
        material.normalDetailMapOffset = normalDetailMapOffset;
        material.update();
    });

    return {
        material,
        applyConfig,
        setNormalTextures
    };
}
