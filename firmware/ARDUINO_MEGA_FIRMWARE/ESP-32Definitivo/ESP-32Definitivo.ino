#include <WiFi.h>
#include <WiFiUdp.h>
#include "IronEspConfig.h"
#include "IronEspApi.h"

struct NullDebugSerial {
  void begin(unsigned long) {}
  template <typename T> void print(const T&) {}
  template <typename T> void println(const T&) {}
  void println() {}
};

#if DEBUG_USB_SERIAL
  #define DebugSerial Serial
#else
  NullDebugSerial DebugSerial;
#endif

#define Serial DebugSerial

WiFiUDP udp;

IPAddress broadcastIP;
IPAddress laptopIP;

bool laptopRegistrada = false;
bool megaCalibrando = false;
bool megaCalibratedThisSession = false;
bool megaStreamAllowed = false;
bool pendingConnectAck = false;
bool pendingDisconnectAck = false;
bool wifiUdpReady = false;

unsigned long lastPythonSeenMs = 0;
unsigned long lastHelloMs = 0;
unsigned long pendingAckStartMs = 0;
unsigned long lastWifiRetryMs = 0;

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial2.setRxBufferSize(SERIAL2_RX_BUFFER_SIZE);
  Serial2.begin(SERIAL_MEGA_BAUD, SERIAL_8N1, RX_MEGA, TX_MEGA);

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(ssid, password);

  int intentos = 0;
  while (WiFi.status() != WL_CONNECTED && intentos < 40) {
    delay(500);
    intentos++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    onWiFiReady();
    Serial2.println("STOP");
  }
}

void loop() {
  if (!asegurarWiFiListo()) {
    return;
  }

  if (!wifiUdpReady) {
    onWiFiReady();
    Serial2.println("STOP");
  }

  mantenerHelloSiNoHayLaptop();

  for (uint8_t burst = 0; burst < 6; burst++) {
    recibirDesdeMegaYEnviarLaptop();
    flushUdpQueue();
  }

  recibirUDPDesdeLaptop();

  for (uint8_t burst = 0; burst < 2; burst++) {
    recibirDesdeMegaYEnviarLaptop();
    flushUdpQueue();
  }

  verificarAcksMega();
  verificarHeartbeatLaptop();
}
