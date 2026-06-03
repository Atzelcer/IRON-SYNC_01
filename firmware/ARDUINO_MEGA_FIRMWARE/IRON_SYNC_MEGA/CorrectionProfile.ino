#include "IronSyncTypes.h"

#define CR_MIRROR_RX  0x01
#define CR_MIRROR_RY  0x02
#define CR_MIRROR_RZ  0x04
#define CR_SWAP_RX_RY 0x08
#define CR_SWAP_RX_RZ 0x10
#define CR_FLIP_RY    0x20
#define CR_FLIP_RZ    0x40
#define CR_MOUNT_MASK 0x1F

struct CorrectionRuntime {
  uint8_t mountFlags;
  uint8_t dzRx10;
  uint8_t dzRy10;
  uint8_t dzRz10;
};

static CorrectionRuntime correctionRt[SENSOR_COUNT];

// { source, sign, gain, deadzone, limitMin, limitMax } — rx/ry/rz (3 ejes rotacionales)
static const SensorCorrectionProfile kCorrectionBase[SENSOR_COUNT] PROGMEM = {
  {"chest",
    {AXIS_PITCH,  1, 1.00f, 1.05f, -28.0f, 28.0f},
    {AXIS_ROLL,   1, 1.00f, 1.05f, -28.0f, 28.0f},
    {AXIS_YAW_RATE, 1, 1.00f, 1.10f, -45.0f, 45.0f}, false},

  {"fL",
    {AXIS_PITCH,  1, 1.00f, 1.20f, -110.0f, 110.0f},
    {AXIS_ROLL,   1, 1.00f, 1.20f, -120.0f, 120.0f},
    {AXIS_YAW_RATE, 1, 1.00f, 1.15f, -90.0f, 90.0f}, false},

  {"sL",
    {AXIS_PITCH,  1, 1.00f, 1.25f, -78.0f, 78.0f},
    {AXIS_ROLL,   1, 1.00f, 1.25f, -90.0f, 90.0f},
    {AXIS_YAW_RATE, 1, 1.00f, 1.15f, -75.0f, 75.0f}, false},

  {"hL",
    {AXIS_PITCH,  1, 1.00f, 1.15f, -58.0f, 58.0f},
    {AXIS_ROLL,   1, 1.00f, 1.15f, -58.0f, 58.0f},
    {AXIS_YAW_RATE, 1, 1.00f, 1.10f, -65.0f, 65.0f}, false},

  {"sR",
    {AXIS_PITCH,  1, 1.00f, 1.25f, -78.0f, 78.0f},
    {AXIS_ROLL,  -1, 1.00f, 1.25f, -90.0f, 90.0f},
    {AXIS_YAW_RATE, -1, 1.00f, 1.15f, -75.0f, 75.0f}, false},

  {"fR",
    {AXIS_PITCH,  1, 1.00f, 1.20f, -110.0f, 110.0f},
    {AXIS_ROLL,  -1, 1.00f, 1.20f, -120.0f, 120.0f},
    {AXIS_YAW_RATE, -1, 1.00f, 1.15f, -90.0f, 90.0f}, false},

  {"hR",
    {AXIS_PITCH,  1, 1.00f, 1.15f, -58.0f, 58.0f},
    {AXIS_ROLL,  -1, 1.00f, 1.15f, -58.0f, 58.0f},
    {AXIS_YAW_RATE, -1, 1.00f, 1.10f, -65.0f, 65.0f}, false},

  {"head",
    {AXIS_PITCH,  1, 1.00f, 1.15f, -35.0f, 35.0f},
    {AXIS_ROLL,   1, 1.00f, 1.15f, -40.0f, 40.0f},
    {AXIS_YAW_RATE, 1, 1.00f, 1.20f, -55.0f, 55.0f}, false},

  {"hip",
    {AXIS_PITCH,  1, 1.00f, 1.00f, -22.0f, 22.0f},
    {AXIS_ROLL,   1, 1.00f, 1.00f, -22.0f, 22.0f},
    {AXIS_YAW_RATE, 1, 1.00f, 1.05f, -35.0f, 35.0f}, false},

  {"tR",
    {AXIS_PITCH,  1, 1.00f, 1.20f, -90.0f, 90.0f},
    {AXIS_ROLL,  -1, 1.00f, 1.20f, -58.0f, 58.0f},
    {AXIS_YAW_RATE, -1, 1.00f, 1.15f, -70.0f, 70.0f}, false},

  {"knR",
    {AXIS_PITCH,  1, 1.00f, 1.25f, -115.0f, 28.0f},
    {AXIS_ROLL,  -1, 1.00f, 1.05f, -40.0f, 40.0f},
    {AXIS_YAW_RATE, -1, 1.00f, 1.10f, -45.0f, 45.0f}, false},

  {"ftR",
    {AXIS_PITCH,  1, 1.00f, 1.15f, -78.0f, 78.0f},
    {AXIS_ROLL,  -1, 1.00f, 1.15f, -58.0f, 58.0f},
    {AXIS_YAW_RATE, -1, 1.00f, 1.10f, -55.0f, 55.0f}, false},

  {"tL",
    {AXIS_PITCH,  1, 1.00f, 1.20f, -90.0f, 90.0f},
    {AXIS_ROLL,   1, 1.00f, 1.20f, -58.0f, 58.0f},
    {AXIS_YAW_RATE, 1, 1.00f, 1.15f, -70.0f, 70.0f}, false},

  {"knL",
    {AXIS_PITCH,  1, 1.00f, 1.25f, -115.0f, 28.0f},
    {AXIS_ROLL,   1, 1.00f, 1.05f, -40.0f, 40.0f},
    {AXIS_YAW_RATE, 1, 1.00f, 1.10f, -45.0f, 45.0f}, false},

  {"ftL",
    {AXIS_PITCH,  1, 1.00f, 1.15f, -78.0f, 78.0f},
    {AXIS_ROLL,   1, 1.00f, 1.15f, -58.0f, 58.0f},
    {AXIS_YAW_RATE, 1, 1.00f, 1.10f, -55.0f, 55.0f}, false}
};

static void readProgmemAxisCorrection(uint8_t idx, uint8_t axis, AxisCorrection& out) {
  const SensorCorrectionProfile* prof = &kCorrectionBase[idx];

  if (axis == 0) {
    memcpy_P(&out, &(prof->rx), sizeof(AxisCorrection));
  } else if (axis == 1) {
    memcpy_P(&out, &(prof->ry), sizeof(AxisCorrection));
  } else {
    memcpy_P(&out, &(prof->rz), sizeof(AxisCorrection));
  }
}

static void mirrorAxisSign(AxisCorrection& axis) {
  if (axis.source != AXIS_NONE && axis.sign != 0) {
    axis.sign = (int8_t)(-axis.sign);
    float tmpMin = axis.limitMin;
    axis.limitMin = -axis.limitMax;
    axis.limitMax = -tmpMin;
  }
}

static void applyDeadzoneOverride(AxisCorrection& axis, uint8_t dz10) {
  if (dz10 > 0) {
    axis.deadzone = dz10 * 0.1f;
  }
}

void getOutputAxisCorrection(uint8_t idx, uint8_t channel, AxisCorrection& out) {
  uint8_t flags = correctionRt[idx].mountFlags;
  uint8_t baseAxis = channel;

  if (flags & CR_SWAP_RX_RY) {
    if (channel == 0) {
      baseAxis = 1;
    } else if (channel == 1) {
      baseAxis = 0;
    }
  }

  if (flags & CR_SWAP_RX_RZ) {
    if (channel == 0) {
      baseAxis = 2;
    } else if (channel == 2) {
      baseAxis = 0;
    }
  }

  readProgmemAxisCorrection(idx, baseAxis, out);

  if (channel == 0 && (flags & CR_MIRROR_RX)) {
    mirrorAxisSign(out);
  } else if (channel == 1 && (flags & CR_MIRROR_RY)) {
    mirrorAxisSign(out);
  } else if (channel == 2 && (flags & CR_MIRROR_RZ)) {
    mirrorAxisSign(out);
  }

  if (channel == 0) {
    applyDeadzoneOverride(out, correctionRt[idx].dzRx10);
  } else if (channel == 1) {
    applyDeadzoneOverride(out, correctionRt[idx].dzRy10);
    if (flags & CR_FLIP_RY) {
      mirrorAxisSign(out);
    }
  } else {
    applyDeadzoneOverride(out, correctionRt[idx].dzRz10);
    if (flags & CR_FLIP_RZ) {
      mirrorAxisSign(out);
    }
  }
}

void applyMountToCorrectionSigns(uint8_t idx) {
  if (!imu[idx].mount.detected) {
    return;
  }

  uint8_t keep = correctionRt[idx].mountFlags & (CR_FLIP_RY | CR_FLIP_RZ);
  uint8_t mountFlags = 0;

  if (imu[idx].mount.layout == MOUNT_Z_DOWN) {
    mountFlags = CR_MIRROR_RX | CR_MIRROR_RY | CR_MIRROR_RZ;
  } else if (
    imu[idx].mount.layout == MOUNT_Y_UP ||
    imu[idx].mount.layout == MOUNT_Y_DOWN
  ) {
    mountFlags = CR_SWAP_RX_RY | CR_MIRROR_RZ;
  } else if (
    imu[idx].mount.layout == MOUNT_X_UP ||
    imu[idx].mount.layout == MOUNT_X_DOWN
  ) {
    mountFlags = CR_SWAP_RX_RZ;
  }

  correctionRt[idx].mountFlags = keep | mountFlags;
}

void applyBodySideToCorrectionSigns(uint8_t idx) {
  BodySide side = bodySideFromKey(sensorMap[idx].key);
  uint8_t flags = correctionRt[idx].mountFlags & CR_MOUNT_MASK;

  correctionRt[idx].mountFlags = flags;

  if (side != SIDE_RIGHT) {
    return;
  }

  AxisCorrection ry;
  AxisCorrection rz;
  readProgmemAxisCorrection(idx, 1, ry);
  readProgmemAxisCorrection(idx, 2, rz);

  if (ry.source != AXIS_NONE && ry.sign > 0) {
    correctionRt[idx].mountFlags |= CR_FLIP_RY;
  }
  if (rz.source != AXIS_NONE && rz.sign > 0) {
    correctionRt[idx].mountFlags |= CR_FLIP_RZ;
  }
}

static void tuneCorrectionDeadzones(uint8_t idx) {
  const char* key = sensorMap[idx].key;
  float dz = OUTPUT_DEADZONE_DEG;

  if (strcmp(key, "head") == 0) {
    dz = OUTPUT_DEADZONE_HEAD_DEG;
  } else if (strcmp(key, "hip") == 0 || strcmp(key, "chest") == 0) {
    dz = OUTPUT_DEADZONE_DEG;
  } else {
    dz = OUTPUT_DEADZONE_LIMB_DEG;
  }

  correctionRt[idx].dzRx10 = (uint8_t)(dz * 10.0f + 0.5f);
  correctionRt[idx].dzRy10 = correctionRt[idx].dzRx10;

  AxisCorrection rz;
  readProgmemAxisCorrection(idx, 2, rz);
  if (rz.source != AXIS_NONE) {
    correctionRt[idx].dzRz10 = (uint8_t)(YAW_RATE_DEADZONE_DPS * 10.0f + 0.5f);
  } else {
    correctionRt[idx].dzRz10 = 0;
  }
}

void resetCorrectionProfileForSensor(uint8_t idx) {
  correctionRt[idx].mountFlags = 0;
  correctionRt[idx].dzRx10 = 0;
  correctionRt[idx].dzRy10 = 0;
  correctionRt[idx].dzRz10 = 0;
  tuneCorrectionDeadzones(idx);
  applyBodySideToCorrectionSigns(idx);
}

void initCorrectionProfiles() {
  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    resetCorrectionProfileForSensor(i);
  }
}

float readAxisValue(uint8_t idx, IronAxisSource source) {
  if (source == AXIS_PITCH) return imu[idx].pitch - imu[idx].zeroPitch;
  if (source == AXIS_ROLL) return imu[idx].roll - imu[idx].zeroRoll;
  if (source == AXIS_YAW_RATE) return imu[idx].yawRate - imu[idx].zeroYawRate;
  return 0.0;
}

float applyAxisCorrection(uint8_t idx, AxisCorrection correction) {
  (void)idx;

  if (correction.source == AXIS_NONE || correction.sign == 0) {
    return 0.0;
  }

  float value = readAxisValue(idx, correction.source);
  value *= correction.sign;
  value *= correction.gain;
  value = applyDeadzone(value, correction.deadzone);
  value = clampFloat(value, correction.limitMin, correction.limitMax);

  return value;
}

void hardZeroOutputs(uint8_t idx) {
  imu[idx].outRx = 0.0f;
  imu[idx].outRy = 0.0f;
  imu[idx].outRz = 0.0f;
}

void updateCorrectedOutputs(uint8_t idx) {
#if QUIET_HARD_ZERO
  if (!isCalibrating && imu[idx].quiet) {
    hardZeroOutputs(idx);
    return;
  }
#endif

  float smoothAlpha = isCalibrating ? SMOOTH_ALPHA : STREAM_SMOOTH_ALPHA;
  float stepLimit = isCalibrating ? OUTPUT_STEP_LIMIT_DEG : STREAM_STEP_LIMIT_DEG;

  AxisCorrection crx;
  AxisCorrection cry;
  AxisCorrection crz;
  getOutputAxisCorrection(idx, 0, crx);
  getOutputAxisCorrection(idx, 1, cry);
  getOutputAxisCorrection(idx, 2, crz);

  float nextRx = applyAxisCorrection(idx, crx);
  float nextRy = applyAxisCorrection(idx, cry);
  float nextRz = applyAxisCorrection(idx, crz);

  nextRx = limitStep(nextRx, imu[idx].outRx, stepLimit);
  nextRy = limitStep(nextRy, imu[idx].outRy, stepLimit);
  nextRz = limitStep(nextRz, imu[idx].outRz, stepLimit);

  imu[idx].outRx += smoothAlpha * (nextRx - imu[idx].outRx);
  imu[idx].outRy += smoothAlpha * (nextRy - imu[idx].outRy);
  imu[idx].outRz += smoothAlpha * (nextRz - imu[idx].outRz);

#if QUIET_HARD_ZERO
  if (!isCalibrating && imu[idx].quiet) {
    if (
      fabs(imu[idx].outRx) < OUTPUT_GHOST_CLAMP_DEG
      && fabs(imu[idx].outRy) < OUTPUT_GHOST_CLAMP_DEG
      && fabs(imu[idx].outRz) < OUTPUT_GHOST_CLAMP_DEG
    ) {
      hardZeroOutputs(idx);
    }
  }
#endif
}

static void printOneAxisProfile(Stream& out, uint8_t idx, uint8_t channel, const char* label) {
  AxisCorrection axis;
  getOutputAxisCorrection(idx, channel, axis);

  out.print(label);
  out.print('=');
  out.print(axisSourceName(axis.source));
  out.print('*');
  out.print(axis.sign);
  out.print('*');
  out.print(axis.gain, 2);
}

void printCorrectionProfile() {
  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    AxisCorrection crx;
    AxisCorrection cry;
    AxisCorrection crz;
    getOutputAxisCorrection(i, 0, crx);
    getOutputAxisCorrection(i, 1, cry);
    getOutputAxisCorrection(i, 2, crz);

    Serial1.print(F("PROFILE,"));
    Serial1.print(sensorMap[i].key);
    Serial1.print(F(",rx="));
    Serial1.print(axisSourceName(crx.source));
    Serial1.print('*');
    Serial1.print(crx.sign);
    Serial1.print('*');
    Serial1.print(crx.gain, 2);
    Serial1.print(F(",lim="));
    Serial1.print(crx.limitMin, 1);
    Serial1.print(F(".."));
    Serial1.print(crx.limitMax, 1);
    Serial1.print(F(",ry="));
    Serial1.print(axisSourceName(cry.source));
    Serial1.print('*');
    Serial1.print(cry.sign);
    Serial1.print('*');
    Serial1.print(cry.gain, 2);
    Serial1.print(F(",lim="));
    Serial1.print(cry.limitMin, 1);
    Serial1.print(F(".."));
    Serial1.print(cry.limitMax, 1);
    Serial1.print(F(",rz="));
    Serial1.print(axisSourceName(crz.source));
    Serial1.print('*');
    Serial1.print(crz.sign);
    Serial1.print('*');
    Serial1.print(crz.gain, 2);
    Serial1.print(F(",lim="));
    Serial1.print(crz.limitMin, 1);
    Serial1.print(F(".."));
    Serial1.println(crz.limitMax, 1);

    Serial.print(F("PROFILE,"));
    Serial.print(sensorMap[i].key);
    Serial.print(F(",rx="));
    Serial.print(axisSourceName(crx.source));
    Serial.print('*');
    Serial.print(crx.sign);
    Serial.print('*');
    Serial.print(crx.gain, 2);
    Serial.println();
  }
}
