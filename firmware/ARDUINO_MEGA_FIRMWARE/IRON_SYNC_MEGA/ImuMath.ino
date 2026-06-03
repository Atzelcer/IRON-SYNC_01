#include "IronSyncTypes.h"

float clampFloat(float value, float minValue, float maxValue) {
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}

float applyDeadzone(float value, float deadzone) {
  if (fabs(value) < deadzone) {
    return 0.0;
  }
  return value;
}

float limitStep(float current, float previous, float maxStep) {
  float delta = current - previous;

  if (delta > maxStep) return previous + maxStep;
  if (delta < -maxStep) return previous - maxStep;

  return current;
}

float angleDeltaDeg(float current, float reference) {
  float delta = current - reference;

  while (delta > 180.0) delta -= 360.0;
  while (delta < -180.0) delta += 360.0;

  return delta;
}

float maxFloat(float a, float b) {
  return a > b ? a : b;
}

float lowPassFilter(float previous, float sample, float alpha) {
  alpha = clampFloat(alpha, 0.02f, 0.95f);
  return previous + alpha * (sample - previous);
}

void updateMotionState(uint8_t idx, float pitchDelta, float rollDelta, float gyroMagDps) {
  float score = maxFloat(fabs(pitchDelta), fabs(rollDelta));
  score = maxFloat(score, gyroMagDps * 0.35f);

  imu[idx].motionScore = lowPassFilter(imu[idx].motionScore, score, 0.28f);

  if (imu[idx].quiet) {
    if (
      imu[idx].motionScore > MOTION_ENTER_DEG
      || gyroMagDps > MOTION_GYRO_ENTER_DPS
    ) {
      imu[idx].quiet = false;
#if QUIET_HARD_ZERO
      imu[idx].outRx = 0.0f;
      imu[idx].outRy = 0.0f;
      imu[idx].outRz = 0.0f;
#endif
    }
  } else {
    if (
      imu[idx].motionScore < MOTION_EXIT_DEG
      && gyroMagDps < MOTION_GYRO_EXIT_DPS
    ) {
      imu[idx].quiet = true;
#if QUIET_HARD_ZERO
      imu[idx].outRx = 0.0f;
      imu[idx].outRy = 0.0f;
      imu[idx].outRz = 0.0f;
#endif
    }
  }
}

const char* axisSourceName(IronAxisSource source) {
  if (source == AXIS_PITCH) return "pitch";
  if (source == AXIS_ROLL) return "roll";
  if (source == AXIS_YAW_RATE) return "yawRate";
  return "none";
}
