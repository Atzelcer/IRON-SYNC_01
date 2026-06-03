#ifndef IRON_SYNC_CONFIG_H
#define IRON_SYNC_CONFIG_H

// ================= SERIAL / BUS =================
#define DEBUG_BAUD 115200
#define ESP32_BAUD 250000

#define TCA_SUPERIOR 0x70
#define TCA_INFERIOR 0x72
#define MPU_ADDR 0x68

#define RST_SUPERIOR 7
#define RST_INFERIOR 8

#define ECG_PIN A0
#define EMG_PIN A1
#define ECG_LO_PLUS 22
#define ECG_LO_MINUS 23

#define LED_PIN 5
#define NUM_LEDS 60
#define LED_BRIGHTNESS 255
/** LED rojo discreto en pecho (misma señal que tira). 0 = solo tira NeoPixel. */
#define CHEST_AUX_RED_PIN 0
#define UI_DISCONNECT_RED_HOLD_MS 320

#define BUZZER_CAL 9
#define BUZZER_STATE 10

#define I2C_CLOCK 400000
#define SENSOR_COUNT 15

// ================= TIMING =================
#define SEND_INTERVAL_MS 20
#define CAL_SAMPLES 160
#define CAL_QUICK_SAMPLES 64
#define CAL_POSE_WAIT_MS 6000
#define CAL_POSE_WAIT_STEP_MS 1000
#define MIN_CALIBRATION_BLUE_MS 3500
#define MIN_CALIBRATION_MS (CAL_POSE_WAIT_MS + MIN_CALIBRATION_BLUE_MS)
#define CAL_LED_BLINK_MS 120
#define CAL_MELODY_GAP_MS 16
#define CAL_TONE_CRISP_TAIL_MS 14
#define CAL_LOAD_TONE_INTERVAL_MS 280
#define UI_CONNECT_DEBOUNCE_MS 4500
#define CAL_LOOP_HANDLE_CMD_EVERY 16
#define MIN_ACTIVE_IMUS_TO_RUN 1
#define FULL_SENSOR_CALIBRATION_COUNT SENSOR_COUNT

/**
 * Modo coherente con el pipeline completo:
 * Mega calibra orientacion/base actual y transmite datos continuos.
 * El laboratorio/Python/MLP decide las acciones y Unreal consume la salida final.
 */
#define RAW_ORIENTATION_STREAM 1

// ================= FUSION / FILTER =================
#define COMPLEMENTARY_ALPHA 0.982
#define SMOOTH_ALPHA 0.18
#define STREAM_SMOOTH_ALPHA 0.36

// LPF sobre accel/gyro crudos (antes de fusión) — alpha alto = más rápido
#define ACCEL_LPF_ALPHA_QUIET 0.14
#define ACCEL_LPF_ALPHA_MOTION 0.38
#define GYRO_LPF_ALPHA_QUIET 0.18
#define GYRO_LPF_ALPHA_MOTION 0.42

// Umbral de movimiento (grados/s equivalente en salida) para modo quieto vs activo
#define MOTION_ENTER_DEG 3.6f
#define MOTION_EXIT_DEG 0.75f
#define MOTION_GYRO_ENTER_DPS 12.0f
#define MOTION_GYRO_EXIT_DPS 4.0f
#define QUIET_HARD_ZERO 0

// ================= CALIBRATION STABILITY =================
#define CAL_STABILITY_MAX_DEG 35.0
#define CAL_STABILITY_SOFT_EXTRA_DEG 18.0
#define CAL_STABILITY_PARTIAL_MAX_DEG 58.0
#define CAL_GYRO_STABILITY_MAX_DPS 42.0
#define CAL_GYRO_HARD_FAIL_DPS 200.0
#define CAL_MIN_VALID_READ_RATIO 0.60f

// ================= OUTPUT STABILIZATION =================
#define OUTPUT_DEADZONE_DEG 1.15
#define OUTPUT_DEADZONE_HEAD_DEG 1.35
#define OUTPUT_DEADZONE_LIMB_DEG 1.55
#define OUTPUT_STEP_LIMIT_DEG 6.0
#define STREAM_STEP_LIMIT_DEG 16.0
#define YAW_RATE_DEADZONE_DPS 1.85
/** Ignora micro-cambios en salida cuando la pose esta en reposo. */
#define OUTPUT_GHOST_CLAMP_DEG 0.55f

// ================= SENSOR HEALTH =================
#define SENSOR_READ_RETRIES 3
#define STREAM_SENSOR_READ_RETRIES 1
#define SENSOR_FAILS_BEFORE_LOST 22
#define SENSOR_RECOVER_INTERVAL_MS 1500
#define SENSOR_LOST_RECOVER_INTERVAL_MS 2000
#define SENSOR_STALE_WARN_MS 900
#define SENSOR_LOST_MS 3500
#define SENSOR_STREAM_HOLD_MS 15000
#define TCA_SELECT_DELAY_US 220
#define GLOBAL_RECOVER_COOLDOWN_MS 8000

// ================= STREAM =================
#define STREAM_PACKET_SERIAL1 1
#define STREAM_PACKET_USB 0

// ================= MOUNT DETECTION =================
#define MOUNT_GRAVITY_MIN_G 0.72f
#define MOUNT_FLAT_AXIS_MAX_G 0.42f

// Tras la primera calibración exitosa, reutiliza layout (evita invertir datasets).
#define LOCK_MOUNT_LAYOUT_AFTER_FIRST_CAL 1

/** Cero = lectura de pose menos centro del perfil ((limitMin+limitMax)/2) por eje. */
#define CAL_ZERO_USE_PROFILE_MIDPOINT 0

/** 1 = tabla golden PROGMEM; 0 = calibración dinámica + referencia LOAD_CAL_REFERENCE del laboratorio. */
#define FORCE_GOLDEN_REFERENCE 0

// ================= CANONICAL CALIBRATION =================
/**
 * Con FORCE_GOLDEN_REFERENCE=1, primero mide la postura actual:
 * - detecta layout real por gravedad (sensor girado X/Y/Z)
 * - calcula offsets gyro actuales
 * - fija zeroPitch/zeroRoll de la postura base actual
 *
 * Si no hay lecturas suficientes, cae a la tabla golden.
 */
#define GOLDEN_ADAPTIVE_MOUNT_ZERO 1
#define GOLDEN_ADAPTIVE_SAMPLES 96
#define GOLDEN_ADAPTIVE_MIN_VALID_RATIO 0.58f
#define GOLDEN_ADAPTIVE_MAX_GYRO_DPS 140.0f
#define GOLDEN_ADAPTIVE_MIN_GRAVITY_G 0.62f

#endif
