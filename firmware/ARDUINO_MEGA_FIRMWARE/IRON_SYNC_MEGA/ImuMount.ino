#include "IronSyncTypes.h"

void remapAccelToBody(float axg, float ayg, float azg, const ImuMountProfile& mount, float& ox, float& oy, float& oz) {
  switch (mount.layout) {
    case MOUNT_Z_DOWN:
      ox = -axg;
      oy = -ayg;
      oz = -azg;
      break;
    case MOUNT_Y_UP:
      ox = azg;
      oy = axg;
      oz = ayg;
      break;
    case MOUNT_Y_DOWN:
      ox = -azg;
      oy = -axg;
      oz = -ayg;
      break;
    case MOUNT_X_UP:
      ox = ayg;
      oy = -azg;
      oz = axg;
      break;
    case MOUNT_X_DOWN:
      ox = -ayg;
      oy = azg;
      oz = -axg;
      break;
    case MOUNT_Z_UP:
    default:
      ox = axg;
      oy = ayg;
      oz = azg;
      break;
  }
}

void remapGyroToBody(float gxdps, float gydps, float gzdps, const ImuMountProfile& mount, float& ox, float& oy, float& oz) {
  // Misma convención que accel para que fusión complementaria sea coherente.
  remapAccelToBody(gxdps, gydps, gzdps, mount, ox, oy, oz);
}

void computePitchRollFromAccel(float axg, float ayg, float azg, const ImuMountProfile& mount, float& pitch, float& roll) {
  float ox, oy, oz;
  remapAccelToBody(axg, ayg, azg, mount, ox, oy, oz);

  float horiz = sqrt(oy * oy + oz * oz);
  if (horiz < 0.05f) {
    horiz = 0.05f;
  }

  pitch = atan2(-ox, horiz) * 180.0f / PI;
  roll = atan2(oy, oz) * 180.0f / PI;
}

void detectMountFromGravityMean(float meanAx, float meanAy, float meanAz, ImuMountProfile& mount) {
  float ax = fabs(meanAx);
  float ay = fabs(meanAy);
  float az = fabs(meanAz);
  float mag = sqrt(meanAx * meanAx + meanAy * meanAy + meanAz * meanAz);

  mount.gravityX = meanAx;
  mount.gravityY = meanAy;
  mount.gravityZ = meanAz;

  if (mag < MOUNT_GRAVITY_MIN_G) {
    mount.detected = false;
    mount.layout = MOUNT_Z_UP;
    return;
  }

  mount.detected = true;

  if (az >= ax && az >= ay && az >= MOUNT_FLAT_AXIS_MAX_G) {
    mount.layout = (meanAz < 0.0f) ? MOUNT_Z_DOWN : MOUNT_Z_UP;
    return;
  }

  if (ay >= ax && ay >= az && ay >= MOUNT_FLAT_AXIS_MAX_G) {
    mount.layout = (meanAy > 0.0f) ? MOUNT_Y_UP : MOUNT_Y_DOWN;
    return;
  }

  if (ax >= ay && ax >= az && ax >= MOUNT_FLAT_AXIS_MAX_G) {
    mount.layout = (meanAx > 0.0f) ? MOUNT_X_UP : MOUNT_X_DOWN;
    return;
  }

  // Fallback: eje dominante aunque la señal sea ruidosa.
  if (az >= ax && az >= ay) {
    mount.layout = (meanAz < 0.0f) ? MOUNT_Z_DOWN : MOUNT_Z_UP;
  } else if (ay >= ax) {
    mount.layout = (meanAy > 0.0f) ? MOUNT_Y_UP : MOUNT_Y_DOWN;
  } else {
    mount.layout = (meanAx > 0.0f) ? MOUNT_X_UP : MOUNT_X_DOWN;
  }
}

bool layoutFromName(const char* name, uint8_t& layout) {
  if (!name || name[0] == '\0') {
    return false;
  }

  if (strcmp(name, "Z_UP") == 0) {
    layout = MOUNT_Z_UP;
    return true;
  }
  if (strcmp(name, "Z_DOWN") == 0) {
    layout = MOUNT_Z_DOWN;
    return true;
  }
  if (strcmp(name, "Y_UP") == 0) {
    layout = MOUNT_Y_UP;
    return true;
  }
  if (strcmp(name, "Y_DOWN") == 0) {
    layout = MOUNT_Y_DOWN;
    return true;
  }
  if (strcmp(name, "X_UP") == 0) {
    layout = MOUNT_X_UP;
    return true;
  }
  if (strcmp(name, "X_DOWN") == 0) {
    layout = MOUNT_X_DOWN;
    return true;
  }

  return false;
}

bool setSensorMountLayout(uint8_t idx, uint8_t layout) {
  if (idx >= SENSOR_COUNT) {
    return false;
  }

  resetCorrectionProfileForSensor(idx);
  imu[idx].mount.layout = layout;
  imu[idx].mount.detected = true;
  applyMountToCorrectionSigns(idx);
  applyBodySideToCorrectionSigns(idx);
  emitMountProfile(idx);
  return true;
}

void clearSensorMountLayout(uint8_t idx) {
  if (idx >= SENSOR_COUNT) {
    return;
  }

  imu[idx].mount.detected = false;
  imu[idx].mount.layout = MOUNT_Z_UP;
  resetCorrectionProfileForSensor(idx);
}

void emitMountProfile(uint8_t idx) {
  const char* layoutName = "Z_UP";

  switch (imu[idx].mount.layout) {
    case MOUNT_Z_DOWN: layoutName = "Z_DOWN"; break;
    case MOUNT_Y_UP: layoutName = "Y_UP"; break;
    case MOUNT_Y_DOWN: layoutName = "Y_DOWN"; break;
    case MOUNT_X_UP: layoutName = "X_UP"; break;
    case MOUNT_X_DOWN: layoutName = "X_DOWN"; break;
    default: break;
  }

  Serial1.print("MOUNT,");
  Serial1.print(sensorMap[idx].key);
  Serial1.print(",layout=");
  Serial1.print(layoutName);
  Serial1.print(",g=(");
  Serial1.print(imu[idx].mount.gravityX, 3);
  Serial1.print("/");
  Serial1.print(imu[idx].mount.gravityY, 3);
  Serial1.print("/");
  Serial1.print(imu[idx].mount.gravityZ, 3);
  Serial1.print(",side=");
  Serial1.println(bodySideFromKey(sensorMap[idx].key));

  Serial.print("MOUNT,");
  Serial.print(sensorMap[idx].key);
  Serial.print(",layout=");
  Serial.print(layoutName);
  Serial.print(",g=(");
  Serial.print(imu[idx].mount.gravityX, 3);
  Serial.print("/");
  Serial.print(imu[idx].mount.gravityY, 3);
  Serial.print("/");
  Serial.print(imu[idx].mount.gravityZ, 3);
  Serial.print(",side=");
  Serial.println(bodySideFromKey(sensorMap[idx].key));
}
