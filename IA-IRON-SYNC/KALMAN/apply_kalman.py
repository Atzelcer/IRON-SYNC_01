#!/usr/bin/env python3
"""Aplica Kalman a secuencia IMU (T,15,3) — típicamente salida PPO."""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from kalman_bone_filter import load_params, smooth_imu_sequence


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True, help=".npz con key 'signal' o 'ppo_out'")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=Path(__file__).parent / "config" / "kalman_params.json")
    parser.add_argument("--regime", choices=("rest", "gesture"), default="gesture")
    args = parser.parse_args()

    data = np.load(args.input)
    key = "ppo_out" if "ppo_out" in data else "signal" if "signal" in data else "clean"
    seq = data[key]
    params = load_params(args.config)
    smoothed = smooth_imu_sequence(seq, args.regime, params)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.output, kalman_out=smoothed, input_key=key)
    print(f"Wrote {args.output} shape={smoothed.shape}")


if __name__ == "__main__":
    main()
