#include "EMGFilters.h"

EMGFilters myFilter;
SAMPLE_FREQUENCY sampleRate = SAMPLE_FREQ_1000HZ;
NOTCH_FREQUENCY humFreq = NOTCH_FREQ_50HZ;

const int EMG_PIN = A0;
const int VENTANA = 200; // suavizado
long buffer[200];
int idx = 0;
long suma = 0;

void setup() {
  Serial.begin(115200);
  myFilter.init(sampleRate, humFreq, true, true, true);
  memset(buffer, 0, sizeof(buffer));
  delay(1000);
}

void loop() {
  int raw = analogRead(EMG_PIN);
  int filtered = myFilter.update(raw);
  long nuevo = abs(filtered);

  // Ventana deslizante para suavizar
  suma -= buffer[idx];
  buffer[idx] = nuevo;
  suma += nuevo;
  idx = (idx + 1) % VENTANA;
  
  long promedio = suma / VENTANA;

  // Umbrales fijos — ajustamos según tus valores
  int clase;
  if (promedio < 80) {
    clase = 0;       // RELAJADO
  } else if (promedio < 150) {
    clase = 1;       // MEDIO
  } else {
    clase = 2;       // ALTO
  }

  Serial.print(promedio);
  Serial.print(",");
  Serial.println(clase * 100);

  delayMicroseconds(500);
}