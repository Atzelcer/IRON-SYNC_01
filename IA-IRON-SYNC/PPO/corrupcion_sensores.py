"""Corrupcion de sensores para entorno_ppo_multiple (ruido, drift, perdida, congelado)."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class PerfilCorrupcion:
    noise_std: float = 0.0
    drift_rate: float = 0.0
    jitter_std: float = 0.0
    missing_rate: float = 0.0
    frozen_rate: float = 0.0
    biomech_profile: str = "neutral"

    def sample_sensor_mask(self, base_mask: np.ndarray, rng: np.random.Generator) -> np.ndarray:
        m = base_mask.astype(np.float32).copy()
        if self.missing_rate > 0:
            drop = rng.random(15) < self.missing_rate
            m[drop] = 0.0
        return m

    def apply(
        self,
        frame: np.ndarray,
        mask: np.ndarray,
        rng: np.random.Generator,
        frozen_state: np.ndarray | None,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        out = frame.astype(np.float32).copy()
        m = self.sample_sensor_mask(mask, rng)

        if frozen_state is not None and self.frozen_rate > 0:
            frozen = rng.random(15) < self.frozen_rate
            for s in range(15):
                if frozen[s] and m[s] > 0:
                    out[s] = frozen_state[s]

        if self.noise_std > 0:
            out += rng.normal(0, self.noise_std, out.shape).astype(np.float32) * m[:, None]

        if self.jitter_std > 0:
            out += rng.normal(0, self.jitter_std, out.shape).astype(np.float32) * m[:, None]

        if self.drift_rate > 0:
            out += (rng.random(out.shape) - 0.5) * 2.0 * self.drift_rate * m[:, None]

        profile_scale = {
            "rest": 0.85,
            "neutral": 1.0,
            "walk": 1.05,
            "gesture": 1.15,
            "sport": 1.25,
        }.get(self.biomech_profile, 1.0)
        out *= profile_scale
        return out, m, out.copy()


def muestrear_perfil(cfg_corrupcion: dict, rng: np.random.Generator) -> PerfilCorrupcion:
    """Lee rangos desde configuracion_hiperparametros.yaml -> corrupcion_sensores."""
    profiles = cfg_corrupcion.get("perfiles_biomecanicos", ["neutral", "rest", "walk", "gesture"])
    return PerfilCorrupcion(
        noise_std=float(rng.uniform(*cfg_corrupcion.get("ruido_grados_min_max", [0.0, 1.5]))),
        drift_rate=float(rng.uniform(*cfg_corrupcion.get("deriva_min_max", [0.0, 0.08]))),
        jitter_std=float(rng.uniform(*cfg_corrupcion.get("jitter_grados_min_max", [0.0, 0.6]))),
        missing_rate=float(rng.uniform(*cfg_corrupcion.get("tasa_sensor_perdido_min_max", [0.0, 0.15]))),
        frozen_rate=float(rng.uniform(*cfg_corrupcion.get("tasa_sensor_congelado_min_max", [0.0, 0.1]))),
        biomech_profile=str(rng.choice(profiles)),
    )
