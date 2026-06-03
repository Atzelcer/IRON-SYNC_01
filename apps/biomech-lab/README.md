# IRON-SYNC Biomech Lab

Laboratorio web para visualizar, calibrar y probar el movimiento biomecanico de IRON-SYNC en tiempo real. Esta carpeta contiene la app HTML5 hecha con Vite, Three.js y JavaScript modular. La idea central es tener un banco de pruebas donde se pueda cargar un skeletal mesh, mapear los 15 puntos del cuerpo, recibir datos del hardware ESP32/Mega, evaluar reglas biomecanicas, entrenar/probar Q-learning y exportar resultados para Unreal Engine o para analisis posterior.

## Donde estamos

El laboratorio ya funciona como prototipo integrado. Actualmente incluye:

- Escena 3D con Three.js, camara orbital, vistas frontales/laterales/superior y skeletal mesh por defecto.
- Carga de modelos `.fbx`, `.obj`, `.glb` y `.gltf` desde la interfaz.
- Mapeo de 15 segmentos corporales compatibles con nombres estilo Unreal/Mixamo.
- Control manual de rotaciones por hueso.
- Evaluacion biomecanica con limites, recompensas, penalizaciones y deteccion de colisiones.
- Panel de hardware para ESP32/Mega mediante relay WebSocket/UDP.
- Calibracion y limpieza de senales con suavizado, deadzone, ganancia y limite de rotacion.
- Panel de prueba final para verificar conexion, sensores vivos, frames, calibracion y modelo Q-learning.
- Demo DRL/Q-learning en navegador, con exportacion/carga de modelos JSON.
- Recorder/exportador de poses, grabaciones, bone maps, configuracion biomecanica y politicas.
- Relay hacia Unreal Engine por WebSocket local y salida UDP.

Todavia no es una version final cerrada. Es una base operativa para pruebas de integracion, calibracion y demostracion. Lo siguiente importante es validar con hardware real de forma repetida, ajustar el protocolo de sensores y consolidar los modelos entrenados fuera del navegador.

## Como ejecutar

Desde la raiz del repositorio:

```powershell
cd apps\biomech-lab
npm install
npm run dev
```

Abrir en el navegador:

```text
http://127.0.0.1:5173
```

Tambien existe un script desde la raiz:

```powershell
.\scripts\run_biomech_lab.ps1
```

Para compilar una version estatica:

```powershell
npm run build
```

Para previsualizar el build:

```powershell
npm run preview
```

## Puertos usados

La app levanta varios canales locales cuando corre con Vite:

| Canal | Puerto | Uso |
| --- | ---: | --- |
| Vite dev server | `5173` | Interfaz web del laboratorio |
| Vite preview | `4173` | Vista del build compilado |
| Relay generico | `8765` | Entrada WebSocket externa opcional |
| Unreal relay | `8766` | WebSocket local hacia UDP Unreal |
| Arduino relay | `8767` | WebSocket local para ESP32/Mega |
| UDP Unreal | `7000` | Destino UDP para frames `IRON_FRAME` |
| UDP Arduino listen | `5005` | Entrada UDP desde ESP32/Mega |
| UDP ESP32 broadcast | `5006` | Descubrimiento/comandos hacia ESP32 |

Si algun puerto ya esta ocupado, la app puede mostrar avisos en consola. En especial, si `5005` esta ocupado por el bridge Python, el relay Arduino del laboratorio no podra escuchar ahi.

## Estructura principal

```text
apps/biomech-lab
  index.html
  package.json
  vite.config.js
  skeletalMesh/
    Og.FBX
  src/
    main.js
    ui/
    scene/
    three/
    skeleton/
    biomechanics/
    calibration/
    io/
    drl/
    recorder/
    core/
```

### Archivos base

- `index.html`: punto de entrada HTML.
- `src/main.js`: monta el `UiController` sobre `#app`.
- `vite.config.js`: configura Vite y ademas crea los relays WebSocket/UDP para Unreal y Arduino.
- `skeletalMesh/Og.FBX`: skeletal mesh por defecto que se carga al iniciar.
- `dist/`: salida generada por `npm run build`.

### Interfaz

La interfaz vive principalmente en `src/ui/uiController.js`. Ahi se conectan todos los paneles:

- Sistema y carga/restauracion de mesh.
- Hardware ESP32/Mega.
- Calibracion y limpieza.
- Prueba final.
- Skeletal setup.
- Control manual.
- Biomechanics.
- DRL Demo.
- Q-learning.
- Unreal Engine.
- Recorder/export.

`src/ui/panels.js` y `src/ui/dom.js` contienen utilidades de renderizado antiguas o complementarias.

### Escena 3D

La escena esta separada en dos capas:

- `src/scene/`: manejo de camara, luces, carga de modelos y entorno visual.
- `src/three/`: rig procedural, animador procedural, FBX loader y componentes Three.js mas cercanos al modelo.

Si `Og.FBX` no carga, el laboratorio puede usar un rig procedural de respaldo para seguir probando la logica.

### Skeleton y mapa de huesos

El mapa corporal principal esta en `src/core/boneMap.js` y trabaja con 15 alias:

| Alias | Segmento |
| --- | --- |
| `hip` | Cadera |
| `chest` | Torso |
| `head` | Cabeza |
| `sL`, `fL`, `hL` | Brazo, antebrazo y mano izquierda |
| `sR`, `fR`, `hR` | Brazo, antebrazo y mano derecha |
| `tL`, `knL`, `ftL` | Muslo, pierna y pie izquierdo |
| `tR`, `knR`, `ftR` | Muslo, pierna y pie derecho |

`src/skeleton/` contiene limites, pose inicial estilo Unreal, mapper y controlador de huesos.

### Biomecanica

`src/biomechanics/` y `src/core/` contienen reglas, limites, colisiones y recompensas. Esta parte calcula:

- Rotaciones actuales por hueso.
- Penalizaciones por salirse de limites.
- Castigos por colision o movimiento inseguro.
- Recompensas por movimiento estable y anatomico.
- Marcadores anatomicos y colliders de depuracion.

### Hardware ESP32/Mega

El flujo esperado es:

```text
ESP32/Mega
UDP 5005/5006
vite.config.js relay
WebSocket ws://127.0.0.1:8767
ArduinoConnection
UiController
BoneController / escena 3D
```

El panel de hardware permite:

- Abrir/cerrar relay Arduino.
- Buscar ESP32 por broadcast.
- Conectar/desconectar hardware.
- Iniciar calibracion.
- Detener transferencia.
- Pedir estado, re-escanear y reiniciar sensores.
- Mostrar sensores online/offline sobre el cuerpo.

Los paquetes principales que entiende el relay son:

- `ESP32_HELLO,...` para descubrimiento.
- `IS,...` para frames de IRON-SYNC con rotaciones.
- `SENSOR,...` y `SENSOR_STATE,...` para estados de sensores.
- `CAL_PROGRESS,...`, `CAL_OK`, `CALIBRATION_DONE` para calibracion.
- `ESP32_PONG`, `ESP32_PC_REGISTERED`, `STOPPED` para estado general.

### Calibracion y limpieza

El panel de calibracion permite construir un perfil correctivo desde poses base. Parametros disponibles:

- Hz objetivo.
- Suavizado EMA.
- Deadzone.
- Ganancia.
- Limite maximo de rotacion.

Tambien reporta calidad, sensores detectados, frecuencia real y jitter. La calibracion se puede exportar como JSON.

### Q-learning y DRL

Hay dos niveles:

- `DRL Demo`: animaciones/acciones autonomas para probar el esqueleto sin hardware.
- `Q-learning`: entrenamiento en navegador para pruebas rapidas, con ruido, sensores perdidos, spikes y latencia simulada.

El entrenamiento pesado real debe hacerse fuera del navegador con los scripts Python/GPU del repositorio. Este laboratorio sirve para inspeccion visual, demo, evaluacion rapida y exportacion de politicas.

### Unreal Engine

El panel Unreal conecta con:

```text
ws://127.0.0.1:8766
```

El relay convierte frames del laboratorio a mensajes `IRON_FRAME` y los envia por UDP a:

```text
127.0.0.1:7000
```

El formato de salida incluye alias, hueso, rotacion y traslacion para que Unreal pueda reconstruir la pose.

### Exportaciones

Desde el panel Recorder/Export se pueden generar:

- `ironsync_pose.json`
- `ironsync_recording.json`
- `ironsync_bone_map.json`
- `ironsync_biomechanics_config.json`

Desde Q-learning se pueden exportar tambien:

- Q-table.
- Mejor modelo/politica.
- Transiciones.
- Log de entrenamiento.
- Resumen de politica.

## Flujo recomendado de prueba

1. Ejecutar `npm run dev`.
2. Confirmar que carga `Og.FBX` o el rig procedural de respaldo.
3. Revisar el panel `Skeletal Setup` y auto-mapear si hace falta.
4. Probar rotaciones manuales en `Control Manual`.
5. Activar marcadores, etiquetas y evaluacion en `Biomechanics`.
6. Abrir `Hardware ESP32 / Mega` y conectar el relay Arduino.
7. Conectar hardware, calibrar e iniciar transferencia.
8. Verificar el panel `Prueba` antes de declarar una demo valida.
9. Grabar/exportar poses o sesiones desde `Recorder / Export`.
10. Si corresponde, conectar `Unreal Engine` y revisar la salida UDP.

## Pendientes claros

- Validar el flujo completo con los 15 sensores reales durante sesiones largas.
- Ajustar nombres de huesos si se usan skeletal meshes distintos a `Og.FBX`.
- Consolidar un protocolo estable entre ESP32, Mega y el relay Vite.
- Mejorar manejo de errores visibles para hardware desconectado o paquetes incompletos.
- Separar entrenamiento real pesado hacia Python/GPU y dejar el navegador como monitor/demo.
- Documentar ejemplos de frames reales `IS,...` cuando el firmware quede congelado.
- Revisar textos con caracteres raros en algunos archivos fuente y normalizar codificacion.

## Estado resumido

El laboratorio esta en fase de integracion avanzada/prototipo funcional. Ya sirve para mostrar el cuerpo 3D, manipularlo, recibir datos, calibrar, evaluar biomecanica, probar Q-learning y exportar resultados. Lo que falta no es armar la base, sino endurecerla: pruebas reales, limpieza de protocolo, documentacion de paquetes y validacion de punta a punta con hardware y Unreal.
