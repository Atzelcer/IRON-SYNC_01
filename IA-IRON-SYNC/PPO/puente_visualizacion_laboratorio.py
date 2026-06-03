"""
Puente en tiempo real: entrenamiento PPO -> biomech-lab (skeletal mesh).

Escribe reports/ppo_live_state.json; el relay Vite lo lee y emite ppo-live-frame.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


class PuenteVisualizacionLaboratorio:
    def __init__(
        self,
        reports_dir: Path,
        activo: bool = True,
        cada_n_pasos: int = 1,
    ) -> None:
        self.reports_dir = reports_dir
        self.activo = activo
        self.cada_n_pasos = max(1, int(cada_n_pasos))
        self._contador = 0
        self.reports_dir.mkdir(parents=True, exist_ok=True)
        self._ruta = self.reports_dir / "ppo_live_state.json"

    def emitir(self, frame: dict) -> None:
        if not self.activo:
            return
        self._contador += 1
        if self._contador % self.cada_n_pasos != 0:
            return
        payload = {
            "schema": "ironsync.ppo.live.v1",
            "ts": datetime.now(timezone.utc).isoformat(),
            **frame,
        }
        self._ruta.write_text(json.dumps(payload), encoding="utf-8")

    def cerrar(self) -> None:
        if self._ruta.exists():
            try:
                self._ruta.unlink()
            except OSError:
                pass
