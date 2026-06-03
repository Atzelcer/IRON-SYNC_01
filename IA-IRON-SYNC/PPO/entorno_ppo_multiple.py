"""
ENTORNO PPO MULTIPLE — varios rollouts en paralelo (NUM_ENVS).

Cada worker tiene su perfil de corrupcion de sensores.
Un solo agente global (politica en politica_actor_critico.py) aprende sobre todos.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from corrupcion_sensores import PerfilCorrupcion, muestrear_perfil
from recompensas_castigos import calcular_recompensa


@dataclass
class EntornoPpoMultiple:
    windows_san: np.ndarray
    windows_target: np.ndarray
    masks: np.ndarray
    num_envs: int
    action_scale: float
    reward_cfg: dict
    corruption_cfg: dict
    seed: int = 42
    delta_segundos: float = 0.02

    def __post_init__(self) -> None:
        self.rng = np.random.default_rng(self.seed)
        self.envs = [
            _WorkerEntorno(
                self.windows_san,
                self.windows_target,
                self.masks,
                self.action_scale,
                self.reward_cfg,
                muestrear_perfil(self.corruption_cfg, self.rng),
                seed=int(self.seed + i * 17),
                delta_segundos=self.delta_segundos,
            )
            for i in range(self.num_envs)
        ]
        self.obs_dim = self.envs[0].obs_dim
        self.act_dim = self.envs[0].act_dim

    def reset(self) -> np.ndarray:
        return np.stack([e.reset() for e in self.envs], axis=0)

    def step(self, actions: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[dict]]:
        obs_list, rew_list, done_list, info_list = [], [], [], []
        for i, env in enumerate(self.envs):
            o, r, d, info = env.step(actions[i])
            obs_list.append(o)
            rew_list.append(r)
            done_list.append(d)
            info_list.append(info)
        return (
            np.stack(obs_list, axis=0),
            np.asarray(rew_list, dtype=np.float32),
            np.asarray(done_list, dtype=bool),
            info_list,
        )


@dataclass
class _WorkerEntorno:
    windows_san: np.ndarray
    windows_target: np.ndarray
    masks: np.ndarray
    action_scale: float
    reward_cfg: dict
    profile: PerfilCorrupcion
    seed: int
    delta_segundos: float = 0.02
    n: int = field(init=False)
    t: int = field(init=False)
    idx: int = 0
    frame: int = 0
    prev_out: np.ndarray = field(default_factory=lambda: np.zeros((15, 3), dtype=np.float32))
    _frozen: np.ndarray = field(default_factory=lambda: np.zeros((15, 3), dtype=np.float32))
    _prev_san: np.ndarray | None = None
    _prev_vel: np.ndarray | None = None
    rng: np.random.Generator = field(default_factory=np.random.default_rng)

    def __post_init__(self) -> None:
        self.rng = np.random.default_rng(self.seed)
        self.n = self.windows_san.shape[0]
        self.t = self.windows_san.shape[1]

    @property
    def obs_dim(self) -> int:
        return 15 * 3 * 3 + 15 + 15 * 3

    @property
    def act_dim(self) -> int:
        return 15 * 3

    def _corrupt_frame(self) -> tuple[np.ndarray, np.ndarray]:
        raw = self.windows_san[self.idx, self.frame]
        base_mask = self.masks[self.idx, self.frame]
        san, mask, frozen = self.profile.apply(raw, base_mask, self.rng, self._frozen)
        self._frozen = frozen
        return san, mask

    def _obs(self, san: np.ndarray, mask: np.ndarray) -> np.ndarray:
        if self._prev_san is None:
            vel = np.zeros_like(san)
            acc = np.zeros_like(san)
        else:
            vel = san - self._prev_san
            acc = vel - self._prev_vel if self._prev_vel is not None else np.zeros_like(san)
        return np.concatenate(
            [san.flatten(), vel.flatten(), acc.flatten(), mask.flatten(), self.prev_out.flatten()]
        ).astype(np.float32)

    def reset(self) -> np.ndarray:
        self.idx = int(self.rng.integers(0, self.n))
        self.frame = 0
        san, mask = self._corrupt_frame()
        self.prev_out = san.copy()
        self._prev_san = san.copy()
        self._prev_vel = np.zeros_like(san)
        return self._obs(san, mask)

    def step(self, action: np.ndarray) -> tuple[np.ndarray, float, bool, dict]:
        san, mask = self._corrupt_frame()
        delta = np.clip(action, -1, 1).reshape(15, 3) * self.action_scale
        out = san + delta
        target = self.windows_target[self.idx, self.frame]
        reward, parts, bio = calcular_recompensa(
            out, target, self.prev_out, self.reward_cfg, self.delta_segundos
        )
        self.prev_out = out.copy()

        vel = san - self._prev_san if self._prev_san is not None else np.zeros_like(san)
        self._prev_vel = vel.copy()
        self._prev_san = san.copy()

        self.frame += 1
        done = self.frame >= self.t
        info = {**parts, "pose": out.tolist(), "target": target.tolist(), "bio": bio}
        if done:
            return self.reset(), float(reward), True, info
        san_n, mask_n = self._corrupt_frame()
        return self._obs(san_n, mask_n), float(reward), False, info
