import { Q_ACTIONS, buildDiscreteState } from './qLearningAgent.js';

export function buildPolicyState({ rotations, reward, collisions, qtableReady = false }) {
  const discrete = buildDiscreteState({ rotations, reward, collisions });
  return {
    observation_space: {
      rotations,
      collisions: collisions.map(({ a, b, severity }) => ({ a, b, severity })),
      reward_components: {
        limits: reward.reward_limits,
        smoothness: reward.reward_smoothness,
        collision: reward.reward_collision,
        parent_child: reward.reward_parent_child,
        velocity: reward.reward_velocity,
        stability: reward.reward_stability,
      },
    },
    discrete_state_key: discrete.key,
    available_actions: Q_ACTIONS,
    action_space: 'macro_biomechanical_corrections',
    qtable_ready: qtableReady,
    algorithm_ready: 'Q_LEARNING_DISCRETE',
  };
}
