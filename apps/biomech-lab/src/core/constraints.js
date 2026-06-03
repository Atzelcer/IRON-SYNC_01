export const BIOMECHANICAL_LIMITS = {
  hip: { rx: { min: -25, max: 25 }, ry: { min: -35, max: 35 }, rz: { min: -20, max: 20 } },
  chest: { rx: { min: -35, max: 35 }, ry: { min: -45, max: 45 }, rz: { min: -30, max: 30 } },
  head: { rx: { min: -40, max: 40 }, ry: { min: -70, max: 70 }, rz: { min: -35, max: 35 } },

  sL: { rx: { min: -105, max: 120 }, ry: { min: -95, max: 95 }, rz: { min: -75, max: 75 } },
  fL: { rx: { min: 0, max: 145 }, ry: { min: -35, max: 35 }, rz: { min: -75, max: 75 } },
  hL: { rx: { min: -70, max: 80 }, ry: { min: -45, max: 45 }, rz: { min: -45, max: 45 } },

  sR: { rx: { min: -105, max: 120 }, ry: { min: -95, max: 95 }, rz: { min: -75, max: 75 } },
  fR: { rx: { min: 0, max: 145 }, ry: { min: -35, max: 35 }, rz: { min: -75, max: 75 } },
  hR: { rx: { min: -70, max: 80 }, ry: { min: -45, max: 45 }, rz: { min: -45, max: 45 } },

  tL: { rx: { min: -45, max: 95 }, ry: { min: -35, max: 45 }, rz: { min: -35, max: 35 } },
  knL: { rx: { min: 0, max: 135 }, ry: { min: -12, max: 12 }, rz: { min: -12, max: 12 } },
  ftL: { rx: { min: -45, max: 45 }, ry: { min: -25, max: 25 }, rz: { min: -25, max: 25 } },

  tR: { rx: { min: -45, max: 95 }, ry: { min: -35, max: 45 }, rz: { min: -35, max: 35 } },
  knR: { rx: { min: 0, max: 135 }, ry: { min: -12, max: 12 }, rz: { min: -12, max: 12 } },
  ftR: { rx: { min: -45, max: 45 }, ry: { min: -25, max: 25 }, rz: { min: -25, max: 25 } },
};

export function clampDegrees(value, limit) {
  return Math.min(limit.max, Math.max(limit.min, value));
}

export function clampRotator(alias, rotator) {
  const limits = BIOMECHANICAL_LIMITS[alias];
  if (!limits) return rotator.clone();
  return rotator.clone({
    pitch: clampDegrees(rotator.pitch, limits.rx),
    yaw: clampDegrees(rotator.yaw, limits.ry),
    roll: clampDegrees(rotator.roll, limits.rz),
  });
}

export function measureLimitViolations(alias, rotator) {
  const limits = BIOMECHANICAL_LIMITS[alias];
  if (!limits) return [];
  const checks = [
    ['rx', rotator.pitch],
    ['ry', rotator.yaw],
    ['rz', rotator.roll],
  ];
  return checks
    .filter(([axis, value]) => value < limits[axis].min || value > limits[axis].max)
    .map(([axis, value]) => ({ alias, axis, value, limit: limits[axis] }));
}
