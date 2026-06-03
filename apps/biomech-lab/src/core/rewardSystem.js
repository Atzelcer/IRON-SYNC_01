import { measureLimitViolations } from './constraints.js';

const REWARD_RULES = {
  smoothMotion: 2,
  anatomicallyValid: 5,
  boneCoherence: 3,
  lowAngularVibration: 1,
};

const PENALTY_RULES = {
  handThroughChest: -10,
  reversedElbow: -12,
  kneeOutOfRange: -12,
  abruptJump: -5,
};

export class RewardSystem {
  evaluate(frame) {
    const events = [];
    let reward = 0;

    const limitViolations = frame.rotations.flatMap(({ alias, rotator }) =>
      measureLimitViolations(alias, rotator),
    );

    if (limitViolations.length === 0) {
      reward += REWARD_RULES.anatomicallyValid;
      events.push({ type: 'reward', label: 'Movimiento anatómicamente correcto', value: 5 });
    } else {
      const kneeViolation = limitViolations.some((item) => item.alias === 'knL' || item.alias === 'knR');
      const value = kneeViolation ? PENALTY_RULES.kneeOutOfRange : -6;
      reward += value;
      events.push({ type: 'penalty', label: 'Articulación fuera de rango', value });
    }

    if (frame.smoothness < 8) {
      reward += REWARD_RULES.smoothMotion;
      events.push({ type: 'reward', label: 'Movimiento fluido', value: 2 });
    } else {
      reward += PENALTY_RULES.abruptJump;
      events.push({ type: 'penalty', label: 'Saltos bruscos', value: -5 });
    }

    if (frame.angularVibration < 4) {
      reward += REWARD_RULES.lowAngularVibration;
      events.push({ type: 'reward', label: 'Baja vibración angular', value: 1 });
    }

    if (frame.coherenceScore > 0.72) {
      reward += REWARD_RULES.boneCoherence;
      events.push({ type: 'reward', label: 'Coherencia entre huesos', value: 3 });
    }

    for (const collision of frame.collisions) {
      const value = collision.severity === 'critical' ? PENALTY_RULES.handThroughChest : -4;
      reward += value;
      events.push({ type: 'penalty', label: collision.label, value });
    }

    return {
      total: reward,
      events,
      limitViolations,
    };
  }
}
