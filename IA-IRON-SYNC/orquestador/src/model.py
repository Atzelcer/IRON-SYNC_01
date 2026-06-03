"""
Arquitectura del Orquestador Multimodal IRON-SYNC
MLP con attention para clasificación de movimientos complejos
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Dict, Tuple


class MultimodalAttention(nn.Module):
    """
    Módulo de attention para fusionar características multimodales
    Permite que el modelo aprenda qué modalidad es más importante para cada movimiento
    """
    def __init__(self, imu_dim: int, emg_dim: int, ecg_dim: int, context_dim: int):
        super().__init__()
        
        # Proyecciones para cada modalidad
        self.imu_proj = nn.Linear(imu_dim, 64)
        self.emg_proj = nn.Linear(emg_dim, 32)
        self.ecg_proj = nn.Linear(ecg_dim, 32)
        self.context_proj = nn.Linear(context_dim, 32)
        
        # Attention weights
        self.attention = nn.Sequential(
            nn.Linear(64 + 32 + 32 + 32, 64),
            nn.ReLU(),
            nn.Linear(64, 4),  # 4 modalidades
            nn.Softmax(dim=1)
        )
        
    def forward(
        self,
        imu_features: torch.Tensor,
        emg_features: torch.Tensor,
        ecg_features: torch.Tensor,
        context_features: torch.Tensor
    ) -> torch.Tensor:
        """
        Args:
            imu_features: (B, imu_dim) - Features de IMU sanitizadas
            emg_features: (B, emg_dim) - One-hot de intensidad EMG
            ecg_features: (B, ecg_dim) - One-hot de estado ECG
            context_features: (B, context_dim) - Features de contexto
            
        Returns:
            fused: (B, 160) - Características fusionadas con attention
        """
        # Proyectar cada modalidad
        imu_proj = F.relu(self.imu_proj(imu_features))  # (B, 64)
        emg_proj = F.relu(self.emg_proj(emg_features))  # (B, 32)
        ecg_proj = F.relu(self.ecg_proj(ecg_features))  # (B, 32)
        context_proj = F.relu(self.context_proj(context_features))  # (B, 32)
        
        # Concatenar para calcular attention
        concat = torch.cat([imu_proj, emg_proj, ecg_proj, context_proj], dim=1)  # (B, 160)
        
        # Calcular pesos de attention
        attn_weights = self.attention(concat)  # (B, 4)
        
        # Aplicar attention a cada modalidad
        imu_weighted = imu_proj * attn_weights[:, 0:1]  # (B, 64)
        emg_weighted = emg_proj * attn_weights[:, 1:2]  # (B, 32)
        ecg_weighted = ecg_proj * attn_weights[:, 2:3]  # (B, 32)
        context_weighted = context_proj * attn_weights[:, 3:4]  # (B, 32)
        
        # Concatenar características ponderadas
        fused = torch.cat([imu_weighted, emg_weighted, ecg_weighted, context_weighted], dim=1)
        
        return fused, attn_weights


class ResidualBlock(nn.Module):
    """Bloque residual con dropout y normalización"""
    def __init__(self, dim: int, dropout: float = 0.3):
        super().__init__()
        self.block = nn.Sequential(
            nn.Linear(dim, dim),
            nn.LayerNorm(dim),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(dim, dim),
            nn.LayerNorm(dim),
        )
        self.activation = nn.ReLU()
        
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.activation(x + self.block(x))


class OrquestadorModel(nn.Module):
    """
    Orquestador Multimodal IRON-SYNC
    
    Arquitectura:
    1. Attention multimodal para fusionar IMU, EMG, ECG y contexto
    2. MLP con bloques residuales para clasificación
    3. Salida: probabilidades de movimientos + parámetros de ejecución
    
    Entrada:
        - imu_features: (B, 45) - 15 sensores × 3 ejes
        - emg_features: (B, 3) - One-hot [BAJA, MEDIA, ALTA]
        - ecg_features: (B, 3) - One-hot [CALMA, TENSION, ESTRES]
        - context_features: (B, 10) - Energía, velocidad, etc.
    
    Salida:
        - movement_logits: (B, num_movements) - Logits de clasificación
        - execution_params: (B, 6) - Parámetros de ejecución (intensidad, duración, etc.)
        - attention_weights: (B, 4) - Pesos de attention por modalidad
    """
    def __init__(
        self,
        imu_dim: int = 45,
        emg_dim: int = 3,
        ecg_dim: int = 3,
        context_dim: int = 10,
        num_movements: int = 13,
        hidden_dim: int = 256,
        num_layers: int = 4,
        dropout: float = 0.3,
        use_attention: bool = True
    ):
        super().__init__()
        
        self.use_attention = use_attention
        self.num_movements = num_movements
        
        # Módulo de attention multimodal
        if use_attention:
            self.attention = MultimodalAttention(imu_dim, emg_dim, ecg_dim, context_dim)
            fused_dim = 160  # 64 + 32 + 32 + 32
        else:
            # Sin attention: concatenación simple
            fused_dim = imu_dim + emg_dim + ecg_dim + context_dim
        
        # MLP con bloques residuales
        self.input_proj = nn.Linear(fused_dim, hidden_dim)
        
        self.residual_blocks = nn.ModuleList([
            ResidualBlock(hidden_dim, dropout) for _ in range(num_layers)
        ])
        
        # Cabezas de salida
        self.movement_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim // 2, num_movements)
        )
        
        # Parámetros de ejecución (intensidad, duración, velocidad, etc.)
        self.execution_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim // 2, 6),
            nn.Sigmoid()  # Normalizar a [0, 1]
        )
        
    def forward(
        self,
        imu_features: torch.Tensor,
        emg_features: torch.Tensor,
        ecg_features: torch.Tensor,
        context_features: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Forward pass del orquestador
        
        Returns:
            movement_logits: (B, num_movements) - Logits de clasificación
            execution_params: (B, 6) - Parámetros de ejecución
            attention_weights: (B, 4) - Pesos de attention (si use_attention=True)
        """
        # Fusionar características multimodales
        if self.use_attention:
            fused, attn_weights = self.attention(
                imu_features, emg_features, ecg_features, context_features
            )
        else:
            fused = torch.cat([imu_features, emg_features, ecg_features, context_features], dim=1)
            attn_weights = torch.ones(fused.size(0), 4, device=fused.device) * 0.25
        
        # Proyección inicial
        x = F.relu(self.input_proj(fused))
        
        # Bloques residuales
        for block in self.residual_blocks:
            x = block(x)
        
        # Cabezas de salida
        movement_logits = self.movement_head(x)
        execution_params = self.execution_head(x)
        
        return movement_logits, execution_params, attn_weights
    
    def predict(
        self,
        imu_features: torch.Tensor,
        emg_features: torch.Tensor,
        ecg_features: torch.Tensor,
        context_features: torch.Tensor
    ) -> Dict[str, torch.Tensor]:
        """
        Predicción con post-procesamiento
        
        Returns:
            Dict con:
                - movement_probs: Probabilidades de cada movimiento
                - predicted_movement: Índice del movimiento predicho
                - confidence: Confianza de la predicción
                - execution_params: Parámetros de ejecución
                - attention_weights: Pesos de attention
        """
        self.eval()
        with torch.no_grad():
            logits, exec_params, attn_weights = self.forward(
                imu_features, emg_features, ecg_features, context_features
            )
            
            probs = F.softmax(logits, dim=1)
            predicted = torch.argmax(probs, dim=1)
            confidence = torch.max(probs, dim=1)[0]
            
        return {
            "movement_probs": probs,
            "predicted_movement": predicted,
            "confidence": confidence,
            "execution_params": exec_params,
            "attention_weights": attn_weights
        }
    
    def count_parameters(self) -> int:
        """Cuenta el número de parámetros entrenables"""
        return sum(p.numel() for p in self.parameters() if p.requires_grad)
    
    def get_model_info(self) -> Dict[str, any]:
        """Retorna información del modelo"""
        return {
            "num_parameters": self.count_parameters(),
            "num_movements": self.num_movements,
            "use_attention": self.use_attention,
            "num_layers": len(self.residual_blocks)
        }


def create_orquestador(config) -> OrquestadorModel:
    """Factory function para crear el orquestador desde configuración"""
    return OrquestadorModel(
        imu_dim=config.imu_features_dim,
        emg_dim=config.emg_dim,
        ecg_dim=config.ecg_dim,
        context_dim=config.context_dim,
        num_movements=13,  # Número de movimientos definidos
        hidden_dim=config.hidden_dim,
        num_layers=config.num_layers,
        dropout=config.dropout,
        use_attention=config.use_attention
    )
