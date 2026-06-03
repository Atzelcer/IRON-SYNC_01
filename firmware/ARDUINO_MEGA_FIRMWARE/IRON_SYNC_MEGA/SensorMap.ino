#include "IronSyncTypes.h"

/*
 * Mapa físico TCA9548 -> alias hueso (índice = bit de máscara IS / MEGA_SENSOR_INDEX_ORDER).
 * Superior 0x70: SD0..SD7 = chest,fL,sL,hL,sR,fR,hR,head.
 * Inferior 0x72: SD0=hip, SD1 libre, SD2..SD7 = tR,knR,ftR,tL,knL,ftL.
 */
SensorConfig sensorMap[SENSOR_COUNT] = {
  {"chest", "pecho",             "TCA_SUPERIOR_0x70", "SD0/SC0", TCA_SUPERIOR, 0, false, false},
  {"fL",    "codo_izquierdo",    "TCA_SUPERIOR_0x70", "SD1/SC1", TCA_SUPERIOR, 1, false, false},
  {"sL",    "hombro_izquierdo",  "TCA_SUPERIOR_0x70", "SD2/SC2", TCA_SUPERIOR, 2, false, false},
  {"hL",    "mano_izquierda",    "TCA_SUPERIOR_0x70", "SD3/SC3", TCA_SUPERIOR, 3, false, false},
  {"sR",    "hombro_derecho",    "TCA_SUPERIOR_0x70", "SD4/SC4", TCA_SUPERIOR, 4, false, false},
  {"fR",    "codo_derecho",      "TCA_SUPERIOR_0x70", "SD5/SC5", TCA_SUPERIOR, 5, false, false},
  {"hR",    "mano_derecha",      "TCA_SUPERIOR_0x70", "SD6/SC6", TCA_SUPERIOR, 6, false, false},
  {"head",  "cabeza",            "TCA_SUPERIOR_0x70", "SD7/SC7", TCA_SUPERIOR, 7, false, false},

  {"hip",   "cintura_medio",     "TCA_INFERIOR_0x72", "SD0/SC0", TCA_INFERIOR, 0, false, false},
  {"tR",    "muslo_derecho",     "TCA_INFERIOR_0x72", "SD2/SC2", TCA_INFERIOR, 2, false, false},
  {"knR",   "rodilla_derecha",   "TCA_INFERIOR_0x72", "SD3/SC3", TCA_INFERIOR, 3, false, false},
  {"ftR",   "pie_derecho",       "TCA_INFERIOR_0x72", "SD4/SC4", TCA_INFERIOR, 4, false, false},
  {"tL",    "muslo_izquierdo",   "TCA_INFERIOR_0x72", "SD5/SC5", TCA_INFERIOR, 5, false, false},
  {"knL",   "rodilla_izquierda", "TCA_INFERIOR_0x72", "SD6/SC6", TCA_INFERIOR, 6, false, false},
  {"ftL",   "pie_izquierdo",     "TCA_INFERIOR_0x72", "SD7/SC7", TCA_INFERIOR, 7, false, false}
};

BodySide bodySideFromKey(const char* key) {
  if (!key || key[0] == '\0') {
    return SIDE_CENTER;
  }

  size_t len = strlen(key);
  char last = key[len - 1];

  if (last == 'L') {
    return SIDE_LEFT;
  }

  if (last == 'R') {
    return SIDE_RIGHT;
  }

  return SIDE_CENTER;
}

int8_t findSensorIndexByKey(const char* key) {
  if (!key) {
    return -1;
  }

  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    if (strcmp(sensorMap[i].key, key) == 0) {
      return i;
    }
  }

  return -1;
}

int8_t findSensorIndexByTcaChannel(uint8_t tca, uint8_t channel) {
  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    if (sensorMap[i].tca == tca && sensorMap[i].channel == channel) {
      return (int8_t)i;
    }
  }

  return -1;
}

void emitSensorBindLine(Stream& out, uint8_t idx) {
  out.print("SENSOR_BIND,");
  out.print(sensorMap[idx].tca, HEX);
  out.print(",");
  out.print(sensorMap[idx].channel);
  out.print(",");
  out.print(sensorMap[idx].key);
  out.print(",");
  out.println(idx);
}

void verifySensorMapUnique() {
  bool duplicate = false;

  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    for (uint8_t j = i + 1; j < SENSOR_COUNT; j++) {
      if (
        sensorMap[i].tca == sensorMap[j].tca
        && sensorMap[i].channel == sensorMap[j].channel
      ) {
        duplicate = true;
        Serial.print("ERR,SENSOR_MAP_DUPLICATE,");
        Serial.print(sensorMap[i].tca, HEX);
        Serial.print(",");
        Serial.print(sensorMap[i].channel);
        Serial.print(",");
        Serial.print(sensorMap[i].key);
        Serial.print(",");
        Serial.println(sensorMap[j].key);
      }
    }
  }

  if (!duplicate) {
    Serial.println("SUIT_MAP_OK");
    Serial1.println("SUIT_MAP_OK");
  }
}

void printSuitPhysicalMap() {
  Serial.println("SUIT_MAP_BEGIN");
  Serial1.println("SUIT_MAP_BEGIN");

  for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
    emitSensorBindLine(Serial, i);
    emitSensorBindLine(Serial1, i);
  }

  Serial.println("SUIT_MAP_END");
  Serial1.println("SUIT_MAP_END");
}
