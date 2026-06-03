"""Carga ventanas IMU y sanitizado TCN en lote."""
from __future__ import annotations

from pathlib import Path

import numpy as np

from puente_laboratorio import aplicar_sanitizador_tcn, cargar_fallback_sintetico


def sanitizar_tcn_en_lote(
    noisy: np.ndarray,
    mask: np.ndarray,
    checkpoint: Path,
    batch_size: int = 64,
) -> np.ndarray:
    import torch

    from src.masked_tcn_autoencoder import MaskedTCNAutoencoder
    from scripts.preprocess import denormalize_angles, pack_input

    ckpt = torch.load(checkpoint, map_location="cpu", weights_only=False)
    cfg = ckpt.get("config", {})
    window = int(cfg.get("window", noisy.shape[1]))
    model = MaskedTCNAutoencoder(
        n_frames=window,
        n_sensors=15,
        hidden=int(cfg.get("hidden", 64)),
        n_blocks=int(cfg.get("n_blocks", 4)),
    )
    model.load_state_dict(ckpt["state_dict"])
    model.eval()

    n = noisy.shape[0]
    out = np.zeros_like(noisy, dtype=np.float32)
    for start in range(0, n, batch_size):
        end = min(start + batch_size, n)
        x = pack_input(noisy[start:end], mask[start:end])
        with torch.no_grad():
            pred = model(torch.from_numpy(x).float())
        out[start:end] = denormalize_angles(pred.numpy())
    return out


def cargar_ventanas_entrenamiento(
    cfg: dict, paths: dict[str, Path], max_windows: int | None = None
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    datos = cfg.get("datos", {})
    split = datos.get("particion", "train")
    limit = max_windows or datos.get("max_ventanas")
    data = cargar_fallback_sintetico(split)
    noisy, clean, mask = data["noisy"], data["clean"], data["mask"]
    if limit:
        noisy, clean, mask = noisy[:limit], clean[:limit], mask[:limit]

    tcn_path = paths["tcn_checkpoint"]
    if not tcn_path.exists():
        raise FileNotFoundError(f"TCN requerida para PPO: {tcn_path}")

    batch = int(datos.get("lote_sanitizado_tcn", 64))
    san = sanitizar_tcn_en_lote(noisy, mask, tcn_path, batch_size=batch)
    return san.astype(np.float32), clean.astype(np.float32), mask.astype(np.float32)
