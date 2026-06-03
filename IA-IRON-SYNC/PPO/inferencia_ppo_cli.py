#!/usr/bin/env python3
"""CLI JSON para inferencia TCN+PPO (relay biomech-lab)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from inferencia_ppo import InferenciaPpo


def main() -> None:
    payload = json.loads(sys.stdin.read())
    tcn = Path(payload["tcnPath"])
    ppo = Path(payload["ppoPath"]) if payload.get("ppoPath") else None
    pipe = InferenciaPpo(tcn, ppo)
    window = np.asarray(payload["window"], dtype=np.float32)
    mask = np.asarray(payload["mask"], dtype=np.float32)
    out = pipe.procesar_ventana(window, mask)
    result = {k: v.tolist() for k, v in out.items()}
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
