"""
Genera el dataset canónico del MLP Orquestador IRON-SYNC.

Salida:
  dataset/orquestador_train.npz
  dataset/orquestador_val.npz
  dataset/orquestador_test.npz
  dataset/metadata/dataset_info.json
  dataset/metadata/dataset_manifest.json

El dataset es sintético-controlado y balanceado por las 13 acciones del
orquestador. Es el dataset base usado para entrenar/probar el MLP cuando no hay
capturas reales suficientes.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import types
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
SRC_DIR = ROOT / "src"
DATASET_DIR = ROOT / "dataset"
SEED = 330
SAMPLES_PER_MOVEMENT = 2000


def load_src_module(module_name: str):
    if "src" not in sys.modules:
        package = types.ModuleType("src")
        package.__path__ = [str(SRC_DIR)]
        sys.modules["src"] = package
    spec = importlib.util.spec_from_file_location(f"src.{module_name}", SRC_DIR / f"{module_name}.py")
    if spec is None or spec.loader is None:
        raise RuntimeError(f"No se pudo cargar src/{module_name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[f"src.{module_name}"] = module
    spec.loader.exec_module(module)
    return module


config_mod = load_src_module("config")
data_generator_mod = load_src_module("data_generator")
MOVEMENT_NAMES = config_mod.MOVEMENT_NAMES
OrquestadorConfig = config_mod.OrquestadorConfig
generate_dataset = data_generator_mod.generate_dataset
TOTAL_SAMPLES = SAMPLES_PER_MOVEMENT * len(MOVEMENT_NAMES)
TRAIN_SAMPLES = int(TOTAL_SAMPLES * 0.70)
VAL_SAMPLES = int(TOTAL_SAMPLES * 0.15)
TEST_SAMPLES = TOTAL_SAMPLES - TRAIN_SAMPLES - VAL_SAMPLES


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def split_summary(path: Path) -> dict:
    data = np.load(path)
    labels = data["labels"]
    unique, counts = np.unique(labels, return_counts=True)
    return {
        "file": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "samples": int(labels.shape[0]),
        "imu_shape": list(data["imu_features"].shape),
        "emg_shape": list(data["emg_features"].shape),
        "ecg_shape": list(data["ecg_features"].shape),
        "context_shape": list(data["context_features"].shape),
        "label_distribution": {
            MOVEMENT_NAMES[int(label)]: int(count)
            for label, count in zip(unique, counts)
        },
    }


def main() -> None:
    np.random.seed(SEED)
    DATASET_DIR.mkdir(parents=True, exist_ok=True)

    config = OrquestadorConfig(
        train_samples=TRAIN_SAMPLES,
        val_samples=VAL_SAMPLES,
        test_samples=TEST_SAMPLES,
        seed=SEED,
        batch_size=128,
        epochs=100,
        target_accuracy=0.85,
        target_f1=0.80,
    )
    generate_dataset(config, DATASET_DIR)

    manifest = {
        "schema": "ironsync.orquestador.dataset_manifest.v1",
        "dataset_name": "orquestador_mlp_multimodal_13_actions",
        "generated_by": "IA-IRON-SYNC/orquestador/generate_dataset.py",
        "seed": SEED,
        "synthetic_controlled": True,
        "samples_per_movement": SAMPLES_PER_MOVEMENT,
        "total_samples": TOTAL_SAMPLES,
        "splits": {
            "train": split_summary(DATASET_DIR / "orquestador_train.npz"),
            "val": split_summary(DATASET_DIR / "orquestador_val.npz"),
            "test": split_summary(DATASET_DIR / "orquestador_test.npz"),
        },
        "movement_names": MOVEMENT_NAMES,
        "feature_contract": {
            "imu_features": "float32 [N,45] = 15 sensores x 3 ejes",
            "emg_features": "float32 [N,3] one-hot BAJA/MEDIA/ALTA",
            "ecg_features": "float32 [N,3] one-hot CALMA/TENSION/ESTRES",
            "context_features": "float32 [N,10] energia, velocidad, simetria y regiones",
            "labels": "int64 [N] indice en movement_names",
        },
    }

    manifest_path = DATASET_DIR / "metadata" / "dataset_manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print(json.dumps({
        "ok": True,
        "dataset_dir": str(DATASET_DIR),
        "total_samples": TOTAL_SAMPLES,
        "files": [summary["file"] for summary in manifest["splits"].values()],
        "manifest": str(manifest_path),
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
