/*
 * IRON-SYNC EMG Library — Ejemplo 05
 * ====================================
 * SerialStreamer — Streaming continuo para pipeline Python
 *
 * Envia datos a 1000 Hz en formato CSV binario compacto
 * optimizado para ser leido por el script Python que:
 *  1. Acumula ventanas de 200 muestras
 *  2. Extrae features y las guarda como dataset .npy
 *  3. Alimenta en tiempo real el modelo TCN de IRON-SYNC
 *
 * Protocolo CSV a 115200 baudios:
 *   SYNC,t_ms,raw_mV,filt_mV,rms_mV,mav_mV,level,conf\n
 *
 * Comandos aceptados por Serial:
 *   's'  -> start streaming
 *   'p'  -> pause streaming
 *   'f'  -> print features de la ventana actual
 *   'r'  -> reset buffer
 *   'i'  -> info del sistema
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

// ── Instancia y streamer ──────────────────────────────────────
IRONSYNC_EMG    emg(EMG_PIN, ADC_BITS, VREF, EMG_NOTCH_50HZ);
EMGSerialStreamer streamer(emg, Serial);

// ── Estado ────────────────────────────────────────────────────
bool streaming     = false;
uint32_t last_us   = 0;
uint32_t t_start   = 0;

void printHelp() {
    Serial.println(F("# Comandos: s=start  p=pause  f=features  r=reset  i=info"));
}

void printInfo() {
    Serial.print(F("# IRON-SYNC EMG Streamer | Fs="));
    Serial.print(EMG_SAMPLE_RATE_HZ);
    Serial.print(F("Hz | Win="));
    Serial.print(EMG_WINDOW_SIZE);
    Serial.print(F("muestras | Buffer="));
    Serial.print(EMG_BUFFER_SIZE);
    Serial.print(F(" | Muestras enviadas: "));
    Serial.println(streamer.getSampleCount());
    emg.printProfile();
}

void loadProfile() {
#ifdef ESP32
    prefs.begin("ironsync", true);
    if (prefs.isKey("emg_profile")) {
        EMGUserProfile p;
        prefs.getBytes("emg_profile", &p, sizeof(p));
        if (p.calibrated) emg.loadProfile(p);
    }
    prefs.end();
#endif
}

void setup() {
    streamer.begin(115200);
    streamer.setEnabled(false);

    emg.begin();
    loadProfile();

    Serial.println(F("# IRON-SYNC EMG SerialStreamer v1.0"));
    Serial.println(F("# Cabecera: t_ms,raw_mV,filt_mV,rms_mV,mav_mV,lvl,conf"));
    printHelp();

    t_start = millis();
}

void loop() {
    uint32_t now_us = micros();

    // Muestrear a 1000 Hz exacto
    if (now_us - last_us >= 1000) {
        last_us = now_us;
        emg.sample();

        if (streaming) {
            streamer.stream(EMG_OUTPUT_CSV);
        }
    }

    // Procesar comandos Serial
    if (Serial.available()) {
        char cmd = Serial.read();
        switch (cmd) {
            case 's':
                streaming = true;
                streamer.setEnabled(true);
                streamer.sendSync();
                Serial.println(F("# STREAM START"));
                break;
            case 'p':
                streaming = false;
                streamer.setEnabled(false);
                Serial.println(F("# STREAM PAUSE"));
                break;
            case 'f':
                emg.printFeatures();
                break;
            case 'r':
                emg.flushBuffer();
                Serial.println(F("# BUFFER RESET"));
                break;
            case 'i':
                printInfo();
                break;
            case '?':
                printHelp();
                break;
        }
    }

    // Stats cada 10 segundos si no estamos en streaming
    if (!streaming) {
        static uint32_t last_stat = 0;
        if (millis() - last_stat > 10000) {
            last_stat = millis();
            Serial.print(F("# Uptime: "));
            Serial.print((millis() - t_start) / 1000);
            Serial.print(F("s | RMS actual: "));
            Serial.print(emg.getLastRMS(), 2);
            Serial.print(F(" mV | Nivel: "));
            Serial.println(IRONSYNC_EMG::levelToString(emg.classify()));
        }
    }
}
