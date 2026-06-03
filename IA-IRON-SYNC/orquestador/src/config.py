"""
Configuración del Orquestador Multimodal IRON-SYNC
Define movimientos, hiperparámetros y mapeo de señales
"""
from dataclasses import dataclass
from typing import Dict, List, Tuple


@dataclass
class MovementConfig:
    """Configuración de un movimiento específico"""
    name: str
    label_es: str
    description: str
    # Condiciones de activación (rangos normalizados 0-1)
    imu_energy_range: Tuple[float, float]  # Energía cinética de IMU
    emg_intensity_range: Tuple[float, float]  # Intensidad muscular (0=BAJA, 1=MEDIA, 2=ALTA)
    ecg_stress_range: Tuple[float, float]  # Nivel de estrés (0=CALMA, 1=TENSION, 2=ESTRES)
    # Huesos principales involucrados
    primary_bones: List[str]
    # Duración típica en frames
    duration_frames: int
    # Probabilidad de transición desde IDLE
    transition_weight: float


# Catálogo de movimientos soportados
MOVEMENTS: Dict[str, MovementConfig] = {
    "IDLE": MovementConfig(
        name="IDLE",
        label_es="REPOSO",
        description="Estado de reposo, sin movimiento significativo",
        imu_energy_range=(0.0, 0.1),
        emg_intensity_range=(0.0, 0.5),
        ecg_stress_range=(0.0, 0.5),
        primary_bones=["hip", "chest", "head"],
        duration_frames=100,
        transition_weight=1.0
    ),
    "WALK": MovementConfig(
        name="WALK",
        label_es="CAMINAR",
        description="Caminata normal con balanceo de brazos y piernas",
        imu_energy_range=(0.2, 0.5),
        emg_intensity_range=(0.5, 1.5),
        ecg_stress_range=(0.0, 1.0),
        primary_bones=["tL", "tR", "knL", "knR", "ftL", "ftR", "sL", "sR"],
        duration_frames=60,
        transition_weight=0.8
    ),
    "RUN": MovementConfig(
        name="RUN",
        label_es="CORRER",
        description="Carrera con alta energía cinética y muscular",
        imu_energy_range=(0.6, 1.0),
        emg_intensity_range=(1.5, 2.0),
        ecg_stress_range=(1.0, 2.0),
        primary_bones=["tL", "tR", "knL", "knR", "ftL", "ftR", "sL", "sR", "fL", "fR"],
        duration_frames=40,
        transition_weight=0.6
    ),
    "JUMP": MovementConfig(
        name="JUMP",
        label_es="SALTAR",
        description="Salto vertical con extensión de piernas",
        imu_energy_range=(0.7, 1.0),
        emg_intensity_range=(1.8, 2.0),
        ecg_stress_range=(0.5, 1.5),
        primary_bones=["tL", "tR", "knL", "knR", "ftL", "ftR", "hip"],
        duration_frames=20,
        transition_weight=0.4
    ),
    "CROUCH": MovementConfig(
        name="CROUCH",
        label_es="AGACHARSE",
        description="Agacharse flexionando rodillas y cadera",
        imu_energy_range=(0.1, 0.3),
        emg_intensity_range=(1.0, 1.8),
        ecg_stress_range=(0.0, 1.0),
        primary_bones=["hip", "tL", "tR", "knL", "knR"],
        duration_frames=30,
        transition_weight=0.5
    ),
    "PUNCH_RIGHT": MovementConfig(
        name="PUNCH_RIGHT",
        label_es="GOLPE_DERECHA",
        description="Golpe con brazo derecho, alta intensidad EMG",
        imu_energy_range=(0.5, 0.9),
        emg_intensity_range=(1.5, 2.0),
        ecg_stress_range=(1.0, 2.0),
        primary_bones=["sR", "fR", "hR", "chest"],
        duration_frames=15,
        transition_weight=0.3
    ),
    "PUNCH_LEFT": MovementConfig(
        name="PUNCH_LEFT",
        label_es="GOLPE_IZQUIERDA",
        description="Golpe con brazo izquierdo, alta intensidad EMG",
        imu_energy_range=(0.5, 0.9),
        emg_intensity_range=(1.5, 2.0),
        ecg_stress_range=(1.0, 2.0),
        primary_bones=["sL", "fL", "hL", "chest"],
        duration_frames=15,
        transition_weight=0.3
    ),
    "KICK_RIGHT": MovementConfig(
        name="KICK_RIGHT",
        label_es="PATADA_DERECHA",
        description="Patada con pierna derecha",
        imu_energy_range=(0.6, 1.0),
        emg_intensity_range=(1.5, 2.0),
        ecg_stress_range=(0.8, 1.8),
        primary_bones=["tR", "knR", "ftR", "hip"],
        duration_frames=20,
        transition_weight=0.3
    ),
    "KICK_LEFT": MovementConfig(
        name="KICK_LEFT",
        label_es="PATADA_IZQUIERDA",
        description="Patada con pierna izquierda",
        imu_energy_range=(0.6, 1.0),
        emg_intensity_range=(1.5, 2.0),
        ecg_stress_range=(0.8, 1.8),
        primary_bones=["tL", "knL", "ftL", "hip"],
        duration_frames=20,
        transition_weight=0.3
    ),
    "BLOCK": MovementConfig(
        name="BLOCK",
        label_es="BLOQUEAR",
        description="Posición defensiva con brazos cruzados",
        imu_energy_range=(0.1, 0.3),
        emg_intensity_range=(1.2, 1.8),
        ecg_stress_range=(1.0, 2.0),
        primary_bones=["sL", "sR", "fL", "fR", "hL", "hR", "chest"],
        duration_frames=25,
        transition_weight=0.4
    ),
    "WAVE": MovementConfig(
        name="WAVE",
        label_es="SALUDAR",
        description="Saludo con movimiento de mano",
        imu_energy_range=(0.2, 0.4),
        emg_intensity_range=(0.8, 1.2),
        ecg_stress_range=(0.0, 0.5),
        primary_bones=["sR", "fR", "hR"],
        duration_frames=30,
        transition_weight=0.5
    ),
    "SHOOT": MovementConfig(
        name="SHOOT",
        label_es="DISPARAR",
        description="Postura de disparo con brazo extendido",
        imu_energy_range=(0.1, 0.3),
        emg_intensity_range=(1.0, 1.5),
        ecg_stress_range=(1.5, 2.0),
        primary_bones=["sR", "fR", "hR", "chest", "head"],
        duration_frames=20,
        transition_weight=0.3
    ),
    "FLY": MovementConfig(
        name="FLY",
        label_es="VOLAR",
        description="Movimiento de vuelo con brazos extendidos",
        imu_energy_range=(0.4, 0.8),
        emg_intensity_range=(1.2, 1.8),
        ecg_stress_range=(0.5, 1.5),
        primary_bones=["sL", "sR", "fL", "fR", "hL", "hR", "chest"],
        duration_frames=50,
        transition_weight=0.4
    ),
}

# Lista de movimientos para indexing
MOVEMENT_NAMES = list(MOVEMENTS.keys())
MOVEMENT_LABELS_ES = [MOVEMENTS[m].label_es for m in MOVEMENT_NAMES]
NUM_MOVEMENTS = len(MOVEMENT_NAMES)


@dataclass
class OrquestadorConfig:
    """Hiperparámetros del orquestador"""
    # Dimensiones de entrada
    imu_features_dim: int = 45  # 15 sensores × 3 ejes (rx, ry, rz)
    emg_dim: int = 3  # One-hot: BAJA, MEDIA, ALTA
    ecg_dim: int = 3  # One-hot: CALMA, TENSION, ESTRES
    context_dim: int = 10  # Features de contexto (energía, velocidad, etc.)
    
    # Arquitectura del modelo
    hidden_dim: int = 256
    num_layers: int = 4
    dropout: float = 0.3
    use_attention: bool = True
    
    # Entrenamiento
    batch_size: int = 128
    epochs: int = 100
    learning_rate: float = 1e-3
    weight_decay: float = 1e-4
    patience: int = 15
    
    # Dataset
    train_samples: int = 50000
    val_samples: int = 10000
    test_samples: int = 10000
    
    # Target metrics
    target_accuracy: float = 0.85
    target_f1: float = 0.80
    
    seed: int = 42


# Configuración por defecto
DEFAULT_CONFIG = OrquestadorConfig()


def get_movement_index(movement_name: str) -> int:
    """Obtiene el índice de un movimiento por su nombre"""
    return MOVEMENT_NAMES.index(movement_name)


def get_movement_name(index: int) -> str:
    """Obtiene el nombre de un movimiento por su índice"""
    return MOVEMENT_NAMES[index]


def get_movement_label_es(index: int) -> str:
    """Obtiene la etiqueta en español de un movimiento por su índice"""
    return MOVEMENT_LABELS_ES[index]
