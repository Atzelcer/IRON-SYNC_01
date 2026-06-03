/*
 * IRON-SYNC EMG Library — Ejemplo 04
 * ====================================
 * GestureClassifier — Clasificacion IDLE/LOW/MID/HIGH
 * con features completas y score de confianza
 *
 * Cada 200 ms (ventana completa) calcula RMS, MAV, ZCR, WL
 * y clasifica el nivel de contraccion usando el perfil
 * previamente calibrado. Solo acepta predicciones con
 * confianza > 65%.
 *
 * Salida: envia el nivel clasificado al PC via Serial
 * en formato JSON para ser leido por el pipeline Python
 * que entrena la TCN de IRON-SYNC.
 *
 * PROYECTO: IRON-SYNC — UMRPSFXCH SIS-330
 */

#include <IRONSYNC_EMG.h>

#ifdef ESP32
  #include <Preferences.h>
  #define EMG_PIN   34
  #define LED_R     25
  #define LED_G     26
  #define LED_B     27
  #define ADC_BITS  12
  #define VREF      3.3f
  Preferences prefs;
#else
  #define EMG_PIN   A0
  #define LED_R     9
  #define LED_G     10
  #define LED_B     11
  #define ADC_BITS  10
  #define VREF      5.0f
#endif

// ── Instancia ─────────────────────────────────────────────────
IRONSYNC_EMG emg(EMG_PIN, ADC_BITS, VREF, EMG_NOTCH_50HZ);

// ── Parametros ────────────────────────────────────────────────
const float  MIN_CONFIDENCE = 65.0f;
const uint16_t WINDOW_MS    = 200;     // ventana de clasificacion
uint32_t last_window_ms     = 0;
uint32_t sample_count       = 0;

// ── Feedback RGB LED ──────────────────────────────────────────
void setLED(EMGLevel lvl) {
#ifdef ESP32
    analogWrite(LED_R, 0);
    analogWrite(LED_G, 0);
    analogWrite(LED_B, 0);
    switch (lvl) {
        case EMG_LEVEL_IDLE: analogWrite(LED_B, 30);  break; // azul tenue
        case EMG_LEVEL_LOW:  analogWrite(LED_G, 100); break; // verde
        case EMG_LEVEL_MID:  analogWrite(LED_R, 150);
                             analogWrite(LED_G, 100); break; // amarillo
        case EMG_LEVEL_HIGH: analogWrite(LED_R, 255); break; // rojo
    }
#endif
}

// ── Cargar perfil desde NVS ───────────────────────────────────
bool loadProfile() {
#ifdef ESP32
    prefs.begin("ironsync", true);
    bool ok = prefs.isKey("emg_profile");
    if (ok) {
        EMGUserProfile p;
        prefs.getBytes("emg_profile", &p, sizeof(p));
        if (p.calibrated) {
            emg.loadProfile(p);
            prefs.end();
            return true;
        }
    }
    prefs.end();
#endif
    return false;
}

void setup() {
    Serial.begin(115200);
    while (!Serial) {}

    pinMode(LED_R, OUTPUT);
    pinMode(LED_G, OUTPUT);
    pinMode(LED_B, OUTPUT);

    Serial.println(F("# IRON-SYNC EMG GestureClassifier v1.0"));
    Serial.println(F("# Formato: {\"t\":ms,\"lvl\":0-3,\"rms\":mV,\"conf\":pct,\"feat\":{...}}"));

    emg.begin();

    if (loadProfile()) {
        Serial.println(F("# Perfil de usuario cargado OK"));
        emg.printProfile();
    } else {
        Serial.println(F("# ADVERTENCIA: sin calibracion. Umbrales genericos."));
        Serial.println(F("# Ejecuta el ejemplo 03 primero para calibrar."));
    }

    Serial.println(F("# Iniciando clasificacion..."));
    last_window_ms = millis();
}

void loop() {
    static uint32_t last_us = 0;
    uint32_t now_us = micros();

    // Muestrear exactamente a 1000 Hz
    if (now_us - last_us >= 1000) {
        last_us = now_us;
        emg.sample();
        sample_count++;
    }

    // Clasificar cada 200 ms (ventana completa)
    if (millis() - last_window_ms >= WINDOW_MS) {
        last_window_ms = millis();

        EMGFeatures feat = emg.computeFeatures();

        if (!feat.valid) return;

        EMGLevel lvl  = emg.classify();
        float    conf = emg.getConfidence();

        // Descartar si confianza es baja
        bool accepted = (conf >= MIN_CONFIDENCE);

        // Feedback LED
        if (accepted) setLED(lvl);

        // Enviar JSON al PC
        Serial.print(F("{\"t\":"));
        Serial.print(feat.timestamp);
        Serial.print(F(",\"lvl\":"));
        Serial.print((uint8_t)lvl);
        Serial.print(F(",\"lvl_str\":\""));
        Serial.print(IRONSYNC_EMG::levelToString(lvl));
        Serial.print(F("\",\"conf\":"));
        Serial.print(conf, 1);
        Serial.print(F(",\"accepted\":"));
        Serial.print(accepted ? F("true") : F("false"));
        Serial.print(F(",\"feat\":{"));
        Serial.print(F("\"rms\":"));
        Serial.print(feat.rms, 4);
        Serial.print(F(",\"mav\":"));
        Serial.print(feat.mav, 4);
        Serial.print(F(",\"zcr\":"));
        Serial.print(feat.zcr, 2);
        Serial.print(F(",\"wl\":"));
        Serial.print(feat.wl, 4);
        Serial.print(F(",\"var\":"));
        Serial.print(feat.var, 6);
        Serial.print(F(",\"iemg\":"));
        Serial.print(feat.iemg, 6);
        Serial.println(F("}}"));

        // Contador de muestras cada 5 segundos
        static uint32_t last_stats = 0;
        if (millis() - last_stats > 5000) {
            last_stats = millis();
            Serial.print(F("# Muestras: "));
            Serial.print(sample_count);
            Serial.print(F("  (~"));
            Serial.print(sample_count / 5);
            Serial.println(F(" Hz efectivo)"));
        }
    }
}
