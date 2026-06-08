#include "IronSyncTypes.h"

bool poseWaitVisualActive = false;
bool calibrationVisualActive = false;
bool ledUserFeedbackActive = false;

void initLedBuzzer() {
  pinMode(BUZZER_CAL, OUTPUT);
  pinMode(BUZZER_STATE, OUTPUT);
  digitalWrite(BUZZER_CAL, LOW);
  digitalWrite(BUZZER_STATE, LOW);
}

void setLedWhite() {}
void setLedBlue() {}
void setLedAqua() {}
void setLedRed() {}
void setLedGreen() {}
void setLedYellow() {}
void setLedPurple() {}
void maintainLedBase() {}
void calibrationEffectTick() {}
void melodyCalStartAck() {}
void melodyCalWaitTick() {}
void melodyPoseReady() {}
void buzzerDone() {}
void buzzerPartialCalibration() {}
void buzzerFail() {}
void buzzerOk() {}

void finishCalibrationStandby() {
  poseWaitVisualActive = false;
  calibrationVisualActive = false;
  ledUserFeedbackActive = false;
  digitalWrite(BUZZER_CAL, LOW);
  digitalWrite(BUZZER_STATE, LOW);
}

void emitCalWaitPose(uint8_t secondsLeft) {
  Serial.print("CAL_WAIT_POSE,");
  Serial.println(secondsLeft);
  Serial1.print("CAL_WAIT_POSE,");
  Serial1.println(secondsLeft);
}

void startPoseWaitVisual() {
  calibrationVisualActive = false;
  poseWaitVisualActive = true;
}

void stopPoseWaitVisual() {
  poseWaitVisualActive = false;
}

void poseWaitEffectTick() {}

bool calibrationShouldAbort() {
  return calibrationAbortRequested;
}

void clearCalibrationAbort() {
  calibrationAbortRequested = false;
}

void finishCalibrationAborted() {
  stopPoseWaitVisual();
  isCalibrating = false;
  clearCalibrationAbort();
  finishCalibrationStandby();

  Serial.println("CAL_ABORTED");
  Serial1.println("CAL_ABORTED");
}

bool waitForCalibrationPose() {
  startPoseWaitVisual();

  unsigned long startMs = millis();
  int lastAnnounced = -1;
  uint8_t totalSeconds = (uint8_t)((CAL_POSE_WAIT_MS + 999UL) / 1000UL);
  if (totalSeconds < 1) {
    totalSeconds = 1;
  }

  while (millis() - startMs < CAL_POSE_WAIT_MS) {
    if (calibrationShouldAbort()) {
      stopPoseWaitVisual();
      return false;
    }

    unsigned long elapsed = millis() - startMs;
    int secondsLeft = (int)(totalSeconds - (elapsed / 1000UL));
    if (secondsLeft < 1) {
      secondsLeft = 1;
    }

    if (secondsLeft != lastAnnounced) {
      lastAnnounced = secondsLeft;
      emitCalWaitPose((uint8_t)secondsLeft);
    }

    handleCommands();
    delay(20);
  }

  if (calibrationShouldAbort()) {
    stopPoseWaitVisual();
    return false;
  }

  emitCalWaitPose(0);
  Serial.println("CAL_POSE_READY");
  Serial1.println("CAL_POSE_READY");
  stopPoseWaitVisual();
  return true;
}

void startCalibrationVisual() {
  poseWaitVisualActive = false;
  calibrationVisualActive = true;
}

void startMasterCalibrationVisual() {
  startCalibrationVisual();
}

void stopCalibrationVisual() {
  finishCalibrationStandby();
}

void uiConnectOk() {}
void uiDataStop() {}

void showChestDisconnectHold() {}
void showChestDisconnectVisual() {
  showChestDisconnectHold();
}

void uiDisconnect() {
  showChestDisconnectVisual();
}
