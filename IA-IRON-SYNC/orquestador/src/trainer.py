"""
Entrenador del Orquestador Multimodal IRON-SYNC
Incluye validación, early stopping, métricas y exportación de modelos
"""
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
import numpy as np
from pathlib import Path
from typing import Dict, Tuple
from datetime import datetime
import json

from .model import OrquestadorModel, create_orquestador
from .config import OrquestadorConfig, MOVEMENT_NAMES, NUM_MOVEMENTS


class OrquestadorTrainer:
    """
    Entrenador completo para el Orquestador Multimodal
    
    Features:
    - Early stopping basado en F1-score de validación
    - Guardado de mejor modelo y checkpoints periódicos
    - Métricas detalladas: accuracy, F1, matriz de confusión
    - Logging de entrenamiento y validación
    - Exportación de modelo final
    """
    
    def __init__(
        self,
        config: OrquestadorConfig,
        device: str = "auto"
    ):
        self.config = config
        
        # Configurar dispositivo
        if device == "auto":
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = torch.device(device)
        
        print(f"Usando dispositivo: {self.device}")
        
        # Crear modelo
        self.model = create_orquestador(config).to(self.device)
        print(f"Modelo creado: {self.model.count_parameters():,} parámetros")
        
        # Optimizador y scheduler
        self.optimizer = optim.AdamW(
            self.model.parameters(),
            lr=config.learning_rate,
            weight_decay=config.weight_decay
        )
        self.scheduler = optim.lr_scheduler.ReduceLROnPlateau(
            self.optimizer,
            mode="max",
            factor=0.5,
            patience=5,
            verbose=True
        )
        
        # Función de pérdida
        self.criterion = nn.CrossEntropyLoss()
        
        # Historial de entrenamiento
        self.history = {
            "train_loss": [],
            "train_acc": [],
            "val_loss": [],
            "val_acc": [],
            "val_f1": [],
            "lr": []
        }
        
        # Mejor modelo
        self.best_val_f1 = 0.0
        self.best_epoch = 0
        self.patience_counter = 0
        
    def load_dataset(self, dataset_dir: Path) -> Dict[str, DataLoader]:
        """Carga el dataset desde archivos NPZ"""
        loaders = {}
        
        for split in ["train", "val", "test"]:
            npz_path = dataset_dir / f"orquestador_{split}.npz"
            data = np.load(npz_path)
            
            # Crear dataset
            dataset = TensorDataset(
                torch.from_numpy(data["imu_features"]).float(),
                torch.from_numpy(data["emg_features"]).float(),
                torch.from_numpy(data["ecg_features"]).float(),
                torch.from_numpy(data["context_features"]).float(),
                torch.from_numpy(data["labels"]).long()
            )
            
            # Crear dataloader
            batch_size = self.config.batch_size if split == "train" else self.config.batch_size * 2
            loaders[split] = DataLoader(
                dataset,
                batch_size=batch_size,
                shuffle=(split == "train"),
                num_workers=0,
                pin_memory=True
            )
            
            print(f"  {split}: {len(dataset)} muestras")
        
        return loaders
    
    def train_epoch(self, train_loader: DataLoader) -> Tuple[float, float]:
        """Entrena una época completa"""
        self.model.train()
        total_loss = 0.0
        correct = 0
        total = 0
        
        for batch_idx, (imu, emg, ecg, context, labels) in enumerate(train_loader):
            # Mover a dispositivo
            imu = imu.to(self.device)
            emg = emg.to(self.device)
            ecg = ecg.to(self.device)
            context = context.to(self.device)
            labels = labels.to(self.device)
            
            # Forward
            self.optimizer.zero_grad()
            logits, _, _ = self.model(imu, emg, ecg, context)
            loss = self.criterion(logits, labels)
            
            # Backward
            loss.backward()
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
            self.optimizer.step()
            
            # Métricas
            total_loss += loss.item() * labels.size(0)
            _, predicted = torch.max(logits, 1)
            correct += (predicted == labels).sum().item()
            total += labels.size(0)
        
        avg_loss = total_loss / total
        accuracy = correct / total
        
        return avg_loss, accuracy
    
    def validate(self, val_loader: DataLoader) -> Tuple[float, float, float, np.ndarray]:
        """Valida el modelo y calcula métricas"""
        self.model.eval()
        total_loss = 0.0
        all_preds = []
        all_labels = []
        
        with torch.no_grad():
            for imu, emg, ecg, context, labels in val_loader:
                # Mover a dispositivo
                imu = imu.to(self.device)
                emg = emg.to(self.device)
                ecg = ecg.to(self.device)
                context = context.to(self.device)
                labels = labels.to(self.device)
                
                # Forward
                logits, _, _ = self.model(imu, emg, ecg, context)
                loss = self.criterion(logits, labels)
                
                # Métricas
                total_loss += loss.item() * labels.size(0)
                _, predicted = torch.max(logits, 1)
                all_preds.extend(predicted.cpu().numpy())
                all_labels.extend(labels.cpu().numpy())
        
        avg_loss = total_loss / len(val_loader.dataset)
        all_preds = np.array(all_preds)
        all_labels = np.array(all_labels)
        
        # Accuracy
        accuracy = np.mean(all_preds == all_labels)
        
        # F1-score macro
        f1_scores = []
        for class_idx in range(NUM_MOVEMENTS):
            tp = np.sum((all_preds == class_idx) & (all_labels == class_idx))
            fp = np.sum((all_preds == class_idx) & (all_labels != class_idx))
            fn = np.sum((all_preds != class_idx) & (all_labels == class_idx))
            
            precision = tp / (tp + fp + 1e-8)
            recall = tp / (tp + fn + 1e-8)
            f1 = 2 * precision * recall / (precision + recall + 1e-8)
            f1_scores.append(f1)
        
        f1_macro = np.mean(f1_scores)
        
        # Matriz de confusión
        confusion_matrix = np.zeros((NUM_MOVEMENTS, NUM_MOVEMENTS), dtype=int)
        for pred, label in zip(all_preds, all_labels):
            confusion_matrix[label, pred] += 1
        
        return avg_loss, accuracy, f1_macro, confusion_matrix
    
    def train(
        self,
        train_loader: DataLoader,
        val_loader: DataLoader,
        output_dir: Path
    ) -> Dict:
        """
        Entrenamiento completo con early stopping
        
        Returns:
            Dict con historial y métricas finales
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        checkpoints_dir = output_dir / "checkpoints"
        checkpoints_dir.mkdir(exist_ok=True)
        
        print(f"\nIniciando entrenamiento ({self.config.epochs} épocas, patience={self.config.patience})")
        print(f"Target: F1 >= {self.config.target_f1:.2%}")
        print("-" * 80)
        
        for epoch in range(1, self.config.epochs + 1):
            # Entrenar
            train_loss, train_acc = self.train_epoch(train_loader)
            
            # Validar
            val_loss, val_acc, val_f1, confusion = self.validate(val_loader)
            
            # Actualizar scheduler
            current_lr = self.optimizer.param_groups[0]["lr"]
            self.scheduler.step(val_f1)
            
            # Guardar historial
            self.history["train_loss"].append(train_loss)
            self.history["train_acc"].append(train_acc)
            self.history["val_loss"].append(val_loss)
            self.history["val_acc"].append(val_acc)
            self.history["val_f1"].append(val_f1)
            self.history["lr"].append(current_lr)
            
            # Logging
            print(
                f"Epoch {epoch:3d}/{self.config.epochs} | "
                f"Train Loss: {train_loss:.4f} Acc: {train_acc:.4f} | "
                f"Val Loss: {val_loss:.4f} Acc: {val_acc:.4f} F1: {val_f1:.4f} | "
                f"LR: {current_lr:.6f}"
            )
            
            # Early stopping
            if val_f1 > self.best_val_f1:
                self.best_val_f1 = val_f1
                self.best_epoch = epoch
                self.patience_counter = 0
                
                # Guardar mejor modelo
                best_model_path = output_dir / "best_model.pt"
                torch.save({
                    "epoch": epoch,
                    "model_state_dict": self.model.state_dict(),
                    "optimizer_state_dict": self.optimizer.state_dict(),
                    "val_f1": val_f1,
                    "val_acc": val_acc,
                    "config": self.config.__dict__
                }, best_model_path)
                
                print(f"  ✓ Nuevo mejor modelo guardado (F1: {val_f1:.4f})")
            else:
                self.patience_counter += 1
                
                if self.patience_counter >= self.config.patience:
                    print(f"\nEarly stopping en época {epoch} (patience={self.config.patience})")
                    break
            
            # Checkpoint cada 10 épocas
            if epoch % 10 == 0:
                checkpoint_path = checkpoints_dir / f"checkpoint_epoch_{epoch:03d}.pt"
                torch.save({
                    "epoch": epoch,
                    "model_state_dict": self.model.state_dict(),
                    "optimizer_state_dict": self.optimizer.state_dict(),
                    "val_f1": val_f1,
                    "val_acc": val_acc,
                    "config": self.config.__dict__
                }, checkpoint_path)
        
        print("-" * 80)
        print(f"Entrenamiento completado")
        print(f"  Mejor época: {self.best_epoch}")
        print(f"  Mejor F1: {self.best_val_f1:.4f}")
        
        # Guardar historial
        history_path = output_dir / "training_history.json"
        with open(history_path, "w") as f:
            json.dump(self.history, f, indent=2)
        
        return {
            "best_epoch": self.best_epoch,
            "best_val_f1": self.best_val_f1,
            "history": self.history
        }
    
    def test(self, test_loader: DataLoader, output_dir: Path) -> Dict:
        """Evalúa el modelo en el conjunto de test"""
        print("\nEvaluando en conjunto de test...")
        
        # Cargar mejor modelo
        best_model_path = output_dir / "best_model.pt"
        checkpoint = torch.load(best_model_path, map_location=self.device)
        self.model.load_state_dict(checkpoint["model_state_dict"])
        
        # Evaluar
        test_loss, test_acc, test_f1, confusion = self.validate(test_loader)
        
        print(f"  Test Loss: {test_loss:.4f}")
        print(f"  Test Acc:  {test_acc:.4f}")
        print(f"  Test F1:   {test_f1:.4f}")
        
        # Guardar métricas de test
        test_metrics = {
            "test_loss": test_loss,
            "test_accuracy": test_acc,
            "test_f1_macro": test_f1,
            "best_epoch": self.best_epoch,
            "best_val_f1": self.best_val_f1
        }
        
        metrics_path = output_dir / "test_metrics.json"
        with open(metrics_path, "w") as f:
            json.dump(test_metrics, f, indent=2)
        
        # Guardar matriz de confusión
        confusion_path = output_dir / "confusion_matrix.npy"
        np.save(confusion_path, confusion)
        
        # Imprimir matriz de confusión
        print("\nMatriz de confusión (filas=real, columnas=predicho):")
        print("  " + " ".join([f"{name[:4]:>4}" for name in MOVEMENT_NAMES]))
        for i, name in enumerate(MOVEMENT_NAMES):
            row = " ".join([f"{confusion[i, j]:4d}" for j in range(NUM_MOVEMENTS)])
            print(f"{name[:4]:>4} {row}")
        
        return test_metrics
    
    def export_model(self, output_dir: Path, model_name: str = "BEST_ORQUESTADOR.pt"):
        """Exporta el modelo final para inferencia"""
        best_model_path = output_dir / "best_model.pt"
        export_path = output_dir / model_name
        
        # Copiar mejor modelo
        checkpoint = torch.load(best_model_path, map_location=self.device)
        
        # Crear checkpoint limpio para inferencia
        export_checkpoint = {
            "model_state_dict": checkpoint["model_state_dict"],
            "config": checkpoint["config"],
            "movement_names": MOVEMENT_NAMES,
            "num_movements": NUM_MOVEMENTS,
            "exported_at": datetime.now().isoformat()
        }
        
        torch.save(export_checkpoint, export_path)
        print(f"\nModelo exportado: {export_path}")
        
        return export_path
