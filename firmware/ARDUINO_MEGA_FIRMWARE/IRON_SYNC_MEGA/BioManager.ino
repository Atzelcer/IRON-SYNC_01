int ecgRaw = 0;
int emgRaw = 0;
int emgIntensity = 0;
int emgBaseline = 512;
int ecgLoPlus = 0;
int ecgLoMinus = 0;

void initBio() {
  pinMode(ECG_LO_PLUS, INPUT);
  pinMode(ECG_LO_MINUS, INPUT);
}

void calibrateEMG() {
  long sum = 0;

  Serial.println("CALIBRANDO_EMG");

  for (int i = 0; i < 300; i++) {
    sum += analogRead(EMG_PIN);
    calibrationEffectTick();
    delay(3);
  }

  emgBaseline = sum / 300;

  Serial.print("EMG_BASELINE=");
  Serial.println(emgBaseline);

  Serial1.print("EMG_BASELINE,");
  Serial1.println(emgBaseline);
}

void readBio() {
  ecgRaw = analogRead(ECG_PIN);
  emgRaw = analogRead(EMG_PIN);

  emgIntensity = abs(emgRaw - emgBaseline);

  ecgLoPlus = digitalRead(ECG_LO_PLUS);
  ecgLoMinus = digitalRead(ECG_LO_MINUS);
}