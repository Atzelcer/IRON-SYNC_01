#include "IronSyncTypes.h"

ImuState imu[SENSOR_COUNT];

uint8_t countActiveDetected() {
  uint8_t count = 0;

  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    if (sensorMap[i].active) {
      count++;
    }
  }

  return count;
}

void emitSensorState(uint8_t idx, const char* state) {
  Serial.print("SENSOR_STATE,");
  Serial.print(sensorMap[idx].key);
  Serial.print(",");
  Serial.println(state);

  Serial1.print("SENSOR_STATE,");
  Serial1.print(sensorMap[idx].key);
  Serial1.print(",");
  Serial1.println(state);
}

void emitQuality(uint8_t idx) {
  Serial1.print("QUALITY,");
  Serial1.print(sensorMap[idx].key);
  Serial1.print(",jitterDeg=");
  Serial1.print(imu[idx].calJitterDeg, 2);
  Serial1.print(",gyroJitterDps=");
  Serial1.print(imu[idx].calGyroJitterDps, 2);
  Serial1.print(",failCount=");
  Serial1.print(imu[idx].failCount);
  Serial1.print(",calibrated=");
  Serial1.print(sensorMap[idx].calibrated ? 1 : 0);
  Serial1.print(",lost=");
  Serial1.print(imu[idx].lostReported ? 1 : 0);
  Serial1.print(",lastGoodMs=");
  Serial1.println(imu[idx].lastGoodReadMs);

  Serial.print("QUALITY,");
  Serial.print(sensorMap[idx].key);
  Serial.print(",jitterDeg=");
  Serial.print(imu[idx].calJitterDeg, 2);
  Serial.print(",gyroJitterDps=");
  Serial.print(imu[idx].calGyroJitterDps, 2);
  Serial.print(",failCount=");
  Serial.print(imu[idx].failCount);
  Serial.print(",calibrated=");
  Serial.print(sensorMap[idx].calibrated ? 1 : 0);
  Serial.print(",lost=");
  Serial.print(imu[idx].lostReported ? 1 : 0);
  Serial.print(",lastGoodMs=");
  Serial.println(imu[idx].lastGoodReadMs);
}

void markSensorLost(uint8_t idx) {
  if (!imu[idx].lostReported) {
    emitSensorState(idx, "LOST");
    imu[idx].lostReported = true;
    lostEventTotal++;
  }
}

bool recoverOneIMU(uint8_t idx) {
  if (systemRunning && calibrationDone) {
    return false;
  }

  recoverAttemptTotal++;
  imu[idx].lastRecoverAttemptMs = millis();

  bool recovered = configureMPU(idx);

  if (recovered) {
    recoverSuccessTotal++;
    sensorMap[idx].active = true;
    imu[idx].failCount = 0;
    imu[idx].lostReported = false;
    imu[idx].lastMicros = micros();
    imu[idx].lastGoodReadMs = millis();
    emitSensorState(idx, "RECOVERED");
  } else {
    emitSensorState(idx, "OFFLINE");
  }

  return recovered;
}

void recoverAllInactiveSensors() {
  if (systemRunning && calibrationDone) {
    return;
  }

  resetTCAs();
  maintainLedBase();

  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    if (!sensorMap[i].active) {
      recoverOneIMU(i);
      maintainLedBase();
    }
  }
  maintainLedBase();
}

void resetAndRecoverIMUs() {
  bool wasRunning = systemRunning;
  systemRunning = false;

  resetTCAs();
  scanAndConfigureSensors();

  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    if (sensorMap[i].active) {
      emitSensorState(i, "RECOVERED");
    } else {
      emitSensorState(i, "OFFLINE");
    }
    maintainLedBase();
  }

  systemRunning = wasRunning && calibrationDone;
  maintainLedBase();

  Serial1.print("RESET_IMUS_DONE,mask=");
  Serial1.print(getSensorMask());
  Serial1.print(",activeSensors=");
  Serial1.println(getActiveSensorCount());
}

void initImuSystemNoCalibration() {
  resetTCAs();
  scanAndConfigureSensors();

  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    imu[i].gyroOffX = 0;
    imu[i].gyroOffY = 0;
    imu[i].gyroOffZ = 0;

    imu[i].pitch = 0;
    imu[i].roll = 0;
    imu[i].yawRate = 0;

    imu[i].zeroPitch = 0;
    imu[i].zeroRoll = 0;
    imu[i].zeroYawRate = 0;

    imu[i].outRx = 0;
    imu[i].outRy = 0;
    imu[i].outRz = 0;
    imu[i].rawAx = 0;
    imu[i].rawAy = 0;
    imu[i].rawAz = 0;
    imu[i].rawGx = 0;
    imu[i].rawGy = 0;
    imu[i].rawGz = 0;
    imu[i].motionScore = 0;
    imu[i].quiet = true;

    imu[i].calJitterDeg = 0;
    imu[i].calGyroJitterDps = 0;

    imu[i].mount.layout = MOUNT_Z_UP;
    imu[i].mount.detected = false;
    imu[i].mount.gravityX = 0;
    imu[i].mount.gravityY = 0;
    imu[i].mount.gravityZ = 1;

    imu[i].lastMicros = micros();
    imu[i].lastGoodReadMs = 0;
    imu[i].lastRecoverAttemptMs = 0;
    imu[i].failCount = 0;
    imu[i].lostReported = false;

    sensorMap[i].calibrated = false;
  }
}

void tryRecoverMissingSensors() {
  static unsigned long lastTryMs = 0;

  if (!calibrationDone || isCalibrating || systemRunning) {
    return;
  }

  if (millis() - lastTryMs < 4000) {
    return;
  }

  lastTryMs = millis();

  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    if (!sensorMap[i].active) {
      recoverOneIMU(i);
    }
  }
}

void readOneIMU(uint8_t idx) {
  unsigned long nowMs = millis();

  if (!sensorMap[idx].active || !sensorMap[idx].calibrated) {
    if (!sensorMap[idx].active && nowMs - imu[idx].lastRecoverAttemptMs >= SENSOR_RECOVER_INTERVAL_MS) {
      recoverOneIMU(idx);
    }
    return;
  }

  if (imu[idx].lostReported) {
    if (nowMs - imu[idx].lastRecoverAttemptMs >= SENSOR_LOST_RECOVER_INTERVAL_MS) {
      if (configureMPU(idx)) {
        imu[idx].failCount = 0;
        imu[idx].lostReported = false;
        imu[idx].lastGoodReadMs = nowMs;
        sensorMap[idx].calibrated = false;
        emitSensorState(idx, "NEEDS_FULL_CAL");
        emitSensorState(idx, "RECOVERED");
      } else {
        imu[idx].lastRecoverAttemptMs = nowMs;
      }
    }
    return;
  }

  int16_t ax, ay, az, gxRaw, gyRaw, gzRaw;

  if (!readMPURaw(idx, ax, ay, az, gxRaw, gyRaw, gzRaw)) {
    imu[idx].failCount++;
    readFailureTotal++;

    if (imu[idx].failCount >= SENSOR_FAILS_BEFORE_LOST || nowMs - imu[idx].lastGoodReadMs >= SENSOR_LOST_MS) {
      markSensorLost(idx);
    } else if (imu[idx].failCount == 4) {
      emitSensorState(idx, "WARN_MICROCUT");
    }

    return;
  }

  imu[idx].rawAx = ax;
  imu[idx].rawAy = ay;
  imu[idx].rawAz = az;
  imu[idx].rawGx = gxRaw;
  imu[idx].rawGy = gyRaw;
  imu[idx].rawGz = gzRaw;

  if (imu[idx].failCount > 0) {
    emitSensorState(idx, "RECOVERED");
  }

  imu[idx].failCount = 0;
  imu[idx].lostReported = false;

  imu[idx].lastGoodReadMs = nowMs;

  unsigned long nowMicros = micros();
  float dt = (nowMicros - imu[idx].lastMicros) / 1000000.0;
  imu[idx].lastMicros = nowMicros;

  if (dt <= 0 || dt > 0.2) {
    dt = SEND_INTERVAL_MS / 1000.0;
  }

  float axg = ax / 16384.0f;
  float ayg = ay / 16384.0f;
  float azg = az / 16384.0f;

  float gxDps = (gxRaw - imu[idx].gyroOffX) / 131.0f;
  float gyDps = (gyRaw - imu[idx].gyroOffY) / 131.0f;
  float gzDps = (gzRaw - imu[idx].gyroOffZ) / 131.0f;

  float bx, by, bz;
  float bgx, bgy, bgz;
  remapAccelToBody(axg, ayg, azg, imu[idx].mount, bx, by, bz);
  remapGyroToBody(gxDps, gyDps, gzDps, imu[idx].mount, bgx, bgy, bgz);

  float horiz = sqrt(by * by + bz * bz);
  if (horiz < 0.05f) {
    horiz = 0.05f;
  }

  float pitchAcc = atan2(-bx, horiz) * 180.0f / PI;
  float rollAcc = atan2(by, bz) * 180.0f / PI;

  float compAlpha = imu[idx].quiet ? 0.988f : COMPLEMENTARY_ALPHA;
  float smoothAlpha = imu[idx].quiet ? (SMOOTH_ALPHA * 0.65f) : STREAM_SMOOTH_ALPHA;

  float pitchFiltered =
    compAlpha * (imu[idx].pitch + bgy * dt) +
    (1.0f - compAlpha) * pitchAcc;

  float rollFiltered =
    compAlpha * (imu[idx].roll + bgx * dt) +
    (1.0f - compAlpha) * rollAcc;

  imu[idx].pitch += smoothAlpha * (pitchFiltered - imu[idx].pitch);
  imu[idx].roll += smoothAlpha * (rollFiltered - imu[idx].roll);

  float yawRateTarget = applyDeadzone(bgz, YAW_RATE_DEADZONE_DPS);
  imu[idx].yawRate += smoothAlpha * (yawRateTarget - imu[idx].yawRate);

  float pitchDelta = angleDeltaDeg(imu[idx].pitch, imu[idx].zeroPitch);
  float rollDelta = angleDeltaDeg(imu[idx].roll, imu[idx].zeroRoll);
  float gyroMag = sqrt(bgx * bgx + bgy * bgy + bgz * bgz);
  updateMotionState(idx, pitchDelta, rollDelta, gyroMag);

  updateCorrectedOutputs(idx);
}

void readAllImus() {
  unsigned long startedMs = millis();

  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    if (!sensorMap[i].active) {
      continue;
    }

    readOneIMU(i);
    maintainLedBase();
  }

  unsigned long elapsedMs = millis() - startedMs;
  if (elapsedMs > maxReadAllImusMs) {
    maxReadAllImusMs = elapsedMs > 65535UL ? 65535 : elapsedMs;
  }
}

bool shouldStreamSensor(uint8_t idx) {
  if (!sensorMap[idx].calibrated) {
    return false;
  }

  if (imu[idx].lostReported) {
    return false;
  }

  if (sensorMap[idx].active && imu[idx].lastGoodReadMs > 0) {
    return true;
  }

  if (!calibrationDone) {
    return false;
  }

  if (imu[idx].lastGoodReadMs == 0) {
    return false;
  }

  return millis() - imu[idx].lastGoodReadMs <= SENSOR_STREAM_HOLD_MS;
}

uint16_t getSensorMask() {
  uint16_t mask = 0;

  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    if (shouldStreamSensor(i)) {
      mask |= (1 << i);
    }
  }

  return mask;
}

uint8_t getActiveSensorCount() {
  uint8_t count = 0;

  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    if (shouldStreamSensor(i)) {
      count++;
    }
  }

  return count;
}

int getPitchOut(uint8_t idx) {
#if QUIET_HARD_ZERO
  if (!isCalibrating && imu[idx].quiet) {
    return 0;
  }
#endif
  return (int)round(imu[idx].outRx);
}

int getRollOut(uint8_t idx) {
#if QUIET_HARD_ZERO
  if (!isCalibrating && imu[idx].quiet) {
    return 0;
  }
#endif
  return (int)round(imu[idx].outRy);
}

int getYawRateOut(uint8_t idx) {
#if QUIET_HARD_ZERO
  if (!isCalibrating && imu[idx].quiet) {
    return 0;
  }
#endif
  return (int)round(imu[idx].outRz);
}
