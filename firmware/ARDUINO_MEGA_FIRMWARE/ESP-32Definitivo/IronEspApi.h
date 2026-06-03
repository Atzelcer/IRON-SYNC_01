#ifndef IRON_ESP_API_H
#define IRON_ESP_API_H

#include <Arduino.h>
#include <WiFi.h>

void enviarHello();
void enviarUDP(const String& msg, uint8_t priority);
void enviarBroadcastUDP(const String& msg);
void enviarUdpReplyTo(IPAddress ip, const char* msg);
void enviarUdpReplyTo(IPAddress ip, const String& msg);
void enviarISLineaDirecta(const char* line, uint16_t len);
void flushUdpQueue();
void queueUdpLine(const char* msg, uint16_t len, uint8_t priority);
void enviarUDPDirecto(const String& msg);

void megaUIConnectOK();
void megaUICalibrating();
void megaUIDataStop();
void megaUIDisconnect();

void recibirUDPDesdeLaptop();
void recibirDesdeMegaYEnviarLaptop();
void actualizarEstadoDesdeMega(const char* msg, uint16_t len);
bool esLineaValidaParaLaptop(const char* msg, uint16_t len);
bool esLineaAckInternoMega(const char* msg, uint16_t len);
void flushMegaSerialRx();

void prepararMegaParaNuevaConexion();
void registrarLaptop(IPAddress remoteIP);
void touchLaptopSessionAlive();
void iniciarDesconexion(const char* motivo);
void finalizarDesconexion(const char* motivo);

bool asegurarWiFiListo();
void onWiFiReady();
void mantenerHelloSiNoHayLaptop();
void verificarAcksMega();
void verificarHeartbeatLaptop();

uint32_t esp32IsForwardedCount();
uint32_t esp32IsDroppedCount();

extern const char* ssid;
extern const char* password;

#endif
