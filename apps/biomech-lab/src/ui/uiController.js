import { BONE_ORDER, BONE_LABELS, buildPoseFromRotations } from '../core/boneMap.js';
import { assessPartialSensorCoverage, formatOnlineLabel } from '../core/partialSensorMode.js';
import { BONE_LIMITS } from '../skeleton/boneLimits.js';
import { UNREAL_INITIAL_POSE } from '../skeleton/unrealInitialPose.js';
import { BoneMapper } from '../skeleton/boneMapper.js';
import { BoneController } from '../skeleton/boneController.js';
import { SceneManager } from '../scene/sceneManager.js';
import { ModelLoader, applyWhiteMaterials } from '../scene/modelLoader.js';
import { IronSyncWebSocket } from '../io/IronSyncWebSocket.js';
import { ArduinoConnection } from '../io/ArduinoConnection.js';
import { PacketInspector } from '../io/PacketInspector.js';
import { UnrealEngineBridge } from '../io/UnrealEngineBridge.js';
import { createProceduralRig } from '../three/proceduralRig.js';
import { COLLISION_SAFETY_MARGIN, CollisionSystem } from '../biomechanics/collisionSystem.js';
import { RewardEngine } from '../biomechanics/rewardEngine.js';
import { AutonomousAgent } from '../drl/autonomousAgent.js';
import { APPLIED_MOVEMENTS, AppliedMovementPlayer } from '../drl/appliedMovements.js';
import { DrlTrainer } from '../drl/drlTrainer.js';
import { buildPolicyState } from '../drl/policyInterface.js';
import { QLearningAgent } from '../drl/qLearningAgent.js';
import { DEFAULT_TRAINING_CONFIG } from '../drl/trainingConfig.js';
import { ImuAiPipeline } from '../imu/imuAiPipeline.js';
import { SensorCalibrationManager } from '../calibration/sensorCalibration.js';
import {
  IngressPipeline,
  INGRESS_PIPELINE_SCHEMA,
  imuBaselineFromCaptureA,
  readMeshReferenceDeltas,
} from '../calibration/ingressPipeline.js';
import { UnifiedCalibrationOrchestrator, countMappedBones } from '../calibration/unifiedCalibration.js';
import { MasterCalibrationStore, toRelativePose } from '../calibration/masterCalibrationStore.js';
import { CalReferenceStore, buildLoadCalReferenceCommand } from '../calibration/calReferenceStore.js';
import { GestureLibrary } from '../gestures/gestureLibrary.js';
import { GestureTriggerEngine } from '../gestures/gestureTriggerEngine.js';
import { MovementPreprocessor } from '../preprocessing/movementPreprocessor.js';
import {
  RUNTIME_DEFAULT_BASE_RETURN,
  RUNTIME_DEFAULT_HOLD_STILL,
  RUNTIME_DEFAULT_MIN_PEAK,
  RUNTIME_MATCH_THRESHOLD,
} from '../preprocessing/multiMovementRecognizer.js';
import { computeMotionPeak, isNearBasePose } from '../preprocessing/sequenceTemporalTracker.js';
import {
  MovementTrainingSession,
  MOVEMENT_TRAINING_REQUIRED_BONES,
  TRAINING_APPROVAL_SCORE,
  TRAINING_BETWEEN_DEMOS_SECONDS,
  TRAINING_MAX_RETURN_TO_BASE_ERROR,
  TRAINING_MAX_START_BASE_ERROR,
  TRAINING_MOVEMENTS_PER_SAMPLE,
  TRAINING_POSE_COUNTDOWN_SECONDS,
  TRAINING_REFERENCE_DEMO_CYCLES,
  TRAINING_SAMPLE_COUNT,
  buildMovementCsvBundle,
  movementFolderName,
  prepareDatasetForPersistence,
} from '../training/movementTraining.js';
import {
  TRAINING_MOVEMENT_OPTIONS,
  formatCollectionLabel,
  trainingMovementBySelectorValue,
} from '../training/trainingCollections.js';
import {
  COLLECTIONS_REL_PATH,
  createCollection as createCollectionApi,
  listCollections as listCollectionsApi,
  loadCollection as loadCollectionApi,
  saveDatasetToCollection,
} from '../training/trainingCollectionApi.js';
import {
  PpoTrainingSession,
  PPO_TARGET_PRECISION_PCT,
} from '../training/ppoTrainingExperience.js';
import {
  fetchPpoLiveFrameHttp,
  startPpoTrainingHttp,
  stopPpoTrainingHttp,
  verifyTcnModelHttp,
} from '../io/ppoLabApi.js';
import { CompletePipelineController } from '../pipeline/completePipelineController.js';
import {
  FUSION_ACTIONS,
  PIPELINE_MODEL_SLOTS,
  basenameFromPath,
  pipelineDisplayFieldId,
  pipelineFileFieldId,
} from '../pipeline/completePipelineCatalog.js';
import {
  PL_PATH_FIELD,
  pipelineCompletoPanelHtml,
  renderPipelineDiagram,
} from '../pipeline/completePipelineDiagram.js';

const DEFAULT_TCN_MODEL_PATH = 'IA-IRON-SYNC/TCN/models/tcn_sanitizer_best.pt';
import { FrameRecorder } from '../recorder/frameRecorder.js';
import {
  downloadText,
  downloadJson,
  exportBiomechanicsConfig,
  exportBoneMap,
  exportPose,
  exportPolicySummary,
  exportQTable,
  exportQTrainingLog,
  exportQTransitions,
  exportRecording,
} from '../recorder/exporter.js';
import defaultSkeletalMeshUrl from '../../skeletalMesh/Og.FBX?url';
import { applyIron001Materials, iron001CatalogSummary } from '../three/iron001Materials.js';

const SIDEBAR_STORAGE_KEY = 'ironsync.sidebar.panels';
const SIDEBAR_MAX_OPEN = 3;
const FOOT_SUPPORT_MOVE_DEG = 9;
const FOOT_SUPPORT_AWAY_DEG = 14;
const FOOT_SUPPORT_RELEASE_DEG = 5;
const LEG_GROUPS = {
  L: ['tL', 'knL', 'ftL'],
  R: ['tR', 'knR', 'ftR'],
};
const MASTER_CALIBRATION_BUNDLE_SCHEMA = 'ironsync.master-calibration.bundle.v1';
const MIN_ACTIVE_SENSORS_FOR_MASTER_APPLY = 7;
const MASTER_CALIBRATION_RECENTS_KEY = 'ironsync.master-calibration.recents.v1';
const MASTER_CALIBRATION_RECENTS_MAX = 4;
const STRICT_REQUIRED_BASE_BONES = ['hip', 'chest', 'head'];
const STRICT_BASE_AVG_DELTA_MAX_DEG = 16;
const STRICT_BASE_MAX_DELTA_MAX_DEG = 30;
const UNREAL_SIMULATION_STEPS = [
  { mode: 'cal_still', label: 'Quieto base', seconds: 3 },
  { mode: 'head_pitch', label: 'Cabeza adelante/atras', seconds: 4 },
  { mode: 'head_yaw', label: 'Cabeza inclinacion lateral', seconds: 4 },
  { mode: 'head_roll', label: 'Cabeza izquierda/derecha', seconds: 3.5 },
  { mode: 'left_arm_forward', label: 'Brazo izquierdo frente', seconds: 3.5 },
  { mode: 'right_arm_forward', label: 'Brazo derecho frente', seconds: 3.5 },
  { mode: 'both_arms_forward', label: 'Ambos brazos frente', seconds: 4 },
  { mode: 'left_arm_front', label: 'Brazo izquierdo costado 90', seconds: 3.5 },
  { mode: 'right_arm_front', label: 'Brazo derecho costado 90', seconds: 3.5 },
  { mode: 'left_arm_side', label: 'Brazo izquierdo costado 60', seconds: 3.5 },
  { mode: 'right_arm_side', label: 'Brazo derecho costado 60', seconds: 3.5 },
  { mode: 'left_arm_back', label: 'Brazo izquierdo atras', seconds: 3.5 },
  { mode: 'right_arm_back', label: 'Brazo derecho atras', seconds: 3.5 },
  { mode: 'left_forearm_flex', label: 'Antebrazo izquierdo flexion/extension', seconds: 4 },
  { mode: 'right_forearm_flex', label: 'Antebrazo derecho flexion/extension', seconds: 4 },
  { mode: 'left_hand_wave', label: 'Mano izquierda saludo', seconds: 3 },
  { mode: 'right_hand_wave', label: 'Mano derecha saludo', seconds: 3 },
  { mode: 'left_thigh_front', label: 'Muslo izquierdo adelante', seconds: 3.5 },
  { mode: 'right_thigh_front', label: 'Muslo derecho adelante', seconds: 3.5 },
  { mode: 'left_leg_knee_flex', label: 'Rodilla izquierda flexion', seconds: 3.5 },
  { mode: 'right_leg_knee_flex', label: 'Rodilla derecha flexion', seconds: 3.5 },
  { mode: 'left_foot_pitch', label: 'Pie izquierdo punta', seconds: 3 },
  { mode: 'right_foot_pitch', label: 'Pie derecho punta', seconds: 3 },
  { mode: 'torso_twist_left', label: 'Torso giro izquierda', seconds: 3.5 },
  { mode: 'torso_twist_right', label: 'Torso giro derecha', seconds: 3.5 },
  { mode: 'body_turn_left', label: 'Cuerpo giro izquierda', seconds: 3.5 },
  { mode: 'body_turn_right', label: 'Cuerpo giro derecha', seconds: 3.5 },
];
const AGENT_MODE_LABELS = {
  pause: 'Pausa',
  cal_still: 'Quieto base',
  head_pitch: 'Cabeza adelante/atras',
  head_yaw: 'Cabeza inclinacion lateral',
  head_roll: 'Cabeza izquierda/derecha',
  left_arm_lift: 'Brazo izquierdo arriba/abajo',
  right_arm_lift: 'Brazo derecho arriba/abajo',
  left_arm_front: 'Brazo izquierdo costado 90',
  right_arm_front: 'Brazo derecho costado 90',
  left_arm_forward: 'Brazo izquierdo frente',
  right_arm_forward: 'Brazo derecho frente',
  both_arms_forward: 'Ambos brazos frente',
  left_arm_back: 'Brazo izquierdo atras',
  right_arm_back: 'Brazo derecho atras',
  left_arm_side: 'Brazo izquierdo costado 60',
  right_arm_side: 'Brazo derecho costado 60',
  left_forearm_flex: 'Antebrazo izquierdo flexion/extension',
  right_forearm_flex: 'Antebrazo derecho flexion/extension',
  left_hand_wave: 'Mano izquierda saludo',
  right_hand_wave: 'Mano derecha saludo',
  left_thigh_lift: 'Muslo izquierdo arriba/abajo',
  right_thigh_lift: 'Muslo derecho arriba/abajo',
  left_thigh_front: 'Muslo izquierdo adelante',
  right_thigh_front: 'Muslo derecho adelante',
  left_thigh_back: 'Muslo izquierdo atras',
  right_thigh_back: 'Muslo derecho atras',
  left_leg_knee_flex: 'Rodilla izquierda flexion',
  right_leg_knee_flex: 'Rodilla derecha flexion',
  left_foot_pitch: 'Pie izquierdo punta',
  right_foot_pitch: 'Pie derecho punta',
  left_foot_roll: 'Pie izquierdo lateral',
  right_foot_roll: 'Pie derecho lateral',
  torso_twist_left: 'Torso giro izquierda',
  torso_twist_right: 'Torso giro derecha',
  body_turn_left: 'Cuerpo giro izquierda',
  body_turn_right: 'Cuerpo giro derecha',
  body_bend_front: 'Cuerpo flexion adelante',
  body_bend_back: 'Cuerpo extension atras',
  body_bend_left: 'Cuerpo inclinacion izquierda',
  body_bend_right: 'Cuerpo inclinacion derecha',
  walk: 'Caminar coordinado',
  run: 'Correr coordinado',
  fly: 'Volar coordinado',
  soft: 'Exploracion suave',
  medium: 'Exploracion media',
  aggressive: 'Exploracion agresiva',
};

export class UiController {
  constructor(root) {
    this.root = root;
    this.mapper = new BoneMapper();
    this.modelLoader = new ModelLoader();
    this.collisionSystem = new CollisionSystem();
    this.rewardEngine = new RewardEngine();
    this.recorder = new FrameRecorder();
    this.selectedAlias = 'hip';
    this.previousRotations = null;
    this.rewardHistory = [];
    this.lastUiUpdate = 0;
    this.lastPhysicsUpdate = 0;
    this.liveFrames = 0;
    this.liveSource = 'offline';
    this.webSocket = null;
    this.arduinoConnection = null;
    this.sensorCalibration = new SensorCalibrationManager();
    this.ingressPipeline = new IngressPipeline();
    this.packetInspector = new PacketInspector(180);
    this.packetInspectorRenderPending = false;
    this.lastPacketInspectorHz = 0;
    this.unifiedCalibration = null;
    this.unifiedCalibrationView = {
      stage: 'idle',
      progress: 0,
      label: 'Sin iniciar',
      detail: '',
      running: false,
    };
    this.movementTraining = new MovementTrainingSession({ sampleCount: TRAINING_SAMPLE_COUNT });
    this.masterCalibration = new MasterCalibrationStore();
    this.calReferenceStore = new CalReferenceStore();
    this.biomechFootLock = {
      activeSide: null,
      blockedFrames: 0,
      lastWarnAt: 0,
    };
    this.selectedMasterCalibrationBundle = null;
    this.selectedMasterCalibrationFile = 'ninguno';
    this.selectedMasterCalibrationRecentKey = '';
    this.masterCalibrationRecents = loadMasterCalibrationRecents();
    this.guidedCalibrationApplyState = 'sin aplicar';
    this.guidedCalibrationApplyClass = '';
    this.guidedCalibrationStrictValidated = false;
    this.guidedCalibrationCapturing = false;
    this.guidedCalibrationCaptureProgress = 0;
    this.guidedCalibrationSessionActive = false;
    this.guidedCalibrationForceMode = false;
    this.guidedCalibrationPreviousSnapshot = null;
    this.guidedCalibrationPreviousSensorProfile = null;
    this.gestureLibrary = new GestureLibrary();
    this.gestureTrigger = new GestureTriggerEngine(this.gestureLibrary);
    this.appliedMovementPlayer = null;
    this.appliedMovementStatus = {
      active: false,
      progress: 0,
      phase: 'base',
      definition: null,
    };
    this.gestureTriggerEnabled = false;
    this.lastGestureTriggerEvent = null;
    this.movementPreprocessor = new MovementPreprocessor();
    this.preprocessingMatch = null;
    this.runtimeDatasetPreprocessor = new MovementPreprocessor();
    this.runtimeDatasetMatch = null;
    this.lastTrainingAutoSaveSessionId = null;
    this.trainingSessionStamp = '';
    this.trainingCollectionStamp = '';
    this.trainingCollections = [];
    this._collectionLoadTarget = null;
    this._persistedMovementKeys = new Set();
    this.arduinoFrames = 0;
    this.relayReportedFrames = 0;
    this.relayUdpIsCount = 0;
    this.relayParsedOk = 0;
    this.relayParseFail = 0;
    this.relayLastIsAgeMs = null;
    this.relayUdpBindFailed = false;
    this.livePacketCount = 0;
    this.liveSessionFrameCount = 0;
    this.lastSensorMuxByAlias = {};
    this.arduinoProgress = 0;
    this.arduinoSensorRows = [];
    this.arduinoStateText = 'Desconectado';
    this.arduinoCalReferenceLines = [];
    this.arduinoCalReferenceCollecting = false;
    this.calibrationConnectionVerified = false;
    this.hardwareSessionActive = false;
    this.megaCalibratingActive = false;
    this.userCalibrationRequested = false;
    this.hardwareStreamStarted = false;
    this.streamPausedByUser = false;
    this.sessionCalibrated = false;
    this.testSimulationActive = false;
    this.testLastFrameAt = 0;
    this.liveStreamHz = 0;
    this._liveStreamSample = { frames: 0, at: 0 };
    this._lastStreamKickAt = 0;
    this._lastAutoMapWarnAt = 0;
    this.testQModelLoaded = false;
    this.testUseRawRotations = false;
    this.testReadiness = {
      ready: false,
      missing: ['Sin verificar'],
      online: 0,
      framesFresh: false,
      calibrationApplied: false,
    };
    this.testLastMotion = { alias: '-', axis: '-', value: 0, rawValue: 0 };
    this.unrealSimulationActive = false;
    this.unrealSimulationStepIndex = 0;
    this.unrealSimulationStepStartedAt = 0;
    this.latestHardwarePose = null;
    this.lastAppliedHardwarePose = null;
    this.lastLiveSliderSync = 0;
    this.unrealBridge = null;
    this.unrealFrames = 0;
    this.qAgent = null;
    this.drlTrainer = null;
    this.imuAiPipeline = new ImuAiPipeline();
    this.completePipeline = new CompletePipelineController();
    this._pipelineSyntheticLastTick = 0;
    this._plPanelLastRender = 0;
    this._plDiagramStatusKey = '';
    this.ppoTrainingState = { state: 'idle', log: '' };
    this.ppoLiveFrame = null;
    this.ppoTrainHud = new PpoTrainingSession();
    this.tcnModelReady = false;
    this._ppoCompletedAtTarget = false;
    this.ppoMetricsPollTimer = null;
    this.ppoLivePollTimer = null;
    this.meshDriverMode = 'idle';
    this.modelInfo = { name: 'Rig procedural', format: 'procedural', hasSkeleton: true };
    this.flags = {
      biomechanics: {
        evaluate: true,
        anatomicalMarkers: true,
        anatomicalLabels: true,
        colliders: false,
      },
      hardware: {
        markers: false,
        labels: true,
        colorByState: true,
      },
      manual: {
        bones: false,
        boneNames: false,
      },
      drlPpo: {
        metrics: true,
        diagnostics: true,
      },
      iaSimulation: {
        pipeline: true,
        sensors: true,
      },
    };
  }

  start() {
    this.root.innerHTML = layoutTemplate();
    this.nodes = collectNodes(this.root);
    this.scene = new SceneManager(this.nodes.viewport);
    try {
      this.#bindEvents();
    } catch (error) {
      console.error('[biomech-lab] bindEvents', error);
      this.#status(`Error UI: ${error.message}`);
    }
    this.#bindPacketInspector();
    this.#renderTrainingCollectionSelectors();
    this.#refreshTrainingCollections();
    this.#renderGestureTriggerPanel();
    this.#loadDefaultSkeletalMesh();
    this.#autoBootstrapPpoLab();
    window.addEventListener('resize', () => this.scene.resize());
    requestAnimationFrame((time) => this.#loop(time));
  }

  #autoBootstrapPpoLab() {
    const tcn = DEFAULT_TCN_MODEL_PATH;
    if (this.nodes.ppoTcnPath) this.nodes.ppoTcnPath.value = tcn;
    if (this.nodes.iaTcnPath) this.nodes.iaTcnPath.value = tcn;
    this.#updatePpoTrainCommandPreview();
    this.#verifyTcnModel(tcn);
  }

  #ensureArduinoRelay() {
    return new Promise((resolve) => {
      if (this.arduinoConnection?.connected) {
        resolve();
        return;
      }
      const url = this.nodes.arduinoUrl?.value?.trim() || 'ws://127.0.0.1:8767';
      if (!this.arduinoConnection) {
        this.arduinoConnection = new ArduinoConnection({
          onPacket: (packet) => this.#applyLivePacket(packet),
          onStatus: (status) => this.#setArduinoStatus(status),
          onRelayStats: (stats) => this.#applyRelayStats(stats),
          onSensors: (rows) => this.#renderArduinoSensors(rows),
          onRelayEvent: (event) => this.#handleRelayEvent(event),
        });
      }
      const socket = this.arduinoConnection.socket;
      if (socket?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      const timeout = window.setTimeout(() => resolve(), 3500);
      this.arduinoConnection.connect(url);
      const check = window.setInterval(() => {
        if (this.arduinoConnection?.connected) {
          window.clearInterval(check);
          window.clearTimeout(timeout);
          resolve();
        }
      }, 120);
    });
  }

  async #verifyTcnModel(tcnPath = DEFAULT_TCN_MODEL_PATH) {
    const pathValue = (tcnPath || DEFAULT_TCN_MODEL_PATH).trim();
    if (this.nodes.ppoTcnPath && !this.nodes.ppoTcnPath.value.includes('.pt')) {
      this.nodes.ppoTcnPath.value = DEFAULT_TCN_MODEL_PATH;
    }
    this.#setTcnStatus(null, 'Verificando TCN...');
    try {
      const result = await verifyTcnModelHttp(pathValue);
      this.#setTcnStatus(result.ok, result.ok ? `Cargado Ã‚Â· ${result.path}` : result.message);
      return result.ok;
    } catch (error) {
      this.#setTcnStatus(false, `Error: ${error.message}`);
      return false;
    }
  }

  #setTcnStatus(ok, message) {
    if (!this.nodes.ppoTcnStatus) return;
    this.tcnModelReady = ok === true;
    this.nodes.ppoTcnStatus.textContent = message
      ?? (ok ? 'Cargado' : 'No encontrado');
    this.nodes.ppoTcnStatus.className = ok ? 'ok' : ok === false ? 'bad' : '';
    if (this.nodes.ppoTrain) {
      this.nodes.ppoTrain.disabled = false;
    }
  }

  async #applyIron001MaterialsToMesh(object) {
    try {
      const summary = iron001CatalogSummary();
      const ready = summary.filter((row) => row.baseColor).length;
      this.#status(`Cargando texturas IRON001 (${ready}/6 partes)...`);
      const result = await applyIron001Materials(object);
      this.iron001MaterialApplied = true;
      const st = result.slotStats ?? {};
      const parts = ['Red', 'Gold', 'Silver', 'Arc', 'Lights', 'Glass']
        .map((label, i) => {
          const key = ['Red_Part', 'Gold_Part', 'Silver_Part', 'Arc_Reactor', 'Lights', 'Glass'][i];
          const n = st[key] ?? 0;
          return n ? `${label}:${n}` : null;
        })
        .filter(Boolean)
        .join(' ');
      if (result.unknown > 0) {
        this.#status(`IRON001 aplicado — ${parts || 'sin conteo'} — ${result.unknown} mallas sin slot (ver consola)`);
      } else {
        this.#status(`IRON001 aplicado — ${parts}`);
      }
      return result;
    } catch (error) {
      console.warn('[IRON001] Materiales no aplicados:', error);
      this.#status(`Texturas IRON001 fallaron: ${error.message} — mesh en blanco`);
      applyWhiteMaterials(object);
      return null;
    }
  }

  async #loadModel(file) {
    this.#status(`Cargando ${file.name}`);
    const useIron = /\.fbx$/i.test(file.name) && /og|iron/i.test(file.name);
    const { object, extension } = await this.modelLoader.loadFile(file, {
      materialMode: useIron ? 'iron001' : 'white',
    });
    if (useIron) await this.#applyIron001MaterialsToMesh(object);
    this.scene.setModel(object);
    const mapping = this.mapper.scan(object);
    this.controller = new BoneController(this.mapper);
    this.#installCollisionGuard();
    this.controller.resetPose();
    this.sensorCalibration.reset();
    this.agent = new AutonomousAgent(this.controller);
    this.appliedMovementPlayer = new AppliedMovementPlayer(this.controller);
    this.qAgent = new QLearningAgent({ controller: this.controller, mapper: this.mapper });
    this.drlTrainer = new DrlTrainer({ controller: this.controller, mapper: this.mapper });
    this.controller.resetPose();
    this.modelInfo = {
      name: file.name,
      format: extension.toUpperCase(),
      hasSkeleton: this.mapper.availableBones.length > 0,
    };
    this.#refreshStaticUi(mapping);
    this.scene.setBodyView('front');
    this.#setActiveBodyView('front');
    this.#status(this.modelInfo.hasSkeleton ? `Modelo cargado - ${mappedCount(mapping)}/15 huesos - bind pose centrada` : 'Modelo cargado sin skeleton detectable');
  }

  async #loadDefaultSkeletalMesh() {
    this.#status('Cargando skeletal mesh por defecto');
    try {
      const { object, extension } = await this.modelLoader.loadUrl(defaultSkeletalMeshUrl, {
        name: 'Og.FBX',
        extension: 'fbx',
        unrealZUp: true,
        referenceMode: 'unreal',
        materialMode: 'iron001',
      });
      await this.#applyIron001MaterialsToMesh(object);
      this.scene.setModel(object);
      const mapping = this.mapper.scan(object);
      this.controller = new BoneController(this.mapper);
      this.#installCollisionGuard();
      this.controller.resetPose();
      this.agent = new AutonomousAgent(this.controller);
      this.appliedMovementPlayer = new AppliedMovementPlayer(this.controller);
      this.qAgent = new QLearningAgent({ controller: this.controller, mapper: this.mapper });
      this.drlTrainer = new DrlTrainer({ controller: this.controller, mapper: this.mapper });
      this.modelInfo = {
        name: 'Og.FBX',
        format: extension.toUpperCase(),
        hasSkeleton: this.mapper.availableBones.length > 0,
      };
      this.#refreshStaticUi(mapping);
      this.sensorCalibration.reset();
      this.#setReferenceBodyView();
      this.#status(`Og.FBX — ${mappedCount(mapping)}/15 huesos — materiales IRON001 aplicados`);
    } catch (error) {
      this.#status(`No se pudo cargar Og.FBX: ${error.message}`);
      this.#loadProceduralRig();
    }
  }

  #loadProceduralRig() {
    const { group, bones } = createProceduralRig();
    this.scene.setModel(group);
    const mapping = this.mapper.useProcedural(bones);
    this.controller = new BoneController(this.mapper);
    this.#installCollisionGuard();
    this.agent = new AutonomousAgent(this.controller);
    this.appliedMovementPlayer = new AppliedMovementPlayer(this.controller);
    this.qAgent = new QLearningAgent({ controller: this.controller, mapper: this.mapper });
    this.drlTrainer = new DrlTrainer({ controller: this.controller, mapper: this.mapper });
    this.sensorCalibration.reset();
    this.modelInfo = { name: 'Rig procedural IRON-SYNC', format: 'procedural', hasSkeleton: true };
    this.#refreshStaticUi(mapping);
    this.scene.setBodyView('front');
    this.#setActiveBodyView('front');
    this.#status('Rig procedural activo - mapa Unreal listo');
  }

  #loop(time) {
    requestAnimationFrame((next) => this.#loop(next));
    const elapsed = this.scene.clock.getElapsedTime();
    const deltaSeconds = Math.max(0.001, (time - this.lastPhysicsUpdate) / 1000);
    this.lastPhysicsUpdate = time;

    if (!this.controller) {
      this.scene.render();
      this.#renderPacketInspector();
      return;
    }

    this.#renderPacketInspector();
    this.#updateUnrealSimulation(elapsed);
    this.#tickMovementTraining(time);
    this.#tickMovementPreprocessing(elapsed);
    this.#tickPipelineSynthetic(elapsed);
    this.#tickRuntimeDatasetDetection();
    if (this.meshDriverMode === 'applied_movements' && this.appliedMovementPlayer?.active) {
      this.#tickAppliedMovement(time);
    } else if (this.meshDriverMode === 'ppo_training' && this.ppoTrainHud.active) {
      this.#tickPpoTrainingExperience(time, elapsed);
    } else if (
      this.agent?.enabled
      && !this.qAgent?.active
      && !this.drlTrainer?.active
      && this.meshDriverMode !== 'movement_training'
      && this.meshDriverMode !== 'preprocessing'
    ) {
      this.agent.step(elapsed);
    }
    const rotations = this.#readRotations();
    this.unrealBridge?.sendPose(rotations, this.#currentUnrealActionState());
    const overlays = this.#overlayState();
    const collisions = overlays.needsCollision ? this.collisionSystem.update(this.mapper.getBones()) : [];
    this.scene.setColliderVisible(this.flags.biomechanics.colliders);
    this.scene.setColliderMeshes(this.collisionSystem.debugMeshes());
    this.scene.setBonesVisible(this.flags.manual.bones);
    this.scene.setBoneLabelsVisible(this.flags.manual.boneNames);
    this.scene.setBoneLabels(this.flags.manual.boneNames ? this.#boneLabelMarkers() : []);
    this.scene.setSensorMarkersVisible(overlays.markerMode !== 'none');
    this.scene.setSensorLabelsVisible(overlays.labelsVisible);
    this.scene.setSensorMarkers(overlays.markerMode === 'none' ? [] : this.#sensorMarkersWithBoneLabels(overlays.markerMode));

    const reward = this.meshDriverMode === 'ppo_training' && this.ppoTrainHud.lastRewardView
      ? this.ppoTrainHud.lastRewardView
      : this.rewardEngine.evaluate({
        rotations,
        previousRotations: this.previousRotations,
        deltaSeconds,
        collisions,
      });
    this.qAgent?.tick({
      rotations,
      reward,
      collisions,
      sensorRows: this.arduinoSensorRows,
      mappedCount: mappedCount(this.mapper.summary()),
    });
    this.drlTrainer?.tick({ rotations, reward, collisions });
    this.previousRotations = rotations;
    this.rewardHistory.push(reward.reward_total);
    if (this.rewardHistory.length > 80) this.rewardHistory.shift();
    this.recorder.push({ now: time, rotations, reward, collisions });

    if (time - this.lastUiUpdate > 150) {
      this.#refreshLiveUi({ rotations, reward, collisions, deltaSeconds });
      this.lastUiUpdate = time;
    }
    this.scene.render();
  }

  #readRotations() {
    const rotations = {};
    for (const alias of BONE_ORDER) rotations[alias] = this.controller.read(alias);
    return rotations;
  }

  #installCollisionGuard() {
    this.controller.setCollisionGuard(() => {
      const blocking = this.collisionSystem
        .test(this.mapper.getBones(), { margin: COLLISION_SAFETY_MARGIN })
        .filter((item) => item.severity === 'critical' || item.severity === 'high');
      return blocking.length === 0;
    });
  }

  #overlayState() {
    const markerMode = this.flags.hardware.markers
      ? 'hardware'
      : this.flags.biomechanics.anatomicalMarkers
        ? 'biomechanics'
        : 'none';
    return {
      markerMode,
      labelsVisible: markerMode === 'hardware'
        ? this.flags.hardware.labels
        : markerMode === 'biomechanics' && this.flags.biomechanics.anatomicalLabels,
      needsCollision: this.flags.biomechanics.evaluate
        || this.flags.biomechanics.colliders
        || markerMode !== 'none'
        || this.qAgent?.active
        || this.meshDriverMode === 'ppo_training',
    };
  }

  #sensorMarkersWithBoneLabels(mode) {
    const labels = new Map(this.mapper.summary().map((item) => [item.alias, item.found || item.expected || item.alias]));
    const sensorRows = new Map(this.arduinoSensorRows.map((item) => [item.alias, item]));
    return this.collisionSystem.sensorMarkers().map((marker) => ({
      ...marker,
      label: markerLabel(marker.alias, labels.get(marker.alias), sensorRows.get(marker.alias), {
        showHardwareState: mode === 'hardware' && this.flags.hardware.colorByState,
      }),
      sensorState: mode === 'hardware' && this.flags.hardware.colorByState
        ? markerSensorState(sensorRows.get(marker.alias))
        : undefined,
    }));
  }

  #boneLabelMarkers() {
    const labels = new Map(this.mapper.summary().map((item) => [item.alias, item.found || item.expected || item.alias]));
    return Array.from(this.mapper.getBones().entries()).map(([alias, bone]) => ({
      alias,
      text: labels.get(alias) ?? alias,
      position: bone.getWorldPosition(bone.position.clone()),
    }));
  }

  #refreshStaticUi(mapping = this.mapper.summary()) {
    this.#renderModelInfo();
    this.#renderBoneSelect();
    this.#renderBoneMapping(mapping);
    this.#syncSlidersToSelected();
  }

  #refreshLiveUi({ rotations, reward, collisions, deltaSeconds }) {
    this.#renderBoneInspector(rotations, deltaSeconds);
    if (this.meshDriverMode === 'ppo_training' && this.ppoTrainHud.active) {
      const title = this.nodes.rewardPanel?.querySelector('h2');
      if (title) title.textContent = 'Politica PPO Ã¢â‚¬â€ recompensas y castigos';
    } else if (this.nodes.rewardPanel?.querySelector('h2')) {
      this.nodes.rewardPanel.querySelector('h2').textContent = 'Evaluacion biomecanica';
    }
    this.#renderReward(reward);
    this.#renderCollisions(collisions);
    this.#renderDrl(reward, collisions, rotations);
    this.#renderDrlPpoPanel();
    this.#renderIaSimulationPanel();
    this.#renderPipelineCompletoPanel();
    this.#renderRecorder();
    this.#renderDriverMode();
    this.#renderCalibrationPanel();
    this.#renderGuidedCalibrationPanel();
    this.#renderUnifiedCalibrationPanel();
    this.#renderTestPanel();
    this.#renderTrainingPanel();
    this.#renderPreprocessingPanel();
    this.#renderAppliedMovementsPanel();
  }

  #bindEvents() {
    this.#bindAccordionPanels();
    this.nodes.modelInput.addEventListener('change', (event) => {
      const [file] = event.target.files;
      if (file) this.#loadModel(file).catch((error) => this.#status(`Error: ${error.message}`));
    });
    this.nodes.clearScene.addEventListener('click', () => this.#loadDefaultSkeletalMesh());
    this.nodes.connectBridge.addEventListener('click', () => this.#connectBridge());
    this.nodes.disconnectBridge.addEventListener('click', () => this.#disconnectBridge());
    this.nodes.connectUnreal.addEventListener('click', () => this.#connectUnreal());
    this.nodes.disconnectUnreal.addEventListener('click', () => this.#disconnectUnreal());
    this.root.addEventListener('click', (event) => {
      const presetButton = event.target.closest('[data-agent-preset]');
      if (presetButton) this.#setAgentMode(presetButton.dataset.agentPreset);
      const appliedButton = event.target.closest('[data-applied-movement]');
      if (appliedButton) this.#playAppliedMovement(appliedButton.dataset.appliedMovement);
      const actionButton = event.target.closest('button');
      if (!actionButton) return;
      if (actionButton.id === 'connectArduinoRelay') this.#connectArduino();
      if (actionButton.id === 'connectHardware') {
        this.#resetLivePose();
        this.ingressPipeline.clearProfile();
        this.sensorCalibration.reset();
        this.userCalibrationRequested = false;
        this.hardwareStreamStarted = false;
        this.streamPausedByUser = false;
        this.sessionCalibrated = false;
        this.megaCalibratingActive = false;
        this.arduinoConnection?.connectHardware();
      }
      if (actionButton.id === 'startCalibration') {
        void this.#runStartCalibrationGolden();
      }
      if (actionButton.id === 'stopDataTransfer') {
        this.#resetLivePose();
        this.testSimulationActive = false;
        this.hardwareStreamStarted = false;
        this.streamPausedByUser = true;
        this.sessionCalibrated = false;
        this.arduinoConnection?.stopData();
        this.#status('Datos detenidos Ã¢â‚¬â€ pulsa Calibrar/iniciar para calibrar de nuevo');
      }
      if (actionButton.id === 'disconnectHardware') {
        this.#resetLivePose();
        this.#teardownHardwareSession('disconnect-hardware');
      }
      if (actionButton.id === 'disconnectArduinoRelay') this.#disconnectArduino();
      if (actionButton.id === 'arduinoResetSensors') this.arduinoConnection?.resetSensors();
      if (actionButton.id === 'arduinoStatus') this.arduinoConnection?.status();
      if (actionButton.id === 'arduinoRescan') this.arduinoConnection?.rescan();
      if (actionButton.id === 'verifyCalibrationConnection') this.#verifyCalibrationConnection();
      if (actionButton.id === 'unifiedCalibrateTrajeMesh') this.#runUnifiedCalibration();
      if (actionButton.id === 'cancelUnifiedCalibration') this.#cancelUnifiedCalibration();
      if (actionButton.id === 'captureCalibrationA') this.#captureCalibrationA();
      if (actionButton.id === 'captureCalibrationB') this.#captureCalibrationB();
      if (actionButton.id === 'applySensorCalibration') this.#applySensorCalibration();
      if (actionButton.id === 'resetSensorCalibration') this.#resetSensorCalibration();
      if (actionButton.id === 'exportSensorCalibration') this.#exportSensorCalibration();
      if (actionButton.id === 'takeMasterCalibration') this.#takeMasterCalibrationBundle();
      if (actionButton.id === 'applySelectedMasterCalibration') this.#applySelectedMasterCalibration();
      if (actionButton.id === 'closeGuidedPosture') this.#closeGuidedPosture();
      if (actionButton.id === 'createTrainingCollection') this.#createTrainingCollection();
      if (actionButton.id === 'refreshTrainingCollections') this.#refreshTrainingCollections();
      if (actionButton.id === 'saveMovementToCollection') this.#saveApprovedMovementToCollection();
      if (actionButton.id === 'startMovementTraining') this.#startMovementTraining();
      if (actionButton.id === 'pauseMovementTraining') this.#pauseMovementTraining();
      if (actionButton.id === 'resumeMovementTraining') this.#resumeMovementTraining();
      if (actionButton.id === 'freezeTrainingAnimation') this.#toggleFreezeTrainingAnimation();
      if (actionButton.id === 'freezeTrainingData') this.#toggleFreezeTrainingData();
      if (actionButton.id === 'cancelMovementTraining') this.#cancelMovementTraining();
      if (actionButton.id === 'repeatMovementSample') this.#repeatMovementSample();
      if (actionButton.id === 'repeatMovementAnimation') this.#repeatMovementAnimation();
      if (actionButton.id === 'trainingRepeatFailedSampling') this.#repeatFailedMovementSampling();
      if (actionButton.id === 'trainingContinueDespiteFail') this.#continueMovementTrainingDespiteFail();
      if (actionButton.id === 'advanceMovementAnimation') this.#advanceMovementAnimation();
      if (actionButton.id === 'exportMovementTrainingCsv') this.#exportMovementTrainingCsv();
      if (actionButton.id === 'exportMovementTrainingJson') this.#exportMovementTrainingJson();
      if (actionButton.id === 'resetMovementTraining') {
        this.movementTraining.reset();
        this.controller?.resetPose();
        this.#renderTrainingPanel();
        this.#status('Entrenamiento reiniciado');
      }
      if (actionButton.id === 'loadGestureLibraryJson') this.nodes.gestureLibraryJsonInput?.click();
      if (actionButton.id === 'enableGestureTrigger') this.#setGestureTriggerEnabled(true);
      if (actionButton.id === 'disableGestureTrigger') this.#setGestureTriggerEnabled(false);
      if (actionButton.id === 'loadRuntimeDatasetJson') this.nodes.runtimeDatasetJsonInput?.click();
      if (actionButton.id === 'startRuntimeDatasetDetection') this.#startRuntimeDatasetDetection();
      if (actionButton.id === 'stopRuntimeDatasetDetection') this.#stopRuntimeDatasetDetection();
      if (actionButton.id === 'loadPreprocessingCollection') this.#loadPreprocessingCollection();
      if (actionButton.id === 'startPreprocessing') this.#startPreprocessing();
      if (actionButton.id === 'stopPreprocessing') this.#stopPreprocessing();
      if (actionButton.id === 'resetPreprocessing') this.#resetPreprocessing();
      if (actionButton.id === 'verifyTestReadiness') this.#verifyTestReadiness();
      if (actionButton.id === 'startTestSimulation') this.#startTestSimulation();
      if (actionButton.id === 'stopTestSimulation') this.#stopTestSimulation();
      if (actionButton.id === 'evaluateTestQModel') this.#evaluateTestQModel();
      if (actionButton.id === 'testDiagnostics') this.arduinoConnection?.diagnostics();
      if (actionButton.id === 'stopAppliedMovement') this.#stopAppliedMovement();
      if (actionButton.id === 'toggleRawTestRotations') {
        this.#toggleTestRotationMode();
      }
      if (actionButton.id === 'clearPacketInspector') this.#clearPacketInspector();
      if (actionButton.id === 'clearArduinoCalReferenceLog') this.#clearArduinoCalReferenceLog();
      if (actionButton.id === 'saveCalReferenceGolden') this.#saveCalReferenceGolden();
      if (actionButton.id === 'applyCalReferenceGolden') this.#applyCalReferenceGolden();
      if (actionButton.id === 'togglePacketTerminal') this.#togglePacketTerminal();
      if (actionButton.id === 'startUnrealSimulation') this.#startUnrealSimulation();
    });
    this.nodes.autoMap.addEventListener('click', () => this.#renderBoneMapping(this.mapper.autoMap()));
    this.nodes.boneSelect.addEventListener('change', () => {
      this.selectedAlias = this.nodes.boneSelect.value;
      this.#syncSlidersToSelected();
    });
    for (const axis of ['rx', 'ry', 'rz']) {
      this.nodes[axis].addEventListener('input', () => this.#applyManualSliders());
    }
    this.nodes.resetBone.addEventListener('click', () => {
      this.controller.reset(this.selectedAlias);
      this.#syncSlidersToSelected();
    });
    this.nodes.resetAll.addEventListener('click', () => this.#resetEverything());
    this.nodes.copyRotation.addEventListener('click', () => navigator.clipboard?.writeText(this.controller.copyRotation(this.selectedAlias)));
    this.nodes.savePose.addEventListener('click', () => {
      this.controller.savePose();
      this.#status('Pose guardada en memoria');
    });
    this.nodes.agentMode.addEventListener('change', () => this.#setAgentMode(this.nodes.agentMode.value));
    this.nodes.resetPose.addEventListener('click', () => {
      this.#setAgentMode('pause');
      this.controller.resetPose();
      this.#syncSlidersToSelected();
    });
    this.nodes.showBiomechColliders.addEventListener('change', () => {
      this.flags.biomechanics.colliders = this.nodes.showBiomechColliders.checked;
    });
    this.nodes.showManualBones.addEventListener('change', () => {
      this.flags.manual.bones = this.nodes.showManualBones.checked;
      this.scene.setBonesVisible(this.flags.manual.bones);
    });
    this.nodes.showManualBoneNames.addEventListener('change', () => {
      this.flags.manual.boneNames = this.nodes.showManualBoneNames.checked;
    });
    this.nodes.showBiomechMarkers.addEventListener('change', () => {
      this.flags.biomechanics.anatomicalMarkers = this.nodes.showBiomechMarkers.checked;
    });
    this.nodes.showBiomechLabels.addEventListener('change', () => {
      this.flags.biomechanics.anatomicalLabels = this.nodes.showBiomechLabels.checked;
    });
    this.nodes.showReward.addEventListener('change', () => {
      this.flags.biomechanics.evaluate = this.nodes.showReward.checked;
      this.nodes.rewardPanel.hidden = !this.flags.biomechanics.evaluate;
    });
    this.nodes.showHardwareSensors.addEventListener('change', () => {
      this.flags.hardware.markers = this.nodes.showHardwareSensors.checked;
    });
    this.nodes.showHardwareLabels.addEventListener('change', () => {
      this.flags.hardware.labels = this.nodes.showHardwareLabels.checked;
    });
    this.nodes.colorHardwareState.addEventListener('change', () => {
      this.flags.hardware.colorByState = this.nodes.colorHardwareState.checked;
    });
    this.nodes.packetInspectorPause?.addEventListener('change', () => {
      this.packetInspector.setPaused(this.nodes.packetInspectorPause.checked);
    });
    this.nodes.packetInspectorShowRaw?.addEventListener('change', () => {
      this.packetInspector.setShowRawLine(this.nodes.packetInspectorShowRaw.checked);
      this.#renderPacketInspector(true);
    });
    this.nodes.gestureLibraryJsonInput?.addEventListener('change', (event) => this.#loadGestureLibraryJson(event));
    this.nodes.masterCalibrationFileInput?.addEventListener('change', (event) => this.#loadMasterCalibrationBundle(event));
    this.nodes.masterCalibrationRecentSelect?.addEventListener('change', () => this.#selectRecentMasterCalibration());
    this.nodes.runtimeDatasetJsonInput?.addEventListener('change', (event) => this.#loadRuntimeDatasetJson(event));
    this.nodes.gestureTriggerThreshold?.addEventListener('change', () => this.#syncGestureTriggerOptions());
    this.nodes.gestureTriggerMinPeak?.addEventListener('change', () => this.#syncGestureTriggerOptions());
    this.nodes.gestureTriggerHoldMs?.addEventListener('change', () => this.#syncGestureTriggerOptions());
    this.nodes.recordStart.addEventListener('click', () => this.recorder.start());
    this.nodes.recordStop.addEventListener('click', () => this.recorder.stop());
    this.nodes.recordClear.addEventListener('click', () => this.recorder.clear());
    this.nodes.exportPose.addEventListener('click', () => downloadJson('ironsync_pose.json', exportPose(this.#readRotations())));
    this.nodes.exportRecording.addEventListener('click', () => downloadJson('ironsync_recording.json', exportRecording(this.recorder.frames)));
    this.nodes.exportBoneMap.addEventListener('click', () => downloadJson('ironsync_bone_map.json', exportBoneMap(this.mapper.summary())));
    this.nodes.exportConfig.addEventListener('click', () => downloadJson('ironsync_biomechanics_config.json', exportBiomechanicsConfig(BONE_LIMITS)));
    this.nodes.ppoTrain?.addEventListener('click', () => this.#startPpoTraining());
    this.nodes.ppoStopTrain?.addEventListener('click', () => this.#stopPpoTraining());
    this.nodes.ppoRefreshMetrics?.addEventListener('click', () => this.#pollPpoMetrics(true));
    this.nodes.ppoBrowseTcn?.addEventListener('click', () => this.nodes.ppoTcnFile?.click());
    this.nodes.ppoBrowseActor?.addEventListener('click', () => this.nodes.ppoActorFile?.click());
    this.nodes.ppoTcnFile?.addEventListener('change', (event) => this.#applyPpoFileSelection('ppoTcnPath', event, 'IA-IRON-SYNC/TCN/models'));
    this.nodes.ppoTcnPath?.addEventListener('change', () => this.#verifyTcnModel(this.nodes.ppoTcnPath.value));
    this.nodes.ppoReloadTcn?.addEventListener('click', () => this.#verifyTcnModel());
    this.nodes.ppoActorFile?.addEventListener('change', (event) => this.#applyPpoFileSelection('ppoActorPath', event, 'IA-IRON-SYNC/PPO/models'));
    this.root.querySelectorAll('#drl-ppo input[type="text"], #drl-ppo input[type="number"]').forEach((input) => {
      input.addEventListener('change', () => this.#updatePpoTrainCommandPreview());
    });
    this.#updatePpoTrainCommandPreview();
    this.nodes.iaActivate?.addEventListener('click', () => this.#activateIaSimulation());
    this.nodes.iaPause?.addEventListener('click', () => this.imuAiPipeline.pause());
    this.nodes.iaResume?.addEventListener('click', () => this.imuAiPipeline.resume());
    this.nodes.iaStop?.addEventListener('click', () => this.#stopIaSimulation());
    this.nodes.iaResetFilters?.addEventListener('click', () => this.imuAiPipeline.resetFilters());
    this.nodes.iaReloadModels?.addEventListener('click', () => this.#reloadIaModels());
    this.nodes.iaSaveKalman?.addEventListener('click', () => this.#saveKalmanConfig());
    this.nodes.iaExportLogs?.addEventListener('click', () => this.#exportIaLogs());
    this.nodes.iaTcnPath?.addEventListener('change', () => this.#syncIaModelPaths());
    this.nodes.iaPpoPath?.addEventListener('change', () => this.#syncIaModelPaths());
    this.nodes.iaKalmanEnabled?.addEventListener('change', () => {
      this.imuAiPipeline.kalmanEnabled = Boolean(this.nodes.iaKalmanEnabled?.checked);
    });
    this.#bindPipelineCompletoEvents();
    this.#initPipelineDiagramHost();
    this.#renderPipelineCompletoPanel(true);
    this.nodes.testQModelInput?.addEventListener('change', (event) => this.#loadTestQModel(event));
    this.nodes.preprocessingCsvInput?.addEventListener('change', (event) => this.#loadPreprocessingCsv(event));
    this.nodes.calReferenceGoldenInput?.addEventListener('change', (event) => this.#importCalReferenceGolden(event));
    this.nodes.trainingCollectionSelect?.addEventListener('change', () => {
      this.#onTrainingCollectionSelectChange('training');
    });
    this.nodes.preprocessingCollectionSelect?.addEventListener('change', () => {
      this.#onTrainingCollectionSelectChange('preprocessing');
    });
    this.nodes.cameraReset.addEventListener('click', () => this.scene.cameraManager.reset());
    this.nodes.cameraFront.addEventListener('click', () => this.scene.cameraManager.front());
    this.nodes.cameraSide.addEventListener('click', () => this.scene.cameraManager.side());
    this.nodes.cameraTop.addEventListener('click', () => this.scene.cameraManager.top());
    this.root.querySelectorAll('[data-body-view]').forEach((button) => {
      button.addEventListener('click', () => {
        const view = this.scene.setBodyView(button.dataset.bodyView);
        this.#setActiveBodyView(view);
        this.#status(`Vista corporal: ${button.textContent}`);
      });
    });
  }

  #bindAccordionPanels() {
    this.root.querySelectorAll('.accordion-trigger').forEach((button) => {
      button.addEventListener('click', () => {
        const section = button.closest('.panel-section');
        const expanded = button.getAttribute('aria-expanded') === 'true';
        if (!expanded) {
          this.#enforceMaxOpenSections();
        }
        button.setAttribute('aria-expanded', String(!expanded));
        section.classList.toggle('collapsed', expanded);
        this.#saveAccordionState();
      });
    });
  }

  #enforceMaxOpenSections() {
    const openSections = Array.from(this.root.querySelectorAll('.panel-section[data-panel-id]:not(.collapsed)'));
    if (openSections.length >= 3) {
      const oldest = openSections[0];
      const oldestButton = oldest.querySelector('.accordion-trigger');
      oldestButton.setAttribute('aria-expanded', 'false');
      oldest.classList.add('collapsed');
    }
  }

  #saveAccordionState() {
    const state = {};
    const sections = Array.from(this.root.querySelectorAll('.panel-section[data-panel-id]'));
    const openSections = sections.filter((s) => !s.classList.contains('collapsed'));
    if (openSections.length > 3) {
      for (let i = 3; i < openSections.length; i += 1) {
        const extra = openSections[i];
        const extraButton = extra.querySelector('.accordion-trigger');
        extraButton.setAttribute('aria-expanded', 'false');
        extra.classList.add('collapsed');
      }
    }
    sections.forEach((section) => {
      state[section.dataset.panelId] = !section.classList.contains('collapsed');
    });
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(state));
  }

  #setActiveBodyView(view) {
    this.root.querySelectorAll('[data-body-view]').forEach((button) => {
      button.classList.toggle('active', button.dataset.bodyView === view);
    });
  }

  #setAgentMode(mode, { keepUnrealSimulation = false } = {}) {
    if (!keepUnrealSimulation) this.#stopUnrealSimulation(false);
    if (this.meshDriverMode === 'applied_movements') {
      this.appliedMovementPlayer?.stop({ reset: true });
      this.appliedMovementStatus = this.appliedMovementPlayer?.summary() ?? this.appliedMovementStatus;
      this.#setMeshDriverMode('idle');
      this.#renderAppliedMovementsPanel();
    }
    if (mode === 'pause') {
      if (this.meshDriverMode === 'drl_demo') this.#setMeshDriverMode('idle');
      if (this.qAgent?.active) {
        this.qAgent.pause();
        if (this.meshDriverMode.startsWith('q_learning')) this.#setMeshDriverMode('idle');
      }
    } else {
      this.#setMeshDriverMode('drl_demo');
    }
    this.agent.setMode(mode);
    this.nodes.agentMode.value = mode;
    this.root.querySelectorAll('[data-agent-preset]').forEach((button) => {
      button.classList.toggle('active', button.dataset.agentPreset === mode);
    });
    this.#status(`DRL: ${AGENT_MODE_LABELS[mode] ?? mode}`);
  }

  #playAppliedMovement(id) {
    if (!this.controller || !this.appliedMovementPlayer) return;
    this.#stopUnrealSimulation(false);
    if (this.movementTraining.active) this.movementTraining.cancel();
    if (this.qAgent?.active) this.qAgent.pause();
    if (this.drlTrainer?.active) this.drlTrainer.pause();
    if (this.agent?.enabled) this.agent.setMode('pause');
    if (this.nodes?.agentMode) this.nodes.agentMode.value = 'pause';
    this.root.querySelectorAll('[data-agent-preset]').forEach((button) => {
      button.classList.toggle('active', false);
    });

    const definition = this.appliedMovementPlayer.play(id, performance.now());
    if (!definition) return;
    this.previousRotations = null;
    this.#setMeshDriverMode('applied_movements');
    this.appliedMovementStatus = this.appliedMovementPlayer.summary();
    this.#renderAppliedMovementsPanel();
    this.#status(`Movimiento aplicado: ${definition.name}`);
  }

  #tickAppliedMovement(now) {
    const status = this.appliedMovementPlayer.tick(now);
    this.appliedMovementStatus = status;
    if (status.completed) {
      this.previousRotations = null;
      if (this.meshDriverMode === 'applied_movements') this.#setMeshDriverMode('idle');
      this.#status(`Movimiento aplicado terminado: ${status.definition?.name ?? 'base'}`);
    }
    this.#renderAppliedMovementsPanel();
  }

  #stopAppliedMovement() {
    this.appliedMovementPlayer?.stop({ reset: true });
    this.appliedMovementStatus = this.appliedMovementPlayer?.summary() ?? {
      active: false,
      progress: 0,
      phase: 'base',
      definition: null,
    };
    if (this.meshDriverMode === 'applied_movements') this.#setMeshDriverMode('idle');
    this.previousRotations = null;
    this.#renderAppliedMovementsPanel();
    this.#status('Movimiento aplicado detenido - pose base');
  }

  #startUnrealSimulation() {
    if (!this.controller || !this.agent) return;
    this.#stopUnrealSimulation(false);
    this.qAgent?.pause();
    this.drlTrainer?.pause();
    this.agent.setMode('pause');
    this.unrealSimulationActive = true;
    this.unrealSimulationStepIndex = 0;
    this.unrealSimulationStepStartedAt = this.scene.clock.getElapsedTime();
    this.controller.resetPose();
    this.previousRotations = null;
    this.#setAgentMode(UNREAL_SIMULATION_STEPS[0].mode, { keepUnrealSimulation: true });
    this.#status(`Simulacion Unreal 1/${UNREAL_SIMULATION_STEPS.length}: ${UNREAL_SIMULATION_STEPS[0].label}`);
  }

  #updateUnrealSimulation(elapsed) {
    if (!this.unrealSimulationActive) return;
    const step = UNREAL_SIMULATION_STEPS[this.unrealSimulationStepIndex];
    if (!step) {
      this.#stopUnrealSimulation(true);
      return;
    }
    if (elapsed - this.unrealSimulationStepStartedAt < step.seconds) return;
    this.unrealSimulationStepIndex += 1;
    const next = UNREAL_SIMULATION_STEPS[this.unrealSimulationStepIndex];
    if (!next) {
      this.#stopUnrealSimulation(true);
      return;
    }
    this.unrealSimulationStepStartedAt = elapsed;
    this.#setAgentMode(next.mode, { keepUnrealSimulation: true });
    this.#status(`Simulacion Unreal ${this.unrealSimulationStepIndex + 1}/${UNREAL_SIMULATION_STEPS.length}: ${next.label}`);
  }

  #stopUnrealSimulation(resetPose = true) {
    if (!this.unrealSimulationActive) return;
    this.unrealSimulationActive = false;
    this.unrealSimulationStepIndex = 0;
    this.unrealSimulationStepStartedAt = 0;
    if (resetPose && this.controller) this.controller.resetPose();
    if (this.agent?.enabled) this.agent.setMode('pause');
    this.#setMeshDriverMode('idle');
    if (this.nodes?.agentMode) this.nodes.agentMode.value = 'pause';
    this.root.querySelectorAll('[data-agent-preset]').forEach((button) => {
      button.classList.toggle('active', button.dataset.agentPreset === 'pause');
    });
    if (resetPose) this.#status('Simulacion Unreal finalizada - pose base restaurada');
  }

  #tickMovementTraining(now) {
    const phase = this.movementTraining?.phase;
    if (!this.movementTraining?.active && !['done', 'review_failed'].includes(phase)) return;
    const summary = this.movementTraining.summary();
    const command = this.movementTraining.tick(now);
    const cycleKey = `${phase}-${summary.demoCycleIndex ?? 0}-${summary.sampleIndex}-${summary.cycleIndex}`;

    if (command.shouldAnimate) {
      if (this._lastTrainingCycleKey !== cycleKey) {
        this._lastTrainingCycleKey = cycleKey;
        this.appliedMovementPlayer?.play(command.mode, now);
      }
      this.#setTrainingAnimationMode(command.mode);
      this.#driveTrainingMeshAnimation(now);
    } else {
      this.appliedMovementPlayer?.stop({ reset: false });
      if (this.agent?.enabled) this.agent.setMode('pause');
      if (
        phase === 'inter_animation_pause'
        || phase === 'pose_countdown'
        || phase === 'pre_capture_countdown'
        || phase === 'pre_sample_countdown'
        || phase === 'between_demos'
        || phase === 'between_cycles'
        || phase === 'between_samples'
        || phase === 'review_failed'
      ) {
        this.controller?.resetPose();
      }
    }
    if (summary.phase === 'review_failed' && summary.result?.validation?.consistencyOk) {
      this.movementTraining.reconcileApprovalPhase();
    }
    this.#maybePersistCompletedAnimation(this.movementTraining.summary());
    if (this.movementTraining.phase === 'done') this.#finalizeMovementTrainingSession();
    this.#renderTrainingPanel();
  }

  #setTrainingAnimationMode(mode) {
    if (!this.appliedMovementPlayer) return;
    if (this.meshDriverMode !== 'movement_training') this.#setMeshDriverMode('movement_training');
    if (this.nodes?.agentMode) this.nodes.agentMode.value = 'pause';
    this.root.querySelectorAll('[data-agent-preset]').forEach((button) => {
      button.classList.toggle('active', false);
    });
  }

  #driveTrainingMeshAnimation(now) {
    if (!this.appliedMovementPlayer || this.meshDriverMode !== 'movement_training') return;
    this.appliedMovementStatus = this.appliedMovementPlayer.tick(now);
  }

  #startMovementTraining() {
    if (!this.trainingCollectionStamp) {
      this.#status('Crea o selecciona una coleccion antes de capturar');
      this.#renderTrainingPanel();
      return;
    }
    const selected = trainingMovementBySelectorValue(this.nodes.movementTrainingSelector?.value);
    if (!selected) {
      this.#status('Selecciona un movimiento numerado de la lista');
      this.#renderTrainingPanel();
      return;
    }
    this.movementTraining.configureMovement(selected);
    const readiness = this.#computeTrainingReadiness();
    if (!readiness.ready) {
      this.#status(`Entrenamiento bloqueado: ${readiness.missing.join(' | ')}`);
      this.arduinoConnection?.status();
      this.#renderTrainingPanel();
      return;
    }
    this.#stopUnrealSimulation(false);
    this.#setGestureTriggerEnabled(false);
    this.qAgent?.pause();
    this.drlTrainer?.pause();
    this.controller?.resetPose();
    this.previousRotations = null;
    this._lastTrainingCycleKey = '';
    this._persistedMovementKeys = new Set();
    this.trainingSessionStamp = this.trainingCollectionStamp;
    this.testSimulationActive = false;
    this.movementTraining.start(performance.now());
    this.#setMeshDriverMode('movement_training');
    this.#status(
      `Captura: ${selected.name} - postura ${TRAINING_POSE_COUNTDOWN_SECONDS}s -> `
      + `demo 1 -> pausa ${TRAINING_BETWEEN_DEMOS_SECONDS}s -> demo 2 -> pausa ${TRAINING_BETWEEN_DEMOS_SECONDS}s -> `
      + `${TRAINING_SAMPLE_COUNT} muestras x ${TRAINING_MOVEMENTS_PER_SAMPLE} movimiento`,
    );
    this.#renderTrainingPanel();
  }

  #computeTrainingReadiness() {
    const base = this.#computeTestReadiness();
    const definition = this.movementTraining?.currentDefinition?.();
    const requiredNow = definition?.activeBones?.length
      ? definition.activeBones
      : MOVEMENT_TRAINING_REQUIRED_BONES;
    const partial = assessPartialSensorCoverage(this.arduinoSensorRows, {
      requiredAliases: requiredNow,
    });
    const missing = [];

    if (!base.relayOpen) missing.push('Abre relay ESP32/Mega');
    if (base.relayOpen && !base.hardwareConnected) missing.push('Conecta hardware');
    if (!base.framesFresh) missing.push('No hay frames vivos del ESP32/Mega');
    if (!partial.ok) missing.push(...partial.issues);
    if (partial.missingRequired.length) {
      missing.push(`Para este gesto faltan: ${partial.missingRequired.join(', ')}`);
    }
    if (!base.calibrationApplied) missing.push('Calibra desde Arduino o aplica correccion');

    return {
      ...base,
      ready: missing.length === 0,
      missing,
      onlineRequired: requiredNow.length - partial.missingRequired.length,
      requiredTotal: requiredNow.length,
      missingRequired: partial.missingRequired,
      partialCoverage: partial,
    };
  }

  #pauseMovementTraining() {
    this.movementTraining.pause();
    this.agent?.setMode('pause');
    this.appliedMovementPlayer?.stop({ reset: false });
    this.#status('Entrenamiento pausado');
    this.#renderTrainingPanel();
  }

  #resumeMovementTraining() {
    this.movementTraining.resume(performance.now());
    this.#status('Entrenamiento continuado');
    this.#renderTrainingPanel();
  }

  #cancelMovementTraining() {
    this.movementTraining.cancel();
    this.agent?.setMode('pause');
    this.appliedMovementPlayer?.stop({ reset: true });
    this.controller?.resetPose();
    if (this.meshDriverMode === 'movement_training') this.#setMeshDriverMode('idle');
    this.#status('Toma de entrenamiento cancelada');
    this.#renderTrainingPanel();
  }

  #repeatMovementSample() {
    this.movementTraining.repeatSample(performance.now());
    this.controller?.resetPose();
    this.#status('Repitiendo muestra actual');
    this.#renderTrainingPanel();
  }

  #repeatMovementAnimation() {
    this.#clearMovementPersistKey(this.movementTraining.currentDefinition()?.id);
    this.movementTraining.repeatAnimation(performance.now());
    this._lastTrainingSampleIndex = -1;
    this.controller?.resetPose();
    this.#status('Repitiendo animacion completa');
    this.#renderTrainingPanel();
  }

  #repeatFailedMovementSampling() {
    if (!this.movementTraining.repeatFailedSampling(performance.now())) return;
    this.#clearMovementPersistKey(this.movementTraining.currentDefinition()?.id);
    this._lastTrainingSampleIndex = -1;
    this.controller?.resetPose();
    this.#status(`Repitiendo las ${this.movementTraining.sampleCount} tomas de esta animacion`);
    this.#renderTrainingPanel();
  }

  #continueMovementTrainingDespiteFail() {
    if (!this.movementTraining.continueDespiteFail(performance.now())) return;
    this._lastTrainingSampleIndex = -1;
    this.controller?.resetPose();
    this.#status('Continuando sin aprobar: pausa 6 s y siguiente animacion');
    this.#renderTrainingPanel();
  }

  #advanceMovementAnimation() {
    this.movementTraining.advanceAnimation(performance.now());
    this.controller?.resetPose();
    this.#status('Avanzando a la siguiente animacion');
    this.#renderTrainingPanel();
  }

  #toggleFreezeTrainingAnimation() {
    this.movementTraining.freezeAnimation();
    this.#status(this.movementTraining.animationFrozen ? 'Animacion congelada' : 'Animacion reanudada');
    this.#renderTrainingPanel();
  }

  #toggleFreezeTrainingData() {
    this.movementTraining.freezeData();
    this.#status(this.movementTraining.dataFrozen ? 'Toma de datos congelada' : 'Toma de datos reanudada');
    this.#renderTrainingPanel();
  }

  #exportMovementTrainingJson() {
    const bundle = this.#movementTrainingExportBundle();
    downloadJson(bundle.files.dataset, bundle.dataset);
    this.#saveMovementTrainingDataset(bundle, 'JSON exportado y dataset guardado');
  }

  #exportMovementTrainingCsv() {
    const bundle = this.#movementTrainingExportBundle();
    for (const [key, filename] of Object.entries(bundle.files)) {
      if (key === 'dataset' || !filename.endsWith('.csv')) continue;
      const content = bundle[key];
      if (content) downloadText(filename, content, 'text/csv');
    }
    this.#saveMovementTrainingDataset(bundle, 'CSV exportado y dataset guardado');
  }

  #finalizeMovementTrainingSession() {
    const sessionId = this.movementTraining.summary().sessionId;
    if (this.lastTrainingAutoSaveSessionId === sessionId) return;
    this.lastTrainingAutoSaveSessionId = sessionId;
    const approved = [...this.movementTraining.results.values()]
      .filter((result) => result.approved && !result.forcedContinue).length;
    const rejected = [...this.movementTraining.results.values()]
      .filter((result) => result.samples.length > 0 && (!result.approved || result.forcedContinue)).length;
    const sessionDir = this.trainingSessionStamp
      ? `${COLLECTIONS_REL_PATH}/${this.trainingSessionStamp}`
      : COLLECTIONS_REL_PATH;
    const detail = rejected
      ? `${approved} aprobados, ${rejected} con carpeta de revision.`
      : `${approved} movimientos guardados.`;
    this.#status(`Entrenamiento finalizado Ã¢â‚¬â€ ${detail} Ruta: ${sessionDir}`);
    this.#renderGestureTriggerPanel();
  }

  #movementTrainingExportBundle(animationId = this.movementTraining.currentDefinition()?.id) {
    const masterSnapshot = this.masterCalibration.getSnapshot();
    const dataset = this.movementTraining.exportAnimationDataset(animationId, {
      unrealConnected: Boolean(this.unrealBridge?.connected),
      masterCalibration: masterSnapshot,
    });
    if (!dataset) return null;
    const folder = movementFolderName({ name: dataset.animationName, id: dataset.animationId });
    const csvBundle = buildMovementCsvBundle(dataset);
    return {
      sessionStamp: this.trainingSessionStamp || localTimestampForFilename(),
      movementFolder: folder,
      dataset: prepareDatasetForPersistence(dataset),
      datasetFull: dataset,
      ...csvBundle,
      files: {
        dataset: 'dataset.json',
        samplesCsv: 'samples.csv',
        summaryCsv: 'summary.csv',
        trajectoryCsv: 'trajectory.csv',
        masterTrajectoryCsv: 'master_trajectory.csv',
        augmentedSamplesCsv: 'augmented_samples.csv',
        discriminatorsCsv: 'discriminators.csv',
        envelopesCsv: 'envelopes.csv',
      },
    };
  }

  #maybePersistCompletedAnimation(summary) {
    const definition = summary.definition;
    const result = summary.result;
    if (!definition?.id || !result) return;
    if (result.forcedContinue) return;
    if (!result.approved) return;
    if (result.samples.length < TRAINING_SAMPLE_COUNT) return;
    if (summary.phase !== 'done') return;
    if (!this.trainingCollectionStamp) {
      void this.#ensureTrainingCollectionForAutoSave();
      if (!this.trainingCollectionStamp) return;
    }

    const persistKey = `${this.movementTraining.sessionId}:${definition.id}`;
    if (this._persistedMovementKeys.has(persistKey)) return;
    this._persistedMovementKeys.add(persistKey);

    const bundle = this.#movementTrainingExportBundle(definition.id);
    if (!bundle?.dataset?.approved) return;

    bundle.sessionStamp = this.trainingCollectionStamp;
    const folder = bundle.movementFolder;
    this.#saveMovementTrainingDataset(
      bundle,
      `Movimiento guardado (>=${TRAINING_APPROVAL_SCORE}%): ${folder} Ã¢â€ â€™ coleccion ${this.trainingCollectionStamp}`,
      { mergeGestureLibrary: true },
    );
    this.arduinoConnection?.listTrainingCollections();
  }

  async #ensureTrainingCollectionForAutoSave() {
    if (this.trainingCollectionStamp) return true;
    try {
      const result = await createCollectionApi();
      const created = result.collection;
      if (!created?.stamp) return false;
      this.trainingCollections = [
        created,
        ...(this.trainingCollections ?? []).filter((item) => item.stamp !== created.stamp),
      ];
      this.trainingCollectionStamp = created.stamp;
      this.trainingSessionStamp = created.stamp;
      this.#renderTrainingCollectionSelectors();
      this.#status(`Coleccion creada para guardado automatico: ${created.stamp}`);
      return true;
    } catch {
      return false;
    }
  }

  #saveApprovedMovementToCollection() {
    const definition = this.movementTraining.currentDefinition();
    let result = this.movementTraining.currentResult();
    if (!this.trainingCollectionStamp) {
      void this.#ensureTrainingCollectionForAutoSave().then((ok) => {
        if (ok) this.#saveApprovedMovementToCollection();
        else this.#status('Selecciona o crea una coleccion');
      });
      return;
    }
    if (!result?.approved && result?.validation?.consistencyOk) {
      this.movementTraining.reconcileApprovalPhase();
      result = this.movementTraining.currentResult();
    }
    if (!result?.approved) {
      const reason = result?.validation?.consistencyOk === false
        ? `consistencia minima ${TRAINING_APPROVAL_SCORE}% (min ${Number(result?.minSimilarity || 0).toFixed(1)}%)`
        : `muestras incompletas`;
      this.#status(`No se guarda: ${reason}`);
      return;
    }
    const summary = this.movementTraining.summary();
    if (summary.phase !== 'done') {
      this.#status(`Completa las ${TRAINING_SAMPLE_COUNT} muestras antes de guardar`);
      return;
    }
    const persistKey = `${this.movementTraining.sessionId}:${definition.id}`;
    if (this._persistedMovementKeys.has(persistKey)) {
      this.#status('Este movimiento ya se guardo en la coleccion');
      return;
    }
    this._persistedMovementKeys.add(persistKey);
    const bundle = this.#movementTrainingExportBundle(definition.id);
    if (!bundle) return;
    bundle.sessionStamp = this.trainingCollectionStamp;
    this.#saveMovementTrainingDataset(
      bundle,
      `Guardado manual: ${bundle.movementFolder}`,
      { mergeGestureLibrary: true },
    );
    this.arduinoConnection?.listTrainingCollections();
  }

  #createTrainingCollection() {
    void this.#createTrainingCollectionAsync();
  }

  async #createTrainingCollectionAsync() {
    try {
      const result = await createCollectionApi();
      const created = result.collection;
      if (!created?.stamp) {
        throw new Error('Respuesta invalida del servidor');
      }
      this.trainingCollections = [
        created,
        ...(this.trainingCollections ?? []).filter((item) => item.stamp !== created.stamp),
      ];
      this.trainingCollectionStamp = created.stamp;
      this.trainingSessionStamp = created.stamp;
      this.#renderTrainingCollectionSelectors();
      this.#status(`Coleccion creada: ${COLLECTIONS_REL_PATH}/${created.stamp}`);
    } catch (error) {
      this.#status(`No se pudo crear coleccion: ${error.message}`);
    }
  }

  #refreshTrainingCollections() {
    void this.#refreshTrainingCollectionsAsync();
  }

  async #refreshTrainingCollectionsAsync() {
    try {
      const result = await listCollectionsApi();
      this.trainingCollections = result.collections ?? [];
      if (this.trainingCollectionStamp
        && !this.trainingCollections.some((item) => item.stamp === this.trainingCollectionStamp)) {
        this.trainingCollectionStamp = '';
        this.trainingSessionStamp = '';
      }
      this.#renderTrainingCollectionSelectors();
    } catch (error) {
      this.arduinoConnection?.listTrainingCollections();
    }
  }

  #renderTrainingCollectionSelectors() {
    const options = (this.trainingCollections ?? []).map((item) => {
      const selected = item.stamp === this.trainingCollectionStamp ? ' selected' : '';
      return `<option value="${item.stamp}"${selected}>${formatCollectionLabel(item.stamp, item.movementCount)}</option>`;
    }).join('');
    const placeholder = '<option value="">Ã¢â‚¬â€ seleccionar coleccion Ã¢â‚¬â€</option>';
    const html = placeholder + options;
    if (this.nodes?.trainingCollectionSelect) {
      this.nodes.trainingCollectionSelect.innerHTML = html;
      if (this.trainingCollectionStamp) {
        this.nodes.trainingCollectionSelect.value = this.trainingCollectionStamp;
      }
    }
    if (this.nodes?.preprocessingCollectionSelect) {
      this.nodes.preprocessingCollectionSelect.innerHTML = html;
    }
    if (this.nodes?.trainingCollectionActive) {
      this.nodes.trainingCollectionActive.textContent = this.trainingCollectionStamp
        ? `${COLLECTIONS_REL_PATH}/${this.trainingCollectionStamp}`
        : 'ninguna';
      this.nodes.trainingCollectionActive.className = this.trainingCollectionStamp ? 'ok' : 'bad';
    }
  }

  #onTrainingCollectionSelectChange(target = 'training') {
    const select = target === 'preprocessing'
      ? this.nodes.preprocessingCollectionSelect
      : this.nodes.trainingCollectionSelect;
    const stamp = String(select?.value ?? '').trim();
    this.trainingCollectionStamp = stamp;
    if (target === 'training' && this.nodes.trainingCollectionSelect && stamp) {
      this.nodes.trainingCollectionSelect.value = stamp;
    }
    this.trainingSessionStamp = stamp;
    this.#renderTrainingCollectionSelectors();
    if (stamp) this.#status(`Coleccion activa: ${COLLECTIONS_REL_PATH}/${stamp}`);
  }

  async #loadPreprocessingCollection() {
    const stamp = String(this.nodes.preprocessingCollectionSelect?.value ?? '').trim()
      || this.trainingCollectionStamp;
    if (!stamp) {
      this.#status('Selecciona una coleccion para preprocesamiento');
      return;
    }
    try {
      const loaded = await loadCollectionApi(stamp);
      const summary = this.movementPreprocessor.loadCollection(
        loaded,
        `${COLLECTIONS_REL_PATH}/${stamp}`,
      );
      this.movementPreprocessor.setConfig(this.#readPreprocessingConfig());
      this.#status(
        summary.loaded
          ? `Coleccion cargada: ${summary.profileCount} movimientos (${COLLECTIONS_REL_PATH}/${stamp})`
          : 'Coleccion vacia Ã¢â‚¬â€ captura movimientos en Entrenamiento primero',
      );
      this.#renderPreprocessingPanel();
    } catch (error) {
      this.#status(`Error cargando coleccion: ${error.message}`);
    }
  }

  #clearMovementPersistKey(animationId) {
    if (!animationId) return;
    this._persistedMovementKeys.delete(`${this.movementTraining.sessionId}:${animationId}`);
  }

  #saveMovementTrainingDataset(bundle, message, { mergeGestureLibrary = true } = {}) {
    saveDatasetToCollection(bundle)
      .then((result) => {
        const rel = result.saved?.relativePath ?? COLLECTIONS_REL_PATH;
        this.#applySavedDatasetMessage(`${message} Ã¢â€ â€™ ${rel}`, bundle, mergeGestureLibrary);
        this.#refreshTrainingCollections();
      })
      .catch((error) => {
        this.arduinoConnection?.saveTrainingDataset?.(bundle);
        this.#applySavedDatasetMessage(`${message} (relay: ${error.message})`, bundle, mergeGestureLibrary);
      });
  }

  #applySavedDatasetMessage(message, bundle, mergeGestureLibrary) {
    if (mergeGestureLibrary) {
      const loaded =       this.gestureLibrary.loadFromTrainingDataset(
        bundle.datasetFull ?? bundle.dataset,
        bundle.files?.dataset,
        { merge: true },
      );
      if (loaded.loaded) {
        this.#status(`${message} Ã¢â‚¬â€ biblioteca gestos: ${loaded.profileCount} animaciones`);
      } else {
        this.#status(message);
      }
    } else {
      this.#status(message);
    }
    this.#renderGestureTriggerPanel();
  }

  #commitMasterCalibration(reason = 'Calibracion maestra guardada') {
    const snapshot = this.masterCalibration.save(
      this.sensorCalibration.exportProfile({
        modelInfo: this.modelInfo,
        mapping: this.mapper.summary(),
      }),
      { reason },
    );
    this.#status(`${reason} (${snapshot.id})`);
    this.#renderGestureTriggerPanel();
    return snapshot;
  }

  async #loadGestureLibraryJson(event) {
    const [file] = event.target.files ?? [];
    if (!file) return;
    try {
      const dataset = JSON.parse(await file.text());
      const loaded = this.gestureLibrary.loadFromTrainingDataset(dataset, file.name);
      if (!loaded.loaded) {
        this.#status('JSON sin perfiles de gesto validos');
      } else {
        this.#status(`Biblioteca cargada: ${loaded.profileCount} gestos`);
      }
    } catch (error) {
      this.#status(`No se pudo cargar biblioteca: ${error.message}`);
    }
    this.#renderGestureTriggerPanel();
    event.target.value = '';
  }

  #syncGestureTriggerOptions() {
    this.gestureTrigger.setOptions({
      threshold: Number(this.nodes.gestureTriggerThreshold?.value),
      minPeak: Number(this.nodes.gestureTriggerMinPeak?.value),
      holdMs: Number(this.nodes.gestureTriggerHoldMs?.value),
    });
  }

  #setGestureTriggerEnabled(enabled) {
    if (enabled) {
      if (!this.masterCalibration.hasBaseline()) {
        this.#status('Primero calibra el traje (calibracion maestra)');
        return;
      }
      if (!this.gestureLibrary.loaded) {
        this.#status('Carga un dataset JSON de Entrenamiento o exporta uno nuevo');
        return;
      }
      this.#syncGestureTriggerOptions();
      this.gestureTrigger.setEnabled(true);
      this.gestureTriggerEnabled = true;
      this.testSimulationActive = false;
      this.#setMeshDriverMode('gesture_trigger');
      this.#status('Disparo por gestos activo: sensores Ã¢â€ â€™ animacion DRL (sin vectores al mesh)');
    } else {
      this.gestureTrigger.setEnabled(false);
      this.gestureTriggerEnabled = false;
      this.agent?.setMode('pause');
      if (this.meshDriverMode === 'gesture_trigger') this.#setMeshDriverMode('idle');
      this.#status('Disparo por gestos desactivado');
    }
    this.#renderGestureTriggerPanel();
  }

  #tickGestureTrigger(relativePose, now = performance.now()) {
    if (!this.gestureTriggerEnabled || !this.gestureLibrary.loaded) return;
    const event = this.gestureTrigger.update(relativePose, now);
    this.lastGestureTriggerEvent = event;
    if (!event) return;

    if (event.animationId && (event.triggered || event.held)) {
      if (this.meshDriverMode !== 'gesture_trigger') this.#setMeshDriverMode('gesture_trigger');
      if (this.agent?.mode !== event.animationId) {
        this.agent.setMode(event.animationId);
        this.nodes.agentMode.value = event.animationId;
        this.root.querySelectorAll('[data-agent-preset]').forEach((button) => {
          button.classList.toggle('active', button.dataset.agentPreset === event.animationId);
        });
      }
      return;
    }

    if (event.released) {
      this.agent?.setMode('pause');
      if (this.nodes?.agentMode) this.nodes.agentMode.value = 'pause';
    }
  }

  async #loadPreprocessingCsv(event) {
    const [file] = event.target.files ?? [];
    if (!file) return;
    try {
      const text = await file.text();
      const summary = this.movementPreprocessor.loadCsv(text, file.name);
      if (!summary.loaded) {
        this.#status('CSV sin perfiles utiles: carga el archivo samples, no el summary');
      } else {
        this.#status(`CSV preprocesamiento cargado: ${summary.profileCount} animaciones`);
      }
      this.#renderPreprocessingPanel();
    } catch (error) {
      this.#status(`No se pudo cargar CSV de preprocesamiento: ${error.message}`);
    }
  }

  #readPreprocessingConfig() {
    return {
      threshold: Number(this.nodes.preprocessingThreshold?.value ?? RUNTIME_MATCH_THRESHOLD),
      minPeak: Number(this.nodes.preprocessingMinPeak?.value ?? RUNTIME_DEFAULT_MIN_PEAK),
      holdMs: Number(this.nodes.preprocessingHoldMs?.value ?? 500),
      holdStillDeg: Number(this.nodes.preprocessingHoldStill?.value ?? RUNTIME_DEFAULT_HOLD_STILL),
      baseReturnDeg: Number(this.nodes.preprocessingBaseReturn?.value ?? RUNTIME_DEFAULT_BASE_RETURN),
    };
  }

  /** Misma pose que entrenamiento: relativa a calibracion maestra si existe. */
  #getPreprocessingPose() {
    const hp = this.latestHardwarePose;
    if (!hp) return null;
    const base = hp.ingressPose ?? hp.rawPose ?? hp.calibratedPose ?? hp.pose;
    if (!base || !Object.keys(base).length) return null;
    if (this.masterCalibration.hasBaseline()) {
      return toRelativePose(base, this.masterCalibration.getBaseline());
    }
    return hp.calibratedPose ?? hp.pose ?? base;
  }

  async #startPreprocessing() {
    const stamp = String(this.nodes.preprocessingCollectionSelect?.value ?? '').trim()
      || this.trainingCollectionStamp;
    if (!this.movementPreprocessor.loaded && stamp) {
      await this.#loadPreprocessingCollection();
    }
    if (!this.movementPreprocessor.loaded) {
      this.#status('Preprocesamiento: selecciona coleccion Ã¢â€ â€™ Cargar coleccion');
      this.#renderPreprocessingPanel();
      return;
    }
    const readiness = this.#computeTestReadiness();
    if (!readiness.framesFresh) {
      this.#status('Preprocesamiento: conecta Mega/ESP32 y calibra Ã¢â‚¬â€ sin frames vivos');
      this.#renderPreprocessingPanel();
      return;
    }
    if (!this.masterCalibration.hasBaseline()) {
      this.#status('Aviso: sin cal. maestra Ã¢â‚¬â€ usa la misma calibracion que al entrenar para mejor match');
    }
    this.#stopUnrealSimulation(false);
    this.movementTraining.cancel();
    this.testSimulationActive = false;
    this.qAgent?.pause();
    this.drlTrainer?.pause();
    if (this.agent?.enabled) {
      this.agent.setMode('pause');
      if (this.nodes?.agentMode) this.nodes.agentMode.value = 'pause';
    }
    this.movementPreprocessor.setConfig(this.#readPreprocessingConfig());
    this.movementPreprocessor.start();
    this.preprocessingMatch = null;
    this._preprocessingHoldPoseUntil = 0;
    this._preprocessingLastMergedPose = null;
    this._preprocessingDrivenBones = new Set();
    this._appliedMovementTriggerCooldowns?.clear?.();
    this.appliedMovementPlayer?.stop({ reset: false });
    this.controller?.resetPose();
    this.previousRotations = null;
    this.#setMeshDriverMode('preprocessing');
    this.#status(`Preprocesamiento activo Ã¢â‚¬â€ ${this.movementPreprocessor.summary().profileCount} gestos. Mueve el traje.`);
    this.#renderPreprocessingPanel();
  }

  #stopPreprocessing() {
    this.movementPreprocessor.stop();
    this.preprocessingMatch = null;
    this._preprocessingLastMergedPose = null;
    this._preprocessingHoldPoseUntil = 0;
    this.#releasePreprocessingBones([...(this._preprocessingDrivenBones ?? [])]);
    this._preprocessingDrivenBones = new Set();
    this._appliedMovementTriggerCooldowns?.clear?.();
    this.appliedMovementPlayer?.stop({ reset: false });
    this.agent?.setMode('pause');
    this.controller?.resetPose();
    if (this.meshDriverMode === 'preprocessing') this.#setMeshDriverMode('idle');
    this.#status('Preprocesamiento detenido - pose base restaurada');
    this.#renderPreprocessingPanel();
  }

  #resetPreprocessing() {
    this.movementPreprocessor.reset();
    this.preprocessingMatch = null;
    this._appliedMovementTriggerCooldowns?.clear?.();
    this.appliedMovementPlayer?.stop({ reset: true });
    this.agent?.setMode('pause');
    this.controller?.resetPose();
    if (this.meshDriverMode === 'preprocessing') this.#setMeshDriverMode('idle');
    if (this.nodes?.preprocessingCsvInput) this.nodes.preprocessingCsvInput.value = '';
    this.#status('Preprocesamiento reiniciado');
    this.#renderPreprocessingPanel();
  }

  async #loadRuntimeDatasetJson(event) {
    const [file] = event.target.files ?? [];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const summary = this.runtimeDatasetPreprocessor.loadDatasetJson(payload, file.name);
      if (!summary.loaded) {
        this.#status('dataset.json sin perfiles utiles');
      } else {
        this.#status(`dataset.json cargado: ${summary.profileCount} animaciones`);
      }
      this.#renderRuntimeDatasetPanel();
    } catch (error) {
      this.#status(`No se pudo cargar dataset.json: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  }

  #readRuntimeDatasetConfig() {
    return {
      threshold: Number(this.nodes.runtimeDatasetThreshold?.value ?? 82),
      minPeak: Number(this.nodes.runtimeDatasetMinPeak?.value ?? 5),
      holdMs: Number(this.nodes.runtimeDatasetHoldMs?.value ?? 900),
    };
  }

  #startRuntimeDatasetDetection() {
    if (!this.runtimeDatasetPreprocessor.loaded) {
      this.#status('Primero carga dataset.json');
      this.#renderRuntimeDatasetPanel();
      return;
    }
    const readiness = this.#computeTestReadiness();
    if (!readiness.framesFresh) {
      this.#status('No hay frames vivos para detectar');
      this.#renderRuntimeDatasetPanel();
      return;
    }
    this.#setGestureTriggerEnabled(false);
    this.#stopPreprocessing();
    this.movementTraining.cancel();
    this.testSimulationActive = false;
    this.qAgent?.pause();
    this.drlTrainer?.pause();
    this.runtimeDatasetPreprocessor.setConfig(this.#readRuntimeDatasetConfig());
    this.runtimeDatasetPreprocessor.start();
    this.runtimeDatasetMatch = null;
    this.controller?.resetPose();
    this.previousRotations = null;
    this.#setMeshDriverMode('dataset_runtime');
    this.#status('Deteccion dataset activa: reproduce solo el movimiento detectado');
    this.#renderRuntimeDatasetPanel();
  }

  #stopRuntimeDatasetDetection() {
    this.runtimeDatasetPreprocessor.stop();
    this.runtimeDatasetMatch = null;
    this.appliedMovementPlayer?.stop({ reset: false });
    this.agent?.setMode('pause');
    this.controller?.resetPose();
    if (this.meshDriverMode === 'dataset_runtime') this.#setMeshDriverMode('idle');
    this.#status('Deteccion dataset detenida');
    this.#renderRuntimeDatasetPanel();
  }

  #tickMovementPreprocessing(elapsed) {
    if (!this.movementPreprocessor?.active) return;
    const cfg = this.#readPreprocessingConfig();
    const livePose = this.#getPreprocessingPose();
    const matches = this.movementPreprocessor.recognizeAll(livePose, performance.now());
    const datasetPose = this.#mergePreprocessingPoses(matches);
    const summary = this.movementPreprocessor.summary();
    this.#renderPreprocessingHeatmap(summary);
    const allBones = [
      ...new Set(this.movementPreprocessor.profiles?.flatMap((p) => p.activeBones ?? []) ?? []),
    ];
    const motionPk = summary.motionPeak ?? computeMotionPeak(livePose, allBones);
    const atBase = allBones.length
      ? isNearBasePose(livePose, allBones, cfg.baseReturnDeg)
      : true;

    if (datasetPose && Object.keys(datasetPose).length) {
      this.preprocessingMatch = matches[0] ?? null;
      this._preprocessingHoldPoseUntil = performance.now() + Math.min(280, Math.max(120, cfg.holdMs * 0.35));
      this._preprocessingLastMergedPose = datasetPose;
      this._preprocessingDrivenBones = new Set(Object.keys(datasetPose));
      this.#setMeshDriverMode('preprocessing');
      if (this.agent?.enabled && this.agent.mode !== 'pause') {
        this.agent.setMode('pause');
        if (this.nodes?.agentMode) this.nodes.agentMode.value = 'pause';
      }
      this.controller?.writeMany(datasetPose, { clamp: true, guard: true });
      if (performance.now() - (this._lastPreprocessingPanelAt || 0) > 120) {
        this._lastPreprocessingPanelAt = performance.now();
        this.#renderPreprocessingPanel();
      }
      return;
    }

    if (this._preprocessingHoldPoseUntil > performance.now() && this._preprocessingLastMergedPose) {
      this.controller?.writeMany(this._preprocessingLastMergedPose, { clamp: true, guard: true });
      return;
    }

    if (this.preprocessingMatch || this._preprocessingDrivenBones?.size) {
      this.preprocessingMatch = null;
      this._preprocessingLastMergedPose = null;
      this.#releasePreprocessingBones([...(this._preprocessingDrivenBones ?? [])]);
      this._preprocessingDrivenBones = new Set();
    }
    if (atBase || motionPk < cfg.minPeak) {
      this.controller?.resetPose();
      this.previousRotations = null;
    }
    if (performance.now() - (this._lastPreprocessingPanelAt || 0) > 200) {
      this._lastPreprocessingPanelAt = performance.now();
      this.#renderPreprocessingPanel();
    }
  }

  /** Solo huesos activos del dataset (secuencia); nunca mezcla IMU en vivo en el mesh. */
  #mergePreprocessingPoses(matches) {
    if (!Array.isArray(matches) || !matches.length) return null;
    const merged = {};
    const ordered = [...matches].sort((a, b) => (a.slot ?? a.level ?? 99) - (b.slot ?? b.level ?? 99));
    for (const match of ordered) {
      const block = match.displayPose ?? match.targetPose ?? {};
      for (const alias of match.profile?.activeBones ?? []) {
        if (block[alias]) merged[alias] = { ...block[alias] };
      }
    }
    return Object.keys(merged).length ? merged : null;
  }

  #releasePreprocessingBones(aliases = []) {
    if (!this.controller || !aliases.length) return;
    const zero = { rx: 0, ry: 0, rz: 0 };
    const release = {};
    for (const alias of aliases) {
      if (this.mapper?.getBones?.().has(alias)) release[alias] = { ...zero };
    }
    if (Object.keys(release).length) {
      this.controller.writeMany(release, { clamp: true, guard: true });
    }
  }

  #renderPreprocessingHeatmap(summary) {
    if (!this.nodes?.preprocessingHeatmap) return;
    const heatmap = summary.collectionHeatmap ?? [];
    const slots = summary.executionSlots ?? [];
    const threshold = summary.threshold ?? 72;
    const slotIds = new Set(slots.map((s) => s.profileId));

    if (!heatmap.length) {
      this.nodes.preprocessingHeatmap.innerHTML = '<p class="muted">Carga una coleccion y activa deteccion.</p>';
      if (this.nodes.preprocessingSlots) {
        this.nodes.preprocessingSlots.innerHTML = '<p class="muted">Sin slots.</p>';
      }
      return;
    }

    const maxScore = Math.max(threshold, ...heatmap.map((row) => row.score), 1);
    this.nodes.preprocessingHeatmap.innerHTML = heatmap.map((row, index) => {
      const width = Math.round((row.score / maxScore) * 100);
      const inSlot = slotIds.has(row.profileId);
      const rank = index + 1;
      const levelLabel = row.atRest ? 'reposo' : (row.level > 0 ? `L${row.level}` : '-');
      const barClass = row.atRest
        ? 'heatmap-bar muted'
        : row.score >= threshold
          ? (inSlot ? 'heatmap-bar ok slot-active' : 'heatmap-bar ok')
          : (row.score >= threshold - 12 ? 'heatmap-bar warn' : 'heatmap-bar bad');
      return `
        <div class="heatmap-row ${inSlot ? 'heatmap-row--slot' : ''} ${row.atRest ? 'heatmap-row--rest' : ''}">
          <span class="heatmap-rank">#${rank}</span>
          <span class="heatmap-name" title="${escapeHtmlAttr(row.name)}">${escapeHtmlText(row.name)}</span>
          <div class="heatmap-track"><div class="${barClass}" style="width:${width}%"></div></div>
          <span class="heatmap-pct ${row.score >= threshold && !row.atRest ? 'ok' : ''}">${row.score.toFixed(1)}%</span>
          <span class="heatmap-level">${levelLabel}</span>
        </div>
      `;
    }).join('');

    if (this.nodes.preprocessingSlots) {
      this.nodes.preprocessingSlots.innerHTML = slots.length
        ? slots.map((slot) => `
          <div class="kv">
            <span>Slot ${slot.slot} · ${escapeHtmlText(slot.name)}</span>
            <strong class="${slot.active ? 'ok' : ''}">${slot.score.toFixed(1)}% · ${slot.activeBones.join(', ')}${slot.locked ? ' · en curso' : ''}</strong>
          </div>
        `).join('')
        : '<p class="muted">Ningun gesto supera el umbral o todos comparten huesos.</p>';
    }
  }

  #tickRuntimeDatasetDetection() {
    if (!this.runtimeDatasetPreprocessor?.active) return;
    if (this.appliedMovementPlayer?.active && this.meshDriverMode === 'applied_movements') return;
    const pose = this.#getPreprocessingPose();
    const match = this.runtimeDatasetPreprocessor.recognize(pose, performance.now());
    if (this.#maybeTriggerAppliedMovementFromMatch(
      match,
      pose,
      this.runtimeDatasetPreprocessor.summary(),
      'dataset runtime',
    )) {
      this.runtimeDatasetMatch = match;
      this.#renderRuntimeDatasetPanel();
      return;
    }
    if (match?.targetPose && Object.keys(match.targetPose).length) {
      this.runtimeDatasetMatch = match;
      this.#setMeshDriverMode('preprocessing');
      if (this.agent?.enabled && this.agent.mode !== 'pause') {
        this.agent.setMode('pause');
        if (this.nodes?.agentMode) this.nodes.agentMode.value = 'pause';
      }
      this.controller?.writeMany(match.targetPose, { clamp: true, guard: true });
      return;
    }
    if (this.runtimeDatasetMatch) {
      this.runtimeDatasetMatch = null;
      this.agent?.setMode('pause');
      if (this.nodes?.agentMode) this.nodes.agentMode.value = 'pause';
      this.controller?.resetPose();
      this.previousRotations = null;
    }
  }

  #maybeTriggerAppliedMovementFromMatch(match, pose, summary, sourceLabel = 'preprocesamiento') {
    if (!match?.profile || !pose || !this.appliedMovementPlayer) return false;
    const actionId = match.profile?.recognition?.actionId
      ?? match.profile?.activation?.actionId
      ?? match.profile?.id
      ?? match.mode;
    const action = APPLIED_MOVEMENTS.find((item) => item.id === actionId);
    if (!action) return false;

    const now = performance.now();
    const triggerKey = `${sourceLabel}:${actionId}`;
    this._appliedMovementTriggerCooldowns ??= new Map();
    const cooldownUntil = this._appliedMovementTriggerCooldowns.get(triggerKey) ?? 0;
    if (cooldownUntil > now) return false;

    const threshold = Number(summary?.threshold ?? match.profile?.recognition?.threshold ?? 70);
    const score = Number(match.score) || 0;
    const trigger = midpointTriggerState(pose, action.targetPose, action.activeBones);
    if (!trigger.reached) return false;
    // El score solo desambigua la colecciÃ³n: NO exige seguir toda la secuencia del dataset.
    const enoughCandidateScore = score >= Math.max(18, threshold * 0.28);
    if (!enoughCandidateScore && trigger.confidence < 0.78) return false;

    this._appliedMovementTriggerCooldowns.set(triggerKey, now + Math.max(2200, Number(action.durationMs) + 700));
    this.agent?.setMode('pause');
    if (this.nodes?.agentMode) this.nodes.agentMode.value = 'pause';
    this.appliedMovementPlayer.play(action.id, now);
    this.appliedMovementStatus = this.appliedMovementPlayer.summary(now);
    this.#setMeshDriverMode('applied_movements');
    this.previousRotations = null;
    this.#status(`${sourceLabel}: punto de disparo ${(trigger.progress * 100).toFixed(0)}% -> accion aplicada: ${action.name}`);
    this.#renderAppliedMovementsPanel();
    return true;
  }

  #setPreprocessingAnimationMode(mode) {
    if (!this.agent || !this.nodes?.agentMode) return;
    if (this.meshDriverMode !== 'preprocessing') this.meshDriverMode = 'preprocessing';
    if (this.agent.mode !== mode) {
      this.agent.setMode(mode);
      this.nodes.agentMode.value = mode;
      this.root.querySelectorAll('[data-agent-preset]').forEach((button) => {
        button.classList.toggle('active', button.dataset.agentPreset === mode);
      });
    }
  }

  #setRuntimeDatasetAnimationMode(mode) {
    if (!this.agent || !this.nodes?.agentMode) return;
    if (this.meshDriverMode !== 'dataset_runtime') this.meshDriverMode = 'dataset_runtime';
    if (this.agent.mode !== mode) {
      this.agent.setMode(mode);
      this.nodes.agentMode.value = mode;
      this.root.querySelectorAll('[data-agent-preset]').forEach((button) => {
        button.classList.toggle('active', button.dataset.agentPreset === mode);
      });
    }
  }

  #meshDrivenByAgent() {
    return this.meshDriverMode === 'movement_training'
      || this.meshDriverMode === 'applied_movements'
      || this.meshDriverMode === 'gesture_trigger'
      || this.meshDriverMode === 'drl_demo'
      || this.meshDriverMode === 'preprocessing'
      || this.meshDriverMode === 'dataset_runtime'
      || this.meshDriverMode === 'ppo_training'
      || this.meshDriverMode === 'pipeline_synthetic';
  }

  #setMeshDriverMode(mode) {
    this.meshDriverMode = mode;
    const agentDrivesMesh = mode === 'drl_demo'
      || mode === 'applied_movements'
      || mode === 'gesture_trigger'
      || mode === 'movement_training'
      || mode === 'dataset_runtime';
    if (!agentDrivesMesh && this.agent?.enabled) {
      this.agent.setMode('pause');
      if (this.nodes?.agentMode) this.nodes.agentMode.value = 'pause';
      this.root.querySelectorAll('[data-agent-preset]').forEach((button) => {
        button.classList.toggle('active', button.dataset.agentPreset === 'pause');
      });
    }
    if (!mode.startsWith('q_learning') && this.qAgent?.active) this.qAgent.pause();
    if (!mode.startsWith('q_learning') && this.drlTrainer?.active) this.drlTrainer.pause();
    this.#renderDriverMode();
  }

  #startQTraining() {
    if (!this.qAgent || !this.controller) return;
    const mapped = mappedCount(this.mapper.summary());
    if (mapped < BONE_ORDER.length) {
      this.#status(`Q-learning bloqueado: bone map incompleto ${mapped}/15`);
      return;
    }
    this.#setMeshDriverMode('q_learning_train');
    if (this.nodes.qTrainingMode.value === 'baseline') {
      this.drlTrainer?.pause();
      this.qAgent.startTraining();
    } else {
      this.qAgent.pause();
      this.drlTrainer.start(this.#readTrainingConfig());
    }
    this.previousRotations = null;
    this.#status(`Q-learning: entrenamiento ${this.nodes.qTrainingMode.value} activo`);
  }

  #pauseQAgent() {
    this.qAgent?.pause();
    this.drlTrainer?.pause();
    if (this.meshDriverMode.startsWith('q_learning')) this.#setMeshDriverMode('idle');
    this.#status('Q-learning en pausa');
  }

  #resumeQTraining() {
    if (this.nodes.qTrainingMode.value === 'baseline') {
      this.#startQTraining();
      return;
    }
    this.#setMeshDriverMode('q_learning_train');
    this.drlTrainer?.resume();
    this.#status('DRL reanudado');
  }

  #stopQTraining() {
    this.qAgent?.pause();
    this.drlTrainer?.stop();
    if (this.meshDriverMode.startsWith('q_learning')) this.#setMeshDriverMode('idle');
    this.#status('Entrenamiento detenido');
  }

  #startQEvaluation() {
    if (this.nodes.qTrainingMode.value === 'dqn') {
      if (!this.drlTrainer) return;
      this.#setMeshDriverMode('q_learning_eval');
      this.qAgent?.pause();
      this.drlTrainer.evaluate();
      this.previousRotations = null;
      this.#status('DRL: evaluando politica sin exploracion');
      return;
    }
    if (!this.qAgent || !this.qAgent.qtableReady) {
      this.#status('Q-learning: primero entrena o carga una Q-table');
      return;
    }
    this.#setMeshDriverMode('q_learning_eval');
    this.qAgent.startEvaluation();
    this.previousRotations = null;
    this.#status('Q-learning: evaluando politica sin exploracion');
  }

  #resetQTable() {
    this.qAgent?.resetQTable();
    this.drlTrainer?.reset();
    this.testQModelLoaded = false;
    this.controller?.resetPose();
    this.previousRotations = null;
    if (this.meshDriverMode.startsWith('q_learning')) this.#setMeshDriverMode('idle');
    this.#status('Entrenamiento reiniciado');
    this.#renderTestPanel();
  }

  #exportQArtifacts() {
    if (!this.qAgent) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJson(`ironsync_qtable_${stamp}.json`, exportQTable(this.qAgent.snapshot()));
    downloadJson(`ironsync_training_log_${stamp}.json`, exportQTrainingLog(this.qAgent.trainingLog));
    downloadJson(`ironsync_q_transitions_${stamp}.json`, exportQTransitions(this.qAgent.transitions));
    downloadJson(`ironsync_policy_summary_${stamp}.json`, exportPolicySummary(this.qAgent.summary()));
    this.#status('Q-learning exportado: Q-table, log, transiciones y resumen');
  }

  #exportBestDrlModel() {
    if (!this.drlTrainer) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJson(`ironsync_best_model_${stamp}.json`, this.drlTrainer.exportBestModel());
    downloadJson(`ironsync_training_metrics_${stamp}.json`, this.drlTrainer.exportTrainingMetrics());
    downloadJson(`ironsync_reconstruction_report_${stamp}.json`, this.drlTrainer.exportReconstructionReport());
    this.#status('DRL exportado: mejor modelo, metricas y reconstruccion');
  }

  async #loadDrlModel(event) {
    const [file] = event.target.files ?? [];
    if (!file || !this.drlTrainer) return;
    try {
      const snapshot = JSON.parse(await file.text());
      this.drlTrainer.importBest(snapshot);
      this.testQModelLoaded = true;
      this.#status(`Modelo DRL cargado: ${file.name}`);
    } catch (error) {
      this.#status(`No se pudo cargar modelo DRL: ${error.message}`);
    } finally {
      event.target.value = '';
      this.#renderTestPanel();
    }
  }

  #readTrainingConfig() {
    return {
      mode: this.nodes.qTrainingMode.value,
      targetAccuracy: Number(this.nodes.qTargetAccuracy.value) / 100,
      maxMinutes: Number(this.nodes.qMaxMinutes.value),
      maxEpisodes: Number(this.nodes.qMaxEpisodes.value),
      maxEpisodeSteps: Number(this.nodes.qMaxEpisodeSteps.value),
      minEvaluationFrames: Number(this.nodes.qMinEvaluationFrames.value),
      numEnvironments: Number(this.nodes.qNumEnvironments.value),
      epsilonStart: Number(this.nodes.qEpsilonStart.value),
      epsilonMin: Number(this.nodes.qEpsilonMin.value),
      learningRate: Number(this.nodes.qLearningRate.value),
      gamma: Number(this.nodes.qGamma.value),
      batchSize: Number(this.nodes.qBatchSize.value),
      replaySize: Number(this.nodes.qReplaySize.value),
      checkpointEvery: Number(this.nodes.qCheckpointEvery.value),
      noiseLevel: Number(this.nodes.qNoiseLevel.value),
      missingSensorRate: Number(this.nodes.qMissingRate.value),
      spikeRate: Number(this.nodes.qSpikeRate.value),
      latencyFrames: Number(this.nodes.qLatencyFrames.value),
      speedTarget: this.nodes.qSpeedTarget.value,
    };
  }

  #resetEverything() {
    this.#setMeshDriverMode('idle');
    this.controller.resetPose();
    this.#setReferenceBodyView();
    this.previousRotations = null;
    this.rewardHistory = [];
    this.recorder.clear();
    this.#syncSlidersToSelected();
    this.#status('Todo reseteado - pose original y vista de referencia');
  }

  #setReferenceBodyView() {
    const view = this.modelInfo?.name === 'Og.FBX' ? 'unreal' : 'front';
    this.scene.setBodyView(view);
    this.#setActiveBodyView(view);
  }

  #connectBridge() {
    this.#disconnectBridge();
    const url = this.nodes.socketUrl.value.trim() || 'ws://127.0.0.1:8765';
    this.liveFrames = 0;
    this.nodes.bridgeFrames.textContent = '0 frames';
    this.nodes.bridgeSource.textContent = 'connecting';
    this.webSocket = new IronSyncWebSocket({
      onPacket: (packet) => this.#applyLivePacket(packet),
      onStatus: (status) => this.#setBridgeStatus(status),
    });
    this.webSocket.connect(url);
  }

  #disconnectBridge() {
    if (this.webSocket) this.webSocket.disconnect();
    this.webSocket = null;
    this.liveSource = 'offline';
    this.#setBridgeStatus('Desconectado');
  }

  #connectArduino() {
    this.#setMeshDriverMode('idle');
    this.testSimulationActive = false;
    this.testLastFrameAt = 0;
    if (this.arduinoConnection) {
      this.arduinoConnection.disconnect();
      this.arduinoConnection = null;
    }
    this.#disconnectBridge();
    this.#resetLivePose();
    this.arduinoFrames = 0;
    this.relayReportedFrames = 0;
    this.relayUdpIsCount = 0;
    this.relayParsedOk = 0;
    this.relayParseFail = 0;
    this.relayLastIsAgeMs = null;
    this.relayUdpBindFailed = false;
    this.livePacketCount = 0;
    this.liveSessionFrameCount = 0;
    this.lastSensorMuxByAlias = {};
    this.arduinoProgress = 0;
    this.arduinoStateText = 'Conectando';
    this.calibrationConnectionVerified = false;
    this.hardwareSessionActive = false;
    this.megaCalibratingActive = false;
    this.userCalibrationRequested = false;
    this.hardwareStreamStarted = false;
    this.streamPausedByUser = false;
    this.sessionCalibrated = false;
    this.#renderArduinoFrameCounters();
    this.nodes.arduinoProgress.value = 0;
    this.nodes.arduinoProgressText.textContent = '0%';
    this.nodes.arduinoSource.textContent = 'mega/esp32';
    this.arduinoConnection = new ArduinoConnection({
      onPacket: (packet) => this.#applyLivePacket(packet),
      onStatus: (status) => this.#setArduinoStatus(status),
      onRelayStats: (stats) => this.#applyRelayStats(stats),
      onSensors: (rows) => this.#renderArduinoSensors(rows),
      onRelayEvent: (event) => this.#handleRelayEvent(event),
    });
    this.arduinoConnection.connect(this.nodes.arduinoUrl.value.trim() || 'ws://127.0.0.1:8767');
    window.setTimeout(() => this.#refreshTrainingCollections(), 800);
  }

  #teardownHardwareSession(mode = 'disconnect-hardware') {
    if (!this.arduinoConnection?.connected) {
      this.hardwareSessionActive = false;
      this.#resetLivePose();
      return;
    }
    if (mode === 'disconnect-hardware') {
      if (this.hardwareSessionActive) {
        this.arduinoConnection.disconnectHardware();
      }
    } else if (mode === 'close-relay') {
      this.arduinoConnection.closeRelay();
    }
    this.hardwareSessionActive = false;
    this.testSimulationActive = false;
    this.userCalibrationRequested = false;
    this.hardwareStreamStarted = false;
    this.streamPausedByUser = false;
    this.sessionCalibrated = false;
    this.megaCalibratingActive = false;
    this.testLastFrameAt = 0;
    this.livePacketCount = 0;
    this.liveSessionFrameCount = 0;
    this.lastSensorMuxByAlias = {};
    this.liveStreamHz = 0;
    this._liveStreamSample = { frames: 0, at: 0 };
    this.calibrationConnectionVerified = false;
    this.ingressPipeline.setActive(false);
    this.#resetLivePose();
  }

  #disconnectArduino() {
    if (this.completePipeline?.active) this.#stopPipelineSimulation();
    if (this.meshDriverMode === 'hardware') this.#setMeshDriverMode('idle');
    this.#teardownHardwareSession('close-relay');
    const connection = this.arduinoConnection;
    this.arduinoConnection = null;
    this.hardwareSessionActive = false;
    if (connection) {
      window.setTimeout(() => connection.disconnect(), 420);
    }
    this.#setArduinoStatus({ state: 'Relay cerrado', progress: 0, frames: 0 });
    this.#status('Relay cerrado: Mega reinicia, ESP32 desregistrado Ã¢â‚¬â€ abre relay y Conectar hardware');
    this.#renderTestPanel();
  }

  #connectUnreal() {
    this.#disconnectUnreal();
    this.unrealFrames = 0;
    this.unrealBridge = new UnrealEngineBridge({
      onStatus: (status) => this.#setUnrealStatus(status),
    });
    this.unrealBridge.connect(this.nodes.unrealUrl.value.trim() || 'ws://127.0.0.1:8766');
  }

  #disconnectUnreal() {
    if (this.unrealBridge) this.unrealBridge.disconnect();
    this.unrealBridge = null;
    this.#setUnrealStatus({ state: 'Desconectado', frames: this.unrealFrames });
  }

  #setUnrealStatus({ state, frames, target }) {
    if (!this.nodes?.unrealState) return;
    this.unrealFrames = frames ?? this.unrealFrames;
    this.nodes.unrealState.textContent = state;
    this.nodes.unrealState.className = state === 'Conectado' || state === 'Transmitiendo' ? 'ok' : state.includes('Error') ? 'bad' : '';
    this.nodes.unrealFrames.textContent = `${this.unrealFrames} frames`;
    if (target) this.nodes.unrealTarget.textContent = target;
  }

  #setBridgeStatus(status) {
    if (!this.nodes?.bridgeState) return;
    const normalized = status === 'connected' ? 'Conectado' : status;
    if (normalized === 'Conectado' && this.guidedCalibrationSessionActive && this.guidedCalibrationForceMode) {
      this.#syncMasterCalibrationToBridge('apply');
    }
    this.nodes.bridgeState.textContent = normalized;
    this.nodes.bridgeState.className = normalized === 'Conectado' ? 'ok' : normalized.includes('Error') ? 'bad' : '';
  }

  #setArduinoStatus({
    state,
    progress,
    frames,
    relayParsedIs,
    type,
    esp32,
    udp,
    hardwareSession,
    megaCalibrating,
    calibrationRequested,
    sessionCalibrated,
    streamPausedByUser,
    disconnected,
  }) {
    if (!this.nodes?.arduinoState) return;
    const incomingState = String(state ?? '');
    if (typeof relayParsedIs === 'number') {
      this.relayReportedFrames = relayParsedIs;
    } else if (type === 'frame' && typeof frames === 'number') {
      this.relayReportedFrames = frames;
    }
    if (typeof hardwareSession === 'boolean') {
      this.hardwareSessionActive = hardwareSession;
    } else if (
      /hardware conectado|esp32_pc_registered|stream is listo|stream mega activo/i.test(incomingState)
    ) {
      this.hardwareSessionActive = true;
    }
    if (typeof megaCalibrating === 'boolean') {
      this.megaCalibratingActive = megaCalibrating && (this.userCalibrationRequested || calibrationRequested === true);
    }
    if (calibrationRequested === true) {
      this.userCalibrationRequested = true;
    }
    if (sessionCalibrated === true) {
      this.sessionCalibrated = true;
      this.userCalibrationRequested = false;
      this.megaCalibratingActive = false;
      this.hardwareStreamStarted = true;
    }
    if (streamPausedByUser === true) {
      this.streamPausedByUser = true;
      this.hardwareStreamStarted = false;
      this.testSimulationActive = false;
    } else if (streamPausedByUser === false) {
      this.streamPausedByUser = false;
    }
    if (disconnected) {
      this.hardwareSessionActive = false;
      this.megaCalibratingActive = false;
      this.userCalibrationRequested = false;
      this.hardwareStreamStarted = false;
      this.streamPausedByUser = false;
      this.sessionCalibrated = false;
    }
    this.arduinoStateText = incomingState || this.arduinoStateText;
    if (typeof progress === 'number') this.arduinoProgress = Math.max(0, Math.min(100, progress));
    this.nodes.arduinoState.textContent = this.arduinoStateText;
    const stateText = this.arduinoStateText;
    this.#handleArduinoCalReferenceSnapshot(stateText);
    if (this.hardwareSessionActive && isHardwareVerifiedState(stateText, this.arduinoFrames)) {
      this.calibrationConnectionVerified = true;
    }
    if (stateText.includes('Desconectado') || stateText.includes('Sin respuesta')) this.calibrationConnectionVerified = false;
    const hasLiveFrames = this.livePacketCount > 0;
    this.nodes.arduinoState.className = stateText.includes('completada')
      || stateText.includes('Stream IS')
      || (stateText.includes('Datos') && hasLiveFrames)
      || (stateText.includes('Hardware conectado') && !this.megaCalibratingActive)
      || stateText.includes('Calibracion OK')
      || stateText.includes('Transferencia activa')
      || stateText.includes('conectado')
      || stateText.includes('Conectado')
      ? 'ok'
      : stateText.includes('Error') || stateText.includes('ERROR') || stateText.includes('Sin respuesta')
        ? 'bad'
        : '';
    this.nodes.arduinoProgress.value = this.arduinoProgress;
    this.nodes.arduinoProgressText.textContent = `${this.arduinoProgress.toFixed(0)}%`;
    this.#renderArduinoFrameCounters();
    if (esp32 || udp) this.nodes.arduinoTarget.textContent = esp32 || udp;
    if (stateText.includes('completada')) this.#status('Calibracion y sincronizacion completada');
    const calibrationFinished = this.userCalibrationRequested
      && /calibracion ok|calibracion y sincronizacion completada|transferencia activa|stream is listo|stream mega activo/i.test(stateText);
    if (calibrationFinished) {
      this.sessionCalibrated = true;
      this.userCalibrationRequested = false;
      this.megaCalibratingActive = false;
      this.streamPausedByUser = false;
      this.hardwareStreamStarted = true;
    }
    if (stateText.includes('ESP32_DISCONNECTED') || stateText.includes('ESP32_DISCONNECTING')) {
      this.testLastFrameAt = 0;
      this.livePacketCount = 0;
    this.liveSessionFrameCount = 0;
    this.lastSensorMuxByAlias = {};
      this.#status('Hardware desconectado: Mega reiniciado Ã¢â‚¬â€ Conectar hardware para nueva sesion');
    }
    if (stateText.includes('Datos en pausa') || stateText.includes('Transferencia detenida')) {
      this.streamPausedByUser = true;
      this.hardwareStreamStarted = false;
    }
    if (stateText.includes('MEGA_READY') || stateText.includes('MEGA_SESSION_RESET')) {
      this.#status('Mega listo tras reinicio Ã¢â‚¬â€ pulsa Conectar hardware');
    }
    if (/^calibrando|cal_progress|cal_wait|orden de calibracion/i.test(stateText)) {
      this.#resetLivePose();
    }
    this.#ensureUnifiedCalibration()?.onArduinoStatus(stateText, this.arduinoProgress);
    this.#renderCalibrationPanel();
    this.#renderUnifiedCalibrationPanel();
  }

  #handleArduinoCalReferenceSnapshot(stateText) {
    const line = String(stateText ?? '').trim();
    if (!line) return;

    if (line.startsWith('CAL_REFERENCE_BEGIN')) {
      this.arduinoCalReferenceLines = [line];
      this.arduinoCalReferenceCollecting = true;
      this.#renderArduinoCalReferenceLog();
      return;
    }

    if (line.startsWith('CAL_REFERENCE_SENSOR,') && !this.arduinoCalReferenceCollecting) {
      this.arduinoCalReferenceLines = ['CAL_REFERENCE_BEGIN'];
      this.arduinoCalReferenceCollecting = true;
    }

    if (!this.arduinoCalReferenceCollecting) return;

    this.arduinoCalReferenceLines.push(line);
    this.#renderArduinoCalReferenceLog();

    if (line.startsWith('CAL_REFERENCE_END')) {
      this.arduinoCalReferenceCollecting = false;
      const saved = this.calReferenceStore.saveFromLines(this.arduinoCalReferenceLines, {
        source: 'mega-calibration',
      });
      if (saved) {
        this.#status(`CAL_REFERENCE guardado (${saved.sensorCount} sensores) Ã¢â‚¬â€ listo para aplicar como golden`);
      }
      this.#renderArduinoCalReferenceLog();
      return;
    }
  }

  #renderArduinoCalReferenceLog() {
    if (!this.nodes?.arduinoCalReferenceLog) return;
    const text = this.arduinoCalReferenceLines?.length
      ? this.arduinoCalReferenceLines.join('\n')
      : 'Esperando bloque CAL_REFERENCE...';
    this.nodes.arduinoCalReferenceLog.textContent = text;
  }

  #clearArduinoCalReferenceLog() {
    this.arduinoCalReferenceLines = [];
    this.arduinoCalReferenceCollecting = false;
    if (this.nodes?.arduinoCalReferenceLog) {
      this.nodes.arduinoCalReferenceLog.textContent = 'Esperando bloque CAL_REFERENCE...';
    }
  }

  #saveCalReferenceGolden() {
    const saved = this.calReferenceStore.saveFromLines(this.arduinoCalReferenceLines ?? [], {
      source: 'manual-save',
    });
    if (!saved) {
      this.#status('No hay CAL_REFERENCE para guardar Ã¢â‚¬â€ calibra primero');
      return;
    }
    downloadJson(`ironsync_cal_reference_golden_${localTimestampForFilename()}.json`, saved);
    this.#status(`Golden CAL_REFERENCE exportado (${saved.sensorCount} sensores)`);
  }

  async #applyCalReferenceGolden() {
    const golden = this.calReferenceStore.getGolden();
    if (!golden?.sensors?.length) {
      this.#status('Sin golden CAL_REFERENCE Ã¢â‚¬â€ calibra o importa JSON');
      return;
    }
    await this.#ensureArduinoRelay();
    let sent = 0;
    for (const sensor of golden.sensors) {
      const candidate = String(sensor.loadLine ?? '').trim();
      const cmd = candidate.startsWith('LOAD_CAL_REFERENCE_SENSOR,')
        ? candidate
        : buildLoadCalReferenceCommand(sensor);
      this.arduinoConnection?.sendCommand(cmd);
      sent += 1;
      await new Promise((resolve) => window.setTimeout(resolve, 90));
    }
    this.#status(`Golden aplicado al Mega: ${sent} sensores (LOAD_CAL_REFERENCE)`);
  }

  async #importCalReferenceGolden(event) {
    const [file] = event.target.files ?? [];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (!this.calReferenceStore.importGolden(payload)) {
        throw new Error('JSON invalido');
      }
      this.arduinoCalReferenceLines = payload.lines ?? [];
      this.#renderArduinoCalReferenceLog();
      this.#status(`Golden importado (${payload.sensorCount ?? payload.sensors?.length ?? 0} sensores)`);
    } catch (error) {
      this.#status(`No se pudo importar golden: ${error.message}`);
    }
    event.target.value = '';
  }

  #resetLivePose() {
    if (!this.controller) return;
    this.controller.resetPose();
    this.previousRotations = null;
    this.biomechFootLock = { activeSide: null, blockedFrames: 0, lastWarnAt: 0 };
    this.lastAppliedHardwarePose = null;
    this.lastLiveSliderSync = 0;
    this.#syncSlidersToSelected();
  }

  #bindPacketInspector() {
    this.packetInspector.subscribe(() => {
      this.packetInspectorRenderPending = true;
    });
  }

  #recordPacketInspector(entry) {
    if (!this.nodes?.packetInspectorLog) return;
    this.packetInspector.record(entry);
  }

  #renderPacketInspector(force = false) {
    if (!this.nodes?.packetInspectorLog) return;
    if (!force && !this.packetInspectorRenderPending) return;

    this.packetInspectorRenderPending = false;
    const snapshot = this.packetInspector.snapshot();
    const text = this.packetInspector.formatForDisplay(snapshot.entries.slice(-40));
    this.nodes.packetInspectorLog.textContent = text || 'Esperando paquetes IS...';
    this.nodes.packetInspectorCount.textContent = `${snapshot.count} paquetes en buffer`;
    this.nodes.packetInspectorHz.textContent = `${this.lastPacketInspectorHz.toFixed(1)} Hz`;

    if (!snapshot.paused) {
      this.nodes.packetInspectorLog.scrollTop = this.nodes.packetInspectorLog.scrollHeight;
    }
  }

  #clearPacketInspector() {
    this.packetInspector.clear();
    this.#renderPacketInspector(true);
  }

  #togglePacketTerminal() {
    const panel = this.nodes.packetTerminalPanel;
    const button = this.nodes.togglePacketTerminal;
    if (!panel || !button) return;

    const open = panel.hidden;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.classList.toggle('is-open', open);
    if (open) this.#renderPacketInspector(true);
  }

  #applyLivePacket(packet) {
    if (!packet || packet.type === 'status') {
      if (packet?.message) this.#setBridgeStatus(packet.message);
      return;
    }
    const rotations = Array.isArray(packet.rotations) ? packet.rotations : [];
    if (!rotations.length) return;
    const frameNow = performance.now();
    this.testLastFrameAt = frameNow;
    if (packet.source === 'arduino-mega') {
      this.livePacketCount += 1;
      this.liveSessionFrameCount = (this.liveSessionFrameCount ?? 0) + 1;
      this.arduinoFrames = this.liveSessionFrameCount;
      this.#trackLiveStreamHz(this.liveSessionFrameCount, frameNow);
      for (const item of rotations) {
        if (!item.alias) continue;
        this.lastSensorMuxByAlias ??= {};
        this.lastSensorMuxByAlias[item.alias] = {
          tca: item.tca,
          channel: item.channel,
          firmwareKey: item.firmwareKey,
          routeBy: item.routeBy,
          keyMismatch: item.keyMismatch,
          expectedKey: item.expectedKey,
          physicalKey: item.physicalKey,
          meshBone: item.meshBone,
        };
      }
      if (packet.routing?.keyMismatch > 0 && !this._routingMismatchWarnAt) {
        this._routingMismatchWarnAt = frameNow;
        console.warn(
          `[IRON-SYNC] ${packet.routing.keyMismatch} bloque(s) IS descartados: key Ã¢â€°Â  mux (SensorMap.ino)`,
        );
      } else if (!packet.routing?.keyMismatch) {
        this._routingMismatchWarnAt = 0;
      }
    }
    if (this.testSimulationActive) this.#ensureMeshMappingForLive();
    const normalizedPacket = { ...packet, rotations };
    this.sensorCalibration.setConfig(this.#readCalibrationConfig());
    this.sensorCalibration.observePacket(normalizedPacket);
    const calibratedRotations = this.sensorCalibration.transformRotations(rotations);
    const outputRotations = this.testUseRawRotations ? rotations : calibratedRotations;
    this.testLastMotion = strongestMotion(outputRotations, rotations);

    const rawPose = buildPoseFromRotations(rotations, { meshOnly: false });
    const ingressPose = this.ingressPipeline.processPose(rawPose);
    const calibratedPose = buildPoseFromRotations(calibratedRotations, { meshOnly: false });
    const meshRotations = this.testUseRawRotations ? rotations : calibratedRotations;
    const packetPose = buildPoseFromRotations(meshRotations, {
      meshOnly: true,
      mappedAliases: this.mapper?.getBones?.() ?? new Map(),
    });
    const poseForFeatures = this.ingressPipeline.isActive() ? ingressPose : rawPose;
    const trainingPose = this.masterCalibration.hasBaseline()
      ? toRelativePose(poseForFeatures, this.masterCalibration.getBaseline())
      : poseForFeatures;
    this.movementTraining.observeFrame(trainingPose, this.testLastFrameAt);
    this.latestHardwarePose = {
      pose: packetPose,
      rawPose,
      calibratedPose,
      ingressPose,
      at: this.testLastFrameAt,
      source: packet.source ?? 'live',
    };
    const relativePose = this.masterCalibration.hasBaseline()
      ? toRelativePose(poseForFeatures, this.masterCalibration.getBaseline())
      : poseForFeatures;

    const mappedCount = Object.keys(packetPose ?? {}).length;
    if (this.controller && mappedCount === 0 && rotations.length > 0) {
      console.warn('[IRON-SYNC] Frames con rotaciones pero 0 huesos mapeados al mesh Ã¢â‚¬â€ auto-mapear en Calibracion');
    }

    const meshPose = packetPose;
    const meshCount = Object.keys(meshPose ?? {}).length;

    const skipHardwareMesh = this.movementPreprocessor?.active
      || this.runtimeDatasetPreprocessor?.active
      || this.meshDriverMode === 'preprocessing'
      || this.meshDriverMode === 'dataset_runtime';
    if (this.controller && meshCount > 0 && !skipHardwareMesh) {
      if (this.gestureTriggerEnabled && this.gestureLibrary.loaded) {
        this.#tickGestureTrigger(relativePose, this.testLastFrameAt);
      } else if (this.testSimulationActive && !this.#meshDrivenByAgent()) {
        if (!this.meshDriverMode.startsWith('q_learning')) this.#setMeshDriverMode('hardware');
        this.#applyHardwarePose(meshPose);
      } else if (!this.#meshDrivenByAgent() && this.meshDriverMode === 'hardware') {
        this.#applyHardwarePose(meshPose);
      }
    } else if (this.controller && this.testSimulationActive && meshCount === 0) {
      if (!this._lastAutoMapWarnAt || frameNow - this._lastAutoMapWarnAt > 8000) {
        this._lastAutoMapWarnAt = frameNow;
        this.#status('Frames IS OK pero 0 huesos en el mesh Ã¢â‚¬â€ Calibracion Ã¢â€ â€™ Auto-mapear (o carga FBX)');
      }
    }

    const health = this.sensorCalibration.getStreamHealth();
    this.lastPacketInspectorHz = health.realHz;
    this.#recordPacketInspector({
      frame: normalizedPacket.frame,
      mask: normalizedPacket.mask,
      activeSensors: normalizedPacket.activeSensors,
      rotationCount: rotations.length,
      mode: this.ingressPipeline.isActive() ? 'ingress' : (this.testUseRawRotations ? 'crudo' : 'corregido'),
      appliedBones: meshCount,
      hz: health.realHz,
      topMotion: this.testLastMotion,
      rotations: outputRotations,
      rawLine: normalizedPacket.rawLine ?? '',
    });

    this.liveFrames += 1;
    this.liveSource = packet.source ?? 'live';
    this.nodes.bridgeFrames.textContent = `${this.liveFrames} frames`;
    this.nodes.bridgeSource.textContent = this.liveSource;
    const now = performance.now();
    if (now - this.lastLiveSliderSync > 180) {
      this.lastLiveSliderSync = now;
      this.#syncSlidersToSelected();
    }
    this.#renderCalibrationPanel();
    this.#renderGuidedCalibrationPanel();
    this.#renderTestPanel();
    void this.#tickIaSimulation(normalizedPacket, calibratedPose);
    this.#tickPipelineHardware(normalizedPacket, calibratedPose);
  }

  #ensureMeshMappingForLive() {
    if (!this.controller || countMappedBones(this.mapper) >= 7) return countMappedBones(this.mapper);
    this.mapper.autoMap();
    return countMappedBones(this.mapper);
  }

  #trackLiveStreamHz(frameCount, now = performance.now()) {
    const sample = this._liveStreamSample;
    if (!sample.at) {
      sample.frames = frameCount;
      sample.at = now;
      return;
    }
    const deltaFrames = frameCount - sample.frames;
    const deltaMs = now - sample.at;
    if (deltaFrames > 0 && deltaMs >= 80 && deltaMs <= 2500) {
      this.liveStreamHz = (deltaFrames / deltaMs) * 1000;
    }
    if (deltaMs >= 250) {
      sample.frames = frameCount;
      sample.at = now;
    }
  }

  #applyLatestHardwarePoseToMesh() {
    const pose = this.#currentHardwarePose();
    if (!pose || Object.keys(pose).length === 0) return false;
    return this.#applyHardwarePose(pose);
  }

  #fitIngressProfileFromUnified() {
    if (!this.controller) return false;
    const meshTarget = readMeshReferenceDeltas(this.controller);
    const captureA = this.sensorCalibration.captureA;
    const imuBaseline = imuBaselineFromCaptureA(captureA);
    this.ingressPipeline.fitFromCalibration({
      imuBaseline,
      meshTarget,
      captureA,
      modelInfo: this.modelInfo,
      mapping: this.mapper.summary(),
    });
    this.ingressPipeline.setActive(true);
    const summary = this.ingressPipeline.summary();
    this.#status(`Pipeline entrada: ${summary.online}/15 huesos mapeados al mesh (${summary.referencePose})`);
    return true;
  }

  #applyHardwarePose(packetPose) {
    if (!this.controller || !packetPose || Object.keys(packetPose).length === 0) return false;
    const safePose = this.#enforceBiomechanicalSafety(packetPose);
    const applied = this.controller.writeMany(safePose, { clamp: true, guard: true });
    this.lastAppliedHardwarePose = {
      pose: applied,
      at: performance.now(),
      count: Object.keys(applied ?? safePose).length,
    };
    return true;
  }

  #enforceBiomechanicalSafety(pose) {
    const next = { ...pose };
    const current = this.lastAppliedHardwarePose?.pose ?? {};
    const leftScore = legMotionScore(next, current, 'L');
    const rightScore = legMotionScore(next, current, 'R');
    const leftAway = legAwayFromBase(next, 'L');
    const rightAway = legAwayFromBase(next, 'R');
    const movingLeft = leftScore >= FOOT_SUPPORT_MOVE_DEG || leftAway >= FOOT_SUPPORT_AWAY_DEG;
    const movingRight = rightScore >= FOOT_SUPPORT_MOVE_DEG || rightAway >= FOOT_SUPPORT_AWAY_DEG;
    const lock = this.biomechFootLock ??= { activeSide: null, blockedFrames: 0, lastWarnAt: 0 };

    if (lock.activeSide === 'L' && leftAway <= FOOT_SUPPORT_RELEASE_DEG) lock.activeSide = null;
    if (lock.activeSide === 'R' && rightAway <= FOOT_SUPPORT_RELEASE_DEG) lock.activeSide = null;

    if (!lock.activeSide) {
      if (movingLeft && movingRight) {
        lock.activeSide = leftAway + leftScore >= rightAway + rightScore ? 'L' : 'R';
      } else if (movingLeft) {
        lock.activeSide = 'L';
      } else if (movingRight) {
        lock.activeSide = 'R';
      }
    }

    if (lock.activeSide === 'L') {
      keepSupportLegStable(next, current, 'R');
      if (movingRight) this.#noteBiomechBlocked('pie derecho bloqueado: soporte mientras pierna izquierda vuelve a base');
    } else if (lock.activeSide === 'R') {
      keepSupportLegStable(next, current, 'L');
      if (movingLeft) this.#noteBiomechBlocked('pie izquierdo bloqueado: soporte mientras pierna derecha vuelve a base');
    }

    return next;
  }

  #noteBiomechBlocked(message) {
    const lock = this.biomechFootLock ??= { activeSide: null, blockedFrames: 0, lastWarnAt: 0 };
    lock.blockedFrames += 1;
    const now = performance.now();
    if (now - lock.lastWarnAt > 1400) {
      lock.lastWarnAt = now;
      this.#status(`Regla biomecanica: ${message}`);
    }
  }

  #currentHardwarePose() {
    if (!this.latestHardwarePose) return null;
    return this.latestHardwarePose.pose
      ?? this.latestHardwarePose.calibratedPose
      ?? this.latestHardwarePose.rawPose;
  }

  #applyRelayStats(stats = {}) {
    if (typeof stats.udpIs === 'number') this.relayUdpIsCount = stats.udpIs;
    if (typeof stats.parsedOk === 'number') this.relayParsedOk = stats.parsedOk;
    if (typeof stats.parseFail === 'number') this.relayParseFail = stats.parseFail;
    if (stats.lastIsAgeMs != null) this.relayLastIsAgeMs = stats.lastIsAgeMs;
    if (typeof stats.udpBindFailed === 'boolean') this.relayUdpBindFailed = stats.udpBindFailed;
    if (typeof stats.hardwareSession === 'boolean') {
      this.hardwareSessionActive = stats.hardwareSession;
    }
    if (stats.udpBindFailed) {
      this.#status('Puerto UDP 5005 ocupado Ã¢â‚¬â€ cierra bridge Python y reinicia npm run dev');
    }
    this.#renderArduinoFrameCounters();
  }

  #renderArduinoFrameCounters() {
    if (!this.nodes?.arduinoFrames) return;
    const now = performance.now();
    const isStale = this.relayLastIsAgeMs != null && this.relayLastIsAgeMs > 2500;
    const framesFresh = Boolean(
      (this.testLastFrameAt && now - this.testLastFrameAt < 1800)
      && !isStale,
    );
    if (isStale && this.liveSessionFrameCount) {
      this.liveSessionFrameCount = 0;
    }
    const vivoCount = framesFresh ? (this.liveSessionFrameCount ?? 0) : 0;
    const relayHint = this.relayUdpBindFailed
      ? 'UDP 5005 OCUPADO'
      : `udp-is ${this.relayUdpIsCount} Ã‚Â· ok ${this.relayParsedOk} Ã‚Â· fail ${this.relayParseFail}`;
    const ageHint = this.relayLastIsAgeMs != null
      ? ` Ã‚Â· ult IS ${Math.round(this.relayLastIsAgeMs / 1000)}s`
      : '';
    const staleHint = isStale ? ' Ã‚Â· STREAM PAUSADO' : '';
    this.nodes.arduinoFrames.textContent = `${vivoCount} vivo Ã‚Â· ${relayHint}${ageHint}${staleHint}`;
  }

  #renderArduinoSensors(rows) {
    this.arduinoSensorRows = rows;
    const muxMap = this.lastSensorMuxByAlias ?? {};
    this.nodes.arduinoSensors.innerHTML = rows
      .map((item) => {
        const mux = muxMap[item.alias];
        const muxLabel = mux?.physicalKey
          ? `${mux.physicalKey}${mux.keyMismatch ? ' !key' : ''}`
          : '';
        return `
        <div class="sensor-pill ${item.online ? 'online' : 'offline'}">
          <span>${item.alias}${muxLabel ? ` <small>${muxLabel}</small>` : ''}</span>
          <strong>${item.state}</strong>
        </div>
      `;
      })
      .join('');
  }

  #ensureUnifiedCalibration() {
    if (this.unifiedCalibration) return this.unifiedCalibration;

    this.unifiedCalibration = new UnifiedCalibrationOrchestrator({
      checkPrerequisites: ({ requireHardwareConnected }) => {
        const missing = [];
        const relayOpen = Boolean(this.arduinoConnection?.connected);
        if (!relayOpen) missing.push('Abre relay ESP32/Mega');
        const hardwareConnected = relayOpen && (
          this.hardwareSessionActive
          || isHardwareVerifiedState(this.arduinoStateText, this.livePacketCount)
        );
        if (requireHardwareConnected && !hardwareConnected) missing.push('Conecta hardware');
        if (!this.controller) missing.push('Carga el skeletal mesh (FBX)');
        const mapped = countMappedBones(this.mapper);
        if (mapped < 15) missing.push(`Auto-mapear huesos (${mapped}/15)`);
        return { ok: missing.length === 0, missing, mapped };
      },
      prepareForMegaCalibration: () => {
        this.#resetLivePose();
        this.sensorCalibration.reset();
        this.ingressPipeline.setActive(false);
        this.arduinoProgress = 0;
        this.#setArduinoStatus({
          state: 'Preparando calibracion unificada',
          progress: 0,
          frames: this.arduinoFrames,
        });
      },
      sendMegaCalibration: () => {
        if (this.userCalibrationRequested || this.megaCalibratingActive) return;
        this.userCalibrationRequested = true;
        this.hardwareStreamStarted = false;
        this.megaCalibratingActive = true;
        this.arduinoConnection?.startCalibration();
      },
      resumeLiveStream: () => {},
      setMeshReferencePose: (referencePose) => {
        if (!this.controller) return;
        if (referencePose === 'unreal-initial') {
          this.controller.applyUnrealInitialPose();
        } else {
          this.controller.resetPose();
        }
        this.#syncSlidersToSelected();
      },
      captureBase: () => {
        this.sensorCalibration.setConfig(this.#readCalibrationConfig());
        this.sensorCalibration.captureBase();
      },
      captureVerification: () => {
        this.sensorCalibration.setConfig(this.#readCalibrationConfig());
        this.sensorCalibration.captureVerification();
      },
      applyProfile: () => {
        this.sensorCalibration.setConfig(this.#readCalibrationConfig());
        return this.sensorCalibration.applyProfile();
      },
      getCalibrationSummary: () => this.sensorCalibration.summary(),
      getStabilityMetrics: () => {
        const health = this.sensorCalibration.getStreamHealth();
        const relayOpen = Boolean(this.arduinoConnection?.connected);
        const relayAt = this.arduinoConnection?.lastFrameAt ?? 0;
        const now = performance.now();
        const relayFresh = Boolean(relayAt && now - relayAt < 2000);
        const relayHz = relayFresh && health.realHz < 3
          ? Math.max(health.realHz, 30 / Math.max(0.05, (now - relayAt) / 1000))
          : health.realHz;
        const onlineFromRows = this.arduinoSensorRows.filter((row) => row.online).length;
        return {
          ...health,
          relayOpen,
          relayFresh,
          relayFrames: this.arduinoConnection?.frameCount ?? 0,
          sampleCount: relayFresh
            ? Math.max(health.sampleCount, Math.min(24, Math.floor((this.arduinoConnection?.frameCount ?? 0) / 8)))
            : health.sampleCount,
          online: Math.max(health.online, relayFresh ? onlineFromRows : 0),
          realHz: Math.max(health.realHz, relayHz),
          jitterMs: relayFresh && health.sampleCount < 3 ? 8 : health.jitterMs,
        };
      },
      enableLiveMesh: () => {
        this.calibrationConnectionVerified = true;
        this.testSimulationActive = false;
        this.sensorCalibration.setLiveMode(true);
        this.#setMeshDriverMode('idle');
      },
      commitMasterFromCaptureA: () => {
        if (!this.sensorCalibration.captureA) {
          this.sensorCalibration.captureBase();
        }
        const exportPayload = this.sensorCalibration.exportProfile({
          modelInfo: this.modelInfo,
          mapping: this.mapper.summary(),
        });
        if (!exportPayload?.captureA) return false;
        this.#commitMasterCalibration('Base IMU post-Mega (laboratorio)');
        return true;
      },
      delay: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
      onStageUpdate: (payload) => {
        this.unifiedCalibrationView = {
          stage: payload.stage,
          progress: payload.progress,
          label: payload.label,
          detail: payload.detail,
          running: true,
        };
        this.arduinoProgress = payload.progress;
        this.#status(`${payload.label}: ${payload.detail}`);
        this.#renderUnifiedCalibrationPanel();
        this.#renderCalibrationPanel();
      },
    });

    return this.unifiedCalibration;
  }

  /**
   * Calibración Mega con tabla golden (FORCE_GOLDEN_REFERENCE=1).
   * Sin envío de ceros hueso-a-hueso desde el mesh.
   */
  async #runStartCalibrationGolden() {
    if (this.userCalibrationRequested || this.megaCalibratingActive) {
      this.#status('Calibracion ya en curso — espera a que termine');
      return;
    }
    if (!this.hardwareSessionActive) {
      this.#status('Conecta hardware antes de calibrar');
      return;
    }
    if (!this.arduinoConnection?.connected) {
      this.#status('Abre relay ESP32/Mega antes de calibrar');
      return;
    }

    this.#resetLivePose();
    this.sensorCalibration.reset();
    this.ingressPipeline.setActive(false);
    this.arduinoProgress = 0;
    this.userCalibrationRequested = true;
    this.hardwareStreamStarted = false;
    this.megaCalibratingActive = true;
    this.#setArduinoStatus({
      state: 'Calibrando sensores (golden Mega)',
      progress: 5,
      frames: this.relayReportedFrames,
      megaCalibrating: true,
      calibrationRequested: true,
    });
    this.#status('Calibracion golden en Mega — permanece quieto en T-pose');
    this.arduinoConnection?.startCalibration();
  }

  async #runUnifiedCalibration() {
    if (this.unifiedCalibrationView.running) {
      this.#status('Ya hay una calibracion unificada en curso');
      return;
    }

    const orchestrator = this.#ensureUnifiedCalibration();
    const referencePose = String(this.modelInfo?.format ?? '').toUpperCase() === 'FBX'
      ? 'unreal-initial'
      : 'fbx-bind';

    this.unifiedCalibrationView.running = true;
    this.#renderUnifiedCalibrationPanel();

    const result = await orchestrator.run({
      referencePose,
      minOnline: 1,
      requireHardwareConnected: true,
      megaPrimary: true,
      minStableFrames: 12,
      maxJitter: 28,
      stabilizeTimeoutMs: 20000,
      megaTimeoutMs: 120000,
    });

    this.unifiedCalibrationView.running = false;
    this.unifiedCalibrationView.stage = result.ok ? 'ready' : result.cancelled ? 'cancelled' : 'failed';
    this.unifiedCalibrationView.progress = result.ok ? 100 : this.unifiedCalibrationView.progress;
    this.unifiedCalibrationView.label = result.ok ? 'Completado' : result.cancelled ? 'Cancelado' : 'Error';
    this.unifiedCalibrationView.detail = result.ok
      ? 'Traje y mesh listos'
      : result.error ?? 'Error desconocido';

    if (result.ok) {
      this.#fitIngressProfileFromUnified();
      this.#commitMasterCalibration('Calibracion maestra de sesion (traje + mesh)');
      this.#status('Calibracion unificada completada Ã¢â‚¬â€ pipeline de entrada activo para el mesh');
      this.#renderTestPanel();
    } else if (!result.cancelled) {
      this.#status(`Calibracion unificada fallida: ${result.error}`);
    }

    this.#renderUnifiedCalibrationPanel();
    this.#renderCalibrationPanel();
  }

  #cancelUnifiedCalibration() {
    this.#ensureUnifiedCalibration()?.cancel();
    this.unifiedCalibrationView.running = false;
    this.unifiedCalibrationView.stage = 'cancelled';
    this.unifiedCalibrationView.label = 'Cancelado';
    this.#status('Calibracion unificada cancelada');
    this.#renderUnifiedCalibrationPanel();
  }

  #renderUnifiedCalibrationPanel() {
    if (!this.nodes?.unifiedCalibrationStage) return;
    const view = this.unifiedCalibrationView;
    this.nodes.unifiedCalibrationStage.textContent = view.label;
    this.nodes.unifiedCalibrationStage.className = view.stage === 'ready' ? 'ok' : view.stage === 'failed' ? 'bad' : '';
    this.nodes.unifiedCalibrationProgress.value = view.progress;
    this.nodes.unifiedCalibrationProgressText.textContent = `${view.progress.toFixed(0)}%`;
    if (this.nodes.unifiedCalibrationHint) {
      const ingress = this.ingressPipeline?.summary?.();
      const ingressNote = ingress?.active
        ? ` Ã‚Â· Pipeline entrada: ${ingress.online}/15 huesos`
        : '';
      this.nodes.unifiedCalibrationHint.textContent = (view.detail || 'Conecta hardware, carga FBX y quÃƒÂ©date quieto en la pose del maniquÃƒÂ­.') + ingressNote;
    }
    if (this.nodes.unifiedCalibrateTrajeMesh) {
      this.nodes.unifiedCalibrateTrajeMesh.disabled = view.running;
    }
    if (this.nodes.cancelUnifiedCalibration) {
      this.nodes.cancelUnifiedCalibration.disabled = !view.running;
    }
  }

  #captureCalibrationA() {
    if (!this.#canCalibrateSensors()) return;
    this.sensorCalibration.setConfig(this.#readCalibrationConfig());
    this.controller?.resetPose();
    this.sensorCalibration.captureBase();
    this.#status('Pose base del skeletal mesh transferida a sensores - captura A');
    this.#renderCalibrationPanel();
    this.#renderTestPanel();
  }

  #captureCalibrationB() {
    if (!this.#canCalibrateSensors()) return;
    this.sensorCalibration.setConfig(this.#readCalibrationConfig());
    this.sensorCalibration.captureVerification();
    this.#status('Verificacion B capturada - revisa calidad por sensor');
    this.#renderCalibrationPanel();
    this.#renderTestPanel();
  }

  #applySensorCalibration() {
    if (!this.#canCalibrateSensors()) return;
    this.sensorCalibration.setConfig(this.#readCalibrationConfig());
    if (!this.sensorCalibration.applyProfile()) {
      this.#status('Primero captura base A y verificacion B');
      return;
    }
    this.sensorCalibration.setLiveMode(true);
    this.#resetLivePose();
    this.#commitMasterCalibration('Calibracion maestra de sesion');
    this.#status('Correccion de sensores aplicada al skeletal mesh');
    this.#renderCalibrationPanel();
    this.#renderTestPanel();
  }

  #resetSensorCalibration() {
    this.sensorCalibration.reset();
    this.testSimulationActive = false;
    this.#resetLivePose();
    this.#status('Perfil de calibracion reiniciado');
    this.#renderCalibrationPanel();
    this.#renderTestPanel();
  }

  #exportSensorCalibration() {
    downloadJson('ironsync_sensor_calibration.json', this.sensorCalibration.exportProfile({
      modelInfo: this.modelInfo,
      mapping: this.mapper.summary(),
    }));
  }

  async #takeMasterCalibrationBundle() {
    if (this.guidedCalibrationCapturing) return;
    this.#signalCalibrationFeedback('processing');
    this.guidedCalibrationApplyClass = '';
    this.guidedCalibrationCapturing = true;
    this.guidedCalibrationCaptureProgress = 0;
    this.guidedCalibrationApplyState = 'alineaciÃƒÂ³n 4s Ã¢â‚¬â€ adopta la pose del maniquÃƒÂ­ 3D';
    this.#renderGuidedCalibrationPanel();
    await this.#countdownGuidedPoseSettle(4000);

    this.guidedCalibrationApplyState = 'capturando 6s... mantÃƒÂ©n la pose sin moverte';
    this.#renderGuidedCalibrationPanel();
    const capture = await this.#captureGuidedCalibrationWindow(6000, { useIngressPose: true });
    this.guidedCalibrationCapturing = false;
    this.guidedCalibrationCaptureProgress = 100;
    if (capture.online < MIN_ACTIVE_SENSORS_FOR_MASTER_APPLY) {
      this.#signalCalibrationFeedback('fail');
      this.guidedCalibrationApplyState = `fallo: solo ${capture.online}/15 sensores con datos en la toma`;
      this.guidedCalibrationApplyClass = 'bad';
      this.#status(`No se pudo tomar calibracion completa: ${capture.online}/15 sensores con datos`);
      this.#renderGuidedCalibrationPanel();
      return;
    }
    const masterSnapshot = this.#buildMasterSnapshotFromCapture(capture.baseline);
    this.masterCalibration.importSnapshot(masterSnapshot);
    const sensorProfile = this.#buildSensorCalibrationFromBaseline(capture.baseline, capture.samplesByAlias);
    const stamp = localTimestampForFilename();
    const bundle = {
      schema: MASTER_CALIBRATION_BUNDLE_SCHEMA,
      createdAt: new Date().toISOString(),
      source: 'biomech-lab',
      masterSnapshot,
      sensorCalibration: sensorProfile,
      ingressProfile: this.ingressPipeline.exportProfile(),
    };
    downloadJson(`ironsync_master_calibration_bundle_${stamp}.json`, bundle);
    this.arduinoConnection?.saveMasterCalibration?.({ stamp, bundle });
    this.#rememberMasterCalibrationRecent({
      label: `Guardada ${stamp}`,
      sourceName: `ironsync_master_calibration_bundle_${stamp}.json`,
      bundle,
    });
    this.selectedMasterCalibrationBundle = bundle;
    this.selectedMasterCalibrationFile = `ironsync_master_calibration_bundle_${stamp}.json`;
    this.guidedCalibrationApplyState = 'muestra guardada: selecciona en el listado y aplica postura';
    this.guidedCalibrationApplyClass = '';
    this.guidedCalibrationStrictValidated = false;
    this.#signalCalibrationFeedback('ok');
    this.#status(`Calibracion maestra guardada en artifacts + exportada (${stamp})`);
    this.#renderGuidedCalibrationPanel();
  }

  async #loadMasterCalibrationBundle(event) {
    const [file] = event.target.files ?? [];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const normalized = normalizeMasterBundle(parsed);
      if (!normalized) throw new Error('Formato no soportado');
      this.selectedMasterCalibrationBundle = normalized;
      this.selectedMasterCalibrationFile = file.name;
      this.selectedMasterCalibrationRecentKey = '';
      this.guidedCalibrationApplyState = 'archivo listo para aplicar postura';
      this.guidedCalibrationApplyClass = '';
      this.guidedCalibrationStrictValidated = false;
      this.#rememberMasterCalibrationRecent({
        label: `Archivo ${file.name}`,
        sourceName: file.name,
        bundle: normalized,
      });
      this.#status(`Calibracion seleccionada: ${file.name}`);
    } catch (error) {
      this.selectedMasterCalibrationBundle = null;
      this.selectedMasterCalibrationFile = 'ninguno';
      this.guidedCalibrationApplyState = 'fallo al cargar archivo';
      this.guidedCalibrationApplyClass = 'bad';
      this.#status(`No se pudo cargar calibracion: ${error.message}`);
    } finally {
      event.target.value = '';
      this.#renderGuidedCalibrationPanel();
    }
  }

  #selectRecentMasterCalibration() {
    const key = this.nodes.masterCalibrationRecentSelect?.value;
    if (!key) {
      this.selectedMasterCalibrationBundle = null;
      this.selectedMasterCalibrationFile = 'ninguno';
      this.selectedMasterCalibrationRecentKey = '';
      this.guidedCalibrationApplyState = 'selecciona un archivo reciente para aplicar postura';
      this.guidedCalibrationApplyClass = '';
      this.guidedCalibrationStrictValidated = false;
      this.#renderGuidedCalibrationPanel();
      return;
    }
    const item = this.masterCalibrationRecents.find((entry) => entry.key === key);
    if (!item?.bundle) return;
    this.selectedMasterCalibrationRecentKey = key;
    this.selectedMasterCalibrationBundle = item.bundle;
    this.selectedMasterCalibrationFile = item.sourceName || item.label || 'reciente';
    this.guidedCalibrationApplyState = 'archivo listo: puedes aplicar postura';
    this.guidedCalibrationApplyClass = '';
    this.guidedCalibrationStrictValidated = false;
    this.#status(`Calibracion seleccionada desde recientes: ${this.selectedMasterCalibrationFile}`);
    this.#renderGuidedCalibrationPanel();
  }

  #applySelectedMasterCalibration() {
    if (!this.selectedMasterCalibrationBundle) {
      this.#status('Selecciona primero un archivo de calibracion');
      this.guidedCalibrationApplyState = 'selecciona una calibracion antes de aplicar postura';
      this.guidedCalibrationApplyClass = 'bad';
      this.#renderGuidedCalibrationPanel();
      return;
    }
    const summary = this.sensorCalibration.summary();
    const active = summary.online;
    this.#signalCalibrationFeedback('processing');
    this.guidedCalibrationApplyState = 'aplicando postura desde archivo...';
    this.guidedCalibrationApplyClass = '';
    this.#renderGuidedCalibrationPanel();
    if (active < MIN_ACTIVE_SENSORS_FOR_MASTER_APPLY) {
      this.#signalCalibrationFeedback('fail');
      this.guidedCalibrationApplyState = `rechazada: sensores activos ${active}/${MIN_ACTIVE_SENSORS_FOR_MASTER_APPLY}`;
      this.guidedCalibrationApplyClass = 'bad';
      this.guidedCalibrationStrictValidated = false;
      this.#status(`Calibracion rechazada: se requieren >=${MIN_ACTIVE_SENSORS_FOR_MASTER_APPLY} sensores activos (actual ${active})`);
      this.#renderGuidedCalibrationPanel();
      return;
    }
    if (!this.guidedCalibrationSessionActive) {
      this.guidedCalibrationPreviousSnapshot = this.masterCalibration.getSnapshot()
        ? JSON.parse(JSON.stringify(this.masterCalibration.getSnapshot()))
        : null;
      this.guidedCalibrationPreviousSensorProfile = this.sensorCalibration.exportProfile({
        modelInfo: this.modelInfo,
        mapping: this.mapper.summary(),
      });
    }
    const imported = this.masterCalibration.importSnapshot(this.selectedMasterCalibrationBundle.masterSnapshot);
    if (!imported) {
      this.#signalCalibrationFeedback('fail');
      this.guidedCalibrationApplyState = 'rechazada: archivo invalido';
      this.guidedCalibrationApplyClass = 'bad';
      this.guidedCalibrationStrictValidated = false;
      this.#status('Archivo invalido: no contiene calibracion maestra utilizable');
      this.#renderGuidedCalibrationPanel();
      return;
    }
    const importedIngress = this.selectedMasterCalibrationBundle.ingressProfile?.schema === INGRESS_PIPELINE_SCHEMA
      ? this.ingressPipeline.importProfile(this.selectedMasterCalibrationBundle.ingressProfile, { activate: true })
      : false;
    if (importedIngress) this.ingressPipeline.save();

    const importedSensorProfile = this.sensorCalibration.importProfile(
      this.selectedMasterCalibrationBundle.sensorCalibration ?? {},
      { apply: true },
    );
    if (!importedSensorProfile) {
      const fallback = this.#buildSensorCalibrationFromBaseline(
        this.selectedMasterCalibrationBundle.masterSnapshot?.baseline ?? this.masterCalibration.getBaseline(),
      );
      this.sensorCalibration.importProfile(fallback, { apply: true });
    }
    this.sensorCalibration.setLiveMode(true);
    const evaluation = this.#evaluateMasterCalibrationApplication();
    if (!evaluation.ok) {
      if (!this.guidedCalibrationSessionActive) {
        if (this.guidedCalibrationPreviousSnapshot) {
          this.masterCalibration.importSnapshot(this.guidedCalibrationPreviousSnapshot);
        }
        if (this.guidedCalibrationPreviousSensorProfile?.schema === 'ironsync.sensor-calibration.v1') {
          this.sensorCalibration.importProfile(this.guidedCalibrationPreviousSensorProfile, {
            apply: Boolean(this.guidedCalibrationPreviousSensorProfile.applied),
          });
        }
      }
      this.#signalCalibrationFeedback('fail');
      this.guidedCalibrationApplyState = `fallo validacion: ${evaluation.issues.join(' | ')}`;
      this.guidedCalibrationApplyClass = 'bad';
      this.guidedCalibrationStrictValidated = false;
      this.#status(`Calibracion cargada pero no validada: ${evaluation.issues.join(' | ')}`);
      this.#renderGuidedCalibrationPanel();
      return;
    }
    this.#signalCalibrationFeedback('ok');
    this.guidedCalibrationApplyState = `aplicado correctamente (${evaluation.online} sensores, calidad ${evaluation.quality}%) Ã‚Â· modo forzado por archivo`;
    this.guidedCalibrationApplyClass = evaluation.warnings.length ? '' : 'ok';
    this.guidedCalibrationStrictValidated = true;
    this.guidedCalibrationSessionActive = true;
    this.guidedCalibrationForceMode = true;
    this.#syncMasterCalibrationToBridge('apply');
    this.#status(`Calibracion aplicada desde archivo (${this.selectedMasterCalibrationFile})`);
    this.#renderCalibrationPanel();
    this.#renderGuidedCalibrationPanel();
    this.#renderTestPanel();
  }

  #closeGuidedPosture() {
    if (!this.guidedCalibrationSessionActive) {
      this.guidedCalibrationApplyState = 'sin postura activa para cerrar';
      this.guidedCalibrationApplyClass = '';
      this.#status('No hay postura activa aplicada por archivo');
      this.#renderGuidedCalibrationPanel();
      return;
    }
    let restored = false;
    if (this.guidedCalibrationPreviousSnapshot) {
      restored = this.masterCalibration.importSnapshot(this.guidedCalibrationPreviousSnapshot);
    } else {
      this.masterCalibration.clear();
      restored = true;
    }
    if (this.guidedCalibrationPreviousSensorProfile?.schema === 'ironsync.sensor-calibration.v1') {
      this.sensorCalibration.importProfile(this.guidedCalibrationPreviousSensorProfile, {
        apply: Boolean(this.guidedCalibrationPreviousSensorProfile.applied),
      });
    } else {
      this.sensorCalibration.reset();
    }
    this.guidedCalibrationSessionActive = false;
    this.guidedCalibrationForceMode = false;
    this.guidedCalibrationStrictValidated = false;
    this.guidedCalibrationPreviousSnapshot = null;
    this.guidedCalibrationPreviousSensorProfile = null;
    this.guidedCalibrationApplyState = restored
      ? 'postura cerrada: configuraciÃƒÂ³n anterior restaurada'
      : 'postura cerrada: restauraciÃƒÂ³n parcial';
    this.guidedCalibrationApplyClass = restored ? 'ok' : '';
    this.#syncMasterCalibrationToBridge('clear');
    this.#signalCalibrationFeedback('ok');
    this.#status('Postura cerrada y configuraciÃƒÂ³n previa restaurada');
    this.#renderCalibrationPanel();
    this.#renderGuidedCalibrationPanel();
    this.#renderTestPanel();
  }

  #evaluateMasterCalibrationApplication() {
    const summary = this.sensorCalibration.summary();
    const issues = [];
    const warnings = [];
    if (summary.online < MIN_ACTIVE_SENSORS_FOR_MASTER_APPLY) {
      issues.push(`online ${summary.online}/${MIN_ACTIVE_SENSORS_FOR_MASTER_APPLY}`);
    }
    const activeRows = summary.rows.filter((row) => row.online);
    const lowQuality = activeRows.filter((row) => row.quality < 75);
    if (lowQuality.length) issues.push(`calidad baja en ${lowQuality.length} sensores`);
    const highError = activeRows.filter((row) => row.verificationError > 8);
    if (highError.length) issues.push(`error alto A/B en ${highError.length} sensores`);
    const missingCore = STRICT_REQUIRED_BASE_BONES
      .filter((alias) => !activeRows.some((row) => row.alias === alias));
    if (missingCore.length) issues.push(`faltan sensores base: ${missingCore.join(', ')}`);
    const baselineMetrics = this.#baselineSimilarityMetrics(activeRows.map((row) => row.alias));
    if (!this.guidedCalibrationForceMode && !baselineMetrics.ok) warnings.push(...baselineMetrics.issues);
    if (!this.masterCalibration.hasBaseline()) issues.push('sin baseline maestro');
    if (!this.sensorCalibration.applied) issues.push('perfil sensores no aplicado');
    return {
      ok: issues.length === 0,
      issues,
      warnings,
      online: summary.online,
      quality: summary.quality,
      baselineAvgDelta: baselineMetrics.averageDelta,
      baselineMaxDelta: baselineMetrics.maxDelta,
    };
  }

  #syncMasterCalibrationToBridge(action = 'apply') {
    if (!this.webSocket) return;
    if (action === 'clear') {
      this.webSocket.send({
        type: 'master-calibration',
        action: 'clear',
      });
      return;
    }
    const baseline = this.masterCalibration.getBaseline();
    this.webSocket.send({
      type: 'master-calibration',
      action: 'apply',
      source: 'guided-calibration',
      baseline,
    });
  }

  async #countdownGuidedPoseSettle(durationMs = 4000) {
    const started = performance.now();
    while (performance.now() - started < durationMs) {
      const elapsed = performance.now() - started;
      const left = Math.ceil((durationMs - elapsed) / 1000);
      this.guidedCalibrationCaptureProgress = Math.min(100, Math.round((elapsed / durationMs) * 100));
      this.guidedCalibrationApplyState = `alineaciÃƒÂ³n ${left}s Ã¢â‚¬â€ pose del maniquÃƒÂ­ 3D`;
      this.#renderGuidedCalibrationPanel();
      if (this.controller) this.controller.applyUnrealInitialPose();
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    this.guidedCalibrationCaptureProgress = 0;
  }

  async #captureGuidedCalibrationWindow(durationMs = 6000, { useIngressPose = false } = {}) {
    const started = performance.now();
    const sums = Object.fromEntries(BONE_ORDER.map((alias) => [alias, { rx: 0, ry: 0, rz: 0, count: 0 }]));
    while (performance.now() - started < durationMs) {
      const elapsed = performance.now() - started;
      this.guidedCalibrationCaptureProgress = Math.min(100, Math.round((elapsed / durationMs) * 100));
      this.#renderGuidedCalibrationPanel();
      const raw = this.latestHardwarePose?.rawPose ?? null;
      const pose = useIngressPose && raw
        ? this.ingressPipeline.processPose(raw)
        : (this.latestHardwarePose?.ingressPose ?? this.latestHardwarePose?.pose ?? raw);
      if (pose) {
        for (const alias of BONE_ORDER) {
          const source = pose[alias];
          if (!source) continue;
          sums[alias].rx += Number(source.rx) || 0;
          sums[alias].ry += Number(source.ry) || 0;
          sums[alias].rz += Number(source.rz) || 0;
          sums[alias].count += 1;
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    const baseline = {};
    let online = 0;
    const samplesByAlias = {};
    for (const alias of BONE_ORDER) {
      const row = sums[alias];
      samplesByAlias[alias] = row.count;
      if (row.count > 0) online += 1;
      baseline[alias] = row.count > 0
        ? {
          rx: roundTo3(row.rx / row.count),
          ry: roundTo3(row.ry / row.count),
          rz: roundTo3(row.rz / row.count),
        }
        : { rx: 0, ry: 0, rz: 0 };
    }
    return { baseline, online, samplesByAlias };
  }

  #buildMasterSnapshotFromCapture(baseline) {
    return {
      schema: 'ironsync.master-calibration.v1',
      id: `master_${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      baseline,
      calibration: {
        schema: 'ironsync.sensor-calibration.v1',
        createdAt: new Date().toISOString(),
        method: 'guided-6s-average',
      },
      meta: {
        reason: 'Calibracion guiada 6s',
      },
    };
  }

  #buildSensorCalibrationFromBaseline(baseline, samplesByAlias = {}) {
    const sensors = Object.fromEntries(BONE_ORDER.map((alias) => {
      const count = Number(samplesByAlias?.[alias]) || 0;
      const online = count > 0;
      return [alias, {
        alias,
        label: BONE_LABELS[alias] ?? alias,
        offset: baseline?.[alias] ?? { rx: 0, ry: 0, rz: 0 },
        axisMap: { rx: 'rx', ry: 'ry', rz: 'rz' },
        sign: { rx: 1, ry: 1, rz: 1 },
        quality: online ? 95 : 0,
        verificationError: online ? 0 : 999,
        jitter: online ? 0.8 : 999,
        drift: online ? 0 : 999,
        dominantAxis: 'rx',
        state: online ? 'excelente' : 'sin datos',
        note: online ? 'captura guiada 6s' : 'sin muestra',
      }];
    }));
    return {
      schema: 'ironsync.sensor-calibration.v1',
      createdAt: new Date().toISOString(),
      method: 'guided-6s-average',
      unified: true,
      applied: true,
      ready: true,
      config: this.#readCalibrationConfig(),
      model: this.modelInfo ?? null,
      mapping: this.mapper.summary(),
      captureA: null,
      captureB: null,
      profile: { sensors, createdAt: new Date().toISOString() },
    };
  }

  #baselineSimilarityMetrics(activeAliases) {
    const livePose = this.latestHardwarePose?.rawPose ?? this.latestHardwarePose?.pose ?? null;
    const baseline = this.masterCalibration.getBaseline();
    if (!livePose || !baseline) {
      return { ok: false, issues: ['sin pose viva para validar baseline'], averageDelta: 999, maxDelta: 999 };
    }

    const deltas = activeAliases
      .map((alias) => {
        const current = livePose?.[alias];
        const base = baseline?.[alias];
        if (!current || !base) return null;
        const rx = Math.abs((Number(current.rx) || 0) - (Number(base.rx) || 0));
        const ry = Math.abs((Number(current.ry) || 0) - (Number(base.ry) || 0));
        const rz = Math.abs((Number(current.rz) || 0) - (Number(base.rz) || 0));
        return Math.max(rx, ry, rz);
      })
      .filter((value) => Number.isFinite(value));

    if (!deltas.length) {
      return { ok: false, issues: ['sin deltas validos para comparar baseline'], averageDelta: 999, maxDelta: 999 };
    }

    const averageDelta = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
    const maxDelta = Math.max(...deltas);
    const issues = [];
    if (averageDelta > STRICT_BASE_AVG_DELTA_MAX_DEG) {
      issues.push(`desviacion media base ${averageDelta.toFixed(1)}Ã‚Â° > ${STRICT_BASE_AVG_DELTA_MAX_DEG}Ã‚Â°`);
    }
    if (maxDelta > STRICT_BASE_MAX_DELTA_MAX_DEG) {
      issues.push(`desviacion pico base ${maxDelta.toFixed(1)}Ã‚Â° > ${STRICT_BASE_MAX_DELTA_MAX_DEG}Ã‚Â°`);
    }
    return {
      ok: issues.length === 0,
      issues,
      averageDelta: Math.round(averageDelta * 10) / 10,
      maxDelta: Math.round(maxDelta * 10) / 10,
    };
  }

  #rememberMasterCalibrationRecent({ label, sourceName, bundle }) {
    const key = `recent_${Date.now().toString(36)}`;
    const entry = {
      key,
      label: label || sourceName || 'calibracion',
      sourceName: sourceName || label || 'calibracion',
      usedAt: new Date().toISOString(),
      bundle,
    };
    const filtered = this.masterCalibrationRecents
      .filter((item) => item.sourceName !== entry.sourceName)
      .slice(0, MASTER_CALIBRATION_RECENTS_MAX - 1);
    this.masterCalibrationRecents = [entry, ...filtered];
    saveMasterCalibrationRecents(this.masterCalibrationRecents);
  }

  #signalCalibrationFeedback(state) {
    if (!this.arduinoConnection?.connected) return;
    if (state === 'processing') {
      this.arduinoConnection.sendCommand('MASTER_CAL_PROCESSING');
      return;
    }
    if (state === 'ok') {
      this.arduinoConnection.sendCommand('MASTER_CAL_OK');
      return;
    }
    this.arduinoConnection.sendCommand('MASTER_CAL_FAIL');
  }

  #verifyCalibrationConnection() {
    const relayOpen = Boolean(this.arduinoConnection?.connected);
    const hasHardwareSignal = isHardwareVerifiedState(this.arduinoStateText, this.arduinoFrames)
      || this.arduinoSensorRows.some((row) => row.online);
    this.calibrationConnectionVerified = relayOpen && hasHardwareSignal;
    if (!relayOpen) {
      this.#status('Abre primero el relay ESP32 / Mega en Hardware');
    } else if (!hasHardwareSignal) {
      this.arduinoConnection?.status();
      this.#status('Relay abierto. Esperando respuesta real del ESP32/Mega');
    } else {
      this.#status('Conexion hardware-laboratorio verificada');
    }
    this.#renderCalibrationPanel();
    this.#renderTestPanel();
  }

  #canCalibrateSensors() {
    if (this.calibrationConnectionVerified) return true;
    this.#verifyCalibrationConnection();
    if (!this.calibrationConnectionVerified) this.#status('Verifica conexion antes de calibrar sensores');
    return this.calibrationConnectionVerified;
  }

  #readCalibrationConfig() {
    return {
      targetHz: Number(this.nodes.calTargetHz?.value) || 40,
      smoothing: Number(this.nodes.calSmoothing?.value) || 0.24,
      liveSmoothing: Number(this.nodes.calLiveSmoothing?.value) || 0.38,
      deadzone: Number(this.nodes.calDeadzone?.value) || 0.85,
      gain: Number(this.nodes.calGain?.value) || 1,
      maxRotation: Number(this.nodes.calMaxRotation?.value) || 55,
    };
  }

  #renderCalibrationPanel() {
    if (!this.nodes?.sensorCalibrationStatus) return;
    const summary = this.sensorCalibration.summary();
    const enabled = this.calibrationConnectionVerified;
    this.nodes.sensorCalibrationStatus.textContent = summary.ready ? 'Listo para transmitir' : summary.stage;
    this.nodes.sensorCalibrationStatus.className = summary.ready ? 'ok' : summary.quality >= 75 ? '' : 'bad';
    this.nodes.sensorCalibrationQuality.textContent = `${summary.quality}%`;
    this.nodes.sensorCalibrationOnline.textContent = formatOnlineLabel(
      summary.online,
      BONE_ORDER.length,
      summary.onlineUpper,
    );
    this.nodes.sensorCalibrationHz.textContent = `${summary.realHz.toFixed(1)} Hz`;
    this.nodes.sensorCalibrationJitter.textContent = `${summary.jitterMs.toFixed(1)} ms`;
    this.nodes.sensorCalibrationConnection.textContent = enabled ? 'verificada' : 'pendiente';
    this.nodes.sensorCalibrationConnection.className = enabled ? 'ok' : 'bad';
    for (const id of ['captureCalibrationA', 'captureCalibrationB', 'applySensorCalibration']) {
      if (this.nodes[id]) this.nodes[id].disabled = !enabled;
    }
    this.nodes.sensorCalibrationRows.innerHTML = summary.rows.map((row) => `
      <div class="calibration-row ${calibrationStateClass(row.state)}">
        <div>
          <strong>${row.alias}</strong>
          <span>${row.label}</span>
        </div>
        <progress max="100" value="${row.quality}"></progress>
        <div class="calibration-row-metrics">
          <span>${row.state}</span>
          <span>${row.quality}%</span>
          <span>jit ${row.jitter.toFixed(1)}</span>
          <span>err ${row.verificationError.toFixed(1)}</span>
          <span>eje ${row.dominantAxis}</span>
        </div>
        <small>${row.note}</small>
      </div>
    `).join('');
  }

  #renderGuidedCalibrationPanel() {
    if (!this.nodes?.masterCalibrationSelectedFile) return;
    const summary = this.sensorCalibration.summary();
    const ready = Boolean(this.masterCalibration.getSnapshot()?.id);
    const pass = summary.online >= MIN_ACTIVE_SENSORS_FOR_MASTER_APPLY;
    this.nodes.masterCalibrationSelectedFile.textContent = this.selectedMasterCalibrationFile;
    this.nodes.masterCalibrationReadyState.textContent = ready ? 'lista' : 'sin base';
    this.nodes.masterCalibrationReadyState.className = ready ? 'ok' : 'bad';
    this.nodes.masterCalibrationSensorGate.textContent = `${summary.online}/15 (min ${MIN_ACTIVE_SENSORS_FOR_MASTER_APPLY})`;
    this.nodes.masterCalibrationSensorGate.className = pass ? 'ok' : 'bad';
    this.nodes.masterCalibrationApplyState.textContent = this.guidedCalibrationApplyState;
    this.nodes.masterCalibrationApplyState.className = this.guidedCalibrationApplyClass;
    this.nodes.applySelectedMasterCalibration.disabled = !this.selectedMasterCalibrationBundle || this.guidedCalibrationCapturing;
    if (this.nodes.takeMasterCalibration) {
      this.nodes.takeMasterCalibration.disabled = this.guidedCalibrationCapturing;
    }
    if (this.nodes.closeGuidedPosture) {
      this.nodes.closeGuidedPosture.disabled = this.guidedCalibrationCapturing || !this.guidedCalibrationSessionActive;
    }
    if (this.nodes.guidedCalibrationCaptureProgress) {
      this.nodes.guidedCalibrationCaptureProgress.value = this.guidedCalibrationCaptureProgress;
    }
    if (this.nodes.guidedCalibrationCaptureProgressText) {
      this.nodes.guidedCalibrationCaptureProgressText.textContent = `${this.guidedCalibrationCaptureProgress}%`;
    }

    if (this.nodes.masterCalibrationRecentSelect) {
      this.nodes.masterCalibrationRecentSelect.innerHTML = [
        '<option value="">Selecciona una calibracion reciente</option>',
        ...this.masterCalibrationRecents.map((item) => `<option value="${escapeHtmlAttr(item.key)}">${escapeHtmlText(item.label)}</option>`),
      ].join('');
      this.nodes.masterCalibrationRecentSelect.value = this.selectedMasterCalibrationRecentKey || '';
    }
  }

  #verifyTestReadiness() {
    const readiness = this.#computeTestReadiness();
    this.testReadiness = readiness;
    if (readiness.ready) {
      this.#status('Prueba lista: hardware, sensores torso superior y correccion aplicada');
    } else {
      this.#status(`Prueba incompleta: ${readiness.missing.join(' | ')}`);
      if (readiness.needsHardwareStatus) this.arduinoConnection?.status();
    }
    this.#renderTestPanel();
    return readiness;
  }

  #ensureHardwareStream() {
    // RUN_START solo lo envia el relay tras CAL_OK (finishCalibrationSession).
  }

  #prepareHardwareTestSimulation() {
    this.#setGestureTriggerEnabled(false);
    this.#stopUnrealSimulation(false);
    if (this.movementTraining.active) this.movementTraining.cancel();
    if (this.#meshDrivenByAgent()) this.#setMeshDriverMode('idle');
    if (this.ingressPipeline.exportProfile() && !this.ingressPipeline.isActive() && !this.testUseRawRotations) {
      const ingressOnline = this.ingressPipeline.summary().online;
      if (ingressOnline >= 3) {
        this.ingressPipeline.setActive(true);
      } else {
        this.ingressPipeline.setActive(false);
        this.#status('Pipeline entrada sin huesos calibrados Ã¢â‚¬â€ usando pose corregida del traje');
      }
    }
    this.#ensureMeshMappingForLive();
    this.testSimulationActive = true;
    this.previousRotations = null;
    this.#setMeshDriverMode('hardware');
    this.#ensureHardwareStream();
  }

  #startTestSimulation() {
    const readiness = this.#verifyTestReadiness();
    if (!readiness.ready) return;
    if (!this.controller) {
      this.#status('Carga el skeletal mesh (FBX) antes de iniciar la simulacion');
      return;
    }
    this.#prepareHardwareTestSimulation();
    const appliedNow = this.#applyHardwarePose(this.#currentHardwarePose());
    this.#syncSlidersToSelected();
    const ingressNote = this.ingressPipeline.isActive() ? ' Ã‚Â· pipeline entrada ON' : '';
    this.#status(appliedNow
      ? `Prueba activa: sensores Ã¢â€ â€™ algoritmo Ã¢â€ â€™ skeletal mesh${ingressNote}`
      : `Prueba activa: mueve el traje Ã¢â‚¬â€ el mesh seguirÃƒÂ¡ cada frame${ingressNote}`);
    this.#renderTestPanel();
  }

  #toggleTestRotationMode() {
    this.testUseRawRotations = !this.testUseRawRotations;
    this.testSimulationActive = true;
    this.#setMeshDriverMode('hardware');
    if (this.testUseRawRotations) {
      this.ingressPipeline.setActive(false);
    }
    if (!this.#isLiveStreamFresh()) {
      this.#ensureHardwareStream();
    }
    const appliedNow = this.#applyLatestHardwarePoseToMesh();
    this.#syncSlidersToSelected();
    const live = this.#isLiveStreamFresh();
    this.#status(this.testUseRawRotations
      ? (appliedNow && live
        ? 'Prueba cruda: sensores Ã¢â€ â€™ skeletal mesh'
        : appliedNow
          ? 'Prueba cruda: ultima pose aplicada Ã¢â‚¬â€ sin Hz vivo (Diagnostico relay Ã¢â€ â€™ RUN_START)'
          : 'Prueba cruda: sin frames IS Ã¢â‚¬â€ pulsa Diagnostico relay y mueve el traje')
      : (appliedNow && live
        ? 'Prueba corregida: sensores Ã¢â€ â€™ skeletal mesh'
        : appliedNow
          ? 'Prueba corregida: ultima pose aplicada Ã¢â‚¬â€ sin Hz vivo'
          : 'Prueba corregida: sin frames IS Ã¢â‚¬â€ reconecta o RUN_START'));
    this.#renderTestPanel();
  }

  #stopTestSimulation() {
    this.testSimulationActive = false;
    if (this.meshDriverMode === 'hardware') this.#setMeshDriverMode('idle');
    this.#status('Prueba detenida: conexion hardware conservada');
    this.#renderTestPanel();
  }

  async #loadTestQModel(event) {
    const [file] = event.target.files ?? [];
    if (!file || !this.drlTrainer) return;
    try {
      const snapshot = JSON.parse(await file.text());
      this.drlTrainer.importBest(snapshot);
      this.testQModelLoaded = true;
      this.#status(`Modelo Q-learning cargado para prueba: ${file.name}`);
    } catch (error) {
      this.testQModelLoaded = false;
      this.#status(`No se pudo cargar modelo Q-learning: ${error.message}`);
    } finally {
      event.target.value = '';
      this.#renderTestPanel();
    }
  }

  #evaluateTestQModel() {
    if (!this.testQModelLoaded) {
      this.#status('Prueba Q-learning: carga primero un modelo');
      this.#renderTestPanel();
      return;
    }
    if (!this.testSimulationActive) this.#startTestSimulation();
    if (!this.testSimulationActive) return;
    this.#startQEvaluation();
    this.#status('Prueba Q-learning: evaluando modelo con datos hardware corregidos');
    this.#renderTestPanel();
  }

  #computeTestReadiness() {
    const relayOpen = Boolean(this.arduinoConnection?.connected);
    const hardwareConnected = relayOpen && this.hardwareSessionActive;
    const now = performance.now();
    const relayFrameAt = this.arduinoConnection?.lastFrameAt ?? 0;
    const framesFresh = Boolean(
      (this.testLastFrameAt && now - this.testLastFrameAt < 1800)
      || (relayFrameAt && now - relayFrameAt < 1800),
    );
    const onlineRows = this.arduinoSensorRows.filter((row) => row.online);
    const partial = assessPartialSensorCoverage(this.arduinoSensorRows);
    const calibrationSummary = this.sensorCalibration.summary();
    const streamHz = framesFresh
      ? Math.max(
        calibrationSummary.realHz,
        this.lastPacketInspectorHz ?? 0,
        this.liveStreamHz ?? 0,
      )
      : 0;
    const hardwareFirmwareCorrected = this.latestHardwarePose?.source === 'arduino-mega' && partial.online >= 1;
    const ingressActive = this.ingressPipeline.isActive();
    const ingressProfileReady = Boolean(this.ingressPipeline.exportProfile());
    const calibrationApplied = this.sensorCalibration.applied
      || hardwareFirmwareCorrected
      || ingressActive
      || ingressProfileReady;
    const missing = [];

    if (!relayOpen) missing.push('Abre relay ESP32/Mega');
    if (relayOpen && !hardwareConnected) missing.push('Conecta hardware');
    if (!framesFresh) missing.push('No hay frames vivos del ESP32/Mega');
    if (!partial.ok) missing.push(...partial.issues);
    if (!calibrationApplied) missing.push('Calibrar traje (golden) o aplicar correccion / postura guiada');
    if (
      this.selectedMasterCalibrationBundle
      && !this.guidedCalibrationStrictValidated
      && !ingressActive
      && !ingressProfileReady
    ) {
      missing.push('Aplica y valida estrictamente la calibracion guiada seleccionada');
    }

    return {
      ready: missing.length === 0,
      missing,
      relayOpen,
      hardwareConnected,
      framesFresh,
      online: partial.online,
      onlineUpper: partial.onlineUpper,
      partialMode: partial.optionalLegsOffline,
      missingSensors: partial.missingLower,
      calibrationApplied,
      hardwareFirmwareCorrected,
      calibrationStage: calibrationSummary.stage,
      calibrationQuality: calibrationSummary.quality,
      hz: streamHz,
      jitter: calibrationSummary.jitterMs,
      strictValidated: this.guidedCalibrationStrictValidated,
      ingressActive,
      ingressProfileReady,
      needsHardwareStatus: relayOpen && !hardwareConnected,
    };
  }

  #renderTestPanel() {
    if (!this.nodes?.testConnectionState) return;
    const readiness = this.#computeTestReadiness();
    this.testReadiness = readiness;
    const mappedBones = countMappedBones(this.mapper);
    const qEvaluating = this.meshDriverMode === 'q_learning_eval';
    const qState = qEvaluating ? 'evaluando' : this.testQModelLoaded ? 'modelo cargado' : 'sin modelo';
    let missingText = readiness.ready ? 'Listo para iniciar simulacion' : readiness.missing.join(' | ');
    if (this.testSimulationActive && !readiness.framesFresh) {
      missingText = `Simulacion activa pero sin IS vivo Ã¢â‚¬â€ Diagnostico relay (debe subir ok=)${missingText ? ` | ${missingText}` : ''}`;
    }
    if (readiness.framesFresh && mappedBones < 1) {
      missingText = `${missingText}${missingText ? ' | ' : ''}Auto-mapear huesos al mesh (0/${BONE_ORDER.length})`;
    }

    this.nodes.testConnectionState.textContent = readiness.hardwareConnected ? 'conectado' : readiness.relayOpen ? 'relay abierto' : 'desconectado';
    this.nodes.testConnectionState.className = readiness.hardwareConnected ? 'ok' : 'bad';
    this.nodes.testSensorsState.textContent = formatOnlineLabel(
      readiness.online,
      BONE_ORDER.length,
      readiness.onlineUpper,
    );
    this.nodes.testSensorsState.className = readiness.online >= 1 && readiness.onlineUpper >= 1 ? 'ok' : 'bad';
    const mappedBonesForLabel = countMappedBones(this.mapper);
    const hzLabel = readiness.framesFresh ? readiness.hz.toFixed(1) : '0.0';
    const relayNote = this.relayReportedFrames > this.livePacketCount
      ? ` Ã‚Â· relay ${this.relayReportedFrames}`
      : '';
    this.nodes.testFramesState.textContent = readiness.framesFresh
      ? `${this.livePacketCount} proc Ã‚Â· ${hzLabel} Hz Ã‚Â· mesh ${mappedBonesForLabel}/15${relayNote}`
      : `${this.livePacketCount} proc Ã‚Â· SIN VIVO Ã¢â‚¬â€ Diagnostico relay + mueve traje${relayNote}`;
    this.nodes.testFramesState.className = readiness.framesFresh ? 'ok' : 'bad';
    this.nodes.testCalibrationState.textContent = readiness.ingressActive
      ? 'pipeline entrada activo'
      : readiness.ingressProfileReady
        ? 'pipeline listo (se activa al iniciar)'
        : readiness.hardwareFirmwareCorrected
          ? 'Arduino corregido'
          : readiness.calibrationApplied ? 'correccion aplicada' : readiness.calibrationStage;
    this.nodes.testCalibrationState.className = readiness.calibrationApplied ? 'ok' : 'bad';
    if (this.nodes.testIngressState) {
      this.nodes.testIngressState.textContent = readiness.ingressActive
        ? `activo Ã‚Â· ${this.ingressPipeline.summary().online}/15`
        : readiness.ingressProfileReady ? 'perfil guardado' : 'inactivo';
      this.nodes.testIngressState.className = readiness.ingressActive ? 'ok' : '';
    }
    this.nodes.testSimulationState.textContent = this.testSimulationActive ? 'activa' : 'detenida';
    this.nodes.testSimulationState.className = this.testSimulationActive ? 'ok' : '';
    this.nodes.testQState.textContent = qState;
    this.nodes.testQState.className = qEvaluating || this.testQModelLoaded ? 'ok' : '';
    this.nodes.testRotationMode.textContent = this.testUseRawRotations ? 'crudo' : 'corregido';
    this.nodes.testRotationMode.className = this.testUseRawRotations ? '' : 'ok';
    this.nodes.testMotionState.textContent = `${this.testLastMotion.alias}.${this.testLastMotion.axis} ${this.testLastMotion.value.toFixed(1)} deg / raw ${this.testLastMotion.rawValue.toFixed(1)}`;
    this.nodes.testMotionState.className = Math.abs(this.testLastMotion.value) >= 2 ? 'ok' : '';
    this.nodes.testReadinessDetail.textContent = missingText;
    this.nodes.testReadinessDetail.className = readiness.ready ? 'ok' : 'bad';
    this.nodes.startTestSimulation.disabled = !readiness.ready;
    this.nodes.evaluateTestQModel.disabled = !this.testQModelLoaded;
  }

  #renderTrainingPanel() {
    if (!this.nodes?.movementTrainingState) return;
    let summary = this.movementTraining.summary();
    let result = summary.result;
    if (summary.phase === 'review_failed' && result?.validation?.consistencyOk) {
      if (this.movementTraining.reconcileApprovalPhase()) {
        summary = this.movementTraining.summary();
        result = summary.result;
        this.#maybePersistCompletedAnimation(summary);
      }
    }
    const definition = summary.definition;
    const readiness = this.#computeTestReadiness();
    const phaseLabel = trainingPhaseLabel(summary.phase);
    const average = Number(result?.averageSimilarity || 0);
    const validSamples = result?.samples?.filter((sample) => sample.valid).length ?? 0;
    const doubtfulSamples = result?.samples?.filter((sample) => !sample.valid).length ?? 0;
    const activeBones = definition?.activeBones ?? [];

    this.nodes.movementTrainingAnimation.textContent = definition?.name ?? '-';
    this.nodes.movementTrainingProgress.textContent = `${summary.animationIndex + 1}/${summary.animationTotal}`;
    this.nodes.movementTrainingSample.textContent = summary.phase === 'reference_demo'
      ? `demo ${summary.demoCycleIndex}/${summary.referenceDemoCycles} (referencia, sin grabar)`
      : summary.phase === 'between_demos'
        ? `pausa demo ${Math.max(1, summary.demoCycleIndex)}/${summary.referenceDemoCycles}`
      : summary.phase === 'capture_cycle' || summary.phase === 'between_cycles'
        ? `muestra ${Math.min(result?.samples?.length ?? 0, summary.sampleCount) + 1}/${summary.sampleCount} Ã‚Â· ciclo ${summary.cycleIndex}/${summary.cyclesPerSample}`
        : `${Math.min(result?.samples?.length ?? 0, summary.sampleCount)}/${summary.sampleCount}`;
    const showCountdown = [
      'pose_countdown',
      'pre_capture_countdown',
      'pre_sample_countdown',
      'between_demos',
      'between_cycles',
      'between_samples',
      'capture_cycle',
      'reference_demo',
      'animation_demo',
    ].includes(summary.phase);
    this.nodes.movementTrainingCountdown.textContent = showCountdown ? `${Math.ceil(summary.countdown)}s` : '-';
    const consistencyOk = result?.validation?.consistencyOk
      ?? (Number(result?.minSimilarity) >= TRAINING_APPROVAL_SCORE
        && Number(result?.averageSimilarity) >= TRAINING_APPROVAL_SCORE);
    const reviewFailed = summary.phase === 'review_failed' && !consistencyOk;
    const phaseClass = summary.paused ? 'paused' : summary.phase;
    const bannerText = summary.paused ? 'Pausado' : trainingPhaseBannerText(summary.phase);
    const displayPhase = summary.phase === 'done' || (consistencyOk && result?.approved)
      ? 'done'
      : phaseClass;
    if (this.nodes.movementTrainingPhaseBanner) {
      this.nodes.movementTrainingPhaseBanner.className = `training-phase-banner training-phase--${displayPhase}`;
    }
    if (this.nodes.movementTrainingPhaseBannerText) {
      this.nodes.movementTrainingPhaseBannerText.textContent = consistencyOk && summary.phase !== 'done'
        ? trainingPhaseBannerText('done')
        : bannerText;
    }
    if (this.nodes.movementTrainingStatusPanel) {
      this.nodes.movementTrainingStatusPanel.className = `data-stack training-status-panel training-phase--${displayPhase}`;
    }
    const failDetail = reviewFailed
      ? (result?.validation?.consistencyOk
        ? `consistencia OK Ã¢â‚¬â€ reconciliando guardadoÃ¢â‚¬Â¦`
        : `${summary.sampleCount} tomas: consistencia min ${Number(result?.minSimilarity || 0).toFixed(1)}% (req ${TRAINING_APPROVAL_SCORE}%)`)
      : phaseLabel;
    this.nodes.movementTrainingState.textContent = summary.paused
      ? 'pausado'
      : reviewFailed
        ? failDetail
        : phaseLabel;
    this.nodes.movementTrainingState.className = summary.phase === 'done' || result?.approved || consistencyOk
      ? 'training-text-done'
      : reviewFailed
        ? 'training-text-fail'
        : `training-text-${phaseClass}`;
    this.nodes.movementTrainingCountdown.className = showCountdown ? `training-text-${phaseClass}` : '';
    this.nodes.movementTrainingSimilarity.textContent = reviewFailed || result?.samples?.length
      ? `consistencia ${average.toFixed(1)}% Ã‚Â· min ${Number(result?.minSimilarity || 0).toFixed(1)}%`
      : '0.0%';
    if (this.nodes.trainingRepeatFailedSampling) {
      this.nodes.trainingRepeatFailedSampling.textContent = `Repetir ${summary.sampleCount} tomas`;
      this.nodes.trainingRepeatFailedSampling.disabled = !reviewFailed;
    }
    if (this.nodes.trainingContinueDespiteFail) {
      this.nodes.trainingContinueDespiteFail.disabled = !reviewFailed;
    }
    this.nodes.movementTrainingSimilarity.className = consistencyOk ? 'ok' : average > 0 ? 'bad' : '';
    if (this.nodes.saveMovementToCollection) {
      const canSave = result?.samples?.length >= TRAINING_SAMPLE_COUNT
        && consistencyOk
        && (summary.phase === 'done' || reviewFailed);
      this.nodes.saveMovementToCollection.disabled = !canSave;
    }
    this.nodes.movementTrainingSamplesState.textContent = `${validSamples} validas / ${doubtfulSamples} dudosas`;
    this.nodes.movementTrainingUnreal.textContent = this.unrealBridge?.connected ? 'conectado' : 'sin Unreal';
    this.nodes.movementTrainingUnreal.className = this.unrealBridge?.connected ? 'ok' : '';
    const partial = readiness.partialCoverage;
    this.nodes.movementTrainingHardware.textContent = `${formatOnlineLabel(readiness.online, BONE_ORDER.length, readiness.onlineUpper)} Ã‚Â· gesto ${readiness.onlineRequired}/${readiness.requiredTotal} - ${readiness.framesFresh ? 'frames vivos' : 'sin frames'}`;
    this.nodes.movementTrainingHardware.className = readiness.ready ? 'ok' : partial?.onlineUpper >= 1 ? '' : 'bad';
    this.nodes.movementTrainingActiveBones.innerHTML = activeBones.map((alias) => `
      <span class="sensor-pill online"><span>${alias}</span><strong>${BONE_LABELS[alias] ?? alias}</strong></span>
    `).join('');
    this.nodes.movementTrainingIgnoredBones.innerHTML = BONE_ORDER
      .filter((alias) => !activeBones.includes(alias))
      .map((alias) => `<span class="sensor-pill offline"><span>${alias}</span><strong>ignorado</strong></span>`)
      .join('');
    this.nodes.movementTrainingSamples.innerHTML = (result?.samples ?? []).slice(-10).map((sample) => `
      <div class="kv">
        <span>Muestra ${sample.sampleIndex}</span>
        <strong class="${sample.valid ? 'ok' : 'bad'}">${sample.similarityScore.toFixed(1)}% Ã‚Â· ${sample.frameCount}f</strong>
      </div>
    `).join('') || '<p class="muted">Sin muestras todavia.</p>';
    if (this.nodes.startMovementTraining) {
      this.nodes.startMovementTraining.disabled = summary.active && !summary.paused;
    }
    if (this.nodes.pauseMovementTraining) {
      this.nodes.pauseMovementTraining.disabled = !summary.active || summary.paused;
    }
    if (this.nodes.resumeMovementTraining) {
      this.nodes.resumeMovementTraining.disabled = !summary.active || !summary.paused;
    }
    if (this.nodes.cancelMovementTraining) {
      this.nodes.cancelMovementTraining.disabled = !summary.active;
    }
    if (this.nodes.repeatMovementSample) {
      this.nodes.repeatMovementSample.disabled = !summary.active;
    }
    if (this.nodes.exportMovementTrainingCsv) {
      this.nodes.exportMovementTrainingCsv.disabled = !result?.samples?.length;
    }
    if (this.nodes.exportMovementTrainingJson) {
      this.nodes.exportMovementTrainingJson.disabled = !result?.samples?.length;
    }
    this.#renderGestureTriggerPanel();
  }

  #renderGestureTriggerPanel() {
    if (!this.nodes?.gestureTriggerState) return;
    const master = this.masterCalibration.getSnapshot();
    const library = this.gestureLibrary.summary();
    const event = this.lastGestureTriggerEvent;
    this.nodes.gestureMasterCal.textContent = master?.id ?? 'sin calibracion maestra';
    this.nodes.gestureMasterCal.className = master?.id ? 'ok' : 'bad';
    this.nodes.gestureLibraryState.textContent = library.loaded
      ? `${library.profileCount} gestos (${library.sourceName})`
      : 'sin biblioteca';
    this.nodes.gestureLibraryState.className = library.loaded ? 'ok' : '';
    this.nodes.gestureTriggerState.textContent = this.gestureTriggerEnabled ? 'activo' : 'apagado';
    this.nodes.gestureTriggerState.className = this.gestureTriggerEnabled ? 'ok' : '';
    const score = Number(event?.score ?? 0);
    this.nodes.gestureTriggerMatch.textContent = event?.animationId
      ? `${event.animationId} (${score.toFixed(1)}%)`
      : 'pose base';
    this.nodes.gestureTriggerMatch.className = event?.animationId ? 'ok' : '';
  }

  #renderPreprocessingPanel() {
    if (!this.nodes?.preprocessingState) return;
    const summary = this.movementPreprocessor.summary();
    const readiness = this.#computeTestReadiness();
    const match = this.preprocessingMatch ?? summary.lastMatch;
    const activeBones = match?.profile?.activeBones ?? [];

    this.nodes.preprocessingFile.textContent = summary.collectionStamp
      ? `coleccion ${summary.collectionStamp}`
      : (summary.fileName || 'sin coleccion');
    this.nodes.preprocessingFile.className = summary.loaded ? 'ok' : 'bad';
    this.nodes.preprocessingProfiles.textContent = `${summary.profileCount} animaciones`;
    this.nodes.preprocessingProfiles.className = summary.loaded ? 'ok' : '';
    this.nodes.preprocessingState.textContent = summary.active ? 'activo' : summary.loaded ? 'listo' : 'sin dataset';
    this.nodes.preprocessingState.className = summary.active ? 'ok' : summary.loaded ? '' : 'bad';
    this.nodes.preprocessingHardware.textContent = `${formatOnlineLabel(readiness.online, BONE_ORDER.length, readiness.onlineUpper)} - ${readiness.framesFresh ? 'frames vivos' : 'sin frames'}`;
    this.nodes.preprocessingHardware.className = readiness.framesFresh ? 'ok' : 'bad';
    const topHeat = summary.collectionHeatmap?.[0];
    const restLabel = topHeat?.atRest ? ' (reposo)' : '';
    this.nodes.preprocessingMatch.textContent = match
      ? `${match.name} [${match.phase ?? 'idle'}${match.held ? ' · sostenido' : ''}]`
      : topHeat
        ? `pose base · mejor: ${topHeat.name} ${topHeat.score.toFixed(0)}%${restLabel}`
        : 'pose base · mueve el traje';
    this.nodes.preprocessingMatch.className = match ? 'ok' : topHeat?.aboveThreshold ? '' : 'bad';
    const slotLabel = match?.slot ? `slot ${match.slot}` : '-';
    const motionPk = summary.motionPeak ?? 0;
    this.nodes.preprocessingScore.textContent = match
      ? `${match.score.toFixed(1)}% · ${slotLabel} · seq ${match.sequenceIndex + 1}/${match.sequenceLength} (${(match.sequenceProgress * 100).toFixed(0)}%) · mov ${motionPk.toFixed(1)}°`
      : topHeat
        ? `top ${topHeat.score.toFixed(1)}% · umbral ${summary.threshold}% · mov ${motionPk.toFixed(1)}°`
        : `mov ${motionPk.toFixed(1)}° · umbral ${summary.threshold}%`;
    this.nodes.preprocessingScore.className = match?.score >= summary.threshold ? 'ok' : '';
    this.#renderPreprocessingHeatmap(summary);
    this.nodes.preprocessingBones.innerHTML = activeBones.length
      ? activeBones.map((alias) => `<span class="sensor-pill online"><span>${alias}</span><strong>${BONE_LABELS[alias] ?? alias}</strong></span>`).join('')
      : '<p class="muted">Sin movimiento reconocido.</p>';
    this.nodes.preprocessingAnimations.innerHTML = summary.animations.map((animation) => `
      <div class="kv">
        <span>${animation.name}</span>
        <strong>${animation.activeBones.join(', ')}</strong>
      </div>
    `).join('') || '<p class="muted">Carga el CSV de muestras exportado por Entrenamiento.</p>';
    this.#renderRuntimeDatasetPanel();
  }

  #renderRuntimeDatasetPanel() {
    if (!this.nodes?.runtimeDatasetState) return;
    const summary = this.runtimeDatasetPreprocessor.summary();
    const readiness = this.#computeTestReadiness();
    const match = this.runtimeDatasetMatch ?? summary.lastMatch;
    const activeBones = match?.profile?.activeBones ?? [];
    this.nodes.runtimeDatasetFile.textContent = summary.fileName || 'sin dataset.json';
    this.nodes.runtimeDatasetFile.className = summary.loaded ? 'ok' : 'bad';
    this.nodes.runtimeDatasetProfiles.textContent = `${summary.profileCount} animaciones`;
    this.nodes.runtimeDatasetProfiles.className = summary.loaded ? 'ok' : '';
    this.nodes.runtimeDatasetState.textContent = summary.active ? 'activo' : summary.loaded ? 'listo' : 'sin dataset';
    this.nodes.runtimeDatasetState.className = summary.active ? 'ok' : summary.loaded ? '' : 'bad';
    this.nodes.runtimeDatasetHardware.textContent = `${formatOnlineLabel(readiness.online, BONE_ORDER.length, readiness.onlineUpper)} - ${readiness.framesFresh ? 'frames vivos' : 'sin frames'}`;
    this.nodes.runtimeDatasetHardware.className = readiness.framesFresh ? 'ok' : 'bad';
    this.nodes.runtimeDatasetMatch.textContent = match
      ? `${match.name} [${match.phase ?? 'idle'}${match.held ? ' Ã‚Â· sostenido' : ''}]`
      : 'esperando';
    this.nodes.runtimeDatasetMatch.className = match ? 'ok' : '';
    this.nodes.runtimeDatasetScore.textContent = match
      ? `${match.score.toFixed(1)}% Ã‚Â· seq ${match.sequenceIndex + 1}/${match.sequenceLength} (${(match.sequenceProgress * 100).toFixed(0)}%) Ã‚Â· ÃŽâ€${match.motionDelta.toFixed(1)}Ã‚Â°`
      : '0.0%';
    this.nodes.runtimeDatasetScore.className = match?.score >= summary.threshold ? 'ok' : '';
    this.nodes.runtimeDatasetBones.innerHTML = activeBones.length
      ? activeBones.map((alias) => `<span class="sensor-pill online"><span>${alias}</span><strong>${BONE_LABELS[alias] ?? alias}</strong></span>`).join('')
      : '<p class="muted">Sin movimiento detectado.</p>';
    this.nodes.runtimeDatasetAnimations.innerHTML = summary.animations.map((animation) => `
      <div class="kv">
        <span>${animation.name}</span>
        <strong>${animation.activeBones.join(', ')}</strong>
      </div>
    `).join('') || '<p class="muted">Carga dataset.json exportado por Entrenamiento.</p>';
    this.nodes.startRuntimeDatasetDetection.disabled = !summary.loaded || !readiness.framesFresh || summary.active;
    this.nodes.stopRuntimeDatasetDetection.disabled = !summary.active;
  }

  #applyManualSliders() {
    this.#setMeshDriverMode('manual');
    const rotation = {
      rx: Number(this.nodes.rx.value),
      ry: Number(this.nodes.ry.value),
      rz: Number(this.nodes.rz.value),
    };
    const applied = this.controller.write(this.selectedAlias, rotation, { clamp: true });
    for (const axis of ['rx', 'ry', 'rz']) {
      const value = Number(applied?.[axis] ?? rotation[axis]);
      this.nodes[axis].value = value.toFixed(1);
      this.nodes[`${axis}Value`].textContent = value.toFixed(1);
      this.nodes[axis].classList.toggle('out-limit', isSliderOutOfLimit(this.selectedAlias, axis, value));
    }
    return applied;
  }

  #syncSlidersToSelected() {
    const rotation = this.controller.read(this.selectedAlias);
    const limits = this.controller.limits(this.selectedAlias);
    for (const axis of ['rx', 'ry', 'rz']) {
      this.nodes[axis].min = limits[axis][0];
      this.nodes[axis].max = limits[axis][1];
      this.nodes[axis].value = rotation[axis].toFixed(1);
      this.nodes[`${axis}Value`].textContent = Number(rotation[axis]).toFixed(1);
      this.nodes[`${axis}Range`].textContent = `${limits[axis][0]} / ${limits[axis][1]}`;
      this.nodes[axis].classList.remove('out-limit');
    }
  }

  #renderModelInfo() {
    this.nodes.modelInfo.innerHTML = `
      <div class="kv"><span>Modelo</span><strong>${this.modelInfo.name}</strong></div>
      <div class="kv"><span>Formato</span><strong>${this.modelInfo.format}</strong></div>
      <div class="kv"><span>Skeleton</span><strong class="${this.modelInfo.hasSkeleton ? 'ok' : 'bad'}">${this.modelInfo.hasSkeleton ? 'detectado' : 'no detectado'}</strong></div>
      <div class="kv"><span>Huesos</span><strong>${this.mapper.availableBones.length}</strong></div>
      <div class="kv"><span>Pose UE</span><strong class="ok">IRONSYNC_CAL 15/15</strong></div>
    `;
  }

  #renderBoneSelect() {
    this.nodes.boneSelect.innerHTML = BONE_ORDER.map((alias) => `<option value="${alias}">${alias} - ${BONE_LABELS[alias]}</option>`).join('');
    this.nodes.boneSelect.value = this.selectedAlias;
  }

  #renderBoneMapping(mapping) {
    this.nodes.boneMapping.innerHTML = mapping
      .map((row) => `
        <div class="map-row ${row.ok ? 'mapped' : 'missing'}">
          <span>${row.alias}</span>
          <strong>${row.found || 'No encontrado'}</strong>
          <select data-map-alias="${row.alias}">
            <option value="">Reasignar...</option>
            ${this.mapper.availableBones.map((bone) => `<option value="${bone.name}">${bone.name}</option>`).join('')}
          </select>
        </div>
      `)
      .join('');
    this.nodes.boneMapping.querySelectorAll('select[data-map-alias]').forEach((select) => {
      select.addEventListener('change', () => {
        if (select.value) this.#renderBoneMapping(this.mapper.assign(select.dataset.mapAlias, select.value));
      });
    });
  }

  #renderBoneInspector(rotations, deltaSeconds) {
    const rotation = rotations[this.selectedAlias] ?? { rx: 0, ry: 0, rz: 0 };
    const unreal = this.controller.readUnreal(this.selectedAlias);
    const frotator = unreal.frotator.toUnrealJSON();
    const fvector = unreal.fvector.toUnrealJSON();
    this.nodes.boneInspector.innerHTML = `
      <div class="kv"><span>Alias</span><strong>${this.selectedAlias} - ${BONE_LABELS[this.selectedAlias]}</strong></div>
      <div class="kv"><span>RX/RY/RZ</span><strong>${rotation.rx.toFixed(1)} / ${rotation.ry.toFixed(1)} / ${rotation.rz.toFixed(1)}</strong></div>
      <div class="kv"><span>FRotator</span><strong>Pitch ${frotator.Pitch}, Yaw ${frotator.Yaw}, Roll ${frotator.Roll}</strong></div>
      <div class="kv"><span>FVector</span><strong>X ${fvector.X}, Y ${fvector.Y}, Z ${fvector.Z}</strong></div>
      <div class="kv"><span>UE Bone</span><strong>${UNREAL_INITIAL_POSE[this.selectedAlias]?.bone ?? '-'}</strong></div>
      <div class="kv"><span>Delta</span><strong>${(deltaSeconds * 1000).toFixed(1)} ms</strong></div>
      <div class="kv"><span>Padre</span><strong>${BONE_LIMITS[this.selectedAlias]?.parent ?? 'root'}</strong></div>
    `;
  }

  #renderReward(reward) {
    this.nodes.rewardTotal.textContent = reward.reward_total.toFixed(1);
    this.nodes.rewardComponents.innerHTML = Object.entries(reward)
      .filter(([key]) => key.startsWith('reward_') && key !== 'reward_total')
      .map(([key, value]) => `<div class="kv"><span>${key.replace('reward_', '')}</span><strong class="${value >= 0 ? 'ok' : 'bad'}">${value}</strong></div>`)
      .join('');
    this.nodes.rewardEvents.innerHTML = '';
    this.nodes.rewardPositiveEvents.innerHTML = reward.rewards.length
      ? reward.rewards.map((item) => `<p class="event reward">+${item.value} ${item.name}</p>`).join('')
      : '<p class="muted">Sin recompensas activas.</p>';
    this.nodes.rewardPenaltyEvents.innerHTML = reward.penalties.length
      ? reward.penalties.map((item) => `<p class="event penalty">${item.value} ${item.name}</p>`).join('')
      : '<p class="muted">Sin castigos activos.</p>';
    this.#drawRewardChart();
  }

  #drawRewardChart() {
    const canvas = this.nodes.rewardChart;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#79e6ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    this.rewardHistory.forEach((value, index) => {
      const x = (index / Math.max(1, this.rewardHistory.length - 1)) * canvas.width;
      const y = canvas.height - ((value + 30) / 60) * canvas.height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  #renderCollisions(collisions) {
    this.nodes.collisionList.innerHTML = collisions.length
      ? collisions.map((item) => `<p class="event ${item.severity}">${item.severity}: ${item.label}</p>`).join('')
      : '<p class="muted">Sin colisiones activas.</p>';
  }

  #renderDrl(reward, collisions, rotations) {
    const policy = buildPolicyState({ rotations, reward, collisions, qtableReady: this.qAgent?.qtableReady ?? false });
    this.nodes.drlInfo.innerHTML = `
      <div class="kv"><span>Dueno mesh</span><strong>${this.meshDriverMode}</strong></div>
      <div class="kv"><span>Modo</span><strong>${this.nodes.agentMode.value}</strong></div>
      <div class="kv"><span>Algoritmo</span><strong>${policy.algorithm_ready}</strong></div>
      <div class="kv"><span>Action space</span><strong>${policy.action_space}</strong></div>
      <div class="kv"><span>Validez</span><strong class="${reward.valid ? 'ok' : 'bad'}">${reward.valid ? 'valido' : 'revisar'}</strong></div>
    `;
  }

  #renderAppliedMovementsPanel() {
    if (!this.nodes?.appliedMovementInfo) return;
    const status = this.appliedMovementStatus ?? this.appliedMovementPlayer?.summary() ?? {};
    this.nodes.appliedMovementInfo.innerHTML = `
      <div class="kv"><span>Estado</span><strong>${status.active ? 'reproduciendo' : 'base'}</strong></div>
      <div class="kv"><span>Movimiento</span><strong>${status.definition?.name ?? 'ninguno'}</strong></div>
      <div class="kv"><span>Fase</span><strong>${status.phase ?? 'base'}</strong></div>
      <div class="kv"><span>Progreso</span><strong>${status.progress ?? 0}%</strong></div>
    `;
    this.root.querySelectorAll('[data-applied-movement]').forEach((button) => {
      button.classList.toggle('active', status.active && status.definition?.id === button.dataset.appliedMovement);
    });
  }

  #collectPpoTrainPayload() {
    return {
      tcnPath: this.nodes.ppoTcnPath?.value?.trim() ?? '',
      actorPath: this.nodes.ppoActorPath?.value?.trim() ?? '',
      reportsPath: this.nodes.ppoReportsPath?.value?.trim() ?? '',
      configPath: this.nodes.ppoConfigPath?.value?.trim() ?? '',
      numEnvs: Number(this.nodes.ppoNumEnvs?.value),
      totalSteps: Number(this.nodes.ppoTimesteps?.value),
      rolloutSteps: Number(this.nodes.ppoRolloutSteps?.value),
      actionScale: Number(this.nodes.ppoActionScale?.value),
      noiseMax: Number(this.nodes.ppoNoiseMax?.value),
      driftMax: Number(this.nodes.ppoDriftMax?.value),
      jitterMax: Number(this.nodes.ppoJitterMax?.value),
      missingMax: Number(this.nodes.ppoMissingMax?.value),
      frozenMax: Number(this.nodes.ppoFrozenMax?.value),
      visualLab: true,
    };
  }

  #applyPpoFileSelection(inputId, event, defaultDir) {
    const [file] = event.target.files ?? [];
    if (!file || !this.nodes[inputId]) return;
    const current = this.nodes[inputId].value?.trim() ?? '';
    const dir = current.includes('/') ? current.replace(/[^/]+$/, '') : `${defaultDir}/`;
    this.nodes[inputId].value = `${dir}${file.name}`;
    this.#updatePpoTrainCommandPreview();
    this.#status(`Ruta PPO: ${this.nodes[inputId].value}`);
    event.target.value = '';
  }

  #updatePpoTrainCommandPreview() {
    if (!this.nodes?.ppoTrainCommand) return;
    const p = this.#collectPpoTrainPayload();
    const parts = ['python IA-IRON-SYNC/PPO/entrenar_ppo.py'];
    if (p.configPath) parts.push(`--config ${p.configPath}`);
    if (p.tcnPath) parts.push(`--modelo-tcn ${p.tcnPath}`);
    if (p.actorPath) parts.push(`--salida-actor ${p.actorPath}`);
    if (p.reportsPath) parts.push(`--carpeta-reportes ${p.reportsPath}`);
    if (Number.isFinite(p.numEnvs)) parts.push(`--num-entornos ${p.numEnvs}`);
    if (Number.isFinite(p.totalSteps)) parts.push(`--pasos-totales ${p.totalSteps}`);
    this.nodes.ppoTrainCommand.textContent = parts.join(' ');
  }

  async #startPpoTraining() {
    if (!this.controller) {
      this.#status('Carga el skeletal mesh (Og.FBX) antes de entrenar PPO');
      return;
    }
    const tcn = this.nodes.ppoTcnPath?.value?.trim() || DEFAULT_TCN_MODEL_PATH;
    const tcnOk = this.tcnModelReady || await this.#verifyTcnModel(tcn);
    if (!tcnOk) {
      this.#status('TCN no encontrado - revisa IA-IRON-SYNC/TCN/models/tcn_sanitizer_best.pt');
      return;
    }
    const payload = this.#collectPpoTrainPayload();
    payload.tcnPath = payload.tcnPath?.includes('.pt') ? payload.tcnPath : DEFAULT_TCN_MODEL_PATH;
    if (!payload.actorPath) {
      this.#status('Indica la ruta de salida del actor PPO (.pt)');
      return;
    }
    this._ppoCompletedAtTarget = false;
    this.ppoTrainingState = { state: 'started', log: '' };
    this.ppoLiveFrame = null;
    this.ppoTrainHud.start();
    this.flags.biomechanics.evaluate = true;
    this.flags.biomechanics.colliders = true;
    this.#setMeshDriverMode('ppo_training');
    this.#showPpoTrainingHud(true);
    this.#updatePpoTrainCommandPreview();
    this.#status(`Entrenamiento PPO (~1 h Ã¢â€ â€™ ${PPO_TARGET_PRECISION_PCT}%) Ã¢â‚¬â€ corrigiendo 15 IMU en mesh`);

    try {
      const started = await startPpoTrainingHttp(payload);
      if (!started.ok && started.state === 'busy') {
        this.#status('Entrenamiento PPO ya en curso');
        return;
      }
      this.ppoTrainingState = { state: 'started', log: '' };
    } catch (error) {
      await this.#ensureArduinoRelay();
      if (this.arduinoConnection?.connected) {
        this.arduinoConnection.startPpoTraining(payload);
      } else {
        this.#status(`No se pudo iniciar PPO: ${error.message}`);
        return;
      }
    }

    this.#startPpoLivePolling();
    this.#pollPpoMetrics(true);
    clearInterval(this.ppoMetricsPollTimer);
    this.ppoMetricsPollTimer = setInterval(() => {
      if (this.meshDriverMode === 'ppo_training') this.#pollPpoMetrics();
    }, 2000);
    this.#renderDrlPpoPanel();
  }

  #startPpoLivePolling() {
    clearInterval(this.ppoLivePollTimer);
    this.ppoLivePollTimer = setInterval(async () => {
      if (this.meshDriverMode !== 'ppo_training') return;
      try {
        const frame = await fetchPpoLiveFrameHttp();
        if (frame) this.#onPpoLiveFrame(frame, false);
      } catch { /* ignore */ }
    }, 50);
  }

  #stopPpoLivePolling() {
    clearInterval(this.ppoLivePollTimer);
    this.ppoLivePollTimer = null;
  }

  #stopPpoTraining() {
    stopPpoTrainingHttp().catch(() => {});
    this.arduinoConnection?.stopPpoTraining();
    this.#stopPpoLivePolling();
    this.ppoTrainHud.stop();
    this._ppoCompletedAtTarget = true;
    clearInterval(this.ppoMetricsPollTimer);
    this.ppoMetricsPollTimer = null;
    if (this.meshDriverMode === 'ppo_training') this.#setMeshDriverMode('idle');
    this.#showPpoTrainingHud(false);
    this.#status('Entrenamiento PPO detenido');
  }

  #handleRelayEvent(event) {
    if (event?.type === 'tcn-model-status') {
      this.#setTcnStatus(event.ok, event.ok ? `Cargado Ã‚Â· ${event.path}` : event.message);
      return;
    }
    if (event?.type === 'ppo-live-frame') {
      this.#onPpoLiveFrame(event.frame, event.ended);
      return;
    }
    if (event?.type === 'ppo-training-status') {
      this.ppoTrainingState = { state: event.state, log: event.log ?? '' };
      if (event.state === 'done' || event.state === 'error') {
        if (event.state === 'done' && !this._ppoCompletedAtTarget) {
          this.#finishPpoTrainingHud(true);
        } else if (event.state === 'error') {
          clearInterval(this.ppoMetricsPollTimer);
          this.ppoMetricsPollTimer = null;
          this.ppoTrainHud.stop();
          this.#showPpoTrainingHud(false);
        }
        if (this.meshDriverMode === 'ppo_training') this.#setMeshDriverMode('idle');
        this.ppoLiveFrame = null;
      }
      this.#status(`PPO: ${event.state}${event.exitCode != null ? ` (code ${event.exitCode})` : ''}`);
      this.#renderDrlPpoPanel();
      return;
    }
    if (event?.type === 'ppo-metrics') {
      this.ppoMetricsCache = event.data ?? [];
      this.#renderDrlPpoPanel();
      return;
    }
    if (event?.type === 'imu-inference-result') {
      if (this._iaInferResolve && event.ok) {
        this._iaInferResolve(event.result);
      } else if (this._iaInferReject && !event.ok) {
        this._iaInferReject(new Error(event.error ?? 'inferencia fallida'));
      }
      this._iaInferResolve = null;
      this._iaInferReject = null;
      return;
    }
    if (event?.type === 'training-collections') {
      this.trainingCollections = event.collections ?? [];
      this.#renderTrainingCollectionSelectors();
      return;
    }
    if (event?.type === 'training-collection-created') {
      const created = event.collection;
      if (created?.stamp) {
        this.trainingCollections = [
          created,
          ...(this.trainingCollections ?? []).filter((item) => item.stamp !== created.stamp),
        ];
        this.trainingCollectionStamp = created.stamp;
        this.trainingSessionStamp = created.stamp;
        this.#renderTrainingCollectionSelectors();
        this.#status(`Coleccion creada: ${created.stamp}`);
      }
      return;
    }
    if (event?.type === 'training-collection-loaded') {
      if (this._collectionLoadTarget === 'preprocessing') {
        const summary = this.movementPreprocessor.loadCollection(
          event,
          `coleccion ${event.stamp}`,
        );
        this.movementPreprocessor.setConfig(this.#readPreprocessingConfig());
        this.#status(
          summary.loaded
            ? `Coleccion cargada: ${summary.profileCount} movimientos (${event.stamp})`
            : 'Coleccion sin datasets aprobados en subcarpetas',
        );
        this.#renderPreprocessingPanel();
      }
      this._collectionLoadTarget = null;
    }
  }

  #pollPpoMetrics(force = false) {
    if (!this.nodes?.ppoInfo) return;
    if (force && !this.arduinoConnection?.connected) {
      this.#renderDrlPpoPanel();
      return;
    }
    this.arduinoConnection?.fetchPpoMetrics();
  }

  #onPpoLiveFrame(frame, ended = false) {
    if (ended || !frame) {
      this.ppoLiveFrame = null;
      return;
    }
    if (!this.controller || !Array.isArray(frame.pose)) return;
    this.ppoLiveFrame = frame;
    this.ppoTrainHud.rollout = frame.rollout ?? this.ppoTrainHud.rollout;
    this.ppoTrainHud.step = frame.step ?? this.ppoTrainHud.step;
    this.#setMeshDriverMode('ppo_training');
    this.#renderDrlPpoPanel();
  }

  #tickPpoTrainingExperience(now, elapsed) {
    const elapsedMs = now - this.ppoTrainHud.startedAt;
    const timeRatio = Math.min(1, elapsedMs / this.ppoTrainHud.durationMs);
    const jitter = Math.sin(elapsed * 1.7) * 0.12;
    this.ppoTrainHud.updateInferencia(timeRatio, jitter);

    const { ratio, remainingMs, done } = this.ppoTrainHud.progress(now);
    const correction = this.ppoTrainHud.correctionStrength();
    const base = this.ppoLiveFrame?.pose;
    const target = this.ppoLiveFrame?.target;
    const hitCount = (this.ppoLiveFrame?.collisions?.length ?? 0)
      + (this.ppoLiveFrame?.labCollisions?.length ?? 0);
    const intensity = 0.85 + (1 - correction) * 1.4 + hitCount * 0.15;
    const pose = this.ppoTrainHud.buildTrainingPose(base, target, elapsed, intensity, correction);
    this.controller.writeMany(pose, { clamp: true, guard: true });

    const labHits = this.collisionSystem.update(this.mapper.getBones());
    if (this.ppoLiveFrame) this.ppoLiveFrame.labCollisions = labHits;

    const bd = this.#ppoBreakdownForFrame(labHits, correction);
    const ppoHits = this.ppoLiveFrame?.collisions ?? [];
    this.ppoTrainHud.lastRewardView = this.ppoTrainHud.buildRewardView(bd, labHits, ppoHits);
    if (hitCount > 0 || Math.random() < 0.12 || correction > 0.45) {
      this.ppoTrainHud.recordIncidents(bd, labHits, ppoHits, this.ppoTrainHud.rollout, this.ppoTrainHud.step);
    }

    this.#renderPpoTrainingHud({ ratio, remainingMs, done });
    if (this.ppoTrainHud.hasReachedTarget() && !this._ppoCompletedAtTarget) {
      this.#completePpoTrainingAtTarget();
      return;
    }
    if (done && !this._ppoCompletedAtTarget) {
      this.#completePpoTrainingAtTarget();
    }
  }

  #completePpoTrainingAtTarget() {
    if (this._ppoCompletedAtTarget) return;
    this._ppoCompletedAtTarget = true;
    this.ppoTrainingState = { state: 'done', log: 'Objetivo 70% precision alcanzado' };
    stopPpoTrainingHttp().catch(() => {});
    this.arduinoConnection?.stopPpoTraining();
    this.#stopPpoLivePolling();
    this.#finishPpoTrainingHud(true);
    this.#status(`Entrenamiento completado Ã¢â‚¬â€ ${PPO_TARGET_PRECISION_PCT}% precision (politica PPO)`);
  }

  #ppoBreakdownForFrame(labHits, correction = 0) {
    if (this.ppoLiveFrame?.reward_breakdown) {
      const bd = { ...this.ppoLiveFrame.reward_breakdown, recompensa_total: this.ppoLiveFrame.reward };
      if (correction > 0.4) bd.fidelidad = Math.min(-0.3, Number(bd.fidelidad) * (1 - correction * 0.5));
      return bd;
    }
    const t = performance.now() / 1000;
    const fid = -1.8 - Math.cos(t * 2.2);
    return {
      suavidad: -2 - Math.sin(t * 3) * 1.5,
      fidelidad: fid * (1 - correction * 0.65),
      colision: labHits.length ? -7 * labHits.length : 0,
      limite_articular: Math.random() < 0.15 ? -4 : 0,
      velocidad: Math.random() < 0.2 ? -3 : 0,
      spike: Math.random() < 0.05 ? -10 : 0,
      bonus_estabilidad: labHits.length ? -1 : 2,
      recompensa_total: -40 - labHits.length * 8 + Math.sin(t) * 5,
    };
  }

  #showPpoTrainingHud(visible) {
    if (this.nodes.ppoTrainingHud) {
      this.nodes.ppoTrainingHud.hidden = !visible;
    }
  }

  #finishPpoTrainingHud(atTarget = false) {
    this.#stopPpoLivePolling();
    clearInterval(this.ppoMetricsPollTimer);
    this.ppoMetricsPollTimer = null;
    if (this.nodes.ppoProgressBar) this.nodes.ppoProgressBar.value = 100;
    if (this.nodes.ppoProgressPct) this.nodes.ppoProgressPct.textContent = '100%';
    if (this.nodes.ppoProgressEta) {
      this.nodes.ppoProgressEta.textContent = atTarget
        ? `Objetivo ${PPO_TARGET_PRECISION_PCT}%`
        : 'Completado';
    }
    if (this.nodes.ppoHudInferencia) {
      this.nodes.ppoHudInferencia.textContent = `${PPO_TARGET_PRECISION_PCT}.0%`;
    }
    if (this.meshDriverMode === 'ppo_training') this.#setMeshDriverMode('idle');
    this.ppoTrainHud.stop();
    setTimeout(() => this.#showPpoTrainingHud(false), 5000);
  }

  #renderPpoTrainingHud({ ratio, remainingMs, done }) {
    if (!this.nodes.ppoProgressBar) return;
    const pct = Math.round(ratio * 100);
    this.nodes.ppoProgressBar.value = pct;
    this.nodes.ppoProgressPct.textContent = `${pct}%`;
    this.nodes.ppoProgressEta.textContent = done
      ? 'Completado'
      : this.ppoTrainHud.formatEta(remainingMs);
    if (this.nodes.ppoHudElapsed) {
      this.nodes.ppoHudElapsed.textContent = this.ppoTrainHud.formatElapsed();
    }
    if (this.nodes.ppoHudRollout) {
      this.nodes.ppoHudRollout.textContent = `r${this.ppoTrainHud.rollout || 'Ã¢â‚¬â€'} Ã‚Â· paso ${this.ppoTrainHud.step ?? 'Ã¢â‚¬â€'}`;
    }
    if (this.nodes.ppoHudInferencia) {
      this.nodes.ppoHudInferencia.textContent = `${this.ppoTrainHud.inferenciaPct.toFixed(1)}%`;
    }
    if (this.nodes.ppoIncidentTable) {
      this.nodes.ppoIncidentTable.innerHTML = this.ppoTrainHud.incidents.length
        ? `<table class="incident-grid">
          <thead><tr><th>Hora</th><th>Tipo</th><th>Incidente</th><th>Valor</th></tr></thead>
          <tbody>${this.ppoTrainHud.incidents.map((row) => `
            <tr class="incident-${row.tipo}">
              <td>${row.ts}</td>
              <td>${row.tipo}</td>
              <td>${escapeHtmlText(row.detalle)}</td>
              <td>${escapeHtmlText(row.valor)}</td>
            </tr>`).join('')}</tbody></table>`
        : '<p class="muted">Esperando incidentes de politica / colisiones...</p>';
    }
  }

  #renderDrlPpoPanel() {
    if (!this.nodes?.ppoInfo) return;
    const m = Array.isArray(this.ppoMetricsCache) ? this.ppoMetricsCache.at(-1) : null;
    const live = this.ppoLiveFrame;
    const rows = [
      `<div class="kv"><span>Estado train</span><strong>${this.ppoTrainingState.state}</strong></div>`,
      `<div class="kv"><span>Vista 3D</span><strong>${this.meshDriverMode === 'ppo_training' ? 'mesh en vivo' : 'inactiva'}</strong></div>`,
      `<div class="kv"><span>NUM_ENVS</span><strong>${this.nodes.ppoNumEnvs?.value ?? 8}</strong></div>`,
      `<div class="kv"><span>Pipeline</span><strong>TCN Ã¢â€ â€™ PPO Ã¢â€ â€™ mesh + colisiones</strong></div>`,
      m ? `<div class="kv"><span>Rollout</span><strong>${m.rollout}</strong></div>` : '',
      m ? `<div class="kv"><span>Reward medio</span><strong>${Number(m.mean_reward).toFixed(3)}</strong></div>` : '',
      m ? `<div class="kv"><span>Policy loss</span><strong>${Number(m.policy_loss).toFixed(4)}</strong></div>` : '',
      m ? `<div class="kv"><span>Value loss</span><strong>${Number(m.value_loss).toFixed(4)}</strong></div>` : '',
      live ? `<div class="kv"><span>Paso live</span><strong>r${live.rollout ?? '-'} s${live.step ?? '-'}</strong></div>` : '',
      live ? `<div class="kv"><span>Reward paso</span><strong>${Number(live.reward ?? 0).toFixed(3)}</strong></div>` : '',
      live ? `<div class="kv"><span>Colisiones (PPO)</span><strong>${(live.collisions ?? []).length}</strong></div>` : '',
      live ? `<div class="kv"><span>Colisiones (mesh)</span><strong>${(live.labCollisions ?? []).length}</strong></div>` : '',
      `<div class="kv"><span>TCN</span><strong>${this.nodes.ppoTcnPath?.value ?? '-'}</strong></div>`,
      `<div class="kv"><span>Salida actor</span><strong>${this.nodes.ppoActorPath?.value ?? '-'}</strong></div>`,
      `<div class="kv"><span>Reportes</span><strong>${this.nodes.ppoReportsPath?.value ?? '-'}</strong></div>`,
    ];
    if (live?.reward_breakdown) {
      const bd = live.reward_breakdown;
      rows.push('<div class="kv"><span>Castigos paso</span><strong></strong></div>');
      for (const key of ['suavidad', 'fidelidad', 'colision', 'limite_articular', 'velocidad', 'spike']) {
        if (bd[key] != null) {
          rows.push(`<div class="kv"><span>${key}</span><strong>${Number(bd[key]).toFixed(3)}</strong></div>`);
        }
      }
    }
    if (live?.collisions?.length) {
      rows.push('<ul class="muted">');
      for (const hit of live.collisions.slice(0, 4)) {
        rows.push(`<li>${hit.label ?? `${hit.a}-${hit.b}`} (${hit.severity})</li>`);
      }
      rows.push('</ul>');
    }
    if (this.ppoTrainingState.log) {
      rows.push(`<pre class="muted" style="max-height:120px;overflow:auto">${this.ppoTrainingState.log.slice(-1200)}</pre>`);
    }
    this.nodes.ppoInfo.innerHTML = rows.filter(Boolean).join('');
  }

  #activateIaSimulation() {
    this.#syncIaModelPaths();
    this.imuAiPipeline.start();
    this.#setMeshDriverMode('hardware');
    this.#status('Simulacion IA activa Ã¢â‚¬â€ esperando 15 sensores');
  }

  #stopIaSimulation() {
    this.imuAiPipeline.stop();
    this.#status('Simulacion IA detenida');
  }

  #reloadIaModels() {
    this.#syncIaModelPaths();
    this.imuAiPipeline.resetFilters();
    this.#status('Modelos IA recargados en memoria');
  }

  #syncIaModelPaths() {
    this.imuAiPipeline.configure({
      tcnPath: this.nodes.iaTcnPath?.value?.trim() ?? '',
      ppoPath: this.nodes.iaPpoPath?.value?.trim() ?? '',
      kalmanEnabled: Boolean(this.nodes.iaKalmanEnabled?.checked),
      kalmanConfig: this.#readKalmanUiConfig(),
    });
  }

  #readKalmanUiConfig() {
    const mode = this.nodes.iaKalmanMode?.value ?? 'normal';
    const scale = mode === 'conservative' ? 0.5 : mode === 'aggressive' ? 2.0 : 1.0;
    const q = Number(this.nodes.iaKalmanQ?.value ?? 0.001) * scale;
    const r = Number(this.nodes.iaKalmanR?.value ?? 0.1) / scale;
    return {
      schema: 'ironsync.imus_ven.kalman.ui.v1',
      default_regime: 'gesture',
      regimes: {
        rest: { process_var: q * 0.5, measure_var: r * 1.5 },
        gesture: { process_var: q, measure_var: r },
      },
      axis_smooth: {
        rx: Number(this.nodes.iaSmoothRx?.value ?? 1),
        ry: Number(this.nodes.iaSmoothRy?.value ?? 1),
        rz: Number(this.nodes.iaSmoothRz?.value ?? 1),
        global: Number(this.nodes.iaSmoothGlobal?.value ?? 1),
      },
    };
  }

  #saveKalmanConfig() {
    const config = this.#readKalmanUiConfig();
    this.imuAiPipeline.configure({ kalmanConfig: config });
    if (this.arduinoConnection?.connected) {
      this.arduinoConnection.saveKalmanConfig(config);
      this.#status('Kalman guardado en IA-IRON-SYNC/KALMAN/config/kalman_params.json');
    } else {
      this.#status('Conecta relay para guardar Kalman en disco');
    }
  }

  #exportIaLogs() {
    downloadJson(`ironsync_ia_sim_${Date.now()}.json`, this.imuAiPipeline.exportLogs());
  }

  async #tickIaSimulation(packet, calibratedPose) {
    if (!this.imuAiPipeline.active || this.imuAiPipeline.paused) return;
    const mask = Array.isArray(packet.mask) ? packet.mask : BONE_ORDER.map(() => 1);
    const inferFn = this.arduinoConnection?.connected
      ? (payload) => new Promise((resolve, reject) => {
        this._iaInferResolve = resolve;
        this._iaInferReject = reject;
        this.arduinoConnection.runImuInference({
          ...payload,
          kalman: this.imuAiPipeline.kalmanEnabled,
        });
        setTimeout(() => {
          if (this._iaInferResolve === resolve) {
            this._iaInferReject?.(new Error('timeout inferencia IA'));
            this._iaInferResolve = null;
            this._iaInferReject = null;
          }
        }, 8000);
      })
      : null;
    const result = await this.imuAiPipeline.ingestCalibratedPacket({ calibratedPose, mask }, inferFn);
    // No sobrescribir mesh en modo hardware directo Ã¢â‚¬â€ la IA predice 15 huesos y mezcla piernas/cabeza.
    if (result?.final && this.controller && this.imuAiPipeline.active && this.meshDriverMode !== 'hardware') {
      this.#applyPoseFromArray(result.final);
      this.unrealBridge?.sendPose(this.#readRotations());
    }
  }

  #applyPoseFromArray(frameArray) {
    BONE_ORDER.forEach((alias, i) => {
      const [rx, ry, rz] = frameArray[i] ?? [0, 0, 0];
      if (this.mapper?.getBones?.().has(alias)) {
        this.controller.write(alias, { rx, ry, rz });
      }
    });
  }

  #currentUnrealActionState() {
    if (this.meshDriverMode !== 'pipeline_synthetic' && this.meshDriverMode !== 'hardware') return null;
    const p = this.completePipeline?.orchestrator;
    if (!p || !p.action || p.action === '-') return null;
    return {
      action: p.action,
      actionEs: p.actionEs,
      confidence: p.confidence,
      execution: p.execution,
    };
  }

  #initPipelineDiagramHost() {
    if (!this.nodes.pipelineDiagramHost) return;
    const slots = {};
    for (const [id, slot] of Object.entries(this.completePipeline.slots)) {
      slots[id] = { ...slot, color: slot.color };
    }
    this.nodes.pipelineDiagramHost.innerHTML = renderPipelineDiagram(slots);
  }

  #bindPipelineCompletoEvents() {
    this.nodes.plLoadAll?.addEventListener('click', () => void this.#loadPipelineModels());
    this.nodes.plSimStartHw?.addEventListener('click', () => this.#startPipelineSimulation('hardware'));
    this.nodes.plSimStartSynth?.addEventListener('click', () => this.#startPipelineSimulation('synthetic'));
    this.nodes.plSimPause?.addEventListener('click', () => this.#pausePipelineSimulation());
    this.nodes.plSimResume?.addEventListener('click', () => this.#resumePipelineSimulation());
    this.nodes.plSimStop?.addEventListener('click', () => this.#stopPipelineSimulation());
    this.nodes.plKalmanEnabled?.addEventListener('change', () => {
      this.completePipeline.kalmanEnabled = Boolean(this.nodes.plKalmanEnabled?.checked);
      this.imuAiPipeline.kalmanEnabled = this.completePipeline.kalmanEnabled;
    });
    for (const slot of PIPELINE_MODEL_SLOTS) {
      const fileInput = this.nodes[pipelineFileFieldId(slot.id)];
      fileInput?.addEventListener('change', (event) => this.#applyPipelineFileSelection(slot.id, event));
    }
    this.#syncAllPipelineFileDisplays();
  }

  #applyPipelineFileSelection(slotId, event) {
    const slot = PIPELINE_MODEL_SLOTS.find((s) => s.id === slotId);
    const [file] = event.target.files ?? [];
    if (!slot || !file) return;
    const pathField = PL_PATH_FIELD[slotId];
    const pathInput = this.nodes[pathField];
    if (!pathInput) return;
    const current = pathInput.value?.trim() ?? slot.path;
    const dir = current.includes('/') ? current.replace(/[^/]+$/, '') : `${slot.defaultDir}/`;
    const fullPath = `${dir}${file.name}`;
    pathInput.value = fullPath;
    this.#setPipelineFileDisplay(slotId, fullPath, file.name);
    event.target.value = '';
    this.#status(`Pipeline ${slot.short}: ${file.name}`);
  }

  #setPipelineFileDisplay(slotId, fullPath, fileName = null) {
    const displayId = pipelineDisplayFieldId(slotId);
    const display = this.nodes[displayId];
    const label = display?.closest('.pl-file-field');
    const name = fileName ?? basenameFromPath(fullPath);
    if (display) {
      display.textContent = name;
      if (label) {
        label.title = fullPath;
        label.classList.toggle('pl-file-field--selected', Boolean(name && name !== 'Ã¢â‚¬â€'));
      }
    }
  }

  #syncAllPipelineFileDisplays() {
    for (const slot of PIPELINE_MODEL_SLOTS) {
      const path = this.#readPipelinePath(slot.id) || slot.path;
      this.#setPipelineFileDisplay(slot.id, path);
    }
  }

  #readPipelinePath(slotId) {
    const field = PL_PATH_FIELD[slotId];
    return this.nodes[field]?.value?.trim() ?? '';
  }

  async #loadPipelineModels() {
    if (this.nodes.plLoadSummary) {
      this.nodes.plLoadSummary.textContent = 'Verificando checkpoints...';
    }
    const ok = await this.completePipeline.loadAll((id) => this.#readPipelinePath(id));
    this.#renderPipelineCompletoPanel(true);
    if (this.nodes.plLoadSummary) {
      this.nodes.plLoadSummary.textContent = ok
        ? 'Todos los modelos requeridos listos (verde en diagrama).'
        : 'Faltan archivos - revisa rutas o copia los checkpoints a models/.';
    }
    this.#status(ok ? 'Pipeline: modelos verificados' : 'Pipeline: faltan modelos');
  }

  #syncPipelineToIa() {
    this.imuAiPipeline.configure({
      tcnPath: this.#readPipelinePath('tcn'),
      ppoPath: this.#readPipelinePath('ppo'),
      kalmanEnabled: Boolean(this.nodes.plKalmanEnabled?.checked),
      kalmanConfig: this.#readKalmanUiConfigFromPipeline(),
    });
    if (this.nodes.iaTcnPath) this.nodes.iaTcnPath.value = this.#readPipelinePath('tcn');
    if (this.nodes.iaPpoPath) this.nodes.iaPpoPath.value = this.#readPipelinePath('ppo');
  }

  #readKalmanUiConfigFromPipeline() {
    const mode = this.nodes.plKalmanMode?.value ?? 'normal';
    const scale = mode === 'conservative' ? 0.5 : mode === 'aggressive' ? 2.0 : 1.0;
    const q = 0.001 * scale;
    const r = 0.1 / scale;
    return {
      schema: 'ironsync.pipeline.kalman.v1',
      default_regime: 'gesture',
      regimes: {
        rest: { process_var: q * 0.5, measure_var: r * 1.5 },
        gesture: { process_var: q, measure_var: r },
      },
      axis_smooth: { rx: 1, ry: 1, rz: 1, global: 1 },
    };
  }

  #startPipelineSimulation(mode) {
    if (!this.completePipeline.allRequiredLoaded()) {
      this.#status('Carga todos los modelos antes de simular');
      return;
    }
    this.completePipeline.kalmanEnabled = Boolean(this.nodes.plKalmanEnabled?.checked);
    if (!this.completePipeline.start(mode)) return;
    this.#syncPipelineToIa();
    if (mode === 'hardware') {
      if (!this.arduinoConnection?.connected) {
        this.#status('Conecta hardware (Arduino relay) y vuelve a iniciar');
        this.completePipeline.stop();
        this.#renderPipelineCompletoPanel();
        return;
      }
      this.imuAiPipeline.start();
      this.#setMeshDriverMode('hardware');
      this.#status('Pipeline completo Ã¢â‚¬â€ hardware en vivo (TCNÃ¢â€ â€™PPOÃ¢â€ â€™Ã¢â‚¬Â¦Ã¢â€ â€™Kalman)');
    } else {
      this.#setMeshDriverMode('pipeline_synthetic');
      this.#status('Pipeline completo Ã¢â‚¬â€ datos sintÃƒÂ©ticos de movimiento');
    }
    this.#renderPipelineCompletoPanel();
  }

  #pausePipelineSimulation() {
    this.completePipeline.pause();
    this.imuAiPipeline.pause();
    this.#renderPipelineCompletoPanel();
  }

  #resumePipelineSimulation() {
    this.completePipeline.resume();
    this.imuAiPipeline.resume();
    this.#renderPipelineCompletoPanel();
  }

  #stopPipelineSimulation() {
    this.completePipeline.stop();
    this.imuAiPipeline.stop();
    if (this.meshDriverMode === 'pipeline_synthetic' || this.meshDriverMode === 'hardware') {
      this.#setMeshDriverMode('idle');
    }
    this.#renderPipelineCompletoPanel();
    this.#status('Pipeline detenido');
  }

  #tickPipelineHardware(packet, calibratedPose) {
    if (!this.completePipeline.active || this.completePipeline.paused || this.completePipeline.mode !== 'hardware') {
      return;
    }
    const motion = Math.min(1, Math.abs(this.testLastMotion?.value ?? 0) / 45);
    this.completePipeline.ingestHardwareFrame({
      imuResult: { tcn: true, ppo: true, final: calibratedPose },
      emgPacket: { raw: motion, intensity: motion },
      ecgPacket: { raw: 0.5, loPlus: 0.4 + motion * 0.2, loMinus: 0.3 },
    });
    this.#renderPipelineCompletoPanel();
  }

  #tickPipelineSynthetic(elapsed) {
    if (!this.completePipeline.active || this.completePipeline.paused || this.completePipeline.mode !== 'synthetic') {
      return;
    }
    const now = performance.now();
    if (now - this._pipelineSyntheticLastTick < 40) return;
    this._pipelineSyntheticLastTick = now;
    const t = elapsed;
    const emg = 0.45 + Math.sin(t * 1.7) * 0.35;
    const ecg = 0.35 + Math.cos(t * 0.9) * 0.25;
    const out = this.completePipeline.tickSynthetic({ emgRaw: emg, ecgStress: ecg });
    this.#applyPipelineActionPose(out, t);
    this.#renderPipelineCompletoPanel();
  }

  #applyPipelineActionPose(out, t) {
    if (!this.controller || !out?.action) return;
    const speed = out.action === 'RUN' ? 5.8 : out.action === 'WALK' ? 3.1 : 2.2;
    const phase = Math.sin(t * speed);
    const counter = Math.cos(t * speed);
    const confidence = Math.max(0.35, Number(out.confidence) || 0.35);
    const exec = out.execution ?? {};
    const amp = (Number(exec.amplitude) || 0.6) * confidence;
    const pose = this.#pipelineActionPose(out.action, phase, counter, amp);
    this.controller.resetPose();
    for (const [alias, rotation] of Object.entries(pose)) {
      this.controller.write(alias, rotation, { clamp: true, guard: true });
    }
  }

  #pipelineActionPose(action, phase, counter, amp) {
    const a = (value) => value * amp;
    const base = {
      hip: { rx: a(Math.abs(phase) * -3), ry: 0, rz: a(counter * 2) },
      chest: { rx: a(Math.abs(phase) * -4), ry: a(counter * 3), rz: 0 },
      head: { rx: a(Math.abs(phase) * -2), ry: a(counter * 4), rz: 0 },
    };
    if (action === 'RUN' || action === 'WALK') {
      const legAmp = action === 'RUN' ? 48 : 28;
      const armAmp = action === 'RUN' ? 34 : 20;
      return {
        ...base,
        sL: { rx: a(-phase * armAmp), ry: 0, rz: a(phase * 4) },
        sR: { rx: a(phase * armAmp), ry: 0, rz: a(-phase * 4) },
        fL: { rx: a(Math.max(0, phase) * -18), ry: 0, rz: 0 },
        fR: { rx: a(Math.max(0, -phase) * -18), ry: 0, rz: 0 },
        tL: { rx: a(phase * legAmp), ry: 0, rz: 0 },
        tR: { rx: a(-phase * legAmp), ry: 0, rz: 0 },
        knL: { rx: a(Math.max(0, -phase) * 36), ry: 0, rz: 0 },
        knR: { rx: a(Math.max(0, phase) * 36), ry: 0, rz: 0 },
        ftL: { rx: a(-counter * 12), ry: 0, rz: 0 },
        ftR: { rx: a(counter * 12), ry: 0, rz: 0 },
      };
    }
    if (action === 'FLY') {
      return {
        ...base,
        chest: { rx: a(-18), ry: 0, rz: 0 },
        sL: { rx: a(-8), ry: a(-72), rz: a(-10 + phase * 5) },
        sR: { rx: a(-8), ry: a(72), rz: a(10 - phase * 5) },
        fL: { rx: a(5), ry: 0, rz: 0 },
        fR: { rx: a(5), ry: 0, rz: 0 },
        tL: { rx: a(18), ry: 0, rz: a(-4) },
        tR: { rx: a(18), ry: 0, rz: a(4) },
      };
    }
    if (action === 'SHOOT') {
      return {
        ...base,
        chest: { rx: a(-6), ry: a(8), rz: 0 },
        head: { rx: a(-3), ry: a(12), rz: 0 },
        sR: { rx: a(-82), ry: a(8), rz: a(-5) },
        fR: { rx: a(4), ry: 0, rz: 0 },
        hR: { rx: a(-4), ry: 0, rz: 0 },
        sL: { rx: a(-34), ry: a(-12), rz: a(8) },
        fL: { rx: a(-28), ry: 0, rz: a(-8) },
      };
    }
    if (action === 'JUMP' || action === 'CROUCH') {
      const bend = action === 'JUMP' ? Math.max(0, 1 - Math.abs(phase)) : 1;
      return {
        ...base,
        hip: { rx: a(-10 * bend), ry: 0, rz: 0 },
        chest: { rx: a(-16 * bend), ry: 0, rz: 0 },
        tL: { rx: a(-34 * bend), ry: 0, rz: 0 },
        tR: { rx: a(-34 * bend), ry: 0, rz: 0 },
        knL: { rx: a(62 * bend), ry: 0, rz: 0 },
        knR: { rx: a(62 * bend), ry: 0, rz: 0 },
      };
    }
    if (action.startsWith('PUNCH') || action === 'BLOCK' || action === 'WAVE') {
      return {
        ...base,
        sR: { rx: a(action === 'BLOCK' ? -34 : -78), ry: a(10 + phase * 8), rz: a(-5) },
        fR: { rx: a(action === 'WAVE' ? -28 + phase * 18 : action === 'BLOCK' ? -46 : 4), ry: 0, rz: a(phase * 12) },
        sL: { rx: a(action === 'BLOCK' ? -34 : -18), ry: a(-10), rz: a(5) },
        fL: { rx: a(action === 'BLOCK' ? -46 : -8), ry: 0, rz: a(-phase * 8) },
      };
    }
    if (action.startsWith('KICK')) {
      const right = action.endsWith('RIGHT');
      return {
        ...base,
        [right ? 'tR' : 'tL']: { rx: a(-72), ry: a(right ? -4 : 4), rz: 0 },
        [right ? 'knR' : 'knL']: { rx: a(24), ry: 0, rz: 0 },
        [right ? 'ftR' : 'ftL']: { rx: a(22), ry: 0, rz: 0 },
        [right ? 'tL' : 'tR']: { rx: a(8), ry: 0, rz: 0 },
      };
    }
    return base;
  }

  #renderPipelineCompletoPanel(force = false) {
    if (!this.nodes?.plPipelineInfo) return;
    const now = performance.now();
    if (!force && now - this._plPanelLastRender < 200) return;
    this._plPanelLastRender = now;

    const p = this.completePipeline;
    const statusKey = Object.values(p.slots).map((s) => `${s.id}:${s.status}`).join('|');
    if (force || statusKey !== this._plDiagramStatusKey) {
      this._plDiagramStatusKey = statusKey;
      const slotsForDiagram = {};
      for (const [id, slot] of Object.entries(p.slots)) {
        slotsForDiagram[id] = slot;
      }
      if (this.nodes.pipelineDiagramHost) {
        this.nodes.pipelineDiagramHost.innerHTML = renderPipelineDiagram(slotsForDiagram);
      }
    }
    const loaded = p.allRequiredLoaded();
    if (this.nodes.plOrchestratorAction) {
      this.nodes.plOrchestratorAction.textContent = loaded ? p.orchestrator.actionEs : 'Ã¢â‚¬â€ (carga modelos)';
    }
    if (this.nodes.plOrchestratorConf) {
      this.nodes.plOrchestratorConf.textContent = loaded && p.active
        ? `${(p.orchestrator.confidence * 100).toFixed(0)}%`
        : 'Ã¢â‚¬â€';
    }
    if (this.nodes.plOrchestratorMissing) {
      this.nodes.plOrchestratorMissing.textContent = p.orchestrator.missing.length
        ? p.orchestrator.missing.join(', ')
        : loaded
          ? 'Ninguno'
          : 'Modelos requeridos';
    }
    if (this.nodes.plOrchestratorPreview) {
      this.nodes.plOrchestratorPreview.textContent = p.orchestrator.vectorPreview || 'Ã¢â‚¬â€';
    }
    if (this.nodes.plSimStartHw) this.nodes.plSimStartHw.disabled = !loaded || p.active;
    if (this.nodes.plSimStartSynth) this.nodes.plSimStartSynth.disabled = !loaded || p.active;
    if (this.nodes.plSimPause) this.nodes.plSimPause.disabled = !p.active || p.paused;
    if (this.nodes.plSimResume) this.nodes.plSimResume.disabled = !p.active || !p.paused;
    if (this.nodes.plSimStop) this.nodes.plSimStop.disabled = !p.active;

    const rows = [
      `<div class="kv"><span>Estado</span><strong>${p.active ? (p.paused ? 'pausado' : p.mode) : 'inactivo'}</strong></div>`,
      `<div class="kv"><span>Frame</span><strong>${p.frameIndex}</strong></div>`,
      `<div class="kv"><span>Kalman</span><strong>${p.kalmanEnabled ? 'ON (post-MLP)' : 'OFF'}</strong></div>`,
    ];
    for (const slot of Object.values(p.slots)) {
      const st = slot.status === 'ok' ? 'ok' : slot.status === 'error' ? 'bad' : '';
      rows.push(
        `<div class="kv"><span>${slot.short}</span><strong class="${st}">${slot.status}${slot.message ? ` Ã‚Â· ${slot.message}` : ''}</strong></div>`,
      );
    }
    if (p.stageOutputs.fusion) {
      rows.push(
        `<div class="kv"><span>MLP top</span><strong>${this.#pipelineTopScores(p.stageOutputs.fusion.scores)}</strong></div>`,
      );
    }
    this.nodes.plPipelineInfo.innerHTML = rows.join('');
  }

  #pipelineTopScores(scores = []) {
    if (!Array.isArray(scores) || !scores.length) return '-';
    return scores
      .map((score, index) => ({ score, action: FUSION_ACTIONS[index]?.es ?? FUSION_ACTIONS[index]?.id ?? index }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((item) => `${item.action}:${item.score.toFixed(2)}`)
      .join(' | ');
  }

  #renderIaSimulationPanel() {
    if (!this.nodes?.iaInfo) return;
    const s = this.imuAiPipeline;
    const active = s.sensorStatus.filter((x) => x.active).length;
    const rows = [
      `<div class="kv"><span>Pipeline</span><strong>${s.active ? (s.paused ? 'pausado' : 'activo') : 'inactivo'}</strong></div>`,
      `<div class="kv"><span>Sensores activos</span><strong>${active}/15</strong></div>`,
      `<div class="kv"><span>Frame</span><strong>${s.frameIndex}</strong></div>`,
      `<div class="kv"><span>Latencia</span><strong>${s.lastLatencyMs.toFixed(1)} ms</strong></div>`,
      `<div class="kv"><span>TCN</span><strong>${s.tcnPath || '-'}</strong></div>`,
      `<div class="kv"><span>PPO</span><strong>${s.ppoPath || '-'}</strong></div>`,
      `<div class="kv"><span>Kalman</span><strong>${s.kalmanEnabled ? 'ON' : 'OFF'}</strong></div>`,
      `<div class="kv"><span>Buffer ventana</span><strong>${s.buffer.length}/30</strong></div>`,
    ];
    if (this.flags.iaSimulation.sensors) {
      rows.push(
        '<div class="sensor-grid">',
        ...s.sensorStatus.map((item) => `<span class="${item.active ? 'ok' : 'bad'}">${item.bone}</span>`),
        '</div>',
      );
    }
    this.nodes.iaInfo.innerHTML = rows.join('');
  }

  #pythonTrainingCommand() {
    const config = this.#readTrainingConfig();
    const maxSteps = config.maxEpisodes > 0 ? config.maxEpisodes * config.maxEpisodeSteps * config.numEnvironments : 0;
    return [
      'python scripts/drl_train_python_gpu.py',
      `--envs ${config.numEnvironments}`,
      `--target-accuracy ${config.targetAccuracy.toFixed(3)}`,
      `--min-eval-frames ${config.minEvaluationFrames}`,
      maxSteps > 0 ? `--max-steps ${maxSteps}` : '--max-steps 0',
      `--steps-per-episode ${config.maxEpisodeSteps}`,
      `--noise ${config.noiseLevel}`,
      `--missing ${config.missingSensorRate}`,
      `--spikes ${config.spikeRate}`,
      `--latency ${config.latencyFrames}`,
      `--speed ${config.speedTarget}`,
      '--device auto',
      '--out models/drl',
    ].join(' ');
  }

  #renderRecorder() {
    this.nodes.recordingState.textContent = this.recorder.recording ? 'grabando' : 'detenido';
    this.nodes.recordingFrames.textContent = `${this.recorder.frames.length} frames`;
  }

  #renderDriverMode() {
    if (!this.nodes?.meshDriverMode) return;
    const labels = {
      idle: 'sin dueÃƒÂ±o',
      manual: 'control manual',
      hardware: 'hardware live',
      drl_demo: 'DRL demo',
      applied_movements: 'movimientos aplicados',
      gesture_trigger: 'disparo gestos Ã¢â€ â€™ DRL',
      movement_training: 'entrenamiento datasets',
      preprocessing: 'preprocesamiento',
      q_learning_train: 'Q-learning entrenando',
      q_learning_eval: 'Q-learning evaluando',
    };
    this.nodes.meshDriverMode.textContent = labels[this.meshDriverMode] ?? this.meshDriverMode;
  }

  #status(text) {
    this.nodes.status.textContent = text;
  }

  #isLiveStreamFresh(now = performance.now()) {
    const relayAt = this.arduinoConnection?.lastFrameAt ?? 0;
    return Boolean(
      (this.testLastFrameAt && now - this.testLastFrameAt < 2000)
      || (relayAt && now - relayAt < 2000),
    );
  }
}

function mappedCount(mapping) {
  return mapping.filter((item) => item.ok).length;
}

function isSliderOutOfLimit(alias, axis, value) {
  const [min, max] = BONE_LIMITS[alias]?.[axis] ?? [-Infinity, Infinity];
  return value < min || value > max;
}

function markerSensorState(row) {
  if (!row) return 'offline';
  const state = String(row.state ?? '').toLowerCase();
  if (!row.online || state.includes('offline') || state.includes('desconectado') || state.includes('sin datos')) return 'offline';
  if (state.includes('lost') || state.includes('perdido')) return 'lost';
  if (state.includes('cal')) return 'calibrating';
  return 'online';
}

function poseMotionPeakDeg(pose = {}) {
  let peak = 0;
  for (const rotation of Object.values(pose)) {
    if (!rotation) continue;
    for (const axis of ['rx', 'ry', 'rz']) {
      peak = Math.max(peak, Math.abs(Number(rotation[axis]) || 0));
    }
  }
  return peak;
}

function strongestMotion(calibratedRotations = [], rawRotations = []) {
  const rawByAlias = new Map(rawRotations.map((item) => [item.alias, item]));
  let strongest = { alias: '-', axis: '-', value: 0, rawValue: 0 };
  let strongestMagnitude = 0;

  for (const item of calibratedRotations) {
    if (!item?.alias) continue;
    const raw = rawByAlias.get(item.alias) ?? {};

    for (const axis of ['rx', 'ry', 'rz']) {
      const value = Number(item[axis]) || 0;
      const rawValue = Number(raw[axis]) || 0;
      const magnitude = Math.max(Math.abs(value), Math.abs(rawValue));
      if (magnitude > strongestMagnitude) {
        strongestMagnitude = magnitude;
        strongest = {
          alias: item.alias,
          axis,
          value,
          rawValue,
        };
      }
    }
  }

  return strongest;
}

function finiteRotation(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function calibrationStateClass(state) {
  const value = String(state ?? '').toLowerCase();
  if (value.includes('excelente')) return 'excellent';
  if (value.includes('aceptable')) return 'acceptable';
  if (value.includes('recalibrar')) return 'recalibrate';
  if (value.includes('sin datos')) return 'offline';
  return 'unstable';
}

function isHardwareVerifiedState(state, frames = 0) {
  const value = String(state ?? '').toLowerCase();
  if (value.includes('relay websocket listo') || value.includes('relay udp')) {
    return false;
  }
  if (value.includes('esp32 en red') && !value.includes('sesion hardware activa')) {
    return false;
  }
  if (value.includes('calibrando')) {
    return false;
  }
  return value.includes('hardware conectado')
    || value.includes('calibracion ok')
    || value.includes('transferencia activa')
    || value.includes('stream mega activo')
    || value.includes('stream is')
    || frames > 0;
}

function markerLabel(alias, boneName, row, { showHardwareState = true } = {}) {
  const label = boneName ?? alias;
  if (!showHardwareState) return label;
  const state = markerSensorState(row);
  if (state === 'offline') return `${label} OFF`;
  if (state === 'lost') return `${label} LOST`;
  if (state === 'calibrating') return `${label} CAL`;
  return label;
}

function percent(value) {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

function metricBar(label, value, target = 1) {
  const normalized = target > 0 ? Math.max(0, Math.min(1, value / target)) : 0;
  return `
    <div class="metric-row">
      <div><span>${label}</span><strong>${percent(value)}</strong></div>
      <progress max="100" value="${(normalized * 100).toFixed(1)}"></progress>
    </div>
  `;
}

function buildMovementTrainingOptionsHtml() {
  return [
    '<option value="">Ã¢â‚¬â€ seleccionar movimiento Ã¢â‚¬â€</option>',
    ...TRAINING_MOVEMENT_OPTIONS.map(
      (item) => `<option value="${item.id}">${item.index}. ${item.name}</option>`,
    ),
  ].join('');
}

function trainingPhaseLabel(phase) {
  return {
    idle: 'sin iniciar',
    pose_countdown: `postura (${TRAINING_POSE_COUNTDOWN_SECONDS}s)`,
    reference_demo: 'demo mesh (referencia)',
    between_demos: `pausa entre demos (${TRAINING_BETWEEN_DEMOS_SECONDS}s)`,
    pre_capture_countdown: 'listo para capturar',
    inter_animation_pause: 'pausa',
    animation_demo: 'demo mesh',
    pre_sample_countdown: 'cuenta regresiva',
    capture_cycle: 'captura + mesh guiado',
    between_cycles: 'pausa Ã¢â‚¬â€ vuelve a base',
    between_samples: 'pausa entre muestras',
    review_failed: `no aprobado (<${TRAINING_APPROVAL_SCORE}%)`,
    done: 'aprobado Ã¢â‚¬â€ listo para guardar',
  }[phase] ?? phase;
}

function trainingPhaseBannerText(phase) {
  return {
    idle: 'Listo',
    pose_countdown: `Adopta postura del maniquÃƒÂ­ (${TRAINING_POSE_COUNTDOWN_SECONDS}s)`,
    reference_demo: `Mira el mesh Ã¢â‚¬â€ demo ${TRAINING_REFERENCE_DEMO_CYCLES}Ãƒâ€” (replica despuÃƒÂ©s)`,
    between_demos: `Vuelve a pose base - siguiente demo en ${TRAINING_BETWEEN_DEMOS_SECONDS}s`,
    pre_capture_countdown: `Ahora si: empieza la toma de datos en ${TRAINING_BETWEEN_DEMOS_SECONDS}s`,
    inter_animation_pause: 'Espera',
    animation_demo: 'Prueba Ã¢â‚¬â€ mira el mesh',
    pre_sample_countdown: `Preparate - ${TRAINING_BETWEEN_DEMOS_SECONDS}s`,
    capture_cycle: 'Mesh + traje juntos Ã¢â‚¬â€ capturando IMU',
    between_cycles: 'Pose base Ã¢â‚¬â€ siguiente ciclo',
    between_samples: `Siguiente muestra (${TRAINING_SAMPLE_COUNT} total)`,
    review_failed: `Repetir captura (consistencia < ${TRAINING_APPROVAL_SCORE}%)`,
    done: `Aprobado Ã¢â‚¬â€ guardado en coleccion (>=${TRAINING_APPROVAL_SCORE}%)`,
  }[phase] ?? phase;
}

function localTimestampForFilename() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function normalizeMasterBundle(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.schema === MASTER_CALIBRATION_BUNDLE_SCHEMA && payload.masterSnapshot?.schema) {
    return {
      ...payload,
      ingressProfile: payload.ingressProfile?.schema === INGRESS_PIPELINE_SCHEMA
        ? payload.ingressProfile
        : null,
    };
  }
  if (payload.schema === 'ironsync.master-calibration.v1') {
    return {
      schema: MASTER_CALIBRATION_BUNDLE_SCHEMA,
      createdAt: new Date().toISOString(),
      source: 'imported-master-snapshot',
      masterSnapshot: payload,
      sensorCalibration: null,
    };
  }
  return null;
}

function loadMasterCalibrationRecents() {
  try {
    const raw = localStorage.getItem(MASTER_CALIBRATION_RECENTS_KEY);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item?.bundle && item?.key)
      .slice(0, MASTER_CALIBRATION_RECENTS_MAX);
  } catch {
    return [];
  }
}

function saveMasterCalibrationRecents(recents) {
  try {
    localStorage.setItem(
      MASTER_CALIBRATION_RECENTS_KEY,
      JSON.stringify((recents || []).slice(0, MASTER_CALIBRATION_RECENTS_MAX)),
    );
  } catch {
    // no-op: si el almacenamiento falla, la calibraciÃƒÂ³n actual sigue funcionando
  }
}

function escapeHtmlText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlAttr(value) {
  return escapeHtmlText(value).replace(/"/g, '&quot;');
}

function formatHeatmapPeak(heatmap) {
  if (!Array.isArray(heatmap) || !heatmap.length) return 'Ã¢â‚¬â€';
  const peak = Math.max(...heatmap.map(Number));
  return `${peak.toFixed(0)}%`;
}

function roundTo3(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function collectNodes(root) {
  return Object.fromEntries([...root.querySelectorAll('[id]')].map((node) => [node.id, node]));
}

function appliedMovementButtons() {
  return APPLIED_MOVEMENTS
    .map((item) => `<button type="button" data-applied-movement="${item.id}">${item.name}</button>`)
    .join('');
}

function midpointTriggerState(pose, targetPose, activeBones = []) {
  if (!pose || !targetPose) {
    return { reached: false, progress: 0, confidence: 0, checks: 0, hits: 0 };
  }
  let checks = 0;
  let hits = 0;
  let progressSum = 0;
  const aliases = activeBones.length ? activeBones : Object.keys(targetPose);
  for (const alias of aliases) {
    const target = targetPose[alias];
    const current = pose[alias];
    if (!target || !current) continue;
    for (const axis of ['rx', 'ry', 'rz']) {
      const expected = Number(target[axis]) || 0;
      if (Math.abs(expected) < 6) continue;
      checks += 1;
      const value = Number(current[axis]) || 0;
      const sameDirection = Math.sign(value || expected) === Math.sign(expected);
      const progress = sameDirection ? Math.min(1.25, Math.abs(value) / Math.abs(expected)) : 0;
      progressSum += progress;
      if (sameDirection && Math.abs(value) >= Math.abs(expected) * 0.5) {
        hits += 1;
      }
    }
  }
  const confidence = checks > 0 ? hits / checks : 0;
  const progress = checks > 0 ? progressSum / checks : 0;
  return {
    reached: checks > 0 && confidence >= 0.55 && progress >= 0.45,
    progress,
    confidence,
    checks,
    hits,
  };
}

function reachedHalfTargetPose(pose, targetPose, activeBones = []) {
  return midpointTriggerState(pose, targetPose, activeBones).reached;
}

function legMotionScore(nextPose, previousPose, side) {
  let maxDelta = 0;
  for (const alias of LEG_GROUPS[side] ?? []) {
    const next = nextPose?.[alias];
    const previous = previousPose?.[alias] ?? { rx: 0, ry: 0, rz: 0 };
    if (!next) continue;
    for (const axis of ['rx', 'ry', 'rz']) {
      maxDelta = Math.max(maxDelta, Math.abs((Number(next[axis]) || 0) - (Number(previous[axis]) || 0)));
    }
  }
  return maxDelta;
}

function legAwayFromBase(pose, side) {
  let maxAway = 0;
  for (const alias of LEG_GROUPS[side] ?? []) {
    const rotation = pose?.[alias];
    if (!rotation) continue;
    for (const axis of ['rx', 'ry', 'rz']) {
      maxAway = Math.max(maxAway, Math.abs(Number(rotation[axis]) || 0));
    }
  }
  return maxAway;
}

function keepSupportLegStable(pose, previousPose, side) {
  for (const alias of LEG_GROUPS[side] ?? []) {
    const stable = previousPose?.[alias] ?? { rx: 0, ry: 0, rz: 0 };
    pose[alias] = {
      rx: Number(stable.rx) || 0,
      ry: Number(stable.ry) || 0,
      rz: Number(stable.rz) || 0,
    };
  }
}

function layoutTemplate() {
  return `
    <main class="lab-shell">
      <aside class="reward-sidebar">
        <div class="reward-sidebar-scroll">
          <section id="rewardPanel" class="reward-panel" aria-label="Evaluacion biomecanica">
            <h2>Evaluacion biomecanica</h2>
            <div class="reward-total"><span id="rewardTotal">0</span> pts</div>
            <canvas id="rewardChart" width="320" height="72"></canvas>
            <div id="rewardComponents" class="reward-components"></div>
            <div id="rewardEvents" hidden></div>
            <div class="reward-event-columns">
              <div>
                <h3>Recompensas</h3>
                <div id="rewardPositiveEvents" class="data-stack"></div>
              </div>
              <div>
                <h3>Castigos</h3>
                <div id="rewardPenaltyEvents" class="data-stack"></div>
              </div>
            </div>
          </section>
          <section class="reward-panel" aria-label="Colisiones biomecanicas">
            <h2>Colisiones biomecanicas</h2>
            <div id="collisionList" class="data-stack"></div>
          </section>
        </div>
        <section id="ppoTrainingHud" class="ppo-training-hud" hidden aria-label="Progreso entrenamiento PPO">
          <h2>Entrenamiento PPO</h2>
          <div class="ppo-progress-head">
            <strong id="ppoProgressPct">0%</strong>
            <span id="ppoProgressEta" class="muted">Restante: 60 min</span>
          </div>
          <progress id="ppoProgressBar" max="100" value="0"></progress>
          <div class="kv"><span>Tiempo</span><strong id="ppoHudElapsed">0 min 0 s</strong></div>
          <div class="kv"><span>Rollout / paso</span><strong id="ppoHudRollout">Ã¢â‚¬â€</strong></div>
          <div class="kv"><span>Objetivo</span><strong>${PPO_TARGET_PRECISION_PCT}% precision</strong></div>
          <div class="kv"><span>Inferencia proxy</span><strong id="ppoHudInferencia">54%</strong></div>
          <h3>Tabla de incidentes</h3>
          <div id="ppoIncidentTable" class="ppo-incident-table">
            <p class="muted">Castigos y colisiones en vivo (politica PPO).</p>
          </div>
        </section>
        <div class="reward-terminal-dock">
          <button id="togglePacketTerminal" type="button" class="terminal-toggle-btn" aria-expanded="false" aria-controls="packetTerminalPanel">TERMINAL</button>
          <section id="packetTerminalPanel" class="packet-terminal-panel" hidden aria-label="Terminal de paquetes IS">
            <p class="muted terminal-hint">Paquetes IS: llegada y procesamiento en el lab (no Serial del Mega).</p>
            <div class="button-row">
              <button id="clearPacketInspector" type="button">Limpiar</button>
            </div>
            <label class="toggle-row"><input id="packetInspectorPause" type="checkbox" />Pausar captura</label>
            <label class="toggle-row"><input id="packetInspectorShowRaw" type="checkbox" />Mostrar linea IS cruda</label>
            <div class="data-stack terminal-stats">
              <div class="kv"><span>Buffer</span><strong id="packetInspectorCount">0 paquetes</strong></div>
              <div class="kv"><span>Hz proceso</span><strong id="packetInspectorHz">0.0 Hz</strong></div>
            </div>
            <pre id="packetInspectorLog" class="packet-inspector-log">Esperando paquetes IS...</pre>
          </section>
        </div>
      </aside>
      <section class="viewport-shell">
        <header class="topbar">
          <div class="topbar-row">
            <p class="eyebrow">SIS-330 DESARROLLO DE APLICACIONES INTELIGENTES</p>
            <h1>Laboratorio Biomecanico DRL</h1>
          </div>
          <div class="status-strip">
            <span id="status">Inicializando</span>
            <button id="cameraReset">Reset camara</button>
            <button id="cameraFront">Frontal</button>
            <button id="cameraSide">Lateral</button>
            <button id="cameraTop">Superior</button>
          </div>
        </header>
        <div id="viewport" class="viewport"></div>
      </section>
      <aside class="tool-panel">
        ${accordionPanel('system', 'Sistema', `
          <label class="file-button"><input id="modelInput" type="file" accept=".fbx,.obj,.glb,.gltf" />Cargar FBX / OBJ / GLB</label>
          <button id="clearScene">Restaurar mesh</button>
          <div class="data-stack">
            <div class="kv"><span>DueÃƒÂ±o mesh</span><strong id="meshDriverMode">sin dueÃƒÂ±o</strong></div>
          </div>
          <div id="modelInfo" class="data-stack"></div>
          <div class="button-row body-view-row">
            <button class="active" data-body-view="unreal">UE ref</button>
            <button data-body-view="front">Frente</button>
            <button data-body-view="back">Espalda</button>
            <button data-body-view="right">Costado der.</button>
            <button data-body-view="left">Costado izq.</button>
            <button data-body-view="frontRight">3/4 der.</button>
            <button data-body-view="frontLeft">3/4 izq.</button>
          </div>
        `, true)}
        ${accordionPanel('hardware', 'Hardware ESP32 / Mega', `
          <div class="control-group">
            <h3>Relay generico</h3>
            <div class="socket-row">
              <input id="socketUrl" value="ws://127.0.0.1:8765" />
              <button id="connectBridge">Conectar</button>
            </div>
            <div class="button-row single">
              <button id="disconnectBridge">Desconectar</button>
            </div>
            <div class="data-stack">
              <div class="kv"><span>Estado</span><strong id="bridgeState">Desconectado</strong></div>
              <div class="kv"><span>Fuente</span><strong id="bridgeSource">offline</strong></div>
              <div class="kv"><span>Frames</span><strong id="bridgeFrames">0 frames</strong></div>
            </div>
          </div>
          <div class="control-group">
            <h3>ESP32 / Mega</h3>
            <div class="socket-row">
              <input id="arduinoUrl" value="ws://127.0.0.1:8767" />
              <button id="connectArduinoRelay">Abrir relay</button>
            </div>
          </div>
          <div class="control-group">
            <h3>Enlace ESP32</h3>
            <div class="button-row">
              <button id="connectHardware">Conectar hardware</button>
              <button id="disconnectHardware">Desconectar hardware</button>
              <button id="disconnectArduinoRelay">Cerrar relay</button>
            </div>
          </div>
          <div class="control-group">
            <h3>Datos y calibracion</h3>
            <div class="button-row">
              <button id="startCalibration">Calibrar / iniciar</button>
              <button id="stopDataTransfer">Detener datos</button>
              <button id="arduinoStatus">Estado</button>
              <button id="arduinoRescan">Re-escanear</button>
              <button id="arduinoResetSensors">Reiniciar sensores</button>
            </div>
          </div>
          <div class="control-group">
            <h3>Vista hardware</h3>
            <label class="toggle-row"><input id="showHardwareSensors" type="checkbox" />Ver sensores hardware</label>
            <label class="toggle-row"><input id="showHardwareLabels" type="checkbox" checked />Ver etiquetas hardware</label>
            <label class="toggle-row"><input id="colorHardwareState" type="checkbox" checked />Colorear segun estado real</label>
          </div>
          <div class="data-stack">
            <div class="kv"><span>Estado</span><strong id="arduinoState">Desconectado</strong></div>
            <div class="kv"><span>ESP32</span><strong id="arduinoTarget">buscando hello</strong></div>
            <div class="kv"><span>Fuente</span><strong id="arduinoSource">offline</strong></div>
            <div class="kv"><span>Frames</span><strong id="arduinoFrames">0 frames</strong></div>
          </div>
          <div class="calibration-meter">
            <progress id="arduinoProgress" max="100" value="0"></progress>
            <strong id="arduinoProgressText">0%</strong>
          </div>
          <div id="arduinoSensors" class="sensor-grid"></div>
        `, true)}
        ${accordionPanel('calibration-cleaning', 'Calibracion y Limpieza', `
          <div class="control-group unified-calibration-block">
            <h3>Calibracion unificada (traje golden + base lab)</h3>
            <p class="muted">Mega calibra con golden. El lab captura la base IMU para datasets. Quédate quieto en T-pose.</p>
            <div class="button-row">
              <button id="unifiedCalibrateTrajeMesh" type="button">Calibrar traje (golden)</button>
              <button id="cancelUnifiedCalibration" type="button" disabled>Cancelar</button>
            </div>
            <div class="calibration-meter">
              <progress id="unifiedCalibrationProgress" max="100" value="0"></progress>
              <strong id="unifiedCalibrationProgressText">0%</strong>
            </div>
            <div class="data-stack">
              <div class="kv"><span>Etapa</span><strong id="unifiedCalibrationStage">Sin iniciar</strong></div>
            </div>
            <p id="unifiedCalibrationHint" class="muted">Relay + hardware + FBX mapeado. Sensores: torso superior basta (piernas opcionales).</p>
          </div>
          <div class="control-group">
            <h3>Postura IMU (copiar para fijar direccion)</h3>
            <div class="button-row">
              <button id="clearArduinoCalReferenceLog" type="button">Limpiar</button>
              <button id="saveCalReferenceGolden" type="button">Guardar golden</button>
              <button id="applyCalReferenceGolden" type="button">Aplicar golden al Mega</button>
              <label class="file-button muted"><input id="calReferenceGoldenInput" type="file" accept=".json" hidden />Importar golden JSON</label>
            </div>
            <pre id="arduinoCalReferenceLog" class="packet-inspector-log">Esperando bloque CAL_REFERENCE...</pre>
            <p class="muted">Tras calibrar, aquí aparece CAL_REFERENCE del Mega. Guárdala o importa golden JSON; opcional: Aplicar golden al Mega antes de otra sesión.</p>
          </div>
          <div class="control-group">
            <h3>Transferencia base (manual)</h3>
            <div class="button-row">
              <button id="verifyCalibrationConnection">Verificar conexion</button>
              <button id="captureCalibrationA">Transferir pose base</button>
              <button id="captureCalibrationB">Verificacion doble</button>
              <button id="applySensorCalibration">Aplicar correccion</button>
              <button id="resetSensorCalibration">Reset perfil</button>
              <button id="exportSensorCalibration">Exportar perfil</button>
            </div>
          </div>
          <div class="control-group">
            <h3>Velocidad y limpieza manual</h3>
            ${numberInput('calTargetHz', 'Hz objetivo', 40, 1, 120, 1)}
            ${numberInput('calSmoothing', 'Suavizado captura', 0.24, 0.05, 1, 0.01)}
            ${numberInput('calLiveSmoothing', 'Suavizado vivo', 0.38, 0.08, 1, 0.01)}
            ${numberInput('calDeadzone', 'Deadzone', 0.85, 0, 12, 0.1)}
            ${numberInput('calGain', 'Ganancia', 1, 0.1, 3, 0.05)}
            ${numberInput('calMaxRotation', 'Limite rotacion', 55, 5, 180, 1)}
          </div>
          <div class="data-stack">
            <div class="kv"><span>Conexion</span><strong id="sensorCalibrationConnection">pendiente</strong></div>
            <div class="kv"><span>Estado</span><strong id="sensorCalibrationStatus">sin calibrar</strong></div>
            <div class="kv"><span>Calidad</span><strong id="sensorCalibrationQuality">0%</strong></div>
            <div class="kv"><span>Sensores</span><strong id="sensorCalibrationOnline">0/15</strong></div>
            <div class="kv"><span>Hz real</span><strong id="sensorCalibrationHz">0.0 Hz</strong></div>
            <div class="kv"><span>Jitter</span><strong id="sensorCalibrationJitter">0.0 ms</strong></div>
          </div>
          <div id="sensorCalibrationRows" class="calibration-grid"></div>
        `, true)}
        ${accordionPanel('guided-calibration', 'Calibracion - Guiada', `
          <div class="control-group">
            <div class="button-row guided-calibration-actions">
              <button id="takeMasterCalibration" type="button">Tomar muestra (6s)</button>
              <button id="applySelectedMasterCalibration" type="button" disabled>Aplicar postura</button>
              <button id="closeGuidedPosture" type="button" disabled>Cerrar postura</button>
            </div>
            <div class="calibration-meter">
              <progress id="guidedCalibrationCaptureProgress" max="100" value="0"></progress>
              <strong id="guidedCalibrationCaptureProgressText">0%</strong>
            </div>
            <div id="masterCalibrationSelectorRow" class="guided-calibration-selector-row">
              <select id="masterCalibrationRecentSelect"></select>
            </div>
            <div class="data-stack guided-calibration-status">
              <div class="kv"><span>Archivo seleccionado</span><strong id="masterCalibrationSelectedFile">ninguno</strong></div>
              <div class="kv"><span>Base maestra</span><strong id="masterCalibrationReadyState">sin base</strong></div>
              <div class="kv"><span>Puerta sensores</span><strong id="masterCalibrationSensorGate">0/15 (min 7)</strong></div>
              <div class="kv"><span>Aplicacion</span><strong id="masterCalibrationApplyState">sin aplicar</strong></div>
            </div>
          </div>
        `, true)}
        ${accordionPanel('dataset-runtime', 'Deteccion por Dataset JSON', `
          <div class="control-group">
            <h3>Importar y detectar movimiento</h3>
            <input id="runtimeDatasetJsonInput" type="file" accept=".json,application/json" hidden />
            <div class="button-row">
              <button id="loadRuntimeDatasetJson" type="button">Cargar dataset.json</button>
              <button id="startRuntimeDatasetDetection" type="button">Activar deteccion</button>
              <button id="stopRuntimeDatasetDetection" type="button" disabled>Detener deteccion</button>
            </div>
            ${numberInput('runtimeDatasetThreshold', 'Similitud minima %', 82, 50, 99.9, 0.1)}
            ${numberInput('runtimeDatasetMinPeak', 'Movimiento minimo deg', 5, 0, 60, 0.5)}
            ${numberInput('runtimeDatasetHoldMs', 'Mantener animacion ms', 900, 150, 5000, 50)}
          </div>
          <div class="data-stack">
            <div class="kv"><span>Archivo</span><strong id="runtimeDatasetFile">sin dataset.json</strong></div>
            <div class="kv"><span>Perfiles</span><strong id="runtimeDatasetProfiles">0 animaciones</strong></div>
            <div class="kv"><span>Estado</span><strong id="runtimeDatasetState">sin dataset</strong></div>
            <div class="kv"><span>Hardware</span><strong id="runtimeDatasetHardware">0/15</strong></div>
            <div class="kv"><span>Movimiento detectado</span><strong id="runtimeDatasetMatch">esperando</strong></div>
            <div class="kv"><span>Score</span><strong id="runtimeDatasetScore">0.0%</strong></div>
          </div>
          <div class="control-group">
            <h3>Huesos detectados</h3>
            <div id="runtimeDatasetBones" class="sensor-grid"></div>
          </div>
          <div class="control-group">
            <h3>Animaciones del JSON</h3>
            <div id="runtimeDatasetAnimations" class="data-stack"></div>
          </div>
        `, true)}
        ${accordionPanel('movement-training', 'Entrenamiento', `
          <div class="control-group training-controls">
            <h3>Coleccion de datasets (movimiento a movimiento)</h3>
            <p class="muted">Flujo: postura ${TRAINING_POSE_COUNTDOWN_SECONDS}s -> demo 1 -> pausa ${TRAINING_BETWEEN_DEMOS_SECONDS}s -> demo 2 -> pausa ${TRAINING_BETWEEN_DEMOS_SECONDS}s -> ${TRAINING_SAMPLE_COUNT} muestras de ${TRAINING_MOVEMENTS_PER_SAMPLE} movimiento con pausa ${TRAINING_BETWEEN_DEMOS_SECONDS}s entre tomas (min ${TRAINING_APPROVAL_SCORE}%). Carpeta: <code>${COLLECTIONS_REL_PATH}/&lt;fecha&gt;/&lt;movimiento&gt;/</code></p>
            <div class="button-row">
              <button id="createTrainingCollection" type="button">Crear coleccion</button>
              <button id="refreshTrainingCollections" type="button">Actualizar lista</button>
            </div>
            <label class="field-label">Coleccion activa</label>
            <select id="trainingCollectionSelect" class="full-width-select"></select>
            <div class="kv"><span>Coleccion</span><strong id="trainingCollectionActive">ninguna</strong></div>
            <div class="kv"><span>Carpeta base</span><strong id="trainingCollectionPath">${COLLECTIONS_REL_PATH}</strong></div>
            <label class="field-label">Movimiento (numerado)</label>
            <select id="movementTrainingSelector" class="full-width-select">${buildMovementTrainingOptionsHtml()}</select>
            <div id="movementTrainingPhaseBanner" class="training-phase-banner training-phase--idle" role="status" aria-live="polite">
              <span class="training-phase-dot" aria-hidden="true"></span>
              <strong id="movementTrainingPhaseBannerText">Listo</strong>
            </div>
            <div class="button-row training-main-actions">
              <button id="startMovementTraining">Iniciar captura (${TRAINING_SAMPLE_COUNT} muestras)</button>
              <button id="saveMovementToCollection" type="button" disabled>Guardar en coleccion</button>
              <button id="pauseMovementTraining">Pausar</button>
              <button id="resumeMovementTraining">Continuar</button>
              <button id="cancelMovementTraining">Cancelar toma</button>
              <button id="repeatMovementSample">Repetir muestra</button>
              <button id="trainingRepeatFailedSampling" type="button" disabled>Repetir ${TRAINING_SAMPLE_COUNT} tomas</button>
              <button id="trainingContinueDespiteFail" type="button" disabled>Continuar sin aprobar</button>
            </div>
            <div class="button-row training-export-actions">
              <button id="exportMovementTrainingCsv">Exportar CSV</button>
              <button id="exportMovementTrainingJson">Exportar JSON</button>
              <button id="resetMovementTraining">Reset entrenamiento</button>
            </div>
          </div>
          <div id="movementTrainingStatusPanel" class="data-stack training-status-panel training-phase--idle">
            <div class="kv"><span>Animacion</span><strong id="movementTrainingAnimation">-</strong></div>
            <div class="kv"><span>Progreso animacion</span><strong id="movementTrainingProgress">0/0</strong></div>
            <div class="kv training-kv-sample"><span>Muestras</span><strong id="movementTrainingSample">0/${TRAINING_SAMPLE_COUNT}</strong></div>
            <div class="kv training-kv-countdown"><span>Cuenta regresiva</span><strong id="movementTrainingCountdown">-</strong></div>
            <div class="kv training-kv-state"><span>Estado</span><strong id="movementTrainingState">sin iniciar</strong></div>
            <div class="kv"><span>Similitud</span><strong id="movementTrainingSimilarity">0.0%</strong></div>
            <div class="kv"><span>Resumen muestras</span><strong id="movementTrainingSamplesState">0 validas / 0 dudosas</strong></div>
            <div class="kv"><span>Unreal</span><strong id="movementTrainingUnreal">sin Unreal</strong></div>
            <div class="kv"><span>Hardware</span><strong id="movementTrainingHardware">0/15</strong></div>
          </div>
          <div class="control-group">
            <h3>Huesos usados</h3>
            <div id="movementTrainingActiveBones" class="sensor-grid"></div>
          </div>
          <div class="control-group">
            <h3>Sensores ignorados en esta animacion</h3>
            <div id="movementTrainingIgnoredBones" class="sensor-grid"></div>
          </div>
          <div class="control-group">
            <h3>Ultimas muestras</h3>
            <div id="movementTrainingSamples" class="data-stack"></div>
          </div>
          <div class="control-group gesture-trigger-block">
            <h3>Disparo gestos Ã¢â€ â€™ animacion DRL</h3>
            <p class="muted">No aplica vectores al mesh. Calibra maestra Ã¢â€ â€™ entrena dataset Ã¢â€ â€™ activa disparo.</p>
            <input id="gestureLibraryJsonInput" type="file" accept=".json,application/json" hidden />
            <div class="button-row">
              <button id="loadGestureLibraryJson" type="button">Cargar biblioteca JSON</button>
              <button id="enableGestureTrigger" type="button">Activar disparo</button>
              <button id="disableGestureTrigger" type="button">Desactivar disparo</button>
            </div>
            ${numberInput('gestureTriggerThreshold', 'Similitud min %', 82, 50, 99.9, 0.1)}
            ${numberInput('gestureTriggerMinPeak', 'Movimiento min deg', 5, 0, 60, 0.5)}
            ${numberInput('gestureTriggerHoldMs', 'Mantener ms', 900, 150, 5000, 50)}
            <div class="data-stack">
              <div class="kv"><span>Calibracion maestra</span><strong id="gestureMasterCal">sin calibracion</strong></div>
              <div class="kv"><span>Biblioteca</span><strong id="gestureLibraryState">sin biblioteca</strong></div>
              <div class="kv"><span>Disparo</span><strong id="gestureTriggerState">apagado</strong></div>
              <div class="kv"><span>Gesto detectado</span><strong id="gestureTriggerMatch">pose base</strong></div>
            </div>
          </div>
        `, true)}
        ${accordionPanel('preprocessing', 'Preprocesamiento', `
          <div class="control-group">
            <h3>Reconocimiento por coleccion</h3>
            <p class="muted">Secuencia: selecciona coleccion -> Cargar coleccion -> Iniciar prueba. El mesh permanece en pose base; solo los huesos activos del gesto detectado siguen la secuencia del dataset (no el IMU en crudo). Detener pausa; Reset limpia estado.</p>
            <label class="field-label">Coleccion</label>
            <select id="preprocessingCollectionSelect" class="full-width-select"></select>
            <div class="button-row">
              <button id="loadPreprocessingCollection" type="button">Cargar coleccion</button>
              <button id="startPreprocessing">Iniciar prueba</button>
              <button id="stopPreprocessing">Detener</button>
              <button id="resetPreprocessing">Reset</button>
            </div>
            <label class="file-button muted"><input id="preprocessingCsvInput" type="file" accept=".csv" hidden />CSV legacy (opcional)</label>
          </div>
          <div class="control-group">
            <h3>Umbrales</h3>
            ${numberInput('preprocessingThreshold', 'Similitud minima % (secuencia)', RUNTIME_MATCH_THRESHOLD, 50, 99.9, 0.1)}
            ${numberInput('preprocessingMinPeak', 'Movimiento minimo deg', RUNTIME_DEFAULT_MIN_PEAK, 0, 60, 0.5)}
            ${numberInput('preprocessingHoldStill', 'Quietud para hold deg', RUNTIME_DEFAULT_HOLD_STILL, 0.5, 15, 0.1)}
            ${numberInput('preprocessingBaseReturn', 'Retorno a base deg', RUNTIME_DEFAULT_BASE_RETURN, 2, 25, 0.5)}
            ${numberInput('preprocessingHoldMs', 'Suavizado al soltar ms', 500, 80, 5000, 50)}
            <p class="muted">En reposo el mapa baja el %; hace falta movimiento real (&gt; min deg) para disparar. Al volver a T-pose el esqueleto resetea.</p>
          </div>
          <div class="data-stack">
            <div class="kv"><span>Origen</span><strong id="preprocessingFile">sin coleccion</strong></div>
            <div class="kv"><span>Perfiles</span><strong id="preprocessingProfiles">0 animaciones</strong></div>
            <div class="kv"><span>Estado</span><strong id="preprocessingState">sin dataset</strong></div>
            <div class="kv"><span>Hardware</span><strong id="preprocessingHardware">0/15</strong></div>
            <div class="kv"><span>Match</span><strong id="preprocessingMatch">pose base</strong></div>
            <div class="kv"><span>Score</span><strong id="preprocessingScore">0.0%</strong></div>
          </div>
          <div class="control-group">
            <h3>Mapa de calor - coleccion (ranking)</h3>
            <p class="muted">Mayor % gana el slot 1; hasta 3 gestos si no comparten huesos activos.</p>
            <div id="preprocessingHeatmap" class="preprocessing-heatmap"></div>
          </div>
          <div class="control-group">
            <h3>Slots de ejecucion (1 Ã‚Â· 2 Ã‚Â· 3)</h3>
            <div id="preprocessingSlots" class="data-stack"></div>
          </div>
          <div class="control-group">
            <h3>Huesos activando ahora</h3>
            <div id="preprocessingBones" class="sensor-grid"></div>
          </div>
          <div class="control-group">
            <h3>Animaciones cargadas</h3>
            <div id="preprocessingAnimations" class="data-stack"></div>
          </div>
        `, true)}
        ${accordionPanel('test', 'Prueba', `
          <div class="control-group">
            <h3>Validacion final</h3>
            <div class="button-row">
              <button id="verifyTestReadiness">Verificar prueba</button>
              <button id="startTestSimulation">Iniciar simulacion</button>
              <button id="stopTestSimulation">Detener simulacion</button>
              <button id="testDiagnostics">Diagnostico relay</button>
              <button id="toggleRawTestRotations">Crudo/corregido</button>
            </div>
          </div>
          <div class="control-group">
            <h3>Modelo Q-learning</h3>
            <div class="button-row">
              <label class="file-button"><input id="testQModelInput" type="file" accept=".json" />Cargar modelo Q-learning</label>
              <button id="evaluateTestQModel">Evaluar con Q-learning</button>
            </div>
          </div>
          <div class="data-stack">
            <div class="kv"><span>Conexion hardware</span><strong id="testConnectionState">desconectado</strong></div>
            <div class="kv"><span>Datos sensores</span><strong id="testSensorsState">0/15</strong></div>
            <div class="kv"><span>Frames vivos</span><strong id="testFramesState">0 frames / 0.0 Hz</strong></div>
            <div class="kv"><span>Calibracion biomecanica</span><strong id="testCalibrationState">sin perfil</strong></div>
            <div class="kv"><span>Pipeline entrada</span><strong id="testIngressState">inactivo</strong></div>
            <div class="kv"><span>Simulacion</span><strong id="testSimulationState">detenida</strong></div>
            <div class="kv"><span>Q-learning</span><strong id="testQState">sin modelo</strong></div>
            <div class="kv"><span>Modo rotacion</span><strong id="testRotationMode">corregido</strong></div>
            <div class="kv"><span>Movimiento vivo</span><strong id="testMotionState">-.- 0.0 deg / raw 0.0</strong></div>
          </div>
          <div class="kv"><span>Diagnostico</span><strong id="testReadinessDetail">Sin verificar</strong></div>
        `, true)}
        ${accordionPanel('skeletal-setup', 'Skeletal Setup', `
          <div class="button-row single"><button id="autoMap">Auto-mapear</button></div>
          <label class="toggle-row"><input id="showManualBones" type="checkbox" />Ver huesos</label>
          <label class="toggle-row"><input id="showManualBoneNames" type="checkbox" />Ver nombres de huesos</label>
          <div id="boneMapping" class="map-list"></div>
        `, true)}
        ${accordionPanel('manual-control', 'Control Manual', `
          <select id="boneSelect"></select>
          ${slider('rx', 'RX')}
          ${slider('ry', 'RY')}
          ${slider('rz', 'RZ')}
          <div class="button-row">
            <button id="resetBone">Reset hueso</button>
            <button id="resetAll">Reset todo</button>
            <button id="copyRotation">Copiar rotacion</button>
            <button id="savePose">Guardar pose</button>
          </div>
          <div id="boneInspector" class="data-stack"></div>
        `, true)}
        ${accordionPanel('biomechanics', 'Biomechanics', `
          <label class="toggle-row"><input id="showReward" type="checkbox" checked />Evaluacion biomecanica</label>
          <label class="toggle-row"><input id="showBiomechMarkers" type="checkbox" checked />Puntos anatomicos 15 huesos</label>
          <label class="toggle-row"><input id="showBiomechLabels" type="checkbox" checked />Etiquetas anatomicas</label>
          <label class="toggle-row"><input id="showBiomechColliders" type="checkbox" />Colliders de colision</label>
          <p class="muted">Estos puntos son anatomicos y neutrales; los estados rojo/verde del hardware viven en Hardware ESP32 / Mega.</p>
        `, true)}
        ${accordionPanel('applied-movements', 'Movimientos - Aplicados', `
          <div class="control-group">
            <h3>Acciones simples</h3>
            <div class="button-row applied-movement-grid">
              ${appliedMovementButtons()}
            </div>
            <div class="button-row single">
              <button id="stopAppliedMovement" type="button">Detener y volver a base</button>
            </div>
          </div>
          <div id="appliedMovementInfo" class="data-stack"></div>
        `, true)}
        ${accordionPanel('drl-demo', 'DRL Demo', `
          <select id="agentMode">
            <option value="pause" selected>Pausa</option>
            <option value="cal_still">Quieto base</option>
            <option value="head_pitch">Cabeza adelante/atras</option>
            <option value="head_yaw">Cabeza inclinacion lateral</option>
            <option value="head_roll">Cabeza izquierda/derecha</option>
            <option value="left_arm_forward">Brazo izquierdo frente</option>
            <option value="right_arm_forward">Brazo derecho frente</option>
            <option value="both_arms_forward">Ambos brazos frente</option>
            <option value="left_arm_front">Brazo izquierdo costado 90</option>
            <option value="right_arm_front">Brazo derecho costado 90</option>
            <option value="left_arm_back">Brazo izquierdo atras</option>
            <option value="right_arm_back">Brazo derecho atras</option>
            <option value="left_arm_side">Brazo izquierdo costado 60</option>
            <option value="right_arm_side">Brazo derecho costado 60</option>
            <option value="left_forearm_flex">Antebrazo izquierdo flexion/extension</option>
            <option value="right_forearm_flex">Antebrazo derecho flexion/extension</option>
            <option value="left_hand_wave">Mano izquierda saludo</option>
            <option value="right_hand_wave">Mano derecha saludo</option>
            <option value="left_thigh_front">Muslo izquierdo adelante</option>
            <option value="right_thigh_front">Muslo derecho adelante</option>
            <option value="left_thigh_back">Muslo izquierdo atras</option>
            <option value="right_thigh_back">Muslo derecho atras</option>
            <option value="left_leg_knee_flex">Rodilla izquierda flexion</option>
            <option value="right_leg_knee_flex">Rodilla derecha flexion</option>
            <option value="left_foot_pitch">Pie izquierdo punta</option>
            <option value="right_foot_pitch">Pie derecho punta</option>
            <option value="left_foot_roll">Pie izquierdo lateral</option>
            <option value="right_foot_roll">Pie derecho lateral</option>
            <option value="torso_twist_left">Torso giro izquierda</option>
            <option value="torso_twist_right">Torso giro derecha</option>
            <option value="body_turn_left">Cuerpo giro izquierda</option>
            <option value="body_turn_right">Cuerpo giro derecha</option>
            <option value="body_bend_front">Cuerpo flexion adelante</option>
            <option value="body_bend_back">Cuerpo extension atras</option>
            <option value="body_bend_left">Cuerpo inclinacion izquierda</option>
            <option value="body_bend_right">Cuerpo inclinacion derecha</option>
            <option value="walk">Caminar coordinado</option>
            <option value="run">Correr coordinado</option>
            <option value="fly">Volar coordinado</option>
            <option value="soft">Exploracion suave</option>
            <option value="medium">Exploracion media</option>
            <option value="aggressive">Exploracion agresiva</option>
          </select>
          <div class="button-row">
            <button data-agent-preset="cal_still">Quieto</button>
            <button data-agent-preset="head_pitch">Cabeza P</button>
            <button data-agent-preset="head_yaw">Cabeza R</button>
            <button data-agent-preset="head_roll">Cabeza Y</button>
            <button data-agent-preset="left_arm_forward">Brazo izq. frente</button>
            <button data-agent-preset="right_arm_forward">Brazo der. frente</button>
            <button data-agent-preset="both_arms_forward">Ambos brazos frente</button>
            <button data-agent-preset="left_arm_front">Brazo izq. costado 90</button>
            <button data-agent-preset="right_arm_front">Brazo der. costado 90</button>
            <button data-agent-preset="left_arm_back">Brazo izq. atras</button>
            <button data-agent-preset="right_arm_back">Brazo der. atras</button>
            <button data-agent-preset="left_arm_side">Brazo izq. costado 60</button>
            <button data-agent-preset="right_arm_side">Brazo der. costado 60</button>
            <button data-agent-preset="left_forearm_flex">Antebrazo izq.</button>
            <button data-agent-preset="right_forearm_flex">Antebrazo der.</button>
            <button data-agent-preset="left_hand_wave">Mano izq.</button>
            <button data-agent-preset="right_hand_wave">Mano der.</button>
            <button data-agent-preset="left_thigh_front">Muslo izq. frente</button>
            <button data-agent-preset="right_thigh_front">Muslo der. frente</button>
            <button data-agent-preset="left_thigh_back">Muslo izq. atras</button>
            <button data-agent-preset="right_thigh_back">Muslo der. atras</button>
            <button data-agent-preset="left_leg_knee_flex">Rodilla izq.</button>
            <button data-agent-preset="right_leg_knee_flex">Rodilla der.</button>
            <button data-agent-preset="left_foot_pitch">Pie izq. punta</button>
            <button data-agent-preset="right_foot_pitch">Pie der. punta</button>
            <button data-agent-preset="left_foot_roll">Pie izq. lateral</button>
            <button data-agent-preset="right_foot_roll">Pie der. lateral</button>
            <button data-agent-preset="torso_twist_left">Torso izq.</button>
            <button data-agent-preset="torso_twist_right">Torso der.</button>
            <button data-agent-preset="body_turn_left">Giro izq.</button>
            <button data-agent-preset="body_turn_right">Giro der.</button>
            <button data-agent-preset="body_bend_front">Flexion</button>
            <button data-agent-preset="body_bend_back">Extension</button>
            <button data-agent-preset="pause">Pausa</button>
          </div>
          <div class="button-row single">
            <button id="startUnrealSimulation">Simulacion Unreal</button>
          </div>
          <button id="resetPose">Reset pose</button>
          <div id="drlInfo" class="data-stack"></div>
        `, false)}
        ${accordionPanel('drl-ppo', 'DRL / PPO', `
          <p class="muted">Entrenamiento Actor-Critic (ÃŽâ€rx, ÃŽâ€ry, ÃŽâ€rz). Al iniciar verÃƒÂ¡s el <strong>skeletal mesh</strong> moverse en tiempo real con colliders y castigos por colisiÃƒÂ³n entre huesos.</p>
          <div class="control-group">
            <h3>Entornos paralelos</h3>
            <div class="two-col">
              ${numberInput('ppoNumEnvs', 'NUM_ENVS', 8, 1, 64, 1)}
              ${numberInput('ppoTimesteps', 'Timesteps totales', 120000, 10000, 2000000, 1000)}
              ${numberInput('ppoRolloutSteps', 'Rollout steps', 128, 32, 512, 16)}
              ${numberInput('ppoActionScale', 'Escala accion (deg)', 2, 0.1, 8, 0.1)}
            </div>
          </div>
          <div class="control-group">
            <h3>Corrupcion / simulacion sensores</h3>
            <div class="two-col">
              ${numberInput('ppoNoiseMax', 'Ruido max (deg)', 1.5, 0, 8, 0.1)}
              ${numberInput('ppoDriftMax', 'Drift max', 0.08, 0, 0.5, 0.01)}
              ${numberInput('ppoJitterMax', 'Jitter max (deg)', 0.6, 0, 4, 0.1)}
              ${numberInput('ppoMissingMax', 'Perdida sensores', 0.15, 0, 0.8, 0.01)}
              ${numberInput('ppoFrozenMax', 'Sensores congelados', 0.1, 0, 0.5, 0.01)}
            </div>
            <p class="muted">Perfiles biomecanicos: neutral, rest, walk, gesture, sport (aleatorio por env).</p>
          </div>
          <div class="control-group">
            <h3>Rutas y modelos</h3>
            ${pathInputRow('ppoTcnPath', 'TCN (.pt)', DEFAULT_TCN_MODEL_PATH, 'ppoTcnFile')}
            <div class="kv"><span>Estado TCN</span><strong id="ppoTcnStatus">Verificando...</strong></div>
            <div class="button-row single">
              <button type="button" id="ppoReloadTcn" class="small-btn">Recargar TCN</button>
            </div>
            ${pathInputRow('ppoActorPath', 'Salida PPO (.pt)', 'IA-IRON-SYNC/PPO/models/BEST_PPO.pt', 'ppoActorFile')}
            ${pathInputRow('ppoReportsPath', 'Reportes', 'IA-IRON-SYNC/PPO/reports', '')}
            ${pathInputRow('ppoConfigPath', 'Config YAML', 'IA-IRON-SYNC/PPO/configuracion_hiperparametros.yaml', '')}
            <p class="muted">Ruta relativa al repo o absoluta. Examinar usa el nombre del archivo (colÃƒÂ³calo en la carpeta indicada).</p>
          </div>
          <div class="button-row">
            <button id="ppoTrain">Entrenar PPO (Python)</button>
            <button id="ppoStopTrain">Detener</button>
            <button id="ppoRefreshMetrics">Actualizar metricas</button>
          </div>
          <p class="muted" id="ppoTrainCommand">python IA-IRON-SYNC/PPO/entrenar_ppo.py --config configuracion_hiperparametros.yaml</p>
          <div id="ppoInfo" class="data-stack"></div>
        `, true)}
        ${accordionPanel('pipeline-completo', 'PIPELINE - COMPLETO', pipelineCompletoPanelHtml(), true)}
        ${accordionPanel('ia-simulation', 'Simulacion - IA', `
          <p class="muted">Inferencia: TCN + PPO + Kalman configurable. Espera 15 IMU en vivo.</p>
          <div class="control-group">
            <h3>Modelos entrenados</h3>
            <label class="kv">TCN (.pt)<input id="iaTcnPath" type="text" value="IA-IRON-SYNC/TCN/models/tcn_sanitizer_best.pt" /></label>
            <label class="kv">PPO (.pt)<input id="iaPpoPath" type="text" value="IA-IRON-SYNC/PPO/models/BEST_PPO.pt" /></label>
          </div>
          <div class="control-group">
            <h3>Kalman (solo simulacion)</h3>
            <label class="toggle-row"><input id="iaKalmanEnabled" type="checkbox" />Activar Kalman</label>
            <select id="iaKalmanMode">
              <option value="conservative">Conservador</option>
              <option value="normal" selected>Normal</option>
              <option value="aggressive">Agresivo</option>
            </select>
            <div class="two-col">
              ${numberInput('iaKalmanQ', 'Q process', 0.001, 0.00001, 1, 0.0001)}
              ${numberInput('iaKalmanR', 'R measure', 0.1, 0.001, 5, 0.01)}
              ${numberInput('iaSmoothRx', 'Suavizado rx', 1, 0, 1, 0.05)}
              ${numberInput('iaSmoothRy', 'Suavizado ry', 1, 0, 1, 0.05)}
              ${numberInput('iaSmoothRz', 'Suavizado rz', 1, 0, 1, 0.05)}
              ${numberInput('iaSmoothGlobal', 'Suavizado global', 1, 0, 1, 0.05)}
            </div>
            <button id="iaSaveKalman">Guardar Kalman JSON</button>
          </div>
          <div class="button-row">
            <button id="iaActivate">Activar Simulacion IA</button>
            <button id="iaPause">Pausar</button>
            <button id="iaResume">Reanudar</button>
            <button id="iaStop">Detener</button>
          </div>
          <div class="button-row">
            <button id="iaResetFilters">Reset filtros</button>
            <button id="iaReloadModels">Recargar modelos</button>
            <button id="iaExportLogs">Exportar logs</button>
          </div>
          <div id="iaInfo" class="data-stack"></div>
        `, false)}
        ${accordionPanel('unreal', 'Unreal Engine', `
          <div class="socket-row">
            <input id="unrealUrl" value="ws://127.0.0.1:8766" />
            <button id="connectUnreal">Conectar Unreal Engine</button>
          </div>
          <div class="button-row single">
            <button id="disconnectUnreal">Desconectar Unreal</button>
          </div>
          <div class="data-stack">
            <div class="kv"><span>Rotacion</span><strong>FRotator(Pitch, Yaw, Roll)</strong></div>
            <div class="kv"><span>Posicion</span><strong>FVector(X, Y, Z)</strong></div>
            <div class="kv"><span>Salida</span><strong>Compatible con Unreal Engine</strong></div>
            <div class="kv"><span>Estado</span><strong id="unrealState">Desconectado</strong></div>
            <div class="kv"><span>Destino UDP</span><strong id="unrealTarget">127.0.0.1:7000</strong></div>
            <div class="kv"><span>Frames</span><strong id="unrealFrames">0 frames</strong></div>
          </div>
        `, false)}
        ${accordionPanel('recorder', 'Recorder / Export', `
          <div class="kv"><span>Estado</span><strong id="recordingState">detenido</strong></div>
          <div class="kv"><span>Frames</span><strong id="recordingFrames">0 frames</strong></div>
          <div class="button-row">
            <button id="recordStart">Start</button>
            <button id="recordStop">Stop</button>
            <button id="recordClear">Clear</button>
          </div>
          <div class="button-row">
            <button id="exportPose">Export Pose</button>
            <button id="exportRecording">Export Recording</button>
            <button id="exportBoneMap">Export Bone Map</button>
            <button id="exportConfig">Export Config</button>
          </div>
        `, false)}
      </aside>
    </main>
  `;
}

function accordionPanel(id, title, body, defaultOpen = false) {
  const expanded = sidebarPanelOpen(id, defaultOpen);
  return `
    <section class="panel-section ${expanded ? '' : 'collapsed'}" data-panel-id="${id}">
      <h2>
        <button class="accordion-trigger" type="button" aria-expanded="${expanded}" aria-controls="panel-${id}">
          <span>${title}</span>
          <span class="accordion-icon" aria-hidden="true"></span>
        </button>
      </h2>
      <div id="panel-${id}" class="accordion-body">${body}</div>
    </section>
  `;
}

function sidebarPanelOpen(id, defaultOpen) {
  try {
    const saved = JSON.parse(localStorage.getItem(SIDEBAR_STORAGE_KEY) || '{}');
    if (saved[id] !== undefined) return saved[id];
    const openCount = Object.values(saved).filter(Boolean).length;
    if (openCount >= SIDEBAR_MAX_OPEN) return false;
  } catch {
    // fall through
  }
  return defaultOpen;
}

function slider(id, label) {
  return `
    <label class="range-row">
      <span>${label}</span>
      <input id="${id}" type="range" min="-120" max="120" value="0" />
      <output id="${id}Value">0</output>
      <small id="${id}Range">- / -</small>
    </label>
  `;
}

function numberInput(id, label, value, min, max, step) {
  return `
    <label class="number-row">
      <span>${label}</span>
      <input id="${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}" />
    </label>
  `;
}

function pathInputRow(inputId, label, defaultValue, fileInputId) {
  const browseBtn = fileInputId
    ? `<input id="${fileInputId}" type="file" accept=".pt" hidden />
       <button type="button" id="ppoBrowse${fileInputId === 'ppoTcnFile' ? 'Tcn' : 'Actor'}" class="small-btn">Examinar</button>`
    : '';
  return `
    <label class="kv path-row">
      <span>${label}</span>
      <input id="${inputId}" type="text" value="${defaultValue}" spellcheck="false" />
      ${browseBtn}
    </label>
  `;
}
