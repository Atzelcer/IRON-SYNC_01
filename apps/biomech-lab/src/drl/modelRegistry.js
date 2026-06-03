export class ModelRegistry {
  constructor() {
    this.generation = 0;
    this.checkpoints = [];
    this.best = null;
    this.inheritedUses = 0;
    this.improvements = 0;
  }

  checkpoint({ policy, metrics, reason = 'periodic' }) {
    const snapshot = {
      schema: 'ironsync.drl-checkpoint.v1',
      id: `gen_${this.generation}_${Date.now()}`,
      generation: this.generation,
      parentId: this.best?.id ?? null,
      reason,
      metrics: { ...metrics },
      policy: policy.snapshot(),
      createdAt: new Date().toISOString(),
    };
    this.checkpoints.push(snapshot);
    if (this.checkpoints.length > 80) this.checkpoints.shift();
    if (!this.best || metrics.accuracy >= (this.best.metrics?.accuracy ?? 0)) {
      this.best = snapshot;
      this.improvements += 1;
    }
    this.generation += 1;
    return snapshot;
  }

  bestPolicySnapshot() {
    return this.best?.policy ?? null;
  }

  markInherited() {
    this.inheritedUses += 1;
  }

  importBest(snapshot) {
    this.best = snapshot.schema === 'ironsync.drl-checkpoint.v1'
      ? snapshot
      : {
          schema: 'ironsync.drl-checkpoint.v1',
          id: `imported_${Date.now()}`,
          generation: this.generation,
          parentId: null,
          reason: 'imported',
          metrics: snapshot.metrics ?? { accuracy: 0 },
          policy: snapshot.policy ?? snapshot,
          createdAt: new Date().toISOString(),
        };
    this.checkpoints.push(this.best);
  }

  snapshot() {
    return {
      schema: 'ironsync.model-registry.v1',
      generation: this.generation,
      inheritedUses: this.inheritedUses,
      improvements: this.improvements,
      best: this.best,
      checkpoints: this.checkpoints,
    };
  }
}
