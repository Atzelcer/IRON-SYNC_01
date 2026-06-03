#include "IronEspConfig.h"
#include "IronEspApi.h"
#include <WiFi.h>
#include <WiFiUdp.h>

extern WiFiUDP udp;
extern bool laptopRegistrada;
extern bool megaCalibrando;
extern bool megaCalibratedThisSession;
extern bool megaStreamAllowed;
extern bool pendingConnectAck;
extern bool pendingDisconnectAck;
extern unsigned long lastPythonSeenMs;
extern unsigned long pendingAckStartMs;
extern IPAddress laptopIP;

static char incomingPacket[2048];

static bool cmdEquals(const char* cmd, const char* value) {
  return strcmp(cmd, value) == 0;
}

static bool cmdStartsWith(const char* cmd, const char* prefix) {
  return strncmp(cmd, prefix, strlen(prefix)) == 0;
}

static bool parseIpToken(const char* token, IPAddress& out) {
  if (!token || token[0] == '\0') {
    return false;
  }
  return out.fromString(token);
}

static IPAddress pendingForcedLaptopIp;
static unsigned long pendingForcedLaptopAtMs = 0;

/** IP destino de IS (puede fijarse con REGISTER_PC,<ip> en Windows/multi-NIC). */
static IPAddress resolveLaptopDestination(IPAddress remoteIP, const char* cmd) {
  if (cmdStartsWith(cmd, "REGISTER_PC,")) {
    IPAddress forced;
    if (parseIpToken(cmd + 12, forced)) {
      pendingForcedLaptopIp = forced;
      pendingForcedLaptopAtMs = millis();
      return forced;
    }
  }

  if (
    cmdEquals(cmd, "CONNECT_HARDWARE")
    && pendingForcedLaptopIp != IPAddress(0, 0, 0, 0)
    && millis() - pendingForcedLaptopAtMs < 3000UL
  ) {
    return pendingForcedLaptopIp;
  }

  return remoteIP;
}

static char lastMegaForwardCmd[24] = "";
static unsigned long lastMegaForwardMs = 0;

static void forwardCmdToMega(const char* cmd, unsigned long minGapMs = 280UL) {
  if (!cmd || cmd[0] == '\0') {
    return;
  }

  unsigned long now = millis();
  if (
    minGapMs > 0
    && strcmp(cmd, lastMegaForwardCmd) == 0
    && now - lastMegaForwardMs < minGapMs
  ) {
    return;
  }

  Serial2.println(cmd);
  strncpy(lastMegaForwardCmd, cmd, sizeof(lastMegaForwardCmd) - 1);
  lastMegaForwardCmd[sizeof(lastMegaForwardCmd) - 1] = '\0';
  lastMegaForwardMs = now;
}

void recibirUDPDesdeLaptop() {
  int packetSize = udp.parsePacket();
  if (!packetSize) {
    return;
  }

  int len = udp.read(incomingPacket, sizeof(incomingPacket) - 1);
  if (len <= 0) {
    return;
  }

  incomingPacket[len] = '\0';

  char* cmd = incomingPacket;
  while (*cmd == ' ' || *cmd == '\t') {
    cmd++;
  }
  for (int i = (int)strlen(cmd) - 1; i >= 0; i--) {
    if (cmd[i] == ' ' || cmd[i] == '\t' || cmd[i] == '\r' || cmd[i] == '\n') {
      cmd[i] = '\0';
    } else {
      break;
    }
  }

  if (cmd[0] == '\0') {
    return;
  }

  IPAddress remoteIP = udp.remoteIP();

  if (
    cmdEquals(cmd, "CONNECT_HARDWARE") ||
    cmdEquals(cmd, "REGISTER_PC") ||
    cmdStartsWith(cmd, "REGISTER_PC,")
  ) {
    megaStreamAllowed = false;
    megaCalibratedThisSession = false;
    megaCalibrando = false;

    if (laptopRegistrada && !pendingDisconnectAck) {
      touchLaptopSessionAlive();
      enviarUdpReplyTo(
        remoteIP,
        String("ESP32_PC_REGISTERED,") + laptopIP.toString() + "," + WiFi.localIP().toString()
      );
      return;
    }

    prepararMegaParaNuevaConexion();
    registrarLaptop(resolveLaptopDestination(remoteIP, cmd));

    pendingConnectAck = true;
    pendingDisconnectAck = false;
    pendingAckStartMs = millis();

    String ack = "ESP32_CONNECTING_MEGA,";
    ack += laptopIP.toString();
    ack += ",";
    ack += WiFi.localIP().toString();
    enviarUdpReplyTo(remoteIP, ack);
    enviarHello();

    megaUIConnectOK();
    return;
  }

  if (!laptopRegistrada) {
    if (cmdEquals(cmd, "HB") || cmdEquals(cmd, "PING")) {
      enviarUdpReplyTo(remoteIP, "ESP32_PONG");
      return;
    }

    enviarHello();
    return;
  }

  lastPythonSeenMs = millis();

  if (cmdEquals(cmd, "HB") || cmdEquals(cmd, "PING")) {
    forwardCmdToMega("HB", 350UL);
    enviarUdpReplyTo(laptopIP, "ESP32_PONG");
    return;
  }

  if (cmdEquals(cmd, "CAL_ABORT")) {
    Serial2.println("CAL_ABORT");
    enviarUDP("ESP32_CAL_ABORT_SENT", 2);
    return;
  }

  if (cmdEquals(cmd, "REPRINT_CAL_REFERENCE")) {
    Serial2.println(cmd);
    enviarUDP("ESP32_REPRINT_CAL_REFERENCE_SENT", 1);
    return;
  }

  if (cmdStartsWith(cmd, "LOAD_CAL_REFERENCE_SENSOR,")) {
    Serial2.println(cmd);
    enviarUDP("ESP32_LOAD_CAL_REFERENCE_SENT", 1);
    return;
  }

  if (cmdEquals(cmd, "START") || cmdEquals(cmd, "CAL_START") || cmdEquals(cmd, "CALIBRATE")) {
    megaCalibrando = true;
    megaCalibratedThisSession = false;
    megaStreamAllowed = false;

    flushMegaSerialRx();
    megaUICalibrating();
    delay(20);
    Serial2.println("CAL_START");
    enviarUDP("ESP32_CAL_START_SENT", 2);
    return;
  }

  if (cmdEquals(cmd, "STOP") || cmdEquals(cmd, "RUN_STOP")) {
    megaStreamAllowed = false;
    forwardCmdToMega("STOP", 0);
    enviarUDP("ESP32_STOP_SENT", 2);
    return;
  }

  if (cmdEquals(cmd, "DISCONNECT") || cmdEquals(cmd, "CLOSE")) {
    iniciarDesconexion("PC_DISCONNECT");
    return;
  }

  if (cmdEquals(cmd, "STATUS")) {
    Serial2.println("STATUS");
    enviarUDP("ESP32_STATUS_REQUEST_SENT", 1);
    return;
  }

  if (cmdEquals(cmd, "RUN_START")) {
    megaCalibrando = false;
    forwardCmdToMega("RUN_START", 450UL);
    enviarUDP("ESP32_RUN_START_SENT", 2);
    return;
  }

  if (cmdEquals(cmd, "RESCAN")) {
    Serial2.println("RESCAN");
    enviarUDP("ESP32_RESCAN_SENT", 1);
    return;
  }

  if (cmdEquals(cmd, "RESET_IMUS") || cmdEquals(cmd, "RECOVER_SENSORS")) {
    Serial2.println(cmd);
    enviarUDP("ESP32_RESET_IMUS_SENT", 1);
    return;
  }

  if (
    cmdEquals(cmd, "PRINT_MAP") ||
    cmdEquals(cmd, "PRINT_PROFILE") ||
    cmdEquals(cmd, "QUALITY") ||
    cmdEquals(cmd, "STATS") ||
    cmdEquals(cmd, "STRESS_STATUS") ||
    cmdEquals(cmd, "STRESS_START") ||
    cmdStartsWith(cmd, "CAL_SENSOR,") ||
    cmdStartsWith(cmd, "CAL_SENSOR_QUICK,")
  ) {
    Serial2.println(cmd);
    enviarUDP("ESP32_DIAG_REQUEST_SENT", 1);
    return;
  }

  if (cmdEquals(cmd, "MASTER_CAL_PROCESSING")) {
    Serial2.println(cmd);
    enviarUDP("ESP32_MASTER_CAL_PROCESSING_SENT", 1);
    return;
  }

  if (cmdEquals(cmd, "MASTER_CAL_OK")) {
    Serial2.println(cmd);
    enviarUDP("ESP32_MASTER_CAL_OK_SENT", 1);
    return;
  }

  if (cmdEquals(cmd, "MASTER_CAL_FAIL")) {
    Serial2.println(cmd);
    enviarUDP("ESP32_MASTER_CAL_FAIL_SENT", 1);
    return;
  }

  if (cmdEquals(cmd, "LED_AQUA")) {
    Serial2.println(cmd);
    enviarUDP("ESP32_LED_AQUA_SENT", 1);
    return;
  }

  if (cmdEquals(cmd, "ESP32_STATS")) {
    String stats = "ESP32_STATS,isFwd=";
    stats += String(esp32IsForwardedCount());
    stats += ",isDrop=";
    stats += String(esp32IsDroppedCount());
    stats += ",cal=";
    stats += megaCalibrando ? "1" : "0";
    stats += ",reg=";
    stats += laptopRegistrada ? "1" : "0";
    enviarUdpReplyTo(laptopIP, stats);
    return;
  }

  Serial2.println(cmd);
  enviarUDP("ESP32_CMD_FORWARDED", 1);
}
