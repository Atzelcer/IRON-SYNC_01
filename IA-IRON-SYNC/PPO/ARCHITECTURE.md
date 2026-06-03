# Arquitectura PPO — IMUS_VEN

## Donde esta cada pieza

| Pieza | Archivo |
|-------|---------|
| Configuracion completa | `configuracion_hiperparametros.yaml` |
| Politica | `politica_actor_critico.py` |
| Recompensas / castigos | `recompensas_castigos.py` |
| Entorno (1 worker) | `entorno_ppo.py` |
| Entorno multiple | `entorno_ppo_multiple.py` |
| Entrenamiento | `entrenador_ppo.py` + `entrenar_ppo.py` |

## Pipeline entrenamiento

```
TCN (congelada) -> entorno_ppo_multiple -> politica_actor_critico -> ppo_actor.pt
```

Este modulo PPO no incluye otros filtros del pipeline global.

Política COMPLETA realmente

mantener movimiento humano:
- suave
- estable
- anatómicamente válido
- fiel al usuario
- sin jitter
- sin drift
- sin colisiones
