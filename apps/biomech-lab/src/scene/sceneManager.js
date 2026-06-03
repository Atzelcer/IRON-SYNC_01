import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { CameraManager } from './cameraManager.js';
import { setupLights } from './lightManager.js';
import { createUnrealTestEnvironment } from './unrealTestEnvironment.js';

export class SceneManager {
  constructor(host) {
    this.host = host;
    this.clock = new THREE.Clock();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1015);
    this.scene.fog = new THREE.FogExp2(0x0b1015, 0.035);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 140);
    this.camera.position.set(4.4, 2.65, 5.8);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.host.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 1.25;
    this.controls.maxDistance = 12;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 1, 0);
    this.cameraManager = new CameraManager(this.camera, this.controls);
    this.bodyView = 'unreal';

    this.environment = createUnrealTestEnvironment();
    this.modelGroup = new THREE.Group();
    this.colliderGroup = new THREE.Group();
    this.boneHelperGroup = new THREE.Group();
    this.boneLabelGroup = new THREE.Group();
    this.sensorMarkerGroup = new THREE.Group();
    this.currentColliderMeshes = new Set();
    this.boneLabelItems = new Map();
    this.sensorMarkerItems = new Map();
    this.boneHelperGroup.visible = false;
    this.boneLabelGroup.visible = false;
    this.sensorMarkerGroup.visible = false;
    this.sensorLabelsVisible = true;
    this.scene.add(this.environment, this.modelGroup, this.colliderGroup, this.boneHelperGroup, this.boneLabelGroup, this.sensorMarkerGroup);

    setupLights(this.scene);
    this.resize();
  }

  setModel(object) {
    this.modelGroup.clear();
    this.boneHelperGroup.clear();
    this.boneLabelGroup.clear();
    this.boneLabelItems.clear();
    this.sensorMarkerGroup.clear();
    this.sensorMarkerItems.clear();
    this.colliderGroup.clear();
    this.currentColliderMeshes.clear();
    this.modelGroup.add(object);
    const helper = new THREE.SkeletonHelper(object);
    helper.name = 'IRON_SYNC_Green_Bones';
    helper.material = new THREE.LineBasicMaterial({
      color: 0x44d27a,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    helper.renderOrder = 30;
    this.boneHelperGroup.add(helper);
    this.cameraManager.focusObject(object);
  }

  setColliderMeshes(meshes) {
    const nextMeshes = new Set(meshes);
    for (const mesh of this.currentColliderMeshes) {
      if (!nextMeshes.has(mesh)) this.colliderGroup.remove(mesh);
    }
    for (const mesh of nextMeshes) {
      if (!this.currentColliderMeshes.has(mesh)) this.colliderGroup.add(mesh);
    }
    this.currentColliderMeshes = nextMeshes;
  }

  setColliderVisible(visible) {
    this.colliderGroup.visible = visible;
  }

  setBonesVisible(visible) {
    this.boneHelperGroup.visible = visible;
  }

  setBoneLabels(labels) {
    const activeAliases = new Set(labels.map((label) => label.alias));
    for (const [alias, item] of this.boneLabelItems.entries()) {
      if (!activeAliases.has(alias)) {
        this.boneLabelGroup.remove(item);
        this.boneLabelItems.delete(alias);
      }
    }

    for (const label of labels) {
      let item = this.boneLabelItems.get(label.alias);
      if (!item || item.userData.text !== label.text) {
        if (item) this.boneLabelGroup.remove(item);
        item = createLabelSprite(label.text, 0x44d27a);
        item.userData.text = label.text;
        this.boneLabelItems.set(label.alias, item);
        this.boneLabelGroup.add(item);
      }
      item.position.copy(label.position);
      item.position.y += 0.09;
    }
  }

  setBoneLabelsVisible(visible) {
    this.boneLabelGroup.visible = visible;
  }

  setSensorMarkers(markers) {
    const activeAliases = new Set(markers.map((marker) => marker.alias));
    for (const [alias, item] of this.sensorMarkerItems.entries()) {
      if (!activeAliases.has(alias)) {
        this.sensorMarkerGroup.remove(item.group);
        this.sensorMarkerItems.delete(alias);
      }
    }

    for (const marker of markers) {
      const item = this.#ensureSensorMarker(marker.alias);
      const { group, sphere } = item;
      group.position.copy(marker.position);
      if (marker.alias === 'chest') group.position.y += 0.08;
      if (marker.alias === 'hip') group.position.y += 0.04;

      const color = marker.sensorState === 'offline' || marker.sensorState === 'lost'
        ? 0xff5864
        : marker.sensorState === 'calibrating'
          ? 0x58a6ff
          : marker.severity === 'critical' || marker.severity === 'high'
        ? 0xff5864
        : marker.severity === 'medium' || marker.severity === 'low'
          ? 0xffb84d
          : 0x44d27a;
      sphere.material.color.setHex(color);

      const labelText = marker.label ?? marker.alias;
      if (item.labelText !== labelText || item.labelColor !== color) {
        if (item.label) group.remove(item.label);
        item.label = createLabelSprite(labelText, color);
        item.label.position.set(0, 0.105, 0);
        item.labelText = labelText;
        item.labelColor = color;
        group.add(item.label);
      }
      if (item.label) item.label.visible = this.sensorLabelsVisible;
    }
  }

  #ensureSensorMarker(alias) {
    if (this.sensorMarkerItems.has(alias)) return this.sensorMarkerItems.get(alias);

    const group = new THREE.Group();
    group.name = `${alias}_sensor_marker`;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0x44d27a, depthTest: false }),
    );
    sphere.renderOrder = 40;
    group.add(sphere);
    this.sensorMarkerGroup.add(group);

    const item = { group, sphere, label: null, labelText: '', labelColor: 0 };
    this.sensorMarkerItems.set(alias, item);
    return item;
  }

  setSensorMarkersVisible(visible) {
    this.sensorMarkerGroup.visible = visible;
  }

  setSensorLabelsVisible(visible) {
    this.sensorLabelsVisible = visible;
  }

  setBodyView(view) {
    const rotations = {
      unreal: 0,
      front: Math.PI,
      right: -Math.PI / 2,
      left: Math.PI / 2,
      back: 0,
      frontRight: Math.PI * 0.75,
      frontLeft: -Math.PI * 0.75,
    };
    this.bodyView = view;
    this.modelGroup.rotation.y = rotations[view] ?? 0;
    return this.bodyView;
  }

  resize() {
    const rect = this.host.getBoundingClientRect();
    this.camera.aspect = rect.width / Math.max(1, rect.height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(rect.width, rect.height, false);
  }

  render() {
    this.controls.update();
    const time = this.clock.getElapsedTime();
    this.#animateEnvironment(time);
    this.renderer.render(this.scene, this.camera);
  }

  #animateEnvironment(time) {
    this.environment.traverse((node) => {
      if (node.name !== 'UDP_Sensor_Beacon' || !node.material) return;
      node.material.emissiveIntensity = 1.25 + Math.sin(time * 2.6 + node.position.x) * 0.45;
    });
  }
}

function createLabelSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(8, 13, 18, 0.74)';
  roundRect(ctx, 4, 6, 152, 34, 8);
  ctx.fill();
  ctx.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 18px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 80, 23);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(0.34, 0.1, 1);
  sprite.renderOrder = 41;
  return sprite;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
