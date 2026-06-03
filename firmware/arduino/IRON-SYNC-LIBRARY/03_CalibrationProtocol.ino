/*
 * IRON-SYNC EMG Library — Ejemplo 03
 * ====================================
 * CalibrationProtocol — Calibracion MVC por usuario
 *
 * Ejecuta el protocolo completo de Maximal Voluntary Contraction:
 *  1. Mide RMS en reposo (noise floor)
 *  2. Mide RMS en contraccion BAJA  (~20% MVC)
 *  3. Mide RMS en contraccion MEDIA (~50% MVC)
 *  4. Mide RMS en contraccion ALTA  (100% MVC)
 *
 * Al terminar imprime el perfil en formato JSON y lo guarda
 * en EEPROM (Arduino) o SPIFFS/NVS (ESP32) si esta disponible.
 *
 * Presiona el boton BOOT del ESP32 o envia 'c' por Serial
 * para iniciar la calibracion.
 *
 * PROYECTO: IRON-SYNC — UMRPSFXCH SIS-330
 */

#include <IRONSYNC_EMG.h>

#ifdef ESP32
  #include <Preferences.h>   // NVS del ESP32
  #define EMG_PIN    34
  #define BUTTON_PIN  0      // Boton BOOT del ESP32
  #define LED_PIN    2       // LED onboard ESP32
  #define ADC_BITS  12
  #define VREF      3.3f
  Preferences prefs;
#else
  #include <EEPROM.h>
  #define EMG_PIN    A0
  #define BUTTON_PIN 7
  #define LED_PIN    LED_BUILTIN
  #define ADC_BITS  10
  #define VREF      5.0f
#endif

// ── Instancia del sensor y calibrador ────────────────────────
IRONSYNC_EMG emg(EMG_PIN, ADC_BITS, VREF, EMG_NOTCH_50HZ);
EMGCalibrator calibrator(emg, LED_PIN);

// ── Estado ────────────────────────────────────────────────────
bool calibrating = false;
bool profile_loaded = false;

// ── Funciones de persistencia ─────────────────────────────────

void saveProfile(const EMGUserProfile& p) {
#ifdef ESP32
    prefs.begin("ironsync", false);
    prefs.putBytes("emg_profile", &p, sizeof(EMGUserProfile));
    prefs.end();
    Serial.println(F("[NVS] Perfil guardado en flash ESP32."));
#else
    EEPROM.put(0, p);
    Serial.println(F("[EEPROM] Perfil guardado."));
#endif
}

bool loadProfile(EMGUserProfile& p) {
#ifdef ESP32
    prefs.begin("ironsync", true);
    bool ok = prefs.isKey("emg_profile");
    if (ok) prefs.getBytes("emg_profile", &p, sizeof(EMGUserProfile));
    prefs.end();
    return ok && p.calibrated;
#else
    EEPROM.get(0, p);
    return p.calibrated;
#endif
}

void setup() {
    Serial.begin(115200);
    while (!Serial) {}
    delay(500);

    pinMode(BUTTON_PIN, INPUT_PULLUP);
    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, LOW);

    Serial.println(F("========================================"));
    Serial.println(F(" IRON-SYNC EMG — Protocolo Calibracion"));
    Serial.println(F("========================================"));

    emg.begin();

    // Intentar cargar perfil guardado
    EMGUserProfile saved;
    if (loadProfile(saved)) {
        emg.loadProfile(saved);
        profile_loaded = true;
        Serial.println(F("[OK] Perfil de usuario cargado desde memoria."));
        emg.printProfile();
        Serial.println(F("\nPresiona BOOT o envia 'c' para recalibrar."));
    } else {
        Serial.println(F("[INFO] Sin perfil guardado."));
        Serial.println(F("Presiona BOOT o envia 'c' para calibrar."));
    }
}

void loop() {
    static uint32_t last_us = 0;
    uint32_t now_us = micros();

    // Muestrear a 1000 Hz
    if (now_us - last_us >= 1000) {
        last_us = now_us;

        if (calibrating) {
            calibrator.tick();

            // Mostrar progreso cada 500 ms
            static uint32_t last_prog = 0;
            if (millis() - last_prog > 500) {
                last_prog = millis();
                Serial.print(F("[CAL] "));
                Serial.print(calibrator.getProgress());
                Serial.print(F("% — "));
                Serial.println(calibrator.getStatusMessage());
            }

            if (calibrator.isDone()) {
                calibrating = false;
                digitalWrite(LED_PIN, LOW);

                if (calibrator.wasSuccessful()) {
                    EMGUserProfile p = calibrator.getProfile();
                    saveProfile(p);

                    char json[256];
                    calibrator.profileToJSON(json, sizeof(json));
                    Serial.println(F("\n--- Perfil JSON ---"));
                    Serial.println(json);
                    Serial.println(F("\n[OK] Calibracion completada."));

                    // 3 destellos de exito
                    for (int i = 0; i < 3; i++) {
                        digitalWrite(LED_PIN, HIGH); delay(100);
                        digitalWrite(LED_PIN, LOW);  delay(100);
                    }
                } else {
                    Serial.println(F("[ERROR] Calibracion fallida."));
                    Serial.println(F("Verifica que el sensor este bien colocado"));
                    Serial.println(F("y que estés aplicando fuerza en cada nivel."));
                }
            }

        } else {
            // Muestrear y mostrar nivel si ya esta calibrado
            emg.sample();
            static uint32_t last_print = 0;
            if (profile_loaded && millis() - last_print > 100) {
                last_print = millis();
                EMGLevel lvl  = emg.classify();
                float    conf = emg.getConfidence();
                Serial.print(F("Nivel: "));
                Serial.print(IRONSYNC_EMG::levelToString(lvl));
                Serial.print(F("  RMS: "));
                Serial.print(emg.getLastRMS(), 2);
                Serial.print(F(" mV  Conf: "));
                Serial.print(conf, 0);
                Serial.println('%');
            }
        }
    }

    // Iniciar calibracion por boton o Serial
    bool btn_pressed = (digitalRead(BUTTON_PIN) == LOW);
    bool serial_cmd  = (Serial.available() && Serial.read() == 'c');

    if ((btn_pressed || serial_cmd) && !calibrating) {
        delay(50); // debounce
        calibrating = true;
        digitalWrite(LED_PIN, HIGH);
        calibrator.start();
        Serial.println(F("\n[START] Calibracion iniciada."));
    }
}
