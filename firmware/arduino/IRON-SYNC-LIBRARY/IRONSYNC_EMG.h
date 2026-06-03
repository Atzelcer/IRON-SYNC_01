/*
 * ============================================================
 *  IRON-SYNC EMG Library
 *  Modulo: SEN0240 — Gravity Analog EMG Sensor (DFRobot)
 *  Proyecto: IRON-SYNC — UMRPSFXCH SIS-330
 *  Autor: Cervantes Torres Atzel Alan
 * ============================================================
 *
 *  DESCRIPCION:
 *  Libreria completa para adquisicion, filtrado, normalizacion
 *  y calibracion adaptativa de senales EMG con el sensor
 *  Gravity SEN0240 de DFRobot sobre plataformas Arduino/ESP32.
 *
 *  El sensor SEN0240 entrega una senal analogica rectificada
 *  y amplificada (0-3.3V o 0-5V segun Vcc) que representa
 *  la envolvente de la actividad muscular superficial (sEMG).
 *  Su rango de frecuencia util es 20-500 Hz con ganancia fija.
 *
 *  CARACTERISTICAS:
 *  - Buffer circular lockfree de doble canal
 *  - Filtro Butterworth IIR pasa-banda 20-450 Hz (orden 4)
 *  - Filtro Notch IIR a 50 Hz (Bolivia) o 60 Hz (USA)
 *  - Calculo de RMS, MAV, ZCR y WL en ventana deslizante
 *  - Protocolo de calibracion MVC (Maximal Voluntary Contraction)
 *  - Umbral adaptativo con media exponencial (EMA)
 *  - Salida serial en formato CSV y JSON
 *  - Soporte ADC 12-bit ESP32 y 10-bit Arduino UNO/Mega
 *
 *  DEPENDENCIAS:
 *  - Arduino.h (core)
 *  - math.h   (sqrt, fabs, pow)
 *
 *  HARDWARE PROBADO:
 *  - ESP32 DevKit V1
 *  - Arduino UNO R3
 *  - Arduino Mega 2560
 *  - Arduino Nano Every
 *
 *  LICENCIA: MIT
 * ============================================================
 */

#pragma once
#ifndef IRONSYNC_EMG_H
#define IRONSYNC_EMG_H

#include <Arduino.h>
#include <math.h>

// ─── VERSION ─────────────────────────────────────────────────
#define IRONSYNC_EMG_VERSION_MAJOR  1
#define IRONSYNC_EMG_VERSION_MINOR  0
#define IRONSYNC_EMG_VERSION_PATCH  0
#define IRONSYNC_EMG_VERSION        "1.0.0"

// ─── CONSTANTES DEL SENSOR SEN0240 ───────────────────────────
#define SEN0240_VREF_33         3.3f    // Vref para ESP32 (3.3V)
#define SEN0240_VREF_50         5.0f    // Vref para Arduino 5V
#define SEN0240_ADC_BITS_10     1023    // Arduino UNO / Mega
#define SEN0240_ADC_BITS_12     4095    // ESP32

// ─── PARAMETROS DE FILTRADO ───────────────────────────────────
#define EMG_SAMPLE_RATE_HZ      1000   // Frecuencia de muestreo
#define EMG_FILTER_LOWCUT_HZ    20.0f  // Corte inferior pasa-banda
#define EMG_FILTER_HIGHCUT_HZ   450.0f // Corte superior pasa-banda
#define EMG_NOTCH_FREQ_50HZ     50.0f  // Red electrica Bolivia/Europa
#define EMG_NOTCH_FREQ_60HZ     60.0f  // Red electrica USA/Mexico
#define EMG_NOTCH_Q             35.0f  // Factor de calidad del notch

// ─── PARAMETROS DE VENTANA ───────────────────────────────────
#define EMG_WINDOW_SIZE         200    // Ventana 200 ms @ 1000 Hz
#define EMG_WINDOW_OVERLAP      100    // Solapamiento 50%
#define EMG_BUFFER_SIZE         512    // Buffer circular (potencia de 2)

// ─── PARAMETROS DE CALIBRACION ───────────────────────────────
#define EMG_CALIB_REPS          3      // Repeticiones por nivel
#define EMG_CALIB_DURATION_MS   3000   // Duracion de cada contraccion
#define EMG_CALIB_REST_MS       2000   // Descanso entre contracciones
#define EMG_CALIB_LEVELS        3      // BAJO / MEDIO / ALTO

// ─── PARAMETROS EMA ──────────────────────────────────────────
#define EMG_EMA_ALPHA           0.05f  // Factor de suavizado EMA lento
#define EMG_EMA_ALPHA_FAST      0.20f  // EMA rapida para activacion

// ─── ENUMERACIONES ───────────────────────────────────────────

/** Nivel de intensidad muscular clasificado */
enum EMGLevel {
    EMG_LEVEL_IDLE   = 0,   ///< Sin actividad muscular
    EMG_LEVEL_LOW    = 1,   ///< Contraccion baja
    EMG_LEVEL_MID    = 2,   ///< Contraccion media
    EMG_LEVEL_HIGH   = 3    ///< Contraccion alta (MVC)
};

/** Tipo de notch segun red electrica del pais */
enum EMGNotchType {
    EMG_NOTCH_50HZ = 0,     ///< Bolivia, Europa, China
    EMG_NOTCH_60HZ = 1      ///< USA, Mexico, Canada
};

/** Formato de salida serial */
enum EMGOutputFormat {
    EMG_OUTPUT_CSV  = 0,    ///< timestamp,raw,filtered,rms,level
    EMG_OUTPUT_JSON = 1     ///< {"t":0,"raw":0,"f":0,"rms":0,"lvl":0}
};

/** Estado de la calibracion */
enum EMGCalibState {
    EMG_CALIB_IDLE      = 0,
    EMG_CALIB_REST      = 1,
    EMG_CALIB_LEVEL_LOW = 2,
    EMG_CALIB_LEVEL_MID = 3,
    EMG_CALIB_LEVEL_HIGH= 4,
    EMG_CALIB_DONE      = 5,
    EMG_CALIB_ERROR     = 6
};

// ─── ESTRUCTURA DE FEATURES ──────────────────────────────────
/**
 * Contiene todas las features extraidas de una ventana EMG.
 * Se calcula una vez por ventana y se usa para clasificacion.
 */
struct EMGFeatures {
    float rms;          ///< Root Mean Square (mV)
    float mav;          ///< Mean Absolute Value (mV)
    float zcr;          ///< Zero Crossing Rate (cruces/s)
    float wl;           ///< Waveform Length (suma dif absolutas)
    float var;          ///< Varianza
    float iemg;         ///< Integrated EMG (integral de MAV)
    uint32_t timestamp; ///< Timestamp en ms
    bool valid;         ///< La ventana tiene suficientes datos
};

// ─── ESTRUCTURA DE PERFIL DE USUARIO ─────────────────────────
/**
 * Perfil de calibracion personalizada por usuario.
 * Se genera tras el protocolo MVC y se guarda en EEPROM/SPIFFS.
 */
struct EMGUserProfile {
    float rms_rest;         ///< RMS en reposo
    float rms_low;          ///< RMS umbral contraccion baja
    float rms_mid;          ///< RMS umbral contraccion media
    float rms_high;         ///< RMS contraccion maxima (MVC)
    float noise_floor;      ///< Piso de ruido (media + 2*std en reposo)
    float snr;              ///< Signal-to-Noise Ratio estimado
    uint8_t adc_bits;       ///< Bits del ADC del hardware
    float vref;             ///< Tension de referencia del ADC
    bool calibrated;        ///< true si la calibracion fue exitosa
    uint32_t calib_time;    ///< Timestamp de la calibracion
};

// ─── CLASE PRINCIPAL ─────────────────────────────────────────

class IRONSYNC_EMG {

public:

    // ── Constructor / Destructor ──────────────────────────────

    /**
     * Constructor.
     * @param pin        Pin analogico conectado al SEN0240
     * @param adc_bits   Resolucion ADC: 10 (Arduino) o 12 (ESP32)
     * @param vref       Tension de referencia del ADC en voltios
     * @param notch      Tipo de notch segun red electrica del pais
     */
    IRONSYNC_EMG(uint8_t pin,
                 uint8_t  adc_bits = 12,
                 float    vref     = SEN0240_VREF_33,
                 EMGNotchType notch = EMG_NOTCH_50HZ);

    // ── Inicializacion ────────────────────────────────────────

    /**
     * Inicializa el sensor, configura el ADC y calcula
     * los coeficientes de los filtros IIR.
     * Llamar una vez en setup().
     */
    void begin();

    /**
     * Configura la resolucion del ADC en ESP32.
     * En Arduino la resolucion es fija (10 bits).
     * @param bits  10 o 12
     */
    void setADCResolution(uint8_t bits);

    // ── Lectura y filtrado ────────────────────────────────────

    /**
     * Lee una muestra del ADC, la convierte a mV,
     * la filtra y la agrega al buffer circular.
     * Debe llamarse exactamente cada 1 ms (usar timer o ticker).
     * @return muestra filtrada en mV
     */
    float sample();

    /**
     * Lee el valor raw del ADC y lo convierte a mV.
     * @return tension en mV sin filtrar
     */
    float readRawMV();

    /**
     * Aplica el filtro pasa-banda Butterworth IIR orden 4.
     * @param x  muestra cruda en mV
     * @return   muestra filtrada en mV
     */
    float applyBandpass(float x);

    /**
     * Aplica el filtro notch IIR para eliminar interferencia
     * de la red electrica (50 o 60 Hz).
     * @param x  muestra de entrada
     * @return   muestra con notch aplicado
     */
    float applyNotch(float x);

    /**
     * Aplica el envolvente RMS sobre una ventana movil.
     * Util para deteccion rapida de activacion muscular.
     * @param x          muestra filtrada
     * @param win_size   tamanio de la ventana (muestras)
     * @return           envolvente RMS
     */
    float rmsEnvelope(float x, uint16_t win_size = 50);

    // ── Features ─────────────────────────────────────────────

    /**
     * Calcula todas las features de la ventana actual del buffer.
     * @return estructura EMGFeatures con todas las metricas
     */
    EMGFeatures computeFeatures();

    /**
     * Calcula el RMS de la ventana actual.
     * @param window  puntero a array de muestras
     * @param n       numero de muestras
     * @return        RMS en mV
     */
    float computeRMS(const float* window, uint16_t n);

    /**
     * Calcula el Mean Absolute Value de la ventana.
     */
    float computeMAV(const float* window, uint16_t n);

    /**
     * Calcula la tasa de cruces por cero de la ventana.
     * @return ZCR normalizada (cruces por segundo)
     */
    float computeZCR(const float* window, uint16_t n);

    /**
     * Calcula la Waveform Length (suma de diferencias absolutas).
     */
    float computeWL(const float* window, uint16_t n);

    /**
     * Calcula la varianza de la ventana.
     */
    float computeVariance(const float* window, uint16_t n);

    // ── Clasificacion ─────────────────────────────────────────

    /**
     * Clasifica el nivel de contraccion muscular basandose
     * en el RMS actual y el perfil de usuario calibrado.
     * @return EMGLevel (IDLE, LOW, MID, HIGH)
     */
    EMGLevel classify();

    /**
     * Clasifica usando un perfil de umbrales externo.
     * Util para perfiles cargados desde EEPROM/SPIFFS.
     * @param rms     RMS actual
     * @param profile perfil de usuario
     * @return        EMGLevel
     */
    EMGLevel classifyWithProfile(float rms, const EMGUserProfile& profile);

    /**
     * Devuelve el score de confianza de la clasificacion actual
     * como porcentaje (0-100). Valores < 60 deben descartarse.
     * @return confianza en porcentaje
     */
    float getConfidence();

    // ── Calibracion ───────────────────────────────────────────

    /**
     * Ejecuta el protocolo de calibracion MVC completo.
     * Bloquea el hilo durante la calibracion (3 niveles x 3 reps).
     * Usa Serial para guiar al usuario con mensajes de texto.
     * @param verbose  true = imprime instrucciones por Serial
     * @return         true si la calibracion fue exitosa
     */
    bool runCalibration(bool verbose = true);

    /**
     * Avanza la maquina de estados de calibracion (no bloqueante).
     * Llamar en loop() junto a sample(). Usa callbacks para UI.
     * @return EMGCalibState actual
     */
    EMGCalibState tickCalibration();

    /**
     * Registra un callback que se llama cuando cambia el estado
     * de la calibracion.
     * @param cb  funcion void(EMGCalibState state)
     */
    void onCalibStateChange(void (*cb)(EMGCalibState));

    /**
     * Registra un callback llamado cuando la calibracion termina.
     * @param cb  funcion void(bool success, EMGUserProfile profile)
     */
    void onCalibComplete(void (*cb)(bool, EMGUserProfile));

    /**
     * Carga un perfil de usuario externo.
     * @param profile  perfil previamente guardado
     */
    void loadProfile(const EMGUserProfile& profile);

    /**
     * Devuelve el perfil de usuario actual (calibrado o por defecto).
     */
    EMGUserProfile getProfile() const;

    /**
     * Resetea el perfil a valores por defecto (sin calibracion).
     */
    void resetProfile();

    // ── Umbral adaptativo ─────────────────────────────────────

    /**
     * Actualiza los umbrales de clasificacion usando EMA.
     * Llamar periodicamente (ej: cada 5 minutos) para compensar
     * la deriva de senal por fatiga muscular.
     * @param current_rms_rest  RMS actual en ventana de reposo
     */
    void updateAdaptiveThresholds(float current_rms_rest);

    /**
     * Activa o desactiva el umbral adaptativo automatico.
     * Cuando esta activo, se actualiza en cada ventana de reposo.
     */
    void setAdaptiveMode(bool enabled);

    // ── Buffer circular ───────────────────────────────────────

    /**
     * Devuelve un puntero al array de la ventana actual (200 muestras).
     * Los datos estan ordenados del mas antiguo al mas nuevo.
     * @param out  array destino de EMG_WINDOW_SIZE floats
     */
    void getWindow(float* out);

    /**
     * Numero de muestras disponibles en el buffer.
     */
    uint16_t available() const;

    /**
     * Limpia el buffer circular.
     */
    void flushBuffer();

    // ── Salida serial ─────────────────────────────────────────

    /**
     * Envia una linea de datos por Serial en el formato elegido.
     * @param fmt   EMG_OUTPUT_CSV o EMG_OUTPUT_JSON
     * @param raw   incluir valor raw en la salida
     */
    void printSerial(EMGOutputFormat fmt = EMG_OUTPUT_CSV,
                     bool raw = true);

    /**
     * Imprime el perfil de calibracion actual por Serial.
     */
    void printProfile();

    /**
     * Imprime las features de la ventana actual por Serial.
     */
    void printFeatures();

    // ── Utilidades ────────────────────────────────────────────

    /**
     * Convierte una lectura ADC cruda a milivoltios.
     * @param raw_adc  valor leido del ADC
     * @return         tension en mV
     */
    float adcToMV(int raw_adc) const;

    /**
     * Estima el SNR de la senal actual en dB.
     * @return SNR en dB (> 20 dB = senal aceptable)
     */
    float estimateSNR();

    /**
     * Devuelve el valor RMS de la ultima ventana calculada.
     */
    float getLastRMS() const { return _last_rms; }

    /**
     * Devuelve el nivel de clasificacion como string.
     */
    static const char* levelToString(EMGLevel lvl);

    /**
     * Devuelve la version de la libreria.
     */
    static const char* version() { return IRONSYNC_EMG_VERSION; }


private:

    // ── Configuracion ─────────────────────────────────────────
    uint8_t      _pin;
    uint8_t      _adc_bits;
    float        _vref;
    float        _adc_max;
    EMGNotchType _notch_type;
    bool         _adaptive_mode;

    // ── Buffer circular ───────────────────────────────────────
    float    _buf[EMG_BUFFER_SIZE];
    uint16_t _buf_head;
    uint16_t _buf_count;

    // ── Estado interno ────────────────────────────────────────
    float    _last_raw_mv;
    float    _last_filtered;
    float    _last_rms;
    float    _last_mav;
    float    _confidence;
    uint32_t _sample_count;

    // ── Filtro Butterworth pasa-banda IIR orden 4 ─────────────
    // Implementado como dos secciones biquad en cascada
    // Seccion 1 (pasa-alto 20 Hz)
    float _bp_b0s1, _bp_b1s1, _bp_b2s1;
    float _bp_a1s1, _bp_a2s1;
    float _bp_x1s1, _bp_x2s1, _bp_y1s1, _bp_y2s1;
    // Seccion 2 (pasa-bajo 450 Hz)
    float _bp_b0s2, _bp_b1s2, _bp_b2s2;
    float _bp_a1s2, _bp_a2s2;
    float _bp_x1s2, _bp_x2s2, _bp_y1s2, _bp_y2s2;

    // ── Filtro Notch IIR ──────────────────────────────────────
    float _notch_b0, _notch_b1, _notch_b2;
    float _notch_a1, _notch_a2;
    float _notch_x1, _notch_x2, _notch_y1, _notch_y2;

    // ── Envolvente RMS movil ──────────────────────────────────
    float    _env_sum_sq;
    float    _env_buf[100];   // buffer para ventana de 100 muestras max
    uint8_t  _env_idx;
    uint8_t  _env_win;

    // ── EMA adaptativo ────────────────────────────────────────
    float _ema_rms;
    float _ema_fast;

    // ── Calibracion ───────────────────────────────────────────
    EMGUserProfile _profile;
    EMGCalibState  _calib_state;
    uint8_t        _calib_level_idx;
    uint8_t        _calib_rep_idx;
    uint32_t       _calib_timer;
    float          _calib_accum[EMG_CALIB_LEVELS];
    uint16_t       _calib_accum_n[EMG_CALIB_LEVELS];

    // ── Callbacks ─────────────────────────────────────────────
    void (*_cb_state_change)(EMGCalibState);
    void (*_cb_calib_complete)(bool, EMGUserProfile);

    // ── Metodos privados ──────────────────────────────────────

    /** Calcula los coeficientes del filtro Butterworth pasa-banda */
    void _computeBandpassCoefficients();

    /** Calcula los coeficientes del filtro Notch */
    void _computeNotchCoefficients(float freq_hz);

    /** Aplica una seccion biquad IIR Direct Form II */
    float _biquad(float x,
                  float b0, float b1, float b2,
                  float a1, float a2,
                  float& x1, float& x2,
                  float& y1, float& y2);

    /** Agrega una muestra al buffer circular */
    void _pushBuffer(float val);

    /** Copia la ventana actual del buffer circular a un array lineal */
    void _copyWindow(float* dst, uint16_t n);

    /** Calcula el nivel de contraccion del EMG normalizado [0-1] */
    float _normalizeRMS(float rms) const;

    /** Actualiza el estado de la maquina de calibracion */
    void _advanceCalibFSM();
};


// ─── CLASE DE STREAMING SERIAL ────────────────────────────────

/**
 * Encapsula el envio de datos EMG por Serial en un protocolo
 * binario compacto o texto CSV para lectura desde Python.
 *
 * Protocolo CSV:
 *   t_ms,raw_mv,filt_mv,rms_mv,mav_mv,zcr,wl,level,conf\n
 *
 * Protocolo binario (10 bytes/muestra a 1000 Hz = 80 kbps):
 *   [0xAA][t_hi][t_lo][raw_hi][raw_lo][filt_hi][filt_lo][rms_hi][rms_lo][lvl]
 */
class EMGSerialStreamer {
public:
    EMGSerialStreamer(IRONSYNC_EMG& emg, HardwareSerial& serial = Serial);

    /** Inicia el streaming a la velocidad de baudios indicada */
    void begin(uint32_t baud = 115200);

    /** Envia una muestra. Llamar en cada ciclo de muestreo */
    void stream(EMGOutputFormat fmt = EMG_OUTPUT_CSV);

    /** Activa o desactiva el streaming */
    void setEnabled(bool enabled);

    /** Devuelve el numero de muestras enviadas */
    uint32_t getSampleCount() const;

    /** Envia una trama de sincronizacion para el receptor Python */
    void sendSync();

private:
    IRONSYNC_EMG&    _emg;
    HardwareSerial&  _serial;
    bool             _enabled;
    uint32_t         _count;

    void _streamCSV();
    void _streamBinary();
};


// ─── CLASE DE CALIBRACION GUIADA ─────────────────────────────

/**
 * Gestiona el protocolo de calibracion MVC en modo no bloqueante.
 * Muestra instrucciones por Serial y usa LEDs opcionales como feedback.
 *
 * Protocolo de 3 niveles:
 *  REPOSO    (3s)  -> medir noise floor
 *  BAJO      (3s)  -> contraccion leve ~20% MVC
 *  MEDIO     (3s)  -> contraccion media ~50% MVC
 *  ALTO      (3s)  -> contraccion maxima 100% MVC
 *
 * Repite 3 veces cada nivel y promedia los RMS.
 */
class EMGCalibrator {
public:
    /**
     * @param emg      instancia del sensor
     * @param led_pin  pin del LED de feedback (-1 = sin LED)
     */
    EMGCalibrator(IRONSYNC_EMG& emg, int8_t led_pin = -1);

    /** Inicia la calibracion */
    void start();

    /** Avanza la calibracion (llamar en loop()) */
    void tick();

    /** true si la calibracion termino (exitosa o con error) */
    bool isDone() const;

    /** true si la ultima calibracion fue exitosa */
    bool wasSuccessful() const;

    /** Devuelve el perfil generado */
    EMGUserProfile getProfile() const;

    /** Porcentaje de progreso de la calibracion (0-100) */
    uint8_t getProgress() const;

    /** Mensaje de estado actual para mostrar en Serial o display */
    const char* getStatusMessage() const;

    /** Serializa el perfil a formato JSON en el buffer dado */
    void profileToJSON(char* buf, size_t buf_size) const;

private:
    IRONSYNC_EMG& _emg;
    int8_t        _led_pin;
    EMGCalibState _state;
    uint8_t       _level;
    uint8_t       _rep;
    uint32_t      _timer;
    bool          _done;
    bool          _success;
    EMGUserProfile _profile;
    float         _accum[4];
    uint16_t      _accum_n[4];
    uint8_t       _progress;
    char          _msg[64];

    void _nextState();
    void _blinkLED(uint8_t times, uint16_t interval_ms);
    void _computeProfile();
    bool _validateProfile();
};

#endif // IRONSYNC_EMG_H
