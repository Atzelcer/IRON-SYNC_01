const DEFAULT_CAPACITY = 200;

export class PacketInspector {
  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.entries = [];
    this.paused = false;
    this.showRawLine = false;
    this.listeners = new Set();
  }

  record(entry) {
    if (this.paused) return;

    const normalized = {
      ts: entry.ts ?? Date.now(),
      frame: entry.frame ?? 0,
      mask: entry.mask ?? 0,
      activeSensors: entry.activeSensors ?? 0,
      rotationCount: entry.rotationCount ?? 0,
      mode: entry.mode ?? 'crudo',
      appliedBones: entry.appliedBones ?? 0,
      hz: entry.hz ?? 0,
      topMotion: entry.topMotion ?? null,
      rotations: entry.rotations ?? [],
      rawLine: entry.rawLine ?? '',
    };

    this.entries.push(normalized);
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }

    for (const listener of this.listeners) {
      listener(this.snapshot());
    }
  }

  clear() {
    this.entries = [];
    for (const listener of this.listeners) {
      listener(this.snapshot());
    }
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
  }

  setShowRawLine(enabled) {
    this.showRawLine = Boolean(enabled);
    for (const listener of this.listeners) {
      listener(this.snapshot());
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    return {
      entries: [...this.entries],
      paused: this.paused,
      showRawLine: this.showRawLine,
      count: this.entries.length,
    };
  }

  formatEntry(entry) {
    const clock = new Date(entry.ts).toLocaleTimeString('es-BO', { hour12: false });
    const lines = [
      `[${clock}] F=${entry.frame} mask=0x${entry.mask.toString(16)} active=${entry.activeSensors}/${entry.rotationCount} Hz~${entry.hz.toFixed(1)} modo=${entry.mode} huesos=${entry.appliedBones}`,
    ];

    if (entry.topMotion?.alias && entry.topMotion.alias !== '-') {
      lines.push(`  mov ${entry.topMotion.alias}.${entry.topMotion.axis} cor=${entry.topMotion.value.toFixed(1)} raw=${entry.topMotion.rawValue.toFixed(1)}`);
    }

    const rotPreview = entry.rotations
      .slice(0, 8)
      .map((item) => `  ${item.alias} rx=${item.rx} ry=${item.ry} rz=${item.rz}`)
      .join('\n');

    if (rotPreview) {
      lines.push(rotPreview);
    }

    if (entry.rotations.length > 8) {
      lines.push(`  ... +${entry.rotations.length - 8} sensores`);
    }

    if (this.showRawLine && entry.rawLine) {
      lines.push(`  RAW ${entry.rawLine}`);
    }

    return lines.join('\n');
  }

  formatForDisplay(entries = this.entries) {
    return entries.map((entry) => this.formatEntry(entry)).join('\n\n');
  }
}
