import * as THREE from 'three';

import { BONE_ALIASES, BONE_ORDER, findAliasByBoneName } from '../core/boneMap.js';

export class SkeletonMapper {
  constructor() {
    this.bones = new Map();
    this.unmapped = [];
  }

  mapFromObject(root) {
    this.bones.clear();
    this.unmapped = [];

    root.traverse((node) => {
      if (!node.isBone) return;
      const alias = findAliasByBoneName(node.name);
      if (alias) {
        this.bones.set(alias, node);
      } else {
        this.unmapped.push(node.name);
      }
    });

    return this.bones;
  }

  missingAliases() {
    return BONE_ORDER.filter((alias) => !this.bones.has(alias));
  }

  applyAliasesToProceduralRig(rigBones) {
    this.bones.clear();
    for (const alias of Object.keys(BONE_ALIASES)) {
      const bone = rigBones.get(alias);
      if (bone) this.bones.set(alias, bone);
    }
    return this.bones;
  }
}

export function fitObjectToLab(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const scale = 2.1 / Math.max(size.y || 1, size.x || 1, size.z || 1);
  object.scale.multiplyScalar(scale);
  object.position.sub(center.multiplyScalar(scale));
  object.position.y = 0;
}
