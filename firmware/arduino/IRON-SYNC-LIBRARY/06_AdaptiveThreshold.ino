/*
 * IRON-SYNC EMG Library — Ejemplo 06
 * ====================================
 * AdaptiveThreshold — Compensacion de fatiga muscular en sesion
 *
 * Durante una sesion de juego prolongada, los musculos se fatigan
 * y la amplitud de la senal EMG deriva hacia abajo. Este ejemplo
 * implementa el modulo de adaptacion de umbrales en tiempo real:
 *
 *  - Detecta automaticamente ventanas de reposo (RMS bajo)
 *  - Actualiza la linea base con EMA lenta cada 5 minutos
 *  - Ajusta los tres umbrales de clasificacion proporcionalmente
 *  - Imprime un log de deriva para diagnostico
 *
 * Esto es el "ADAPTIVE EMG LEARNER" del pipeline IRON-SYNC.
 *
 * PROYECTO: IRON-SYNC — UMRPSFXCH SIS-330
 */

#include <IRONSYNC_EMG.h>

#ifdef ESP32
  #include <Preferences.h>
  #define EMG_PIN  34
  #define ADC_BITS 12
  #define VREF     3.3f
  Preferences prefs;
#else
  #define EMG_PIN  A0
  #define ADC_BITS 10
  #define VREF     5.0f
#endif

// ── Instancia ─────────────────────────────────────────────────
IRONSYNC_EMG emg(EMG_PIN, ADC_BITS, VREF, EMG_NOTCH_50HZ);

// ── Parametros de adaptacion ──────────────────────────────────
const uint32_t ADAPT_INTERVAL_MS = 300000UL; // Actualizar cada 5 min
const float    REST_THRESHOLD    = 1.5f;     // Multiplo del noise floor
const uint16_t REST_WIN_SAMPLES  = 500;      // 500 ms de reposo confirmado

// ── Variables de control ──────────────────────────────────────
uint32_t last_adapt_ms    = 0;
uint32_t rest_start_ms    = 0;
bool     in_rest_window   = false;
float    rest_accum       = 0.0f;
uint16_t rest_accum_n     = 0;
uint8_t  adapt_count      = 0;

// ── Historial de deriva ───────────────────────────────────────
#define DRIFT_HISTORY_LEN 12
float drift_history[DRIFT_HISTORY_LEN] = {0};
uint8_t drift_idx = 0;

void logDrift(float old_rest, float new_rest) {
    float drift_pct = (new_rest - old_rest) / old_rest * 100.0f;
    drift_history[drift_idx % DRIFT_HISTORY_LEN] = drift_pct;
    drift_idx++;

    Serial.print(F("[ADAPT] Actualizacion #"));
    Serial.print(adapt_count);
    Serial.print(F(" | Reposo: "));
    Serial.print(old_rest, 3);
    Serial.print(F(" -> "));
    Serial.print(new_rest, 3);
    Serial.print(F(" mV ("));
    if (drift_pct >= 0) Serial.print('+');
    Serial.print(drift_pct, 1);
    Serial.println(F("%)"));
}

bool loadProfile() {
#ifdef ESP32
    prefs.begin("ironsync", true);
    if (prefs.isKey("emg_profile")) {
        EMGUserProfile p;
        prefs.getBytes("emg_profile", &p, sizeof(p));
        if (p.calibrated) { emg.loadProfile(p); prefs.end(); return true; }
    }
    prefs.end();
#endif
    return false;
}

void setup() {
    Serial.begin(115200);
    while (!Serial) {}
    delay(300);

    Serial.println(F("========================================"));
    Serial.println(F(" IRON-SYNC — Adaptive Threshold Module"));
    Serial.println(F("========================================"));

    emg.begin();
    emg.setAdaptiveMode(true);

    if (loadProfile()) {
        Serial.println(F("[OK] Perfil cargado."));
        emg.printProfile();
    } else {
        Serial.println(F("[WARN] Sin perfil — usando umbrales genericos."));
    }

    Serial.println(F("\n# t_ms, rms_mV, level, adapt_count, in_rest"));
    last_adapt_ms = millis();
    rest_start_ms = millis();
}

void loop() {
    static uint32_t last_us = 0;
    uint32_t now_us = micros();
    uint32_t now_ms = millis();

    // Muestrear a 1000 Hz
    if (now_us - last_us >= 1000) {
        last_us = now_us;
        emg.sample();
    }

    // Ventana de 200 ms
    static uint32_t last_win = 0;
    if (now_ms - last_win >= 200) {
        last_win = now_ms;

        EMGFeatures feat = emg.computeFeatures();
        if (!feat.valid) return;

        EMGLevel lvl = emg.classify();
        EMGUserProfile p = emg.getProfile();

        // Detectar ventana de reposo
        bool is_rest = (feat.rms < p.noise_floor * REST_THRESHOLD);

        if (is_rest) {
            if (!in_rest_window) {
                in_rest_window = true;
                rest_start_ms  = now_ms;
                rest_accum     = 0.0f;
                rest_accum_n   = 0;
            }
            rest_accum += feat.rms;
            rest_accum_n++;
        } else {
            in_rest_window = false;
        }

        // Actualizar umbrales si hay 5 min de sesion y tenemos datos de reposo
        bool time_ok = (now_ms - last_adapt_ms >= ADAPT_INTERVAL_MS);
        bool rest_ok = (rest_accum_n >= REST_WIN_SAMPLES / 200);

        if (time_ok && rest_ok) {
            float new_rest = rest_accum / (float)rest_accum_n;
            float old_rest = p.rms_rest;

            logDrift(old_rest, new_rest);
            emg.updateAdaptiveThresholds(new_rest);

            adapt_count++;
            last_adapt_ms = now_ms;
            rest_accum    = 0.0f;
            rest_accum_n  = 0;
        }

        // Output cada 200 ms
        Serial.print(now_ms);
        Serial.print(',');
        Serial.print(feat.rms, 3);
        Serial.print(',');
        Serial.print(IRONSYNC_EMG::levelToString(lvl));
        Serial.print(',');
        Serial.print(adapt_count);
        Serial.print(',');
        Serial.println(is_rest ? F("REST") : F("ACTIVE"));
    }

    // Resumen cada 60 segundos
    static uint32_t last_summary = 0;
    if (now_ms - last_summary > 60000) {
        last_summary = now_ms;
        Serial.println(F("\n--- Resumen de deriva ---"));
        for (uint8_t i = 0; i < min((uint8_t)DRIFT_HISTORY_LEN, adapt_count); i++) {
            Serial.print(F("  Adapt #"));
            Serial.print(i+1);
            Serial.print(F(": "));
            if (drift_history[i] >= 0) Serial.print('+');
            Serial.print(drift_history[i], 1);
            Serial.println('%');
        }
        Serial.println();
    }
}
