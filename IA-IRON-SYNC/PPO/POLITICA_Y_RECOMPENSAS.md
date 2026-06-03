# Política, recompensas y castigos — PPO IMU

## Política (`politica_actor_critico.py`)

| Concepto | Definición |
|----------|------------|
| **Tipo** | Actor-Critic (PPO) |
| **Entrada (observación)** | TCN sanitizado + velocidad + aceleración + máscara de sensores + salida del paso anterior |
| **Salida (acción)** | 45 valores continuos: Δrx, Δry, Δrz por cada uno de los 15 IMU, en [-1, 1] |
| **Escala** | Multiplicado por `entorno.escala_accion_grados` (p. ej. 2° máx. por eje) |
| **TCN** | Congelado; no se entrena en este módulo |
| **Crítico** | Estima V(s) para ventaja GAE y pérdida de valor |

## Recompensas y castigos (`recompensas_castigos.py`)

| Término | Qué mide | Castigo / bonus típico |
|---------|----------|------------------------|
| **Suavidad** | Cambio brusco respecto al frame anterior | Negativo (jitter) |
| **Fidelidad** | Distancia al target limpio (post-TCN ideal) | Negativo |
| **Reposo** | Energía en régimen `rest` | Negativo si hay movimiento |
| **Spike** | Salto > 15° en un frame | -10 fijo |
| **Límite articular** | Fuera de `boneLimits` (rx/ry/rz) | -4 por violación |
| **Velocidad** | Velocidad angular > max del hueso | -3 por violación |
| **Padre-hijo** | Incoherencia extrema padre/hijo (>210° spread) | -2 por par |
| **Colisión** | Pares prohibidos (mano/torso, muslos, etc.) | -4 / -7 / -10 según severidad |
| **Sobre-suavizado** | Gesto plano vs target con variación | -2 en régimen `gesture` |
| **Bonus sin colisión** | Ningún par en colisión | +2 (configurable) |
| **Bonus pose válida** | Sin colisión ni límites rotos | +3 (configurable) |

Pesos en `configuracion_hiperparametros.yaml` → sección `recompensas`.

## Colisiones (`colisiones_huesos.py`)

Misma lista de pares que el laboratorio (`collisionSystem.js`): mano↔torso, mano↔cabeza, muslos cruzados, etc.

Durante el entrenamiento:
1. Python calcula colisiones (cinemática simplificada) → **castigo en la recompensa**.
2. El lab aplica la pose al **Og.FBX** y muestra colliders rojos → **feedback visual**.

## Visualización en tiempo real

1. `entrenador_ppo.py` escribe `reports/ppo_live_state.json`.
2. Relay Vite (8767) emite `ppo-live-frame`.
3. `uiController` mueve el mesh y el panel DRL/PPO.

Requisitos: relay conectado, skeletal mesh cargado, botón **Entrenar PPO**.
