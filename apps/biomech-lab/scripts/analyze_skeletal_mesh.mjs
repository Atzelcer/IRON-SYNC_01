/**
 * Análisis exhaustivo Og.FBX — mismo pipeline que el lab (referenceMode: unreal).
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

import { BONE_ORDER, BONE_ALIASES } from '../src/core/boneMap.js';
import { BoneMapper } from '../src/skeleton/boneMapper.js';
import { BoneController } from '../src/skeleton/boneController.js';
import { UNREAL_INITIAL_POSE } from '../src/skeleton/unrealInitialPose.js';
import {
  normalizeModel,
  applyWhiteMaterials,
} from '../src/scene/modelLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FBX_PATH = path.resolve(__dirname, '../skeletalMesh/Og.FBX');

/** Mock mínimo para FBXLoader (texturas) en Node. */
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElementNS: () => ({
      style: {},
      setAttribute: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  };
}

function rad2deg(r) {
  return (r * 180) / Math.PI;
}

function localEulerDeg(bone) {
  return {
    rx: round(rad2deg(bone.rotation.x)),
    ry: round(rad2deg(bone.rotation.y)),
    rz: round(rad2deg(bone.rotation.z)),
    order: bone.rotation.order ?? 'XYZ',
  };
}

function worldPos(bone) {
  const v = new THREE.Vector3();
  bone.getWorldPosition(v);
  return { x: round(v.x), y: round(v.y), z: round(v.z) };
}

function localPos(bone) {
  return { x: round(bone.position.x), y: round(bone.position.y), z: round(bone.position.z) };
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

function convertUnrealZUpToThreeYUpFixed(object) {
  object.updateMatrixWorld(true);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  object.quaternion.premultiply(q);
  object.updateMatrixWorld(true);
}

async function main() {
  if (!fs.existsSync(FBX_PATH)) {
    console.error('FBX no encontrado:', FBX_PATH);
    process.exit(1);
  }

  const loader = new FBXLoader();
  const nodeBuffer = fs.readFileSync(FBX_PATH);
  const arrayBuffer = nodeBuffer.buffer.slice(
    nodeBuffer.byteOffset,
    nodeBuffer.byteOffset + nodeBuffer.byteLength,
  );
  const loaded = loader.parse(arrayBuffer, FBX_PATH);
  const object = loaded;
  object.name = 'Og.FBX';
  convertUnrealZUpToThreeYUpFixed(object);
  normalizeModel(object);
  applyWhiteMaterials(object);
  object.updateMatrixWorld(true);

  const mapper = new BoneMapper();
  mapper.scan(object);
  const controller = new BoneController(mapper);

  const missing = BONE_ORDER.filter((a) => !mapper.getBones().has(a));
  console.log('=== Og.FBX — análisis 15 huesos ===');
  console.log('Ruta:', FBX_PATH);
  console.log('Huesos mapeados:', BONE_ORDER.length - missing.length, '/ 15');
  if (missing.length) console.log('FALTAN:', missing.join(', '));

  const report = { bind: {}, unrealInitialApplied: {}, readAfterUnreal: {}, fileReference: {} };

  for (const alias of BONE_ORDER) {
    const bone = mapper.getBones().get(alias);
    const ref = UNREAL_INITIAL_POSE[alias];
    if (!bone) continue;

    report.bind[alias] = {
      ueBone: BONE_ALIASES[alias],
      localEulerDeg: localEulerDeg(bone),
      localPos: localPos(bone),
      worldPos: worldPos(bone),
    };

    report.fileReference[alias] = ref
      ? {
        frotator: { pitch: ref.rx, yaw: ref.ry, roll: ref.rz },
        fvector: { x: ref.tx, y: ref.ty, z: ref.z },
      }
      : null;
  }

  controller.applyUnrealInitialPose();
  object.updateMatrixWorld(true);

  for (const alias of BONE_ORDER) {
    const bone = mapper.getBones().get(alias);
    if (!bone) continue;
    report.unrealInitialApplied[alias] = {
      localEulerAbsDeg: localEulerDeg(bone),
      worldPos: worldPos(bone),
    };
    report.readAfterUnreal[alias] = {
      readDeltaDeg: controller.read(alias),
      readUnreal: controller.readUnreal(alias),
    };
  }

  console.log('\n--- 1) BIND (tras cargar + pipeline unreal, antes de applyUnrealInitialPose) ---');
  printTable(report.bind, 'bind');

  console.log('\n--- 2) UNREAL_INITIAL_POSE en archivo (referencia export UE) ---');
  printRefTable(report.fileReference);

  console.log('\n--- 3) Tras applyUnrealInitialPose() — rotación local absoluta en Three ---');
  printTable(report.unrealInitialApplied, 'unreal');

  console.log('\n--- 4) controller.read() = euler local − bind inicial (lo que usa el lab como delta) ---');
  for (const alias of BONE_ORDER) {
    const r = report.readAfterUnreal[alias]?.readDeltaDeg;
    const ref = report.fileReference[alias]?.frotator;
    if (!r || !ref) continue;
    const dP = round(r.rx - ref.pitch);
    const dY = round(r.ry - ref.yaw);
    const dR = round(r.rz - ref.roll);
    const match = Math.abs(dP) < 0.05 && Math.abs(dY) < 0.05 && Math.abs(dR) < 0.05;
    console.log(
      `${alias.padEnd(5)} read(${r.rx}, ${r.ry}, ${r.rz}) vs file(${ref.pitch}, ${ref.yaw}, ${ref.roll}) Δ(${dP}, ${dY}, ${dR}) ${match ? 'OK' : 'DIFF'}`,
    );
  }

  const outPath = path.resolve(__dirname, '../reports/skeletal_mesh_15_bones_analysis.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('\nJSON completo:', outPath);
}

function printTable(section, mode) {
  for (const alias of BONE_ORDER) {
    const row = section[alias];
    if (!row) {
      console.log(`${alias}: (sin hueso)`);
      continue;
    }
    if (mode === 'bind') {
      const e = row.localEulerDeg;
      const w = row.worldPos;
      const p = row.localPos;
      console.log(
        `${alias.padEnd(5)} ${row.ueBone.padEnd(14)} local°(${e.rx}, ${e.ry}, ${e.rz}) localPos(${p.x}, ${p.y}, ${p.z}) world(${w.x}, ${w.y}, ${w.z})`,
      );
    } else {
      const e = row.localEulerAbsDeg;
      const w = row.worldPos;
      console.log(
        `${alias.padEnd(5)} local°(${e.rx}, ${e.ry}, ${e.rz}) world(${w.x}, ${w.y}, ${w.z})`,
      );
    }
  }
}

function printRefTable(section) {
  for (const alias of BONE_ORDER) {
    const row = section[alias];
    if (!row) {
      console.log(`${alias}: sin ref`);
      continue;
    }
    const f = row.frotator;
    const v = row.fvector;
    console.log(
      `${alias.padEnd(5)} FRot(${f.pitch}, ${f.yaw}, ${f.roll}) FVector(${v.x}, ${v.y}, ${v.z})`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
