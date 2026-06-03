#include "IronEspConfig.h"
#include "IronEspApi.h"

extern bool laptopRegistrada;
extern bool megaCalibrando;
extern bool megaCalibratedThisSession;
extern bool megaStreamAllowed;
extern bool pendingConnectAck;
extern bool pendingDisconnectAck;
extern IPAddress laptopIP;

static char megaLine[MEGA_LINE_BUFFER_SIZE];
static uint16_t megaLineLen = 0;

static bool lineStartsWith(const char* line, uint16_t len, const char* prefix) {
  uint16_t prefixLen = (uint16_t)strlen(prefix);
  return len >= prefixLen && strncmp(line, prefix, prefixLen) == 0;
}

static bool lineEquals(const char* line, uint16_t len, const char* value) {
  uint16_t valueLen = (uint16_t)strlen(value);
  return len == valueLen && strncmp(line, value, len) == 0;
}

bool esLineaAckInternoMega(const char* msg, uint16_t len) {
  return (
    lineEquals(msg, len, "UI_CONNECT_OK_DONE") ||
    lineEquals(msg, len, "UI_DISCONNECT_DONE") ||
    lineEquals(msg, len, "UI_CALIBRATING_READY") ||
    lineEquals(msg, len, "UI_DATA_STOP_DONE")
  );
}

bool esLineaValidaParaLaptop(const char* msg, uint16_t len) {
  if (esLineaAckInternoMega(msg, len)) {
    return false;
  }

  if (megaCalibrando) {
    if (
      lineStartsWith(msg, len, "PROFILE,") ||
      lineStartsWith(msg, len, "STATS,") ||
      lineStartsWith(msg, len, "DBG,")
    ) {
      return false;
    }
  }

  return (
    lineStartsWith(msg, len, "IS,") ||
    lineStartsWith(msg, len, "SENSOR") ||
    lineStartsWith(msg, len, "EMG") ||
    lineStartsWith(msg, len, "ECG") ||
    lineStartsWith(msg, len, "CAL") ||
    lineStartsWith(msg, len, "CAL_REFERENCE") ||
    lineStartsWith(msg, len, "CAL_SENSOR") ||
    lineStartsWith(msg, len, "QUALITY") ||
    lineStartsWith(msg, len, "PROFILE,") ||
    lineStartsWith(msg, len, "MOUNT") ||
    lineStartsWith(msg, len, "WARN") ||
    lineStartsWith(msg, len, "ERR") ||
    lineStartsWith(msg, len, "LOAD_") ||
    lineStartsWith(msg, len, "SENSOR_STATE") ||
    lineStartsWith(msg, len, "MEGA") ||
    lineStartsWith(msg, len, "STATUS") ||
    lineStartsWith(msg, len, "SCAN") ||
    lineStartsWith(msg, len, "SUIT_MAP") ||
    lineStartsWith(msg, len, "SENSOR_BIND") ||
    lineStartsWith(msg, len, "RESET") ||
    lineStartsWith(msg, len, "STATS") ||
    lineStartsWith(msg, len, "STRESS") ||
    lineEquals(msg, len, "STOPPED") ||
    lineEquals(msg, len, "RUNNING") ||
    lineStartsWith(msg, len, "ERROR")
  );
}

void actualizarEstadoDesdeMega(const char* msg, uint16_t len) {
  if (lineEquals(msg, len, "UI_CONNECT_OK_DONE")) {
    pendingConnectAck = false;
    enviarUDP("ESP32_PC_REGISTERED," + laptopIP.toString() + "," + WiFi.localIP().toString(), 2);
    return;
  }

  if (lineEquals(msg, len, "UI_DISCONNECT_DONE")) {
    megaStreamAllowed = false;
    megaCalibratedThisSession = false;
    flushMegaSerialRx();
    finalizarDesconexion("MEGA_CONFIRMED");
    return;
  }

  if (lineEquals(msg, len, "MEGA_SESSION_RESET") || lineEquals(msg, len, "MEGA_READY")) {
    megaCalibrando = false;
    megaStreamAllowed = false;
    megaCalibratedThisSession = false;
    return;
  }

  if (lineEquals(msg, len, "RUNNING")) {
    megaCalibratedThisSession = true;
    megaStreamAllowed = true;
    return;
  }

  if (
    lineEquals(msg, len, "CAL_STARTED") ||
    lineStartsWith(msg, len, "CAL_PROGRESS") ||
    lineStartsWith(msg, len, "CAL_WAIT_POSE")
  ) {
    megaCalibrando = true;
    return;
  }

  if (lineEquals(msg, len, "CAL_POSE_READY")) {
    return;
  }

  if (
    lineEquals(msg, len, "CAL_OK") ||
    lineEquals(msg, len, "CALIBRATION_DONE") ||
    lineStartsWith(msg, len, "CAL_ERROR") ||
    lineEquals(msg, len, "CAL_ABORTED")
  ) {
    megaCalibrando = false;
    if (lineEquals(msg, len, "CAL_OK") || lineEquals(msg, len, "CALIBRATION_DONE")) {
      megaCalibratedThisSession = true;
      megaStreamAllowed = true;
    } else {
      megaCalibratedThisSession = false;
      megaStreamAllowed = false;
    }
    flushUdpQueue();
    enviarUDP("ESP32_STREAM_READY", 2);
    return;
  }

  if (lineStartsWith(msg, len, "STATUS,STREAM_STARTED") || lineStartsWith(msg, len, "STATUS,cal=1,run=1")) {
    megaCalibrando = false;
    megaCalibratedThisSession = true;
    megaStreamAllowed = true;
    enviarUDP("ESP32_STREAM_READY", 2);
    return;
  }

  if (lineStartsWith(msg, len, "WARN,CAL_ALREADY_RUNNING")) {
    megaCalibrando = false;
    return;
  }

  if (lineEquals(msg, len, "STOPPED")) {
    megaCalibrando = false;
    megaStreamAllowed = false;
    return;
  }
}

static bool esLineaDatosVivo(const char* msg, uint16_t len) {
  return (
    lineStartsWith(msg, len, "IS,") ||
    lineStartsWith(msg, len, "SENSOR_STATE") ||
    lineStartsWith(msg, len, "SENSOR,") ||
    lineStartsWith(msg, len, "ECG") ||
    lineStartsWith(msg, len, "EMG")
  );
}

static void forwardMegaLineToLaptop(const char* line, uint16_t len) {
  if (!laptopRegistrada || !esLineaValidaParaLaptop(line, len)) {
    return;
  }

  if (esLineaDatosVivo(line, len) && !megaStreamAllowed) {
    return;
  }

  if (lineStartsWith(line, len, "IS,")) {
    enviarISLineaDirecta(line, len);
    return;
  }

  if (!megaCalibrando && lineStartsWith(line, len, "STATS,")) {
    static unsigned long lastStatsForwardMs = 0;
    if (millis() - lastStatsForwardMs < 2000) {
      return;
    }
    lastStatsForwardMs = millis();
  }

  if (len >= UDP_LINE_MAX) {
    enviarUDP("WARN,ESP32_LINE_TOO_LONG," + String(len), 2);
    return;
  }

  String payload;
  payload.reserve(len + 1);
  for (uint16_t i = 0; i < len; i++) {
    payload += line[i];
  }
  enviarUDP(payload, 0);
}

void flushMegaSerialRx() {
  while (Serial2.available() > 0) {
    Serial2.read();
  }
  megaLineLen = 0;
  megaLine[0] = '\0';
}

void megaUIConnectOK() {
  flushMegaSerialRx();
  Serial2.println("UI_CONNECT_OK");
}

void megaUICalibrating() {
  Serial2.println("UI_CALIBRATING");
}

void megaUIDataStop() {
  Serial2.println("UI_DATA_STOP");
}

void megaUIDisconnect() {
  Serial2.println("UI_DISCONNECT");
}

static void processMegaLine() {
  while (megaLineLen > 0 && (megaLine[megaLineLen - 1] == ' ' || megaLine[megaLineLen - 1] == '\t')) {
    megaLineLen--;
  }
  while (megaLineLen > 0 && (megaLine[0] == ' ' || megaLine[0] == '\t')) {
    memmove(megaLine, megaLine + 1, megaLineLen);
    megaLineLen--;
  }

  if (megaLineLen == 0) {
    return;
  }

  megaLine[megaLineLen] = '\0';
  actualizarEstadoDesdeMega(megaLine, megaLineLen);
  forwardMegaLineToLaptop(megaLine, megaLineLen);
}

void recibirDesdeMegaYEnviarLaptop() {
  while (Serial2.available()) {
    char c = Serial2.read();

    if (c == '\n') {
      processMegaLine();
      megaLineLen = 0;
      megaLine[0] = '\0';
    } else if (c != '\r') {
      if (megaLineLen < (MEGA_LINE_BUFFER_SIZE - 1)) {
        megaLine[megaLineLen++] = c;
      } else {
        enviarBroadcastUDP("WARN,ESP32_SERIAL_LINE_OVERFLOW");
        megaLineLen = 0;
        megaLine[0] = '\0';
      }
    }

    yield();
  }
}
