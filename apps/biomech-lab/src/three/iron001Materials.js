import * as THREE from 'three';

const TEXTURE_BASE = '/assets/IRON001/textures/';

/** Nombres de material en Og.FBX (Unreal). */
export const IRON001_MATERIAL_SLOTS = [
  'Red_Part',
  'Gold_Part',
  'Silver_Part',
  'Arc_Reactor',
  'Lights',
  'Glass',
];

/**
 * Mapeo verificado Og.FBX ↔ texturas en public/assets/IRON001/textures/.
 */
export const OG_FBX_MATERIAL_TEXTURES = {
  Arc_Reactor: {
    normal: 'For_Substance_Low_Polly_Arc_Reactor_Normal.PNG',
    roughness: 'For_Substance_Low_Polly_Arc_Reactor_Roughn.PNG',
    baseColor: 'For_Substance_Low_Polly_Arc_Reactor_BaseCo.PNG',
    metalness: 'For_Substance_Low_Polly_Arc_Reactor_Metall.PNG',
  },
  Glass: {
    emissive: 'For_Substance_Low_Polly_Lights_BaseColor.PNG',
    normal: 'For_Substance_Low_Polly_Arc_Reactor_Normal.PNG',
    baseColor: 'For_Substance_Low_Polly_Arc_Reactor_BaseCo.PNG',
    roughness: 'For_Substance_Low_Polly_Arc_Reactor_Roughn.PNG',
  },
  Gold_Part: {
    baseColor: 'For_Substance_Low_Polly_Gold_Part_BaseColo.PNG',
    normal: 'For_Substance_Low_Polly_Gold_Part_Normal.PNG',
    metalness: 'For_Substance_Low_Polly_Gold_Part_Metallic.PNG',
    roughness: 'For_Substance_Low_Polly_Gold_Part_Roughnes.PNG',
  },
  Lights: {
    baseColor: 'For_Substance_Low_Polly_Lights_BaseColor.PNG',
  },
  Red_Part: {
    baseColor: 'For_Substance_Low_Polly_Red_Part_BaseColor.PNG',
    normal: 'For_Substance_Low_Polly_Red_Part_Normal.PNG',
    metalness: 'For_Substance_Low_Polly_Red_Part_Metallic.PNG',
    roughness: 'For_Substance_Low_Polly_Red_Part_Roughness.PNG',
  },
  Silver_Part: {
    baseColor: 'For_Substance_Low_Polly_Silver_Part_BaseCo.PNG',
    roughness: 'For_Substance_Low_Polly_Silver_Part_Roughn.PNG',
    metalness: 'For_Substance_Low_Polly_Silver_Part_Metall.PNG',
    normal: 'For_Substance_Low_Polly_Silver_Part_Normal.PNG',
  },
};

/** PBR por slot: prioriza albedo visible sin subir luces de escena. */
const SLOT_PBR = {
  Red_Part: { metalness: 0.12, roughness: 0.82, useMetalnessMap: false },
  Gold_Part: { metalness: 0.48, roughness: 0.58, useMetalnessMap: true },
  Silver_Part: { metalness: 0.52, roughness: 0.55, useMetalnessMap: true },
  Arc_Reactor: { metalness: 0.65, roughness: 0.45, useMetalnessMap: true },
};

const ALIAS_TO_SLOT = {
  arcreactor: 'Arc_Reactor',
  reactor: 'Arc_Reactor',
  redpart: 'Red_Part',
  goldpart: 'Gold_Part',
  silverpart: 'Silver_Part',
  glass: 'Glass',
  lights: 'Lights',
  light: 'Lights',
};

const textureCache = new Map();
const materialPool = new Map();
let catalogCache = null;

export function buildIron001TextureCatalog() {
  if (catalogCache) return catalogCache;

  const catalog = {};
  for (const [slot, maps] of Object.entries(OG_FBX_MATERIAL_TEXTURES)) {
    catalog[slot] = {};
    for (const [mapKey, file] of Object.entries(maps)) {
      catalog[slot][mapKey] = `${TEXTURE_BASE}${file}`;
    }
  }

  catalogCache = catalog;
  return catalog;
}

export function iron001CatalogSummary() {
  const catalog = buildIron001TextureCatalog();
  return IRON001_MATERIAL_SLOTS.map((slot) => {
    const maps = catalog[slot] ?? {};
    if (slot === 'Glass') {
      return {
        slot,
        baseColor: Boolean(maps.baseColor),
        normal: Boolean(maps.normal),
        roughness: Boolean(maps.roughness),
        emissive: Boolean(maps.emissive),
        complete: Boolean(maps.baseColor && maps.normal && maps.roughness && maps.emissive),
      };
    }
    if (slot === 'Lights') {
      return {
        slot,
        baseColor: Boolean(maps.baseColor),
        complete: Boolean(maps.baseColor),
      };
    }
    return {
      slot,
      baseColor: Boolean(maps.baseColor),
      metalness: Boolean(maps.metalness),
      normal: Boolean(maps.normal),
      roughness: Boolean(maps.roughness),
      complete: Boolean(maps.baseColor && maps.metalness && maps.normal && maps.roughness),
    };
  });
}

export function collectFbxMaterialNames(object) {
  const names = {};
  object.traverse((node) => {
    if (!node.isMesh) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of mats) {
      const key = mat?.name?.trim() || '(vacío)';
      names[key] = (names[key] ?? 0) + 1;
    }
  });
  return names;
}

export async function applyIron001Materials(object, { onProgress } = {}) {
  const catalog = buildIron001TextureCatalog();
  materialPool.clear();

  console.info('[IRON001] Materiales en FBX antes de aplicar:', collectFbxMaterialNames(object));

  const meshes = [];
  object.traverse((node) => {
    if (node.isMesh) meshes.push(node);
  });

  const slotStats = Object.fromEntries(IRON001_MATERIAL_SLOTS.map((s) => [s, 0]));
  let unknown = 0;
  let index = 0;

  for (const mesh of meshes) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = mesh.geometry?.groups;
    const useMulti = materials.length > 1 && groups?.length > 1;

    if (useMulti) {
      const nextMaterials = [];
      for (let i = 0; i < materials.length; i += 1) {
        const slot = resolveMaterialSlot(materials[i], mesh, i);
        mesh.userData.iron001Slot = slot;
        nextMaterials.push(await getPooledMaterial(slot, catalog));
        trackSlot(slot, slotStats, () => { unknown += 1; });
      }
      mesh.material = nextMaterials;
    } else {
      const slot = resolveMaterialSlot(materials[0], mesh, 0)
        ?? resolveMaterialSlot(materials.find(Boolean), mesh, 0);
      mesh.userData.iron001Slot = slot;
      mesh.material = await getPooledMaterial(slot, catalog);
      trackSlot(slot, slotStats, () => { unknown += 1; });
    }

    index += 1;
    onProgress?.(index, meshes.length, mesh.userData.iron001Slot);
  }

  object.userData.iron001Materials = true;
  object.userData.iron001Catalog = OG_FBX_MATERIAL_TEXTURES;
  object.userData.iron001SlotStats = { ...slotStats, unknown };

  const texturedSlots = Object.values(slotStats).reduce((a, b) => a + b, 0);
  if (unknown > 0) {
    console.warn('[IRON001] Mallas sin slot FBX:', unknown, '— stats:', slotStats);
  }

  return { meshes: meshes.length, texturedSlots, catalog, slotStats, unknown };
}

function trackSlot(slot, slotStats, onUnknown) {
  if (slot && slotStats[slot] != null) slotStats[slot] += 1;
  else onUnknown();
}

async function getPooledMaterial(slot, catalog) {
  const key = slot ?? '__fallback__';
  if (materialPool.has(key)) return materialPool.get(key);
  const material = await buildMaterialForSlot(slot, catalog);
  materialPool.set(key, material);
  return material;
}

function resolveMaterialSlot(material, mesh, materialIndex = 0) {
  if (!material) return resolveSlotFromMeshHints(mesh, materialIndex);

  const candidates = [
    material.name,
    material.name?.replace(/\s+/g, '_'),
    material.userData?.name,
  ].filter(Boolean);

  for (const token of candidates) {
    const slot = resolveSlotFromPartToken(token);
    if (slot) return slot;
    const alias = resolveSlotFromAlias(token);
    if (alias) return alias;
    const fromPath = resolveSlotFromTexturePath(material);
    if (fromPath) return fromPath;
  }

  return resolveSlotFromMeshHints(mesh, materialIndex);
}

function resolveSlotFromTexturePath(material) {
  const urls = [];
  for (const key of ['map', 'normalMap', 'metalnessMap', 'roughnessMap', 'emissiveMap']) {
    const tex = material[key];
    const src = tex?.name || tex?.image?.src || tex?.source?.data?.src || '';
    if (src) urls.push(String(src));
  }
  const blob = urls.join(' ').toLowerCase();
  if (!blob) return null;

  if (blob.includes('red_part') || blob.includes('redpart')) return 'Red_Part';
  if (blob.includes('gold_part') || blob.includes('goldpart')) return 'Gold_Part';
  if (blob.includes('silver_part') || blob.includes('silverpart')) return 'Silver_Part';
  if (blob.includes('arc_reactor') || blob.includes('arcreactor')) return 'Arc_Reactor';
  if (blob.includes('lights_basecolor') || blob.includes('lights')) return 'Lights';
  if (blob.includes('glass')) return 'Glass';
  return null;
}

function resolveSlotFromMeshHints(mesh, materialIndex) {
  const meshName = normalizeToken(mesh?.name ?? '');
  const hints = [
    ['redpart', 'red_part', 'red'],
    ['goldpart', 'gold_part', 'gold'],
    ['silverpart', 'silver_part', 'silver'],
    ['arcreactor', 'arc_reactor', 'reactor'],
    ['glass'],
    ['lights', 'light'],
  ];
  const slotByHint = ['Red_Part', 'Gold_Part', 'Silver_Part', 'Arc_Reactor', 'Glass', 'Lights'];
  for (let i = 0; i < hints.length; i += 1) {
    if (hints[i].some((h) => meshName.includes(normalizeToken(h)))) return slotByHint[i];
  }

  if (mesh?.geometry?.groups?.[materialIndex]?.materialIndex != null) {
    const idx = mesh.geometry.groups[materialIndex].materialIndex;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (mats[idx]) return resolveMaterialSlot(mats[idx], mesh, idx);
  }

  return null;
}

function resolveSlotFromPartToken(token) {
  const norm = normalizeToken(token);
  for (const slot of IRON001_MATERIAL_SLOTS) {
    if (norm === normalizeToken(slot)) return slot;
  }
  return null;
}

function resolveSlotFromAlias(token) {
  const norm = normalizeToken(token);
  if (ALIAS_TO_SLOT[norm]) return ALIAS_TO_SLOT[norm];
  for (const slot of IRON001_MATERIAL_SLOTS) {
    if (norm.includes(normalizeToken(slot))) return slot;
  }
  return null;
}

async function buildMaterialForSlot(slot, catalog) {
  if (slot === 'Glass') return buildGlassMaterial(catalog);
  if (slot === 'Lights') return buildLightsMaterial(catalog);

  const maps = slot ? catalog[slot] : null;
  if (!maps?.baseColor) {
    return buildFallbackMaterial(slot);
  }

  const pbr = SLOT_PBR[slot] ?? { metalness: 0.35, roughness: 0.6, useMetalnessMap: true };

  const [map, normalMap, roughnessMap, metalnessMap] = await Promise.all([
    loadTexture(maps.baseColor, { colorSpace: THREE.SRGBColorSpace }),
    maps.normal ? loadTexture(maps.normal) : Promise.resolve(null),
    maps.roughness ? loadTexture(maps.roughness) : Promise.resolve(null),
    maps.metalness && pbr.useMetalnessMap
      ? loadTexture(maps.metalness)
      : Promise.resolve(null),
  ]);

  const material = new THREE.MeshStandardMaterial({
    map,
    color: 0xffffff,
    normalMap: normalMap ?? undefined,
    roughnessMap: roughnessMap ?? undefined,
    metalnessMap: metalnessMap ?? undefined,
    metalness: pbr.metalness,
    roughness: pbr.roughness,
    side: THREE.DoubleSide,
  });

  if (slot === 'Arc_Reactor') {
    material.emissive = new THREE.Color(0x33ccff);
    material.emissiveIntensity = 0.65;
    material.emissiveMap = map;
  }

  return material;
}

async function buildLightsMaterial(catalog) {
  const url = catalog.Lights?.baseColor;
  if (!url) return buildFallbackMaterial('Lights');

  const map = await loadTexture(url, { colorSpace: THREE.SRGBColorSpace });
  return new THREE.MeshStandardMaterial({
    map,
    color: 0xffffff,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: map,
    emissiveIntensity: 1.5,
    metalness: 0,
    roughness: 1,
    side: THREE.DoubleSide,
  });
}

async function buildGlassMaterial(catalog) {
  const maps = catalog.Glass;
  if (!maps?.baseColor) return buildFallbackMaterial('Glass');

  const [map, normalMap, roughnessMap, emissiveMap] = await Promise.all([
    loadTexture(maps.baseColor, { colorSpace: THREE.SRGBColorSpace }),
    maps.normal ? loadTexture(maps.normal) : Promise.resolve(null),
    maps.roughness ? loadTexture(maps.roughness) : Promise.resolve(null),
    maps.emissive
      ? loadTexture(maps.emissive, { colorSpace: THREE.SRGBColorSpace })
      : Promise.resolve(null),
  ]);

  return new THREE.MeshPhysicalMaterial({
    map,
    color: 0xffffff,
    normalMap: normalMap ?? undefined,
    roughnessMap: roughnessMap ?? undefined,
    roughness: roughnessMap ? 0.92 : 0.08,
    metalness: 0.35,
    emissive: new THREE.Color(0x66ddff),
    emissiveIntensity: 1.05,
    emissiveMap: emissiveMap ?? undefined,
    transparent: true,
    opacity: 0.52,
    transmission: 0.32,
    thickness: 0.15,
    ior: 1.45,
    side: THREE.DoubleSide,
  });
}

function buildFallbackMaterial(slot) {
  const colors = {
    Red_Part: 0xc41e1e,
    Gold_Part: 0xc9a227,
    Silver_Part: 0x9aa8b5,
    Arc_Reactor: 0x44eeff,
    Lights: 0x66ffff,
    Glass: 0x88ccff,
  };
  return new THREE.MeshStandardMaterial({
    color: colors[slot] ?? 0x888888,
    metalness: slot === 'Red_Part' ? 0.1 : 0.35,
    roughness: 0.55,
    side: THREE.DoubleSide,
  });
}

function loadTexture(url, { colorSpace = THREE.LinearSRGBColorSpace } = {}) {
  if (textureCache.has(url)) return textureCache.get(url);
  const loader = new THREE.TextureLoader();
  const promise = new Promise((resolve, reject) => {
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = colorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        resolve(texture);
      },
      undefined,
      reject,
    );
  });
  textureCache.set(url, promise);
  return promise;
}

function normalizeToken(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
