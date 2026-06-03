import * as THREE from 'three';

const SEGMENT_COLOR = 0x9bc3d5;
const JOINT_COLOR = 0x37d67a;
const SUIT_COLOR = 0x202833;

export function createProceduralRig() {
  const group = new THREE.Group();
  group.name = 'IRON_SYNC_ProceduralRig';
  const bones = new Map();

  const jointMaterial = new THREE.MeshStandardMaterial({
    color: JOINT_COLOR,
    emissive: JOINT_COLOR,
    emissiveIntensity: 0.75,
    roughness: 0.36,
    metalness: 0.12,
  });
  const segmentMaterial = new THREE.MeshStandardMaterial({
    color: SEGMENT_COLOR,
    roughness: 0.5,
    metalness: 0.22,
  });
  const suitMaterial = new THREE.MeshStandardMaterial({
    color: SUIT_COLOR,
    roughness: 0.58,
    metalness: 0.18,
  });

  const makeJoint = (alias, position, radius = 0.065) => {
    const bone = new THREE.Bone();
    bone.name = alias;
    bone.position.copy(position);

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 12), jointMaterial);
    mesh.name = `${alias}_joint`;
    mesh.castShadow = true;
    bone.add(mesh);
    bones.set(alias, bone);
    return bone;
  };

  const connect = (parent, child, length, radius = 0.035) => {
    parent.add(child);
    const segment = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), segmentMaterial);
    segment.name = `${parent.name}_${child.name}_segment`;
    segment.position.y = -length / 2;
    segment.castShadow = true;
    segment.receiveShadow = true;
    parent.add(segment);
  };

  const hip = makeJoint('hip', new THREE.Vector3(0, 1.05, 0), 0.09);
  const chest = makeJoint('chest', new THREE.Vector3(0, 0.55, 0), 0.09);
  const head = makeJoint('head', new THREE.Vector3(0, 0.55, 0), 0.08);

  const sL = makeJoint('sL', new THREE.Vector3(-0.34, 0.34, 0));
  const fL = makeJoint('fL', new THREE.Vector3(0.0, -0.42, 0));
  const hL = makeJoint('hL', new THREE.Vector3(0.0, -0.34, 0.03), 0.055);
  const sR = makeJoint('sR', new THREE.Vector3(0.34, 0.34, 0));
  const fR = makeJoint('fR', new THREE.Vector3(0.0, -0.42, 0));
  const hR = makeJoint('hR', new THREE.Vector3(0.0, -0.34, 0.03), 0.055);

  const tL = makeJoint('tL', new THREE.Vector3(-0.18, -0.14, 0));
  const knL = makeJoint('knL', new THREE.Vector3(0, -0.55, 0));
  const ftL = makeJoint('ftL', new THREE.Vector3(0.04, -0.5, 0.12), 0.055);
  const tR = makeJoint('tR', new THREE.Vector3(0.18, -0.14, 0));
  const knR = makeJoint('knR', new THREE.Vector3(0, -0.55, 0));
  const ftR = makeJoint('ftR', new THREE.Vector3(-0.04, -0.5, 0.12), 0.055);

  group.add(hip);
  addBodyShell(hip, chest, suitMaterial);
  connect(hip, chest, 0.55, 0.055);
  connect(chest, head, 0.45, 0.045);
  connect(chest, sL, 0.38);
  connect(sL, fL, 0.36);
  connect(fL, hL, 0.28);
  connect(chest, sR, 0.38);
  connect(sR, fR, 0.36);
  connect(fR, hR, 0.28);
  connect(hip, tL, 0.24, 0.05);
  connect(tL, knL, 0.55, 0.045);
  connect(knL, ftL, 0.46, 0.04);
  connect(hip, tR, 0.24, 0.05);
  connect(tR, knR, 0.55, 0.045);
  connect(knR, ftR, 0.46, 0.04);

  return { group, bones };
}

function addBodyShell(hip, chest, material) {
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.22, 0.24), material);
  pelvis.name = 'UE_Mannequin_Pelvis';
  pelvis.position.set(0, -0.06, 0);
  pelvis.castShadow = true;
  pelvis.receiveShadow = true;
  hip.add(pelvis);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.28), material);
  torso.name = 'UE_Mannequin_Torso';
  torso.position.set(0, -0.12, 0);
  torso.castShadow = true;
  torso.receiveShadow = true;
  chest.add(torso);
}
