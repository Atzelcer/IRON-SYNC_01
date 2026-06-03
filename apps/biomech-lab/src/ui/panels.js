import { BONE_LABELS, BONE_ORDER } from '../core/boneMap.js';
import { BIOMECHANICAL_LIMITS } from '../core/constraints.js';
import { createElement, clear } from './dom.js';

export class PanelRenderer {
  constructor(nodes) {
    this.nodes = nodes;
  }

  renderBoneInspector(frame, selectedAlias) {
    clear(this.nodes.boneInspector);
    const item = frame.rotations.find((entry) => entry.alias === selectedAlias) ?? frame.rotations[0];
    if (!item) return;

    this.nodes.boneInspector.append(
      row('Alias', `${item.alias} · ${BONE_LABELS[item.alias]}`),
      row('RX / RY / RZ', `${fmt(item.rotator.pitch)}° / ${fmt(item.rotator.yaw)}° / ${fmt(item.rotator.roll)}°`),
      row('Límites', formatLimits(item.alias)),
      row('Velocidad', `${fmt(frame.smoothness)} deg/frame`),
    );
  }

  renderCollisionDebug(collisions) {
    clear(this.nodes.collisionDebug);
    if (collisions.length === 0) {
      this.nodes.collisionDebug.append(createElement('p', 'muted', 'Sin colisiones activas.'));
      return;
    }
    for (const collision of collisions) {
      this.nodes.collisionDebug.append(createElement('p', `event ${collision.severity}`, collision.label));
    }
  }

  renderRewardDebug(reward) {
    clear(this.nodes.rewardDebug);
    this.nodes.rewardDebug.append(createElement('div', 'reward-total', `${fmt(reward.total)} pts`));
    for (const event of reward.events) {
      this.nodes.rewardDebug.append(createElement('p', `event ${event.type}`, `${event.value > 0 ? '+' : ''}${event.value} · ${event.label}`));
    }
  }

  renderDrlDebug(environment, state) {
    clear(this.nodes.drlDebug);
    this.nodes.drlDebug.append(
      row('Estado', `${Object.keys(state.rotations).length} huesos observados`),
      row('Acción', environment.lastAction?.mode ?? 'manual'),
      row('Confidence', `${fmt(environment.confidence * 100)}%`),
      row('Violaciones', String(state.biomechanicalLimits)),
    );
  }

  renderSensorDebug(status, packetCount) {
    clear(this.nodes.sensorDebug);
    this.nodes.sensorDebug.append(
      row('WebSocket', status),
      row('Paquetes', String(packetCount)),
      row('Canal futuro', 'ESP32 → UDP → Python → WebSocket'),
    );
  }
}

export function populateBoneSelect(select) {
  for (const alias of BONE_ORDER) {
    const option = document.createElement('option');
    option.value = alias;
    option.textContent = `${alias} · ${BONE_LABELS[alias]}`;
    select.appendChild(option);
  }
}

function row(label, value) {
  const wrapper = createElement('div', 'data-row');
  wrapper.append(createElement('span', 'data-label', label), createElement('span', 'data-value', value));
  return wrapper;
}

function formatLimits(alias) {
  const limits = BIOMECHANICAL_LIMITS[alias];
  if (!limits) return 'Sin límite';
  return `RX ${limits.rx.min}/${limits.rx.max}, RY ${limits.ry.min}/${limits.ry.max}, RZ ${limits.rz.min}/${limits.rz.max}`;
}

function fmt(value) {
  return Number(value).toFixed(2);
}
