/*
 * IRON-SYNC EMG Library — Ejemplo 01
 * ====================================
 * RawSignal — Lectura cruda del sensor SEN0240
 *
 * Muestra el valor ADC crudo convertido a mV por Serial.
 * Util para verificar que el sensor esta conectado correctamente
 * y ver el rango de la senal antes de aplicar filtros.
 *
 * CONEXION HARDWARE:
 *  SEN0240 VCC  -> 3.3V (ESP32) o 5V (Arduino)
 *  SEN0240 GND  -> GND
 *  SEN0240 SIG  -> GPIO34 (ESP32) / A0 (Arduino UNO)
 *
 * MONITOR SERIE: 115200 baudios
 *
 * PROYECTO: IRON-SYNC — UMRPSFXCH SIS-330
 */

#include <IRONSYNC_EMG.h>

// ── Configuracion de pines ────────────────────────────────────
#ifdef ESP32
  #define EMG_PIN  34    // GPIO34 es solo entrada en ESP32
  #define ADC_BITS 12
  #define VREF     3.3f
#else
  #define EMG_PIN  A0
  #define ADC_BITS 10
  #define VREF     5.0f
#endif

// ── Instancia del sensor ──────────────────────────────────────
IRONSYNC_EMG emg(EMG_PIN, ADC_BITS, VREF, EMG_NOTCH_50HZ);

// ── Variables de control de tiempo ───────────────────────────
uint32_t last_print_ms = 0;
uint32_t last_sample_ms = 0;
const uint16_t SAMPLE_INTERVAL_US = 1000; // 1 ms = 1000 Hz
const uint16_t PRINT_INTERVAL_MS  = 10;   // Imprimir cada 10 ms

void setup() {
    Serial.begin(115200);
    while (!Serial) {}

    Serial.println(F("================================="));
    Serial.println(F(" IRON-SYNC EMG — Ejemplo 01"));
    Serial.println(F(" Lectura Raw del SEN0240"));
    Serial.println(F("================================="));
    Serial.println(F("# t_ms, raw_mV, ADC_raw"));

    emg.begin();

    // En ESP32: configurar ADC para mejor precision
#ifdef ESP32
    analogSetPinAttenuation(EMG_PIN, ADC_11db);
#endif
}

void loop() {
    uint32_t now_us = micros();
    uint32_t now_ms = millis();

    // Muestrear a 1000 Hz
    if (now_us - last_sample_ms >= SAMPLE_INTERVAL_US) {
        last_sample_ms = now_us;

        float raw_mv = emg.readRawMV();

        // Imprimir cada 10 ms (100 Hz de salida para no saturar Serial)
        if (now_ms - last_print_ms >= PRINT_INTERVAL_MS) {
            last_print_ms = now_ms;

            Serial.print(now_ms);
            Serial.print(',');
            Serial.print(raw_mv, 2);
            Serial.print(',');
            Serial.println(analogRead(EMG_PIN));
        }
    }
}
