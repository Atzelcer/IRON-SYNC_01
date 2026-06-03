"""
Colisiones y reglas biomecanicas para el agente PPO.

Replica la logica del laboratorio (boneLimits + forbidden pairs + rewardEngine)
usando cinematica directa simplificada sobre los 15 huesos IMU.
"""
from __future__ import annotations

import numpy as np

BONE_ORDER = [
    "hip", "chest", "head", "sL", "fL", "hL", "sR", "fR", "hR",
    "tL", "knL", "ftL", "tR", "knR", "ftR",
]

PARENT = {
    "hip": None,
    "chest": "hip",
    "head": "chest",
    "sL": "chest",
    "fL": "sL",
    "hL": "fL",
    "sR": "chest",
    "fR": "sR",
    "hR": "fR",
    "tL": "hip",
    "knL": "tL",
    "ftL": "knL",
    "tR": "hip",
    "knR": "tR",
    "ftR": "knR",
}

OFFSET_LOCAL = {
    "hip": np.array([0.0, 0.0, 0.0], dtype=np.float32),
    "chest": np.array([0.0, 0.28, 0.0], dtype=np.float32),
    "head": np.array([0.0, 0.24, 0.0], dtype=np.float32),
    "sL": np.array([-0.18, 0.12, 0.0], dtype=np.float32),
    "fL": np.array([-0.28, 0.0, 0.0], dtype=np.float32),
    "hL": np.array([-0.26, 0.0, 0.0], dtype=np.float32),
    "sR": np.array([0.18, 0.12, 0.0], dtype=np.float32),
    "fR": np.array([0.28, 0.0, 0.0], dtype=np.float32),
    "hR": np.array([0.26, 0.0, 0.0], dtype=np.float32),
    "tL": np.array([-0.10, -0.12, 0.0], dtype=np.float32),
    "knL": np.array([0.0, -0.42, 0.0], dtype=np.float32),
    "ftL": np.array([0.0, -0.40, 0.08], dtype=np.float32),
    "tR": np.array([0.10, -0.12, 0.0], dtype=np.float32),
    "knR": np.array([0.0, -0.42, 0.0], dtype=np.float32),
    "ftR": np.array([0.0, -0.40, 0.08], dtype=np.float32),
}

RADIO_COLISION = {
    "head": 0.11,
    "chest": 0.16,
    "hip": 0.14,
    "sL": 0.06,
    "fL": 0.05,
    "hL": 0.065,
    "sR": 0.06,
    "fR": 0.05,
    "hR": 0.065,
    "tL": 0.08,
    "knL": 0.06,
    "ftL": 0.08,
    "tR": 0.08,
    "knR": 0.06,
    "ftR": 0.08,
}

BONE_LIMITS = {
    "hip": {"rx": (-25, 25), "ry": (-35, 35), "rz": (-20, 20), "maxVelocity": 140},
    "chest": {"rx": (-35, 35), "ry": (-45, 45), "rz": (-30, 30), "maxVelocity": 150},
    "head": {"rx": (-40, 40), "ry": (-70, 70), "rz": (-35, 35), "maxVelocity": 180},
    "sL": {"rx": (-105, 120), "ry": (-95, 95), "rz": (-75, 75), "maxVelocity": 220},
    "fL": {"rx": (0, 145), "ry": (-35, 35), "rz": (-75, 75), "maxVelocity": 260},
    "hL": {"rx": (-70, 80), "ry": (-45, 45), "rz": (-45, 45), "maxVelocity": 300},
    "sR": {"rx": (-105, 120), "ry": (-95, 95), "rz": (-75, 75), "maxVelocity": 220},
    "fR": {"rx": (0, 145), "ry": (-35, 35), "rz": (-75, 75), "maxVelocity": 260},
    "hR": {"rx": (-70, 80), "ry": (-45, 45), "rz": (-45, 45), "maxVelocity": 300},
    "tL": {"rx": (-45, 95), "ry": (-35, 45), "rz": (-35, 35), "maxVelocity": 180},
    "knL": {"rx": (0, 135), "ry": (-12, 12), "rz": (-12, 12), "maxVelocity": 220},
    "ftL": {"rx": (-45, 45), "ry": (-25, 25), "rz": (-25, 25), "maxVelocity": 260},
    "tR": {"rx": (-45, 95), "ry": (-35, 45), "rz": (-35, 35), "maxVelocity": 180},
    "knR": {"rx": (0, 135), "ry": (-12, 12), "rz": (-12, 12), "maxVelocity": 220},
    "ftR": {"rx": (-45, 45), "ry": (-25, 25), "rz": (-25, 25), "maxVelocity": 260},
}

PARES_PROHIBIDOS = [
    ("hL", "chest", "Mano izquierda atraviesa torso", "critical", 0.012),
    ("hR", "chest", "Mano derecha atraviesa torso", "critical", 0.012),
    ("fL", "chest", "Antebrazo izquierdo contra torso", "medium", 0.006),
    ("fR", "chest", "Antebrazo derecho contra torso", "medium", 0.006),
    ("hL", "hip", "Mano izquierda invade cadera", "high", 0.004),
    ("hR", "hip", "Mano derecha invade cadera", "high", 0.004),
    ("hL", "head", "Mano izquierda contra cabeza", "critical", 0.018),
    ("hR", "head", "Mano derecha contra cabeza", "critical", 0.018),
    ("fL", "head", "Antebrazo izquierdo cerca de cabeza", "high", 0.014),
    ("fR", "head", "Antebrazo derecho cerca de cabeza", "high", 0.014),
    ("hL", "hR", "Manos solapadas", "medium", 0.01),
    ("fL", "fR", "Antebrazos cruzados", "high", 0.006),
    ("tL", "tR", "Muslos cruzados", "high", 0.006),
    ("knL", "knR", "Rodillas cruzadas", "high", 0.01),
    ("ftL", "ftR", "Pies solapados", "medium", 0.012),
]


def _matriz_euler_xyz(rx: float, ry: float, rz: float) -> np.ndarray:
    rx, ry, rz = np.radians([rx, ry, rz])
    cx, sx = np.cos(rx), np.sin(rx)
    cy, sy = np.cos(ry), np.sin(ry)
    cz, sz = np.cos(rz), np.sin(rz)
    rx_m = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]], dtype=np.float32)
    ry_m = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], dtype=np.float32)
    rz_m = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], dtype=np.float32)
    return rz_m @ ry_m @ rx_m


def pose_a_dict(pose: np.ndarray) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for i, alias in enumerate(BONE_ORDER):
        out[alias] = {"rx": float(pose[i, 0]), "ry": float(pose[i, 1]), "rz": float(pose[i, 2])}
    return out


def posiciones_mundo(pose: np.ndarray) -> dict[str, np.ndarray]:
    rotaciones: dict[str, np.ndarray] = {}
    posiciones: dict[str, np.ndarray] = {}
    for alias in BONE_ORDER:
        R = _matriz_euler_xyz(float(pose[BONE_ORDER.index(alias), 0]),
                              float(pose[BONE_ORDER.index(alias), 1]),
                              float(pose[BONE_ORDER.index(alias), 2]))
        parent = PARENT[alias]
        offset = OFFSET_LOCAL[alias]
        if parent is None:
            rotaciones[alias] = R
            posiciones[alias] = offset.copy()
        else:
            rotaciones[alias] = rotaciones[parent] @ R
            posiciones[alias] = posiciones[parent] + rotaciones[parent] @ offset
    return posiciones


def costo_severidad(severity: str) -> float:
    if severity == "critical":
        return 10.0
    if severity == "high":
        return 7.0
    return 4.0


def detectar_colisiones(pose: np.ndarray) -> list[dict]:
    pos = posiciones_mundo(pose)
    hits: list[dict] = []
    for a, b, etiqueta, severidad, holgura in PARES_PROHIBIDOS:
        dist = float(np.linalg.norm(pos[a] - pos[b]))
        minimo = RADIO_COLISION[a] + RADIO_COLISION[b] + holgura
        if dist < minimo:
            hits.append({
                "a": a,
                "b": b,
                "label": etiqueta,
                "severity": severidad,
                "penetration": minimo - dist,
            })
    return hits


def evaluar_limites(pose: np.ndarray) -> list[dict]:
    violaciones: list[dict] = []
    for i, alias in enumerate(BONE_ORDER):
        lim = BONE_LIMITS[alias]
        for j, axis in enumerate(["rx", "ry", "rz"]):
            val = float(pose[i, j])
            vmin, vmax = lim[axis]
            if val < vmin or val > vmax:
                violaciones.append({"alias": alias, "axis": axis, "value": val, "limit": (vmin, vmax)})
    return violaciones


def evaluar_velocidad(pose: np.ndarray, previa: np.ndarray, delta_seg: float) -> tuple[float, list[dict]]:
    if delta_seg <= 0:
        return 0.0, []
    violaciones: list[dict] = []
    max_vel = 0.0
    for i, alias in enumerate(BONE_ORDER):
        delta = float(np.sum(np.abs(pose[i] - previa[i])))
        vel = delta / delta_seg
        max_vel = max(max_vel, vel)
        if vel > BONE_LIMITS[alias]["maxVelocity"]:
            violaciones.append({"alias": alias, "velocity": vel})
    return max_vel, violaciones


def evaluar_padre_hijo(pose: np.ndarray) -> list[dict]:
    rot = pose_a_dict(pose)
    problemas: list[dict] = []
    for alias, lim in BONE_LIMITS.items():
        parent = PARENT[alias]
        if not parent:
            continue
        spread = (
            abs(rot[parent]["rx"] - rot[alias]["rx"])
            + abs(rot[parent]["ry"] - rot[alias]["ry"])
            + abs(rot[parent]["rz"] - rot[alias]["rz"])
        )
        if spread > 210:
            problemas.append({"alias": alias, "parent": parent, "spread": spread})
    return problemas


def evaluar_biomecanica(
    pose: np.ndarray,
    previa: np.ndarray,
    delta_segundos: float = 0.02,
) -> dict:
    colisiones = detectar_colisiones(pose)
    limites = evaluar_limites(pose)
    max_vel, vel_viol = evaluar_velocidad(pose, previa, delta_segundos)
    padre_hijo = evaluar_padre_hijo(pose)
    return {
        "collisions": colisiones,
        "limitViolations": limites,
        "velocityViolations": vel_viol,
        "parentChildIssues": padre_hijo,
        "maxVelocity": max_vel,
    }
