/*
 * ============================================================
 *  IRON-SYNC EMG Library — Implementacion
 *  IRONSYNC_EMG.cpp
 * ============================================================
 */

#include "IRONSYNC_EMG.h"

// ─── CONSTANTES INTERNAS ──────────────────────────────────────
static const float TWO_PI_F = 2.0f * 3.14159265358979f;

// ─── CONSTRUCTOR ──────────────────────────────────────────────

IRONSYNC_EMG::IRONSYNC_EMG(uint8_t pin,
                             uint8_t  adc_bits,
                             float    vref,
                             EMGNotchType notch)
    : _pin(pin),
      _adc_bits(adc_bits),
      _vref(vref),
      _notch_type(notch),
      _adaptive_mode(false),
      _buf_head(0),
      _buf_count(0),
      _last_raw_mv(0.0f),
      _last_filtered(0.0f),
      _last_rms(0.0f),
      _last_mav(0.0f),
      _confidence(0.0f),
      _sample_count(0),
      _env_sum_sq(0.0f),
      _env_idx(0),
      _env_win(50),
      _ema_rms(0.0f),
      _ema_fast(0.0f),
      _calib_state(EMG_CALIB_IDLE),
      _calib_level_idx(0),
      _calib_rep_idx(0),
      _calib_timer(0),
      _cb_state_change(nullptr),
      _cb_calib_complete(nullptr)
{
    // Calcular max ADC segun bits
    _adc_max = (float)((1 << _adc_bits) - 1);

    // Inicializar buffers a cero
    memset(_buf,         0, sizeof(_buf));
    memset(_env_buf,     0, sizeof(_env_buf));
    memset(_calib_accum, 0, sizeof(_calib_accum));
    memset(_calib_accum_n, 0, sizeof(_calib_accum_n));

    // Inicializar estados de filtros
    _bp_x1s1 = _bp_x2s1 = _bp_y1s1 = _bp_y2s1 = 0.0f;
    _bp_x1s2 = _bp_x2s2 = _bp_y1s2 = _bp_y2s2 = 0.0f;
    _notch_x1 = _notch_x2 = _notch_y1 = _notch_y2 = 0.0f;

    // Perfil por defecto (sin calibrar)
    _profile = {0.0f, 0.1f, 0.3f, 0.8f, 0.05f, 0.0f,
                _adc_bits, _vref, false, 0};
}

// ─── INICIALIZACION ───────────────────────────────────────────

void IRONSYNC_EMG::begin() {
    pinMode(_pin, INPUT);

#ifdef ESP32
    analogReadResolution(_adc_bits);
    analogSetAttenuation(ADC_11db); // Rango completo 0-3.3V
#endif

    _computeBandpassCoefficients();

    float notch_freq = (_notch_type == EMG_NOTCH_50HZ)
                       ? EMG_NOTCH_FREQ_50HZ
                       : EMG_NOTCH_FREQ_60HZ;
    _computeNotchCoefficients(notch_freq);

    Serial.print(F("[IRONSYNC_EMG] v"));
    Serial.print(IRONSYNC_EMG_VERSION);
    Serial.print(F("  pin=A"));
    Serial.print(_pin);
    Serial.print(F("  ADC="));
    Serial.print(_adc_bits);
    Serial.print(F("bit  Vref="));
    Serial.print(_vref, 1);
    Serial.print(F("V  Notch="));
    Serial.print(notch_freq, 0);
    Serial.println(F("Hz"));
}

void IRONSYNC_EMG::setADCResolution(uint8_t bits) {
    _adc_bits = bits;
    _adc_max  = (float)((1 << bits) - 1);
#ifdef ESP32
    analogReadResolution(bits);
#endif
}

// ─── LECTURA Y FILTRADO ───────────────────────────────────────

float IRONSYNC_EMG::sample() {
    float raw  = readRawMV();
    float bp   = applyBandpass(raw);
    float filt = applyNotch(bp);

    _last_raw_mv   = raw;
    _last_filtered = filt;
    _last_rms      = rmsEnvelope(filt, 50);

    // EMA lenta para deteccion de reposo
    _ema_rms  = EMG_EMA_ALPHA      * _last_rms + (1.0f - EMG_EMA_ALPHA)      * _ema_rms;
    _ema_fast = EMG_EMA_ALPHA_FAST * _last_rms + (1.0f - EMG_EMA_ALPHA_FAST) * _ema_fast;

    _pushBuffer(filt);
    _sample_count++;

    return filt;
}

float IRONSYNC_EMG::readRawMV() {
    int raw_adc = analogRead(_pin);
    return adcToMV(raw_adc);
}

float IRONSYNC_EMG::adcToMV(int raw_adc) const {
    return (float)raw_adc / _adc_max * _vref * 1000.0f;
}

// ─── FILTRO BUTTERWORTH PASA-BANDA (IIR orden 4) ─────────────
/*
 * Implementado como dos secciones biquad en cascada.
 * Seccion 1: pasa-alto  fc = 20  Hz (elimina linea base)
 * Seccion 2: pasa-bajo  fc = 450 Hz (elimina ruido HF)
 *
 * Calculo de coeficientes Butterworth orden 2 por seccion:
 *   omega = 2*pi*fc/Fs
 *   cos_w = cos(omega)
 *   sin_w = sin(omega)
 *   alpha = sin_w / (2*Q)   ; Q=0.7071 para Butterworth
 *
 * Para pasa-alto (HPF):
 *   b0 =  (1 + cos_w) / 2
 *   b1 = -(1 + cos_w)
 *   b2 =  (1 + cos_w) / 2
 *   a0 =   1 + alpha
 *   a1 =  -2 * cos_w
 *   a2 =   1 - alpha
 *
 * Para pasa-bajo (LPF):
 *   b0 = (1 - cos_w) / 2
 *   b1 =  1 - cos_w
 *   b2 = (1 - cos_w) / 2
 */
void IRONSYNC_EMG::_computeBandpassCoefficients() {
    const float Fs = (float)EMG_SAMPLE_RATE_HZ;
    const float Q  = 0.7071f; // Butterworth

    // --- Seccion 1: pasa-alto a 20 Hz ---
    {
        float fc    = EMG_FILTER_LOWCUT_HZ;
        float omega = TWO_PI_F * fc / Fs;
        float cos_w = cosf(omega);
        float sin_w = sinf(omega);
        float alpha = sin_w / (2.0f * Q);
        float a0    = 1.0f + alpha;

        _bp_b0s1 =  (1.0f + cos_w) / 2.0f / a0;
        _bp_b1s1 = -(1.0f + cos_w)         / a0;
        _bp_b2s1 =  (1.0f + cos_w) / 2.0f / a0;
        _bp_a1s1 = -2.0f * cos_w           / a0;
        _bp_a2s1 =  (1.0f - alpha)         / a0;
    }

    // --- Seccion 2: pasa-bajo a 450 Hz ---
    {
        float fc    = EMG_FILTER_HIGHCUT_HZ;
        float omega = TWO_PI_F * fc / Fs;
        float cos_w = cosf(omega);
        float sin_w = sinf(omega);
        float alpha = sin_w / (2.0f * Q);
        float a0    = 1.0f + alpha;

        _bp_b0s2 =  (1.0f - cos_w) / 2.0f / a0;
        _bp_b1s2 =  (1.0f - cos_w)         / a0;
        _bp_b2s2 =  (1.0f - cos_w) / 2.0f / a0;
        _bp_a1s2 = -2.0f * cos_w           / a0;
        _bp_a2s2 =  (1.0f - alpha)         / a0;
    }
}

float IRONSYNC_EMG::applyBandpass(float x) {
    // Pasa-alto (seccion 1)
    float y1 = _biquad(x,
                       _bp_b0s1, _bp_b1s1, _bp_b2s1,
                       _bp_a1s1, _bp_a2s1,
                       _bp_x1s1, _bp_x2s1,
                       _bp_y1s1, _bp_y2s1);
    // Pasa-bajo (seccion 2) en cascada
    return _biquad(y1,
                   _bp_b0s2, _bp_b1s2, _bp_b2s2,
                   _bp_a1s2, _bp_a2s2,
                   _bp_x1s2, _bp_x2s2,
                   _bp_y1s2, _bp_y2s2);
}

// ─── FILTRO NOTCH (IIR) ───────────────────────────────────────
/*
 * Notch IIR de orden 2. Atenua la frecuencia de red electrica.
 *
 *   omega0 = 2*pi*f0/Fs
 *   alpha  = sin(omega0) / (2*Q)   ; Q alto = notch estrecho
 *
 *   b0 =  1
 *   b1 = -2 * cos(omega0)
 *   b2 =  1
 *   a0 =  1 + alpha
 *   a1 = -2 * cos(omega0)
 *   a2 =  1 - alpha
 */
void IRONSYNC_EMG::_computeNotchCoefficients(float freq_hz) {
    float omega = TWO_PI_F * freq_hz / (float)EMG_SAMPLE_RATE_HZ;
    float cos_w = cosf(omega);
    float sin_w = sinf(omega);
    float alpha = sin_w / (2.0f * EMG_NOTCH_Q);
    float a0    = 1.0f + alpha;

    _notch_b0 =  1.0f         / a0;
    _notch_b1 = -2.0f * cos_w / a0;
    _notch_b2 =  1.0f         / a0;
    _notch_a1 = -2.0f * cos_w / a0;
    _notch_a2 =  (1.0f - alpha) / a0;
}

float IRONSYNC_EMG::applyNotch(float x) {
    return _biquad(x,
                   _notch_b0, _notch_b1, _notch_b2,
                   _notch_a1, _notch_a2,
                   _notch_x1, _notch_x2,
                   _notch_y1, _notch_y2);
}

// ─── BIQUAD IIR (Direct Form II Transpuesta) ─────────────────
/*
 * Forma transpuesta (numericamente mas estable que forma directa):
 *   y[n] = b0*x[n] + w1[n-1]
 *   w1[n] = b1*x[n] - a1*y[n] + w2[n-1]
 *   w2[n] = b2*x[n] - a2*y[n]
 *
 * Aqui usamos variables x1/x2 como estados internos (w1, w2).
 */
float IRONSYNC_EMG::_biquad(float x,
                              float b0, float b1, float b2,
                              float a1, float a2,
                              float& x1, float& x2,
                              float& y1, float& y2)
{
    // Suprimir advertencias de parametros no usados en Direct Form II
    (void)y1; (void)y2;

    float y = b0 * x + x1;
    x1 = b1 * x - a1 * y + x2;
    x2 = b2 * x - a2 * y;
    return y;
}

// ─── ENVOLVENTE RMS MOVIL ─────────────────────────────────────

float IRONSYNC_EMG::rmsEnvelope(float x, uint16_t win_size) {
    if (win_size > 100) win_size = 100;

    // Restar muestra antigua y agregar nueva al buffer circular
    float old_val = _env_buf[_env_idx];
    _env_sum_sq  -= old_val * old_val;
    _env_sum_sq  += x * x;
    _env_buf[_env_idx] = x;
    _env_idx = (_env_idx + 1) % win_size;

    float sum = _env_sum_sq;
    if (sum < 0.0f) sum = 0.0f; // evitar NaN por errores flotantes

    return sqrtf(sum / (float)win_size);
}

// ─── FEATURES ─────────────────────────────────────────────────

EMGFeatures IRONSYNC_EMG::computeFeatures() {
    EMGFeatures f;
    memset(&f, 0, sizeof(f));
    f.timestamp = millis();

    if (_buf_count < EMG_WINDOW_SIZE) {
        f.valid = false;
        return f;
    }

    float win[EMG_WINDOW_SIZE];
    _copyWindow(win, EMG_WINDOW_SIZE);

    f.rms  = computeRMS(win,  EMG_WINDOW_SIZE);
    f.mav  = computeMAV(win,  EMG_WINDOW_SIZE);
    f.zcr  = computeZCR(win,  EMG_WINDOW_SIZE);
    f.wl   = computeWL(win,   EMG_WINDOW_SIZE);
    f.var  = computeVariance(win, EMG_WINDOW_SIZE);
    f.iemg = f.mav * (float)EMG_WINDOW_SIZE / (float)EMG_SAMPLE_RATE_HZ;
    f.valid = true;

    _last_rms = f.rms;
    _last_mav = f.mav;

    return f;
}

float IRONSYNC_EMG::computeRMS(const float* w, uint16_t n) {
    float sum = 0.0f;
    for (uint16_t i = 0; i < n; i++) sum += w[i] * w[i];
    return sqrtf(sum / (float)n);
}

float IRONSYNC_EMG::computeMAV(const float* w, uint16_t n) {
    float sum = 0.0f;
    for (uint16_t i = 0; i < n; i++) sum += fabsf(w[i]);
    return sum / (float)n;
}

float IRONSYNC_EMG::computeZCR(const float* w, uint16_t n) {
    uint16_t count = 0;
    for (uint16_t i = 1; i < n; i++) {
        if ((w[i] >= 0.0f) != (w[i-1] >= 0.0f)) count++;
    }
    // Normalizar a cruces por segundo
    return (float)count * (float)EMG_SAMPLE_RATE_HZ / (float)n;
}

float IRONSYNC_EMG::computeWL(const float* w, uint16_t n) {
    float sum = 0.0f;
    for (uint16_t i = 1; i < n; i++) sum += fabsf(w[i] - w[i-1]);
    return sum;
}

float IRONSYNC_EMG::computeVariance(const float* w, uint16_t n) {
    float mean = 0.0f;
    for (uint16_t i = 0; i < n; i++) mean += w[i];
    mean /= (float)n;
    float var = 0.0f;
    for (uint16_t i = 0; i < n; i++) {
        float d = w[i] - mean;
        var += d * d;
    }
    return var / (float)(n - 1);
}

// ─── CLASIFICACION ────────────────────────────────────────────

EMGLevel IRONSYNC_EMG::classify() {
    return classifyWithProfile(_last_rms, _profile);
}

EMGLevel IRONSYNC_EMG::classifyWithProfile(float rms,
                                            const EMGUserProfile& p) {
    if (!p.calibrated) {
        // Sin calibracion: umbrales fijos basicos
        if (rms < 50.0f)  return EMG_LEVEL_IDLE;
        if (rms < 150.0f) return EMG_LEVEL_LOW;
        if (rms < 350.0f) return EMG_LEVEL_MID;
        return EMG_LEVEL_HIGH;
    }

    if (rms <= p.noise_floor) {
        _confidence = 95.0f;
        return EMG_LEVEL_IDLE;
    }
    if (rms < p.rms_low) {
        _confidence = 70.0f + 25.0f * (rms - p.noise_floor) /
                               (p.rms_low - p.noise_floor);
        return EMG_LEVEL_IDLE;
    }
    if (rms < p.rms_mid) {
        _confidence = 75.0f + 20.0f * (rms - p.rms_low) /
                               (p.rms_mid - p.rms_low);
        return EMG_LEVEL_LOW;
    }
    if (rms < p.rms_high) {
        _confidence = 80.0f + 15.0f * (rms - p.rms_mid) /
                               (p.rms_high - p.rms_mid);
        return EMG_LEVEL_MID;
    }
    _confidence = 90.0f;
    return EMG_LEVEL_HIGH;
}

float IRONSYNC_EMG::getConfidence() {
    return _confidence;
}

float IRONSYNC_EMG::_normalizeRMS(float rms) const {
    if (!_profile.calibrated || _profile.rms_high <= 0.0f) return 0.0f;
    float norm = (rms - _profile.noise_floor) /
                 (_profile.rms_high - _profile.noise_floor);
    if (norm < 0.0f) norm = 0.0f;
    if (norm > 1.0f) norm = 1.0f;
    return norm;
}

const char* IRONSYNC_EMG::levelToString(EMGLevel lvl) {
    switch (lvl) {
        case EMG_LEVEL_IDLE: return "IDLE";
        case EMG_LEVEL_LOW:  return "LOW";
        case EMG_LEVEL_MID:  return "MID";
        case EMG_LEVEL_HIGH: return "HIGH";
        default:             return "UNKNOWN";
    }
}

// ─── CALIBRACION ──────────────────────────────────────────────

bool IRONSYNC_EMG::runCalibration(bool verbose) {
    const uint8_t REPS     = EMG_CALIB_REPS;
    const uint32_t DUR_MS  = EMG_CALIB_DURATION_MS;
    const uint32_t REST_MS = EMG_CALIB_REST_MS;

    struct { const char* name; float* target; } levels[] = {
        { "REPOSO", &_profile.rms_rest  },
        { "BAJA",   &_profile.rms_low   },
        { "MEDIA",  &_profile.rms_mid   },
        { "ALTA",   &_profile.rms_high  }
    };

    if (verbose) {
        Serial.println(F("\n============================="));
        Serial.println(F(" CALIBRACION IRON-SYNC EMG"));
        Serial.println(F("============================="));
        Serial.println(F(" Coloca el sensor en el antebrazo."));
        Serial.println(F(" Sigue las instrucciones en pantalla."));
    }

    float accum[4] = {0};
    uint16_t accum_n[4] = {0};

    for (uint8_t lvl = 0; lvl < 4; lvl++) {
        for (uint8_t rep = 0; rep < REPS; rep++) {
            if (verbose) {
                Serial.print(F("\n["));
                Serial.print(levels[lvl].name);
                Serial.print(F("] Rep "));
                Serial.print(rep + 1);
                Serial.print(F("/"));
                Serial.print(REPS);
                if (lvl == 0)
                    Serial.println(F(" -> Relajate completamente..."));
                else {
                    Serial.print(F(" -> Contraccion "));
                    Serial.print(levels[lvl].name);
                    Serial.println(F(" en 3s..."));
                }
            }

            // Cuenta regresiva 3s
            for (int8_t cd = 3; cd > 0; cd--) {
                if (verbose) {
                    Serial.print(cd);
                    Serial.print(F("..."));
                }
                delay(1000);
            }
            if (verbose) Serial.println(F(" AHORA!"));

            // Recolectar muestras
            uint32_t t_end = millis() + DUR_MS;
            while (millis() < t_end) {
                float s = sample();
                accum[lvl]   += _last_rms;
                accum_n[lvl]++;
                delayMicroseconds(1000); // ~1000 Hz
            }

            // Descanso
            if (rep < REPS - 1) {
                if (verbose) Serial.print(F("  Descansando..."));
                delay(REST_MS);
            }
        }

        // Promedio del nivel
        if (accum_n[lvl] > 0)
            *levels[lvl].target = accum[lvl] / (float)accum_n[lvl];
    }

    // Calcular noise floor = rest + margen
    _profile.noise_floor = _profile.rms_rest * 1.5f;
    _profile.snr = (_profile.rms_high > 0.0f)
                   ? 20.0f * log10f(_profile.rms_high / _profile.rms_rest)
                   : 0.0f;
    _profile.adc_bits   = _adc_bits;
    _profile.vref       = _vref;
    _profile.calib_time = millis();

    // Validacion
    bool ok = (_profile.rms_rest < _profile.rms_low)  &&
              (_profile.rms_low  < _profile.rms_mid)  &&
              (_profile.rms_mid  < _profile.rms_high) &&
              (_profile.snr > 6.0f);

    _profile.calibrated = ok;

    if (verbose) {
        Serial.println(F("\n--- Resultado de Calibracion ---"));
        printProfile();
        if (ok)
            Serial.println(F("[OK] Calibracion exitosa."));
        else
            Serial.println(F("[ERROR] Calibracion fallida. Verifica el sensor."));
    }

    return ok;
}

void IRONSYNC_EMG::loadProfile(const EMGUserProfile& p) {
    _profile = p;
}

EMGUserProfile IRONSYNC_EMG::getProfile() const {
    return _profile;
}

void IRONSYNC_EMG::resetProfile() {
    _profile = {0.0f, 0.1f, 0.3f, 0.8f, 0.05f, 0.0f,
                _adc_bits, _vref, false, 0};
}

// ─── UMBRAL ADAPTATIVO ────────────────────────────────────────

void IRONSYNC_EMG::updateAdaptiveThresholds(float current_rms_rest) {
    if (!_profile.calibrated) return;

    float old_rest = _profile.rms_rest;
    _profile.rms_rest = EMG_EMA_ALPHA * current_rms_rest
                       + (1.0f - EMG_EMA_ALPHA) * old_rest;

    float drift = _profile.rms_rest / old_rest;
    _profile.rms_low   *= drift;
    _profile.rms_mid   *= drift;
    _profile.rms_high  *= drift;
    _profile.noise_floor = _profile.rms_rest * 1.5f;
}

void IRONSYNC_EMG::setAdaptiveMode(bool enabled) {
    _adaptive_mode = enabled;
}

// ─── BUFFER CIRCULAR ──────────────────────────────────────────

void IRONSYNC_EMG::_pushBuffer(float val) {
    _buf[_buf_head] = val;
    _buf_head = (_buf_head + 1) & (EMG_BUFFER_SIZE - 1);
    if (_buf_count < EMG_BUFFER_SIZE) _buf_count++;
}

void IRONSYNC_EMG::_copyWindow(float* dst, uint16_t n) {
    uint16_t start = (_buf_head + EMG_BUFFER_SIZE - n) & (EMG_BUFFER_SIZE - 1);
    for (uint16_t i = 0; i < n; i++) {
        dst[i] = _buf[(start + i) & (EMG_BUFFER_SIZE - 1)];
    }
}

void IRONSYNC_EMG::getWindow(float* out) {
    _copyWindow(out, EMG_WINDOW_SIZE);
}

uint16_t IRONSYNC_EMG::available() const {
    return _buf_count;
}

void IRONSYNC_EMG::flushBuffer() {
    memset(_buf, 0, sizeof(_buf));
    _buf_head  = 0;
    _buf_count = 0;
}

// ─── SALIDA SERIAL ────────────────────────────────────────────

void IRONSYNC_EMG::printSerial(EMGOutputFormat fmt, bool raw) {
    EMGLevel lvl = classify();

    if (fmt == EMG_OUTPUT_CSV) {
        Serial.print(millis());
        Serial.print(',');
        if (raw) {
            Serial.print(_last_raw_mv, 3);
            Serial.print(',');
        }
        Serial.print(_last_filtered, 3);
        Serial.print(',');
        Serial.print(_last_rms, 3);
        Serial.print(',');
        Serial.print(_last_mav, 3);
        Serial.print(',');
        Serial.print((uint8_t)lvl);
        Serial.print(',');
        Serial.println(_confidence, 1);
    } else {
        Serial.print(F("{\"t\":"));
        Serial.print(millis());
        if (raw) {
            Serial.print(F(",\"raw\":"));
            Serial.print(_last_raw_mv, 3);
        }
        Serial.print(F(",\"f\":"));
        Serial.print(_last_filtered, 3);
        Serial.print(F(",\"rms\":"));
        Serial.print(_last_rms, 3);
        Serial.print(F(",\"lvl\":"));
        Serial.print((uint8_t)lvl);
        Serial.print(F(",\"conf\":"));
        Serial.print(_confidence, 1);
        Serial.println(F("}"));
    }
}

void IRONSYNC_EMG::printProfile() {
    Serial.println(F("--- Perfil de Usuario EMG ---"));
    Serial.print(F("  Calibrado   : ")); Serial.println(_profile.calibrated ? F("SI") : F("NO"));
    Serial.print(F("  RMS Reposo  : ")); Serial.print(_profile.rms_rest,  3); Serial.println(F(" mV"));
    Serial.print(F("  RMS Bajo    : ")); Serial.print(_profile.rms_low,   3); Serial.println(F(" mV"));
    Serial.print(F("  RMS Medio   : ")); Serial.print(_profile.rms_mid,   3); Serial.println(F(" mV"));
    Serial.print(F("  RMS Alto    : ")); Serial.print(_profile.rms_high,  3); Serial.println(F(" mV"));
    Serial.print(F("  Noise Floor : ")); Serial.print(_profile.noise_floor, 3); Serial.println(F(" mV"));
    Serial.print(F("  SNR         : ")); Serial.print(_profile.snr, 1); Serial.println(F(" dB"));
    Serial.print(F("  ADC bits    : ")); Serial.println(_profile.adc_bits);
    Serial.print(F("  Vref        : ")); Serial.print(_profile.vref, 1); Serial.println(F(" V"));
}

void IRONSYNC_EMG::printFeatures() {
    EMGFeatures f = computeFeatures();
    if (!f.valid) {
        Serial.println(F("[EMG] Buffer incompleto, esperando mas muestras..."));
        return;
    }
    Serial.println(F("--- Features EMG (ventana 200ms) ---"));
    Serial.print(F("  RMS  : ")); Serial.print(f.rms,  4); Serial.println(F(" mV"));
    Serial.print(F("  MAV  : ")); Serial.print(f.mav,  4); Serial.println(F(" mV"));
    Serial.print(F("  ZCR  : ")); Serial.print(f.zcr,  2); Serial.println(F(" cruces/s"));
    Serial.print(F("  WL   : ")); Serial.print(f.wl,   4); Serial.println(F(" mV"));
    Serial.print(F("  VAR  : ")); Serial.print(f.var,  6); Serial.println(F(" mV^2"));
    Serial.print(F("  IEMG : ")); Serial.print(f.iemg, 6); Serial.println(F(" mV*s"));
    Serial.print(F("  Nivel: ")); Serial.println(levelToString(classify()));
}

float IRONSYNC_EMG::estimateSNR() {
    if (_profile.rms_rest <= 0.0f) return 0.0f;
    return 20.0f * log10f(_last_rms / _profile.rms_rest);
}

// ─── EMGSerialStreamer ────────────────────────────────────────

EMGSerialStreamer::EMGSerialStreamer(IRONSYNC_EMG& emg, HardwareSerial& serial)
    : _emg(emg), _serial(serial), _enabled(false), _count(0) {}

void EMGSerialStreamer::begin(uint32_t baud) {
    _serial.begin(baud);
    _enabled = true;
    sendSync();
}

void EMGSerialStreamer::stream(EMGOutputFormat fmt) {
    if (!_enabled) return;
    _emg.printSerial(fmt, true);
    _count++;
}

void EMGSerialStreamer::setEnabled(bool enabled) { _enabled = enabled; }
uint32_t EMGSerialStreamer::getSampleCount() const { return _count; }

void EMGSerialStreamer::sendSync() {
    _serial.println(F("# IRON-SYNC EMG STREAM START"));
    _serial.println(F("# t_ms,raw_mV,filt_mV,rms_mV,mav_mV,level,conf"));
}

// ─── EMGCalibrator ────────────────────────────────────────────

EMGCalibrator::EMGCalibrator(IRONSYNC_EMG& emg, int8_t led_pin)
    : _emg(emg), _led_pin(led_pin),
      _state(EMG_CALIB_IDLE), _level(0), _rep(0),
      _timer(0), _done(false), _success(false), _progress(0)
{
    memset(_accum,   0, sizeof(_accum));
    memset(_accum_n, 0, sizeof(_accum_n));
    if (_led_pin >= 0) pinMode(_led_pin, OUTPUT);
}

void EMGCalibrator::start() {
    _state    = EMG_CALIB_REST;
    _level    = 0;
    _rep      = 0;
    _done     = false;
    _success  = false;
    _progress = 0;
    _timer    = millis();
    memset(_accum,   0, sizeof(_accum));
    memset(_accum_n, 0, sizeof(_accum_n));
    snprintf(_msg, sizeof(_msg), "Iniciando calibracion...");
    Serial.println(F("\n[CAL] INICIANDO CALIBRACION IRONSYNC EMG"));
}

void EMGCalibrator::tick() {
    if (_done) return;

    float s = _emg.sample();
    uint32_t now = millis();
    uint32_t elapsed = now - _timer;

    switch (_state) {
        case EMG_CALIB_REST:
            snprintf(_msg, sizeof(_msg), "REPOSO: relaja el brazo (%lus)", elapsed/1000);
            if (elapsed >= EMG_CALIB_DURATION_MS) {
                _accum[0]   += _emg.getLastRMS();
                _accum_n[0]++;
            }
            if (elapsed >= EMG_CALIB_DURATION_MS + 500) {
                if (++_rep >= EMG_CALIB_REPS) {
                    _rep = 0; _level = 1; _state = EMG_CALIB_LEVEL_LOW;
                }
                _timer = millis();
            }
            break;

        case EMG_CALIB_LEVEL_LOW:
            snprintf(_msg, sizeof(_msg), "BAJA contraccion rep %d/%d", _rep+1, EMG_CALIB_REPS);
            if (elapsed >= 500)
                _accum[1] += _emg.getLastRMS(), _accum_n[1]++;
            if (elapsed >= EMG_CALIB_DURATION_MS + 500) {
                if (++_rep >= EMG_CALIB_REPS) {
                    _rep = 0; _level = 2; _state = EMG_CALIB_LEVEL_MID;
                }
                _timer = millis();
            }
            break;

        case EMG_CALIB_LEVEL_MID:
            snprintf(_msg, sizeof(_msg), "MEDIA contraccion rep %d/%d", _rep+1, EMG_CALIB_REPS);
            if (elapsed >= 500)
                _accum[2] += _emg.getLastRMS(), _accum_n[2]++;
            if (elapsed >= EMG_CALIB_DURATION_MS + 500) {
                if (++_rep >= EMG_CALIB_REPS) {
                    _rep = 0; _level = 3; _state = EMG_CALIB_LEVEL_HIGH;
                }
                _timer = millis();
            }
            break;

        case EMG_CALIB_LEVEL_HIGH:
            snprintf(_msg, sizeof(_msg), "ALTA contraccion rep %d/%d", _rep+1, EMG_CALIB_REPS);
            if (elapsed >= 500)
                _accum[3] += _emg.getLastRMS(), _accum_n[3]++;
            if (elapsed >= EMG_CALIB_DURATION_MS + 500) {
                if (++_rep >= EMG_CALIB_REPS) {
                    _state = EMG_CALIB_DONE;
                    _computeProfile();
                }
                _timer = millis();
            }
            break;

        case EMG_CALIB_DONE:
            _success = _validateProfile();
            _done    = true;
            snprintf(_msg, sizeof(_msg), _success ? "Calibracion OK" : "Error en calibracion");
            Serial.print(F("[CAL] "));
            Serial.println(_msg);
            _emg.loadProfile(_profile);
            break;

        default: break;
    }

    // Progreso 0-100
    _progress = (uint8_t)((_level * EMG_CALIB_REPS * 100UL +
                            _rep * 100UL) /
                           (4 * EMG_CALIB_REPS));
}

void EMGCalibrator::_computeProfile() {
    for (uint8_t i = 0; i < 4; i++) {
        if (_accum_n[i] > 0)
            _accum[i] /= (float)_accum_n[i];
    }
    _profile.rms_rest    = _accum[0];
    _profile.rms_low     = _accum[1];
    _profile.rms_mid     = _accum[2];
    _profile.rms_high    = _accum[3];
    _profile.noise_floor = _accum[0] * 1.5f;
    _profile.snr         = (_accum[0] > 0.0f)
                           ? 20.0f * log10f(_accum[3] / _accum[0])
                           : 0.0f;
    _profile.calibrated  = false;
    _profile.calib_time  = millis();
}

bool EMGCalibrator::_validateProfile() {
    return (_profile.rms_rest < _profile.rms_low)  &&
           (_profile.rms_low  < _profile.rms_mid)  &&
           (_profile.rms_mid  < _profile.rms_high) &&
           (_profile.snr > 6.0f);
}

bool EMGCalibrator::isDone()          const { return _done;    }
bool EMGCalibrator::wasSuccessful()   const { return _success; }
EMGUserProfile EMGCalibrator::getProfile() const { return _profile; }
uint8_t EMGCalibrator::getProgress()  const { return _progress; }
const char* EMGCalibrator::getStatusMessage() const { return _msg; }

void EMGCalibrator::profileToJSON(char* buf, size_t sz) const {
    snprintf(buf, sz,
        "{\"calibrated\":%s,"
        "\"rms_rest\":%.3f,"
        "\"rms_low\":%.3f,"
        "\"rms_mid\":%.3f,"
        "\"rms_high\":%.3f,"
        "\"noise_floor\":%.3f,"
        "\"snr\":%.1f}",
        _profile.calibrated ? "true" : "false",
        _profile.rms_rest,
        _profile.rms_low,
        _profile.rms_mid,
        _profile.rms_high,
        _profile.noise_floor,
        _profile.snr
    );
}
