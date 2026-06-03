"""
Generador de datos sintéticos para el Orquestador Multimodal
Crea datasets realistas combinando IMU, EMG, ECG y contexto para cada movimiento
"""
import numpy as np
from typing import Dict, Tuple
from pathlib import Path
import json

from .config import MOVEMENTS, MOVEMENT_NAMES, NUM_MOVEMENTS, OrquestadorConfig


# Mapeo de alias de sensores a índices
SENSOR_ALIASES = [
    "hip", "chest", "sL", "fL", "hL", "sR", "fR", "hR",
    "head", "tL", "knL", "ftL", "tR", "knR", "ftR"
]
SENSOR_TO_IDX = {alias: idx for idx, alias in enumerate(SENSOR_ALIASES)}


def generate_imu_features_for_movement(
    movement_name: str,
    num_samples: int,
    noise_std: float = 0.1
) -> np.ndarray:
    """
    Genera features IMU realistas para un movimiento específico
    
    Args:
        movement_name: Nombre del movimiento
        num_samples: Número de muestras a generar
        noise_std: Desviación estándar del ruido gaussiano
        
    Returns:
        imu_features: (num_samples, 45) - 15 sensores × 3 ejes
    """
    movement = MOVEMENTS[movement_name]
    features = np.zeros((num_samples, 15, 3), dtype=np.float32)
    
    # Definir patrones de movimiento por hueso
    if movement_name == "IDLE":
        # Reposo: pequeñas oscilaciones
        for sensor in movement.primary_bones:
            idx = SENSOR_TO_IDX[sensor]
            features[:, idx, :] = np.random.normal(0, 0.05, (num_samples, 3))
            
    elif movement_name == "WALK":
        # Caminata: oscilaciones rítmicas en piernas y brazos
        t = np.linspace(0, 4 * np.pi, num_samples)
        for sensor in movement.primary_bones:
            idx = SENSOR_TO_IDX[sensor]
            if sensor.startswith("t") or sensor.startswith("kn") or sensor.startswith("ft"):
                # Piernas: oscilación en X (adelante/atrás)
                features[:, idx, 0] = 0.3 * np.sin(t + np.random.uniform(0, 0.5, num_samples))
                features[:, idx, 1] = np.random.normal(0, 0.05, num_samples)
            elif sensor.startswith("s"):
                # Hombros: oscilación opuesta a piernas
                features[:, idx, 0] = 0.2 * np.sin(t + np.pi + np.random.uniform(0, 0.3, num_samples))
            features[:, idx] += np.random.normal(0, noise_std, (num_samples, 3))
            
    elif movement_name == "RUN":
        # Carrera: oscilaciones más rápidas y amplias
        t = np.linspace(0, 8 * np.pi, num_samples)
        for sensor in movement.primary_bones:
            idx = SENSOR_TO_IDX[sensor]
            if sensor.startswith("t") or sensor.startswith("kn") or sensor.startswith("ft"):
                features[:, idx, 0] = 0.6 * np.sin(t + np.random.uniform(0, 0.5, num_samples))
                features[:, idx, 2] = 0.3 * np.sin(t * 2 + np.random.uniform(0, 0.3, num_samples))
            elif sensor.startswith("s") or sensor.startswith("f"):
                features[:, idx, 0] = 0.4 * np.sin(t + np.pi + np.random.uniform(0, 0.3, num_samples))
            features[:, idx] += np.random.normal(0, noise_std * 1.5, (num_samples, 3))
            
    elif movement_name == "JUMP":
        # Salto: pico vertical en piernas
        t = np.linspace(0, 2 * np.pi, num_samples)
        jump_curve = np.exp(-((t - np.pi) ** 2) / 2)  # Campana gaussiana
        for sensor in movement.primary_bones:
            idx = SENSOR_TO_IDX[sensor]
            if sensor.startswith("t") or sensor.startswith("kn") or sensor.startswith("ft"):
                features[:, idx, 1] = 0.8 * jump_curve + np.random.normal(0, noise_std, num_samples)
            elif sensor == "hip":
                features[:, idx, 1] = 0.5 * jump_curve + np.random.normal(0, noise_std, num_samples)
                
    elif movement_name == "CROUCH":
        # Agacharse: flexión sostenida de rodillas y cadera
        for sensor in movement.primary_bones:
            idx = SENSOR_TO_IDX[sensor]
            if sensor.startswith("kn"):
                features[:, idx, 0] = -0.7 + np.random.normal(0, noise_std * 0.5, num_samples)
            elif sensor == "hip":
                features[:, idx, 0] = -0.4 + np.random.normal(0, noise_std * 0.5, num_samples)
                
    elif movement_name in ["PUNCH_RIGHT", "PUNCH_LEFT"]:
        # Golpe: extensión rápida de brazo
        side = "R" if "RIGHT" in movement_name else "L"
        t = np.linspace(0, 2 * np.pi, num_samples)
        punch_curve = np.exp(-((t - np.pi) ** 2) / 1.5)
        
        for sensor in movement.primary_bones:
            idx = SENSOR_TO_IDX[sensor]
            if sensor == f"s{side}":
                features[:, idx, 0] = 0.7 * punch_curve + np.random.normal(0, noise_std, num_samples)
            elif sensor == f"f{side}":
                features[:, idx, 0] = 0.9 * punch_curve + np.random.normal(0, noise_std, num_samples)
            elif sensor == f"h{side}":
                features[:, idx, 0] = 1.0 * punch_curve + np.random.normal(0, noise_std, num_samples)
            elif sensor == "chest":
                features[:, idx, 1] = 0.2 * punch_curve + np.random.normal(0, noise_std * 0.5, num_samples)
                
    elif movement_name in ["KICK_RIGHT", "KICK_LEFT"]:
        # Patada: extensión rápida de pierna
        side = "R" if "RIGHT" in movement_name else "L"
        t = np.linspace(0, 2 * np.pi, num_samples)
        kick_curve = np.exp(-((t - np.pi) ** 2) / 1.5)
        
        for sensor in movement.primary_bones:
            idx = SENSOR_TO_IDX[sensor]
            if sensor == f"t{side}":
                features[:, idx, 0] = 0.8 * kick_curve + np.random.normal(0, noise_std, num_samples)
            elif sensor == f"kn{side}":
                features[:, idx, 0] = 0.6 * kick_curve + np.random.normal(0, noise_std, num_samples)
            elif sensor == f"ft{side}":
                features[:, idx, 0] = 0.9 * kick_curve + np.random.normal(0, noise_std, num_samples)
                
    elif movement_name == "BLOCK":
        # Bloqueo: brazos cruzados al frente
        for sensor in movement.primary_bones:
            idx = SENSOR_TO_IDX[sensor]
            if sensor.startswith("s"):
                features[:, idx, 0] = 0.5 + np.random.normal(0, noise_std * 0.3, num_samples)
                features[:, idx, 1] = 0.3 + np.random.normal(0, noise_std * 0.3, num_samples)
            elif sensor.startswith("f"):
                features[:, idx, 0] = 0.8 + np.random.normal(0, noise_std * 0.3, num_samples)
                
    elif movement_name == "WAVE":
        # Saludo: oscilación de mano
        t = np.linspace(0, 6 * np.pi, num_samples)
        for sensor in movement.primary_bones:
            idx = SENSOR_TO_IDX[sensor]
            if sensor == "hR":
                features[:, idx, 2] = 0.4 * np.sin(t) + np.random.normal(0, noise_std, num_samples)
            elif sensor == "fR":
                features[:, idx, 0] = 0.3 + np.random.normal(0, noise_std * 0.5, num_samples)
            elif sensor == "sR":
                features[:, idx, 0] = 0.2 + np.random.normal(0, noise_std * 0.5, num_samples)
                
    elif movement_name == "SHOOT":
        # Disparo: brazo extendido al frente
        for sensor in movement.primary_bones:
            idx = SENSOR_TO_IDX[sensor]
            if sensor == "sR":
                features[:, idx, 0] = 0.6 + np.random.normal(0, noise_std * 0.3, num_samples)
            elif sensor == "fR":
                features[:, idx, 0] = 0.9 + np.random.normal(0, noise_std * 0.3, num_samples)
            elif sensor == "hR":
                features[:, idx, 0] = 1.0 + np.random.normal(0, noise_std * 0.3, num_samples)
            elif sensor == "head":
                features[:, idx, 1] = 0.1 + np.random.normal(0, noise_std * 0.5, num_samples)
                
    elif movement_name == "FLY":
        # Vuelo: brazos extendidos con oscilación
        t = np.linspace(0, 4 * np.pi, num_samples)
        for sensor in movement.primary_bones:
            idx = SENSOR_TO_IDX[sensor]
            if sensor.startswith("s"):
                features[:, idx, 0] = 0.8 + np.random.normal(0, noise_std * 0.3, num_samples)
                features[:, idx, 2] = 0.2 * np.sin(t) + np.random.normal(0, noise_std, num_samples)
            elif sensor.startswith("f"):
                features[:, idx, 0] = 0.9 + np.random.normal(0, noise_std * 0.3, num_samples)
            elif sensor == "chest":
                features[:, idx, 1] = 0.1 * np.sin(t * 0.5) + np.random.normal(0, noise_std * 0.5, num_samples)
    
    # Aplanar a (num_samples, 45)
    return features.reshape(num_samples, -1).astype(np.float32)


def generate_emg_features_for_movement(
    movement_name: str,
    num_samples: int
) -> np.ndarray:
    """
    Genera labels EMG one-hot para un movimiento
    
    Returns:
        emg_features: (num_samples, 3) - One-hot [BAJA, MEDIA, ALTA]
    """
    movement = MOVEMENTS[movement_name]
    emg_range = movement.emg_intensity_range
    
    # Muestrear intensidad dentro del rango
    intensities = np.random.uniform(emg_range[0], emg_range[1], num_samples)
    
    # Convertir a one-hot
    emg_features = np.zeros((num_samples, 3), dtype=np.float32)
    for i, intensity in enumerate(intensities):
        if intensity < 1.0:
            emg_features[i, 0] = 1.0  # BAJA
        elif intensity < 2.0:
            emg_features[i, 1] = 1.0  # MEDIA
        else:
            emg_features[i, 2] = 1.0  # ALTA
            
    return emg_features


def generate_ecg_features_for_movement(
    movement_name: str,
    num_samples: int
) -> np.ndarray:
    """
    Genera labels ECG one-hot para un movimiento
    
    Returns:
        ecg_features: (num_samples, 3) - One-hot [CALMA, TENSION, ESTRES]
    """
    movement = MOVEMENTS[movement_name]
    ecg_range = movement.ecg_stress_range
    
    # Muestrear estrés dentro del rango
    stress_levels = np.random.uniform(ecg_range[0], ecg_range[1], num_samples)
    
    # Convertir a one-hot
    ecg_features = np.zeros((num_samples, 3), dtype=np.float32)
    for i, stress in enumerate(stress_levels):
        if stress < 1.0:
            ecg_features[i, 0] = 1.0  # CALMA
        elif stress < 2.0:
            ecg_features[i, 1] = 1.0  # TENSION
        else:
            ecg_features[i, 2] = 1.0  # ESTRES
            
    return ecg_features


def generate_context_features_for_movement(
    movement_name: str,
    imu_features: np.ndarray,
    num_samples: int
) -> np.ndarray:
    """
    Genera features de contexto para un movimiento
    
    Features:
        0: Energía cinética total (norma de IMU)
        1: Velocidad estimada (derivada de IMU)
        2: Simetría izquierda/derecha
        3: Actividad de torso
        4: Actividad de brazos
        5: Actividad de piernas
        6: Varianza temporal
        7: Pico máximo de movimiento
        8: Frecuencia dominante
        9: Estabilidad postural
    
    Returns:
        context_features: (num_samples, 10)
    """
    movement = MOVEMENTS[movement_name]
    imu_reshaped = imu_features.reshape(num_samples, 15, 3)
    
    context = np.zeros((num_samples, 10), dtype=np.float32)
    
    # 0: Energía cinética total
    context[:, 0] = np.linalg.norm(imu_reshaped, axis=(1, 2)) / 10.0
    
    # 1: Velocidad estimada (diferencia entre frames)
    if num_samples > 1:
        velocity = np.linalg.norm(np.diff(imu_reshaped, axis=0), axis=(1, 2))
        context[1:, 1] = velocity / 5.0
        context[0, 1] = context[1, 1]
    
    # 2: Simetría izquierda/derecha
    left_bones = ["sL", "fL", "hL", "tL", "knL", "ftL"]
    right_bones = ["sR", "fR", "hR", "tR", "knR", "ftR"]
    left_energy = np.linalg.norm(imu_reshaped[:, [SENSOR_TO_IDX[b] for b in left_bones]], axis=(1, 2))
    right_energy = np.linalg.norm(imu_reshaped[:, [SENSOR_TO_IDX[b] for b in right_bones]], axis=(1, 2))
    context[:, 2] = 1.0 - np.abs(left_energy - right_energy) / (left_energy + right_energy + 1e-6)
    
    # 3: Actividad de torso
    torso_bones = ["hip", "chest", "head"]
    context[:, 3] = np.linalg.norm(imu_reshaped[:, [SENSOR_TO_IDX[b] for b in torso_bones]], axis=(1, 2)) / 5.0
    
    # 4: Actividad de brazos
    arm_bones = ["sL", "fL", "hL", "sR", "fR", "hR"]
    context[:, 4] = np.linalg.norm(imu_reshaped[:, [SENSOR_TO_IDX[b] for b in arm_bones]], axis=(1, 2)) / 8.0
    
    # 5: Actividad de piernas
    leg_bones = ["tL", "knL", "ftL", "tR", "knR", "ftR"]
    context[:, 5] = np.linalg.norm(imu_reshaped[:, [SENSOR_TO_IDX[b] for b in leg_bones]], axis=(1, 2)) / 8.0
    
    # 6: Varianza temporal (ventana de 10 frames)
    window_size = min(10, num_samples)
    for i in range(num_samples):
        start = max(0, i - window_size)
        window = imu_reshaped[start:i+1]
        context[i, 6] = np.var(window) if len(window) > 1 else 0.0
    
    # 7: Pico máximo de movimiento
    context[:, 7] = np.max(np.abs(imu_reshaped), axis=(1, 2))
    
    # 8: Frecuencia dominante (simplificada: número de cruces por cero)
    for i in range(num_samples):
        if i > 0:
            zero_crossings = np.sum(np.abs(np.diff(np.sign(imu_reshaped[max(0, i-10):i+1])))) / 2
            context[i, 8] = zero_crossings / 30.0
    
    # 9: Estabilidad postural (inversa de la varianza)
    context[:, 9] = 1.0 / (1.0 + context[:, 6] * 10.0)
    
    # Normalizar a [0, 1]
    context = np.clip(context, 0, 1)
    
    return context


def generate_dataset(
    config: OrquestadorConfig,
    output_dir: Path
) -> Dict[str, np.ndarray]:
    """
    Genera el dataset completo para entrenamiento
    
    Returns:
        Dict con arrays: imu_features, emg_features, ecg_features, context_features, labels
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    
    total_samples = config.train_samples + config.val_samples + config.test_samples
    samples_per_movement = total_samples // NUM_MOVEMENTS
    
    all_imu = []
    all_emg = []
    all_ecg = []
    all_context = []
    all_labels = []
    
    print(f"Generando dataset con {total_samples} muestras ({samples_per_movement} por movimiento)...")
    
    for movement_idx, movement_name in enumerate(MOVEMENT_NAMES):
        print(f"  [{movement_idx+1}/{NUM_MOVEMENTS}] {movement_name}...")
        
        # Generar features para este movimiento
        imu = generate_imu_features_for_movement(movement_name, samples_per_movement)
        emg = generate_emg_features_for_movement(movement_name, samples_per_movement)
        ecg = generate_ecg_features_for_movement(movement_name, samples_per_movement)
        context = generate_context_features_for_movement(movement_name, imu, samples_per_movement)
        labels = np.full(samples_per_movement, movement_idx, dtype=np.int64)
        
        all_imu.append(imu)
        all_emg.append(emg)
        all_ecg.append(ecg)
        all_context.append(context)
        all_labels.append(labels)
    
    # Concatenar todas las muestras
    imu_features = np.concatenate(all_imu, axis=0)
    emg_features = np.concatenate(all_emg, axis=0)
    ecg_features = np.concatenate(all_ecg, axis=0)
    context_features = np.concatenate(all_context, axis=0)
    labels = np.concatenate(all_labels, axis=0)
    
    # Mezclar aleatoriamente
    indices = np.random.permutation(len(labels))
    imu_features = imu_features[indices]
    emg_features = emg_features[indices]
    ecg_features = ecg_features[indices]
    context_features = context_features[indices]
    labels = labels[indices]
    
    # Dividir en train/val/test
    train_end = config.train_samples
    val_end = train_end + config.val_samples
    
    dataset = {
        "train": {
            "imu": imu_features[:train_end],
            "emg": emg_features[:train_end],
            "ecg": ecg_features[:train_end],
            "context": context_features[:train_end],
            "labels": labels[:train_end]
        },
        "val": {
            "imu": imu_features[train_end:val_end],
            "emg": emg_features[train_end:val_end],
            "ecg": ecg_features[train_end:val_end],
            "context": context_features[train_end:val_end],
            "labels": labels[train_end:val_end]
        },
        "test": {
            "imu": imu_features[val_end:],
            "emg": emg_features[val_end:],
            "ecg": ecg_features[val_end:],
            "context": context_features[val_end:],
            "labels": labels[val_end:]
        }
    }
    
    # Guardar en NPZ
    for split_name, split_data in dataset.items():
        output_path = output_dir / f"orquestador_{split_name}.npz"
        np.savez_compressed(
            output_path,
            imu_features=split_data["imu"],
            emg_features=split_data["emg"],
            ecg_features=split_data["ecg"],
            context_features=split_data["context"],
            labels=split_data["labels"]
        )
        print(f"  Guardado: {output_path} ({len(split_data['labels'])} muestras)")
    
    # Guardar metadata
    metadata = {
        "total_samples": total_samples,
        "train_samples": config.train_samples,
        "val_samples": config.val_samples,
        "test_samples": config.test_samples,
        "num_movements": NUM_MOVEMENTS,
        "movement_names": MOVEMENT_NAMES,
        "features": {
            "imu_dim": config.imu_features_dim,
            "emg_dim": config.emg_dim,
            "ecg_dim": config.ecg_dim,
            "context_dim": config.context_dim
        }
    }
    
    metadata_path = output_dir / "metadata" / "dataset_info.json"
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)
    
    print(f"\nDataset generado exitosamente:")
    print(f"  Train: {config.train_samples} muestras")
    print(f"  Val:   {config.val_samples} muestras")
    print(f"  Test:  {config.test_samples} muestras")
    
    return dataset
