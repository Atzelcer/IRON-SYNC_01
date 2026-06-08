#include "IronSyncTypes.h"

void printCompactPacket(
  Stream &out,
  uint16_t frame,
  unsigned long ms,
  uint16_t mask,
  uint8_t activeSensors
) {
  out.print("IS,");
  out.print(frame);
  out.print(",");
  out.print(ms);
  out.print(",");
  out.print(mask);
  out.print(",");
  out.print(activeSensors);
  out.print(",");
  out.print(0);
  out.print(",");
  out.print(0);
  out.print(",");
  out.print(0);
  out.print(",");
  out.print(0);
  out.print(",");
  out.print(0);

  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    if (!shouldStreamSensor(i)) continue;

    out.print(";");
    out.print(sensorMap[i].tca, HEX);
    out.print(",");
    out.print(sensorMap[i].channel);
    out.print(",");
    out.print(sensorMap[i].key);
    out.print(",");
    out.print(getPitchOut(i));
    out.print(",");
    out.print(getRollOut(i));
    out.print(",");
    out.print(getYawRateOut(i));
#if RAW_ORIENTATION_STREAM
    out.print(",");
    out.print(imu[i].pitch, 1);
    out.print(",");
    out.print(imu[i].roll, 1);
    out.print(",");
    out.print(imu[i].yawRate, 1);
    out.print(",");
    out.print(imu[i].rawAx);
    out.print(",");
    out.print(imu[i].rawAy);
    out.print(",");
    out.print(imu[i].rawAz);
    out.print(",");
    out.print(imu[i].rawGx);
    out.print(",");
    out.print(imu[i].rawGy);
    out.print(",");
    out.print(imu[i].rawGz);
#endif
  }

  out.println();
}

void sendCompactPacket() {
  frameId++;
  packetCounter++;

  uint16_t mask = getSensorMask();
  uint8_t activeSensors = getActiveSensorCount();
  unsigned long ms = millis();

#if STREAM_PACKET_SERIAL1
  printCompactPacket(Serial1, frameId, ms, mask, activeSensors);
#endif

#if STREAM_PACKET_USB
  printCompactPacket(Serial, frameId, ms, mask, activeSensors);
#endif

  static uint8_t debugCounter = 0;
  debugCounter++;

  if (debugCounter >= 30) {
    debugCounter = 0;

    Serial.print("DBG,F=");
    Serial.print(frameId);
    Serial.print(",M=");
    Serial.print(mask);
    Serial.print(",A=");
    Serial.print(activeSensors);
    Serial.println();
  }

  static uint8_t qualityCounter = 0;
  qualityCounter++;

  if (qualityCounter >= 90) {
    qualityCounter = 0;

    for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
      if (sensorMap[i].active && millis() - imu[i].lastGoodReadMs > SENSOR_STALE_WARN_MS) {
        Serial1.print("WARN,STALE_SENSOR,");
        Serial1.print(sensorMap[i].key);
        Serial1.print(",lastGoodAgoMs=");
        Serial1.println(millis() - imu[i].lastGoodReadMs);
      }
    }
  }

  static uint8_t statsCounter = 0;
  statsCounter++;

  if (statsCounter >= 150) {
    statsCounter = 0;
    printRuntimeStats();
  }
}

void printRuntimeStats() {
  Serial1.print("STATS,frames=");
  Serial1.print(packetCounter);
  Serial1.print(",readFailures=");
  Serial1.print(readFailureTotal);
  Serial1.print(",lostEvents=");
  Serial1.print(lostEventTotal);
  Serial1.print(",recoverAttempts=");
  Serial1.print(recoverAttemptTotal);
  Serial1.print(",recoverSuccess=");
  Serial1.print(recoverSuccessTotal);
  Serial1.print(",maxReadAllMs=");
  Serial1.print(maxReadAllImusMs);
  Serial1.print(",maxLoopMs=");
  Serial1.print(maxLoopMs);
  Serial1.print(",mask=");
  Serial1.print(getSensorMask());
  Serial1.print(",activeSensors=");
  Serial1.println(getActiveSensorCount());

  Serial.print("STATS,frames=");
  Serial.print(packetCounter);
  Serial.print(",readFailures=");
  Serial.print(readFailureTotal);
  Serial.print(",lostEvents=");
  Serial.print(lostEventTotal);
  Serial.print(",recoverAttempts=");
  Serial.print(recoverAttemptTotal);
  Serial.print(",recoverSuccess=");
  Serial.print(recoverSuccessTotal);
  Serial.print(",maxReadAllMs=");
  Serial.print(maxReadAllImusMs);
  Serial.print(",maxLoopMs=");
  Serial.print(maxLoopMs);
  Serial.print(",mask=");
  Serial.print(getSensorMask());
  Serial.print(",activeSensors=");
  Serial.println(getActiveSensorCount());
}

void resetRuntimeStats() {
  packetCounter = 0;
  readFailureTotal = 0;
  recoverAttemptTotal = 0;
  recoverSuccessTotal = 0;
  lostEventTotal = 0;
  maxReadAllImusMs = 0;
  maxLoopMs = 0;
  Serial.println("STATS_RESET");
  Serial1.println("STATS_RESET");
}
