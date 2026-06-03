"""
Orquestador Multimodal IRON-SYNC
Clasificación de movimientos complejos basada en IMU, EMG y ECG
"""

from .config import (
    MOVEMENTS,
    MOVEMENT_NAMES,
    MOVEMENT_LABELS_ES,
    NUM_MOVEMENTS,
    MovementConfig,
    OrquestadorConfig,
    DEFAULT_CONFIG,
    get_movement_index,
    get_movement_name,
    get_movement_label_es
)

from .model import (
    OrquestadorModel,
    MultimodalAttention,
    ResidualBlock,
    create_orquestador
)

from .trainer import OrquestadorTrainer

from .inference import OrquestadorInference

from .data_generator import (
    generate_dataset,
    generate_imu_features_for_movement,
    generate_emg_features_for_movement,
    generate_ecg_features_for_movement,
    generate_context_features_for_movement,
    SENSOR_ALIASES,
    SENSOR_TO_IDX
)

__version__ = "1.0.0"
__author__ = "IRON-SYNC Team"

__all__ = [
    # Configuración
    "MOVEMENTS",
    "MOVEMENT_NAMES",
    "MOVEMENT_LABELS_ES",
    "NUM_MOVEMENTS",
    "MovementConfig",
    "OrquestadorConfig",
    "DEFAULT_CONFIG",
    "get_movement_index",
    "get_movement_name",
    "get_movement_label_es",
    
    # Modelo
    "OrquestadorModel",
    "MultimodalAttention",
    "ResidualBlock",
    "create_orquestador",
    
    # Entrenamiento
    "OrquestadorTrainer",
    
    # Inferencia
    "OrquestadorInference",
    
    # Datos
    "generate_dataset",
    "generate_imu_features_for_movement",
    "generate_emg_features_for_movement",
    "generate_ecg_features_for_movement",
    "generate_context_features_for_movement",
    "SENSOR_ALIASES",
    "SENSOR_TO_IDX"
]
