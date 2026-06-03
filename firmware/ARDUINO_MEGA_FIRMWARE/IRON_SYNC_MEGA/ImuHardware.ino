#include "IronSyncTypes.h"

void resetTCAs() {
  pinMode(RST_SUPERIOR, OUTPUT);
  pinMode(RST_INFERIOR, OUTPUT);

  digitalWrite(RST_SUPERIOR, LOW);
  digitalWrite(RST_INFERIOR, LOW);
  for (uint8_t i = 0; i < 5; i++) {
    maintainLedBase();
    delay(5);
  }

  digitalWrite(RST_SUPERIOR, HIGH);
  digitalWrite(RST_INFERIOR, HIGH);
  for (uint8_t i = 0; i < 24; i++) {
    maintainLedBase();
    delay(5);
  }
}

bool selectTCA(uint8_t tca, uint8_t channel) {
  for (uint8_t attempt = 0; attempt < SENSOR_READ_RETRIES; attempt++) {
    Wire.beginTransmission(tca);
    Wire.write(1 << channel);
    byte error = Wire.endTransmission();
    delayMicroseconds(TCA_SELECT_DELAY_US);

    if (error == 0) {
      return true;
    }

    delay(1);
  }

  return false;
}

bool detectMPU(uint8_t idx) {
  if (!selectTCA(sensorMap[idx].tca, sensorMap[idx].channel)) {
    return false;
  }

  for (uint8_t attempt = 0; attempt < SENSOR_READ_RETRIES; attempt++) {
    Wire.beginTransmission(MPU_ADDR);

    if (Wire.endTransmission() == 0) {
      return true;
    }

    delay(2);
  }

  return false;
}

bool writeMPU(uint8_t idx, uint8_t reg, uint8_t value) {
  if (!selectTCA(sensorMap[idx].tca, sensorMap[idx].channel)) {
    return false;
  }

  for (uint8_t attempt = 0; attempt < SENSOR_READ_RETRIES; attempt++) {
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(reg);
    Wire.write(value);

    if (Wire.endTransmission() == 0) {
      return true;
    }

    delay(2);
  }

  return false;
}

bool configureMPU(uint8_t idx) {
  if (!detectMPU(idx)) {
    return false;
  }

  if (!writeMPU(idx, 0x6B, 0x00)) return false;
  delay(6);

  if (!writeMPU(idx, 0x19, 0x09)) return false;
  if (!writeMPU(idx, 0x1A, 0x03)) return false;
  if (!writeMPU(idx, 0x1B, 0x00)) return false;
  if (!writeMPU(idx, 0x1C, 0x00)) return false;

  maintainLedBase();
  return true;
}

bool readMPURawOnce(
  uint8_t idx,
  int16_t &ax,
  int16_t &ay,
  int16_t &az,
  int16_t &gx,
  int16_t &gy,
  int16_t &gz
) {
  if (!selectTCA(sensorMap[idx].tca, sensorMap[idx].channel)) {
    return false;
  }

  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);

  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  uint8_t bytes = Wire.requestFrom(MPU_ADDR, 14);

  if (bytes != 14) {
    while (Wire.available()) Wire.read();
    return false;
  }

  ax = (Wire.read() << 8) | Wire.read();
  ay = (Wire.read() << 8) | Wire.read();
  az = (Wire.read() << 8) | Wire.read();

  Wire.read();
  Wire.read();

  gx = (Wire.read() << 8) | Wire.read();
  gy = (Wire.read() << 8) | Wire.read();
  gz = (Wire.read() << 8) | Wire.read();

  return true;
}

bool readMPURaw(
  uint8_t idx,
  int16_t &ax,
  int16_t &ay,
  int16_t &az,
  int16_t &gx,
  int16_t &gy,
  int16_t &gz
) {
  uint8_t attempts = isCalibrating ? SENSOR_READ_RETRIES : STREAM_SENSOR_READ_RETRIES;

  for (uint8_t attempt = 0; attempt < attempts; attempt++) {
    if (readMPURawOnce(idx, ax, ay, az, gx, gy, gz)) {
      return true;
    }

    delayMicroseconds(isCalibrating ? 500 : 250);
  }

  return false;
}

void scanAndConfigureSensors() {
  Serial.println("ESCANEANDO_IMUS");

  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    sensorMap[i].active = configureMPU(i);
    sensorMap[i].calibrated = false;

    Serial.print("SENSOR,");
    Serial.print(sensorMap[i].key);
    Serial.print(",");
    Serial.print(i);
    Serial.print(",");
    Serial.print(sensorMap[i].label);
    Serial.print(",");
    Serial.print(sensorMap[i].tcaName);
    Serial.print(",");
    Serial.print(sensorMap[i].sdsc);
    Serial.print(",");
    Serial.println(sensorMap[i].active ? "OK" : "NO");

    Serial1.print("SENSOR,");
    Serial1.print(sensorMap[i].key);
    Serial1.print(",");
    Serial1.print(i);
    Serial1.print(",");
    Serial1.print(sensorMap[i].label);
    Serial1.print(",");
    Serial1.print(sensorMap[i].tcaName);
    Serial1.print(",");
    Serial1.print(sensorMap[i].sdsc);
    Serial1.print(",");
    Serial1.println(sensorMap[i].active ? "OK" : "NO");

    emitSensorBindLine(Serial, i);
    emitSensorBindLine(Serial1, i);

    maintainLedBase();
  }

  verifySensorMapUnique();
  printSuitPhysicalMap();

  Serial1.print("SCAN_DONE,mask=");
  Serial1.print(getSensorMask());
  Serial1.print(",activeSensors=");
  Serial1.println(getActiveSensorCount());
}

void printSensorMap() {
  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    Serial1.print("MAP,");
    Serial1.print(sensorMap[i].key);
    Serial1.print(",");
    Serial1.print(i);
    Serial1.print(",");
    Serial1.print(sensorMap[i].label);
    Serial1.print(",");
    Serial1.print(sensorMap[i].tcaName);
    Serial1.print(",");
    Serial1.print(sensorMap[i].sdsc);
    Serial1.print(",");
    Serial1.print(sensorMap[i].tca, HEX);
    Serial1.print(",");
    Serial1.print(sensorMap[i].channel);
    Serial1.print(",");
    Serial1.print(sensorMap[i].active ? "OK" : "NO");
    Serial1.print(",");
    Serial1.println(sensorMap[i].calibrated ? "CAL" : "RAW");

    Serial.print("MAP,");
    Serial.print(sensorMap[i].key);
    Serial.print(",");
    Serial.print(i);
    Serial.print(",");
    Serial.print(sensorMap[i].label);
    Serial.print(",");
    Serial.print(sensorMap[i].tcaName);
    Serial.print(",");
    Serial.print(sensorMap[i].sdsc);
    Serial.print(",");
    Serial.print(sensorMap[i].tca, HEX);
    Serial.print(",");
    Serial.print(sensorMap[i].channel);
    Serial.print(",");
    Serial.print(sensorMap[i].active ? "OK" : "NO");
    Serial.print(",");
    Serial.println(sensorMap[i].calibrated ? "CAL" : "RAW");
  }
}
