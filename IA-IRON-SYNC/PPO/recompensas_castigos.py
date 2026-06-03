"""
RECOMPENSAS Y CASTIGOS DEL AGENTE PPO

Politica (politica_actor_critico.py):
  - Observacion: TCN sanitizado + velocidad + aceleracion + mascara + salida previa.
  - Accion: delta continuo (rx, ry, rz) x 15 sensores, escalado a grados.
  - Objetivo: corregir ruido/drift sin perder el gesto limpio (target).

Castigos principales (pesos en configuracion_hiperparametros.yaml -> recompensas):
  - Suavidad, fidelidad al clean, reposo en quieto, spikes, limites articulares.
  - Colision entre huesos (mano/torso, piernas cruzadas, etc.) — colisiones_huesos.py
  - Velocidad angular excesiva, incoherencia padre-hijo.

Recompensas positivas pequenas cuando no hay violaciones graves.
"""
from __future__ import annotations

import numpy as np

from colisiones_huesos import costo_severidad, evaluar_biomecanica


def regimen_desde_senal(san: np.ndarray) -> str:
    energia = float(np.mean(san ** 2))
    derivada = float(np.mean(np.abs(np.diff(san, axis=0))))
    if energia < 4.0 and derivada < 2.5:
        return "rest"
    if energia > 20.0 or derivada > 6.0:
        return "gesture"
    return "transition"


def calcular_recompensa(
    salida: np.ndarray,
    objetivo: np.ndarray,
    salida_previa: np.ndarray,
    cfg: dict,
    delta_segundos: float = 0.02,
) -> tuple[float, dict[str, float], dict]:
    pesos = cfg.get("recompensas", {})
    regimen = regimen_desde_senal(san=salida)
    bio = evaluar_biomecanica(salida, salida_previa, delta_segundos)

    castigo_suavidad = -float(np.mean(np.abs(salida - salida_previa)))
    castigo_fidelidad = -float(np.mean(np.abs(salida - objetivo)))
    castigo_reposo = -float(np.mean(salida ** 2)) if regimen == "rest" else 0.0
    castigo_spike = -10.0 if float(np.max(np.abs(salida - salida_previa))) > 15.0 else 0.0

    castigo_limite = -len(bio["limitViolations"]) * 4.0
    castigo_velocidad = -len(bio["velocityViolations"]) * 3.0
    castigo_padre_hijo = -len(bio["parentChildIssues"]) * 2.0

    colisiones = bio["collisions"]
    if colisiones:
        castigo_colision = -sum(costo_severidad(c["severity"]) for c in colisiones)
        bonus_estabilidad = -1.0
    else:
        castigo_colision = 0.0
        bonus_estabilidad = float(pesos.get("bonus_sin_colision", 2.0))

    castigo_sobre_suavizado = 0.0
    if regimen == "gesture":
        std_out, std_tgt = np.std(salida), np.std(objetivo) + 1e-6
        if std_out < 0.5 * std_tgt:
            castigo_sobre_suavizado = -2.0

    bonus_sin_violaciones = 0.0
    if not bio["limitViolations"] and not colisiones:
        bonus_sin_violaciones = float(pesos.get("bonus_pose_valida", 3.0))

    total = (
        pesos.get("peso_suavidad", 0.8) * castigo_suavidad
        + pesos.get("peso_fidelidad", 3.0) * castigo_fidelidad
        + pesos.get("peso_reposo", 4.0) * castigo_reposo
        + pesos.get("peso_spike", 5.0) * castigo_spike
        + pesos.get("peso_limite_articular", 2.5) * castigo_limite
        + pesos.get("peso_velocidad", 1.5) * castigo_velocidad
        + pesos.get("peso_padre_hijo", 1.2) * castigo_padre_hijo
        + pesos.get("peso_colision", 4.0) * castigo_colision
        + pesos.get("peso_sobre_suavizado", 2.0) * castigo_sobre_suavizado
        + bonus_estabilidad
        + bonus_sin_violaciones
    )

    desglose: dict[str, float] = {
        "suavidad": castigo_suavidad,
        "fidelidad": castigo_fidelidad,
        "reposo": castigo_reposo,
        "spike": castigo_spike,
        "limite_articular": castigo_limite,
        "velocidad": castigo_velocidad,
        "padre_hijo": castigo_padre_hijo,
        "colision": castigo_colision,
        "sobre_suavizado": castigo_sobre_suavizado,
        "bonus_estabilidad": bonus_estabilidad,
        "bonus_pose_valida": bonus_sin_violaciones,
        "num_colisiones": float(len(colisiones)),
        "recompensa_total": total,
    }
    return total, desglose, {"regimen": regimen, **bio}
