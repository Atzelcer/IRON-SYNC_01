#ifndef IRON_ESP_CONFIG_H
#define IRON_ESP_CONFIG_H

// ================= WiFi (edita aquí tu red) =================
#define WIFI_SSID "ModoB"
#define WIFI_PASSWORD "1234567899"

#define DEBUG_USB_SERIAL 0

/** Puerto UDP del relay Vite (escucha en el PC). */
#define PC_PORT 5005
/** Puerto UDP del ESP32 (comandos desde el PC). */
#define ESP32_LISTEN_PORT 5006

#define RX_MEGA 3
#define TX_MEGA 1
#define SERIAL_MEGA_BAUD 250000

/** Aviso si el PC lleva idle (no cierra sesión; solo PC_DISCONNECT desconecta). */
#define PYTHON_IDLE_WARN_MS 120000
#define HELLO_INTERVAL_MS 1000
#define MEGA_UI_TIMEOUT_MS 7000
#define WIFI_RETRY_MS 2000

/** Serial2 desde Mega @ 50 Hz × ~700 B → necesita cola grande. */
#define SERIAL2_RX_BUFFER_SIZE 8192
#define MEGA_LINE_BUFFER_SIZE 1600

#define UDP_QUEUE_SLOTS 64
/** Paquete IS con 15 IMUs (~450–700 bytes). */
#define UDP_LINE_MAX 1600

/** Por ciclo de loop: vaciar cola IS agresivamente. */
#define UDP_FLUSH_IS_MAX 40
#define UDP_FLUSH_OTHER_MAX 6

#endif
