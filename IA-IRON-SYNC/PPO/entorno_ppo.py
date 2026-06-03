"""
ENTORNO PPO — un solo rollout (1 ventana IMU a la vez).

Usado para pruebas. El entrenamiento real usa entorno_ppo_multiple.py.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from recompensas_castigos import calcular_recompensa


@dataclass
class EntornoPpo:
    windows_san: np.ndarray
    windows_target: np.ndarray
    masks: np.ndarray
    action_scale: float = 2.0
    reward_cfg: dict | None = None
    delta_segundos: float = 0.02

    def __post_init__(self) -> None:
        self.n = self.windows_san.shape[0]
        self.t = self.windows_san.shape[1]
        self.reward_cfg = self.reward_cfg or {}
        self.idx = 0
        self.frame = 0
        self.prev_out = self.windows_san[0, 0].copy()

    @property
    def obs_dim(self) -> int:
        return 15 * 3 * 3 + 15 + 15 * 3

    @property
    def act_dim(self) -> int:
        return 15 * 3

    def _obs(self) -> np.ndarray:
        san = self.windows_san[self.idx, self.frame]
        vel = np.zeros_like(san) if self.frame == 0 else san - self.windows_san[self.idx, self.frame - 1]
        acc = np.zeros_like(san) if self.frame < 2 else vel - (san - self.windows_san[self.idx, self.frame - 1])
        mask = self.masks[self.idx, self.frame]
        return np.concatenate(
            [san.flatten(), vel.flatten(), acc.flatten(), mask.flatten(), self.prev_out.flatten()]
        ).astype(np.float32)

    def reset(self) -> np.ndarray:
        self.idx = int(np.random.randint(0, self.n))
        self.frame = 0
        self.prev_out = self.windows_san[self.idx, 0].copy()
        return self._obs()

    def step(self, action: np.ndarray) -> tuple[np.ndarray, float, bool, dict]:
        action = np.clip(action, -1, 1) * self.action_scale
        delta = action.reshape(15, 3)
        san = self.windows_san[self.idx, self.frame]
        out = san + delta
        target = self.windows_target[self.idx, self.frame]
        reward, parts, bio = calcular_recompensa(
            out, target, self.prev_out, self.reward_cfg, self.delta_segundos
        )
        self.prev_out = out.copy()
        self.frame += 1
        done = self.frame >= self.t
        info = {**parts, "pose": out.tolist(), "target": target.tolist(), "bio": bio}
        return self._obs(), reward, done, info
