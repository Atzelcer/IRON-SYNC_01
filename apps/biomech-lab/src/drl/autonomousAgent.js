import { BONE_ORDER } from '../core/boneMap.js';

const MODE_GAIN = {
  soft: 0.35,
  medium: 0.7,
  aggressive: 1,
  walk: 0.72,
  run: 1,
  fly: 0.85,
  pause: 0,
};

export class AutonomousAgent {
  constructor(controller) {
    this.controller = controller;
    this.mode = 'pause';
    this.enabled = false;
    this.filteredPose = {};
    this.lastTimeSeconds = null;
    this.actionTime = 0;
  }

  setMode(mode) {
    if (mode !== this.mode) {
      this.restartCycle();
    }
    this.mode = mode;
    this.enabled = mode !== 'pause';
    if (!this.enabled) this.lastTimeSeconds = null;
  }

  restartCycle() {
    this.actionTime = 0;
    this.lastTimeSeconds = null;
    this.filteredPose = {};
  }

  step(timeSeconds) {
    if (!this.enabled) return { mode: 'pause', confidence: 0, actions: {} };
    const deltaSeconds = this.lastTimeSeconds == null ? 1 / 60 : Math.min(0.05, Math.max(0.001, timeSeconds - this.lastTimeSeconds));
    this.lastTimeSeconds = timeSeconds;
    this.actionTime += deltaSeconds;
    const targetPose = coordinatedPose(this.mode, this.actionTime);
    const actions = smoothPose(this.filteredPose, targetPose, deltaSeconds, 24);
    const applied = this.controller.writeMany(actions, { guard: true });
    this.filteredPose = applied;
    return {
      mode: this.mode,
      confidence: this.mode === 'run' ? 0.78 : this.mode === 'fly' ? 0.74 : 0.86,
      actions: applied,
    };
  }
}

function coordinatedPose(mode, timeSeconds) {
  const ramp = smooth01(Math.min(1, timeSeconds / 0.28));
  if (mode === 'run') return scalePose(gaitPose(timeSeconds, MODE_GAIN.run, 4.4), ramp);
  if (mode === 'fly') return scalePose(flyPose(timeSeconds, MODE_GAIN.fly), ramp);
  if (mode === 'cal_still') return zeroPose();
  if (mode === 'head_pitch') return scalePose(singleBoneWave('head', 'rx', timeSeconds, 28, 1.15), ramp);
  if (mode === 'head_yaw') return scalePose(singleBoneWave('head', 'ry', timeSeconds, 35, 1.05), ramp);
  if (mode === 'head_roll') return scalePose(headRollPose(timeSeconds), ramp);

  if (mode === 'left_arm_lift' || mode === 'left_arm_front') return scalePose(armPose('L', 'side90', timeSeconds), ramp);
  if (mode === 'right_arm_lift' || mode === 'right_arm_front') return scalePose(armPose('R', 'side90', timeSeconds), ramp);
  if (mode === 'left_arm_side') return scalePose(armPose('L', 'side60', timeSeconds), ramp);
  if (mode === 'right_arm_side') return scalePose(armPose('R', 'side60', timeSeconds), ramp);
  if (mode === 'left_arm_forward') return scalePose(armPose('L', 'front', timeSeconds), ramp);
  if (mode === 'right_arm_forward') return scalePose(armPose('R', 'front', timeSeconds), ramp);
  if (mode === 'both_arms_forward') return scalePose(bothArmsForwardPose(timeSeconds), ramp);
  if (mode === 'left_arm_back') return scalePose(armPose('L', 'back', timeSeconds), ramp);
  if (mode === 'right_arm_back') return scalePose(armPose('R', 'back', timeSeconds), ramp);
  if (mode === 'left_forearm_flex') return scalePose(forearmFlexPose('L', timeSeconds), ramp);
  if (mode === 'right_forearm_flex') return scalePose(forearmFlexPose('R', timeSeconds), ramp);
  if (mode === 'left_hand_wave') return scalePose(handWavePose('L', timeSeconds), ramp);
  if (mode === 'right_hand_wave') return scalePose(handWavePose('R', timeSeconds), ramp);

  if (mode === 'left_thigh_lift' || mode === 'left_thigh_front') return scalePose(thighPose('L', 'front', timeSeconds), ramp);
  if (mode === 'right_thigh_lift' || mode === 'right_thigh_front') return scalePose(thighPose('R', 'front', timeSeconds), ramp);
  if (mode === 'left_thigh_back') return scalePose(thighPose('L', 'back', timeSeconds), ramp);
  if (mode === 'right_thigh_back') return scalePose(thighPose('R', 'back', timeSeconds), ramp);
  if (mode === 'left_leg_knee_flex') return scalePose(kneeFlexPose('L', timeSeconds), ramp);
  if (mode === 'right_leg_knee_flex') return scalePose(kneeFlexPose('R', timeSeconds), ramp);
  if (mode === 'left_foot_pitch') return scalePose(footPose('L', 'pitch', timeSeconds), ramp);
  if (mode === 'right_foot_pitch') return scalePose(footPose('R', 'pitch', timeSeconds), ramp);
  if (mode === 'left_foot_roll') return scalePose(footPose('L', 'roll', timeSeconds), ramp);
  if (mode === 'right_foot_roll') return scalePose(footPose('R', 'roll', timeSeconds), ramp);

  if (mode === 'torso_twist_left') return scalePose(torsoPose('twist_left', timeSeconds), ramp);
  if (mode === 'torso_twist_right') return scalePose(torsoPose('twist_right', timeSeconds), ramp);
  if (mode === 'body_turn_left') return scalePose(bodyTurnPose('left', timeSeconds), ramp);
  if (mode === 'body_turn_right') return scalePose(bodyTurnPose('right', timeSeconds), ramp);
  if (mode === 'body_bend_front') return scalePose(torsoPose('bend_front', timeSeconds), ramp);
  if (mode === 'body_bend_back') return scalePose(torsoPose('bend_back', timeSeconds), ramp);
  if (mode === 'body_bend_left') return scalePose(torsoPose('bend_left', timeSeconds), ramp);
  if (mode === 'body_bend_right') return scalePose(torsoPose('bend_right', timeSeconds), ramp);

  if (mode === 'walk' || mode === 'soft' || mode === 'medium' || mode === 'aggressive') {
    const gain = MODE_GAIN[mode] ?? MODE_GAIN.walk;
    const speed = mode === 'aggressive' ? 3.7 : mode === 'medium' ? 2.65 : mode === 'soft' ? 1.85 : 2.15;
    return scalePose(gaitPose(timeSeconds, gain, speed), ramp);
  }
  return {};
}

function singleBoneWave(alias, axis, timeSeconds, amplitude, speed, bias = 0) {
  const pose = zeroPose();
  const wave = Math.sin(timeSeconds * Math.PI * speed);
  pose[alias][axis] = amplitude * (bias + (1 - bias) * wave);
  return pose;
}

function actionWave(timeSeconds, speed = 1, bias = 0.5) {
  const wave = Math.sin(timeSeconds * Math.PI * speed);
  return bias + (1 - bias) * wave;
}

function headRollPose(timeSeconds) {
  const pose = zeroPose();
  const wave = actionWave(timeSeconds, 1.05, 0);
  pose.head.rz = 26 * wave;
  pose.chest.rz = -4 * wave;
  return pose;
}

function armPose(side, direction, timeSeconds) {
  const pose = zeroPose();
  const isLeft = side === 'L';
  const shoulder = isLeft ? 'sL' : 'sR';
  const forearm = isLeft ? 'fL' : 'fR';
  const hand = isLeft ? 'hL' : 'hR';
  const sideSign = isLeft ? -1 : 1;
  const wave = actionWave(timeSeconds, 0.95, 0.5);

  if (direction === 'front') {
    pose[shoulder] = { rx: -82 * wave, ry: sideSign * 4 * wave, rz: sideSign * -6 * wave };
    pose[forearm].rx = 14 * wave;
  } else if (direction === 'back') {
    pose[shoulder] = { rx: 42 * wave, ry: sideSign * 8 * wave, rz: sideSign * -6 * wave };
    pose[forearm].rx = 8 * wave;
  } else if (direction === 'side60') {
    pose[shoulder] = { rx: -6 * wave, ry: sideSign * 52 * wave, rz: sideSign * 10 * wave };
    pose[forearm].rx = 10 * wave;
  } else {
    pose[shoulder] = { rx: -10 * wave, ry: sideSign * 82 * wave, rz: sideSign * 18 * wave };
    pose[forearm].rx = 12 * wave;
  }

  pose[hand].rx = -4 * wave;
  pose.chest.ry = sideSign * -3 * wave;
  pose.chest.rz = sideSign * -2 * wave;
  return pose;
}

function forearmFlexPose(side, timeSeconds) {
  const pose = zeroPose();
  const isLeft = side === 'L';
  const shoulder = isLeft ? 'sL' : 'sR';
  const forearm = isLeft ? 'fL' : 'fR';
  const hand = isLeft ? 'hL' : 'hR';
  const wave = actionWave(timeSeconds, 1.05, 0.5);
  const sign = isLeft ? 1 : -1;

  pose[shoulder].rx = -10 * wave;
  pose[shoulder].ry = sign * 10 * wave;
  pose[forearm].rx = -58 * wave;
  pose[forearm].rz = sign * -18 * wave;
  pose[hand].rx = 8 * wave;
  return pose;
}

function bothArmsForwardPose(timeSeconds) {
  const pose = zeroPose();
  const left = armPose('L', 'front', timeSeconds);
  const right = armPose('R', 'front', timeSeconds);

  pose.sL = { ...left.sL };
  pose.fL = { ...left.fL };
  pose.hL = { ...left.hL };
  pose.sR = { ...right.sR };
  pose.fR = { ...right.fR };
  pose.hR = { ...right.hR };

  const wave = actionWave(timeSeconds, 0.95, 0.5);
  pose.chest.rx = -4 * wave;
  pose.chest.ry = 0;
  pose.chest.rz = 0;
  return pose;
}

function handWavePose(side, timeSeconds) {
  const pose = zeroPose();
  const isLeft = side === 'L';
  const shoulder = isLeft ? 'sL' : 'sR';
  const forearm = isLeft ? 'fL' : 'fR';
  const hand = isLeft ? 'hL' : 'hR';
  const sign = isLeft ? -1 : 1;
  const wave = Math.sin(timeSeconds * Math.PI * 2.2);

  pose[shoulder].ry = sign * 42;
  pose[forearm].rx = 46;
  pose[hand].rx = wave * 34;
  pose[hand].rz = sign * wave * 18;
  return pose;
}

function thighPose(side, direction, timeSeconds) {
  const pose = zeroPose();
  const isLeft = side === 'L';
  const thigh = isLeft ? 'tL' : 'tR';
  const knee = isLeft ? 'knL' : 'knR';
  const foot = isLeft ? 'ftL' : 'ftR';
  const sign = isLeft ? 1 : -1;
  const wave = actionWave(timeSeconds, 0.9, 0.5);

  pose[thigh].rx = direction === 'front' ? -82 * wave : 28 * wave;
  pose[thigh].ry = sign * 4 * wave;
  pose[knee].rx = direction === 'front' ? 48 * wave : 10 * wave;
  pose[foot].rx = direction === 'front' ? -18 * wave : 5 * wave;
  pose.hip.rx = direction === 'front' ? -6 * wave : 2 * wave;
  pose.chest.rx = direction === 'front' ? 4 * wave : 0;
  return pose;
}

function kneeFlexPose(side, timeSeconds) {
  const pose = zeroPose();
  const isLeft = side === 'L';
  const thigh = isLeft ? 'tL' : 'tR';
  const knee = isLeft ? 'knL' : 'knR';
  const foot = isLeft ? 'ftL' : 'ftR';
  const wave = actionWave(timeSeconds, 1.0, 0.5);

  pose[thigh].rx = -18 * wave;
  pose[knee].rx = 82 * wave;
  pose[foot].rx = -18 * wave;
  return pose;
}

function footPose(side, kind, timeSeconds) {
  const pose = zeroPose();
  const isLeft = side === 'L';
  const foot = isLeft ? 'ftL' : 'ftR';
  const knee = isLeft ? 'knL' : 'knR';
  const sign = isLeft ? -1 : 1;
  const wave = Math.sin(timeSeconds * Math.PI * 1.45);

  pose[knee].rx = 6;
  if (kind === 'pitch') {
    pose[foot].rx = wave * 28;
  } else {
    pose[foot].rz = sign * wave * 20;
    pose[foot].ry = sign * wave * 8;
  }
  return pose;
}

function torsoPose(kind, timeSeconds) {
  const pose = zeroPose();
  const wave = actionWave(timeSeconds, 0.85, 0.5);
  const sideWave = Math.sin(timeSeconds * Math.PI * 0.85);

  if (kind === 'twist_left') {
    pose.hip.rz = -6 * wave;
    pose.chest.rz = -28 * wave;
    pose.head.rz = -8 * wave;
  } else if (kind === 'twist_right') {
    pose.hip.rz = 6 * wave;
    pose.chest.rz = 28 * wave;
    pose.head.rz = 8 * wave;
  } else if (kind === 'bend_front') {
    pose.hip.rx = -8 * wave;
    pose.chest.rx = -28 * wave;
    pose.head.rx = 10 * wave;
  } else if (kind === 'bend_back') {
    pose.hip.rx = 6 * wave;
    pose.chest.rx = 24 * wave;
    pose.head.rx = -8 * wave;
  } else if (kind === 'bend_left') {
    pose.hip.rz = -6 * sideWave;
    pose.chest.rz = -24 * sideWave;
    pose.head.rz = -8 * sideWave;
  } else if (kind === 'bend_right') {
    pose.hip.rz = 6 * sideWave;
    pose.chest.rz = 24 * sideWave;
    pose.head.rz = 8 * sideWave;
  }
  return pose;
}

function bodyTurnPose(direction, timeSeconds) {
  const pose = zeroPose();
  const sign = direction === 'left' ? -1 : 1;
  const leadThigh = direction === 'left' ? 'tL' : 'tR';
  const leadKnee = direction === 'left' ? 'knL' : 'knR';
  const leadFoot = direction === 'left' ? 'ftL' : 'ftR';
  const supportThigh = direction === 'left' ? 'tR' : 'tL';
  const supportFoot = direction === 'left' ? 'ftR' : 'ftL';
  const wave = actionWave(timeSeconds, 0.82, 0.5);

  pose.hip.rz = sign * 22 * wave;
  pose.chest.rz = sign * 14 * wave;
  pose.head.rz = sign * 8 * wave;
  pose[leadThigh].rx = -42 * wave;
  pose[leadThigh].ry = sign * 22 * wave;
  pose[leadThigh].rz = sign * 10 * wave;
  pose[leadKnee].rx = 72 * wave;
  pose[leadFoot].rx = -24 * wave;
  pose[leadFoot].ry = sign * 16 * wave;
  pose[leadFoot].rz = sign * 10 * wave;
  pose[supportThigh].ry = sign * 6 * wave;
  pose[supportThigh].rz = sign * 5 * wave;
  pose[supportFoot].ry = sign * 6 * wave;
  return pose;
}

function zeroPose() {
  return Object.fromEntries(BONE_ORDER.map((alias) => [alias, { rx: 0, ry: 0, rz: 0 }]));
}

function gaitPose(timeSeconds, gain, speed) {
  const phase = timeSeconds * speed;
  const left = Math.sin(phase);
  const right = -left;
  const liftLeft = smooth01(Math.max(0, left));
  const liftRight = smooth01(Math.max(0, right));
  const plantLeft = smooth01(Math.max(0, -left));
  const plantRight = smooth01(Math.max(0, -right));
  const sway = Math.sin(phase * 0.5);
  const bounce = Math.sin(phase * 2) * 0.8;
  const torsoCounter = Math.sin(phase + Math.PI * 0.15);

  return {
    hip: { rx: bounce * gain, ry: sway * 3.2 * gain, rz: sway * 1.4 * gain },
    chest: { rx: -bounce * 0.45 * gain, ry: -torsoCounter * 4.4 * gain, rz: -sway * 1.1 * gain },
    head: { rx: bounce * 0.25 * gain, ry: torsoCounter * 1.4 * gain, rz: 0 },

    sL: { rx: right * 18 * gain - liftRight * 4, ry: -3.5 * gain, rz: -5.5 * gain },
    fL: { rx: 12 + liftRight * 24 * gain + plantRight * 5, ry: 0, rz: 1.8 * gain },
    hL: { rx: -5 * gain + right * 2, ry: 0, rz: 0 },
    sR: { rx: left * 18 * gain - liftLeft * 4, ry: 3.5 * gain, rz: 5.5 * gain },
    fR: { rx: 12 + liftLeft * 24 * gain + plantLeft * 5, ry: 0, rz: -1.8 * gain },
    hR: { rx: -5 * gain + left * 2, ry: 0, rz: 0 },

    tL: { rx: left * 24 * gain, ry: 2.2 * gain, rz: -1.8 * gain },
    knL: { rx: liftLeft * 36 * gain + plantLeft * 4, ry: 0, rz: 0 },
    ftL: { rx: -liftLeft * 11 * gain + plantLeft * 3, ry: 0, rz: 0 },
    tR: { rx: right * 24 * gain, ry: -2.2 * gain, rz: 1.8 * gain },
    knR: { rx: liftRight * 36 * gain + plantRight * 4, ry: 0, rz: 0 },
    ftR: { rx: -liftRight * 11 * gain + plantRight * 3, ry: 0, rz: 0 },
  };
}

function flyPose(timeSeconds, gain) {
  const wave = Math.sin(timeSeconds * 2.1);
  const drift = Math.sin(timeSeconds * 0.95);
  const breathe = Math.sin(timeSeconds * 1.35);
  return {
    hip: { rx: -6 * gain, ry: drift * 5 * gain, rz: wave * 1.5 * gain },
    chest: { rx: 10 * gain + breathe, ry: -drift * 6 * gain, rz: -wave * 1.2 * gain },
    head: { rx: 5 * gain, ry: drift * 3.5 * gain, rz: 0 },

    sL: { rx: -10 * gain + wave * 5, ry: -30 * gain, rz: -16 * gain },
    fL: { rx: 14 * gain, ry: -7 * gain, rz: -12 * gain },
    hL: { rx: 6 * gain, ry: 0, rz: -4 * gain },
    sR: { rx: -10 * gain - wave * 5, ry: 30 * gain, rz: 16 * gain },
    fR: { rx: 14 * gain, ry: 7 * gain, rz: 12 * gain },
    hR: { rx: 6 * gain, ry: 0, rz: 4 * gain },

    tL: { rx: 22 * gain, ry: -8 * gain, rz: -5 * gain },
    knL: { rx: 34 * gain, ry: 0, rz: 0 },
    ftL: { rx: -12 * gain, ry: 0, rz: 0 },
    tR: { rx: 22 * gain, ry: 8 * gain, rz: 5 * gain },
    knR: { rx: 34 * gain, ry: 0, rz: 0 },
    ftR: { rx: -12 * gain, ry: 0, rz: 0 },
  };
}

function smoothPose(previous, target, deltaSeconds, responsiveness) {
  const alpha = 1 - Math.exp(-responsiveness * deltaSeconds);
  const pose = {};
  for (const [alias, rotation] of Object.entries(target)) {
    const start = previous[alias] ?? { rx: 0, ry: 0, rz: 0 };
    pose[alias] = {
      rx: lerp(start.rx, rotation.rx, alpha),
      ry: lerp(start.ry, rotation.ry, alpha),
      rz: lerp(start.rz, rotation.rz, alpha),
    };
  }
  return pose;
}

function scalePose(pose, scale) {
  return Object.fromEntries(Object.entries(pose).map(([alias, rotation]) => [
    alias,
    {
      rx: rotation.rx * scale,
      ry: rotation.ry * scale,
      rz: rotation.rz * scale,
    },
  ]));
}

function smooth01(value) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
