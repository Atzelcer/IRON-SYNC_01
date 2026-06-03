#ifndef IRON_SYNC_TYPES_H
#define IRON_SYNC_TYPES_H

#include <Arduino.h>
#include "IronSyncConfig.h"

enum IronAxisSource {
  AXIS_NONE = 0,
  AXIS_PITCH = 1,
  AXIS_ROLL = 2,
  AXIS_YAW_RATE = 3
};

enum BodySide {
  SIDE_CENTER = 0,
  SIDE_LEFT = 1,
  SIDE_RIGHT = 2
};

enum ImuMountLayout {
  MOUNT_Z_UP = 0,
  MOUNT_Z_DOWN = 1,
  MOUNT_Y_UP = 2,
  MOUNT_Y_DOWN = 3,
  MOUNT_X_UP = 4,
  MOUNT_X_DOWN = 5
};

struct SensorConfig {
  const char* key;
  const char* label;
  const char* tcaName;
  const char* sdsc;
  uint8_t tca;
  uint8_t channel;
  bool active;
  bool calibrated;
};

struct AxisCorrection {
  IronAxisSource source;
  int8_t sign;
  float gain;
  float deadzone;
  float limitMin;
  float limitMax;
};

struct SensorCorrectionProfile {
  const char* key;
  AxisCorrection rx;
  AxisCorrection ry;
  AxisCorrection rz;
  bool yawRateAbsoluteAllowed;
};

struct ImuMountProfile {
  uint8_t layout;
  bool detected;
  float gravityX;
  float gravityY;
  float gravityZ;
};

struct ImuState {
  float gyroOffX;
  float gyroOffY;
  float gyroOffZ;

  float pitch;
  float roll;
  float yawRate;

  float zeroPitch;
  float zeroRoll;
  float zeroYawRate;

  float outRx;
  float outRy;
  float outRz;

  int16_t rawAx;
  int16_t rawAy;
  int16_t rawAz;
  int16_t rawGx;
  int16_t rawGy;
  int16_t rawGz;

  float motionScore;
  bool quiet;

  float calJitterDeg;
  float calGyroJitterDps;

  ImuMountProfile mount;

  /** true tras LOAD_CAL_REFERENCE_SENSOR desde el laboratorio (pose mesh). */
  bool labReferenceLoaded;

  unsigned long lastMicros;
  unsigned long lastGoodReadMs;
  unsigned long lastRecoverAttemptMs;
  uint8_t failCount;
  bool lostReported;
};

// ================= GLOBALS =================
extern unsigned long lastSendTime;
extern unsigned long lastWireRecoveryMs;
extern unsigned long lastGlobalRecoverMs;
extern uint32_t lastWireReportedReadFailures;
extern uint16_t frameId;
extern uint32_t packetCounter;
extern uint32_t readFailureTotal;
extern uint32_t recoverAttemptTotal;
extern uint32_t recoverSuccessTotal;
extern uint32_t lostEventTotal;
extern uint16_t maxReadAllImusMs;
extern uint16_t maxLoopMs;
extern bool systemRunning;
extern bool calibrationDone;
extern bool dataStreamPaused;
extern bool isCalibrating;
extern bool calibrationAbortRequested;
extern bool ledUserFeedbackActive;

extern SensorConfig sensorMap[SENSOR_COUNT];
extern ImuState imu[SENSOR_COUNT];

// ================= PROTO =================
const char* axisSourceName(IronAxisSource source);
BodySide bodySideFromKey(const char* key);
int8_t findSensorIndexByKey(const char* key);
int8_t findSensorIndexByTcaChannel(uint8_t tca, uint8_t channel);
void emitSensorBindLine(Stream& out, uint8_t idx);
void verifySensorMapUnique();
void printSuitPhysicalMap();

float clampFloat(float value, float minValue, float maxValue);
float applyDeadzone(float value, float deadzone);
float limitStep(float current, float previous, float maxStep);
float angleDeltaDeg(float current, float reference);
float maxFloat(float a, float b);
float lowPassFilter(float previous, float sample, float alpha);
void updateMotionState(uint8_t idx, float pitchDelta, float rollDelta, float gyroMagDps);

void remapAccelToBody(float axg, float ayg, float azg, const ImuMountProfile& mount, float& ox, float& oy, float& oz);
void remapGyroToBody(float gxdps, float gydps, float gzdps, const ImuMountProfile& mount, float& ox, float& oy, float& oz);
void computePitchRollFromAccel(float axg, float ayg, float azg, const ImuMountProfile& mount, float& pitch, float& roll);
void detectMountFromGravityMean(float meanAx, float meanAy, float meanAz, ImuMountProfile& mount);
bool layoutFromName(const char* name, uint8_t& layout);
bool setSensorMountLayout(uint8_t idx, uint8_t layout);
void clearSensorMountLayout(uint8_t idx);
void emitMountProfile(uint8_t idx);

void initCorrectionProfiles();
void resetCorrectionProfileForSensor(uint8_t idx);
void applyMountToCorrectionSigns(uint8_t idx);
void applyBodySideToCorrectionSigns(uint8_t idx);
void getOutputAxisCorrection(uint8_t idx, uint8_t channel, AxisCorrection& out);
void printCorrectionProfile();

float readAxisValue(uint8_t idx, IronAxisSource source);
float applyAxisCorrection(uint8_t idx, AxisCorrection correction);
void updateCorrectedOutputs(uint8_t idx);

void resetTCAs();
bool selectTCA(uint8_t tca, uint8_t channel);
bool detectMPU(uint8_t idx);
bool writeMPU(uint8_t idx, uint8_t reg, uint8_t value);
bool configureMPU(uint8_t idx);
bool readMPURaw(uint8_t idx, int16_t& ax, int16_t& ay, int16_t& az, int16_t& gx, int16_t& gy, int16_t& gz);

void scanAndConfigureSensors();
void printSensorMap();
uint8_t countActiveDetected();
void tryRecoverMissingSensors();

void emitCalibrationProgress(uint8_t percent);
void emitSensorState(uint8_t idx, const char* state);
void emitQuality(uint8_t idx);
void emitCalibrationSensor(uint8_t idx, const char* state);
void markSensorLost(uint8_t idx);
bool recoverOneIMU(uint8_t idx);
void recoverAllInactiveSensors();
void resetAndRecoverIMUs();
void initImuSystemNoCalibration();

bool calibrateOneIMU(uint8_t idx, uint16_t sampleCount);
bool quickRecalibrateOneIMU(uint8_t idx);
void calibrateAllIMUs();
bool calibrateSensorByKey(const char* key, uint16_t sampleCount);

void readOneIMU(uint8_t idx);
void readAllImus();
uint16_t getSensorMask();
uint8_t getActiveSensorCount();
bool shouldStreamSensor(uint8_t idx);
int getPitchOut(uint8_t idx);
int getRollOut(uint8_t idx);
int getYawRateOut(uint8_t idx);

void printRuntimeStats();
void resetRuntimeStats();

void initBio();
void readBio();
void calibrateEMG();

void initLedBuzzer();
void setLedWhite();
void setLedBlue();
void setLedAqua();
void setLedRed();
void setLedGreen();
void setLedYellow();
void setLedPurple();
void startPoseWaitVisual();
void stopPoseWaitVisual();
void poseWaitEffectTick();
bool waitForCalibrationPose();
void finishCalibrationAborted();
bool calibrationShouldAbort();
void clearCalibrationAbort();
bool loadCalReferenceSensorLine(const char* line);
void processCommand(const char* cmd);
void printCalibrationReferenceSnapshot();
void startCalibrationVisual();
void startMasterCalibrationVisual();
void stopCalibrationVisual();
void finishCalibrationStandby();
void maintainLedBase();
void calibrationEffectTick();
void melodyCalStartAck();
void melodyCalWaitTick();
void melodyPoseReady();
void buzzerDone();
void buzzerPartialCalibration();
void buzzerFail();
void buzzerOk();

void handleCommands();
void uiConnectOk();
void uiDataStop();
void uiDisconnect();
void showChestDisconnectVisual();
void showChestDisconnectHold();
void megaResetAfterDisconnect();

void sendCompactPacket();

extern int ecgRaw;
extern int emgRaw;
extern int emgIntensity;
extern int emgBaseline;
extern int ecgLoPlus;
extern int ecgLoMinus;

#endif
