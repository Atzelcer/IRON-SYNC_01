"""
Inferencia en tiempo real del Orquestador Multimodal
Integración con el runtime IRON-SYNC para clasificación de movimientos
"""
import torch
import numpy as np
from pathlib import Path
from typing import Dict, Optional, Tuple
from collections import deque

from .model import OrquestadorModel
from .config import MOVEMENTS, MOVEMENT_NAMES, NUM_MOVEMENTS, get_movement_label_es


class OrquestadorInference:
    """
    Motor de inferencia en tiempo real para el Orquestador
    
    Features:
    - Carga de modelo entrenado
    - Inferencia frame-a-frame con suavizado temporal
    - Detección de transiciones de movimiento
    - Integración con pipeline de runtime
    """
    
    def __init__(
        self,
        model_path: Path,
        device: str = "auto",
        smoothing_window: int = 5,
        confidence_threshold: float = 0.6
    ):
        """
        Args:
            model_path: Ruta al modelo entrenado (.pt)
            device: Dispositivo de inferencia ("auto", "cpu", "cuda")
            smoothing_window: Ventana de suavizado temporal (frames)
            confidence_threshold: Umbral mínimo de confianza para aceptar predicción
        """
        # Configurar dispositivo
        if device == "auto":
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = torch.device(device)
        
        # Cargar modelo
        self.model = self._load_model(model_path)
        self.model.eval()
        
        # Configuración
        self.smoothing_window = smoothing_window
        self.confidence_threshold = confidence_threshold
        
        # Buffer de predicciones para suavizado
        self.prediction_buffer = deque(maxlen=smoothing_window)
        
        # Estado actual
        self.current_movement = "IDLE"
        self.current_confidence = 0.0
        self.frames_in_movement = 0
        
        print(f"Orquestador cargado: {model_path.name}")
        print(f"  Dispositivo: {self.device}")
        print(f"  Movimientos: {NUM_MOVEMENTS}")
        print(f"  Suavizado: {smoothing_window} frames")
        print(f"  Umbral confianza: {confidence_threshold:.2%}")
    
    def _load_model(self, model_path: Path) -> OrquestadorModel:
        """Carga el modelo desde checkpoint"""
        checkpoint = torch.load(model_path, map_location=self.device)
        
        # Reconstruir configuración
        config = checkpoint["config"]
        model = OrquestadorModel(
            imu_dim=config.get("imu_features_dim", 45),
            emg_dim=config.get("emg_dim", 3),
            ecg_dim=config.get("ecg_dim", 3),
            context_dim=config.get("context_dim", 10),
            num_movements=NUM_MOVEMENTS,
            hidden_dim=config.get("hidden_dim", 256),
            num_layers=config.get("num_layers", 4),
            dropout=config.get("dropout", 0.3),
            use_attention=config.get("use_attention", True)
        )
        
        model.load_state_dict(checkpoint["model_state_dict"])
        model.to(self.device)
        
        return model
    
    def preprocess_imu(self, sensors: Dict[str, Dict[str, float]]) -> np.ndarray:
        """
        Preprocesa datos de sensores IMU a formato de entrada
        
        Args:
            sensors: Dict con alias de sensor -> {rx, ry, rz}
            
        Returns:
            imu_features: (1, 45) - Features IMU normalizadas
        """
        from .data_generator import SENSOR_ALIASES
        
        features = np.zeros((1, 15, 3), dtype=np.float32)
        
        for alias, values in sensors.items():
            if alias in SENSOR_ALIASES:
                idx = SENSOR_ALIASES.index(alias)
                features[0, idx, 0] = values.get("rx", 0.0)
                features[0, idx, 1] = values.get("ry", 0.0)
                features[0, idx, 2] = values.get("rz", 0.0)
        
        return features.reshape(1, -1)
    
    def preprocess_emg(self, emg_label: str) -> np.ndarray:
        """
        Convierte label EMG a one-hot
        
        Args:
            emg_label: "BAJA", "MEDIA" o "ALTA"
            
        Returns:
            emg_features: (1, 3) - One-hot encoding
        """
        emg_map = {"BAJA": 0, "MEDIA": 1, "ALTA": 2}
        idx = emg_map.get(emg_label.upper(), 0)
        
        features = np.zeros((1, 3), dtype=np.float32)
        features[0, idx] = 1.0
        
        return features
    
    def preprocess_ecg(self, ecg_label: str) -> np.ndarray:
        """
        Convierte label ECG a one-hot
        
        Args:
            ecg_label: "CALMA", "TENSION" o "ESTRES"
            
        Returns:
            ecg_features: (1, 3) - One-hot encoding
        """
        ecg_map = {"CALMA": 0, "TENSION": 1, "ESTRES": 2}
        idx = ecg_map.get(ecg_label.upper(), 0)
        
        features = np.zeros((1, 3), dtype=np.float32)
        features[0, idx] = 1.0
        
        return features
    
    def compute_context_features(self, imu_features: np.ndarray) -> np.ndarray:
        """
        Calcula features de contexto en tiempo real
        
        Args:
            imu_features: (1, 45) - Features IMU
            
        Returns:
            context_features: (1, 10) - Features de contexto
        """
        imu_reshaped = imu_features.reshape(1, 15, 3)
        context = np.zeros((1, 10), dtype=np.float32)
        
        # 0: Energía cinética total
        context[0, 0] = np.linalg.norm(imu_reshaped) / 10.0
        
        # 1: Velocidad estimada (usar buffer si está disponible)
        if hasattr(self, "_prev_imu") and self._prev_imu is not None:
            velocity = np.linalg.norm(imu_reshaped - self._prev_imu)
            context[0, 1] = velocity / 5.0
        self._prev_imu = imu_reshaped.copy()
        
        # 2: Simetría izquierda/derecha
        from .data_generator import SENSOR_ALIASES
        left_bones = ["sL", "fL", "hL", "tL", "knL", "ftL"]
        right_bones = ["sR", "fR", "hR", "tR", "knR", "ftR"]
        left_idx = [SENSOR_ALIASES.index(b) for b in left_bones]
        right_idx = [SENSOR_ALIASES.index(b) for b in right_bones]
        
        left_energy = np.linalg.norm(imu_reshaped[0, left_idx])
        right_energy = np.linalg.norm(imu_reshaped[0, right_idx])
        context[0, 2] = 1.0 - np.abs(left_energy - right_energy) / (left_energy + right_energy + 1e-6)
        
        # 3-5: Actividad por región
        torso_idx = [SENSOR_ALIASES.index(b) for b in ["hip", "chest", "head"]]
        arm_idx = [SENSOR_ALIASES.index(b) for b in ["sL", "fL", "hL", "sR", "fR", "hR"]]
        leg_idx = [SENSOR_ALIASES.index(b) for b in ["tL", "knL", "ftL", "tR", "knR", "ftR"]]
        
        context[0, 3] = np.linalg.norm(imu_reshaped[0, torso_idx]) / 5.0
        context[0, 4] = np.linalg.norm(imu_reshaped[0, arm_idx]) / 8.0
        context[0, 5] = np.linalg.norm(imu_reshaped[0, leg_idx]) / 8.0
        
        # 6-9: Features temporales (simplificadas para tiempo real)
        context[0, 6] = np.var(imu_reshaped)
        context[0, 7] = np.max(np.abs(imu_reshaped))
        context[0, 8] = 0.5  # Frecuencia (placeholder)
        context[0, 9] = 1.0 / (1.0 + context[0, 6] * 10.0)
        
        # Normalizar a [0, 1]
        context = np.clip(context, 0, 1)
        
        return context
    
    def predict(
        self,
        imu_features: np.ndarray,
        emg_features: np.ndarray,
        ecg_features: np.ndarray,
        context_features: np.ndarray
    ) -> Dict:
        """
        Predicción de movimiento con suavizado temporal
        
        Returns:
            Dict con:
                - movement_name: Nombre del movimiento predicho
                - movement_label_es: Etiqueta en español
                - confidence: Confianza de la predicción
                - movement_probs: Probabilidades de todos los movimientos
                - execution_params: Parámetros de ejecución
                - attention_weights: Pesos de attention por modalidad
                - is_transition: Si hay transición de movimiento
        """
        # Convertir a tensores
        imu_t = torch.from_numpy(imu_features).to(self.device)
        emg_t = torch.from_numpy(emg_features).to(self.device)
        ecg_t = torch.from_numpy(ecg_features).to(self.device)
        context_t = torch.from_numpy(context_features).to(self.device)
        
        # Inferencia
        with torch.no_grad():
            logits, exec_params, attn_weights = self.model(imu_t, emg_t, ecg_t, context_t)
            probs = torch.softmax(logits, dim=1)
            
            # Suavizado temporal
            self.prediction_buffer.append(probs[0].cpu().numpy())
            
            if len(self.prediction_buffer) >= self.smoothing_window:
                smoothed_probs = np.mean(self.prediction_buffer, axis=0)
            else:
                smoothed_probs = probs[0].cpu().numpy()
            
            # Predicción final
            predicted_idx = np.argmax(smoothed_probs)
            confidence = smoothed_probs[predicted_idx]
            
            # Aplicar umbral de confianza
            if confidence < self.confidence_threshold:
                predicted_idx = MOVEMENT_NAMES.index("IDLE")
                confidence = smoothed_probs[predicted_idx]
        
        # Detectar transición
        movement_name = MOVEMENT_NAMES[predicted_idx]
        is_transition = (movement_name != self.current_movement)
        
        if is_transition:
            self.frames_in_movement = 0
        else:
            self.frames_in_movement += 1
        
        # Actualizar estado
        self.current_movement = movement_name
        self.current_confidence = confidence
        
        return {
            "movement_name": movement_name,
            "movement_label_es": get_movement_label_es(predicted_idx),
            "confidence": float(confidence),
            "movement_probs": smoothed_probs.tolist(),
            "execution_params": exec_params[0].cpu().numpy().tolist(),
            "attention_weights": attn_weights[0].cpu().numpy().tolist(),
            "is_transition": is_transition,
            "frames_in_movement": self.frames_in_movement
        }
    
    def infer_from_packet(
        self,
        packet,
        emg_label: str = "MEDIA",
        ecg_label: str = "TENSION"
    ) -> Dict:
        """
        Inferencia directa desde un paquete IronSync
        
        Args:
            packet: IronSyncPacket del parser
            emg_label: Label EMG actual ("BAJA", "MEDIA", "ALTA")
            ecg_label: Label ECG actual ("CALMA", "TENSION", "ESTRES")
            
        Returns:
            Dict con resultado de inferencia
        """
        # Extraer sensores del paquete
        sensors = {}
        for sensor in packet.sensors:
            sensors[sensor.alias] = {
                "rx": sensor.rx,
                "ry": sensor.ry,
                "rz": sensor.rz
            }
        
        # Preprocesar
        imu_features = self.preprocess_imu(sensors)
        emg_features = self.preprocess_emg(emg_label)
        ecg_features = self.preprocess_ecg(ecg_label)
        context_features = self.compute_context_features(imu_features)
        
        # Predecir
        return self.predict(imu_features, emg_features, ecg_features, context_features)
    
    def reset(self):
        """Reinicia el estado del motor de inferencia"""
        self.prediction_buffer.clear()
        self.current_movement = "IDLE"
        self.current_confidence = 0.0
        self.frames_in_movement = 0
        self._prev_imu = None
