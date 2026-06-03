export function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadText(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportPose(rotations) {
  return {
    schema: 'ironsync.pose.v1',
    createdAt: new Date().toISOString(),
    bones: rotations,
  };
}

export function exportRecording(frames) {
  return {
    schema: 'ironsync.biomech.recording.v1',
    createdAt: new Date().toISOString(),
    frameCount: frames.length,
    frames,
  };
}

export function exportBoneMap(mapping) {
  return {
    schema: 'ironsync.bone-map.v1',
    createdAt: new Date().toISOString(),
    mapping,
  };
}

export function exportBiomechanicsConfig(limits) {
  return {
    schema: 'ironsync.biomechanics.config.v1',
    createdAt: new Date().toISOString(),
    limits,
  };
}

export function exportQTable(snapshot) {
  return {
    ...snapshot,
    schema: 'ironsync.qtable.v1',
    createdAt: new Date().toISOString(),
  };
}

export function exportQTransitions(transitions) {
  return {
    schema: 'ironsync.qlearning.transitions.v1',
    createdAt: new Date().toISOString(),
    count: transitions.length,
    transitions,
  };
}

export function exportQTrainingLog(trainingLog) {
  return {
    schema: 'ironsync.qlearning.training-log.v1',
    createdAt: new Date().toISOString(),
    episodes: trainingLog.length,
    trainingLog,
  };
}

export function exportPolicySummary(summary) {
  return {
    schema: 'ironsync.qlearning.policy-summary.v1',
    createdAt: new Date().toISOString(),
    summary,
  };
}
