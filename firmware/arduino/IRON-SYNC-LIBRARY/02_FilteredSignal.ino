/*
 * IRON-SYNC EMG Library — Ejemplo 02
 * ====================================
 * FilteredSignal — Butterworth pasa-banda + Notch 50Hz
 *
 * Compara la senal raw vs filtrada en tiempo real.
 * Usa un timer de hardware (ESP32) o millis/micros (Arduino)
 * para mantener exactamente 1000 Hz de muestreo.
 *
 * Salida CSV compatible con Serial Plotter del IDE Arduino
 * y con el script Python de visualizacion del proyecto.
 *
 * PROYECTO: IRON-SYNC — UMRPSFXCH SIS-330
 */

#include <IRONSYNC_EMG.h>

#ifdef ESP32
  #include "esp_timer.h"
  #define EMG_PIN  34
  #define ADC_BITS 12
  #define VREF     3.3f
#else
  #define EMG_PIN  A0
  #define ADC_BITS 10
  #define VREF     5.0f
#endif

// ── Instancia ─────────────────────────────────────────────────
IRONSYNC_EMG emg(EMG_PIN, ADC_BITS, VREF, EMG_NOTCH_50HZ);

// ── Control de tiempo ─────────────────────────────────────────
volatile bool sample_flag = false;
uint32_t last_print = 0;

#ifdef ESP32
// Timer de hardware ESP32 — interrumpe cada 1ms exacto
esp_timer_handle_t timer_handle;

void IRAM_ATTR onTimer(void* arg) {
    sample_flag = true;
}
#endif

void setup() {
    Serial.begin(115200);
    while (!Serial) {}

    Serial.println(F("# IRON-SYNC EMG Filtered Signal"));
    Serial.println(F("# t_ms:raw_mV:filtered_mV:rms_mV:envelope_mV"));

    emg.begin();

#ifdef ESP32
    // Configurar timer de hardware a 1000 Hz
    esp_timer_create_args_t timer_args = {
        .callback = onTimer,
        .name     = "emg_timer"
    };
    esp_timer_create(&timer_args, &timer_handle);
    esp_timer_start_periodic(timer_handle, 1000); // 1000 us = 1 kHz
    Serial.println(F("# Timer hardware ESP32 activo @ 1000 Hz"));
#else
    Serial.println(F("# Timer software Arduino @ aprox 1000 Hz"));
#endif
}

void loop() {
    bool should_sample = false;

#ifdef ESP32
    if (sample_flag) {
        sample_flag = false;
        should_sample = true;
    }
#else
    static uint32_t last_us = 0;
    uint32_t now_us = micros();
    if (now_us - last_us >= 1000) {
        last_us = now_us;
        should_sample = true;
    }
#endif

    if (should_sample) {
        float raw      = emg.readRawMV();
        float filtered = emg.applyBandpass(raw);
        filtered       = emg.applyNotch(filtered);
        float envelope = emg.rmsEnvelope(filtered, 50);

        // Imprimir a 200 Hz (cada 5 muestras) para Serial Plotter
        static uint8_t skip = 0;
        if (++skip >= 5) {
            skip = 0;
            uint32_t t = millis();
            Serial.print(t);
            Serial.print(':');
            Serial.print(raw, 3);
            Serial.print(':');
            Serial.print(filtered, 3);
            Serial.print(':');
            Serial.println(envelope, 3);
        }
    }
}
