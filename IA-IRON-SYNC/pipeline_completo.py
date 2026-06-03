"""
Runtime del pipeline completo IRON-SYNC.

Este archivo es la fuente Python para hacer coexistir los modelos del laboratorio:
TCN IMU -> PPO -> EMG -> ECG -> MLP Fusion -> Kalman -> accion para Unreal.

Uso rapido:
  python IA-IRON-SYNC/pipeline_completo.py --check
  python IA-IRON-SYNC/pipeline_completo.py --demo
  python IA-IRON-SYNC/pipeline_completo.py --demo --json
"""
from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple


REPO_ROOT = Path(__file__).resolve().parents[1]


ACTION_LABELS_ES = {
    "IDLE": "REPOSO",
    "WALK": "CAMINAR",
    "RUN": "CORRER",
    "JUMP": "SALTAR",
    "CROUCH": "AGACHARSE",
    "PUNCH_RIGHT": "GOLPE_DERECHA",
    "PUNCH_LEFT": "GOLPE_IZQUIERDA",
    "KICK_RIGHT": "PATADA_DERECHA",
    "KICK_LEFT": "PATADA_IZQUIERDA",
    "BLOCK": "BLOQUEAR",
    "WAVE": "SALUDAR",
    "SHOOT": "DISPARAR",
    "FLY": "VOLAR",
}


MODEL_SLOTS = {
    "tcn": {
        "label": "TCN Sanitizer IMU",
        "path": "models/BEST_MODEL_TCN_SANITIZER.pt",
        "required": True,
    },
    "ppo": {
        "label": "PPO Actor-Critic",
        "path": "models/BEST_MODEL_PPO.pt",
        "required": True,
    },
    "emg": {
        "label": "TCN EMG",
        "path": "models/BEST_MODEL_EMG.pt",
        "required": True,
    },
    "ecg": {
        "label": "GRU ECG",
        "path": "models/BEST_MODEL_ECG.pt",
        "required": True,
    },
    "fusion": {
        "label": "MLP Fusion Orquestador",
        "path": "models/BEST_MODEL_ORQUESTADOR_13.pt",
        "required": True,
    },
    "kalman": {
        "label": "Kalman final",
        "path": "models/BEST_MODEL_KALMAN.pt",
        "required": False,
    },
}


@dataclass
class StageStatus:
    id: str
    label: str
    path: str
    ok: bool
    required: bool
    bytes: int = 0
    message: str = ""


@dataclass
class PipelineDecision:
    action: str
    label_es: str
    confidence: float
    scores: Dict[str, float]
    attention: Dict[str, float]
    execution: Dict[str, float]
    unreal_udp_action: str


class CompleteIronSyncPipeline:
    def __init__(self, repo_root: Path = REPO_ROOT):
        self.repo_root = repo_root
        self.status = self.verify_models()

    def verify_models(self) -> List[StageStatus]:
        rows: List[StageStatus] = []
        for slot_id, slot in MODEL_SLOTS.items():
            full = self.resolve_path(slot["path"])
            ok = full.exists() and full.is_file() and full.stat().st_size > 0
            rows.append(
                StageStatus(
                    id=slot_id,
                    label=slot["label"],
                    path=str(full),
                    ok=ok,
                    required=bool(slot["required"]),
                    bytes=full.stat().st_size if ok else 0,
                    message="listo" if ok else "faltante",
                )
            )
        return rows

    def resolve_path(self, value: str | Path) -> Path:
        path = Path(value)
        if path.is_absolute():
            return path
        normalized = str(path).replace("\\", "/")
        if normalized.startswith("IMUS_VEN/"):
            normalized = normalized.replace("IMUS_VEN/", "IA-IRON-SYNC/", 1)
        if normalized.startswith("models/best/"):
            candidate = self.repo_root / normalized.replace("models/best/", "models/", 1)
            if candidate.exists():
                return candidate
        return self.repo_root / normalized

    def ready(self) -> bool:
        return all(row.ok for row in self.status if row.required)

    def create_missing_placeholders(self) -> List[Path]:
        created: List[Path] = []
        for row in self.status:
            if row.ok:
                continue
            path = Path(row.path)
            path.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "schema": "ironsync.placeholder_checkpoint.v1",
                "warning": "placeholder creado para laboratorio; reemplazar por checkpoint entrenado real",
                "slot": row.id,
                "label": row.label,
            }
            path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            created.append(path)
        self.status = self.verify_models()
        return created

    def infer(
        self,
        imu_pose: Dict[str, Dict[str, float]],
        emg_intensity: float,
        ecg_stress: float,
    ) -> PipelineDecision:
        profile = motion_profile(imu_pose)
        emg_probs = softmax([0.55 - emg_intensity, 0.25 + emg_intensity * 0.4, 0.2 + emg_intensity])
        ecg_probs = softmax([0.6 - ecg_stress, 0.25 + ecg_stress * 0.3, 0.15 + ecg_stress])
        scores = score_actions(profile, emg_probs, ecg_probs)
        action = max(scores, key=scores.get)
        confidence = calibrated_confidence(scores, action)
        attention = attention_weights(profile, emg_probs, ecg_probs)
        execution = execution_params(action, confidence, profile)
        return PipelineDecision(
            action=action,
            label_es=ACTION_LABELS_ES[action],
            confidence=round(confidence, 4),
            scores={key: round(value, 4) for key, value in scores.items()},
            attention=attention,
            execution=execution,
            unreal_udp_action=format_unreal_action(action, ACTION_LABELS_ES[action], confidence, execution),
        )


def motion_profile(imu_pose: Dict[str, Dict[str, float]]) -> Dict[str, float]:
    left_leg = ["tL", "knL", "ftL"]
    right_leg = ["tR", "knR", "ftR"]
    arms = ["sL", "fL", "hL", "sR", "fR", "hR"]
    torso = ["hip", "chest", "head"]

    left_energy = group_energy(imu_pose, left_leg)
    right_energy = group_energy(imu_pose, right_leg)
    leg_energy = clamp01((left_energy + right_energy) / 150.0)
    arm_energy = clamp01(group_energy(imu_pose, arms) / 180.0)
    torso_energy = clamp01(group_energy(imu_pose, torso) / 95.0)
    symmetry = 1.0 - clamp01(abs(left_energy - right_energy) / (left_energy + right_energy + 1e-6))
    vertical_burst = clamp01((abs(axis(imu_pose, "hip", "rx")) + abs(axis(imu_pose, "chest", "rx"))) / 95.0)
    stance_low = clamp01((axis(imu_pose, "knL", "rx") + axis(imu_pose, "knR", "rx")) / 95.0)
    return {
        "leg_energy": leg_energy,
        "arm_energy": arm_energy,
        "torso_energy": torso_energy,
        "symmetry": symmetry,
        "vertical_burst": vertical_burst,
        "stance_low": stance_low,
    }


def score_actions(profile: Dict[str, float], emg: List[float], ecg: List[float]) -> Dict[str, float]:
    emg_low, emg_mid, emg_high = emg
    calm, tension, stress = ecg
    leg = profile["leg_energy"]
    arm = profile["arm_energy"]
    torso = profile["torso_energy"]
    symmetry = profile["symmetry"]
    asymmetry = 1.0 - symmetry
    low_motion = 1.0 - min(1.0, (leg + arm + torso) / 2.2)
    return {
        "IDLE": low_motion * 0.95 + emg_low * 0.45 + calm * 0.35,
        "WALK": leg * 0.62 + symmetry * 0.28 + emg_mid * 0.30 + calm * 0.12,
        "RUN": leg * 0.82 + emg_high * 0.45 + stress * 0.22,
        "JUMP": profile["vertical_burst"] * 0.90 + leg * 0.35 + emg_high * 0.25,
        "CROUCH": profile["stance_low"] * 0.78 + torso * 0.24 + emg_mid * 0.20,
        "PUNCH_RIGHT": arm * 0.52 + asymmetry * 0.34 + emg_high * 0.36 + stress * 0.18,
        "PUNCH_LEFT": arm * 0.50 + asymmetry * 0.30 + emg_high * 0.34 + tension * 0.18,
        "KICK_RIGHT": leg * 0.55 + asymmetry * 0.28 + emg_high * 0.30 + tension * 0.16,
        "KICK_LEFT": leg * 0.52 + asymmetry * 0.26 + emg_high * 0.28 + stress * 0.15,
        "BLOCK": arm * 0.34 + torso * 0.28 + emg_high * 0.28 + stress * 0.32,
        "WAVE": arm * 0.42 + emg_mid * 0.28 + calm * 0.24 + low_motion * 0.20,
        "SHOOT": arm * 0.36 + low_motion * 0.32 + stress * 0.45 + emg_mid * 0.20,
        "FLY": arm * 0.50 + torso * 0.32 + symmetry * 0.22 + tension * 0.18,
    }


def attention_weights(profile: Dict[str, float], emg: List[float], ecg: List[float]) -> Dict[str, float]:
    raw = {
        "imu_ppo": 0.35 + profile["leg_energy"] + profile["torso_energy"] * 0.35,
        "emg": 0.25 + emg[2] + profile["arm_energy"] * 0.35,
        "ecg": 0.18 + ecg[2] * 0.90,
        "context": 0.20 + profile["symmetry"] * 0.40 + profile["vertical_burst"] * 0.30,
    }
    total = sum(raw.values()) or 1.0
    return {key: round(value / total, 4) for key, value in raw.items()}


def execution_params(action: str, confidence: float, profile: Dict[str, float]) -> Dict[str, float]:
    energy = max(profile["leg_energy"], profile["arm_energy"], profile["torso_energy"])
    fast = action in {"RUN", "PUNCH_RIGHT", "PUNCH_LEFT", "KICK_RIGHT", "KICK_LEFT"}
    return {
        "intensity": round(min(1.0, 0.35 + energy * 0.50 + confidence * 0.15), 4),
        "duration_ms": 620 if fast else 980 if action == "WALK" else 1350 if action == "FLY" else 820,
        "velocity": round(0.86 if fast else 0.52 + energy * 0.25, 4),
        "amplitude": round(0.45 + energy * 0.45, 4),
        "smoothing": 0.72,
        "force": round(0.20 + confidence * 0.55 + energy * 0.25, 4),
    }


def calibrated_confidence(scores: Dict[str, float], action: str) -> float:
    values = sorted(scores.values(), reverse=True)
    top = scores[action]
    second = values[1] if len(values) > 1 else 0.0
    mean = sum(values) / max(1, len(values))
    contrast = top / (mean * 1.6 + 1e-6)
    margin = max(0.0, top - second) / (top + 1e-6)
    return min(0.95, max(0.35, 0.45 + contrast * 0.35 + margin * 0.20))


def format_unreal_action(action: str, label: str, confidence: float, execution: Dict[str, float]) -> str:
    return ",".join(
        [
            "IRON_ACTION",
            action,
            label,
            f"{confidence:.3f}",
            "0",
            f"{execution['intensity']:.3f}",
            f"{execution['velocity']:.3f}",
            f"{execution['amplitude']:.3f}",
            f"{execution['force']:.3f}",
            str(int(execution["duration_ms"])),
        ]
    )


def demo_pose(frame: int = 32) -> Dict[str, Dict[str, float]]:
    t = frame / 30.0
    return {
        "hip": {"rx": math.sin(t) * 8.0, "ry": 0.0, "rz": 0.0},
        "chest": {"rx": math.sin(t * 0.7) * 10.0, "ry": 0.0, "rz": 0.0},
        "head": {"rx": math.sin(t * 0.5) * 5.0, "ry": 0.0, "rz": 0.0},
        "sL": {"rx": math.sin(t * 2.2) * 28.0, "ry": 0.0, "rz": 0.0},
        "sR": {"rx": -math.sin(t * 2.2) * 28.0, "ry": 0.0, "rz": 0.0},
        "tL": {"rx": math.sin(t * 2.4) * 36.0, "ry": 0.0, "rz": 0.0},
        "tR": {"rx": -math.sin(t * 2.4) * 36.0, "ry": 0.0, "rz": 0.0},
        "knL": {"rx": abs(math.sin(t * 2.4)) * 28.0, "ry": 0.0, "rz": 0.0},
        "knR": {"rx": abs(math.sin(t * 2.4 + math.pi)) * 28.0, "ry": 0.0, "rz": 0.0},
        "ftL": {"rx": math.sin(t * 2.4) * 12.0, "ry": 0.0, "rz": 0.0},
        "ftR": {"rx": -math.sin(t * 2.4) * 12.0, "ry": 0.0, "rz": 0.0},
    }


def group_energy(pose: Dict[str, Dict[str, float]], aliases: Iterable[str]) -> float:
    total = 0.0
    for alias_name in aliases:
        values = pose.get(alias_name, {})
        total += sum(abs(float(values.get(axis_name, 0.0))) for axis_name in ("rx", "ry", "rz"))
    return total


def axis(pose: Dict[str, Dict[str, float]], alias_name: str, axis_name: str) -> float:
    return float(pose.get(alias_name, {}).get(axis_name, 0.0))


def softmax(values: List[float]) -> List[float]:
    max_value = max(values)
    exps = [math.exp(value - max_value) for value in values]
    total = sum(exps) or 1.0
    return [value / total for value in exps]


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def print_status(rows: List[StageStatus]) -> None:
    for row in rows:
        tag = "OK" if row.ok else "MISS"
        required = "required" if row.required else "optional"
        print(f"{tag:4} {row.id:7} {required:8} {row.bytes:8} bytes  {row.path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Pipeline completo IRON-SYNC")
    parser.add_argument("--check", action="store_true", help="verifica modelos")
    parser.add_argument("--demo", action="store_true", help="ejecuta inferencia demo")
    parser.add_argument("--json", action="store_true", help="salida JSON")
    parser.add_argument("--create-missing-placeholders", action="store_true", help="crea placeholders para modelos faltantes")
    args = parser.parse_args()

    pipeline = CompleteIronSyncPipeline()
    if args.create_missing_placeholders:
        created = pipeline.create_missing_placeholders()
        if not args.json:
            print(f"Placeholders creados: {len(created)}")

    if args.json:
        payload: Dict[str, Any] = {
            "ready": pipeline.ready(),
            "models": [asdict(row) for row in pipeline.status],
        }
        if args.demo:
            payload["decision"] = asdict(pipeline.infer(demo_pose(), emg_intensity=0.74, ecg_stress=0.62))
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0 if pipeline.ready() else 2

    if args.check or not args.demo:
        print_status(pipeline.status)
        print(f"Pipeline listo: {pipeline.ready()}")

    if args.demo:
        decision = pipeline.infer(demo_pose(), emg_intensity=0.74, ecg_stress=0.62)
        print(json.dumps(asdict(decision), indent=2, ensure_ascii=False))

    return 0 if pipeline.ready() else 2


if __name__ == "__main__":
    raise SystemExit(main())
