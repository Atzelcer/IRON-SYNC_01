#include "IronSyncTypes.h"

/** Buffers fijos (sin String) — ahorra ~400–600 B de heap en Mega. */
#define COMMAND_BUFFER_SIZE 256

static char commandBufferUSB[COMMAND_BUFFER_SIZE];
static uint8_t commandLenUSB = 0;
static char commandBufferESP[COMMAND_BUFFER_SIZE];
static uint8_t commandLenESP = 0;

static void trimCmdInPlace(char* cmd) {
  if (!cmd) {
    return;
  }

  char* end = cmd + strlen(cmd);
  while (end > cmd && (end[-1] == ' ' || end[-1] == '\t' || end[-1] == '\r' || end[-1] == '\n')) {
    *--end = '\0';
  }

  char* start = cmd;
  while (*start == ' ' || *start == '\t') {
    start++;
  }

  if (start != cmd) {
    memmove(cmd, start, strlen(start) + 1);
  }
}

static bool isHeartbeatCommand(const char* cmd) {
  uint8_t len = (uint8_t)strlen(cmd);
  if (len < 2 || len > 20) {
    return false;
  }

  for (uint8_t i = 0; i < len; i++) {
    char c = cmd[i];
    if (c != 'H' && c != 'B') {
      return false;
    }
  }

  return true;
}

static void handleCommandsFrom(Stream &port, char *buffer, uint8_t &len, uint8_t maxLen) {
  uint8_t processed = 0;

  while (port.available() && processed < 8) {
    char c = port.read();

    if (c == '\n' || c == '\r') {
      if (len > 0) {
        buffer[len] = '\0';
        processCommand(buffer);
        processed++;
      }
      len = 0;
    } else if (len < (uint8_t)(maxLen - 1)) {
      buffer[len++] = c;
    } else {
      len = 0;
    }
  }
}

void handleCommands() {
  handleCommandsFrom(Serial, commandBufferUSB, commandLenUSB, sizeof(commandBufferUSB));
  handleCommandsFrom(Serial1, commandBufferESP, commandLenESP, sizeof(commandBufferESP));
  maintainLedBase();
}

void replyCommand(const char* msg) {
  Serial.println(msg);
  Serial1.println(msg);
}

void processCommand(const char* rawCmd) {
  char cmdWork[COMMAND_BUFFER_SIZE];
  strncpy(cmdWork, rawCmd, sizeof(cmdWork) - 1);
  cmdWork[sizeof(cmdWork) - 1] = '\0';
  trimCmdInPlace(cmdWork);
  char* cmd = cmdWork;

  if (isHeartbeatCommand(cmd)) {
    Serial1.println(F("MEGA_HB_OK"));
    return;
  }

  if (
    strcmp(cmd, "RUN_START") == 0
    && !calibrationDone
    && !isCalibrating
  ) {
    return;
  }

  Serial.print(F("CMD_RX="));
  Serial.println(cmd);

  if (strcmp(cmd, "UI_CONNECT_OK") == 0) {
    static unsigned long lastConnectFeedbackMs = 0;

    if (millis() - lastConnectFeedbackMs < 4500UL) {
      replyCommand("UI_CONNECT_OK_DONE");
      return;
    }

    lastConnectFeedbackMs = millis();
    systemRunning = false;
    calibrationDone = false;
    dataStreamPaused = false;
    isCalibrating = false;
    uiConnectOk();
    replyCommand("UI_CONNECT_OK_DONE");
    return;
  }

  if (strcmp(cmd, "UI_CALIBRATING") == 0) {
    replyCommand("UI_CALIBRATING_READY");
    return;
  }

  if (strcmp(cmd, "UI_DATA_STOP") == 0) {
    uiDataStop();
    replyCommand("UI_DATA_STOP_DONE");
    return;
  }

  if (strcmp(cmd, "UI_DISCONNECT") == 0) {
    systemRunning = false;

    if (isCalibrating) {
      calibrationAbortRequested = true;
      stopCalibrationVisual();
      stopPoseWaitVisual();
    }

    megaResetAfterDisconnect();
    return;
  }

  if (
    strcmp(cmd, "CAL_START") == 0 ||
    strcmp(cmd, "CALIBRATE") == 0 ||
    strcmp(cmd, "START") == 0
  ) {
    if (isCalibrating) {
      replyCommand("WARN,CAL_ALREADY_RUNNING");
      return;
    }

    calibrateAllIMUs();
    return;
  }

  if (strcmp(cmd, "CAL_ABORT") == 0) {
    calibrationAbortRequested = true;
    replyCommand("CAL_ABORT_PENDING");
    return;
  }

  if (strncmp(cmd, "LOAD_CAL_REFERENCE_SENSOR,", 26) == 0) {
    if (loadCalReferenceSensorLine(cmd)) {
      replyCommand("LOAD_CAL_REFERENCE_OK");
    } else {
      replyCommand("ERR,LOAD_CAL_REFERENCE_FAILED");
    }
    return;
  }

  if (strcmp(cmd, "REPRINT_CAL_REFERENCE") == 0) {
    printCalibrationReferenceSnapshot();
    replyCommand("CAL_REFERENCE_REPRINTED");
    return;
  }

  if (strncmp(cmd, "CAL_SENSOR,", 11) == 0) {
    const char* key = cmd + 11;
    trimCmdInPlace((char*)key);

    if (key[0] == '\0') {
      replyCommand("ERR,CAL_SENSOR_NEEDS_KEY");
      return;
    }

    calibrateSensorByKey(key, CAL_SAMPLES);
    return;
  }

  if (strncmp(cmd, "CAL_SENSOR_QUICK,", 17) == 0) {
    const char* key = cmd + 17;
    trimCmdInPlace((char*)key);

    if (key[0] == '\0') {
      replyCommand("ERR,CAL_SENSOR_NEEDS_KEY");
      return;
    }

    calibrateSensorByKey(key, CAL_QUICK_SAMPLES);
    return;
  }

  if (strcmp(cmd, "RUN_START") == 0) {
    if (isCalibrating) {
      replyCommand("WARN,CAL_IN_PROGRESS");
      return;
    }

    if (dataStreamPaused) {
      replyCommand("ERR,PAUSED_STOP");
      return;
    }

    if (calibrationDone) {
      systemRunning = true;
      setLedWhite();
      Serial1.println(F("STATUS,STREAM_STARTED"));
      replyCommand("RUNNING");
    }
    return;
  }

  if (strcmp(cmd, "RUN_STOP") == 0 || strcmp(cmd, "STOP") == 0) {
    bool wasRunning = systemRunning;

    systemRunning = false;
    dataStreamPaused = true;
    stopCalibrationVisual();
    stopPoseWaitVisual();

    if (isCalibrating) {
      calibrationAbortRequested = true;
      replyCommand("CAL_ABORT_PENDING");
      return;
    }

    if (wasRunning && calibrationDone) {
      uiDataStop();
    } else {
      setLedWhite();
    }

    replyCommand("STOPPED");
    return;
  }

  if (strcmp(cmd, "RESCAN") == 0) {
    scanAndConfigureSensors();
    replyCommand("RESCAN_DONE");
    return;
  }

  if (strcmp(cmd, "RESET_IMUS") == 0 || strcmp(cmd, "RECOVER_SENSORS") == 0) {
    resetAndRecoverIMUs();
    return;
  }

  if (strcmp(cmd, "PRINT_MAP") == 0) {
    printSensorMap();
    replyCommand("MAP_DONE");
    return;
  }

  if (strcmp(cmd, "PRINT_SUIT_MAP") == 0) {
    printSuitPhysicalMap();
    replyCommand("SUIT_MAP_DONE");
    return;
  }

  if (strcmp(cmd, "PRINT_PROFILE") == 0) {
    printCorrectionProfile();
    replyCommand("PROFILE_DONE");
    return;
  }

  if (strncmp(cmd, "SET_MOUNT,", 10) == 0) {
    char* comma1 = strchr(cmd + 10, ',');
    if (!comma1) {
      replyCommand("ERR,SET_MOUNT_FORMAT");
      return;
    }

    *comma1 = '\0';
    char* key = cmd + 10;
    char* layoutName = comma1 + 1;
    trimCmdInPlace(key);
    trimCmdInPlace(layoutName);
    for (char* p = layoutName; *p; p++) {
      if (*p >= 'a' && *p <= 'z') {
        *p = (char)(*p - 'a' + 'A');
      }
    }

    int8_t idx = findSensorIndexByKey(key);
    if (idx < 0) {
      replyCommand("ERR,UNKNOWN_SENSOR");
      return;
    }

    uint8_t layout = MOUNT_Z_UP;
    if (!layoutFromName(layoutName, layout)) {
      replyCommand("ERR,UNKNOWN_LAYOUT");
      return;
    }

    if (setSensorMountLayout((uint8_t)idx, layout)) {
      Serial1.print(F("SET_MOUNT_OK,"));
      Serial1.println(key);
      replyCommand("SET_MOUNT_OK");
    } else {
      replyCommand("ERR,SET_MOUNT_FAILED");
    }
    return;
  }

  if (strncmp(cmd, "CLEAR_MOUNT,", 12) == 0) {
    char* key = cmd + 12;
    trimCmdInPlace(key);
    int8_t idx = findSensorIndexByKey(key);

    if (idx < 0) {
      replyCommand("ERR,UNKNOWN_SENSOR");
      return;
    }

    clearSensorMountLayout((uint8_t)idx);
    Serial1.print(F("CLEAR_MOUNT_OK,"));
    Serial1.println(key);
    replyCommand("CLEAR_MOUNT_OK");
    return;
  }

  if (strcmp(cmd, "QUALITY") == 0) {
    for (uint8_t i = 0; i < SENSOR_COUNT; i++) {
      emitQuality(i);
    }
    printRuntimeStats();
    replyCommand("QUALITY_DONE");
    return;
  }

  if (strcmp(cmd, "STATS") == 0 || strcmp(cmd, "STRESS_STATUS") == 0) {
    printRuntimeStats();
    replyCommand("STATS_DONE");
    return;
  }

  if (strcmp(cmd, "STRESS_START") == 0) {
    resetRuntimeStats();
    replyCommand("STRESS_STARTED");
    return;
  }

  if (strcmp(cmd, "STATUS") == 0) {
    Serial1.print(F("STATUS,cal="));
    Serial1.print(calibrationDone ? 1 : 0);
    Serial1.print(F(",run="));
    Serial1.print(systemRunning ? 1 : 0);
    Serial1.print(F(",mask="));
    Serial1.print(getSensorMask());
    Serial1.print(F(",activeSensors="));
    Serial1.println(getActiveSensorCount());
    printRuntimeStats();

    Serial.print(F("STATUS,cal="));
    Serial.print(calibrationDone ? 1 : 0);
    Serial.print(F(",run="));
    Serial.print(systemRunning ? 1 : 0);
    Serial.print(F(",mask="));
    Serial.print(getSensorMask());
    Serial.print(F(",activeSensors="));
    Serial.println(getActiveSensorCount());
    return;
  }

  if (strcmp(cmd, "LED_WHITE") == 0) setLedWhite();
  if (strcmp(cmd, "LED_BLUE") == 0) setLedBlue();
  if (strcmp(cmd, "LED_AQUA") == 0) setLedAqua();
  if (strcmp(cmd, "LED_RED") == 0) setLedRed();
  if (strcmp(cmd, "LED_GREEN") == 0) setLedGreen();
  if (strcmp(cmd, "LED_YELLOW") == 0) setLedYellow();
  if (strcmp(cmd, "LED_PURPLE") == 0) setLedPurple();
  if (strcmp(cmd, "MASTER_CAL_PROCESSING") == 0) {
    startMasterCalibrationVisual();
    replyCommand("MASTER_CAL_PROCESSING_OK");
    return;
  }
  if (strcmp(cmd, "MASTER_CAL_OK") == 0) {
    stopCalibrationVisual();
    buzzerOk();
    replyCommand("MASTER_CAL_OK_DONE");
    return;
  }
  if (strcmp(cmd, "MASTER_CAL_FAIL") == 0) {
    stopCalibrationVisual();
    buzzerFail();
    replyCommand("MASTER_CAL_FAIL_DONE");
    return;
  }
  if (strcmp(cmd, "BUZZ_OK") == 0) buzzerOk();
  if (strcmp(cmd, "BUZZ_FAIL") == 0) buzzerFail();
}
