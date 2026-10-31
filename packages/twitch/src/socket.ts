import { WebSocket } from 'ws';

export interface EventSocket {
  onMessage(listener: (data: string) => void): void;
  onClose(listener: (code: number) => void): void;
  onError(listener: (error: Error) => void): void;
  close(): void;
}

export class TwitchSocket implements EventSocket {
  private readonly socket: WebSocket;

  constructor(url: string) {
    this.socket = new WebSocket(url, { maxPayload: 1024 * 1024, handshakeTimeout: 10_000 });
  }

  onMessage(listener: (data: string) => void): void {
    this.socket.on('message', (data) => listener(data.toString()));
  }

  onClose(listener: (code: number) => void): void {
    this.socket.on('close', listener);
  }
  onError(listener: (error: Error) => void): void {
    this.socket.on('error', listener);
  }
  close(): void {
    if (this.socket.readyState === WebSocket.CONNECTING) this.socket.terminate();
    else this.socket.close();
  }
}
