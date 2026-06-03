#include "IronSyncTypes.h"

void emitCalibrationProgress(uint8_t percent) {
  Serial.print("CAL_PROGRESS,");
  Serial.println(percent);
  Serial1.print("CAL_PROGRESS,");
  Serial1.println(percent);
}

void emitCalibrationSensor(uint8_t idx, const char* state) {
  Serial1.print("CAL_SENSOR,");
  Serial1.print(sensorMap[idx].key);
  Serial1.print(",");
  Serial1.print(state);
  Serial1.print(",zeroPitch=");
  Serial1.print(imu[idx].zeroPitch, 2);
  Serial1.print(",zeroRoll=");
  Serial1.print(imu[idx].zeroRoll, 2);
  Serial1.print(",gyroOff=(");
  Serial1.print(imu[idx].gyroOffX, 1);
  Serial1.print("/");
  Serial1.print(imu[idx].gyroOffY, 1);
  Serial1.print("/");
  Serial1.print(imu[idx].gyroOffZ, 1);
  Serial1.print("),jitterDeg=");
  Serial1.print(imu[idx].calJitterDeg, 2);
  Serial1.print(",gyroJitterDps=");
  Serial1.println(imu[idx].calGyroJitterDps, 2);

  Serial.print("CAL_SENSOR,");
  Serial.print(sensorMap[idx].key);
  Serial.print(",");
  Serial.print(state);
  Serial.print(",zeroPitch=");
  Serial.print(imu[idx].zeroPitch, 2);
  Serial.print(",zeroRoll=");
  Serial.print(imu[idx].zeroRoll, 2);
  Serial.print(",gyroOff=(");
  Serial.print(imu[idx].gyroOffX, 1);
  Serial.print("/");
  Serial.print(imu[idx].gyroOffY, 1);
  Serial.print("/");
  Serial.print(imu[idx].gyroOffZ, 1);
  Serial.print("),jitterDeg=");
  Serial.print(imu[idx].calJitterDeg, 2);
  Serial.print(",gyroJitterDps=");
  Serial.println(imu[idx].calGyroJitterDps, 2);
}

#if CAL_ZERO_USE_PROFILE_MIDPOINT
static float axisProfileCenter(const AxisCorrection& axis) {
  if (axis.source == AXIS_NONE || axis.sign == 0) {
    return 0.0f;
  }
  return (axis.limitMin + axis.limitMax) * 0.5f;
}

static float rawReadingForAxisSource(uint8_t idx, IronAxisSource source) {
  if (source == AXIS_PITCH) return imu[idx].pitch;
  if (source == AXIS_ROLL) return imu[idx].roll;
  if (source == AXIS_YAW_RATE) return imu[idx].yawRate;
  return 0.0f;
}

/** zeroRaw tal que (raw - zero) * sign * gain == center del perfil en pose de cal. */
static float rawZeroForProfileCenter(uint8_t idx, const AxisCorrection& axis) {
  float center = axisProfileCenter(axis);
  float denom = (float)axis.sign * axis.gain;
  if (fabs(denom) < 0.0001f) {
    return rawReadingForAxisSource(idx, axis.source);
  }
  return rawReadingForAxisSource(idx, axis.source) - center / denom;
}

static void applyProfileMidpointZeros(uint8_t idx) {
  AxisCorrection crx;
  AxisCorrection cry;
  AxisCorrection crz;
  getOutputAxisCorrection(idx, 0, crx);
  getOutputAxisCorrection(idx, 1, cry);
  getOutputAxisCorrection(idx, 2, crz);

  imu[idx].zeroPitch = imu[idx].pitch;
  imu[idx].zeroRoll = imu[idx].roll;
  imu[idx].zeroYawRate = imu[idx].yawRate;

  if (crx.source != AXIS_NONE) {
    float z = rawZeroForProfileCenter(idx, crx);
    if (crx.source == AXIS_PITCH) imu[idx].zeroPitch = z;
    else if (crx.source == AXIS_ROLL) imu[idx].zeroRoll = z;
    else if (crx.source == AXIS_YAW_RATE) imu[idx].zeroYawRate = z;
  }

  if (cry.source != AXIS_NONE && cry.source != crx.source) {
    float z = rawZeroForProfileCenter(idx, cry);
    if (cry.source == AXIS_PITCH) imu[idx].zeroPitch = z;
    else if (cry.source == AXIS_ROLL) imu[idx].zeroRoll = z;
    else if (cry.source == AXIS_YAW_RATE) imu[idx].zeroYawRate = z;
  }

  if (crz.source != AXIS_NONE && crz.source != crx.source && crz.source != cry.source) {
    float z = rawZeroForProfileCenter(idx, crz);
    if (crz.source == AXIS_PITCH) imu[idx].zeroPitch = z;
    else if (crz.source == AXIS_ROLL) imu[idx].zeroRoll = z;
    else if (crz.source == AXIS_YAW_RATE) imu[idx].zeroYawRate = z;
  }
}
#endif

#if FORCE_GOLDEN_REFERENCE
static bool applyGoldenEntryToSensor(uint8_t idx);
#endif

bool calibrateOneIMU(uint8_t idx, uint16_t sampleCount) {
#if FORCE_GOLDEN_REFERENCE
  (void)sampleCount;
  if (!sensorMap[idx].active) {
    if (!configureMPU(idx)) {
      return false;
    }
    sensorMap[idx].active = true;
  }
  return applyGoldenEntryToSensor(idx);
#else
  if (sampleCount < 32) {
    sampleCount = 32;
  }

  long sgx = 0;
  long sgy = 0;
  long sgz = 0;

  float sumAx = 0;
  float sumAy = 0;
  float sumAz = 0;
  float sumPitch = 0;
  float sumRollSin = 0;
  float sumRollCos = 0;
  float referencePitch = 0;
  float referenceRoll = 0;
  float maxPitchDelta = 0;
  float maxRollDelta = 0;
  float maxGyroDps = 0;
  int valid = 0;
  bool hasReference = false;

  resetCorrectionProfileForSensor(idx);

  // “Direccion” estable:
  // - Primera vez: detecta layout por gravedad y aplica signos/correcciones.
  // - Recalibraciones: si ya había layout detectado, lo reutiliza para no invertir
  //   el sentido (lo que rompe el dataset/animaciones).
  // Referencia del lab = ceros del mesh; orientacion fisica la detecta el Mega por gravedad.
#if LOCK_MOUNT_LAYOUT_AFTER_FIRST_CAL
  bool mountLocked = imu[idx].mount.detected && !imu[idx].labReferenceLoaded;
#else
  bool mountLocked = false;
#endif

  if (!mountLocked) {
    imu[idx].mount.detected = false;
    imu[idx].mount.layout = MOUNT_Z_UP;

    uint16_t mountProbe = sampleCount / 5;
    if (mountProbe < 24) {
      mountProbe = 24;
    }

    for (uint16_t i = 0; i < mountProbe; i++) {
      int16_t ax, ay, az, gx, gy, gz;

      if (readMPURaw(idx, ax, ay, az, gx, gy, gz)) {
        sumAx += ax / 16384.0;
        sumAy += ay / 16384.0;
        sumAz += az / 16384.0;
        valid++;
      }

      if ((i % CAL_LOOP_HANDLE_CMD_EVERY) == 0) {
        handleCommands();
        if (calibrationShouldAbort()) {
          return false;
        }
      } else {
        maintainLedBase();
      }
      delay(4);
    }

    if (valid >= 12) {
      detectMountFromGravityMean(sumAx / valid, sumAy / valid, sumAz / valid, imu[idx].mount);
      applyMountToCorrectionSigns(idx);
      applyBodySideToCorrectionSigns(idx);
    }
  } else {
    applyMountToCorrectionSigns(idx);
    applyBodySideToCorrectionSigns(idx);
  }

  sumAx = 0;
  sumAy = 0;
  sumAz = 0;
  valid = 0;
  hasReference = false;
  maxPitchDelta = 0;
  maxRollDelta = 0;
  maxGyroDps = 0;

  for (uint16_t i = 0; i < sampleCount; i++) {
    int16_t ax, ay, az, gx, gy, gz;

    if (readMPURaw(idx, ax, ay, az, gx, gy, gz)) {
      sgx += gx;
      sgy += gy;
      sgz += gz;

      float axg = ax / 16384.0;
      float ayg = ay / 16384.0;
      float azg = az / 16384.0;

      float pitchAcc;
      float rollAcc;
      computePitchRollFromAccel(axg, ayg, azg, imu[idx].mount, pitchAcc, rollAcc);

      if (!hasReference) {
        referencePitch = pitchAcc;
        referenceRoll = rollAcc;
        hasReference = true;
      }

      sumPitch += pitchAcc;
      sumRollSin += sin(rollAcc * PI / 180.0);
      sumRollCos += cos(rollAcc * PI / 180.0);

      maxPitchDelta = maxFloat(maxPitchDelta, fabs(angleDeltaDeg(pitchAcc, referencePitch)));
      maxRollDelta = maxFloat(maxRollDelta, fabs(angleDeltaDeg(rollAcc, referenceRoll)));

      float gxDps = gx / 131.0f;
      float gyDps = gy / 131.0f;
      float gzDps = gz / 131.0f;
      float bgx, bgy, bgz;
      remapGyroToBody(gxDps, gyDps, gzDps, imu[idx].mount, bgx, bgy, bgz);
      float gyroMag = sqrt(bgx * bgx + bgy * bgy + bgz * bgz);

      if (gyroMag > maxGyroDps) {
        maxGyroDps = gyroMag;
      }

      valid++;
    }

    if ((i % CAL_LOOP_HANDLE_CMD_EVERY) == 0) {
      handleCommands();
      if (calibrationShouldAbort()) {
        return false;
      }
    } else {
      maintainLedBase();
    }
    delay(5);
  }

  if (valid < (int)(sampleCount * CAL_MIN_VALID_READ_RATIO)) {
    sensorMap[idx].active = false;
    sensorMap[idx].calibrated = false;
    markSensorLost(idx);
    imu[idx].calJitterDeg = 999;
    imu[idx].calGyroJitterDps = 999;
    emitCalibrationSensor(idx, "CAL_FAIL_READS");
    return false;
  }

  emitMountProfile(idx);

  imu[idx].calJitterDeg = maxFloat(maxPitchDelta, maxRollDelta);
  imu[idx].calGyroJitterDps = maxGyroDps;

  if (!RAW_ORIENTATION_STREAM && maxGyroDps > CAL_GYRO_HARD_FAIL_DPS) {
    sensorMap[idx].calibrated = false;
    emitCalibrationSensor(idx, "CAL_FAIL_MOVING");
    return false;
  }

  float stabilityMaxDeg = (sampleCount <= CAL_QUICK_SAMPLES + 20) ? 70.0f : CAL_STABILITY_MAX_DEG;
  uint8_t detectedNow = countActiveDetected();
  if (detectedNow > 0 && detectedNow < SENSOR_COUNT) {
    stabilityMaxDeg = CAL_STABILITY_PARTIAL_MAX_DEG;
  }

  if (!RAW_ORIENTATION_STREAM && imu[idx].calJitterDeg > stabilityMaxDeg) {
    if (
      imu[idx].calJitterDeg <= stabilityMaxDeg + CAL_STABILITY_SOFT_EXTRA_DEG
      && maxGyroDps <= CAL_GYRO_STABILITY_MAX_DPS
    ) {
      Serial1.print("WARN,CAL_SOFT_STABILITY,");
      Serial1.print(sensorMap[idx].key);
      Serial1.print(",jitterDeg=");
      Serial1.println(imu[idx].calJitterDeg, 2);
    } else {
      sensorMap[idx].calibrated = false;
      emitCalibrationSensor(idx, "CAL_FAIL_STABILITY");
      return false;
    }
  }

  if (maxGyroDps > CAL_GYRO_STABILITY_MAX_DPS) {
    Serial1.print("WARN,CAL_GYRO_JITTER,");
    Serial1.print(sensorMap[idx].key);
    Serial1.print(",gyroJitterDps=");
    Serial1.println(maxGyroDps, 2);
  }

  if (imu[idx].calJitterDeg > 12.0) {
    Serial1.print("WARN,CAL_ACCEL_JITTER,");
    Serial1.print(sensorMap[idx].key);
    Serial1.print(",jitterDeg=");
    Serial1.println(imu[idx].calJitterDeg, 2);
  }

  imu[idx].gyroOffX = sgx / (float)valid;
  imu[idx].gyroOffY = sgy / (float)valid;
  imu[idx].gyroOffZ = sgz / (float)valid;

  float fallbackPitch = sumPitch / (float)valid;
  float fallbackRoll = atan2(sumRollSin, sumRollCos) * 180.0 / PI;

  sumPitch = 0;
  sumRollSin = 0;
  sumRollCos = 0;
  int refineValid = 0;

  for (uint16_t i = 0; i < sampleCount / 4; i++) {
    if (calibrationShouldAbort()) {
      return false;
    }

    int16_t ax, ay, az, gx, gy, gz;

    if (!readMPURaw(idx, ax, ay, az, gx, gy, gz)) {
      continue;
    }

    float axg = ax / 16384.0;
    float ayg = ay / 16384.0;
    float azg = az / 16384.0;
    float pitchAcc;
    float rollAcc;

    computePitchRollFromAccel(axg, ayg, azg, imu[idx].mount, pitchAcc, rollAcc);
    sumPitch += pitchAcc;
    sumRollSin += sin(rollAcc * PI / 180.0);
    sumRollCos += cos(rollAcc * PI / 180.0);
    refineValid++;

    if ((i % CAL_LOOP_HANDLE_CMD_EVERY) == 0) {
      handleCommands();
      if (calibrationShouldAbort()) {
        return false;
      }
    }

    delay(3);
  }

  if (refineValid >= 4) {
    imu[idx].pitch = sumPitch / (float)refineValid;
    imu[idx].roll = atan2(sumRollSin, sumRollCos) * 180.0 / PI;
  } else {
    imu[idx].pitch = fallbackPitch;
    imu[idx].roll = fallbackRoll;
  }
  imu[idx].yawRate = 0;

  if (!imu[idx].labReferenceLoaded) {
#if CAL_ZERO_USE_PROFILE_MIDPOINT
    applyProfileMidpointZeros(idx);
#else
    imu[idx].zeroPitch = imu[idx].pitch;
    imu[idx].zeroRoll = imu[idx].roll;
    imu[idx].zeroYawRate = 0;
#endif
  }

  imu[idx].outRx = 0;
  imu[idx].outRy = 0;
  imu[idx].outRz = 0;
  imu[idx].motionScore = 0;
  imu[idx].quiet = true;

  imu[idx].lastMicros = micros();
  imu[idx].lastGoodReadMs = millis();
  imu[idx].failCount = 0;
  imu[idx].lostReported = false;

  sensorMap[idx].calibrated = true;
  emitCalibrationSensor(idx, "OK");
  return true;
#endif /* !FORCE_GOLDEN_REFERENCE */
}

bool quickRecalibrateOneIMU(uint8_t idx) {
  if (!sensorMap[idx].active) {
    return false;
  }

#if FORCE_GOLDEN_REFERENCE
  return applyGoldenEntryToSensor(idx);
#else
  return calibrateOneIMU(idx, CAL_QUICK_SAMPLES);
#endif
}

bool calibrateSensorByKey(const char* key, uint16_t sampleCount) {
  if (isCalibrating) {
    Serial1.println("ERR,CAL_SENSOR_BLOCKED_FULL_CAL");
    return false;
  }

  int8_t idx = findSensorIndexByKey(key);

  if (idx < 0) {
    Serial1.print("CAL_ERROR,UNKNOWN_SENSOR,");
    Serial1.println(key);
    return false;
  }

  if (!sensorMap[idx].active && !configureMPU(idx)) {
    Serial1.print("CAL_ERROR,SENSOR_OFFLINE,");
    Serial1.println(key);
    return false;
  }

  sensorMap[idx].active = true;
  startCalibrationVisual();

  bool ok = calibrateOneIMU((uint8_t)idx, sampleCount);

  stopCalibrationVisual();

  if (calibrationShouldAbort()) {
    Serial1.print("CAL_SENSOR_DONE,");
    Serial1.print(key);
    Serial1.println(",ABORT");
    return false;
  }

  if (ok) {
    buzzerOk();
  } else {
    buzzerFail();
  }

  Serial1.print("CAL_SENSOR_DONE,");
  Serial1.print(key);
  Serial1.print(",");
  Serial1.println(ok ? "OK" : "FAIL");

  return ok;
}

static bool parseReferenceFloat(const char* payload, const char* key, float& out) {
  const char* pos = strstr(payload, key);
  if (!pos) {
    return false;
  }

  pos += strlen(key);
  const char* end = strchr(pos, ',');
  char token[20];
  uint8_t len = 0;

  while (pos[len] && pos[len] != ',' && len < (sizeof(token) - 1)) {
    token[len] = pos[len];
    len++;
  }
  token[len] = '\0';

  out = atof(token);
  (void)end;
  return true;
}

static void trimTokenInPlace(char* token) {
  if (!token) {
    return;
  }

  uint8_t len = (uint8_t)strlen(token);
  while (len > 0 && (token[len - 1] == ' ' || token[len - 1] == '\t')) {
    token[--len] = '\0';
  }

  uint8_t start = 0;
  while (token[start] == ' ' || token[start] == '\t') {
    start++;
  }

  if (start > 0) {
    memmove(token, token + start, strlen(token + start) + 1);
  }
}

bool loadCalReferenceSensorLine(const char* cmd) {
  const char* prefix = "LOAD_CAL_REFERENCE_SENSOR,";
  if (strncmp(cmd, prefix, strlen(prefix)) != 0) {
    return false;
  }

  const char* keyStart = cmd + strlen(prefix);
  const char* keyEnd = strchr(keyStart, ',');
  if (!keyEnd) {
    return false;
  }

  char key[12];
  uint8_t keyLen = (uint8_t)(keyEnd - keyStart);
  if (keyLen >= sizeof(key)) {
    return false;
  }
  memcpy(key, keyStart, keyLen);
  key[keyLen] = '\0';
  trimTokenInPlace(key);

  int8_t idx = findSensorIndexByKey(key);
  if (idx < 0) {
    return false;
  }

  const char* payload = keyEnd + 1;
  const char* layoutPos = strstr(payload, "layout=");
  if (layoutPos) {
    layoutPos += 7;
    const char* layoutEnd = strchr(layoutPos, ',');
    char layoutName[16];
    uint8_t layoutLen = layoutEnd
      ? (uint8_t)(layoutEnd - layoutPos)
      : (uint8_t)strlen(layoutPos);
    if (layoutLen >= sizeof(layoutName)) {
      return false;
    }
    memcpy(layoutName, layoutPos, layoutLen);
    layoutName[layoutLen] = '\0';
    trimTokenInPlace(layoutName);
    for (uint8_t i = 0; layoutName[i]; i++) {
      if (layoutName[i] >= 'a' && layoutName[i] <= 'z') {
        layoutName[i] = (char)(layoutName[i] - 'a' + 'A');
      }
    }

    uint8_t layout = MOUNT_Z_UP;
    if (!layoutFromName(layoutName, layout)) {
      return false;
    }

    if (!setSensorMountLayout((uint8_t)idx, layout)) {
      return false;
    }
  }

  parseReferenceFloat(payload, "zeroPitch=", imu[idx].zeroPitch);
  parseReferenceFloat(payload, "zeroRoll=", imu[idx].zeroRoll);
  parseReferenceFloat(payload, "zeroYawRate=", imu[idx].zeroYawRate);

  const char* gyroPos = strstr(payload, "gyroOff=(");
  if (gyroPos) {
    gyroPos += 9;
    const char* gyroEnd = strchr(gyroPos, ')');
    if (gyroEnd && gyroEnd > gyroPos) {
      char triplet[48];
      uint8_t tripletLen = (uint8_t)(gyroEnd - gyroPos);
      if (tripletLen < sizeof(triplet)) {
        memcpy(triplet, gyroPos, tripletLen);
        triplet[tripletLen] = '\0';
        char* slash1 = strchr(triplet, '/');
        char* slash2 = slash1 ? strchr(slash1 + 1, '/') : nullptr;
        if (slash1 && slash2 && slash2 > slash1) {
          *slash1 = '\0';
          *slash2 = '\0';
          imu[idx].gyroOffX = atof(triplet);
          imu[idx].gyroOffY = atof(slash1 + 1);
          imu[idx].gyroOffZ = atof(slash2 + 1);
        }
      }
    }
  }

  imu[idx].pitch = imu[idx].zeroPitch;
  imu[idx].roll = imu[idx].zeroRoll;
  imu[idx].yawRate = imu[idx].zeroYawRate;
  imu[idx].outRx = 0;
  imu[idx].outRy = 0;
  imu[idx].outRz = 0;
  imu[idx].quiet = true;
  imu[idx].motionScore = 0;
  imu[idx].labReferenceLoaded = true;

  if (!sensorMap[idx].active) {
    sensorMap[idx].active = configureMPU((uint8_t)idx);
  }

  sensorMap[idx].calibrated = sensorMap[idx].active;
  imu[idx].lastGoodReadMs = millis();

  emitCalibrationSensor((uint8_t)idx, "LOADED");
  return true;
}

struct GoldenCalEntry {
  uint8_t layout;
  float zeroPitch;
  float zeroRoll;
  float gyroOffX;
  float gyroOffY;
  float gyroOffZ;
};

/** Orden = índice sensorMap (chest..ftL). */
static const GoldenCalEntry kGoldenCal[SENSOR_COUNT] PROGMEM = {
  { MOUNT_Z_UP,   -0.624f,   3.329f,  -396.556f,  213.388f, -103.394f },
  { MOUNT_Y_UP,  -19.925f, -15.352f,  -523.463f,  160.994f,  -19.194f },
  { MOUNT_Y_UP,   -0.705f,  15.071f,   -99.469f,  105.588f,   95.750f },
  { MOUNT_Y_DOWN, 11.033f,  -3.776f,   120.838f,  140.325f,   68.250f },
  { MOUNT_Y_DOWN,  2.106f,   6.955f,  -241.638f,  218.875f,  -29.056f },
  { MOUNT_Y_DOWN,  6.681f,   7.122f,     5.963f,  113.606f,   -1.594f },
  { MOUNT_Y_DOWN,  4.002f,   3.706f,   573.088f,  230.138f,   79.250f },
  { MOUNT_Z_UP,   -0.309f,   1.271f,  -152.050f,  203.450f,    0.544f },
  { MOUNT_Z_UP,  -47.711f,  67.358f,  -221.891f,  161.984f,    3.172f },
  { MOUNT_Z_UP,  -39.768f,  43.726f,   -14.172f,  161.156f,   10.828f },
  { MOUNT_Z_UP,   43.151f,   0.486f,   120.575f,  249.969f,  -64.369f },
  { MOUNT_Z_UP,   -7.662f,  46.422f,  -205.788f,  141.781f,  -45.338f },
  { MOUNT_Z_UP,  -37.236f,  72.541f,  -327.734f,  295.687f,   34.531f },
  { MOUNT_Z_UP,   41.950f,   2.398f,    68.931f,  107.931f,  -40.931f },
  { MOUNT_Z_UP,   -0.531f,   3.075f,  -136.406f,  242.475f,  -25.881f },
};

static bool applyGoldenFallbackToSensor(
  uint8_t idx,
  uint8_t layout,
  float zeroPitch,
  float zeroRoll,
  float gyroOffX,
  float gyroOffY,
  float gyroOffZ
) {
  if (!setSensorMountLayout(idx, layout)) {
    return false;
  }

  imu[idx].zeroPitch = zeroPitch;
  imu[idx].zeroRoll = zeroRoll;
  imu[idx].zeroYawRate = 0.0f;
  imu[idx].gyroOffX = gyroOffX;
  imu[idx].gyroOffY = gyroOffY;
  imu[idx].gyroOffZ = gyroOffZ;
  imu[idx].pitch = zeroPitch;
  imu[idx].roll = zeroRoll;
  imu[idx].yawRate = 0.0f;
  imu[idx].outRx = 0.0f;
  imu[idx].outRy = 0.0f;
  imu[idx].outRz = 0.0f;
  imu[idx].quiet = true;
  imu[idx].motionScore = 0.0f;
  imu[idx].lastMicros = micros();
  imu[idx].lastGoodReadMs = millis();
  imu[idx].failCount = 0;
  imu[idx].lostReported = false;

  sensorMap[idx].calibrated = sensorMap[idx].active;
  emitCalibrationSensor(idx, "GOLDEN");
  return sensorMap[idx].calibrated;
}

#if GOLDEN_ADAPTIVE_MOUNT_ZERO
static bool applyAdaptiveGoldenToSensor(
  uint8_t idx,
  uint8_t fallbackLayout,
  float fallbackZeroPitch,
  float fallbackZeroRoll,
  float fallbackGyroOffX,
  float fallbackGyroOffY,
  float fallbackGyroOffZ
) {
  if (!sensorMap[idx].active && !configureMPU(idx)) {
    return false;
  }

  sensorMap[idx].active = true;

  float sumAx = 0.0f;
  float sumAy = 0.0f;
  float sumAz = 0.0f;
  long sumGx = 0;
  long sumGy = 0;
  long sumGz = 0;
  float maxGyroDps = 0.0f;
  uint16_t valid = 0;

  for (uint16_t i = 0; i < GOLDEN_ADAPTIVE_SAMPLES; i++) {
    int16_t ax, ay, az, gx, gy, gz;

    if (readMPURaw(idx, ax, ay, az, gx, gy, gz)) {
      sumAx += ax / 16384.0f;
      sumAy += ay / 16384.0f;
      sumAz += az / 16384.0f;
      sumGx += gx;
      sumGy += gy;
      sumGz += gz;

      float gxDps = gx / 131.0f;
      float gyDps = gy / 131.0f;
      float gzDps = gz / 131.0f;
      float gyroMag = sqrt(gxDps * gxDps + gyDps * gyDps + gzDps * gzDps);
      if (gyroMag > maxGyroDps) {
        maxGyroDps = gyroMag;
      }
      valid++;
    }

    if ((i % CAL_LOOP_HANDLE_CMD_EVERY) == 0) {
      handleCommands();
      if (calibrationShouldAbort()) {
        return false;
      }
    } else {
      maintainLedBase();
    }
    delay(4);
  }

  uint16_t minValid = (uint16_t)(GOLDEN_ADAPTIVE_SAMPLES * GOLDEN_ADAPTIVE_MIN_VALID_RATIO);
  if (valid < minValid) {
    Serial1.print(F("WARN,ADAPTIVE_CAL_LOW_READS,"));
    Serial1.print(sensorMap[idx].key);
    Serial1.print(F(",valid="));
    Serial1.println(valid);
    return applyGoldenFallbackToSensor(
      idx,
      fallbackLayout,
      fallbackZeroPitch,
      fallbackZeroRoll,
      fallbackGyroOffX,
      fallbackGyroOffY,
      fallbackGyroOffZ
    );
  }

  float meanAx = sumAx / valid;
  float meanAy = sumAy / valid;
  float meanAz = sumAz / valid;
  float gravityMag = sqrt(meanAx * meanAx + meanAy * meanAy + meanAz * meanAz);

  if (gravityMag < GOLDEN_ADAPTIVE_MIN_GRAVITY_G || maxGyroDps > GOLDEN_ADAPTIVE_MAX_GYRO_DPS) {
    Serial1.print(F("WARN,ADAPTIVE_CAL_UNSTABLE,"));
    Serial1.print(sensorMap[idx].key);
    Serial1.print(F(",g="));
    Serial1.print(gravityMag, 3);
    Serial1.print(F(",gyro="));
    Serial1.println(maxGyroDps, 1);
    return applyGoldenFallbackToSensor(
      idx,
      fallbackLayout,
      fallbackZeroPitch,
      fallbackZeroRoll,
      fallbackGyroOffX,
      fallbackGyroOffY,
      fallbackGyroOffZ
    );
  }

  ImuMountProfile detectedMount;
  detectedMount.layout = fallbackLayout;
  detectedMount.detected = false;
  detectedMount.gravityX = meanAx;
  detectedMount.gravityY = meanAy;
  detectedMount.gravityZ = meanAz;
  detectMountFromGravityMean(meanAx, meanAy, meanAz, detectedMount);
  if (!detectedMount.detected) {
    detectedMount.layout = fallbackLayout;
  }

  if (detectedMount.layout != fallbackLayout) {
    Serial1.print(F("WARN,ADAPTIVE_LAYOUT_CHANGED,"));
    Serial1.print(sensorMap[idx].key);
    Serial1.print(F(",golden="));
    Serial1.print(fallbackLayout);
    Serial1.print(F(",detected="));
    Serial1.println(detectedMount.layout);
  }

  imu[idx].mount.gravityX = meanAx;
  imu[idx].mount.gravityY = meanAy;
  imu[idx].mount.gravityZ = meanAz;
  setSensorMountLayout(idx, detectedMount.layout);
  imu[idx].mount.gravityX = meanAx;
  imu[idx].mount.gravityY = meanAy;
  imu[idx].mount.gravityZ = meanAz;

  imu[idx].gyroOffX = sumGx / (float)valid;
  imu[idx].gyroOffY = sumGy / (float)valid;
  imu[idx].gyroOffZ = sumGz / (float)valid;

  float sumPitch = 0.0f;
  float sumRollSin = 0.0f;
  float sumRollCos = 0.0f;
  uint16_t poseValid = 0;

  for (uint16_t i = 0; i < (GOLDEN_ADAPTIVE_SAMPLES / 2); i++) {
    int16_t ax, ay, az, gx, gy, gz;

    if (readMPURaw(idx, ax, ay, az, gx, gy, gz)) {
      float pitchAcc;
      float rollAcc;
      computePitchRollFromAccel(
        ax / 16384.0f,
        ay / 16384.0f,
        az / 16384.0f,
        imu[idx].mount,
        pitchAcc,
        rollAcc
      );
      sumPitch += pitchAcc;
      sumRollSin += sin(rollAcc * PI / 180.0f);
      sumRollCos += cos(rollAcc * PI / 180.0f);
      poseValid++;
    }

    if ((i % CAL_LOOP_HANDLE_CMD_EVERY) == 0) {
      handleCommands();
      if (calibrationShouldAbort()) {
        return false;
      }
    } else {
      maintainLedBase();
    }
    delay(4);
  }

  if (poseValid < 12) {
    Serial1.print(F("WARN,ADAPTIVE_CAL_POSE_READS,"));
    Serial1.print(sensorMap[idx].key);
    Serial1.print(F(",valid="));
    Serial1.println(poseValid);
    return applyGoldenFallbackToSensor(
      idx,
      fallbackLayout,
      fallbackZeroPitch,
      fallbackZeroRoll,
      fallbackGyroOffX,
      fallbackGyroOffY,
      fallbackGyroOffZ
    );
  }

  imu[idx].pitch = sumPitch / poseValid;
  imu[idx].roll = atan2(sumRollSin, sumRollCos) * 180.0f / PI;
  imu[idx].yawRate = 0.0f;

#if CAL_ZERO_USE_PROFILE_MIDPOINT
  applyProfileMidpointZeros(idx);
#else
  imu[idx].zeroPitch = imu[idx].pitch;
  imu[idx].zeroRoll = imu[idx].roll;
  imu[idx].zeroYawRate = 0.0f;
#endif

  imu[idx].outRx = 0.0f;
  imu[idx].outRy = 0.0f;
  imu[idx].outRz = 0.0f;
  imu[idx].quiet = true;
  imu[idx].motionScore = 0.0f;
  imu[idx].calJitterDeg = 0.0f;
  imu[idx].calGyroJitterDps = maxGyroDps;
  imu[idx].lastMicros = micros();
  imu[idx].lastGoodReadMs = millis();
  imu[idx].failCount = 0;
  imu[idx].lostReported = false;

  sensorMap[idx].calibrated = true;
  emitMountProfile(idx);
  emitCalibrationSensor(idx, "ADAPTIVE");
  return true;
}
#endif

/** Sin GoldenCalEntry en la firma (evita error de prototipos auto del IDE Arduino). */
static bool applyGoldenEntryToSensor(uint8_t idx) {
  GoldenCalEntry entry;

  if (idx >= SENSOR_COUNT) {
    return false;
  }

  memcpy_P(&entry, &kGoldenCal[idx], sizeof(entry));

  if (!sensorMap[idx].active && !configureMPU(idx)) {
    return false;
  }
  sensorMap[idx].active = true;

#if GOLDEN_ADAPTIVE_MOUNT_ZERO
  return applyAdaptiveGoldenToSensor(
    idx,
    entry.layout,
    entry.zeroPitch,
    entry.zeroRoll,
    entry.gyroOffX,
    entry.gyroOffY,
    entry.gyroOffZ
  );
#else
  return applyGoldenFallbackToSensor(
    idx,
    entry.layout,
    entry.zeroPitch,
    entry.zeroRoll,
    entry.gyroOffX,
    entry.gyroOffY,
    entry.gyroOffZ
  );
#endif
}

static uint8_t applyGoldenCalReference() {
  uint8_t loaded = 0;

  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    if (applyGoldenEntryToSensor(i)) {
      loaded++;
    }
  }

  Serial.print(F("CAL_GOLDEN_APPLIED,loaded="));
  Serial.println(loaded);
  Serial1.print(F("CAL_GOLDEN_APPLIED,loaded="));
  Serial1.println(loaded);
  return loaded;
}

static void goldenSuccessBlink() {
  // Confirmación visual extra: verde ↔ anaranjado intermitente, luego blanco.
  for (uint8_t i = 0; i < 6; i++) {
    if ((i & 1) == 0) {
      setLedGreen();
    } else {
      setLedYellow();
    }
    refreshCurrentLed();
    handleCommands();
    delay(110);
  }
  setLedWhite();
  refreshCurrentLed();
}

static bool runGoldenCalibrationWindow(unsigned long durationMs) {
  unsigned long startMs = millis();
  while (millis() - startMs < durationMs) {
    if (calibrationShouldAbort()) {
      return false;
    }
    calibrationEffectTick();
    handleCommands();
    delay(10);
  }
  return true;
}

const char* layoutNameFromLayout(uint8_t layout) {
  switch (layout) {
    case MOUNT_Z_DOWN: return "Z_DOWN";
    case MOUNT_Y_UP: return "Y_UP";
    case MOUNT_Y_DOWN: return "Y_DOWN";
    case MOUNT_X_UP: return "X_UP";
    case MOUNT_X_DOWN: return "X_DOWN";
    case MOUNT_Z_UP:
    default: return "Z_UP";
  }
}

static void printCalReferenceSensorLine(Stream& out, uint8_t i) {
  out.print("CAL_REFERENCE_SENSOR,");
  out.print(sensorMap[i].key);
  out.print(",layout=");
  out.print(layoutNameFromLayout(imu[i].mount.layout));

  out.print(",zeroPitch=");
  out.print(imu[i].zeroPitch, 3);
  out.print(",zeroRoll=");
  out.print(imu[i].zeroRoll, 3);
  out.print(",zeroYawRate=");
  out.print(imu[i].zeroYawRate, 3);

  out.print(",gyroOff=(");
  out.print(imu[i].gyroOffX, 3);
  out.print("/");
  out.print(imu[i].gyroOffY, 3);
  out.print("/");
  out.print(imu[i].gyroOffZ, 3);
  out.print(")");

  AxisCorrection crx;
  AxisCorrection cry;
  AxisCorrection crz;
  getOutputAxisCorrection(i, 0, crx);
  getOutputAxisCorrection(i, 1, cry);
  getOutputAxisCorrection(i, 2, crz);

  out.print(F(",corr_rx="));
  out.print(axisSourceName(crx.source));
  out.print('*');
  out.print(crx.sign);
  out.print('*');
  out.print(crx.gain, 2);

  out.print(F(",corr_ry="));
  out.print(axisSourceName(cry.source));
  out.print('*');
  out.print(cry.sign);
  out.print('*');
  out.print(cry.gain, 2);

  out.print(F(",corr_rz="));
  out.print(axisSourceName(crz.source));
  out.print('*');
  out.print(crz.sign);
  out.print('*');
  out.print(crz.gain, 2);

  out.print(F(",rxLim="));
  out.print(crx.limitMin, 1);
  out.print(F(".."));
  out.print(crx.limitMax, 1);
  out.print(F(",ryLim="));
  out.print(cry.limitMin, 1);
  out.print(F(".."));
  out.print(cry.limitMax, 1);
  out.print(F(",rzLim="));
  out.print(crz.limitMin, 1);
  out.print(F(".."));
  out.print(crz.limitMax, 1);

  out.println();
}

void printCalibrationReferenceSnapshot() {
  Serial.println(F("CAL_REFERENCE_BEGIN"));
  Serial1.println(F("CAL_REFERENCE_BEGIN"));

  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    printCalReferenceSensorLine(Serial, i);
    printCalReferenceSensorLine(Serial1, i);
  }

  Serial.println(F("CAL_REFERENCE_END"));
  Serial1.println(F("CAL_REFERENCE_END"));

  Serial1.print(F("CAL_REFERENCE_READY,"));
  Serial1.print(SENSOR_COUNT);
  Serial1.println(F(",serial1=full"));
}

static void emitCalSummary(uint8_t activeDetected, uint8_t okCount, uint8_t streamableCount, bool fullSuccess) {
  Serial.print("CAL_SUMMARY,detected=");
  Serial.print(activeDetected);
  Serial.print(",calibrated=");
  Serial.print(okCount);
  Serial.print(",streamable=");
  Serial.print(streamableCount);
  Serial.print(",full=");
  Serial.println(fullSuccess ? 1 : 0);

  Serial1.print("CAL_SUMMARY,detected=");
  Serial1.print(activeDetected);
  Serial1.print(",calibrated=");
  Serial1.print(okCount);
  Serial1.print(",streamable=");
  Serial1.print(streamableCount);
  Serial1.print(",full=");
  Serial1.println(fullSuccess ? 1 : 0);
}

void calibrateAllIMUs() {
  clearCalibrationAbort();
  isCalibrating = true;
  dataStreamPaused = false;
  systemRunning = false;
  calibrationDone = false;

  Serial.println("CAL_START_LOCAL");
  Serial1.println("CAL_STARTED");

  melodyCalStartAck();

  if (!waitForCalibrationPose()) {
    finishCalibrationAborted();
    return;
  }

  if (calibrationShouldAbort()) {
    finishCalibrationAborted();
    return;
  }

  startCalibrationVisual();
  emitCalibrationProgress(1);
  if (!runGoldenCalibrationWindow(MIN_CALIBRATION_BLUE_MS)) {
    finishCalibrationAborted();
    return;
  }

  resetTCAs();
  scanAndConfigureSensors();
  emitCalibrationProgress(65);
  calibrateEMG();
  emitCalibrationProgress(78);

  uint8_t okCount = 0;
#if FORCE_GOLDEN_REFERENCE
  okCount = applyGoldenCalReference();
#else
  emitCalibrationProgress(82);
  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    if (calibrationShouldAbort()) {
      finishCalibrationAborted();
      return;
    }

    if (!sensorMap[i].active) {
      if (!configureMPU(i)) {
        continue;
      }
      sensorMap[i].active = true;
    }

    if (calibrateOneIMU(i, CAL_SAMPLES)) {
      okCount++;
    }

    uint8_t pct = (uint8_t)(82 + ((uint16_t)(i + 1) * 16) / SENSOR_COUNT);
    emitCalibrationProgress(pct);
    handleCommands();
  }
#endif

  readAllImus();
  delay(8);
  readAllImus();

  stopCalibrationVisual();
  isCalibrating = false;
  clearCalibrationAbort();

  uint8_t activeDetected = countActiveDetected();
  uint8_t streamableCount = 0;
  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    if (shouldStreamSensor(i)) streamableCount++;
  }

  bool fullSuccess = (okCount == SENSOR_COUNT) && (streamableCount >= FULL_SENSOR_CALIBRATION_COUNT);
  calibrationDone = okCount >= MIN_ACTIVE_IMUS_TO_RUN && streamableCount > 0;
  systemRunning = calibrationDone;
  lastSendTime = 0;
  emitCalibrationProgress(100);
  printCorrectionProfile();
  printCalibrationReferenceSnapshot();
  emitCalSummary(activeDetected, okCount, streamableCount, fullSuccess);

  if (calibrationDone) {
    Wire.clearWireTimeoutFlag();
    resetRuntimeStats();

    if (fullSuccess) {
      buzzerDone();
      goldenSuccessBlink();
    } else {
      buzzerPartialCalibration();
      Serial.print("WARN,CAL_PARTIAL,detected=");
      Serial.print(activeDetected);
      Serial.print(",calibrated=");
      Serial.print(okCount);
      Serial.print(",streamable=");
      Serial.println(streamableCount);

      Serial1.print("WARN,CAL_PARTIAL,detected=");
      Serial1.print(activeDetected);
      Serial1.print(",calibrated=");
      Serial1.print(okCount);
      Serial1.print(",streamable=");
      Serial1.println(streamableCount);
    }

    finishCalibrationStandby();

    Serial.println("CAL_OK");
    Serial.println("CALIBRATION_DONE");
    Serial.print("STATUS,STREAM_STARTED,activeSensors=");
    Serial.println(streamableCount);

    Serial1.println("CAL_OK");
    Serial1.println("CALIBRATION_DONE");
    Serial1.print("STATUS,STREAM_STARTED,activeSensors=");
    Serial1.println(streamableCount);
  } else {
    Serial.print("CAL_ERROR,STABLE_ACTIVE=");
    Serial.println(okCount);

    Serial1.print("CAL_ERROR,STABLE_ACTIVE=");
    Serial1.println(okCount);

    buzzerFail();
    finishCalibrationStandby();
  }
}
