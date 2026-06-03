import { BONE_ORDER } from '../core/boneMap.js';

/** Catálogo alineado con modos de DRL Demo / AutonomousAgent. */
export const GESTURE_CATALOG = [
  gesture('cal_still', 'Quieto base', [], 2.5),
  gesture('head_pitch', 'Cabeza adelante/atras', ['head'], 3.6),
  gesture('head_yaw', 'Cabeza inclinacion lateral', ['head'], 3.4),
  gesture('head_roll', 'Cabeza izquierda/derecha', ['head', 'chest'], 3.4),
  gesture('left_arm_forward', 'Brazo izquierdo frente', ['sL', 'fL', 'hL', 'chest'], 3.6),
  gesture('right_arm_forward', 'Brazo derecho frente', ['sR', 'fR', 'hR', 'chest'], 3.6),
  gesture('both_arms_forward', 'Ambos brazos frente', ['sL', 'fL', 'hL', 'sR', 'fR', 'hR', 'chest'], 4.0),
  gesture('left_arm_front', 'Brazo izquierdo costado 90', ['sL', 'fL', 'hL', 'chest'], 3.5),
  gesture('right_arm_front', 'Brazo derecho costado 90', ['sR', 'fR', 'hR', 'chest'], 3.5),
  gesture('left_arm_side', 'Brazo izquierdo costado 60', ['sL', 'fL', 'hL', 'chest'], 3.5),
  gesture('right_arm_side', 'Brazo derecho costado 60', ['sR', 'fR', 'hR', 'chest'], 3.5),
  gesture('left_arm_back', 'Brazo izquierdo atras', ['sL', 'fL', 'hL', 'chest'], 3.5),
  gesture('right_arm_back', 'Brazo derecho atras', ['sR', 'fR', 'hR', 'chest'], 3.5),
  gesture('left_forearm_flex', 'Antebrazo izquierdo flexion/extension', ['sL', 'fL', 'hL'], 4.0),
  gesture('right_forearm_flex', 'Antebrazo derecho flexion/extension', ['sR', 'fR', 'hR'], 4.0),
  gesture('left_hand_wave', 'Mano izquierda saludo', ['sL', 'fL', 'hL'], 3.0),
  gesture('right_hand_wave', 'Mano derecha saludo', ['sR', 'fR', 'hR'], 3.0),
  gesture('left_thigh_front', 'Muslo izquierdo adelante', ['hip', 'tL', 'knL', 'ftL', 'chest'], 3.5),
  gesture('right_thigh_front', 'Muslo derecho adelante', ['hip', 'tR', 'knR', 'ftR', 'chest'], 3.5),
  gesture('left_thigh_back', 'Muslo izquierdo atras', ['hip', 'tL', 'knL', 'ftL'], 3.5),
  gesture('right_thigh_back', 'Muslo derecho atras', ['hip', 'tR', 'knR', 'ftR'], 3.5),
  gesture('left_leg_knee_flex', 'Rodilla izquierda flexion', ['tL', 'knL', 'ftL'], 3.5),
  gesture('right_leg_knee_flex', 'Rodilla derecha flexion', ['tR', 'knR', 'ftR'], 3.5),
  gesture('left_foot_pitch', 'Pie izquierdo punta', ['knL', 'ftL'], 3.0),
  gesture('right_foot_pitch', 'Pie derecho punta', ['knR', 'ftR'], 3.0),
  gesture('left_foot_roll', 'Pie izquierdo lateral', ['knL', 'ftL'], 3.0),
  gesture('right_foot_roll', 'Pie derecho lateral', ['knR', 'ftR'], 3.0),
  gesture('torso_twist_left', 'Torso giro izquierda', ['hip', 'chest', 'head'], 3.5),
  gesture('torso_twist_right', 'Torso giro derecha', ['hip', 'chest', 'head'], 3.5),
  gesture('body_turn_left', 'Cuerpo giro izquierda', ['hip', 'chest', 'head', 'tL', 'knL', 'ftL', 'tR', 'ftR'], 3.5),
  gesture('body_turn_right', 'Cuerpo giro derecha', ['hip', 'chest', 'head', 'tR', 'knR', 'ftR', 'tL', 'ftL'], 3.5),
  gesture('body_bend_front', 'Cuerpo flexion adelante', ['hip', 'chest', 'head'], 3.5),
  gesture('body_bend_back', 'Cuerpo extension atras', ['hip', 'chest', 'head'], 3.5),
  gesture('body_bend_left', 'Cuerpo inclinacion izquierda', ['hip', 'chest', 'head'], 3.5),
  gesture('body_bend_right', 'Cuerpo inclinacion derecha', ['hip', 'chest', 'head'], 3.5),
  gesture('walk', 'Caminar coordinado', [...BONE_ORDER], 4.5),
  gesture('run', 'Correr coordinado', [...BONE_ORDER], 4.0),
  gesture('fly', 'Volar coordinado', [...BONE_ORDER], 4.0),
  gesture('soft', 'Exploracion suave', [...BONE_ORDER], 4.0),
  gesture('medium', 'Exploracion media', [...BONE_ORDER], 4.0),
  gesture('aggressive', 'Exploracion agresiva', [...BONE_ORDER], 4.0),
];

export const GESTURE_CATALOG_BY_ID = Object.fromEntries(GESTURE_CATALOG.map((item) => [item.id, item]));

export function gestureActiveBones(animationId) {
  return GESTURE_CATALOG_BY_ID[animationId]?.activeBones ?? [];
}

function gesture(id, name, activeBones, seconds) {
  return {
    id,
    name,
    activeBones,
    seconds,
    instruction: `Replica el movimiento: ${name}`,
  };
}
