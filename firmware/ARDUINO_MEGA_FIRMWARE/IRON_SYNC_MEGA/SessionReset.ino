#include "IronSyncTypes.h"

/**
 * Reinicio de sesión al desconectar PC/ESP32 (UI_DISCONNECT).
 * Secuencia: tira roja + buzzers -> UI_DISCONNECT_DONE -> rojo fijo -> reset MCU.
 */
void megaPrepareSessionReset() {
  systemRunning = false;
  dataStreamPaused = false;
  isCalibrating = false;
  calibrationDone = false;
  calibrationAbortRequested = false;

  stopCalibrationVisual();
  stopPoseWaitVisual();
  allTonesOff();

  frameId = 0;
  packetCounter = 0;
  lastSendTime = 0;
  resetRuntimeStats();

  resetTCAs();
  scanAndConfigureSensors();

  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    imu[i].quiet = true;
    imu[i].outRx = 0;
    imu[i].outRy = 0;
    imu[i].outRz = 0;
    imu[i].failCount = 0;
    imu[i].lostReported = false;
  }

  Serial.println(F("MEGA_SESSION_RESET"));
  Serial1.println(F("MEGA_SESSION_RESET"));
}

void megaCpuReset() {
  delay(60);
  void (*restart)(void) = 0;
  restart();
}

void megaResetAfterDisconnect() {
  showChestDisconnectVisual();
  replyCommand("UI_DISCONNECT_DONE");
  showChestDisconnectHold();
  delay(UI_DISCONNECT_RED_HOLD_MS);
  megaPrepareSessionReset();
  showChestDisconnectHold();
  megaCpuReset();
}
