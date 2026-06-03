# Kalman — Suavizado final post-PPO

No reemplaza TCN ni PPO. Solo reduce micro-oscilaciones antes de UDP/Unreal.

## Archivos

- `kalman_bone_filter.py` — EKF por hueso/eje `[θ, θ̇]`
- `apply_kalman.py` — aplica a un stream o archivo `.npz`
- `config/kalman_params.json` — Q/R por régimen (rest / gesture)

## Uso

```bash
python apply_kalman.py --input ../PPO/models/sample_stream.npz --output ./out_smoothed.npz
```
