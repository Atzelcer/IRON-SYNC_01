#!/usr/bin/env python3
"""
Entrenar agente PPO IMU.

Configuracion: configuracion_hiperparametros.yaml
Politica: politica_actor_critico.py
Recompensas: recompensas_castigos.py
Entorno entrenamiento: entorno_ppo_multiple.py
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PPO_ROOT = Path(__file__).resolve().parent
TCN_ROOT = PPO_ROOT.parent / "TCN"
if str(PPO_ROOT) not in sys.path:
    sys.path.insert(0, str(PPO_ROOT))
if str(TCN_ROOT) not in sys.path:
    sys.path.insert(0, str(TCN_ROOT))

from configuracion_hiperparametros import aplicar_overrides, cargar_configuracion, resolver_rutas_desde_config
from entorno_ppo_multiple import EntornoPpoMultiple
from entrenador_ppo import EntrenadorPpo
from pipeline_datos import cargar_ventanas_entrenamiento


def _aplicar_cli_a_config(cfg: dict, args: argparse.Namespace) -> dict:
    rutas = cfg.setdefault("rutas", {})
    if args.modelo_tcn:
        rutas["modelo_tcn"] = str(args.modelo_tcn)
    if args.salida_actor:
        rutas["archivo_actor"] = str(args.salida_actor)
    if args.carpeta_reportes:
        rutas["carpeta_reportes"] = str(args.carpeta_reportes)

    if args.num_entornos is not None:
        cfg.setdefault("entorno_multiple", {})["num_entornos"] = int(args.num_entornos)
    if args.escala_accion is not None:
        cfg.setdefault("entorno", {})["escala_accion_grados"] = float(args.escala_accion)

    ent = cfg.setdefault("entrenamiento", {})
    if args.pasos_totales is not None:
        ent["pasos_totales"] = int(args.pasos_totales)
    if args.pasos_por_rollout is not None:
        ent["pasos_por_rollout"] = int(args.pasos_por_rollout)

    corr = cfg.setdefault("corrupcion_sensores", {})
    if args.ruido_max is not None:
        corr["ruido_grados_min_max"] = [0.0, float(args.ruido_max)]
    if args.drift_max is not None:
        corr["deriva_min_max"] = [0.0, float(args.drift_max)]
    if args.jitter_max is not None:
        corr["jitter_grados_min_max"] = [0.0, float(args.jitter_max)]
    if args.perdida_sensores_max is not None:
        corr["tasa_sensor_perdido_min_max"] = [0.0, float(args.perdida_sensores_max)]
    if args.sensores_congelados_max is not None:
        corr["tasa_sensor_congelado_min_max"] = [0.0, float(args.sensores_congelados_max)]

    if args.sin_visual_lab:
        cfg.setdefault("visualizacion_laboratorio", {})["activo"] = False

    if args.overrides:
        aplicar_overrides(cfg, json.loads(args.overrides.read_text(encoding="utf-8")))

    return cfg


def entrenar(config_path: Path, cfg: dict | None = None) -> Path:
    cfg = cfg or cargar_configuracion(config_path)
    paths = resolver_rutas_desde_config(cfg)
    paths["reports_dir"].mkdir(parents=True, exist_ok=True)
    paths["output_dir"].mkdir(parents=True, exist_ok=True)

    print("Cargando ventanas y sanitizando con TCN...")
    san, clean, mask = cargar_ventanas_entrenamiento(cfg, paths)
    print(f"Dataset PPO: {san.shape[0]} ventanas | TCN: {paths['tcn_checkpoint']}")

    fps = float(cfg.get("entorno", {}).get("fps", 50))
    delta_seg = 1.0 / max(fps, 1.0)
    env = EntornoPpoMultiple(
        windows_san=san,
        windows_target=clean,
        masks=mask,
        num_envs=int(cfg["entorno_multiple"]["num_entornos"]),
        action_scale=float(cfg["entorno"]["escala_accion_grados"]),
        reward_cfg=cfg,
        corruption_cfg=cfg.get("corrupcion_sensores", {}),
        seed=int(cfg.get("semilla", 42)),
        delta_segundos=delta_seg,
    )
    print(f"PPO | num_entornos={env.num_envs} obs_dim={env.obs_dim} act_dim={env.act_dim}")
    print(f"Salida actor: {paths.get('actor_checkpoint', paths['output_dir'] / 'ppo_actor.pt')}")

    entrenador = EntrenadorPpo(env, cfg, paths)
    actor_path = entrenador.train()
    print(f"OK — modelo guardado: {actor_path}")
    return actor_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Entrena PPO IRON-SYNC (post-TCN)")
    parser.add_argument(
        "--config",
        type=Path,
        default=PPO_ROOT / "configuracion_hiperparametros.yaml",
    )
    parser.add_argument("--overrides", type=Path, help="JSON con parches a la config")
    parser.add_argument("--modelo-tcn", type=Path, dest="modelo_tcn")
    parser.add_argument("--salida-actor", type=Path, dest="salida_actor", help=".pt del actor PPO")
    parser.add_argument("--carpeta-reportes", type=Path, dest="carpeta_reportes")
    parser.add_argument("--num-entornos", type=int)
    parser.add_argument("--pasos-totales", type=int)
    parser.add_argument("--pasos-por-rollout", type=int)
    parser.add_argument("--escala-accion", type=float)
    parser.add_argument("--ruido-max", type=float)
    parser.add_argument("--drift-max", type=float)
    parser.add_argument("--jitter-max", type=float)
    parser.add_argument("--perdida-sensores-max", type=float)
    parser.add_argument("--sensores-congelados-max", type=float)
    parser.add_argument(
        "--sin-visual-lab",
        action="store_true",
        help="Desactiva envio de poses al skeletal mesh del laboratorio",
    )
    args = parser.parse_args()

    cfg = cargar_configuracion(args.config)
    cfg = _aplicar_cli_a_config(cfg, args)
    entrenar(args.config, cfg=cfg)


if __name__ == "__main__":
    main()
