# IRON-SYNC (SIS-330)

Sistema bio-simbiotico de captura corporal y control biomecanico en tiempo real:
15 sensores MPU6050, multiplexores TCA9548A, Arduino Mega, ESP32 UDP, runtime
Python, Unreal Engine 5, senales EMG/ECG y pipeline de IA biomecanica.

## Estructura del proyecto

```text
SIS-330/
  src/ironsync_runtime/   Runtime Python de sensores, IA y Unreal
  apps/biomech-lab/       Laboratorio HTML5/Three.js para DRL biomecanico
  cuadernillos/           Notebooks, entrenamiento, reportes y checkpoints de trabajo
  dataset/                Datos ECG, EMG, IMU, SENSOR y FUSION
  models/best/            Modelos seleccionados para inferencia
  firmware/arduino/       Firmware y librerias Arduino/ESP32
  docs/
    ARCHITECTURE.md       Guia de arquitectura y reglas internas
    diagrams/             Diagramas del sistema
    documents/            Entregables y documentos academicos
  requirements.txt        Dependencias del entorno de trabajo
  pyproject.toml          Configuracion de paquete, lint y tests
```

## Pipeline de IA

1. Masked TCN Denoising Autoencoder (IMU)
2. TCN EMG
3. GRU ECG
4. MLP Fusion Orchestrator
5. Kalman Filter final

Documentacion detallada de modelos: `cuadernillos/README_AI_MODELS.md`.

## Inicio rapido

Desde la raiz del proyecto:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -e .
python -m ironsync_runtime
```

Si usas el entorno existente del proyecto:

```powershell
.\ironsync_env\Scripts\Activate.ps1
pip install -e .
python -m ironsync_runtime
```

## Laboratorio biomecánico HTML5

```powershell
cd apps\biomech-lab
npm install
npm run dev
```

El laboratorio permite cargar FBX, inspeccionar huesos, aplicar límites biomecánicos,
visualizar colisiones, calcular rewards, grabar datasets JSON y preparar integración
DRL/PPO con datos recibidos por WebSocket desde Python.

## Bridge en vivo hacia el laboratorio

Modo simulacion, util para validar el skeletal mesh sin hardware:

```powershell
python -m ironsync_runtime.websocket_bridge --simulate
```

Modo UDP real, reenviando paquetes `IS,...` recibidos desde ESP32/Mega:

```powershell
python -m ironsync_runtime.websocket_bridge --udp
```

En el laboratorio, conectar a:

```text
ws://127.0.0.1:8765
```

## Datos y modelos

| Recurso | Ubicacion | Nota |
| --- | --- | --- |
| EMG | `dataset/EMG/` | Muestras por intensidad: BAJA, MEDIA, ALTA |
| ECG | `dataset/ECG/` | Muestras por estado: CALMA, ESTRES, TENSION |
| IMU | `dataset/IMU/` | Datos sinteticos/procesados y sensores reales |
| Modelos finales | `models/best/` | Checkpoints usados por el runtime |
| Reportes IA | `cuadernillos/reports/` | Metricas y figuras de entrenamiento |

## Calidad interna

- El codigo ejecutable principal vive como paquete importable en `src/ironsync_runtime`.
- `dataset/` queda reservado para datos; los generadores viven en `IA-IRON-SYNC/` y `orquestador/`.
- Firmware, documentos y diagramas estan separados del runtime.
- Los entornos virtuales, caches y artefactos pesados quedan excluidos por `.gitignore`.
- Para validar rapidamente imports y sintaxis:

```powershell
python -m compileall src IA-IRON-SYNC
```
