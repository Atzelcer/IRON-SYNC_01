/**
 * Catálogo de modelos del pipeline IRON-SYNC completo.
 */

function slotDomId(id) {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export function pipelinePathFieldId(slotId) {
  return `plPath${slotDomId(slotId)}`;
}

export function pipelineFileFieldId(slotId) {
  return `plFile${slotDomId(slotId)}`;
}

export function pipelineDisplayFieldId(slotId) {
  return `plDisplay${slotDomId(slotId)}`;
}

export function basenameFromPath(path) {
  const normalized = String(path ?? '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized || '—';
}

export const PIPELINE_MODEL_SLOTS = [
  {
    id: 'tcn',
    label: 'TCN Sanitizer',
    short: 'TCN',
    color: '#4fc3f7',
    path: 'models/BEST_MODEL_TCN_SANITIZER.pt',
    defaultDir: 'models',
    accept: '.pt',
    group: 'imu',
    required: true,
  },
  {
    id: 'ppo',
    label: 'PPO Actor-Critic',
    short: 'PPO',
    color: '#9af5b4',
    path: 'models/BEST_MODEL_PPO.pt',
    defaultDir: 'models',
    accept: '.pt',
    group: 'imu',
    required: true,
  },
  {
    id: 'emg',
    label: 'TCN EMG',
    short: 'EMG',
    color: '#ffb84d',
    path: 'models/BEST_MODEL_EMG.pt',
    defaultDir: 'models',
    accept: '.pt',
    group: 'biosignals',
    required: true,
  },
  {
    id: 'ecg',
    label: 'GRU ECG',
    short: 'ECG',
    color: '#ff8cc8',
    path: 'models/BEST_MODEL_ECG.pt',
    defaultDir: 'models',
    accept: '.pt',
    group: 'biosignals',
    required: true,
  },
  {
    id: 'fusion',
    label: 'MLP Orquestador',
    short: 'MLP',
    color: '#c8a8ff',
    path: 'models/BEST_MODEL_ORQUESTADOR_13.pt',
    defaultDir: 'models',
    accept: '.pt',
    group: 'fusion',
    required: true,
  },
  {
    id: 'kalman',
    label: 'Kalman (config)',
    short: 'Kalman',
    color: '#ffe66d',
    path: 'models/BEST_MODEL_KALMAN.pt',
    defaultDir: 'models',
    accept: '.json,.pt',
    group: 'post',
    required: false,
  },
];

export const FUSION_ACTIONS = [
  { id: 'IDLE', es: 'REPOSO' },
  { id: 'WALK', es: 'CAMINAR' },
  { id: 'RUN', es: 'CORRER' },
  { id: 'JUMP', es: 'SALTAR' },
  { id: 'CROUCH', es: 'AGACHARSE' },
  { id: 'PUNCH_RIGHT', es: 'GOLPE_DERECHA' },
  { id: 'PUNCH_LEFT', es: 'GOLPE_IZQUIERDA' },
  { id: 'KICK_RIGHT', es: 'PATADA_DERECHA' },
  { id: 'KICK_LEFT', es: 'PATADA_IZQUIERDA' },
  { id: 'BLOCK', es: 'BLOQUEAR' },
  { id: 'WAVE', es: 'SALUDAR' },
  { id: 'SHOOT', es: 'DISPARAR' },
  { id: 'FLY', es: 'VOLAR' },
];
