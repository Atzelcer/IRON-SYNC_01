#include <Wire.h>
#include <Adafruit_NeoPixel.h>
#include <math.h>
#include "IronSyncConfig.h"
#include "IronSyncTypes.h"

unsigned long lastSendTime = 0;
unsigned long lastWireRecoveryMs = 0;
unsigned long lastGlobalRecoverMs = 0;
uint32_t lastWireReportedReadFailures = 0;
uint16_t frameId = 0;
uint32_t packetCounter = 0;
uint32_t readFailureTotal = 0;
uint32_t recoverAttemptTotal = 0;
uint32_t recoverSuccessTotal = 0;
uint32_t lostEventTotal = 0;
uint16_t maxReadAllImusMs = 0;
uint16_t maxLoopMs = 0;

bool systemRunning = false;
bool calibrationDone = false;
bool dataStreamPaused = false;
bool isCalibrating = false;
bool calibrationAbortRequested = false;

void setup() {
  Serial.begin(DEBUG_BAUD);
  Serial1.begin(ESP32_BAUD);

  initLedBuzzer();
  maintainLedBase();

  Wire.begin();
  Wire.setClock(I2C_CLOCK);
  Wire.setWireTimeout(6000, true);
  maintainLedBase();

  initCorrectionProfiles();
  maintainLedBase();

  initBio();
  maintainLedBase();

  initImuSystemNoCalibration();
  maintainLedBase();
  setLedWhite();

  Serial.println("IRON_SYNC_MEGA_READY_DEBUG");
  Serial.println("LED_STANDBY_WHITE");
  Serial1.println("MEGA_READY");
  Serial1.println("MEGA_WAITING_HARDWARE_CONNECTION");
  Serial1.println("LED_STANDBY_WHITE");
}

void loop() {
  handleCommands();

  unsigned long now = millis();
  unsigned long loopStartedMs = now;

  if (systemRunning && calibrationDone && now - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = now;

    readBio();
    readAllImus();
    sendCompactPacket();
  }

  maintainLedBase();
  handleCommands();
  tryRecoverMissingSensors();

  if (Wire.getWireTimeoutFlag()) {
    Wire.clearWireTimeoutFlag();

    if (readFailureTotal != lastWireReportedReadFailures && now - lastWireRecoveryMs >= 5000) {
      lastWireRecoveryMs = now;
      lastWireReportedReadFailures = readFailureTotal;

      if (now - lastGlobalRecoverMs >= GLOBAL_RECOVER_COOLDOWN_MS) {
        lastGlobalRecoverMs = now;
        Serial.println("ERROR,I2C_TIMEOUT_RECOVERY");
        Serial1.println("ERROR,I2C_TIMEOUT_RECOVERY");
        recoverAllInactiveSensors();
      }
    }
  }

  unsigned long loopMs = millis() - loopStartedMs;
  if (loopMs > maxLoopMs) {
    maxLoopMs = loopMs > 65535UL ? 65535 : loopMs;
  }
}
