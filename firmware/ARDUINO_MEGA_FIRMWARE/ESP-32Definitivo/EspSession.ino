#include "IronEspConfig.h"
#include "IronEspApi.h"
#include <WiFi.h>
#include <WiFiUdp.h>

extern WiFiUDP udp;

extern IPAddress broadcastIP;
extern IPAddress laptopIP;

extern bool laptopRegistrada;
extern bool megaCalibrando;
extern bool megaCalibratedThisSession;
extern bool megaStreamAllowed;
extern bool pendingConnectAck;
extern bool pendingDisconnectAck;
extern bool wifiUdpReady;

extern unsigned long lastPythonSeenMs;
extern unsigned long lastHelloMs;
extern unsigned long pendingAckStartMs;
extern unsigned long lastWifiRetryMs;

const char* ssid = WIFI_SSID;
const char* password = WIFI_PASSWORD;

void resetSesionPorCaidaWiFi() {
  laptopRegistrada = false;
  laptopIP = IPAddress(0, 0, 0, 0);
  lastPythonSeenMs = 0;
  pendingConnectAck = false;
  pendingDisconnectAck = false;
  megaCalibrando = false;
  lastHelloMs = 0;
}

IPAddress getBroadcastIP() {
  IPAddress ip = WiFi.localIP();
  IPAddress subnet = WiFi.subnetMask();
  IPAddress broadcast;

  for (int i = 0; i < 4; i++) {
    broadcast[i] = ip[i] | (~subnet[i] & 0xFF);
  }

  return broadcast;
}

void onWiFiReady() {
  broadcastIP = getBroadcastIP();
  udp.begin(ESP32_LISTEN_PORT);
  wifiUdpReady = true;
  enviarHello();
}

bool asegurarWiFiListo() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  if (wifiUdpReady) {
    wifiUdpReady = false;
    resetSesionPorCaidaWiFi();
  }

  unsigned long now = millis();
  if (now - lastWifiRetryMs < WIFI_RETRY_MS) {
    return false;
  }
  lastWifiRetryMs = now;

  if (WiFi.status() == WL_IDLE_STATUS || WiFi.status() == WL_DISCONNECTED) {
    WiFi.disconnect(true);
    WiFi.begin(ssid, password);
  } else {
    WiFi.reconnect();
  }

  return false;
}

void prepararMegaParaNuevaConexion() {
  flushMegaSerialRx();

  megaCalibrando = false;
  megaCalibratedThisSession = false;
  megaStreamAllowed = false;
  pendingConnectAck = false;
  pendingDisconnectAck = false;
}

void registrarLaptop(IPAddress remoteIP) {
  laptopIP = remoteIP;
  laptopRegistrada = true;
  lastPythonSeenMs = millis();
}

void touchLaptopSessionAlive() {
  if (laptopRegistrada) {
    lastPythonSeenMs = millis();
  }
}

void iniciarDesconexion(const char* motivo) {
  if (!laptopRegistrada) {
    enviarHello();
    return;
  }

  megaCalibrando = false;
  megaCalibratedThisSession = false;
  megaStreamAllowed = false;
  pendingConnectAck = false;
  pendingDisconnectAck = true;
  pendingAckStartMs = millis();

  // Solo UI_DISCONNECT: STOP + uiDataStop sonaba otra vez al terminar uiDisconnect.
  megaUIDisconnect();

  String msg = "ESP32_DISCONNECTING,";
  msg += motivo;
  enviarUDP(msg, 1);
}

void finalizarDesconexion(const char* motivo) {
  megaCalibratedThisSession = false;
  megaStreamAllowed = false;
  if (laptopRegistrada) {
    String msg = "ESP32_DISCONNECTED,";
    msg += motivo;
    enviarUDP(msg, 1);
  } else {
    enviarBroadcastUDP(String("ESP32_DISCONNECTED,") + motivo);
  }

  laptopRegistrada = false;
  laptopIP = IPAddress(0, 0, 0, 0);
  lastPythonSeenMs = 0;
  pendingConnectAck = false;
  pendingDisconnectAck = false;
  megaCalibrando = false;
  lastHelloMs = 0;
  enviarHello();
}

void mantenerHelloSiNoHayLaptop() {
  if (laptopRegistrada) {
    return;
  }

  if (millis() - lastHelloMs >= HELLO_INTERVAL_MS) {
    lastHelloMs = millis();
    enviarHello();
  }
}

void verificarHeartbeatLaptop() {
  if (!laptopRegistrada || megaCalibrando || pendingDisconnectAck) {
    return;
  }

  // Sin desconexión automática: solo DISCONNECT/CLOSE explícito desde el lab.
  if (millis() - lastPythonSeenMs > PYTHON_IDLE_WARN_MS) {
    static unsigned long lastIdleWarnMs = 0;
    if (millis() - lastIdleWarnMs > 60000UL) {
      lastIdleWarnMs = millis();
      enviarUDP("WARN,ESP32_PC_IDLE", 0);
    }
  }
}

void verificarAcksMega() {
  if (pendingConnectAck && millis() - pendingAckStartMs > MEGA_UI_TIMEOUT_MS) {
    pendingConnectAck = false;

    enviarUDP("ESP32_PC_REGISTERED," + laptopIP.toString() + "," + WiFi.localIP().toString(), 1);
    enviarUDP("WARN,MEGA_CONNECT_ACK_TIMEOUT", 0);
  }

  if (pendingDisconnectAck && millis() - pendingAckStartMs > MEGA_UI_TIMEOUT_MS) {
    finalizarDesconexion("MEGA_DISCONNECT_ACK_TIMEOUT");
  }
}
