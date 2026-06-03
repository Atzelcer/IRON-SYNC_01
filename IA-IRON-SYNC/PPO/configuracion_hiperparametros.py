"""
Carga unica de configuracion del agente PPO.

Archivo YAML: configuracion_hiperparametros.yaml (hiperparametros, rutas, entornos).
"""
from __future__ import annotations

from pathlib import Path

import yaml

RUTA_POR_DEFECTO = Path(__file__).resolve().parent / "configuracion_hiperparametros.yaml"


def cargar_configuracion(ruta: Path | None = None) -> dict:
    path = ruta or RUTA_POR_DEFECTO
    if not path.exists():
        raise FileNotFoundError(f"No existe configuracion: {path}")
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _resolver_ruta(base: Path, valor: str | Path) -> Path:
    p = Path(valor)
    if p.is_absolute():
        return p.resolve()
    return (base / p).resolve()


def resolver_rutas_desde_config(cfg: dict) -> dict[str, Path]:
    base = Path(__file__).resolve().parent
    rutas = cfg.get("rutas", {})
    output_dir = _resolver_ruta(base, rutas.get("salida_modelos", "./models"))
    archivo_actor = rutas.get("archivo_actor")
    if archivo_actor:
        actor_checkpoint = _resolver_ruta(base, archivo_actor)
        output_dir = actor_checkpoint.parent
    else:
        actor_checkpoint = output_dir / rutas.get("nombre_actor", "ppo_actor.pt")
    return {
        "tcn_checkpoint": _resolver_ruta(base, rutas.get("modelo_tcn", "../TCN/models/tcn_sanitizer_best.pt")),
        "lab_datasets_root": _resolver_ruta(
            base, rutas.get("datasets_laboratorio", "../../artifacts/IRON_SYNC_TRAINING_DATASETS")
        ),
        "output_dir": output_dir,
        "reports_dir": _resolver_ruta(base, rutas.get("carpeta_reportes", "./reports")),
        "actor_checkpoint": actor_checkpoint,
    }


def aplicar_overrides(cfg: dict, overrides: dict | None) -> dict:
    if not overrides:
        return cfg

    def deep_merge(dest: dict, src: dict) -> None:
        for key, value in src.items():
            if isinstance(value, dict) and isinstance(dest.get(key), dict):
                deep_merge(dest[key], value)
            else:
                dest[key] = value

    deep_merge(cfg, overrides)
    return cfg
