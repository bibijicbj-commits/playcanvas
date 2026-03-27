import * as pc from 'playcanvas';
import { MapCameraControl, type MapCameraControlSettings } from './MapCameraControl.js';
import { applyLegacyMaterialsToEntity } from './legacyMaterialLoader.js';
import { createWaterLitMaterialSystem } from './waterLitMaterial.js';
import {
    CAMERA_CONFIG_STORAGE_KEY,
    clearStoredCameraDebugConfig,
    cloneCameraDebugConfig,
    defaultCameraDebugConfig,
    loadStoredCameraDebugConfig,
    saveStoredCameraDebugConfig
} from './cameraConfig.js';

const canvas = document.getElementById('application') as HTMLCanvasElement | null;

if (!canvas) {
    throw new Error('Canvas element #application was not found.');
}

const app = new pc.Application(canvas, {
    keyboard: new pc.Keyboard(window),
    mouse: new pc.Mouse(document.body),
    touch: new pc.TouchDevice(document.body)
});

app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);

window.addEventListener('resize', () => app.resizeCanvas());

app.start();

app.scene.ambientLight = new pc.Color(0.08, 0.1, 0.12);
app.scene.skyboxIntensity = 1.08;
app.scene.skyboxMip = 0;
app.scene.exposure = 1.35;

// Global fog chunk override: add a screen-space "fog hole" mask.
// Use ShaderChunks.get(...).set(...) so current PlayCanvas versions apply it globally.
const fogChunkWithHoleGLSL = `
float dBlendModeFogFactor = 1.0;
#if (FOG != NONE)
    uniform vec3 fog_color;
    #if (FOG == LINEAR)
        uniform float fog_start;
        uniform float fog_end;
    #else
        uniform float fog_density;
    #endif
#endif

uniform vec4 uFogHoleParams;   // x:inner, y:outer, z:strength, w:enabled(0/1)
uniform vec2 uFogHoleCenter;   // normalized screen UV
uniform vec2 uFogHoleViewport; // screen width/height
uniform float uFogHoleActive;  // runtime top-view activation [0..1]
uniform vec2 uFogHoleScale;    // x/y scale for ellipse control

float getFogFactor() {
    float depth = gl_FragCoord.z / gl_FragCoord.w;
    float fogFactor = 0.0;
    #if (FOG == LINEAR)
        fogFactor = (fog_end - depth) / (fog_end - fog_start);
    #elif (FOG == EXP)
        fogFactor = exp(-depth * fog_density);
    #elif (FOG == EXP2)
        fogFactor = exp(-depth * depth * fog_density * fog_density);
    #endif
    return clamp(fogFactor, 0.0, 1.0);
}

vec3 addFog(vec3 color) {
    #if (FOG != NONE)
        float fogFactor = getFogFactor();
        float holeBoost = 0.0;
        if (uFogHoleParams.w > 0.5 && uFogHoleActive > 0.001 && uFogHoleViewport.x > 1.0 && uFogHoleViewport.y > 1.0) {
            vec2 uv = gl_FragCoord.xy / uFogHoleViewport;
            vec2 delta = uv - uFogHoleCenter;
            float sx = max(0.0001, uFogHoleScale.x);
            float sy = max(0.0001, uFogHoleScale.y);
            float aspect = uFogHoleViewport.x / max(1.0, uFogHoleViewport.y);
            delta.x *= aspect * sx;
            delta.y *= sy;
            float d = length(delta);
            float outer = max(uFogHoleParams.y, uFogHoleParams.x + 0.0001);
            float hole = 1.0 - smoothstep(uFogHoleParams.x, outer, d);
            holeBoost = hole * clamp(uFogHoleParams.z, 0.0, 1.0) * clamp(uFogHoleActive, 0.0, 1.0);
        }
        float fogFactorAdjusted = clamp(fogFactor + holeBoost, 0.0, 1.0);
        return mix(fog_color * dBlendModeFogFactor, color, fogFactorAdjusted);
    #endif
    return color;
}
`;

const fogChunkWithHoleWGSL = `
var<private> dBlendModeFogFactor : f32 = 1.0;
#if (FOG != NONE)
    uniform fog_color : vec3f;
    #if (FOG == LINEAR)
        uniform fog_start : f32;
        uniform fog_end : f32;
    #else
        uniform fog_density : f32;
    #endif
#endif

uniform uFogHoleParams : vec4f;
uniform uFogHoleCenter : vec2f;
uniform uFogHoleViewport : vec2f;
uniform uFogHoleActive : f32;
uniform uFogHoleScale : vec2f;

fn getFogFactor() -> f32 {
    let depth = pcPosition.z / pcPosition.w;
    var fogFactor : f32 = 0.0;
    #if (FOG == LINEAR)
        fogFactor = (uniform.fog_end - depth) / (uniform.fog_end - uniform.fog_start);
    #elif (FOG == EXP)
        fogFactor = exp(-depth * uniform.fog_density);
    #elif (FOG == EXP2)
        fogFactor = exp(-depth * depth * uniform.fog_density * uniform.fog_density);
    #endif
    return clamp(fogFactor, 0.0, 1.0);
}

fn addFog(color : vec3f) -> vec3f {
    #if (FOG != NONE)
        var fogFactor = getFogFactor();
        var holeBoost : f32 = 0.0;
        if (uniform.uFogHoleParams.w > 0.5 && uniform.uFogHoleActive > 0.001 && uniform.uFogHoleViewport.x > 1.0 && uniform.uFogHoleViewport.y > 1.0) {
            let uv = pcPosition.xy / uniform.uFogHoleViewport;
            var delta = uv - uniform.uFogHoleCenter;
            let sx = max(0.0001, uniform.uFogHoleScale.x);
            let sy = max(0.0001, uniform.uFogHoleScale.y);
            let aspect = uniform.uFogHoleViewport.x / max(1.0, uniform.uFogHoleViewport.y);
            delta.x = delta.x * aspect * sx;
            delta.y = delta.y * sy;
            let d = length(delta);
            let outer = max(uniform.uFogHoleParams.y, uniform.uFogHoleParams.x + 0.0001);
            let hole = 1.0 - smoothstep(uniform.uFogHoleParams.x, outer, d);
            holeBoost = hole * clamp(uniform.uFogHoleParams.z, 0.0, 1.0) * clamp(uniform.uFogHoleActive, 0.0, 1.0);
        }
        let fogFactorAdjusted = clamp(fogFactor + holeBoost, 0.0, 1.0);
        return mix(uniform.fog_color * dBlendModeFogFactor, color, fogFactorAdjusted);
    #else
        return color;
    #endif
}
`;

pc.ShaderChunks.get(app.graphicsDevice, pc.SHADERLANGUAGE_GLSL).set('fogPS', fogChunkWithHoleGLSL);
pc.ShaderChunks.get(app.graphicsDevice, pc.SHADERLANGUAGE_WGSL).set('fogPS', fogChunkWithHoleWGSL);

const loadImage = (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load image: ${url}`));
        image.src = url;
    });

const loadIsolatedTexture = async (url: string, srgb: boolean) => {
    const image = await loadImage(url);
    const texture = new pc.Texture(app.graphicsDevice, {
        name: `isolated:${url}`,
        width: image.width,
        height: image.height,
        format: pc.PIXELFORMAT_RGBA8,
        mipmaps: true,
        minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
        magFilter: pc.FILTER_LINEAR,
        anisotropy: 4,
        addressU: pc.ADDRESS_REPEAT,
        addressV: pc.ADDRESS_REPEAT
    });
    texture.srgb = srgb;
    texture.setSource(image);
    return texture;
};

const loadClampColorTexture = async (url: string) => {
    const image = await loadImage(url);
    const texture = new pc.Texture(app.graphicsDevice, {
        name: `clamp-color:${url}`,
        width: image.width,
        height: image.height,
        format: pc.PIXELFORMAT_RGBA8,
        mipmaps: true,
        minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
        magFilter: pc.FILTER_LINEAR,
        anisotropy: 4,
        addressU: pc.ADDRESS_CLAMP_TO_EDGE,
        addressV: pc.ADDRESS_CLAMP_TO_EDGE
    });
    texture.srgb = true;
    texture.setSource(image);
    return texture;
};

const fract = (x: number) => x - Math.floor(x);
const smoothstep01 = (t: number) => t * t * (3 - 2 * t);

const positiveMod = (v: number, m: number) => ((v % m) + m) % m;

const hash2 = (x: number, y: number, seed: number) => {
    const n = (x * 374761393 + y * 668265263 + seed * 69069) | 0;
    return fract(Math.sin(n) * 43758.5453123);
};

const gradient2 = (x: number, y: number, seed: number) => {
    const a = hash2(x, y, seed) * Math.PI * 2;
    return { x: Math.cos(a), y: Math.sin(a) };
};

// Periodic Perlin noise in [-1, 1], seamless for integer periodX/periodY.
const perlin2DPeriodic = (
    x: number,
    y: number,
    seed: number,
    periodX: number,
    periodY: number
) => {
    const xi0 = Math.floor(x);
    const yi0 = Math.floor(y);
    const xf = x - xi0;
    const yf = y - yi0;

    const ix0 = positiveMod(xi0, periodX);
    const iy0 = positiveMod(yi0, periodY);
    const ix1 = positiveMod(xi0 + 1, periodX);
    const iy1 = positiveMod(yi0 + 1, periodY);

    const g00 = gradient2(ix0, iy0, seed);
    const g10 = gradient2(ix1, iy0, seed);
    const g01 = gradient2(ix0, iy1, seed);
    const g11 = gradient2(ix1, iy1, seed);

    const d00 = g00.x * xf + g00.y * yf;
    const d10 = g10.x * (xf - 1) + g10.y * yf;
    const d01 = g01.x * xf + g01.y * (yf - 1);
    const d11 = g11.x * (xf - 1) + g11.y * (yf - 1);

    const u = smoothstep01(xf);
    const v = smoothstep01(yf);
    const nx0 = d00 + (d10 - d00) * u;
    const nx1 = d01 + (d11 - d01) * u;
    return nx0 + (nx1 - nx0) * v;
};

const createRidgedNormalTexture = (
    graphicsDevice: pc.GraphicsDevice,
    width: number,
    height: number,
    options: {
        seed: number;
        frequency: number;
        octaves: number;
        lacunarity: number;
        gain: number;
        bumpStrength: number;
    }
) => {
    const heights = new Float32Array(width * height);
    const amplitudeNormalization = (() => {
        let amp = 1;
        let sum = 0;
        for (let i = 0; i < options.octaves; i += 1) {
            sum += amp;
            amp *= options.gain;
        }
        return sum > 0 ? sum : 1;
    })();

    const basePeriodX = Math.max(1, Math.round(width * options.frequency));
    const basePeriodY = Math.max(1, Math.round(height * options.frequency));

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const u = x / width;
            const v = y / height;
            let amp = 1;
            let h = 0;
            let periodX = basePeriodX;
            let periodY = basePeriodY;
            for (let octave = 0; octave < options.octaves; octave += 1) {
                const sx = u * periodX;
                const sy = v * periodY;
                const n = perlin2DPeriodic(sx, sy, options.seed + octave * 131, periodX, periodY);
                const ridged = 1 - Math.abs(n);
                h += ridged * amp;
                periodX = Math.max(1, Math.round(periodX * options.lacunarity));
                periodY = Math.max(1, Math.round(periodY * options.lacunarity));
                amp *= options.gain;
            }
            heights[y * width + x] = h / amplitudeNormalization;
        }
    }

    const wrap = (v: number, max: number) => {
        if (v < 0) return v + max;
        if (v >= max) return v - max;
        return v;
    };

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('2D context unavailable for procedural normal texture.');
    }
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const xm = wrap(x - 1, width);
            const xp = wrap(x + 1, width);
            const ym = wrap(y - 1, height);
            const yp = wrap(y + 1, height);

            const hL = heights[y * width + xm];
            const hR = heights[y * width + xp];
            const hD = heights[ym * width + x];
            const hU = heights[yp * width + x];

            const dx = (hR - hL) * options.bumpStrength;
            const dy = (hU - hD) * options.bumpStrength;
            const invLen = 1 / Math.sqrt(dx * dx + dy * dy + 1);
            const nx = -dx * invLen;
            const ny = -dy * invLen;
            const nz = 1 * invLen;

            const index = (y * width + x) * 4;
            data[index + 0] = Math.round((nx * 0.5 + 0.5) * 255);
            data[index + 1] = Math.round((ny * 0.5 + 0.5) * 255);
            data[index + 2] = Math.round((nz * 0.5 + 0.5) * 255);
            data[index + 3] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);

    const texture = new pc.Texture(graphicsDevice, {
        name: `ridged-normal-${options.seed}`,
        width,
        height,
        format: pc.PIXELFORMAT_RGBA8,
        mipmaps: true,
        minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
        magFilter: pc.FILTER_LINEAR,
        anisotropy: 8,
        addressU: pc.ADDRESS_REPEAT,
        addressV: pc.ADDRESS_REPEAT
    });
    texture.srgb = false;
    texture.setSource(canvas);
    return texture;
};

let legacySkyboxCubemap: pc.Texture | null = null;

const applyLegacySkybox = async () => {
    const sourceImage = await loadImage('/skybox/source.png');
    const sourceTexture = new pc.Texture(app.graphicsDevice, {
        name: 'legacy-skybox-source',
        width: sourceImage.width,
        height: sourceImage.height,
        format: pc.PIXELFORMAT_RGBA8,
        // source.png is LDR; using RGBM here darkens the whole env/reflection unexpectedly.
        type: pc.TEXTURETYPE_DEFAULT,
        projection: pc.TEXTUREPROJECTION_EQUIRECT,
        mipmaps: false,
        minFilter: pc.FILTER_LINEAR,
        magFilter: pc.FILTER_LINEAR,
        anisotropy: 4,
        addressU: pc.ADDRESS_CLAMP_TO_EDGE,
        addressV: pc.ADDRESS_CLAMP_TO_EDGE
    });
    sourceTexture.setSource(sourceImage);

    const skyboxCubemap = pc.EnvLighting.generateSkyboxCubemap(sourceTexture, 512);
    const lightingSource = pc.EnvLighting.generateLightingSource(sourceTexture, {
        size: 256
    });
    const envAtlas = pc.EnvLighting.generatePrefilteredAtlas([lightingSource], {
        size: 512
    });

    app.scene.setSkybox([skyboxCubemap, envAtlas]);
    legacySkyboxCubemap = skyboxCubemap;
};

void applyLegacySkybox().catch((error) => {
    console.error('Failed to apply legacy skybox.', error);
});

const WATER_CONFIG_STORAGE_KEY = 'playcanvas-shader-lab.water-config';
const EFFECTS_CONFIG_STORAGE_KEY = 'playcanvas-shader-lab.effects-config';

interface WaterDebugConfig {
    diffuseR: number;
    diffuseG: number;
    diffuseB: number;
    diffuse2R: number;
    diffuse2G: number;
    diffuse2B: number;
    underwaterOccluderEnabled: number;
    useSkybox: number;
    specular: number;
    gloss: number;
    fresnelPower: number;
    fresnelAffectsOpacity: number;
    normalMapEnabled: number;
    normalDetailMapEnabled: number;
    opacity: number;
    bumpiness: number;
    normalDetailMapBumpiness: number;
    normalUvScale: number;
    normalSpeed1: number;
    normalSpeed2: number;
    blendType: number;
    depthWrite: number;
    cull: number;
    useLighting: number;
    useFog: number;
}

const defaultWaterDebugConfig: WaterDebugConfig = {
    diffuseR: 1.0,
    diffuseG: 0.0,
    diffuseB: 0.0,
    diffuse2R: 0.0,
    diffuse2G: 1.0,
    diffuse2B: 0.0,
    underwaterOccluderEnabled: 0,
    useSkybox: 0,
    specular: 0.0,
    gloss: 0.0,
    fresnelPower: 1.0,
    fresnelAffectsOpacity: 0,
    normalMapEnabled: 0,
    normalDetailMapEnabled: 0,
    opacity: 1.0,
    bumpiness: 1.0,
    normalDetailMapBumpiness: 1.0,
    normalUvScale: 1.0,
    normalSpeed1: 0.0125,
    normalSpeed2: 0.0175,
    blendType: pc.BLEND_NORMAL,
    depthWrite: 0,
    cull: pc.CULLFACE_NONE,
    useLighting: 1,
    useFog: 0
};

const cloneWaterDebugConfig = (source: WaterDebugConfig): WaterDebugConfig => ({ ...source });

const loadStoredWaterDebugConfig = (): WaterDebugConfig | null => {
    try {
        const raw = window.localStorage.getItem(WATER_CONFIG_STORAGE_KEY);
        if (!raw) {
            return null;
        }

        const parsed = JSON.parse(raw) as Partial<WaterDebugConfig>;
        const next = cloneWaterDebugConfig(defaultWaterDebugConfig);
        for (const key of Object.keys(defaultWaterDebugConfig) as Array<keyof WaterDebugConfig>) {
            const value = parsed[key];
            if (typeof value === 'number' && Number.isFinite(value)) {
                next[key] = value;
            }
        }
        return next;
    } catch {
        return null;
    }
};

const saveStoredWaterDebugConfig = (config: WaterDebugConfig) => {
    window.localStorage.setItem(WATER_CONFIG_STORAGE_KEY, JSON.stringify(config));
};

const clearStoredWaterDebugConfig = () => {
    window.localStorage.removeItem(WATER_CONFIG_STORAGE_KEY);
};

interface EffectsDebugConfig {
    exposure: number;
    skyboxIntensity: number;
    skyboxMip: number;
    ambientR: number;
    ambientG: number;
    ambientB: number;
    sceneFogEnabled: number;
    sceneFogMode: number; // 0=linear, 1=exp, 2=exp2
    fogStart: number;
    fogEnd: number;
    fogDensity: number;
    fogR: number;
    fogG: number;
    fogB: number;
    fogHoleEnabled: number;
    fogHoleInner: number;
    fogHoleOuter: number;
    fogHoleStrength: number;
    fogHoleScaleX: number;
    fogHoleScaleY: number;
    fogHoleTopDotMin: number;
    fogHoleHeightMin: number;
    fogHoleHeightFade: number;
}

const defaultEffectsDebugConfig: EffectsDebugConfig = {
    exposure: 1.35,
    skyboxIntensity: 1.08,
    skyboxMip: 0,
    ambientR: 0.08,
    ambientG: 0.1,
    ambientB: 0.12,
    sceneFogEnabled: 0,
    sceneFogMode: 0,
    fogStart: 900,
    fogEnd: 3800,
    fogDensity: 0.00045,
    fogR: 0.8,
    fogG: 0.86,
    fogB: 0.94,
    fogHoleEnabled: 1,
    fogHoleInner: 0.18,
    fogHoleOuter: 0.42,
    fogHoleStrength: 1.0,
    fogHoleScaleX: 1.0,
    fogHoleScaleY: 1.0,
    fogHoleTopDotMin: 0.9,
    fogHoleHeightMin: 180,
    fogHoleHeightFade: 80
};

const cloneEffectsDebugConfig = (source: EffectsDebugConfig): EffectsDebugConfig => ({ ...source });

const loadStoredEffectsDebugConfig = (): EffectsDebugConfig | null => {
    try {
        const raw = window.localStorage.getItem(EFFECTS_CONFIG_STORAGE_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw) as Partial<EffectsDebugConfig>;
        const next = cloneEffectsDebugConfig(defaultEffectsDebugConfig);
        for (const key of Object.keys(defaultEffectsDebugConfig) as Array<keyof EffectsDebugConfig>) {
            const value = parsed[key];
            if (typeof value === 'number' && Number.isFinite(value)) {
                next[key] = value;
            }
        }
        return next;
    } catch {
        return null;
    }
};

const saveStoredEffectsDebugConfig = (config: EffectsDebugConfig) => {
    window.localStorage.setItem(EFFECTS_CONFIG_STORAGE_KEY, JSON.stringify(config));
};

const clearStoredEffectsDebugConfig = () => {
    window.localStorage.removeItem(EFFECTS_CONFIG_STORAGE_KEY);
};

const persistedCameraConfig = loadStoredCameraDebugConfig();
const activeCameraConfig = persistedCameraConfig ?? cloneCameraDebugConfig(defaultCameraDebugConfig);
const persistedWaterConfig = loadStoredWaterDebugConfig();
const activeWaterConfig = persistedWaterConfig ?? cloneWaterDebugConfig(defaultWaterDebugConfig);
const persistedEffectsConfig = loadStoredEffectsDebugConfig();
const activeEffectsConfig = persistedEffectsConfig ?? cloneEffectsDebugConfig(defaultEffectsDebugConfig);
let portEntity: pc.Entity | null = null;

const camera = new pc.Entity('Camera');
camera.addComponent('camera', {
    clearColor: new pc.Color(0.16, 0.2, 0.26),
    fov: activeCameraConfig.component.fov,
    nearClip: activeCameraConfig.component.nearClip,
    farClip: activeCameraConfig.component.farClip,
    clearColorBuffer: true,
    clearDepthBuffer: true,
    frustumCulling: false
});
const cameraComponent = camera.camera;
if (!cameraComponent) {
    throw new Error('Camera component was not created.');
}
cameraComponent.gammaCorrection = pc.GAMMA_SRGB;
cameraComponent.toneMapping = pc.TONEMAP_LINEAR;
camera.setPosition(275, 153, 53);
camera.lookAt(0, 0, 0);
app.root.addChild(camera);

const cameraControl = new MapCameraControl(app, camera, {
    enabledControl: activeCameraConfig.control.enabledControl,
    lookAtCenter: new pc.Vec3(
        activeCameraConfig.control.lookAtCenterX,
        activeCameraConfig.control.lookAtCenterY,
        activeCameraConfig.control.lookAtCenterZ
    ),
    groundY: activeCameraConfig.control.groundY,
    minDistance: activeCameraConfig.control.minDistance,
    maxDistance: activeCameraConfig.control.maxDistance,
    minPitchDeg: activeCameraConfig.control.minPitchDeg,
    maxPitchDeg: activeCameraConfig.control.maxPitchDeg,
    pitchCurvePower: activeCameraConfig.control.pitchCurvePower,
    zoomSpeed: activeCameraConfig.control.zoomSpeed,
    zoomSmooth: activeCameraConfig.control.zoomSmooth,
    rotateSpeed: activeCameraConfig.control.rotateSpeed,
    rotateSmooth: activeCameraConfig.control.rotateSmooth,
    moveSpeed: activeCameraConfig.control.moveSpeed,
    autoToTopEnabled: activeCameraConfig.control.autoToTopEnabled,
    autoToTopHeight: activeCameraConfig.control.autoToTopHeight,
    topYawDeg: activeCameraConfig.control.topYawDeg,
    autoAdjustFarClip: activeCameraConfig.control.autoAdjustFarClip,
    farClipMin: activeCameraConfig.control.farClipMin,
    farClipMultiplier: activeCameraConfig.control.farClipMultiplier,
    minRuntimeDistance: activeCameraConfig.control.minRuntimeDistance,
    rangeShape: activeCameraConfig.control.rangeShape,
    rangeAngleDeg: activeCameraConfig.control.rangeAngleDeg,
    rectHalfExtents: new pc.Vec2(activeCameraConfig.control.rectHalfExtentsX, activeCameraConfig.control.rectHalfExtentsY),
    ellipseRadii: new pc.Vec2(activeCameraConfig.control.ellipseRadiiX, activeCameraConfig.control.ellipseRadiiY),
    scaleRangeWithZoom: activeCameraConfig.control.scaleRangeWithZoom,
    minRangeFactor: activeCameraConfig.control.minRangeFactor,
    coneRangeEnabled: activeCameraConfig.control.coneRangeEnabled,
    coneAutoHeights: activeCameraConfig.control.coneAutoHeights,
    coneTopIsPoint: activeCameraConfig.control.coneTopIsPoint,
    coneTopFactor: activeCameraConfig.control.coneTopFactor,
    coneFullRangeHeight: activeCameraConfig.control.coneFullRangeHeight,
    coneMinRangeHeight: activeCameraConfig.control.coneMinRangeHeight,
    allowKeyboardPan: activeCameraConfig.control.allowKeyboardPan,
    allowMouseDragPan: activeCameraConfig.control.allowMouseDragPan,
    dragPanSensitivity: activeCameraConfig.control.dragPanSensitivity,
    slideAlongBoundary: activeCameraConfig.control.slideAlongBoundary,
    outwardSlideRatio: activeCameraConfig.control.outwardSlideRatio,
    zoomTowardsCursor: activeCameraConfig.control.zoomTowardsCursor,
    invertWheel: activeCameraConfig.control.invertWheel,
    debugLog: false
});

const fogHoleParamsId = app.graphicsDevice.scope.resolve('uFogHoleParams');
const fogHoleCenterId = app.graphicsDevice.scope.resolve('uFogHoleCenter');
const fogHoleViewportId = app.graphicsDevice.scope.resolve('uFogHoleViewport');
const fogHoleActiveId = app.graphicsDevice.scope.resolve('uFogHoleActive');
const fogHoleScaleId = app.graphicsDevice.scope.resolve('uFogHoleScale');

const createCameraDebugUi = () => {
    const panel = document.createElement('div');
    panel.id = 'camera-debug-panel';
    panel.style.position = 'fixed';
    panel.style.top = '12px';
    panel.style.right = '12px';
    panel.style.width = '280px';
    panel.style.maxHeight = 'calc(100vh - 24px)';
    panel.style.overflow = 'auto';
    panel.style.padding = '12px';
    panel.style.background = 'rgba(10, 14, 20, 0.86)';
    panel.style.color = '#f3f6fa';
    panel.style.font = '12px/1.4 Consolas, monospace';
    panel.style.border = '1px solid rgba(255,255,255,0.12)';
    panel.style.borderRadius = '10px';
    panel.style.backdropFilter = 'blur(8px)';
    panel.style.zIndex = '10';

    const title = document.createElement('div');
    title.textContent = 'Camera Debug';
    title.style.fontWeight = '700';
    title.style.marginBottom = '10px';
    panel.appendChild(title);

    const status = document.createElement('pre');
    status.style.whiteSpace = 'pre-wrap';
    status.style.margin = '0 0 10px';
    status.style.color = '#9fc3ff';
    panel.appendChild(status);

    const buttonRow = document.createElement('div');
    buttonRow.style.display = 'grid';
    buttonRow.style.gridTemplateColumns = '1fr 1fr 1fr 1fr';
    buttonRow.style.gap = '6px';
    buttonRow.style.marginBottom = '10px';
    panel.appendChild(buttonRow);

    const makeButton = (label: string) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.style.background = 'rgba(255,255,255,0.08)';
        button.style.color = '#fff';
        button.style.border = '1px solid rgba(255,255,255,0.14)';
        button.style.borderRadius = '6px';
        button.style.padding = '6px 8px';
        button.style.cursor = 'pointer';
        return button;
    };

    const saveButton = makeButton('Save');
    const loadButton = makeButton('Load');
    const resetButton = makeButton('Reset');
    const exportButton = makeButton('Export');
    buttonRow.append(saveButton, loadButton, resetButton, exportButton);

    const fields: Array<{ key: keyof MapCameraControlSettings | 'fov' | 'nearClip' | 'farClip' | 'portScale'; label: string; step: string }> = [
        { key: 'fov', label: 'FOV', step: '1' },
        { key: 'nearClip', label: 'Near Clip', step: '0.01' },
        { key: 'farClip', label: 'Far Clip', step: '1' },
        { key: 'portScale', label: 'Port Scale', step: '0.01' },
        { key: 'groundY', label: 'Ground Y', step: '1' },
        { key: 'lookAtCenterX', label: 'LookAt X', step: '1' },
        { key: 'lookAtCenterY', label: 'LookAt Y', step: '1' },
        { key: 'lookAtCenterZ', label: 'LookAt Z', step: '1' },
        { key: 'minDistance', label: 'Min Dist', step: '1' },
        { key: 'maxDistance', label: 'Max Dist', step: '1' },
        { key: 'minPitchDeg', label: 'Min Pitch', step: '1' },
        { key: 'maxPitchDeg', label: 'Max Pitch', step: '1' },
        { key: 'pitchCurvePower', label: 'Pitch Curve', step: '0.1' },
        { key: 'zoomSpeed', label: 'Zoom Speed', step: '0.1' },
        { key: 'zoomSmooth', label: 'Zoom Smooth', step: '0.01' },
        { key: 'rotateSpeed', label: 'Rotate Speed', step: '0.1' },
        { key: 'rotateSmooth', label: 'Rotate Smooth', step: '0.01' },
        { key: 'moveSpeed', label: 'Move Speed', step: '0.5' },
        { key: 'rectHalfExtentsX', label: 'Rect X', step: '10' },
        { key: 'rectHalfExtentsY', label: 'Rect Y', step: '10' }
    ];

    const inputs = new Map<string, HTMLInputElement>();

    for (const field of fields) {
        const row = document.createElement('label');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '96px 1fr';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.marginBottom = '6px';

        const text = document.createElement('span');
        text.textContent = field.label;

        const input = document.createElement('input');
        input.type = 'number';
        input.step = field.step;
        input.style.width = '100%';
        input.style.boxSizing = 'border-box';
        input.style.background = 'rgba(255,255,255,0.08)';
        input.style.color = '#fff';
        input.style.border = '1px solid rgba(255,255,255,0.14)';
        input.style.borderRadius = '6px';
        input.style.padding = '6px 8px';
        input.addEventListener('change', () => {
            const value = Number(input.value);
            if (!Number.isFinite(value)) {
                return;
            }

            if (field.key === 'fov' || field.key === 'nearClip' || field.key === 'farClip') {
                const cameraComponent = camera.camera;
                if (!cameraComponent) {
                    return;
                }

                if (field.key === 'fov') cameraComponent.fov = value;
                if (field.key === 'nearClip') cameraComponent.nearClip = value;
                if (field.key === 'farClip') cameraComponent.farClip = value;
            } else if (field.key === 'portScale') {
                if (portEntity) {
                    portEntity.setLocalScale(value, value, value);
                }
            } else if (field.key === 'lookAtCenterX' || field.key === 'lookAtCenterY' || field.key === 'lookAtCenterZ') {
                const lookAt = cameraControl.getLookAtPosition();
                const settings = cameraControl.getSettings();
                const next = new pc.Vec3(
                    field.key === 'lookAtCenterX' ? value : lookAt.x,
                    field.key === 'lookAtCenterY' ? value : lookAt.y,
                    field.key === 'lookAtCenterZ' ? value : lookAt.z
                );
                const patch: Partial<MapCameraControlSettings> = {
                    lookAtCenterX: next.x,
                    lookAtCenterY: next.y,
                    lookAtCenterZ: next.z
                };
                if (field.key === 'lookAtCenterY') {
                    patch.groundY = value;
                }
                cameraControl.updateSettings(patch);
                cameraControl.setLookAt(new pc.Vec3(next.x, field.key === 'lookAtCenterY' ? value : settings.groundY, next.z));
            } else {
                cameraControl.updateSettings({
                    [field.key]: value
                } as Partial<MapCameraControlSettings>);
            }
        });

        row.append(text, input);
        panel.appendChild(row);
        inputs.set(field.key, input);
    }

    const hint = document.createElement('div');
    hint.textContent = 'LMB pan, RMB rotate, wheel zoom';
    hint.style.marginTop = '8px';
    hint.style.color = '#c7d2df';
    panel.appendChild(hint);

    const storageInfo = document.createElement('div');
    storageInfo.textContent = `storage: ${CAMERA_CONFIG_STORAGE_KEY}`;
    storageInfo.style.marginTop = '4px';
    storageInfo.style.color = '#8793a3';
    storageInfo.style.fontSize = '11px';
    panel.appendChild(storageInfo);

    const getCurrentConfig = () => {
        const cameraComponent = camera.camera;
        return {
            component: {
                fov: cameraComponent?.fov ?? defaultCameraDebugConfig.component.fov,
                nearClip: cameraComponent?.nearClip ?? defaultCameraDebugConfig.component.nearClip,
                farClip: cameraComponent?.farClip ?? defaultCameraDebugConfig.component.farClip
            },
            control: cameraControl.getSettings(),
            model: {
                portScale: portEntity?.getLocalScale().x ?? defaultCameraDebugConfig.model.portScale
            }
        };
    };

    const applyConfig = (config: typeof defaultCameraDebugConfig) => {
        const cameraComponent = camera.camera;
        if (cameraComponent) {
            cameraComponent.fov = config.component.fov;
            cameraComponent.nearClip = config.component.nearClip;
            cameraComponent.farClip = config.component.farClip;
        }

        if (portEntity) {
            portEntity.setLocalScale(config.model.portScale, config.model.portScale, config.model.portScale);
        }

        cameraControl.updateSettings(config.control);
        cameraControl.setLookAt(new pc.Vec3(
            config.control.lookAtCenterX,
            config.control.lookAtCenterY,
            config.control.lookAtCenterZ
        ));
    };

    const syncUi = () => {
        const settings = cameraControl.getSettings();
        const cameraPosition = cameraControl.getCameraPosition();
        const lookAt = cameraControl.getLookAtPosition();
        const cameraComponent = camera.camera;

        const values: Record<string, number> = {
            fov: cameraComponent?.fov ?? 45,
            nearClip: cameraComponent?.nearClip ?? 0.3,
            farClip: cameraComponent?.farClip ?? 8000,
            portScale: portEntity?.getLocalScale().x ?? defaultCameraDebugConfig.model.portScale,
            ...settings
        };

        for (const [key, input] of inputs.entries()) {
            const value = values[key];
            if (document.activeElement !== input && typeof value === 'number' && Number.isFinite(value)) {
                input.value = value.toFixed(key.includes('Clip') || key === 'fov' ? 2 : 2);
            }
        }

        status.textContent =
            `cam: ${cameraPosition.x.toFixed(1)}, ${cameraPosition.y.toFixed(1)}, ${cameraPosition.z.toFixed(1)}\n` +
            `look: ${lookAt.x.toFixed(1)}, ${lookAt.y.toFixed(1)}, ${lookAt.z.toFixed(1)}`;
    };

    saveButton.addEventListener('click', () => {
        saveStoredCameraDebugConfig(getCurrentConfig());
        storageInfo.textContent = 'saved to localStorage';
    });

    loadButton.addEventListener('click', () => {
        const stored = loadStoredCameraDebugConfig();
        if (!stored) {
            storageInfo.textContent = 'no saved config';
            return;
        }
        applyConfig(cloneCameraDebugConfig(stored));
        syncUi();
        storageInfo.textContent = 'loaded from localStorage';
    });

    resetButton.addEventListener('click', () => {
        clearStoredCameraDebugConfig();
        applyConfig(cloneCameraDebugConfig(defaultCameraDebugConfig));
        syncUi();
        storageInfo.textContent = 'reset to defaults';
    });

    exportButton.addEventListener('click', async () => {
        const payload = JSON.stringify(getCurrentConfig(), null, 2);
        try {
            await navigator.clipboard.writeText(payload);
            storageInfo.textContent = 'config copied as JSON';
        } catch {
            storageInfo.textContent = 'copy failed';
        }
    });

    document.body.appendChild(panel);
    syncUi();
    app.on('update', syncUi);
};

createCameraDebugUi();

const applyEffectsConfig = (config: EffectsDebugConfig) => {
    Object.assign(activeEffectsConfig, config);

    app.scene.exposure = Math.max(0.01, config.exposure);
    app.scene.skyboxIntensity = Math.max(0, config.skyboxIntensity);
    app.scene.skyboxMip = Math.max(0, Math.min(6, Math.round(config.skyboxMip)));
    app.scene.ambientLight.set(
        Math.max(0, config.ambientR),
        Math.max(0, config.ambientG),
        Math.max(0, config.ambientB)
    );

    if (config.sceneFogEnabled >= 0.5) {
        const modeIndex = Math.round(config.sceneFogMode);
        app.scene.fog.type = modeIndex === 1 ? pc.FOG_EXP : modeIndex === 2 ? pc.FOG_EXP2 : pc.FOG_LINEAR;
        app.scene.fog.color.set(config.fogR, config.fogG, config.fogB);
        app.scene.fog.start = Math.max(0, config.fogStart);
        app.scene.fog.end = Math.max(config.fogStart + 1, config.fogEnd);
        app.scene.fog.density = Math.max(0, config.fogDensity);
    } else {
        app.scene.fog.type = pc.FOG_NONE;
    }
};

const getCurrentEffectsConfig = (): EffectsDebugConfig => cloneEffectsDebugConfig(activeEffectsConfig);

const createEffectsDebugUi = () => {
    const panel = document.createElement('div');
    panel.id = 'effects-debug-panel';
    panel.style.position = 'fixed';
    panel.style.right = '12px';
    panel.style.width = '280px';
    panel.style.maxHeight = 'calc(100vh - 24px)';
    panel.style.overflow = 'auto';
    panel.style.padding = '12px';
    panel.style.background = 'rgba(10, 14, 20, 0.86)';
    panel.style.color = '#f3f6fa';
    panel.style.font = '12px/1.4 Consolas, monospace';
    panel.style.border = '1px solid rgba(255,255,255,0.12)';
    panel.style.borderRadius = '10px';
    panel.style.backdropFilter = 'blur(8px)';
    panel.style.zIndex = '10';

    const title = document.createElement('div');
    title.textContent = '3D Effects';
    title.style.fontWeight = '700';
    title.style.marginBottom = '10px';
    panel.appendChild(title);

    const status = document.createElement('pre');
    status.style.whiteSpace = 'pre-wrap';
    status.style.margin = '0 0 10px';
    status.style.color = '#9fc3ff';
    panel.appendChild(status);

    const buttonRow = document.createElement('div');
    buttonRow.style.display = 'grid';
    buttonRow.style.gridTemplateColumns = '1fr 1fr 1fr 1fr';
    buttonRow.style.gap = '6px';
    buttonRow.style.marginBottom = '10px';
    panel.appendChild(buttonRow);

    const makeButton = (label: string) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.style.background = 'rgba(255,255,255,0.08)';
        button.style.color = '#fff';
        button.style.border = '1px solid rgba(255,255,255,0.14)';
        button.style.borderRadius = '6px';
        button.style.padding = '6px 8px';
        button.style.cursor = 'pointer';
        return button;
    };

    const saveButton = makeButton('Save');
    const loadButton = makeButton('Load');
    const resetButton = makeButton('Reset');
    const exportButton = makeButton('Export');
    buttonRow.append(saveButton, loadButton, resetButton, exportButton);

    const fields: Array<{ key: keyof EffectsDebugConfig; label: string; step: string }> = [
        { key: 'exposure', label: 'Exposure', step: '0.01' },
        { key: 'skyboxIntensity', label: 'Sky Int', step: '0.01' },
        { key: 'skyboxMip', label: 'Sky Mip', step: '1' },
        { key: 'sceneFogEnabled', label: 'Fog On', step: '1' },
        { key: 'sceneFogMode', label: 'Fog Mode', step: '1' },
        { key: 'fogStart', label: 'Fog Start', step: '10' },
        { key: 'fogEnd', label: 'Fog End', step: '10' },
        { key: 'fogDensity', label: 'Fog Dens', step: '0.0001' },
        { key: 'fogHoleEnabled', label: 'Hole On', step: '1' },
        { key: 'fogHoleInner', label: 'Hole Inner', step: '0.01' },
        { key: 'fogHoleOuter', label: 'Hole Outer', step: '0.01' },
        { key: 'fogHoleStrength', label: 'Hole Str', step: '0.01' },
        { key: 'fogHoleScaleX', label: 'Hole ScaleX', step: '0.01' },
        { key: 'fogHoleScaleY', label: 'Hole ScaleY', step: '0.01' },
        { key: 'fogHoleTopDotMin', label: 'Hole TopDot', step: '0.01' },
        { key: 'fogHoleHeightMin', label: 'Hole MinH', step: '1' },
        { key: 'fogHoleHeightFade', label: 'Hole FadeH', step: '1' },
        { key: 'ambientR', label: 'Amb R', step: '0.01' },
        { key: 'ambientG', label: 'Amb G', step: '0.01' },
        { key: 'ambientB', label: 'Amb B', step: '0.01' },
        { key: 'fogR', label: 'Fog R', step: '0.01' },
        { key: 'fogG', label: 'Fog G', step: '0.01' },
        { key: 'fogB', label: 'Fog B', step: '0.01' }
    ];

    const inputs = new Map<keyof EffectsDebugConfig, HTMLInputElement>();
    const colorPickers = new Map<string, HTMLInputElement>();

    const applyField = (key: keyof EffectsDebugConfig, value: number) => {
        const next = cloneEffectsDebugConfig(activeEffectsConfig);
        next[key] = value;
        applyEffectsConfig(next);
    };

    const applyFields = (patch: Partial<EffectsDebugConfig>) => {
        const next = cloneEffectsDebugConfig(activeEffectsConfig);
        Object.assign(next, patch);
        applyEffectsConfig(next);
    };

    const toHex = (r: number, g: number, b: number) => {
        const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
        return `#${c(r)}${c(g)}${c(b)}`;
    };

    const fromHex = (hex: string) => {
        const normalized = hex.replace('#', '');
        if (normalized.length !== 6) return null;
        const r = parseInt(normalized.slice(0, 2), 16) / 255;
        const g = parseInt(normalized.slice(2, 4), 16) / 255;
        const b = parseInt(normalized.slice(4, 6), 16) / 255;
        if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
        return { r, g, b };
    };

    const addColorRow = (
        id: string,
        label: string,
        getColor: () => { r: number; g: number; b: number },
        applyColor: (r: number, g: number, b: number) => void
    ) => {
        const row = document.createElement('label');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '96px 1fr';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.marginBottom = '8px';

        const text = document.createElement('span');
        text.textContent = label;

        const picker = document.createElement('input');
        picker.type = 'color';
        picker.style.width = '100%';
        picker.style.height = '30px';
        picker.style.padding = '0';
        picker.style.border = '1px solid rgba(255,255,255,0.14)';
        picker.style.borderRadius = '6px';
        picker.style.background = 'rgba(255,255,255,0.08)';
        picker.value = toHex(getColor().r, getColor().g, getColor().b);
        picker.addEventListener('input', () => {
            const color = fromHex(picker.value);
            if (!color) return;
            applyColor(color.r, color.g, color.b);
        });

        row.append(text, picker);
        panel.appendChild(row);
        colorPickers.set(id, picker);
    };

    addColorRow(
        'ambient',
        'Ambient',
        () => ({ r: activeEffectsConfig.ambientR, g: activeEffectsConfig.ambientG, b: activeEffectsConfig.ambientB }),
        (r, g, b) => applyFields({ ambientR: r, ambientG: g, ambientB: b })
    );
    addColorRow(
        'fog',
        'Fog Color',
        () => ({ r: activeEffectsConfig.fogR, g: activeEffectsConfig.fogG, b: activeEffectsConfig.fogB }),
        (r, g, b) => applyFields({ fogR: r, fogG: g, fogB: b })
    );

    for (const field of fields) {
        const row = document.createElement('label');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '96px 1fr';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.marginBottom = '6px';

        const text = document.createElement('span');
        text.textContent = field.label;

        const input = document.createElement('input');
        input.type = 'number';
        input.step = field.step;
        input.style.width = '100%';
        input.style.boxSizing = 'border-box';
        input.style.background = 'rgba(255,255,255,0.08)';
        input.style.color = '#fff';
        input.style.border = '1px solid rgba(255,255,255,0.14)';
        input.style.borderRadius = '6px';
        input.style.padding = '6px 8px';
        input.addEventListener('change', () => {
            const value = Number(input.value);
            if (!Number.isFinite(value)) return;
            applyField(field.key, value);
        });

        row.append(text, input);
        panel.appendChild(row);
        inputs.set(field.key, input);
    }

    const hint = document.createElement('div');
    hint.textContent = 'Fog Mode: 0=linear, 1=exp, 2=exp2. Hole ScaleX/ScaleY control ellipse ratio (1,1 = circle).';
    hint.style.marginTop = '8px';
    hint.style.color = '#c7d2df';
    panel.appendChild(hint);

    const storageInfo = document.createElement('div');
    storageInfo.textContent = `storage: ${EFFECTS_CONFIG_STORAGE_KEY}`;
    storageInfo.style.marginTop = '4px';
    storageInfo.style.color = '#8793a3';
    storageInfo.style.fontSize = '11px';
    panel.appendChild(storageInfo);

    const syncUi = () => {
        const current = getCurrentEffectsConfig();
        for (const [key, input] of inputs.entries()) {
            if (document.activeElement !== input) {
                input.value = current[key].toFixed(3);
            }
        }
        const ambientPicker = colorPickers.get('ambient');
        if (ambientPicker && document.activeElement !== ambientPicker) {
            ambientPicker.value = toHex(current.ambientR, current.ambientG, current.ambientB);
        }
        const fogPicker = colorPickers.get('fog');
        if (fogPicker && document.activeElement !== fogPicker) {
            fogPicker.value = toHex(current.fogR, current.fogG, current.fogB);
        }
        status.textContent =
            `exp: ${current.exposure.toFixed(2)}  sky: ${current.skyboxIntensity.toFixed(2)} mip:${Math.round(current.skyboxMip)}\n` +
            `fog: ${current.sceneFogEnabled >= 0.5 ? 'on' : 'off'} mode:${Math.round(current.sceneFogMode)}\n` +
            `start:${current.fogStart.toFixed(0)} end:${current.fogEnd.toFixed(0)} dens:${current.fogDensity.toFixed(4)}\n` +
            `hole:${current.fogHoleEnabled >= 0.5 ? 'on' : 'off'} in:${current.fogHoleInner.toFixed(2)} out:${current.fogHoleOuter.toFixed(2)}\n` +
            `scale x:${current.fogHoleScaleX.toFixed(2)} y:${current.fogHoleScaleY.toFixed(2)}`;
    };

    saveButton.addEventListener('click', () => {
        const current = getCurrentEffectsConfig();
        saveStoredEffectsDebugConfig(current);
        storageInfo.textContent = 'saved to localStorage';
    });

    loadButton.addEventListener('click', () => {
        const stored = loadStoredEffectsDebugConfig();
        if (!stored) {
            storageInfo.textContent = 'no saved config';
            return;
        }
        applyEffectsConfig(stored);
        syncUi();
        storageInfo.textContent = 'loaded from localStorage';
    });

    resetButton.addEventListener('click', () => {
        clearStoredEffectsDebugConfig();
        const reset = cloneEffectsDebugConfig(defaultEffectsDebugConfig);
        applyEffectsConfig(reset);
        syncUi();
        storageInfo.textContent = 'reset to defaults';
    });

    exportButton.addEventListener('click', async () => {
        const payload = JSON.stringify(getCurrentEffectsConfig(), null, 2);
        try {
            await navigator.clipboard.writeText(payload);
            storageInfo.textContent = 'config copied as JSON';
        } catch {
            storageInfo.textContent = 'copy failed';
        }
    });

    document.body.appendChild(panel);
    const placeBelowCameraPanel = () => {
        const cameraPanel = document.getElementById('camera-debug-panel');
        if (!cameraPanel) {
            panel.style.top = '12px';
            return;
        }
        const top = cameraPanel.offsetTop + cameraPanel.offsetHeight + 12;
        panel.style.top = `${top}px`;
        const maxHeight = Math.max(120, window.innerHeight - top - 12);
        panel.style.maxHeight = `${maxHeight}px`;
    };
    placeBelowCameraPanel();
    window.addEventListener('resize', placeBelowCameraPanel);
    syncUi();
    app.on('update', syncUi);
};

const light = new pc.Entity('Light');
light.addComponent('light', {
    type: 'directional',
    color: new pc.Color(1.0, 0.98, 0.92),
    intensity: 1.35,
    castShadows: true,
    shadowUpdateMode: pc.SHADOWUPDATE_REALTIME,
    shadowResolution: 4096,
    numCascades: 1,
    shadowDistance: 1200,
    shadowIntensity: 1,
    shadowType: pc.SHADOW_PCF3,
    shadowBias: 0.03,
    normalOffsetBias: 0.25
});
light.setPosition(0, 800, 0);
light.setEulerAngles(52, -38, 0);
app.root.addChild(light);

const waterLit = createWaterLitMaterialSystem(app, camera, 0);
const basePlaneMaterial = waterLit.material;
const waterPreset = {
    diffuse: new pc.Color(activeWaterConfig.diffuseR, activeWaterConfig.diffuseG, activeWaterConfig.diffuseB),
    diffuse2: new pc.Color(activeWaterConfig.diffuse2R, activeWaterConfig.diffuse2G, activeWaterConfig.diffuse2B)
};
const waterSurfaceY = -0.1;
const waterPlaneScale = new pc.Vec3(12000, 1, 12000);

const basePlane = new pc.Entity('BasePlane');
basePlane.addComponent('render', {
    type: 'plane',
    material: basePlaneMaterial,
    castShadows: false,
    receiveShadows: false
});
basePlane.setPosition(0, waterSurfaceY, 0);
basePlane.setLocalScale(waterPlaneScale.x, waterPlaneScale.y, waterPlaneScale.z);
app.root.addChild(basePlane);

// Godot-style underwater occluder: a dark plane a few meters below water to avoid "see-through void".
const underwaterOccluderMaterial = new pc.StandardMaterial();
underwaterOccluderMaterial.name = 'WaterUnderOccluder_Unique';
underwaterOccluderMaterial.diffuse = new pc.Color(0.04, 0.07, 0.14);
underwaterOccluderMaterial.emissive = new pc.Color(0.01, 0.02, 0.03);
underwaterOccluderMaterial.useLighting = false;
underwaterOccluderMaterial.useSkybox = false;
underwaterOccluderMaterial.blendType = pc.BLEND_NONE;
underwaterOccluderMaterial.cull = pc.CULLFACE_BACK;
underwaterOccluderMaterial.depthWrite = true;
underwaterOccluderMaterial.update();

const underwaterOccluder = new pc.Entity('UnderwaterOccluder');
underwaterOccluder.addComponent('render', {
    type: 'plane',
    material: underwaterOccluderMaterial,
    castShadows: false,
    receiveShadows: false
});
underwaterOccluder.setPosition(0, waterSurfaceY - 8, 0);
underwaterOccluder.setLocalScale(waterPlaneScale.x * 1.08, 1, waterPlaneScale.z * 1.08);
app.root.addChild(underwaterOccluder);
underwaterOccluder.enabled = activeWaterConfig.underwaterOccluderEnabled >= 0.5;

const applyWaterConfig = (config: WaterDebugConfig) => {
    Object.assign(activeWaterConfig, config);
    waterPreset.diffuse.set(config.diffuseR, config.diffuseG, config.diffuseB);
    waterPreset.diffuse2.set(config.diffuse2R, config.diffuse2G, config.diffuse2B);
    waterLit.applyConfig({
        diffuse: waterPreset.diffuse,
        diffuse2: waterPreset.diffuse2,
        opacity: config.opacity,
        specular: Math.min(1, Math.max(0.0, config.specular)),
        gloss: Math.min(1, Math.max(0.0, config.gloss)),
        fresnelPower: Math.max(0.001, config.fresnelPower),
        fresnelAffectsOpacity: config.fresnelAffectsOpacity >= 0.5,
        useSkybox: config.useSkybox >= 0.5,
        normalMapEnabled: config.normalMapEnabled >= 0.5,
        normalDetailMapEnabled: config.normalDetailMapEnabled >= 0.5,
        bumpiness: Math.max(0.0, config.bumpiness),
        normalDetailMapBumpiness: Math.max(0.0, config.normalDetailMapBumpiness),
        normalUvScale: Math.max(0.01, config.normalUvScale),
        normalSpeed1: Math.max(-1.0, Math.min(1.0, config.normalSpeed1)),
        normalSpeed2: Math.max(-1.0, Math.min(1.0, config.normalSpeed2)),
        blendType: Math.round(config.blendType),
        depthWrite: config.depthWrite >= 0.5,
        cull: Math.round(config.cull),
        useLighting: config.useLighting >= 0.5,
        useFog: config.useFog >= 0.5
    });
    underwaterOccluder.enabled = config.underwaterOccluderEnabled >= 0.5;

};

const getCurrentWaterConfig = (): WaterDebugConfig => cloneWaterDebugConfig(activeWaterConfig);

const createWaterDebugUi = () => {
    const panel = document.createElement('div');
    panel.style.position = 'fixed';
    panel.style.top = '12px';
    panel.style.left = '12px';
    panel.style.width = '300px';
    panel.style.maxHeight = 'calc(100vh - 24px)';
    panel.style.overflow = 'auto';
    panel.style.padding = '12px';
    panel.style.background = 'rgba(10, 14, 20, 0.86)';
    panel.style.color = '#f3f6fa';
    panel.style.font = '12px/1.4 Consolas, monospace';
    panel.style.border = '1px solid rgba(255,255,255,0.12)';
    panel.style.borderRadius = '10px';
    panel.style.backdropFilter = 'blur(8px)';
    panel.style.zIndex = '10';

    const title = document.createElement('div');
    title.textContent = 'Water Lit';
    title.style.fontWeight = '700';
    title.style.marginBottom = '10px';
    panel.appendChild(title);

    const status = document.createElement('pre');
    status.style.whiteSpace = 'pre-wrap';
    status.style.margin = '0 0 10px';
    status.style.color = '#9fc3ff';
    panel.appendChild(status);

    const buttonRow = document.createElement('div');
    buttonRow.style.display = 'grid';
    buttonRow.style.gridTemplateColumns = '1fr 1fr 1fr 1fr';
    buttonRow.style.gap = '6px';
    buttonRow.style.marginBottom = '10px';
    panel.appendChild(buttonRow);

    const makeButton = (label: string) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.style.background = 'rgba(255,255,255,0.08)';
        button.style.color = '#fff';
        button.style.border = '1px solid rgba(255,255,255,0.14)';
        button.style.borderRadius = '6px';
        button.style.padding = '6px 8px';
        button.style.cursor = 'pointer';
        return button;
    };

    const saveButton = makeButton('Save');
    const loadButton = makeButton('Load');
    const resetButton = makeButton('Reset');
    const exportButton = makeButton('Export');
    buttonRow.append(saveButton, loadButton, resetButton, exportButton);

    const fields: Array<{ key: keyof WaterDebugConfig; label: string; step: string }> = [
        { key: 'specular', label: 'Specular', step: '0.01' },
        { key: 'gloss', label: 'Gloss', step: '0.01' },
        { key: 'fresnelPower', label: 'Fresnel Power', step: '0.01' },
        { key: 'opacity', label: 'Opacity', step: '0.01' },
        { key: 'bumpiness', label: 'Bumpiness', step: '0.01' },
        { key: 'normalDetailMapBumpiness', label: 'Normal Detail Bump', step: '0.01' },
        { key: 'normalUvScale', label: 'Normal UV Scale', step: '0.01' },
        { key: 'normalSpeed1', label: 'Normal Speed 1', step: '0.001' },
        { key: 'normalSpeed2', label: 'Normal Speed 2', step: '0.001' }
    ];

    const checkboxFields: Array<{ key: keyof WaterDebugConfig; label: string }> = [
        { key: 'underwaterOccluderEnabled', label: 'Underwater Occluder' },
        { key: 'fresnelAffectsOpacity', label: 'Fresnel Affects Opacity' },
        { key: 'useSkybox', label: 'Use Skybox' },
        { key: 'normalMapEnabled', label: 'Normal Map' },
        { key: 'normalDetailMapEnabled', label: 'Normal Detail Map' },
        { key: 'depthWrite', label: 'Depth Write' },
        { key: 'useLighting', label: 'Use Lighting' },
        { key: 'useFog', label: 'Use Fog' }
    ];

    const selectFields: Array<{
        key: keyof WaterDebugConfig;
        label: string;
        options: Array<{ value: number; label: string }>;
    }> = [
        {
            key: 'blendType',
            label: 'Blend Type',
            options: [
                { value: pc.BLEND_NONE, label: 'NONE' },
                { value: pc.BLEND_NORMAL, label: 'NORMAL' },
                { value: pc.BLEND_PREMULTIPLIED, label: 'PREMULTIPLIED' }
            ]
        },
        {
            key: 'cull',
            label: 'Cull',
            options: [
                { value: pc.CULLFACE_NONE, label: 'NONE' },
                { value: pc.CULLFACE_BACK, label: 'BACK' },
                { value: pc.CULLFACE_FRONT, label: 'FRONT' }
            ]
        }
    ];

    const inputs = new Map<keyof WaterDebugConfig, HTMLInputElement>();
    const sliders = new Map<keyof WaterDebugConfig, HTMLInputElement>();
    const colorPickers = new Map<string, HTMLInputElement>();
    const toggles = new Map<keyof WaterDebugConfig, HTMLInputElement>();
    const selects = new Map<keyof WaterDebugConfig, HTMLSelectElement>();

    const applyField = (key: keyof WaterDebugConfig, value: number) => {
        const next = cloneWaterDebugConfig(activeWaterConfig);
        next[key] = value;
        Object.assign(activeWaterConfig, next);
        applyWaterConfig(next);
    };

    const applyFields = (patch: Partial<WaterDebugConfig>) => {
        const next = cloneWaterDebugConfig(activeWaterConfig);
        Object.assign(next, patch);
        Object.assign(activeWaterConfig, next);
        applyWaterConfig(next);
    };

    const toHex = (r: number, g: number, b: number) => {
        const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
        return `#${c(r)}${c(g)}${c(b)}`;
    };

    const fromHex = (hex: string) => {
        const normalized = hex.replace('#', '');
        if (normalized.length !== 6) {
            return null;
        }
        const r = parseInt(normalized.slice(0, 2), 16) / 255;
        const g = parseInt(normalized.slice(2, 4), 16) / 255;
        const b = parseInt(normalized.slice(4, 6), 16) / 255;
        if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
            return null;
        }
        return { r, g, b };
    };

    const addColorRow = (
        id: string,
        label: string,
        getColor: () => { r: number; g: number; b: number },
        applyColor: (r: number, g: number, b: number) => void
    ) => {
        const row = document.createElement('label');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '96px 1fr';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.marginBottom = '8px';

        const text = document.createElement('span');
        text.textContent = label;

        const picker = document.createElement('input');
        picker.type = 'color';
        picker.style.width = '100%';
        picker.style.height = '30px';
        picker.style.padding = '0';
        picker.style.border = '1px solid rgba(255,255,255,0.14)';
        picker.style.borderRadius = '6px';
        picker.style.background = 'rgba(255,255,255,0.08)';
        picker.value = toHex(getColor().r, getColor().g, getColor().b);
        picker.addEventListener('input', () => {
            const color = fromHex(picker.value);
            if (!color) {
                return;
            }
            applyColor(color.r, color.g, color.b);
        });

        row.append(text, picker);
        panel.appendChild(row);
        colorPickers.set(id, picker);
    };

    const addToggleRow = (key: keyof WaterDebugConfig, label: string) => {
        const row = document.createElement('label');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '128px 1fr';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.marginBottom = '8px';

        const text = document.createElement('span');
        text.textContent = label;

        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.style.justifySelf = 'start';
        toggle.addEventListener('change', () => {
            applyField(key, toggle.checked ? 1 : 0);
        });

        row.append(text, toggle);
        panel.appendChild(row);
        toggles.set(key, toggle);
    };

    const addSelectRow = (
        key: keyof WaterDebugConfig,
        label: string,
        options: Array<{ value: number; label: string }>
    ) => {
        const row = document.createElement('label');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '128px 1fr';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.marginBottom = '8px';

        const text = document.createElement('span');
        text.textContent = label;

        const select = document.createElement('select');
        select.style.width = '100%';
        select.style.boxSizing = 'border-box';
        select.style.background = 'rgba(255,255,255,0.08)';
        select.style.color = '#fff';
        select.style.border = '1px solid rgba(255,255,255,0.14)';
        select.style.borderRadius = '6px';
        select.style.padding = '6px 8px';
        for (const optionDef of options) {
            const option = document.createElement('option');
            option.value = String(optionDef.value);
            option.textContent = optionDef.label;
            select.appendChild(option);
        }
        select.addEventListener('change', () => {
            const value = Number(select.value);
            if (!Number.isFinite(value)) {
                return;
            }
            applyField(key, value);
        });

        row.append(text, select);
        panel.appendChild(row);
        selects.set(key, select);
    };

    for (const field of checkboxFields) {
        addToggleRow(field.key, field.label);
    }

    for (const field of selectFields) {
        addSelectRow(field.key, field.label, field.options);
    }

    for (const field of fields) {
        const row = document.createElement('label');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '128px 1fr';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.marginBottom = '6px';

        const text = document.createElement('span');
        text.textContent = field.label;

        const input = document.createElement('input');
        input.type = 'number';
        input.step = field.step;
        input.style.width = '100%';
        input.style.boxSizing = 'border-box';
        input.style.background = 'rgba(255,255,255,0.08)';
        input.style.color = '#fff';
        input.style.border = '1px solid rgba(255,255,255,0.14)';
        input.style.borderRadius = '6px';
        input.style.padding = '6px 8px';
        input.addEventListener('change', () => {
            const value = Number(input.value);
            if (!Number.isFinite(value)) {
                return;
            }
            applyField(field.key, value);
        });

        row.append(text, input);
        panel.appendChild(row);
        inputs.set(field.key, input);

        if (field.key === 'opacity') {
            const sliderRow = document.createElement('div');
            sliderRow.style.display = 'grid';
            sliderRow.style.gridTemplateColumns = '96px 1fr';
            sliderRow.style.alignItems = 'center';
            sliderRow.style.gap = '8px';
            sliderRow.style.marginBottom = '8px';

            const sliderLabel = document.createElement('span');
            sliderLabel.textContent = 'Opacity';
            sliderLabel.style.color = '#c7d2df';

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = '1';
            slider.step = '0.01';
            slider.value = String(activeWaterConfig.opacity);
            slider.style.width = '100%';
            slider.addEventListener('input', () => {
                const value = Number(slider.value);
                if (!Number.isFinite(value)) {
                    return;
                }
                applyField('opacity', value);
                const numberInput = inputs.get('opacity');
                if (numberInput && document.activeElement !== numberInput) {
                    numberInput.value = value.toFixed(3);
                }
            });

            sliderRow.append(sliderLabel, slider);
            panel.appendChild(sliderRow);
            sliders.set('opacity', slider);
        }
    }

    addColorRow(
        'diffuse',
        'Diffuse',
        () => ({ r: activeWaterConfig.diffuseR, g: activeWaterConfig.diffuseG, b: activeWaterConfig.diffuseB }),
        (r, g, b) => applyFields({ diffuseR: r, diffuseG: g, diffuseB: b })
    );
    addColorRow(
        'diffuse2',
        'Diffuse 2',
        () => ({ r: activeWaterConfig.diffuse2R, g: activeWaterConfig.diffuse2G, b: activeWaterConfig.diffuse2B }),
        (r, g, b) => applyFields({ diffuse2R: r, diffuse2G: g, diffuse2B: b })
    );

    const storageInfo = document.createElement('div');
    storageInfo.textContent = `storage: ${WATER_CONFIG_STORAGE_KEY}`;
    storageInfo.style.marginTop = '4px';
    storageInfo.style.color = '#8793a3';
    storageInfo.style.fontSize = '11px';
    panel.appendChild(storageInfo);

    const syncUi = () => {
        const current = getCurrentWaterConfig();
        for (const [key, input] of inputs.entries()) {
            if (document.activeElement !== input) {
                input.value = current[key].toFixed(3);
            }
        }
        for (const [key, slider] of sliders.entries()) {
            if (document.activeElement !== slider) {
                slider.value = String(current[key]);
            }
        }
        for (const [key, toggle] of toggles.entries()) {
            toggle.checked = current[key] >= 0.5;
        }
        for (const [key, select] of selects.entries()) {
            if (document.activeElement !== select) {
                select.value = String(current[key]);
            }
        }
        const diffusePicker = colorPickers.get('diffuse');
        if (diffusePicker && document.activeElement !== diffusePicker) {
            diffusePicker.value = toHex(current.diffuseR, current.diffuseG, current.diffuseB);
        }
        const diffuse2Picker = colorPickers.get('diffuse2');
        if (diffuse2Picker && document.activeElement !== diffuse2Picker) {
            diffuse2Picker.value = toHex(current.diffuse2R, current.diffuse2G, current.diffuse2B);
        }
        status.textContent =
            `diff1: ${current.diffuseR.toFixed(2)}, ${current.diffuseG.toFixed(2)}, ${current.diffuseB.toFixed(2)}\n` +
            `diff2: ${current.diffuse2R.toFixed(2)}, ${current.diffuse2G.toFixed(2)}, ${current.diffuse2B.toFixed(2)}\n` +
            `spec: ${current.specular.toFixed(2)}  gloss: ${current.gloss.toFixed(2)}  fres: ${current.fresnelPower.toFixed(2)}  opacity: ${current.opacity.toFixed(2)}\n` +
            `occ: ${current.underwaterOccluderEnabled >= 0.5 ? 'on' : 'off'}  fresA: ${current.fresnelAffectsOpacity >= 0.5 ? 'on' : 'off'}  skybox: ${current.useSkybox >= 0.5 ? 'on' : 'off'}  nm: ${current.normalMapEnabled >= 0.5 ? 'on' : 'off'}  nd: ${current.normalDetailMapEnabled >= 0.5 ? 'on' : 'off'}  nuv: ${current.normalUvScale.toFixed(2)}\n` +
            `ns1: ${current.normalSpeed1.toFixed(3)}  ns2: ${current.normalSpeed2.toFixed(3)}\n` +
            `blend: ${current.blendType.toFixed(0)}  cull: ${current.cull.toFixed(0)}  light: ${current.useLighting >= 0.5 ? 'on' : 'off'}  fog: ${current.useFog >= 0.5 ? 'on' : 'off'}`;
    };

    saveButton.addEventListener('click', () => {
        const current = getCurrentWaterConfig();
        Object.assign(activeWaterConfig, current);
        saveStoredWaterDebugConfig(current);
        storageInfo.textContent = 'saved to localStorage';
    });

    loadButton.addEventListener('click', () => {
        const stored = loadStoredWaterDebugConfig();
        if (!stored) {
            storageInfo.textContent = 'no saved config';
            return;
        }
        Object.assign(activeWaterConfig, stored);
        applyWaterConfig(stored);
        syncUi();
        storageInfo.textContent = 'loaded from localStorage';
    });

    resetButton.addEventListener('click', () => {
        clearStoredWaterDebugConfig();
        const reset = cloneWaterDebugConfig(defaultWaterDebugConfig);
        Object.assign(activeWaterConfig, reset);
        applyWaterConfig(reset);
        syncUi();
        storageInfo.textContent = 'reset to defaults';
    });

    exportButton.addEventListener('click', async () => {
        const payload = JSON.stringify(getCurrentWaterConfig(), null, 2);
        try {
            await navigator.clipboard.writeText(payload);
            storageInfo.textContent = 'config copied as JSON';
        } catch {
            storageInfo.textContent = 'copy failed';
        }
    });

    document.body.appendChild(panel);
    syncUi();
    app.on('update', syncUi);
};

const showBootError = (title: string, error: unknown) => {
    const panel = document.createElement('div');
    panel.style.position = 'fixed';
    panel.style.left = '12px';
    panel.style.top = '12px';
    panel.style.zIndex = '9999';
    panel.style.maxWidth = '560px';
    panel.style.padding = '8px 10px';
    panel.style.background = 'rgba(120, 16, 16, 0.92)';
    panel.style.border = '1px solid rgba(255,255,255,0.28)';
    panel.style.borderRadius = '8px';
    panel.style.color = '#fff';
    panel.style.font = '12px/1.4 Consolas, monospace';
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    panel.textContent = `${title} -> ${message}`;
    document.body.appendChild(panel);
};

try {
    applyEffectsConfig(activeEffectsConfig);
} catch (error) {
    console.error('applyEffectsConfig failed', error);
    showBootError('applyEffectsConfig failed', error);
}

try {
    createEffectsDebugUi();
} catch (error) {
    console.error('createEffectsDebugUi failed', error);
    showBootError('createEffectsDebugUi failed', error);
}

try {
    applyWaterConfig(activeWaterConfig);
} catch (error) {
    console.error('applyWaterConfig failed', error);
    showBootError('applyWaterConfig failed', error);
}

try {
    createWaterDebugUi();
} catch (error) {
    console.error('createWaterDebugUi failed', error);
    showBootError('createWaterDebugUi failed', error);
}

void (async () => {
    const normalA = createRidgedNormalTexture(app.graphicsDevice, 1024, 1024, {
        seed: 10,
        frequency: 0.045,
        octaves: 6,
        lacunarity: 2.0,
        gain: 0.5,
        bumpStrength: 1.4
    });
    const normalB = createRidgedNormalTexture(app.graphicsDevice, 1024, 1024, {
        seed: 29,
        frequency: 0.062,
        octaves: 6,
        lacunarity: 2.0,
        gain: 0.5,
        bumpStrength: 1.4
    });
    waterLit.setNormalTextures(normalA, normalB);
    applyWaterConfig(activeWaterConfig);
})().catch((error) => {
    console.warn('Default lit normal texture setup failed.', error);
});

const sunDirection = new pc.Vec3();
const fogHoleScreenPos = new pc.Vec3();
app.on('update', (dt: number) => {
    sunDirection.copy(light.forward);

    const effects = activeEffectsConfig;
    const holeEnabled = effects.fogHoleEnabled >= 0.5 ? 1 : 0;
    const fogEnabledMask = effects.sceneFogEnabled >= 0.5 ? 1 : 0;

    // Smoothly fade hole by camera tilt (top-down only) and camera height.
    // Hole TopDot is the point where fade starts, then a soft ramp to 1.0.
    const topDot = Math.max(0, Math.min(1, -camera.forward.y));
    const topDotStart = Math.max(0, Math.min(1, effects.fogHoleTopDotMin));
    const topDotFade = Math.max(0.02, 1 - topDotStart);
    const topMask = smoothstep01(Math.max(0, (topDot - topDotStart) / topDotFade));

    // Hole MinH is start height; Hole FadeH is transition distance.
    const cameraHeight = camera.getPosition().y;
    const heightStart = effects.fogHoleHeightMin;
    const heightFade = Math.max(1, effects.fogHoleHeightFade);
    const heightMask = smoothstep01(Math.max(0, (cameraHeight - heightStart) / heightFade));

    const holeActive = holeEnabled * fogEnabledMask * topMask * heightMask;

    fogHoleParamsId.setValue([
        Math.max(0, effects.fogHoleInner),
        Math.max(effects.fogHoleInner + 0.001, effects.fogHoleOuter),
        Math.max(0, Math.min(1, effects.fogHoleStrength)),
        holeEnabled
    ]);
    const viewportW = Math.max(1, app.graphicsDevice.width);
    const viewportH = Math.max(1, app.graphicsDevice.height);
    const holeWorld = cameraControl.getLookAtPosition();
    cameraComponent.worldToScreen(holeWorld, fogHoleScreenPos);
    const holeU = Math.max(0, Math.min(1, fogHoleScreenPos.x / viewportW));
    const holeV = Math.max(0, Math.min(1, fogHoleScreenPos.y / viewportH));

    fogHoleCenterId.setValue([holeU, holeV]);
    fogHoleViewportId.setValue([viewportW, viewportH]);
    fogHoleActiveId.setValue(holeActive);
    fogHoleScaleId.setValue([
        Math.max(0.0001, effects.fogHoleScaleX),
        Math.max(0.0001, effects.fogHoleScaleY)
    ]);
});

const portAsset = new pc.Asset('port', 'container', {
    url: '/models/port-source.glb'
});

app.assets.add(portAsset);
portAsset.ready(() => {
    void (async () => {
    const container = portAsset.resource as pc.ContainerResource;
    const port = container.instantiateRenderEntity();
    portEntity = port;
    port.name = 'Port';
    port.setLocalScale(
        activeCameraConfig.model.portScale,
        activeCameraConfig.model.portScale,
        activeCameraConfig.model.portScale
    );
    port.setPosition(0, 0, 0);
    app.root.addChild(port);
    await applyLegacyMaterialsToEntity(app, port, '/model-content');

    console.log('Port debug scale:', port.getLocalScale());
    })().catch((error) => {
        console.error('Failed to apply legacy materials.', error);
    });
});

portAsset.on('error', (err: unknown) => {
    console.error('Failed to load port.glb', err);
});

app.assets.load(portAsset);
