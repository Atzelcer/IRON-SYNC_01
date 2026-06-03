Adafruit_NeoPixel chestLed(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

const unsigned long LED_REFRESH_INTERVAL_MS = 50;

unsigned long lastLedRefresh = 0;
uint8_t currentLedR = 255;
uint8_t currentLedG = 255;
uint8_t currentLedB = 255;

bool poseWaitVisualActive = false;
bool calibrationVisualActive = false;
bool ledUserFeedbackActive = false;
bool calibrationLedBluePhase = true;
unsigned long lastCalibrationLedMs = 0;
unsigned long lastCalibrationToneMs = 0;
uint8_t calLoadToneStep = 0;
unsigned long lastPoseWaitRefreshMs = 0;
unsigned long lastFailSignalMs = 0;
unsigned long lastUiConnectMelodyMs = 0;
unsigned long lastUiDisconnectMelodyMs = 0;

static void syncChestAuxRedIndicator(bool redOn) {
#if CHEST_AUX_RED_PIN > 0
  pinMode(CHEST_AUX_RED_PIN, OUTPUT);
  digitalWrite(CHEST_AUX_RED_PIN, redOn ? HIGH : LOW);
#endif
}

static void ledShowCurrent() {
  for (int i = 0; i < NUM_LEDS; i++) {
    chestLed.setPixelColor(i, chestLed.Color(currentLedR, currentLedG, currentLedB));
  }
  chestLed.show();
  syncChestAuxRedIndicator(currentLedR > 200 && currentLedG < 48 && currentLedB < 48);
}

void setBothBuzzers(uint8_t value) {
  digitalWrite(BUZZER_CAL, value);
  digitalWrite(BUZZER_STATE, value);
}

void initLedBuzzer() {
  pinMode(BUZZER_CAL, OUTPUT);
  pinMode(BUZZER_STATE, OUTPUT);

  digitalWrite(BUZZER_CAL, LOW);
  digitalWrite(BUZZER_STATE, LOW);

  chestLed.begin();
  chestLed.setBrightness(LED_BRIGHTNESS);
  setLedWhite();
}

void setLedColor(uint8_t r, uint8_t g, uint8_t b) {
  currentLedR = r;
  currentLedG = g;
  currentLedB = b;
  ledShowCurrent();
}

void refreshCurrentLed() {
  ledShowCurrent();
}

void setLedWhite() {
  setLedColor(255, 255, 255);
}

void setLedBlue() {
  setLedColor(0, 0, 255);
}

void setLedAqua() {
  setLedColor(0, 205, 220);
}

void setLedRed() {
  setLedColor(255, 0, 0);
}

void setLedGreen() {
  setLedColor(0, 255, 0);
}

void setLedYellow() {
  setLedColor(255, 180, 0);
}

void setLedPurple() {
  setLedColor(160, 0, 220);
}

void allTonesOff() {
  noTone(BUZZER_CAL);
  noTone(BUZZER_STATE);
  setBothBuzzers(LOW);
}

void dualTone(int freq, int durationMs) {
  if (freq <= 0 || durationMs <= 0) {
    allTonesOff();
    return;
  }

  noTone(BUZZER_CAL);
  noTone(BUZZER_STATE);
  setBothBuzzers(LOW);

  tone(BUZZER_CAL, (unsigned int)freq);
  tone(BUZZER_STATE, (unsigned int)freq);

  unsigned long endAt = millis() + (unsigned long)durationMs;
  while ((long)(millis() - endAt) < 0) {
    refreshCurrentLed();
    handleCommands();
    delay(4);
  }

  allTonesOff();
  refreshCurrentLed();
}

/** Nota corta y seca (registro agudo ~1–2.5 kHz suena mas nitido en piezo). */
static void toneCrisp(int freq, int durationMs) {
  if (freq <= 0 || durationMs <= 0) {
    allTonesOff();
    return;
  }

  noTone(BUZZER_CAL);
  noTone(BUZZER_STATE);
  setBothBuzzers(LOW);

  tone(BUZZER_CAL, (unsigned int)freq);
  tone(BUZZER_STATE, (unsigned int)freq);

  int sustainMs = (durationMs * 78) / 100;
  if (sustainMs < 22) {
    sustainMs = durationMs;
  }

  unsigned long sustainEnd = millis() + (unsigned long)sustainMs;
  while ((long)(millis() - sustainEnd) < 0) {
    refreshCurrentLed();
    handleCommands();
    delay(2);
  }

  allTonesOff();

  if (sustainMs < durationMs) {
    unsigned long tailEnd = millis() + (unsigned long)CAL_TONE_CRISP_TAIL_MS;
    while ((long)(millis() - tailEnd) < 0) {
      refreshCurrentLed();
      handleCommands();
      delay(2);
    }
  }
}

static void playNoteMelody(const int* freqs, const int* durs, uint8_t count) {
  if (!freqs || !durs || count == 0) {
    return;
  }

  ledUserFeedbackActive = true;

  for (uint8_t i = 0; i < count; i++) {
    toneCrisp(freqs[i], durs[i]);
    if (i + 1 < count && CAL_MELODY_GAP_MS > 0) {
      delay(CAL_MELODY_GAP_MS);
      handleCommands();
    }
  }

  ledUserFeedbackActive = false;
}

static void toneStep(int freq, int durationMs) {
  toneCrisp(freq, durationMs);
  if (CAL_MELODY_GAP_MS > 0) {
    delay(CAL_MELODY_GAP_MS);
    handleCommands();
  }
}

void finishCalibrationStandby() {
  poseWaitVisualActive = false;
  calibrationVisualActive = false;
  ledUserFeedbackActive = false;
  calibrationLedBluePhase = true;
  allTonesOff();
  setLedWhite();
  lastLedRefresh = millis();
}

void melodyCalStartAck() {
  static const int freqs[] = { 1047, 1175, 1319 };
  static const int durs[] = { 44, 44, 76 };

  setLedAqua();
  playNoteMelody(freqs, durs, 3);
  refreshCurrentLed();
}

void melodyCalWaitTick() {
  toneCrisp(1568, 34);
}

void melodyPoseReady() {
  static const int freqs[] = { 1319, 1568, 1760 };
  static const int durs[] = { 52, 52, 84 };

  playNoteMelody(freqs, durs, 3);
}

static void calibrationLoadingChirp() {
  static const int freqs[6] = { 1175, 1245, 1319, 1397, 1480, 1568 };
  uint8_t step = calLoadToneStep % 6;

  if (step == 0 || step == 3) {
    setLedAqua();
  }

  toneCrisp(freqs[step], 30);
  calLoadToneStep++;
}

void maintainLedBase() {
  if (calibrationVisualActive) {
    calibrationEffectTick();
    return;
  }

  if (millis() - lastLedRefresh < LED_REFRESH_INTERVAL_MS) {
    return;
  }
  lastLedRefresh = millis();

  if (poseWaitVisualActive) {
    ledShowCurrent();
    return;
  }

  if (ledUserFeedbackActive) {
    ledShowCurrent();
    return;
  }

  currentLedR = 255;
  currentLedG = 255;
  currentLedB = 255;
  ledShowCurrent();
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
  lastPoseWaitRefreshMs = 0;
  allTonesOff();
  setLedPurple();
}

void stopPoseWaitVisual() {
  poseWaitVisualActive = false;
  setLedWhite();
}

void poseWaitEffectTick() {
  maintainLedBase();
}

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
      melodyCalWaitTick();
    }

    maintainLedBase();
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
  melodyPoseReady();
  stopPoseWaitVisual();
  return true;
}

void startCalibrationVisual() {
  poseWaitVisualActive = false;
  calibrationVisualActive = true;
  calibrationLedBluePhase = true;
  lastCalibrationLedMs = 0;
  lastCalibrationToneMs = millis();
  calLoadToneStep = 0;
  setLedBlue();
}

void startMasterCalibrationVisual() {
  startCalibrationVisual();
}

void calibrationEffectTick() {
  if (!calibrationVisualActive) {
    maintainLedBase();
    return;
  }

  if (millis() - lastCalibrationLedMs < CAL_LED_BLINK_MS) {
    return;
  }

  lastCalibrationLedMs = millis();
  calibrationLedBluePhase = !calibrationLedBluePhase;

  if (calibrationLedBluePhase) {
    setLedBlue();
  } else {
    setLedWhite();
  }

  if (!ledUserFeedbackActive && millis() - lastCalibrationToneMs >= CAL_LOAD_TONE_INTERVAL_MS) {
    lastCalibrationToneMs = millis();
    calibrationLoadingChirp();
  }
}

void stopCalibrationVisual() {
  finishCalibrationStandby();
}

void uiConnectOk() {
  if (millis() - lastUiConnectMelodyMs < UI_CONNECT_DEBOUNCE_MS) {
    return;
  }

  lastUiConnectMelodyMs = millis();

  static const int freqs[] = { 523, 659, 784, 988, 1175, 1319 };
  static const int durs[] = { 45, 45, 50, 55, 60, 100 };

  setLedAqua();
  playNoteMelody(freqs, durs, 6);

  setLedGreen();
  refreshCurrentLed();
  delay(120);
  allTonesOff();
  setLedWhite();
}

void uiDataStop() {
  ledUserFeedbackActive = true;
  setLedYellow();
  dualTone(900, 3000);
  ledUserFeedbackActive = false;
  allTonesOff();
  setLedYellow();
}

void showChestDisconnectHold() {
  ledUserFeedbackActive = true;
  setLedRed();
  refreshCurrentLed();
  ledUserFeedbackActive = false;
}

void showChestDisconnectVisual() {
  if (millis() - lastUiDisconnectMelodyMs < UI_CONNECT_DEBOUNCE_MS) {
    showChestDisconnectHold();
    return;
  }

  lastUiDisconnectMelodyMs = millis();
  ledUserFeedbackActive = true;
  allTonesOff();

  for (int i = 0; i < 2; i++) {
    setLedRed();
    refreshCurrentLed();
    dualTone(500, 180);
    delay(80);
    handleCommands();
    setLedWhite();
    refreshCurrentLed();
    delay(220);
    handleCommands();
  }

  ledUserFeedbackActive = false;
  allTonesOff();
  showChestDisconnectHold();
}

void uiDisconnect() {
  showChestDisconnectVisual();
}

void buzzerOk() {
  ledUserFeedbackActive = true;
  setLedGreen();
  toneStep(1568, 56);
  toneStep(1760, 56);
  toneStep(1976, 72);
  ledUserFeedbackActive = false;
  setLedWhite();
}

void buzzerFail() {
  if (millis() - lastFailSignalMs < 1800) {
    finishCalibrationStandby();
    return;
  }

  lastFailSignalMs = millis();
  calibrationVisualActive = false;
  ledUserFeedbackActive = true;

  for (int i = 0; i < 2; i++) {
    setLedRed();
    refreshCurrentLed();
    static const int freqs[] = { 784, 698, 622 };
    static const int durs[] = { 58, 58, 72 };
    playNoteMelody(freqs, durs, 3);
    delay(80);
    handleCommands();
    setLedWhite();
    refreshCurrentLed();
    delay(120);
    handleCommands();
  }

  ledUserFeedbackActive = false;
  finishCalibrationStandby();
}

void buzzerDone() {
  calibrationVisualActive = false;
  ledUserFeedbackActive = true;
  setLedGreen();

  static const int freqs[] = { 1047, 1175, 1319, 1568, 1760, 1976 };
  static const int durs[] = { 48, 48, 52, 56, 64, 96 };
  playNoteMelody(freqs, durs, 6);

  ledUserFeedbackActive = false;
  finishCalibrationStandby();
}

void buzzerPartialCalibration() {
  calibrationVisualActive = false;
  ledUserFeedbackActive = true;
  setLedPurple();

  static const int freqs[] = { 1568, 1397, 1319 };
  static const int durs[] = { 52, 52, 72 };
  playNoteMelody(freqs, durs, 3);

  ledUserFeedbackActive = false;
  finishCalibrationStandby();
}
