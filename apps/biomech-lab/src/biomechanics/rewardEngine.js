import { evaluateLimits, evaluateParentChild, evaluateVelocity } from './biomechanicalRules.js';

export class RewardEngine {
  evaluate({ rotations, previousRotations, deltaSeconds, collisions }) {
    const limitViolations = evaluateLimits(rotations);
    const velocity = evaluateVelocity(rotations, previousRotations, deltaSeconds);
    const parentChildIssues = evaluateParentChild(rotations);

    const rewardLimits = limitViolations.length === 0 ? 5 : -limitViolations.length * 4;
    const rewardCollision = collisions.length === 0 ? 4 : -collisions.reduce((sum, item) => sum + severityCost(item.severity), 0);
    const rewardVelocity = velocity.violations.length === 0 ? 2 : -velocity.violations.length * 3;
    const rewardParentChild = parentChildIssues.length === 0 ? 3 : -parentChildIssues.length * 2;
    const rewardSmoothness = velocity.maxVelocity < 80 ? 2 : velocity.maxVelocity < 180 ? 1 : -4;
    const rewardStability = collisions.length === 0 && limitViolations.length === 0 ? 2 : -1;

    const components = {
      reward_limits: rewardLimits,
      reward_smoothness: rewardSmoothness,
      reward_collision: rewardCollision,
      reward_parent_child: rewardParentChild,
      reward_velocity: rewardVelocity,
      reward_stability: rewardStability,
    };
    const rewardTotal = Object.values(components).reduce((sum, value) => sum + value, 0);

    return {
      reward_total: rewardTotal,
      ...components,
      valid: limitViolations.length === 0 && collisions.length === 0 && parentChildIssues.length === 0,
      rewards: activeRewards(components),
      penalties: activePenalties(components, limitViolations, velocity.violations, parentChildIssues, collisions),
      diagnostics: {
        limitViolations,
        velocityViolations: velocity.violations,
        parentChildIssues,
        maxVelocity: velocity.maxVelocity,
      },
    };
  }
}

function severityCost(severity) {
  if (severity === 'critical') return 10;
  if (severity === 'high') return 7;
  return 4;
}

function activeRewards(components) {
  return Object.entries(components)
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ({ name, value }));
}

function activePenalties(components, limitViolations, velocityViolations, parentChildIssues, collisions) {
  const items = Object.entries(components)
    .filter(([, value]) => value < 0)
    .map(([name, value]) => ({ name, value }));
  for (const item of limitViolations) items.push({ name: `${item.alias}.${item.axis} fuera de límite`, value: -4 });
  for (const item of velocityViolations) items.push({ name: `${item.alias} velocidad angular alta`, value: -3 });
  for (const item of parentChildIssues) items.push({ name: `${item.parent} → ${item.alias} incoherente`, value: -2 });
  for (const item of collisions) items.push({ name: item.label, value: -severityCost(item.severity) });
  return items;
}
