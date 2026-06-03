"""Filtro de Kalman por eje — estado [ángulo, velocidad angular]."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

try:
    from filterpy.kalman import KalmanFilter
except ImportError:
    KalmanFilter = None  # type: ignore


class BoneAxisKalman:
    def __init__(self, process_var: float = 1e-3, measure_var: float = 1e-1) -> None:
        self.process_var = process_var
        self.measure_var = measure_var
        self._kf = None
        if KalmanFilter is not None:
            self._kf = KalmanFilter(dim_x=2, dim_z=1)
            self._kf.F = np.array([[1.0, 1.0], [0.0, 1.0]])
            self._kf.H = np.array([[1.0, 0.0]])
            self._kf.P *= 5.0
            self._kf.R *= measure_var
            self._kf.Q *= process_var

    def smooth_series(self, angles: np.ndarray, dt: float = 0.02) -> np.ndarray:
        if self._kf is None:
            out = angles.copy()
            for i in range(1, len(out)):
                out[i] = 0.75 * out[i - 1] + 0.25 * angles[i]
            return out

        kf = self._kf
        kf.F[0, 1] = dt
        out = np.zeros_like(angles)
        kf.x = np.array([[angles[0]], [0.0]])
        for i, z in enumerate(angles):
            kf.predict()
            kf.update(np.array([[z]]))
            out[i] = float(kf.x[0, 0])
        return out


def load_params(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def smooth_imu_sequence(seq: np.ndarray, regime: str, params: dict) -> np.ndarray:
    """
    seq: (T, 15, 3) grados
  regime: 'rest' | 'gesture'
    """
    reg = params["regimes"].get(regime, params["regimes"][params["default_regime"]])
    pv, mv = reg["process_var"], reg["measure_var"]
    out = np.zeros_like(seq)
    for s in range(seq.shape[1]):
        for a in range(seq.shape[2]):
            kf = BoneAxisKalman(pv, mv)
            out[:, s, a] = kf.smooth_series(seq[:, s, a])
    return out
