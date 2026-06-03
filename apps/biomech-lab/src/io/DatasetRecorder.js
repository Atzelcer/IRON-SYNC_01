export class DatasetRecorder {
  constructor() {
    this.frames = [];
    this.recording = false;
  }

  start() {
    this.frames = [];
    this.recording = true;
  }

  stop() {
    this.recording = false;
  }

  push(frame, reward, drlState) {
    if (!this.recording) return;
    this.frames.push({
      timestamp: frame.timestamp,
      rotations: Object.fromEntries(frame.rotations.map(({ alias, rotator }) => [alias, rotator.toJSON()])),
      positions: Object.fromEntries(frame.positions.map(({ alias, position }) => [alias, position.toJSON()])),
      collisions: frame.collisions,
      reward,
      drl: {
        confidence: Number(drlState.confidence.toFixed(3)),
        actionMode: drlState.lastAction?.mode ?? 'manual',
      },
    });
  }

  exportJson() {
    return {
      schema: 'ironsync.biomech.dataset.v1',
      createdAt: new Date().toISOString(),
      frameCount: this.frames.length,
      frames: this.frames,
    };
  }

  download(filename = 'ironsync_biomech_dataset.json') {
    const blob = new Blob([JSON.stringify(this.exportJson(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}
