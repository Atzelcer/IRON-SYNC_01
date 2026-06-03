import { BONE_ORDER } from '../core/boneMap.js';
import { createFrameState } from '../core/biomechState.js';
import { clampRotator } from '../core/constraints.js';
import { CollisionSystem } from '../core/collisionSystem.js';
import { RewardSystem } from '../core/rewardSystem.js';
import { IronSyncRotator, degreesToRadians } from '../core/unrealTypes.js';
import { DrlEnvironment } from '../drl/DrlEnvironment.js';
import { DatasetRecorder } from '../io/DatasetRecorder.js';
import { IronSyncWebSocket } from '../io/IronSyncWebSocket.js';
import { BiomechScene } from '../three/BiomechScene.js';
import { IronSyncFbxLoader } from '../three/fbxLoader.js';
import { ProceduralAnimator } from '../three/proceduralAnimator.js';
import { createProceduralRig } from '../three/proceduralRig.js';
import { fitObjectToLab, SkeletonMapper } from '../three/skeletonMapper.js';
import { createElement } from './dom.js';
import { PanelRenderer, populateBoneSelect } from './panels.js';

export class BiomechLabApp {
  constructor(root) {
    this.root = root;
    this.scene = null;
    this.mapper = new SkeletonMapper();
    this.collisionSystem = new CollisionSystem();
    this.rewardSystem = new RewardSystem();
    this.recorder = new DatasetRecorder();
    this.fbxLoader = new IronSyncFbxLoader();
    this.previousFrame = null;
    this.selectedAlias = 'hip';
    this.packetCount = 0;
    this.socketStatus = 'Desconectado';
    this.manualRotation = new IronSyncRotator();
    this.drlEnabled = true;
    this.debugColliders = true;
  }

  start() {
    this.#mountLayout();
    this.scene = new BiomechScene(this.nodes.viewport);
    this.#loadProceduralRig();
    this.#bindEvents();
    window.addEventListener('resize', () => this.scene.resize());
    this.#loop();
  }

  async #loadFbx(file) {
    this.#setStatus(`Cargando FBX: ${file.name}`);
    const object = await this.fbxLoader.loadFromFile(file);
    fitObjectToLab(object);
    this.scene.setModel(object);
    const bones = this.mapper.mapFromObject(object);
    this.#wireRuntime(bones);
    this.#setStatus(`FBX cargado · ${bones.size}/15 huesos mapeados`);
  }

  #loadProceduralRig() {
    const { group, bones } = createProceduralRig();
    this.scene.setModel(group);
    this.mapper.applyAliasesToProceduralRig(bones);
    this.#wireRuntime(this.mapper.bones);
    this.#setStatus('Rig procedural activo · listo para entrenamiento');
  }

  #wireRuntime(bones) {
    this.bones = bones;
    this.animator = new ProceduralAnimator(this.bones);
    this.environment = new DrlEnvironment(this.bones);
    this.panelRenderer = new PanelRenderer(this.nodes);
  }

  #loop() {
    requestAnimationFrame(() => this.#loop());
    const elapsed = this.scene.clock.getElapsedTime();
    this.animator.update(elapsed);

    if (this.drlEnabled) {
      const action = this.environment.sampleAutonomousAction(elapsed);
      this.environment.applyAction(action);
    }

    this.#applyManualRotation();
    this.collisionSystem.updateColliders(this.bones);
    const collisions = this.collisionSystem.detect();
    const frame = createFrameState({ bones: this.bones, previousFrame: this.previousFrame, collisions });
    const reward = this.rewardSystem.evaluate(frame);
    const state = this.environment.getState(frame, reward);
    this.recorder.push(frame, reward, this.environment);
    this.previousFrame = frame;

    if (this.debugColliders) this.scene.setDebugSpheres(this.collisionSystem.colliders);
    this.#renderPanels(frame, reward, state);
    this.scene.render();
  }

  #applyManualRotation() {
    const bone = this.bones.get(this.selectedAlias);
    if (!bone) return;
    const clamped = clampRotator(this.selectedAlias, this.manualRotation);
    bone.rotation.x = degreesToRadians(clamped.pitch);
    bone.rotation.y = degreesToRadians(clamped.yaw);
    bone.rotation.z = degreesToRadians(clamped.roll);
  }

  #renderPanels(frame, reward, state) {
    this.panelRenderer.renderBoneInspector(frame, this.selectedAlias);
    this.panelRenderer.renderCollisionDebug(frame.collisions);
    this.panelRenderer.renderRewardDebug(reward);
    this.panelRenderer.renderDrlDebug(this.environment, state);
    this.panelRenderer.renderSensorDebug(this.socketStatus, this.packetCount);
    this.nodes.frameCount.textContent = `${this.recorder.frames.length} frames`;
    this.nodes.rewardBadge.textContent = `${reward.total.toFixed(1)} reward`;
  }

  #mountLayout() {
    this.root.innerHTML = `
      <main class="lab-shell">
        <section class="viewport-shell">
          <header class="topbar">
            <div>
              <p class="eyebrow">IRON-SYNC</p>
              <h1>Laboratorio Biomecánico DRL</h1>
            </div>
            <div class="status-strip">
              <span id="statusText">Inicializando</span>
              <span id="rewardBadge">0 reward</span>
              <span id="frameCount">0 frames</span>
            </div>
          </header>
          <div id="viewport" class="viewport"></div>
        </section>

        <aside class="tool-panel">
          <section class="panel-section">
            <h2>Entrada</h2>
            <label class="file-button">
              <input id="fbxInput" type="file" accept=".fbx" />
              Cargar FBX
            </label>
            <button id="proceduralBtn" type="button">Rig procedural</button>
          </section>

          <section class="panel-section">
            <h2>Control de huesos</h2>
            <select id="boneSelect"></select>
            <div class="slider-grid">
              ${sliderTemplate('rx', 'RX', -120, 120)}
              ${sliderTemplate('ry', 'RY', -120, 120)}
              ${sliderTemplate('rz', 'RZ', -120, 120)}
            </div>
            <label class="toggle-row">
              <input id="drlToggle" type="checkbox" checked />
              DRL autónomo
            </label>
            <label class="toggle-row">
              <input id="colliderToggle" type="checkbox" checked />
              Collision debug
            </label>
          </section>

          <section class="panel-section">
            <h2>Bone Inspector</h2>
            <div id="boneInspector" class="data-stack"></div>
          </section>

          <section class="panel-section two-col">
            <div>
              <h2>Reward</h2>
              <div id="rewardDebug" class="data-stack"></div>
            </div>
            <div>
              <h2>Colisiones</h2>
              <div id="collisionDebug" class="data-stack"></div>
            </div>
          </section>

          <section class="panel-section two-col">
            <div>
              <h2>DRL Debug</h2>
              <div id="drlDebug" class="data-stack"></div>
            </div>
            <div>
              <h2>Sensores</h2>
              <div id="sensorDebug" class="data-stack"></div>
            </div>
          </section>

          <section class="panel-section">
            <h2>Dataset Recorder</h2>
            <div class="button-row">
              <button id="recordBtn" type="button">Grabar</button>
              <button id="stopBtn" type="button">Detener</button>
              <button id="exportBtn" type="button">Exportar JSON</button>
            </div>
          </section>

          <section class="panel-section">
            <h2>WebSocket Python</h2>
            <div class="socket-row">
              <input id="socketUrl" value="ws://127.0.0.1:8765" />
              <button id="connectBtn" type="button">Conectar</button>
            </div>
          </section>
        </aside>
      </main>
    `;

    this.nodes = {
      viewport: this.root.querySelector('#viewport'),
      statusText: this.root.querySelector('#statusText'),
      rewardBadge: this.root.querySelector('#rewardBadge'),
      frameCount: this.root.querySelector('#frameCount'),
      fbxInput: this.root.querySelector('#fbxInput'),
      proceduralBtn: this.root.querySelector('#proceduralBtn'),
      boneSelect: this.root.querySelector('#boneSelect'),
      rx: this.root.querySelector('#rx'),
      ry: this.root.querySelector('#ry'),
      rz: this.root.querySelector('#rz'),
      drlToggle: this.root.querySelector('#drlToggle'),
      colliderToggle: this.root.querySelector('#colliderToggle'),
      boneInspector: this.root.querySelector('#boneInspector'),
      collisionDebug: this.root.querySelector('#collisionDebug'),
      rewardDebug: this.root.querySelector('#rewardDebug'),
      drlDebug: this.root.querySelector('#drlDebug'),
      sensorDebug: this.root.querySelector('#sensorDebug'),
      recordBtn: this.root.querySelector('#recordBtn'),
      stopBtn: this.root.querySelector('#stopBtn'),
      exportBtn: this.root.querySelector('#exportBtn'),
      socketUrl: this.root.querySelector('#socketUrl'),
      connectBtn: this.root.querySelector('#connectBtn'),
    };
    populateBoneSelect(this.nodes.boneSelect);
  }

  #bindEvents() {
    this.nodes.fbxInput.addEventListener('change', (event) => {
      const [file] = event.target.files;
      if (file) this.#loadFbx(file).catch((error) => this.#setStatus(`Error FBX: ${error.message}`));
    });
    this.nodes.proceduralBtn.addEventListener('click', () => this.#loadProceduralRig());
    this.nodes.boneSelect.addEventListener('change', () => {
      this.selectedAlias = this.nodes.boneSelect.value;
      this.manualRotation = new IronSyncRotator();
      for (const id of ['rx', 'ry', 'rz']) this.nodes[id].value = '0';
    });
    for (const [id, key] of [['rx', 'pitch'], ['ry', 'yaw'], ['rz', 'roll']]) {
      this.nodes[id].addEventListener('input', () => {
        this.manualRotation[key] = Number(this.nodes[id].value);
        this.animator.enabled = false;
      });
    }
    this.nodes.drlToggle.addEventListener('change', () => {
      this.drlEnabled = this.nodes.drlToggle.checked;
    });
    this.nodes.colliderToggle.addEventListener('change', () => {
      this.debugColliders = this.nodes.colliderToggle.checked;
    });
    this.nodes.recordBtn.addEventListener('click', () => {
      this.recorder.start();
      this.#setStatus('Grabando dataset biomecánico');
    });
    this.nodes.stopBtn.addEventListener('click', () => {
      this.recorder.stop();
      this.#setStatus('Grabación detenida');
    });
    this.nodes.exportBtn.addEventListener('click', () => this.recorder.download());
    this.nodes.connectBtn.addEventListener('click', () => this.#connectWebSocket());
  }

  #connectWebSocket() {
    this.webSocket = new IronSyncWebSocket({
      onPacket: (packet) => {
        this.packetCount += 1;
        this.#applySensorPacket(packet);
      },
      onStatus: (status) => {
        this.socketStatus = status;
      },
    });
    this.webSocket.connect(this.nodes.socketUrl.value);
  }

  #applySensorPacket(packet) {
    if (!packet?.rotations) return;
    this.animator.enabled = false;
    for (const [alias, values] of Object.entries(packet.rotations)) {
      if (!BONE_ORDER.includes(alias)) continue;
      const bone = this.bones.get(alias);
      if (!bone) continue;
      const rotator = clampRotator(alias, new IronSyncRotator(values.rx ?? 0, values.ry ?? 0, values.rz ?? 0));
      bone.rotation.x = degreesToRadians(rotator.pitch);
      bone.rotation.y = degreesToRadians(rotator.yaw);
      bone.rotation.z = degreesToRadians(rotator.roll);
    }
  }

  #setStatus(text) {
    this.nodes.statusText.textContent = text;
  }
}

function sliderTemplate(id, label, min, max) {
  return `
    <label>
      <span>${label}</span>
      <input id="${id}" type="range" min="${min}" max="${max}" value="0" />
    </label>
  `;
}
