"""
POLITICA DEL AGENTE PPO (Actor-Critic)

Este archivo define la red neuronal de la politica:
  - Actor: produce acciones continuas (delta rx, ry, rz por cada uno de los 15 sensores).
  - Critico: estima el valor V(s) para el algoritmo PPO.

La politica NO entrena el TCN; solo corrige la señal ya sanitizada. MLP
"""
from __future__ import annotations

import torch
import torch.nn as nn
from torch.distributions import Normal


class ActorCritico(nn.Module):
    """Red Actor-Critic: un solo agente global para los 15 IMU."""

    def __init__(self, obs_dim: int, act_dim: int, hidden: int = 256) -> None:
        super().__init__()
        # Cuerpo compartido: observacion IMU (san + vel + acc + mascara + salida previa)
        body = [obs_dim, hidden, hidden]
        layers: list[nn.Module] = []
        for i in range(len(body) - 1):
            layers += [nn.Linear(body[i], body[i + 1]), nn.Tanh()]
        self.cuerpo = nn.Sequential(*layers)

        # --- ACTOR (politica pi(a|s)) ---
        # Salida: 45 valores en [-1, 1] -> escalados a grados (delta por eje)
        self.actor_media = nn.Linear(hidden, act_dim)
        self.actor_log_std = nn.Parameter(torch.zeros(act_dim))

        # --- CRITICO (funcion valor V(s)) ---
        self.critico = nn.Linear(hidden, 1)

    def forward(self, obs: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        h = self.cuerpo(obs)
        media = torch.tanh(self.actor_media(h))
        desv = torch.exp(self.actor_log_std).expand_as(media)
        valor = self.critico(h).squeeze(-1)
        return media, desv, valor

    def actuar(
        self, obs: torch.Tensor, deterministico: bool = False
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Muestra accion desde la politica (entrenamiento o inferencia)."""
        media, desv, valor = self.forward(obs)
        if deterministico:
            accion = media
            log_prob = torch.zeros(obs.shape[0], device=obs.device)
        else:
            dist = Normal(media, desv)
            accion = dist.sample()
            log_prob = dist.log_prob(accion).sum(-1)
        return accion, log_prob, valor

    def evaluar(
        self, obs: torch.Tensor, acciones: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Evalua log-prob y valor para la actualizacion PPO (clip surrogate)."""
        media, desv, valor = self.forward(obs)
        dist = Normal(media, desv)
        log_prob = dist.log_prob(acciones).sum(-1)
        entropia = dist.entropy().sum(-1)
        return log_prob, valor, entropia


# Alias para checkpoints exportados con nombre anterior
ActorCritic = ActorCritico
