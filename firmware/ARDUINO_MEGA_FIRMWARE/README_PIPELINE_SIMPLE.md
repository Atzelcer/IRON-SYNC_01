# IRON-SYNC firmware para pipeline completo

Este firmware deja a las placas como capa de adquisicion. La IA no vive en el
Mega ni en el ESP32: vive en el laboratorio/Python y en los modelos TCN, PPO,
EMG, ECG, MLP Fusion y Kalman.

## Rol del Arduino Mega

- Escanea los 15 IMU por los multiplexores TCA.
- Al recibir `CAL_START`, espera la pose base, usa buzzer/LED para guiar al
  usuario y calibra solo orientacion:
  - detecta montaje del sensor por gravedad;
  - calcula offset de giroscopio;
  - toma la postura actual como cero (`zeroPitch`, `zeroRoll`, `zeroYawRate`).
- Al terminar con `CAL_OK`, arranca stream automaticamente.
- Envia datos constantes por `Serial1` al ESP32.

No clasifica acciones. No decide caminar, correr, volar ni disparar. Esas
decisiones las toma el MLP orquestador en el laboratorio.

## Rol del ESP32

- Se conecta al WiFi.
- Recibe comandos UDP desde el PC en `5006`.
- Reenvia comandos al Mega por `Serial2`.
- Reenvia al PC por UDP `5005` las lineas del Mega.
- Despues de `CAL_OK`, permite pasar datos `IS`, `ECG` y `EMG` sin bloquearlos.

El ESP32 no recalibra, no interpreta movimientos y no filtra la accion final.

## Comandos principales desde el PC

| Comando | Efecto |
| --- | --- |
| `CONNECT_HARDWARE` / `REGISTER_PC,<ip>` | Registra el PC y avisa al Mega. |
| `CAL_START` | Inicia calibracion de orientacion en el Mega. |
| `RUN_START` | Pide stream; normalmente no hace falta porque `CAL_OK` ya lo arranca. |
| `STOP` | Detiene stream. |
| `STATUS` | Consulta estado. |
| `DISCONNECT` | Cierra sesion y resetea estado visual. |

## Paquete de datos

El stream principal es una linea:

```text
IS,frame,ms,mask,activeSensors,ecgRaw,emgRaw,emgIntensity,ecgLoPlus,ecgLoMinus;TCA,ch,key,rx,ry,rz,pitch,roll,yawRate,rawAx,rawAy,rawAz,rawGx,rawGy,rawGz;...
```

Los primeros campos por sensor (`TCA,ch,key,rx,ry,rz`) se mantienen compatibles
con el parser actual del laboratorio. Los campos posteriores son extra:

- `pitch`, `roll`, `yawRate`: orientacion estimada antes del mapeo final.
- `rawAx`, `rawAy`, `rawAz`: acelerometro crudo MPU6050.
- `rawGx`, `rawGy`, `rawGz`: giroscopio crudo MPU6050.

El laboratorio puede ignorar esos extras o usarlos para TCN/PPO/Kalman.

## Configuracion clave

En `IRON_SYNC_MEGA/IronSyncConfig.h`:

- `RAW_ORIENTATION_STREAM 1`: modo streamer para el pipeline.
- `FORCE_GOLDEN_REFERENCE 0`: no fuerza tabla golden.
- `CAL_ZERO_USE_PROFILE_MIDPOINT 0`: usa la pose actual como cero.
- `QUIET_HARD_ZERO 0`: no aplasta microdatos a cero; deja al pipeline filtrar.

## Flujo recomendado

1. Encender Mega + ESP32.
2. Conectar desde el laboratorio.
3. Quedarse quieto en pose base.
4. Enviar `CAL_START`.
5. Esperar `CAL_OK` / `CALIBRATION_DONE`.
6. El Mega empieza a transmitir `IS`, `ECG`, `EMG`.
7. El laboratorio aplica TCN/PPO/EMG/ECG/MLP/Kalman y envia a Unreal:
   - `IRON_FRAME` para huesos.
   - `IRON_ACTION` para accion orquestada.

