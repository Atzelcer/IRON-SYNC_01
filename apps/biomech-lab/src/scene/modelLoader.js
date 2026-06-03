import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export class ModelLoader {
  constructor() {
    this.loaders = {
      fbx: new FBXLoader(),
      obj: new OBJLoader(),
      glb: new GLTFLoader(),
      gltf: new GLTFLoader(),
    };
  }

  async loadFile(file, { materialMode = 'white', unrealZUp = false, referenceMode = 'auto' } = {}) {
    const extension = file.name.split('.').pop().toLowerCase();
    const loader = this.loaders[extension];
    if (!loader) throw new Error(`Formato no soportado: ${extension}`);
    const url = URL.createObjectURL(file);
    try {
      const loaded = await this.#load(loader, url);
      const object = prepareLoadedObject(loaded, file.name, { unrealZUp, referenceMode, materialMode });
      return { object, extension };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async loadUrl(url, {
    name = url,
    extension,
    unrealZUp = false,
    referenceMode = 'auto',
    materialMode = 'white',
  } = {}) {
    const cleanUrl = url.split('?')[0];
    const resolvedExtension = (extension ?? cleanUrl.split('.').pop()).toLowerCase();
    const loader = this.loaders[resolvedExtension];
    if (!loader) throw new Error(`Formato no soportado: ${resolvedExtension}`);
    const loaded = await this.#load(loader, url);
    const object = prepareLoadedObject(loaded, name, { unrealZUp, referenceMode, materialMode });
    return { object, extension: resolvedExtension };
  }

  #load(loader, url) {
    return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
  }
}

function prepareLoadedObject(loaded, name, {
  unrealZUp = false,
  referenceMode = 'auto',
  materialMode = 'white',
} = {}) {
  const object = loaded.scene ?? loaded;
  object.name = name;
  if (referenceMode === 'unreal') {
    prepareUnrealReferenceObject(object);
  } else {
    if (unrealZUp) convertUnrealZUpToThreeYUp(object);
    correctModelOrientation(object);
  }
  normalizeModel(object);
  if (materialMode === 'iron001') {
    object.userData.pendingIron001Materials = true;
    object.userData.materialMode = 'iron001';
  } else if (materialMode !== 'preserve') {
    applyWhiteMaterials(object);
  }
  return object;
}

function prepareUnrealReferenceObject(object) {
  convertUnrealZUpToThreeYUpFixed(object);
  object.userData.ironSyncReference = {
    source: 'Unreal Engine Og.FBX',
    coordinateBridge: 'UE Z-up converted to Three.js Y-up',
    orientationMode: 'fixed_reference_no_auto_correction',
    note: 'No se aplica correctModelOrientation ni autoFaceCamera para conservar la referencia de Unreal.',
  };
}

function convertUnrealZUpToThreeYUp(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  if (size.y >= size.z) return;

  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  object.quaternion.premultiply(q);
  object.updateMatrixWorld(true);
}

function convertUnrealZUpToThreeYUpFixed(object) {
  object.updateMatrixWorld(true);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  object.quaternion.premultiply(q);
  object.updateMatrixWorld(true);
}

export function correctModelOrientation(object) {
  object.updateMatrixWorld(true);
  const direction = getBodyUpDirection(object);

  if (direction.lengthSq() > 0.0001) {
    const align = new THREE.Quaternion().setFromUnitVectors(
      direction.normalize(),
      new THREE.Vector3(0, 1, 0),
    );
    object.quaternion.premultiply(align);
    object.updateMatrixWorld(true);
  }

  ensureHeadAboveFeet(object);
  autoFaceCamera(object);
}

export function normalizeModel(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 2.15 / Math.max(size.x, size.y, size.z, 0.001);
  object.scale.multiplyScalar(scale);
  object.position.sub(center.multiplyScalar(scale));
  object.updateMatrixWorld(true);
  const normalizedBox = new THREE.Box3().setFromObject(object);
  object.position.y -= normalizedBox.min.y;
  object.updateMatrixWorld(true);
  const finalBox = new THREE.Box3().setFromObject(object);
  const finalCenter = finalBox.getCenter(new THREE.Vector3());
  object.position.x -= finalCenter.x;
  object.position.z -= finalCenter.z;
}

export function applyWhiteMaterials(object) {
  const whiteMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.46,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  object.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    node.material = whiteMaterial.clone();
    node.material.needsUpdate = true;
  });
}

function findBone(root, names) {
  const normalized = new Set(names.map((name) => name.toLowerCase()));
  let found = null;
  root.traverse((node) => {
    if (found || !node.isBone) return;
    const clean = cleanBoneName(node.name);
    if (normalized.has(clean) || [...normalized].some((name) => clean.endsWith(name))) found = node;
  });
  return found;
}

function getBodyUpDirection(object) {
  const head = findBone(object, ['Head', 'head']);
  const leftFoot = findBone(object, ['LeftFoot', 'leftfoot', 'Foot_L', 'foot_l', 'l_foot']);
  const rightFoot = findBone(object, ['RightFoot', 'rightfoot', 'Foot_R', 'foot_r', 'r_foot']);
  const hips = findBone(object, ['Hips', 'hips', 'Pelvis', 'pelvis']);

  if (head && leftFoot && rightFoot) {
    const headPosition = worldPosition(head);
    const feetCenter = worldPosition(leftFoot).add(worldPosition(rightFoot)).multiplyScalar(0.5);
    return headPosition.sub(feetCenter);
  }

  if (head && hips) {
    return worldPosition(head).sub(worldPosition(hips));
  }

  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  if (size.z > size.y && size.z > size.x) return new THREE.Vector3(0, 0, 1);
  if (size.x > size.y && size.x > size.z) return new THREE.Vector3(1, 0, 0);
  return new THREE.Vector3(0, 1, 0);
}

function ensureHeadAboveFeet(object) {
  object.updateMatrixWorld(true);
  const head = findBone(object, ['Head', 'head']);
  const leftFoot = findBone(object, ['LeftFoot', 'leftfoot', 'Foot_L', 'foot_l', 'l_foot']);
  const rightFoot = findBone(object, ['RightFoot', 'rightfoot', 'Foot_R', 'foot_r', 'r_foot']);
  if (!head || !leftFoot || !rightFoot) return;

  const headY = worldPosition(head).y;
  const feetY = worldPosition(leftFoot).add(worldPosition(rightFoot)).multiplyScalar(0.5).y;
  if (headY < feetY) {
    object.rotateZ(Math.PI);
    object.updateMatrixWorld(true);
  }
}

function autoFaceCamera(object) {
  object.updateMatrixWorld(true);
  const left = findBone(object, ['LeftArm', 'leftarm', 'LeftUpLeg', 'leftupleg']);
  const right = findBone(object, ['RightArm', 'rightarm', 'RightUpLeg', 'rightupleg']);
  if (!left || !right) return;
  const leftPosition = new THREE.Vector3();
  const rightPosition = new THREE.Vector3();
  left.getWorldPosition(leftPosition);
  right.getWorldPosition(rightPosition);
  const side = rightPosition.sub(leftPosition);
  if (side.lengthSq() < 0.0001) return;
  const sideFlat = new THREE.Vector3(side.x, 0, side.z);
  if (sideFlat.lengthSq() < 0.0001) return;
  sideFlat.normalize();
  const targetSide = new THREE.Vector3(1, 0, 0);
  const align = new THREE.Quaternion().setFromUnitVectors(sideFlat, targetSide);
  object.quaternion.premultiply(align);
  object.updateMatrixWorld(true);
}

function cleanBoneName(name) {
  return String(name)
    .replace(/^mixamorig[:_]/i, '')
    .replace(/^Armature[.:_]/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function worldPosition(object) {
  const position = new THREE.Vector3();
  object.getWorldPosition(position);
  return position;
}
