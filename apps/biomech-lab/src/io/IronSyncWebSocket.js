export class IronSyncWebSocket {
  constructor({ onPacket, onStatus }) {
    this.onPacket = onPacket;
    this.onStatus = onStatus;
    this.socket = null;
  }

  connect(url) {
    this.disconnect();
    this.socket = new WebSocket(url);
    this.onStatus?.('Conectando');

    this.socket.addEventListener('open', () => this.onStatus?.('Conectado'));
    this.socket.addEventListener('close', () => this.onStatus?.('Desconectado'));
    this.socket.addEventListener('error', () => this.onStatus?.('Error WebSocket'));
    this.socket.addEventListener('message', (event) => {
      try {
        this.onPacket?.(JSON.parse(event.data));
      } catch {
        this.onStatus?.('Paquete inválido');
      }
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  send(payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(payload));
    return true;
  }
}
