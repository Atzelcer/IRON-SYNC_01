"""
Inferencia PPO: TCN sanitizador + politica Actor-Critic.

Solo modulos de este carpeta PPO. Post-procesado adicional va fuera (p. ej. modulo KALMAN/).
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

PPO_ROOT = Path(__file__).resolve().parent
TCN_ROOT = PPO_ROOT.parent / "TCN"
if str(PPO_ROOT) not in sys.path:
    sys.path.insert(0, str(PPO_ROOT))
if str(TCN_ROOT) not in sys.path:
    sys.path.insert(0, str(TCN_ROOT))

from politica_actor_critico import ActorCritico
from puente_laboratorio import aplicar_sanitizador_tcn


class InferenciaPpo:
    def __init__(self, tcn_path: Path, ppo_path: Path | None = None) -> None:
        import torch

        self.tcn_path = tcn_path
        self._ppo = None
        self._device = torch.device("cpu")

        if ppo_path and ppo_path.exists():
            ckpt = torch.load(ppo_path, map_location="cpu", weights_only=False)
            obs_dim = int(ckpt["obs_dim"])
            act_dim = int(ckpt["act_dim"])
            cfg_ckpt = ckpt.get("config", {})
            ent_cfg = cfg_ckpt.get("entrenamiento") or cfg_ckpt.get("training", {})
            hidden = int(ent_cfg.get("neuronas_ocultas") or ent_cfg.get("hidden_size", 256))
            env_cfg = cfg_ckpt.get("entorno") or cfg_ckpt.get("env", {})
            self._ppo = ActorCritico(obs_dim, act_dim, hidden=hidden)
            self._ppo.load_state_dict(ckpt["actor"])
            self._ppo.eval()
            self.escala_accion = float(env_cfg.get("escala_accion_grados", 2.0))
        else:
            self.escala_accion = 2.0

        self.salida_prev = np.zeros((15, 3), dtype=np.float32)
        self._san_prev: np.ndarray | None = None
        self._vel_prev: np.ndarray | None = None

    def procesar_ventana(self, noisy: np.ndarray, mask: np.ndarray) -> dict[str, np.ndarray]:
        tcn_out = aplicar_sanitizador_tcn(noisy, mask, self.tcn_path)
        ppo_out = tcn_out.copy()

        if self._ppo is not None:
            import torch

            outs = []
            self.salida_prev = tcn_out[0].copy()
            self._san_prev = None
            self._vel_prev = None
            for t in range(tcn_out.shape[0]):
                san = tcn_out[t]
                m = mask[t]
                if self._san_prev is None:
                    vel = np.zeros_like(san)
                    acc = np.zeros_like(san)
                else:
                    vel = san - self._san_prev
                    acc = vel - self._vel_prev if self._vel_prev is not None else np.zeros_like(san)
                obs = np.concatenate(
                    [san.flatten(), vel.flatten(), acc.flatten(), m.flatten(), self.salida_prev.flatten()]
                ).astype(np.float32)
                with torch.no_grad():
                    act, _, _ = self._ppo.actuar(torch.from_numpy(obs[None, :]), deterministico=True)
                delta = act.numpy()[0].reshape(15, 3) * self.escala_accion
                frame_out = san + delta
                outs.append(frame_out)
                self.salida_prev = frame_out.copy()
                self._vel_prev = vel.copy()
                self._san_prev = san.copy()
            ppo_out = np.stack(outs, axis=0)

        return {
            "entrada": noisy.astype(np.float32),
            "tcn": tcn_out.astype(np.float32),
            "ppo": ppo_out.astype(np.float32),
            "salida": ppo_out.astype(np.float32),
        }
