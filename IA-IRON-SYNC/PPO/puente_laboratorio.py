"""
Puente PPO con laboratorio biomech-lab y datasets IRON-SYNC.

Solo TCN + datos IMU. Sin otros modulos del pipeline.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Iterator

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
TCN_ROOT = REPO_ROOT / "IMUS_VEN" / "TCN"

if str(TCN_ROOT) not in sys.path:
    sys.path.insert(0, str(TCN_ROOT))

BONE_ORDER = [
    "hip", "chest", "head", "sL", "fL", "hL", "sR", "fR", "hR",
    "tL", "knL", "ftL", "tR", "knR", "ftR",
]


def listar_sesiones_lab(datasets_root: Path) -> list[Path]:
    if not datasets_root.exists():
        return []
    return sorted([p for p in datasets_root.iterdir() if p.is_dir()])


def cargar_fallback_sintetico(split: str = "train") -> dict[str, np.ndarray]:
    path = TCN_ROOT / "datasets" / "laboratory" / f"{split}.npz"
    if not path.exists():
        raise FileNotFoundError(f"Genera primero el TCN sintetico: {path}")
    return dict(np.load(path))


def aplicar_sanitizador_tcn(noisy: np.ndarray, mask: np.ndarray, checkpoint: Path) -> np.ndarray:
    import torch

    from src.masked_tcn_autoencoder import MaskedTCNAutoencoder
    from scripts.preprocess import denormalize_angles, pack_input

    ckpt = torch.load(checkpoint, map_location="cpu", weights_only=False)
    cfg = ckpt.get("config", {})
    window = int(cfg.get("window", noisy.shape[0]))
    model = MaskedTCNAutoencoder(
        n_frames=window,
        n_sensors=15,
        hidden=int(cfg.get("hidden", 64)),
        n_blocks=int(cfg.get("n_blocks", 4)),
    )
    model.load_state_dict(ckpt["state_dict"])
    model.eval()

    x = pack_input(noisy[None, ...], mask[None, ...])
    with torch.no_grad():
        pred_norm = model(torch.from_numpy(x).float())
    pred = denormalize_angles(pred_norm.numpy()[0])
    return pred.astype(np.float32)


def iterar_resumenes_gesto_lab(session_dir: Path) -> Iterator[dict]:
    for sub in session_dir.iterdir():
        if not sub.is_dir():
            continue
        dj = sub / "dataset.json"
        if not dj.exists():
            continue
        data = json.loads(dj.read_text(encoding="utf-8"))
        yield {"folder": sub.name, "data": data}
