export const UNREAL_INITIAL_POSE = {
  hip: { bone: 'Hips', rx: 90.0, ry: -0.0, rz: 80.0, tx: -2.681, ty: 0.359, tz: 39.345 },
  chest: { bone: 'Spine2', rx: 82.718, ry: 0.0, rz: 80.0, tx: -1.07, ty: 0.075, tz: 52.143 },
  sL: { bone: 'LeftArm', rx: -120.969, ry: 1.241, rz: -9.302, tx: 0.91, ty: 7.439, tz: 54.669 },
  fL: { bone: 'LeftForeArm', rx: -119.992, ry: -12.809, rz: -0.717, tx: 1.843, ty: 12.08, tz: 46.788 },
  hL: { bone: 'LeftHand', rx: -113.423, ry: -14.33, rz: -3.249, tx: 0.193, ty: 16.543, tz: 39.283 },
  sR: { bone: 'RightArm', rx: -120.921, ry: -2.91, rz: 169.085, tx: -1.671, ty: -7.532, tz: 54.669 },
  fR: { bone: 'RightForeArm', rx: -120.023, ry: 11.467, rz: 160.377, tx: -2.172, ty: -12.249, tz: 46.788 },
  hR: { bone: 'RightHand', rx: -109.363, ry: 12.217, rz: 163.355, tx: -5.092, ty: -15.906, tz: 39.283 },
  head: { bone: 'Head', rx: 90.0, ry: 0.0, rz: 80.0, tx: -1.138, ty: 0.087, tz: 59.673 },
  tL: { bone: 'LeftUpLeg', rx: -93.377, ry: -3.157, rz: -99.814, tx: -2.046, ty: 3.825, tz: 37.271 },
  knL: { bone: 'LeftLeg', rx: -95.936, ry: -1.322, rz: -99.922, tx: -0.939, ty: 4.55, tz: 20.904 },
  ftL: { bone: 'LeftFoot', rx: -37.363, ry: -1.476, rz: -101.413, tx: 0.642, ty: 4.621, tz: 6.047 },
  tR: { bone: 'RightUpLeg', rx: -93.752, ry: 3.154, rz: -100.207, tx: -3.257, ty: -3.117, tz: 37.271 },
  knR: { bone: 'RightLeg', rx: -95.196, ry: 1.322, rz: -100.087, tx: -2.359, ty: -4.195, tz: 20.904 },
  ftR: { bone: 'RightFoot', rx: -37.527, ry: 1.46, rz: -98.566, tx: -1.089, ty: -4.769, tz: 6.047 },
};

export function getUnrealPose(alias) {
  return UNREAL_INITIAL_POSE[alias] ?? null;
}
