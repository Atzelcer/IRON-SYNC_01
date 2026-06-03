import * as THREE from 'three';

const GRID_BLUE = 0x1fa4ff;
const STEEL = 0x2c3640;
const FLOOR = 0x353a3f;
const WARNING = 0xf2b84b;
const SENSOR_GREEN = 0x44d27a;

export function createUnrealTestEnvironment() {
  const root = new THREE.Group();
  root.name = 'UE_Biomech_Test_Map';

  root.add(createFloor());
  root.add(createMeasurementGrid());
  root.add(createAxisGantry());
  root.add(createCalibrationRings());
  root.add(createBackWall());
  root.add(createSensorBeacons());
  root.add(createCaptureVolume());

  return root;
}

function createFloor() {
  const group = new THREE.Group();

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.MeshStandardMaterial({
      color: FLOOR,
      roughness: 0.72,
      metalness: 0.08,
      envMapIntensity: 0.6,
    }),
  );
  floor.name = 'UE_Studio_Floor';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const centerPad = new THREE.Mesh(
    new THREE.CylinderGeometry(1.35, 1.35, 0.018, 96),
    new THREE.MeshStandardMaterial({
      color: 0x1f252b,
      roughness: 0.5,
      metalness: 0.18,
    }),
  );
  centerPad.name = 'IRON_SYNC_Calibration_Pad';
  centerPad.position.y = 0.012;
  centerPad.receiveShadow = true;
  group.add(centerPad);

  const ringMaterial = new THREE.MeshBasicMaterial({ color: GRID_BLUE, transparent: true, opacity: 0.54 });
  for (const radius of [0.62, 1.0, 1.34]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.008, radius + 0.008, 96), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.026;
    group.add(ring);
  }

  return group;
}

function createMeasurementGrid() {
  const group = new THREE.Group();
  const grid = new THREE.GridHelper(14, 28, GRID_BLUE, 0x56616b);
  grid.name = 'UE_Viewport_Grid';
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  grid.position.y = 0.034;
  group.add(grid);

  const fineGrid = new THREE.GridHelper(4, 16, 0x92e7ff, 0x36424b);
  fineGrid.name = 'IRON_SYNC_Fine_Center_Grid';
  fineGrid.material.transparent = true;
  fineGrid.material.opacity = 0.34;
  fineGrid.position.y = 0.038;
  group.add(fineGrid);

  return group;
}

function createAxisGantry() {
  const group = new THREE.Group();
  const beamMaterial = new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.46, metalness: 0.32 });
  const blueMaterial = new THREE.MeshBasicMaterial({ color: GRID_BLUE });
  const redMaterial = new THREE.MeshBasicMaterial({ color: 0xff5a5f });
  const greenMaterial = new THREE.MeshBasicMaterial({ color: SENSOR_GREEN });

  addBeam(group, new THREE.Vector3(0, 2.75, -3.1), new THREE.Vector3(5.2, 0.05, 0.05), beamMaterial);
  addBeam(group, new THREE.Vector3(-2.6, 1.35, -3.1), new THREE.Vector3(0.05, 2.8, 0.05), beamMaterial);
  addBeam(group, new THREE.Vector3(2.6, 1.35, -3.1), new THREE.Vector3(0.05, 2.8, 0.05), beamMaterial);

  addBeam(group, new THREE.Vector3(1.0, 0.06, 0), new THREE.Vector3(2, 0.025, 0.025), redMaterial);
  addBeam(group, new THREE.Vector3(0, 0.06, 1.0), new THREE.Vector3(0.025, 0.025, 2), blueMaterial);
  addBeam(group, new THREE.Vector3(0, 1.0, 0), new THREE.Vector3(0.025, 2, 0.025), greenMaterial);

  return group;
}

function createCalibrationRings() {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0x76ddff,
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
  });

  for (const [radius, y] of [[0.72, 0.85], [0.95, 1.25], [1.18, 1.68]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.007, 8, 128), material);
    ring.name = 'Biomech_Rotation_Guide';
    ring.position.y = y;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  }

  return group;
}

function createBackWall() {
  const group = new THREE.Group();
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(8.8, 3.3, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x20262d, roughness: 0.64, metalness: 0.1 }),
  );
  wall.name = 'UE_Backdrop_Panel';
  wall.position.set(0, 1.65, -3.18);
  wall.receiveShadow = true;
  group.add(wall);

  const stripeMaterial = new THREE.MeshBasicMaterial({ color: WARNING });
  for (let i = -4; i <= 4; i += 1) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.24, 0.01), stripeMaterial);
    stripe.rotation.z = -0.65;
    stripe.position.set(i * 0.34, 0.22, -3.13);
    group.add(stripe);
  }

  return group;
}

function createSensorBeacons() {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(0.045, 18, 12);
  const material = new THREE.MeshStandardMaterial({
    color: SENSOR_GREEN,
    emissive: SENSOR_GREEN,
    emissiveIntensity: 1.8,
    roughness: 0.28,
  });
  const positions = [
    [-1.2, 0.05, 1.2],
    [1.2, 0.05, 1.2],
    [-1.2, 0.05, -1.2],
    [1.2, 0.05, -1.2],
    [0, 2.55, -3.05],
  ];

  for (const position of positions) {
    const beacon = new THREE.Mesh(geometry, material);
    beacon.name = 'UDP_Sensor_Beacon';
    beacon.position.set(...position);
    group.add(beacon);
  }

  return group;
}

function createCaptureVolume() {
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(2.8, 2.4, 2.8));
  const material = new THREE.LineBasicMaterial({ color: 0x79e6ff, transparent: true, opacity: 0.24 });
  const volume = new THREE.LineSegments(edges, material);
  volume.name = 'IRON_SYNC_Capture_Volume';
  volume.position.y = 1.2;
  return volume;
}

function addBeam(group, position, scale, material) {
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  beam.position.copy(position);
  beam.scale.copy(scale);
  beam.castShadow = true;
  beam.receiveShadow = true;
  group.add(beam);
}
