# PPO — Agente IMU (IRON-SYNC)

## Archivos principales

| Archivo | Para que sirve |
|---------|----------------|
| **configuracion_hiperparametros.yaml** | **TODA la configuracion** (rutas, datos, entornos, entrenamiento, recompensas) |
| **politica_actor_critico.py** | Politica Actor-Critic (acciones delta) |
| **recompensas_castigos.py** | Recompensas y castigos por paso |
| **entorno_ppo.py** | Entorno simple (1 rollout) |
| **entorno_ppo_multiple.py** | Entorno multiple (NUM_ENVS, entrenamiento) |
| **entrenador_ppo.py** | Bucle PPO |
| **entrenar_ppo.py** | Comando para entrenar |
| **inferencia_ppo.py** | Inferencia TCN + PPO |
| **colisiones_huesos.py** | Colisiones y limites (castigos) |
| **puente_visualizacion_laboratorio.py** | Mesh 3D en tiempo real |
| **POLITICA_Y_RECOMPENSAS.md** | Definicion de politica y castigos |

## Entrenar en el laboratorio (mesh en vivo)

1. Abre biomech-lab y carga **Og.FBX** (automatico al iniciar).
2. Conecta relay **ws://127.0.0.1:8767**.
3. Panel **DRL / PPO** → **Entrenar PPO**.
4. Veras el maniqui moverse, colliders y castigos por colision.

## Entrenar

```bash
python entrenar_ppo.py
```

O con ruta explicita:

```bash
python entrenar_ppo.py --config configuracion_hiperparametros.yaml
```

## Mejor modelo (BEST_PPO)

```bash
python generar_best_ppo.py
```


## Salida entrenamiento manual

- `models/BEST_PPO.pt` o ruta elegida en el panel
- `reports/training_metrics.json`
- `reports/training_curves.png`
