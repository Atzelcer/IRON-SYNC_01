"""
Entrenador PPO — bucle principal del agente.

Usa:
  - politica_actor_critico.py   -> politica (Actor-Critic)
  - recompensas_castigos.py     -> recompensas por paso
  - entorno_ppo_multiple.py     -> rollouts paralelos
  - configuracion_hiperparametros.yaml -> todos los hiperparametros
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch
import torch.nn as nn

from entorno_ppo_multiple import EntornoPpoMultiple
from politica_actor_critico import ActorCritico
from puente_visualizacion_laboratorio import PuenteVisualizacionLaboratorio


@dataclass
class BufferRollout:
    obs: list[np.ndarray]
    actions: list[np.ndarray]
    log_probs: list[np.ndarray]
    rewards: list[np.ndarray]
    values: list[np.ndarray]
    dones: list[np.ndarray]

    def clear(self) -> None:
        self.obs.clear()
        self.actions.clear()
        self.log_probs.clear()
        self.rewards.clear()
        self.values.clear()
        self.dones.clear()


class EntrenadorPpo:
    def __init__(self, env: EntornoPpoMultiple, cfg: dict, paths: dict[str, Path]) -> None:
        self.env = env
        self.cfg = cfg
        self.paths = paths
        ent = cfg["entrenamiento"]
        self.rollout_steps = int(ent["pasos_por_rollout"])
        self.n_epochs = int(ent["epocas_por_actualizacion"])
        self.batch_size = int(ent["tamano_lote"])
        self.gamma = float(ent["gamma"])
        self.gae_lambda = float(ent["gae_lambda"])
        self.clip_range = float(ent["clip_rango"])
        self.ent_coef = float(ent["coeficiente_entropia"])
        self.vf_coef = float(ent["coeficiente_valor"])
        self.max_grad_norm = float(ent["norma_gradiente_max"])
        self.total_timesteps = int(ent["pasos_totales"])
        self.save_every = int(ent.get("guardar_cada_rollouts", 10))

        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        hidden = int(ent.get("neuronas_ocultas", 256))
        self.politica = ActorCritico(env.obs_dim, env.act_dim, hidden=hidden).to(self.device)
        self.optimizer = torch.optim.Adam(self.politica.parameters(), lr=float(ent["tasa_aprendizaje"]))

        self.buffer = BufferRollout([], [], [], [], [], [])
        self.history: list[dict] = []
        self.best_mean_reward = -1e18
        self.global_step = 0
        self._rollout_id = 0

        vis = cfg.get("visualizacion_laboratorio", {})
        self.puente_visual = PuenteVisualizacionLaboratorio(
            paths["reports_dir"],
            activo=bool(vis.get("activo", True)),
            cada_n_pasos=int(vis.get("cada_n_pasos", 1)),
        )

        paths["output_dir"].mkdir(parents=True, exist_ok=True)
        paths["reports_dir"].mkdir(parents=True, exist_ok=True)
        (paths["output_dir"] / "checkpoints").mkdir(parents=True, exist_ok=True)

    def _collect_rollout(self) -> float:
        obs = self.env.reset()
        ep_rewards: list[float] = []
        for step_idx in range(self.rollout_steps):
            obs_t = torch.from_numpy(obs).float().to(self.device)
            with torch.no_grad():
                action, log_prob, value = self.politica.actuar(obs_t)
            action_np = action.cpu().numpy()
            next_obs, rewards, dones, infos = self.env.step(action_np)

            if self.puente_visual.activo and infos:
                info0 = infos[0]
                bio = info0.get("bio", {})
                breakdown = {
                    k: float(v)
                    for k, v in info0.items()
                    if isinstance(v, (int, float)) and not k.startswith("_")
                }
                self.puente_visual.emitir({
                    "rollout": self._rollout_id,
                    "step": step_idx,
                    "global_step": self.global_step,
                    "reward": float(rewards[0]),
                    "reward_breakdown": breakdown,
                    "pose": info0.get("pose"),
                    "target": info0.get("target"),
                    "collisions": bio.get("collisions", []),
                    "regimen": bio.get("regimen", ""),
                })

            self.buffer.obs.append(obs.copy())
            self.buffer.actions.append(action_np)
            self.buffer.log_probs.append(log_prob.cpu().numpy())
            self.buffer.rewards.append(rewards.copy())
            self.buffer.values.append(value.cpu().numpy())
            self.buffer.dones.append(dones.astype(np.float32))

            ep_rewards.extend(rewards.tolist())
            obs = next_obs
            self.global_step += self.env.num_envs

        with torch.no_grad():
            last_v = self.politica.actuar(torch.from_numpy(obs).float().to(self.device))[2].cpu().numpy()
        self.buffer.values.append(last_v)
        return float(np.mean(ep_rewards))

    def _compute_gae(self) -> tuple[np.ndarray, np.ndarray]:
        rewards = np.concatenate(self.buffer.rewards)
        values = np.stack(self.buffer.values, axis=0).reshape(-1)
        dones = np.concatenate(self.buffer.dones)
        adv = np.zeros_like(rewards)
        last_gae = 0.0
        for t in reversed(range(len(rewards))):
            next_non_terminal = 1.0 - dones[t]
            next_value = values[t + 1]
            delta = rewards[t] + self.gamma * next_value * next_non_terminal - values[t]
            last_gae = delta + self.gamma * self.gae_lambda * next_non_terminal * last_gae
            adv[t] = last_gae
        returns = adv + values[: len(rewards)]
        return adv, returns

    def _update(self) -> dict[str, float]:
        obs = np.concatenate(self.buffer.obs)
        actions = np.concatenate(self.buffer.actions)
        old_log_probs = np.concatenate(self.buffer.log_probs)
        adv, returns = self._compute_gae()
        adv = (adv - adv.mean()) / (adv.std() + 1e-8)

        n = len(obs)
        indices = np.arange(n)
        policy_losses, value_losses, entropies = [], [], []

        for _ in range(self.n_epochs):
            np.random.shuffle(indices)
            for start in range(0, n, self.batch_size):
                end = min(start + self.batch_size, n)
                batch = indices[start:end]
                b_obs = torch.from_numpy(obs[batch]).float().to(self.device)
                b_act = torch.from_numpy(actions[batch]).float().to(self.device)
                b_old = torch.from_numpy(old_log_probs[batch]).float().to(self.device)
                b_adv = torch.from_numpy(adv[batch]).float().to(self.device)
                b_ret = torch.from_numpy(returns[batch]).float().to(self.device)

                log_prob, value, entropy = self.politica.evaluar(b_obs, b_act)
                ratio = torch.exp(log_prob - b_old)
                surr1 = ratio * b_adv
                surr2 = torch.clamp(ratio, 1.0 - self.clip_range, 1.0 + self.clip_range) * b_adv
                policy_loss = -torch.min(surr1, surr2).mean()
                value_loss = nn.functional.mse_loss(value, b_ret)
                loss = policy_loss + self.vf_coef * value_loss - self.ent_coef * entropy.mean()

                self.optimizer.zero_grad(set_to_none=True)
                loss.backward()
                nn.utils.clip_grad_norm_(self.politica.parameters(), self.max_grad_norm)
                self.optimizer.step()

                policy_losses.append(float(policy_loss.item()))
                value_losses.append(float(value_loss.item()))
                entropies.append(float(entropy.mean().item()))

        self.buffer.clear()
        return {
            "policy_loss": float(np.mean(policy_losses)),
            "value_loss": float(np.mean(value_losses)),
            "entropy": float(np.mean(entropies)),
        }

    def _save_checkpoint(self, path: Path, metrics: dict, best: bool = False) -> None:
        payload = {
            "schema": self.cfg.get("esquema", "ironsync.imus_ven.ppo.actor.v1"),
            "config": self.cfg,
            "obs_dim": self.env.obs_dim,
            "act_dim": self.env.act_dim,
            "actor": self.politica.state_dict(),
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "metrics": metrics,
            "best": best,
        }
        torch.save(payload, path)

    def train(self) -> Path:
        rollout_id = 0
        actor_path = self.paths.get("actor_checkpoint", self.paths["output_dir"] / "ppo_actor.pt")

        while self.global_step < self.total_timesteps:
            self._rollout_id = rollout_id + 1
            mean_reward = self._collect_rollout()
            stats = self._update()
            rollout_id += 1
            row = {
                "rollout": rollout_id,
                "global_step": self.global_step,
                "mean_reward": mean_reward,
                **stats,
            }
            self.history.append(row)
            print(
                f"rollout {rollout_id} | step {self.global_step} | "
                f"reward {mean_reward:.3f} | pi {stats['policy_loss']:.4f} | v {stats['value_loss']:.4f}"
            )

            if mean_reward > self.best_mean_reward:
                self.best_mean_reward = mean_reward
                self._save_checkpoint(actor_path, row, best=True)

            if rollout_id % self.save_every == 0:
                ckpt = self.paths["output_dir"] / "checkpoints" / f"ppo_rollout_{rollout_id:04d}.pt"
                self._save_checkpoint(ckpt, row, best=False)

        if not actor_path.exists():
            self._save_checkpoint(actor_path, self.history[-1] if self.history else {}, best=True)

        self._write_reports()
        self.puente_visual.cerrar()
        return actor_path

    def _write_reports(self) -> None:
        report_dir = self.paths["reports_dir"]
        (report_dir / "training_metrics.json").write_text(
            json.dumps(self.history, indent=2),
            encoding="utf-8",
        )
        if not self.history:
            return
        x = [h["rollout"] for h in self.history]
        fig, ax = plt.subplots(1, 2, figsize=(10, 4))
        ax[0].plot(x, [h["mean_reward"] for h in self.history])
        ax[0].set_title("Recompensa media")
        ax[1].plot(x, [h["policy_loss"] for h in self.history], label="politica")
        ax[1].plot(x, [h["value_loss"] for h in self.history], label="valor")
        ax[1].legend()
        ax[1].set_title("Perdidas")
        plt.tight_layout()
        plt.savefig(report_dir / "training_curves.png", dpi=120)
        plt.close()
