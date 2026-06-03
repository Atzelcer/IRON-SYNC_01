# Orquestador Multimodal IRON-SYNC

Sistema de IA que combina señales **IMU** (15 sensores), **EMG** (intensidad muscular) y **ECG** (estado cardíaco) para determinar el movimiento que debe ejecutar el personaje en tiempo real.

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                    ENTRADAS MULTIMODALES                      │
├──────────────┬──────────────┬──────────────┬────────────────┤
│   IMU (45)   │   EMG (3)    │   ECG (3)    │ Contexto (10)  │
│ 15 sensores  │ BAJA/MEDIA/  │ CALMA/       │ Energía, vel., │
│ × 3 ejes     │ ALTA         │ TENSION/     │ simetría,      │
│ (sanitizado) │ (one-hot)    │ ESTRES       │ actividad...   │
│              │              │ (one-hot)    │                │
└──────┬───────┴──────┬───────┴──────┬───────┴───────┬────────┘
       │              │              │               │
       ▼              ▼              ▼               ▼
┌─────────────────────────────────────────────────────────────┐
│              ATTENTION MULTIMODAL                             │
│  Aprende qué modalidad es más importante para cada movimiento│
│  Pesos: [IMU, EMG, ECG, Contexto]                           │
└──────────────────────────┬──────────────────────────────────┘
                           │ (160 dims)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              MLP CON BLOQUES RESIDUALES                       │
│  4 capas × 256 neuronas + LayerNorm + Dropout (0.3)         │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
┌──────────────────────┐  ┌──────────────────────┐
│  CABEZA MOVIMIENTO   │  │  CABEZA EJECUCIÓN    │
│  13 clases           │  │  6 parámetros        │
│  (softmax)           │  │  (sigmoid)           │
│                      │  │  - intensidad        │
│  IDLE, WALK, RUN,   │  │  - duración          │
│  JUMP, CROUCH,      │  │  - velocidad         │
│  PUNCH_R/L, KICK_R/L│  │  - amplitud          │
│  BLOCK, WAVE,       │  │  - suavizado         │
│  SHOOT, FLY         │  │  - fuerza            │
└──────────────────────┘  └──────────────────────┘
```

## Movimientos Soportados (13)

| # | Movimiento | Español | Categoría | Huesos Principales |
|---|-----------|---------|-----------|-------------------|
| 0 | IDLE | REPOSO | base | hip, chest, head |
| 1 | WALK | CAMINAR | locomotion | piernas + brazos |
| 2 | RUN | CORRER | locomotion | piernas + brazos (rápido) |
| 3 | JUMP | SALTAR | locomotion | piernas + cadera |
| 4 | CROUCH | AGACHARSE | posture | cadera + rodillas |
| 5 | PUNCH_RIGHT | GOLPE_DERECHA | combat | brazo derecho |
| 6 | PUNCH_LEFT | GOLPE_IZQUIERDA | combat | brazo izquierdo |
| 7 | KICK_RIGHT | PATADA_DERECHA | combat | pierna derecha |
| 8 | KICK_LEFT | PATADA_IZQUIERDA | combat | pierna izquierda |
| 9 | BLOCK | BLOQUEAR | combat | ambos brazos |
| 10 | WAVE | SALUDAR | gesture | mano derecha |
| 11 | SHOOT | DISPARAR | combat | brazo derecho + cabeza |
| 12 | FLY | VOLAR | locomotion | ambos brazos |

## Estructura

```
orquestador/
├── src/
│   ├── __init__.py          # Exportaciones del paquete
│   ├── config.py            # Movimientos + hiperparámetros
│   ├── model.py             # Arquitectura (attention + MLP residual)
│   ├── data_generator.py    # Generador de datos sintéticos
│   ├── trainer.py           # Entrenador con early stopping
│   └── inference.py         # Motor de inferencia en tiempo real
├── dataset/
│   └── metadata/
│       └── movements_info.json  # Catálogo de movimientos
├── notebook/
│   └── 01_train_orquestador.ipynb  # Cuadernillo completo
├── checkpoints/             # Modelos entrenados
└── README.md
```

## Uso Rápido

### 1. Generar Dataset y Entrenar

```python
from src.config import OrquestadorConfig
from src.data_generator import generate_dataset
from src.trainer import OrquestadorTrainer
from pathlib import Path

config = OrquestadorConfig(
    train_samples=50000,
    epochs=100,
    hidden_dim=256,
    use_attention=True
)

# Generar datos sintéticos
dataset = generate_dataset(config, Path("dataset"))

# Entrenar
trainer = OrquestadorTrainer(config)
loaders = trainer.load_dataset(Path("dataset"))
results = trainer.train(loaders["train"], loaders["val"], Path("checkpoints"))

# Evaluar
trainer.test(loaders["test"], Path("checkpoints"))

# Exportar
trainer.export_model(Path("checkpoints"))
```

### 2. Inferencia en Tiempo Real

```python
from src.inference import OrquestadorInference
from pathlib import Path

# Cargar modelo
infer = OrquestadorInference(
    Path("checkpoints/BEST_ORQUESTADOR.pt"),
    smoothing_window=5,
    confidence_threshold=0.6
)

# Inferencia desde paquete IronSync
result = infer.infer_from_packet(packet, emg_label="ALTA", ecg_label="ESTRES")

print(result["movement_label_es"])  # "GOLPE_DERECHA"
print(result["confidence"])         # 0.87
print(result["is_transition"])      # True (cambió de movimiento)
```

### 3. Integración con Runtime

```python
# En src/ironsync_runtime/cmds_models/runner.py
from IA_IRON_SYNC.orquestador.src.inference import OrquestadorInference

orquestador = OrquestadorInference(Path("models/BEST_ORQUESTADOR.pt"))

# En el loop de procesamiento de cada frame:
result = orquestador.infer_from_packet(packet, emg_label, ecg_label)
movement = result["movement_label_es"]
confidence = result["confidence"]

# Enviar a Unreal
unreal.send_action(result["movement_name"], movement, confidence)
```

## Lógica de Combinación

El orquestador determina el movimiento analizando la **combinación** de señales:

| IMU Energía | EMG Intensidad | ECG Estrés | → Movimiento |
|-------------|----------------|------------|-------------|
| Baja | Baja | Calma | **REPOSO** |
| Media | Media | Calma/Tensión | **CAMINAR** |
| Alta | Alta | Tensión/Estrés | **CORRER** |
| Pico vertical | Muy alta | Media | **SALTAR** |
| Baja + brazo extendido | Alta | Estrés | **DISPARAR** |
| Pico en brazo R | Muy alta | Estrés | **GOLPE_DERECHA** |
| Pico en pierna L | Alta | Tensión | **PATADA_IZQUIERDA** |
| Media + brazos extendidos | Media | Media | **VOLAR** |
| Baja + brazos cruzados | Alta | Estrés | **BLOQUEAR** |

## Hiperparámetros

| Parámetro | Valor | Descripción |
|-----------|-------|-------------|
| `hidden_dim` | 256 | Neuronas por capa |
| `num_layers` | 4 | Bloques residuales |
| `dropout` | 0.3 | Regularización |
| `use_attention` | True | Attention multimodal |
| `batch_size` | 128 | Tamaño de lote |
| `learning_rate` | 1e-3 | AdamW |
| `patience` | 15 | Early stopping |
| `target_f1` | 0.80 | F1-score objetivo |

## Dependencias

- `torch` >= 2.0
- `numpy` >= 1.24
- `matplotlib` (visualización)
- `seaborn` (matriz de confusión)
