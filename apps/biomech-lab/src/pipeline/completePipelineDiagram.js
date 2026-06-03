/**
 * Plantilla HTML del diagrama PIPELINE - COMPLETO.
 */
import {
  PIPELINE_MODEL_SLOTS,
  basenameFromPath,
  pipelineDisplayFieldId,
  pipelineFileFieldId,
  pipelinePathFieldId,
} from './completePipelineCatalog.js';

/** id de input oculto → slot del catálogo (compat) */
export const PL_PATH_FIELD = Object.fromEntries(
  PIPELINE_MODEL_SLOTS.map((s) => [s.id, pipelinePathFieldId(s.id)]),
);

function nodeClass(status) {
  if (status === 'ok') return 'pipeline-node--ok';
  if (status === 'error') return 'pipeline-node--bad';
  if (status === 'loading') return 'pipeline-node--loading';
  return 'pipeline-node--pending';
}

export function renderPipelineDiagram(slots) {
  const n = (id) => slots[id] ?? { status: 'pending', color: '#888' };
  const box = (id, label, sub = '') => {
    const s = n(id);
    return `
      <div class="pipeline-node ${nodeClass(s.status)}" data-pl-node="${id}" style="--pl-color:${s.color}">
        <span class="pipeline-node-dot"></span>
        <strong>${label}</strong>
        ${sub ? `<small>${sub}</small>` : ''}
      </div>`;
  };

  return `
    <div class="pipeline-diagram" id="pipelineDiagram">
      <div class="pipeline-row pipeline-row--imu">
        ${box('tcn', 'TCN', 'Sanitizer IMU')}
        <span class="pipeline-arrow">→</span>
        ${box('ppo', 'PPO', 'Actor-Critic')}
      </div>
      <div class="pipeline-row pipeline-row--bio">
        ${box('emg', 'EMG', 'TCN muscular')}
        ${box('ecg', 'ECG', 'GRU cardiaco')}
      </div>
      <div class="pipeline-funnel">▼ fusion 128-D</div>
      <div class="pipeline-row pipeline-row--fusion">
        ${box('fusion', 'MLP Orquestador', '13 acciones')}
      </div>
      <div class="pipeline-funnel">▼ post-proceso</div>
      <div class="pipeline-row pipeline-row--post">
        ${box('kalman', 'Kalman', 'Solo simulación')}
      </div>
      <div class="pipeline-funnel">▼ salida</div>
      <div class="pipeline-node pipeline-node--sink">
        <strong>Mesh / Unreal</strong>
        <small>15 huesos</small>
      </div>
    </div>`;
}

function importRowHtml(slot) {
  const pathId = pipelinePathFieldId(slot.id);
  const fileId = pipelineFileFieldId(slot.id);
  const displayId = pipelineDisplayFieldId(slot.id);
  const fileName = basenameFromPath(slot.path);
  return `
    <div class="pl-import-row" data-pl-slot="${slot.id}">
      <span class="pl-import-label" style="color:${slot.color}">${slot.short}</span>
      <label class="pl-file-field" for="${fileId}" title="${slot.path}">
        <input
          id="${fileId}"
          type="file"
          accept="${slot.accept}"
          class="pl-file-native"
        />
        <span id="${displayId}" class="pl-file-display">${fileName}</span>
      </label>
      <input id="${pathId}" type="hidden" value="${slot.path}" />
    </div>`;
}

export function pipelineCompletoPanelHtml() {
  const pathRows = PIPELINE_MODEL_SLOTS.map((slot) => importRowHtml(slot)).join('');

  return `
    <p class="muted">Carga TCN -> PPO -> EMG -> ECG -> MLP orquestador -> Kalman. El diagrama pasa a verde cuando cada archivo existe.</p>
    <div class="control-group pl-import-group">
      <h3>Importar modelos</h3>
      <p class="muted pl-import-hint">Clic en la caja para elegir archivo. Se muestra el nombre seleccionado.</p>
      <div class="pl-import-list">${pathRows}</div>
      <div class="button-row">
        <button id="plLoadAll" type="button">Verificar y cargar todos</button>
      </div>
      <p id="plLoadSummary" class="muted">Sin verificar.</p>
    </div>
    <div id="pipelineDiagramHost"></div>
    <div class="control-group pipeline-orchestrator-box">
      <h3>Orquestador</h3>
      <div class="kv"><span>Acción</span><strong id="plOrchestratorAction">—</strong></div>
      <div class="kv"><span>Confianza</span><strong id="plOrchestratorConf">—</strong></div>
      <div class="kv"><span>Falta cargar</span><strong id="plOrchestratorMissing">—</strong></div>
      <p id="plOrchestratorPreview" class="muted">—</p>
    </div>
    <div class="control-group">
      <h3>Kalman (después del orquestador)</h3>
      <label class="toggle-row"><input id="plKalmanEnabled" type="checkbox" checked />Activar Kalman en simulación</label>
      <select id="plKalmanMode">
        <option value="conservative">Conservador</option>
        <option value="normal" selected>Normal</option>
        <option value="aggressive">Agresivo</option>
      </select>
    </div>
    <div class="control-group">
      <h3>Simulación</h3>
      <div class="button-row">
        <button id="plSimStartHw" type="button" disabled>Iniciar simulación (hardware)</button>
        <button id="plSimStartSynth" type="button" disabled>Datos sintéticos de movimiento</button>
      </div>
      <div class="button-row">
        <button id="plSimPause" type="button" disabled>Pausar</button>
        <button id="plSimResume" type="button" disabled>Reanudar</button>
        <button id="plSimStop" type="button" disabled>Terminar simulación</button>
      </div>
      <p class="muted">Conecta Arduino/relay en la seccion Hardware antes de iniciar simulacion.</p>
    </div>
    <div id="plPipelineInfo" class="data-stack"></div>
  `;
}
