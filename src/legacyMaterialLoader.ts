import * as pc from 'playcanvas';

type LegacyParameter =
    | { name: string; type: 'texture'; data: number }
    | { name: string; type: 'vec2'; data: [number, number] }
    | { name: string; type: 'vec3'; data: [number, number, number] }
    | { name: string; type: 'float' | 'boolean' | 'string' | 'enum'; data: number | boolean | string };

interface LegacyTextureInfo {
    uri: string;
    srgb?: boolean;
}

interface LegacyMaterialInfo {
    name: string;
    parameters: LegacyParameter[];
}

interface LegacyMaterialsJson {
    materialInfo: {
        textures: LegacyTextureInfo[];
        materials: LegacyMaterialInfo[];
        mappings?: Array<{ material: number }>;
    };
}

const textureCache = new Map<string, Promise<pc.Texture | null>>();
const materialCache = new Map<string, Promise<{
    materialsByName: Map<string, pc.StandardMaterial>;
    materialsByIndex: pc.StandardMaterial[];
    mappings: number[];
}>>();

const loadTexture = (app: pc.Application, url: string, srgb: boolean) => {
    const cacheKey = `${url}|${srgb}`;
    const cached = textureCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const promise = new Promise<pc.Texture | null>((resolve) => {
        const asset = new pc.Asset(url, 'texture', {
            url
        });

        app.assets.add(asset);
        asset.once('load', () => {
            const texture = asset.resource as pc.Texture;
            if (texture) {
                texture.srgb = srgb;
            }
            resolve(texture ?? null);
        });
        asset.once('error', () => resolve(null));
        app.assets.load(asset);
    });

    textureCache.set(cacheKey, promise);
    return promise;
};

const assignParameter = (
    material: pc.StandardMaterial,
    parameter: LegacyParameter,
    textures: Array<pc.Texture | null>
) => {
    const target = material as unknown as Record<string, unknown>;

    if (parameter.type === 'texture') {
        const texture = textures[parameter.data] ?? null;
        if (!texture) {
            return;
        }
        target[parameter.name] = texture;
        return;
    }

    if (parameter.type === 'vec2') {
        target[parameter.name] = new pc.Vec2(parameter.data[0], parameter.data[1]);
        return;
    }

    if (parameter.type === 'vec3') {
        const colorLike = ['ambient', 'diffuse', 'emissive', 'specular', 'attenuation', 'sheen'];
        if (colorLike.includes(parameter.name)) {
            target[parameter.name] = new pc.Color(parameter.data[0], parameter.data[1], parameter.data[2]);
        } else {
            target[parameter.name] = new pc.Vec3(parameter.data[0], parameter.data[1], parameter.data[2]);
        }
        return;
    }

    target[parameter.name] = parameter.data;
};

const finalizeMaterial = (material: pc.StandardMaterial) => {
    const target = material as unknown as Record<string, unknown>;

    if (typeof target.bumpMapFactor === 'number') {
        target.bumpiness = target.bumpMapFactor;
    }

    material.update();
};

export const loadLegacyMaterials = async (app: pc.Application, baseUrl: string) => {
    const cached = materialCache.get(baseUrl);
    if (cached) {
        return cached;
    }

    const promise = (async () => {
        const response = await fetch(`${baseUrl}/materials.json`);
        const payload = (await response.json()) as LegacyMaterialsJson;
        const textureInfos = payload.materialInfo.textures ?? [];
        const materials = payload.materialInfo.materials ?? [];
        const mappings = payload.materialInfo.mappings?.map((entry) => entry.material) ?? [];

        const textures = await Promise.all(
            textureInfos.map((textureInfo) =>
                loadTexture(
                    app,
                    `${baseUrl}/textures/${encodeURIComponent(textureInfo.uri)}`,
                    textureInfo.srgb ?? true
                )
            )
        );

        const materialsByName = new Map<string, pc.StandardMaterial>();
        const materialsByIndex: pc.StandardMaterial[] = [];

        for (const [index, legacy] of materials.entries()) {
            const material = new pc.StandardMaterial();
            material.name = legacy.name;

            for (const parameter of legacy.parameters) {
                assignParameter(material, parameter, textures);
            }

            finalizeMaterial(material);
            materialsByName.set(legacy.name, material);
            materialsByIndex[index] = material;
        }

        return {
            materialsByName,
            materialsByIndex,
            mappings
        };
    })();

    materialCache.set(baseUrl, promise);
    return promise;
};

export const applyLegacyMaterialsToEntity = async (
    app: pc.Application,
    entity: pc.Entity,
    baseUrl: string
) => {
    const { materialsByName, materialsByIndex, mappings } = await loadLegacyMaterials(app, baseUrl);
    const renders = entity.findComponents('render') as pc.RenderComponent[];
    let meshIndex = 0;

    for (const render of renders) {
        for (const meshInstance of render.meshInstances) {
            const mappedMaterialIndex = mappings[meshIndex];
            if (typeof mappedMaterialIndex === 'number') {
                const replacement = materialsByIndex[mappedMaterialIndex];
                if (replacement) {
                    meshInstance.material = replacement;
                    meshIndex += 1;
                    continue;
                }
            }

            const materialName = meshInstance.material?.name;
            const replacement = materialName ? materialsByName.get(materialName) : null;
            if (replacement) {
                meshInstance.material = replacement;
            }

            meshIndex += 1;
        }
    }
};
