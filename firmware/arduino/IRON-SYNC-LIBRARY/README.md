# IRONSYNC_EMG — Libreria Arduino para Sensor SEN0240

**Proyecto:** IRON-SYNC — UMRPSFXCH SIS-330  
**Autor:** Cervantes Torres Atzel Alan  
**Version:** 1.0.0  
**Hardware:** DFRobot Gravity EMG Sensor SEN0240  

---

## Descripcion

Libreria completa para adquisicion, filtrado, extraccion de features
y calibracion personalizada de senales EMG superficiales con el sensor
Gravity SEN0240 de DFRobot sobre Arduino UNO, Mega, Nano Every y ESP32.

El fundamento de diseno es que **cada persona tiene una firma muscular
unica** (variabilidad interpersonal). Los umbrales de contraccion no son
genericos: varian segun masa muscular, grosor de tejido subcutaneo,
posicion del electrodo e impedancia cutanea. Por ello la libreria incluye
un protocolo de calibracion MVC (Maximal Voluntary Contraction) que genera
un perfil personalizado guardado en EEPROM/NVS.

---

## Estructura de archivos

```
IRONSYNC_EMG_Library/
├── src/
│   ├── IRONSYNC_EMG.h      <- Header principal
│   └── IRONSYNC_EMG.cpp    <- Implementacion
├── examples/
│   ├── 01_RawSignal/       <- Lectura cruda del ADC
│   ├── 02_FilteredSignal/  <- Butterworth + Notch 50Hz
│   ├── 03_CalibrationProtocol/  <- Protocolo MVC completo
│   ├── 04_GestureClassifier/    <- Clasificacion IDLE/LOW/MID/HIGH
│   ├── 05_SerialStreamer/        <- Streaming para pipeline Python
│   └── 06_AdaptiveThreshold/    <- Compensacion de fatiga muscular
├── library.properties
└── README.md
```

---

## Instalacion en Arduino IDE

1. Descargar o clonar este repositorio.
2. En Arduino IDE: `Sketch > Include Library > Add .ZIP Library`
   y seleccionar la carpeta `IRONSYNC_EMG_Library`.
3. O copiar la carpeta directamente a `Documents/Arduino/libraries/`.
4. Reiniciar el IDE.
5. Los ejemplos aparecen en `File > Examples > IRONSYNC_EMG`.

---

## Conexion del sensor SEN0240

| SEN0240 | ESP32 DevKit | Arduino UNO |
|---------|-------------|-------------|
| VCC     | 3.3V        | 5V          |
| GND     | GND         | GND         |
| SIG     | GPIO34      | A0          |

**Importante ESP32:** usar GPIO34, 35, 36 o 39 (pines solo-entrada).
Configurar atenuacion ADC a 11dB para rango completo 0-3.3V.

---

## Uso basico (5 lineas)

```cpp
#include <IRONSYNC_EMG.h>

IRONSYNC_EMG emg(34, 12, 3.3f, EMG_NOTCH_50HZ);

void setup() { Serial.begin(115200); emg.begin(); }

void loop() {
    emg.sample();                            // Llamar cada 1ms
    EMGLevel lvl = emg.classify();          // IDLE/LOW/MID/HIGH
    Serial.println(IRONSYNC_EMG::levelToString(lvl));
    delay(1);
}
```

---

## Filtros implementados

### Butterworth pasa-banda (IIR orden 4)
- Corte inferior: 20 Hz (elimina deriva de linea base)
- Corte superior: 450 Hz (elimina ruido de alta frecuencia)
- Implementado como dos secciones biquad en cascada (Direct Form II)

### Notch IIR
- Frecuencia: 50 Hz (Bolivia/Europa) o 60 Hz (USA/Mexico)
- Factor Q: 35 (notch estrecho, minima distorsion de la senal)

---

## Features extraidas por ventana (200ms @ 1000Hz)

| Feature | Descripcion                        | Uso en TCN     |
|---------|------------------------------------|----------------|
| RMS     | Root Mean Square                   | Potencia senal |
| MAV     | Mean Absolute Value                | Activacion     |
| ZCR     | Zero Crossing Rate                 | Frecuencia dom.|
| WL      | Waveform Length                    | Complejidad    |
| VAR     | Varianza                           | Dispersion     |
| IEMG    | Integrated EMG                     | Energia total  |

---

## Protocolo de calibracion MVC

El ejemplo 03 guia al usuario por 4 fases:

1. **REPOSO** (3s x 3 reps): mide noise floor y RMS basal
2. **BAJA** (3s x 3 reps): contraccion ~20% del maximo
3. **MEDIA** (3s x 3 reps): contraccion ~50% del maximo
4. **ALTA** (3s x 3 reps): contraccion maxima (MVC)

El perfil generado se guarda en formato JSON:
```json
{
  "calibrated": true,
  "rms_rest": 12.345,
  "rms_low": 45.678,
  "rms_mid": 123.456,
  "rms_high": 389.012,
  "noise_floor": 18.517,
  "snr": 30.0
}
```

---

## Integracion con el pipeline Python de IRON-SYNC

El ejemplo 05 (SerialStreamer) envia datos en CSV a 1000 Hz.
El receptor Python lee el puerto serial y:
1. Acumula ventanas de 200 muestras
2. Extrae las 6 features y las guarda como `.npy`
3. En tiempo real alimenta la TCN entrenada
4. Envia el nivel clasificado al orquestador MLP de IRON-SYNC

---

## Compatibilidad

| Plataforma     | Estado   | Notas                        |
|----------------|----------|------------------------------|
| ESP32 DevKit   | OK       | ADC 12-bit, timer hardware   |
| Arduino UNO R3 | OK       | ADC 10-bit, timer software   |
| Arduino Mega   | OK       | ADC 10-bit, timer software   |
| Arduino Nano   | OK       | ADC 10-bit                   |
| ESP8266        | No probado| ADC single-channel, sin NVS |
