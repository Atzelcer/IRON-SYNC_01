import { BONE_ALIASES, BONE_ORDER } from '../core/boneMap.js';

const DEFAULT_URL = 'ws://127.0.0.1:8766';
const SEND_INTERVAL_MS = 33;
const FILTER_RESPONSE = 14;
const MAX_DEGREES_PER_SECOND = 220;
const DEAD_BAND_DEGREES = 0.08;
const UNREAL_ROTATION_GAIN = 1.0;
const UNREAL_ARM_AXIS_MIX = {
  sL: { ryFromRy: -0.18, rzFromRy: 0.14, rxFromAbsRy: -0.55 },
  sR: { ryFromRy: -0.18, rzFromRy: 0.14, rxFromAbsRy: -0.55 },
};
const UNREAL_FOREARM_AXIS_MIX = {
  fL: { rxFromRz: 0.92, rzFromRz: 0.18 },
  fR: { rxFromRz: -0.92, rzFromRz: 0.18 },
};

export class UnrealEngineBridge {
  constructor({ onStatus }) {
    this.onStatus = onStatus;
    this.socket = null;
    this.connected = false;
    this.sentFrames = 0;
    this.lastSentAt = 0;
    this.lastUpdateAt = 0;
    this.filteredPose = null;
    this.lastSentPose = null;
  }

  connect(url = DEFAULT_URL) {
    this.disconnect();
    this.socket = new WebSocket(url);
    this.onStatus?.({ state: 'Conectando', frames: this.sentFrames });

    this.socket.addEventListener('open', () => {
      this.connected = true;
      this.onStatus?.({ state: 'Conectado', frames: this.sentFrames });
    });
    this.socket.addEventListener('close', () => {
      this.connected = false;
      this.onStatus?.({ state: 'Desconectado', frames: this.sentFrames });
    });
    this.socket.addEventListener('error', () => {
      this.connected = false;
      this.onStatus?.({ state: 'Error Unreal Relay', frames: this.sentFrames });
    });
    this.socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'status') {
          this.onStatus?.({
            state: payload.state === 'streaming' ? 'Transmitiendo' : 'Conectado',
            frames: payload.frames ?? this.sentFrames,
            target: payload.udp,
          });
        }
      } catch {
        // Relay status is optional; invalid status packets should not stop streaming.
      }
    });
  }

  disconnect() {
    if (this.socket) this.socket.close();
    this.socket = null;
    this.connected = false;
  }

  sendPose(rotations, actionState = null) {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) return false;
    const now = performance.now();
    this.#updateFilteredPose(rotations, now);
    if (now - this.lastSentAt < SEND_INTERVAL_MS) return false;
    this.lastSentAt = now;
    const pose = this.#nextTransmitPose();
    this.sentFrames += 1;
    this.socket.send(JSON.stringify({
      type: 'frame',
      frame: this.sentFrames,
      action: normalizeActionState(actionState),
      rotations: BONE_ORDER.map((alias) => ({
        alias,
        bone: BONE_ALIASES[alias],
        ...applyUnrealAxisCorrection(alias, pose[alias]),
        tx: 0,
        ty: 0,
        tz: 0,
      })),
    }));
    return true;
  }

  #updateFilteredPose(rotations, now) {
    const deltaSeconds = this.lastUpdateAt
      ? Math.min(0.08, Math.max(0.001, (now - this.lastUpdateAt) / 1000))
      : 1 / 60;
    this.lastUpdateAt = now;
    const alpha = 1 - Math.exp(-FILTER_RESPONSE * deltaSeconds);
    if (!this.filteredPose) {
      this.filteredPose = poseFromRotations(rotations);
      return;
    }
    for (const alias of BONE_ORDER) {
      const target = normalizeRotation(rotations[alias]);
      const current = this.filteredPose[alias] ?? { rx: 0, ry: 0, rz: 0 };
      this.filteredPose[alias] = {
        rx: lerp(current.rx, target.rx, alpha),
        ry: lerp(current.ry, target.ry, alpha),
        rz: lerp(current.rz, target.rz, alpha),
      };
    }
  }

  #nextTransmitPose() {
    const maxStep = MAX_DEGREES_PER_SECOND * (SEND_INTERVAL_MS / 1000);
    const pose = {};
    for (const alias of BONE_ORDER) {
      const target = this.filteredPose?.[alias] ?? { rx: 0, ry: 0, rz: 0 };
      const previous = this.lastSentPose?.[alias] ?? target;
      pose[alias] = {
        rx: quantize(applyDeadBand(previous.rx, previous.rx + clamp(target.rx - previous.rx, -maxStep, maxStep)) * UNREAL_ROTATION_GAIN),
        ry: quantize(applyDeadBand(previous.ry, previous.ry + clamp(target.ry - previous.ry, -maxStep, maxStep)) * UNREAL_ROTATION_GAIN),
        rz: quantize(applyDeadBand(previous.rz, previous.rz + clamp(target.rz - previous.rz, -maxStep, maxStep)) * UNREAL_ROTATION_GAIN),
      };
    }
    this.lastSentPose = pose;
    return pose;
  }
}

function applyUnrealAxisCorrection(alias, rotation = { rx: 0, ry: 0, rz: 0 }) {
  const armMix = UNREAL_ARM_AXIS_MIX[alias];
  if (armMix) {
    return {
      rx: rotation.rx + Math.abs(rotation.ry) * armMix.rxFromAbsRy,
      ry: rotation.ry * armMix.ryFromRy,
      rz: rotation.rz + rotation.ry * armMix.rzFromRy,
    };
  }

  const forearmMix = UNREAL_FOREARM_AXIS_MIX[alias];
  if (forearmMix) {
    return {
      rx: rotation.rx + rotation.rz * forearmMix.rxFromRz,
      ry: rotation.ry,
      rz: rotation.rz * forearmMix.rzFromRz,
    };
  }

  return {
    rx: rotation.rx,
    ry: rotation.ry,
    rz: rotation.rz,
  };
}

function poseFromRotations(rotations) {
  return Object.fromEntries(BONE_ORDER.map((alias) => [alias, normalizeRotation(rotations[alias])]));
}

function normalizeRotation(rotation) {
  return {
    rx: Number(rotation?.rx) || 0,
    ry: Number(rotation?.ry) || 0,
    rz: Number(rotation?.rz) || 0,
  };
}

function applyDeadBand(previous, next) {
  return Math.abs(next - previous) < DEAD_BAND_DEGREES ? previous : next;
}

function quantize(value) {
  return Math.round(value * 20) / 20;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function normalizeActionState(actionState) {
  if (!actionState?.action) return null;
  return {
    id: String(actionState.action),
    label: String(actionState.actionEs ?? actionState.action),
    confidence: Number(actionState.confidence) || 0,
    execution: actionState.execution ?? null,
  };
}
