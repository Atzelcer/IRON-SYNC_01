#include "IronEspConfig.h"
#include "IronEspApi.h"
#include <WiFiUdp.h>

extern WiFiUDP udp;
extern IPAddress broadcastIP;
extern IPAddress laptopIP;
extern bool laptopRegistrada;

struct UdpQueuedLine {
  char data[UDP_LINE_MAX];
  uint16_t len;
  uint8_t priority;
  bool used;
};

static UdpQueuedLine udpQueue[UDP_QUEUE_SLOTS];
static uint8_t udpQueueCount = 0;
static uint32_t isForwardedTotal = 0;
static uint32_t isDroppedTotal = 0;

static uint8_t linePriority(const char* msg, uint16_t len) {
  if (len >= 3 && msg[0] == 'I' && msg[1] == 'S' && msg[2] == ',') {
    return 3;
  }

  if (
    (len >= 3 && strncmp(msg, "CAL", 3) == 0) ||
    (len >= 12 && strncmp(msg, "SENSOR_STATE", 12) == 0) ||
    (len >= 4 && strncmp(msg, "WARN", 4) == 0) ||
    (len >= 5 && strncmp(msg, "MOUNT", 5) == 0) ||
    (len >= 6 && strncmp(msg, "STATUS", 6) == 0) ||
    (len >= 5 && strncmp(msg, "ERROR", 5) == 0)
  ) {
    return 2;
  }

  return 1;
}

static bool udpWriteLine(IPAddress ip, const char* msg, uint16_t len) {
  if (!msg || len == 0 || len >= UDP_LINE_MAX) {
    return false;
  }

  if (!udp.beginPacket(ip, PC_PORT)) {
    return false;
  }

  size_t written = udp.write((const uint8_t*)msg, len);
  bool ok = udp.endPacket() == 1 && written == len;
  return ok;
}

void enviarUdpReplyTo(IPAddress ip, const char* msg) {
  if (!msg || ip == IPAddress(0, 0, 0, 0)) {
    return;
  }
  udpWriteLine(ip, msg, (uint16_t)strlen(msg));
}

void enviarUdpReplyTo(IPAddress ip, const String& msg) {
  enviarUdpReplyTo(ip, msg.c_str());
}

void enviarISLineaDirecta(const char* line, uint16_t len) {
  if (!laptopRegistrada || !line || len == 0) {
    return;
  }

  touchLaptopSessionAlive();

  if (len >= UDP_LINE_MAX) {
    isDroppedTotal++;
    enviarUdpReplyTo(laptopIP, "WARN,ESP32_IS_TOO_LONG");
    return;
  }

  if (udpWriteLine(laptopIP, line, len)) {
    isForwardedTotal++;
    return;
  }

  if (udpWriteLine(broadcastIP, line, len)) {
    isForwardedTotal++;
    return;
  }

  isDroppedTotal++;
}

void queueUdpLine(const char* msg, uint16_t len, uint8_t priority) {
  if (!laptopRegistrada || !msg || len == 0) {
    return;
  }

  if (len >= UDP_LINE_MAX) {
    isDroppedTotal++;
    return;
  }

  int dropIndex = -1;
  uint8_t dropPriority = 255;

  if (udpQueueCount >= UDP_QUEUE_SLOTS) {
    for (uint8_t i = 0; i < UDP_QUEUE_SLOTS; i++) {
      if (!udpQueue[i].used) {
        continue;
      }

      if (udpQueue[i].priority < dropPriority) {
        dropPriority = udpQueue[i].priority;
        dropIndex = i;
      }
    }

    if (dropIndex < 0) {
      isDroppedTotal++;
      return;
    }

    if (udpQueue[dropIndex].priority == 3) {
      isDroppedTotal++;
    }

    udpQueue[dropIndex].used = false;
    udpQueueCount--;
  }

  for (uint8_t i = 0; i < UDP_QUEUE_SLOTS; i++) {
    if (udpQueue[i].used) {
      continue;
    }

    memcpy(udpQueue[i].data, msg, len);
    udpQueue[i].data[len] = '\0';
    udpQueue[i].len = len;
    udpQueue[i].priority = priority;
    udpQueue[i].used = true;
    udpQueueCount++;
    return;
  }
}

void enviarUDPDirecto(const String& msg) {
  enviarUdpReplyTo(laptopIP, msg);
}

void enviarUDP(const String& msg, uint8_t priority) {
  if (!laptopRegistrada || msg.length() == 0) {
    return;
  }

  if (priority == 0) {
    priority = linePriority(msg.c_str(), (uint16_t)msg.length());
  }

  queueUdpLine(msg.c_str(), (uint16_t)msg.length(), priority);
}

void enviarBroadcastUDP(const String& msg) {
  udpWriteLine(broadcastIP, msg.c_str(), (uint16_t)msg.length());
}

void flushUdpQueue() {
  if (!laptopRegistrada || udpQueueCount == 0) {
    return;
  }

  uint8_t sentIs = 0;
  uint8_t sentOther = 0;

  for (uint8_t pass = 0; pass < 2; pass++) {
    for (uint8_t i = 0; i < UDP_QUEUE_SLOTS; i++) {
      if (!udpQueue[i].used) {
        continue;
      }

      if (pass == 0 && udpQueue[i].priority != 3) {
        continue;
      }

      if (pass == 1 && udpQueue[i].priority < 2) {
        continue;
      }

      if (udpQueue[i].priority == 3 && sentIs >= UDP_FLUSH_IS_MAX) {
        continue;
      }

      if (udpQueue[i].priority < 3 && sentOther >= UDP_FLUSH_OTHER_MAX) {
        continue;
      }

      uint8_t sentPriority = udpQueue[i].priority;
      if (udpWriteLine(laptopIP, udpQueue[i].data, udpQueue[i].len)) {
        if (sentPriority == 3) {
          isForwardedTotal++;
        }
      } else if (sentPriority == 3) {
        isDroppedTotal++;
      }

      udpQueue[i].used = false;
      udpQueueCount--;

      if (sentPriority == 3) {
        sentIs++;
      } else {
        sentOther++;
      }
    }
  }

  for (uint8_t i = 0; i < UDP_QUEUE_SLOTS; i++) {
    if (!udpQueue[i].used || udpQueue[i].priority > 1) {
      continue;
    }

    if (sentOther >= UDP_FLUSH_OTHER_MAX) {
      break;
    }

    udpWriteLine(laptopIP, udpQueue[i].data, udpQueue[i].len);
    udpQueue[i].used = false;
    udpQueueCount--;
    sentOther++;
  }
}

String crearMensajeHello() {
  String msg = "ESP32_HELLO,";
  msg += WiFi.localIP().toString();
  msg += ",";
  msg += String(ESP32_LISTEN_PORT);
  msg += ",";
  msg += WiFi.gatewayIP().toString();
  msg += ",";
  msg += broadcastIP.toString();
  return msg;
}

void enviarHello() {
  String msg = crearMensajeHello();
  enviarBroadcastUDP(msg);
}

uint32_t esp32IsForwardedCount() {
  return isForwardedTotal;
}

uint32_t esp32IsDroppedCount() {
  return isDroppedTotal;
}
