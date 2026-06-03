import { BONE_ORDER } from '../core/boneMap.js';

const AXES = ['rx', 'ry', 'rz'];

export const APPLIED_MOVEMENTS = [
  movement('head_down', 'Cabeza abajo', ['head'], { head: { rx: 28 } }),
  movement('head_up', 'Cabeza arriba', ['head'], { head: { rx: -24 } }),
  movement('head_left', 'Cabeza izquierda', ['head'], { head: { rz: -28 } }),
  movement('head_right', 'Cabeza derecha', ['head'], { head: { rz: 28 } }),
  movement('head_tilt_left', 'Cabeza lateral izq.', ['head'], { head: { ry: -24 } }),
  movement('head_tilt_right', 'Cabeza lateral der.', ['head'], { head: { ry: 24 } }),

  movement('left_arm_forward_once', 'Brazo izq. frente', ['sL', 'fL', 'hL'], {
    sL: { rx: -76, ry: -4, rz: 4 },
    fL: { rx: 12 },
    hL: { rx: -4 },
  }),
  movement('right_arm_forward_once', 'Brazo der. frente', ['sR', 'fR', 'hR'], {
    sR: { rx: -76, ry: 4, rz: -4 },
    fR: { rx: 12 },
    hR: { rx: -4 },
  }),
  movement('both_arms_forward_gaze_once', 'Ambos brazos al frente', ['head', 'chest', 'sL', 'fL', 'hL', 'sR', 'fR', 'hR'], {
    head: { rx: -4, ry: 0, rz: 0 },
    chest: { rx: -5, ry: 0, rz: 0 },
    sL: { rx: -78, ry: -4, rz: 4 },
    fL: { rx: 8, ry: 0, rz: 0 },
    hL: { rx: -3, ry: 0, rz: 0 },
    sR: { rx: -78, ry: 4, rz: -4 },
    fR: { rx: 8, ry: 0, rz: 0 },
    hR: { rx: -3, ry: 0, rz: 0 },
  }),
  movement('left_arm_side_once', 'Brazo izq. costado', ['sL', 'fL', 'hL'], {
    sL: { rx: -8, ry: -72, rz: -12 },
    fL: { rx: 10 },
  }),
  movement('right_arm_side_once', 'Brazo der. costado', ['sR', 'fR', 'hR'], {
    sR: { rx: -8, ry: 72, rz: 12 },
    fR: { rx: 10 },
  }),
  movement('left_arm_back_once', 'Brazo izq. atras', ['sL', 'fL'], {
    sL: { rx: 38, ry: -8, rz: 5 },
    fL: { rx: 8 },
  }),
  movement('right_arm_back_once', 'Brazo der. atras', ['sR', 'fR'], {
    sR: { rx: 38, ry: 8, rz: -5 },
    fR: { rx: 8 },
  }),
  movement('left_elbow_flex_once', 'Codo izq. flexion', ['sL', 'fL', 'hL'], {
    sL: { rx: -10, ry: 8 },
    fL: { rx: -62, rz: -14 },
    hL: { rx: 6 },
  }),
  movement('right_elbow_flex_once', 'Codo der. flexion', ['sR', 'fR', 'hR'], {
    sR: { rx: -10, ry: -8 },
    fR: { rx: -62, rz: 14 },
    hR: { rx: 6 },
  }),

  movement('left_thigh_front_once', 'Muslo izq. adelante', ['hip', 'tL', 'knL', 'ftL'], {
    hip: { rx: -4 },
    tL: { rx: -70, ry: 4 },
    knL: { rx: 34 },
    ftL: { rx: 30 },
  }),
  movement('right_thigh_front_once', 'Muslo der. adelante', ['hip', 'tR', 'knR', 'ftR'], {
    hip: { rx: -4 },
    tR: { rx: -70, ry: -4 },
    knR: { rx: 34 },
    ftR: { rx: 30 },
  }),
  movement('left_thigh_back_once', 'Muslo izq. atras', ['hip', 'tL', 'knL'], {
    hip: { rx: 3 },
    tL: { rx: 30, ry: 3 },
    knL: { rx: 8 },
  }),
  movement('right_thigh_back_once', 'Muslo der. atras', ['hip', 'tR', 'knR'], {
    hip: { rx: 3 },
    tR: { rx: 30, ry: -3 },
    knR: { rx: 8 },
  }),
  movement('left_foot_up_once', 'Pie izq. punta', ['knL', 'ftL'], {
    knL: { rx: 4 },
    ftL: { rx: -26 },
  }),
  movement('right_foot_up_once', 'Pie der. punta', ['knR', 'ftR'], {
    knR: { rx: 4 },
    ftR: { rx: -26 },
  }),
  movement('left_foot_roll_once', 'Pie izq. lateral', ['knL', 'ftL'], {
    knL: { rx: 4 },
    ftL: { rz: -20, ry: -8 },
  }),
  movement('right_foot_roll_once', 'Pie der. lateral', ['knR', 'ftR'], {
    knR: { rx: 4 },
    ftR: { rz: 20, ry: 8 },
  }),

  movement('torso_bend_front_once', 'Torso adelante', ['hip', 'chest', 'head'], {
    hip: { rx: -6 },
    chest: { rx: -26 },
    head: { rx: 8 },
  }),
  movement('torso_bend_back_once', 'Torso atras', ['hip', 'chest', 'head'], {
    hip: { rx: 5 },
    chest: { rx: 22 },
    head: { rx: -8 },
  }),
  movement('torso_bend_left_once', 'Torso izquierda', ['hip', 'chest', 'head'], {
    hip: { rz: -5 },
    chest: { rz: -22 },
    head: { rz: -7 },
  }),
  movement('torso_bend_right_once', 'Torso derecha', ['hip', 'chest', 'head'], {
    hip: { rz: 5 },
    chest: { rz: 22 },
    head: { rz: 7 },
  }),
  movement('torso_twist_left_once', 'Torso giro izq.', ['hip', 'chest', 'head', 'tL', 'knL', 'ftL', 'tR', 'knR', 'ftR'], {
    hip: { ry: -28 },
    chest: { ry: -34 },
    head: { ry: -18 },
    tL: { rx: -10, ry: -24 },
    knL: { rx: 18 },
    ftL: { ry: -22 },
    tR: { ry: -18 },
    knR: { rx: 8 },
    ftR: { ry: -14 },
  }),
  movement('torso_twist_right_once', 'Torso giro der.', ['hip', 'chest', 'head', 'tR', 'knR', 'ftR', 'tL', 'knL', 'ftL'], {
    hip: { ry: 28 },
    chest: { ry: 34 },
    head: { ry: 18 },
    tR: { rx: -10, ry: 24 },
    knR: { rx: 18 },
    ftR: { ry: 22 },
    tL: { ry: 18 },
    knL: { rx: 8 },
    ftL: { ry: 14 },
  }),
];

export class AppliedMovementPlayer {
  constructor(controller) {
    this.controller = controller;
    this.active = false;
    this.definition = null;
    this.startedAt = 0;
    this.durationMs = 1800;
    this.lastPose = zeroPose();
  }

  setController(controller) {
    this.controller = controller;
    this.stop({ reset: false });
  }

  play(id, now = performance.now()) {
    const definition = APPLIED_MOVEMENTS.find((item) => item.id === id);
    if (!definition || !this.controller) return null;
    this.controller.resetPose();
    this.definition = definition;
    this.startedAt = now;
    this.durationMs = definition.durationMs;
    this.active = true;
    this.lastPose = zeroPose();
    return definition;
  }

  stop({ reset = true } = {}) {
    this.active = false;
    this.definition = null;
    this.startedAt = 0;
    this.lastPose = zeroPose();
    if (reset) this.controller?.resetPose();
  }

  tick(now = performance.now()) {
    if (!this.active || !this.definition || !this.controller) {
      return this.summary(now);
    }

    const elapsed = Math.max(0, now - this.startedAt);
    const ratio = Math.min(1, elapsed / this.durationMs);
    const weight = movementWeight(ratio);
    const pose = scalePose(this.definition.targetPose, weight);
    this.lastPose = this.controller.writeMany(pose, { clamp: true, guard: true });

    if (ratio >= 1) {
      this.controller.resetPose();
      const done = this.definition;
      this.stop({ reset: false });
      return {
        active: false,
        completed: true,
        definition: done,
        progress: 100,
        phase: 'base',
      };
    }

    return this.summary(now, ratio);
  }

  summary(now = performance.now(), ratio = null) {
    const progress = this.active
      ? Math.round(((ratio ?? Math.min(1, Math.max(0, now - this.startedAt) / this.durationMs))) * 100)
      : 0;
    return {
      active: this.active,
      completed: false,
      definition: this.definition,
      progress,
      phase: phaseLabel(progress / 100),
    };
  }
}

function movement(id, name, activeBones, targetPose, durationMs = 1800) {
  return {
    id,
    name,
    activeBones,
    targetPose: normalizePose(targetPose),
    durationMs,
  };
}

function zeroPose() {
  return Object.fromEntries(BONE_ORDER.map((alias) => [alias, { rx: 0, ry: 0, rz: 0 }]));
}

function normalizePose(partialPose = {}) {
  const pose = zeroPose();
  for (const [alias, rotation] of Object.entries(partialPose)) {
    if (!pose[alias]) continue;
    for (const axis of AXES) {
      pose[alias][axis] = Number(rotation[axis]) || 0;
    }
  }
  return pose;
}

function scalePose(pose, weight) {
  return Object.fromEntries(Object.entries(pose).map(([alias, rotation]) => [
    alias,
    {
      rx: rotation.rx * weight,
      ry: rotation.ry * weight,
      rz: rotation.rz * weight,
    },
  ]));
}

function movementWeight(ratio) {
  if (ratio < 0.42) return smooth01(ratio / 0.42);
  if (ratio < 0.62) return 1;
  return 1 - smooth01((ratio - 0.62) / 0.38);
}

function phaseLabel(ratio) {
  if (ratio <= 0) return 'base';
  if (ratio < 0.42) return 'ida';
  if (ratio < 0.62) return 'objetivo';
  if (ratio < 1) return 'retorno';
  return 'base';
}

function smooth01(value) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}
