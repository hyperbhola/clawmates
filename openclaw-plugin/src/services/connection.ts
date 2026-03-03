import WebSocket from 'ws';
import type { SessionService } from './session.js';
import { PROTOCOL_VERSION } from '../types.js';

type MessageHandler = (message: Record<string, unknown>) => void;

/**
 * Manages the WebSocket connection to the ClawMates discovery service.
 * Handles connect, reconnect, send/receive, and periodic mailbox pickup.
 */
export class ConnectionService {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private session: SessionService;
  private messageHandlers: Map<string, MessageHandler[]> = new Map();
  private pendingResponses: Map<string, {
    resolve: (value: Record<string, unknown>) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();
  private pickupInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private requestCounter = 0;
  private connected = false;

  constructor(serverUrl: string, session: SessionService) {
    this.serverUrl = serverUrl;
    this.session = session;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.serverUrl);

        this.ws.on('open', () => {
          this.connected = true;
          resolve();

          // If we have an active session, start mailbox pickup
          if (this.session.isActive()) {
            this.startPickupLoop();
          }
        });

        this.ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleIncoming(message);
          } catch {
            // Ignore malformed messages
          }
        });

        this.ws.on('close', () => {
          this.connected = false;
          this.stopPickupLoop();
          this.scheduleReconnect();
        });

        this.ws.on('error', (err) => {
          if (!this.connected) {
            reject(err);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async disconnect(): Promise<void> {
    this.stopPickupLoop();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Send a message and wait for a response.
   * Uses a simple request-response matching based on expected response type.
   */
  async send(message: Record<string, unknown>, timeoutMs = 10000): Promise<Record<string, unknown>> {
    if (!this.isConnected()) {
      throw new Error('Not connected to discovery service');
    }

    return new Promise((resolve, reject) => {
      const requestId = String(++this.requestCounter);

      // Determine expected response type
      const expectedType = getExpectedResponseType(message.type as string);

      const timer = setTimeout(() => {
        this.pendingResponses.delete(requestId);
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingResponses.set(requestId, { resolve, reject, timer });

      // Temporarily register a one-shot handler for the expected response type
      const handler = (response: Record<string, unknown>) => {
        const pending = this.pendingResponses.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingResponses.delete(requestId);
          this.removeHandler(expectedType, handler);

          if (response.type === 'error') {
            pending.reject(new Error(`Server error: ${response.code} — ${response.message}`));
          } else {
            pending.resolve(response);
          }
        }
      };

      this.addHandler(expectedType, handler);
      this.addHandler('error', handler);

      this.ws!.send(JSON.stringify(message));
    });
  }

  /**
   * Register a persistent handler for a specific message type.
   */
  on(type: string, handler: MessageHandler): void {
    this.addHandler(type, handler);
  }

  off(type: string, handler: MessageHandler): void {
    this.removeHandler(type, handler);
  }

  // --- Mailbox pickup loop ---

  startPickupLoop(intervalMs = 30000): void {
    this.stopPickupLoop();
    // Immediate first pickup
    this.doPickup();
    this.pickupInterval = setInterval(() => this.doPickup(), intervalMs);
  }

  stopPickupLoop(): void {
    if (this.pickupInterval) {
      clearInterval(this.pickupInterval);
      this.pickupInterval = null;
    }
  }

  private async doPickup(): Promise<void> {
    const activeSession = this.session.getActiveSession();
    if (!activeSession || !this.isConnected()) return;

    try {
      const response = await this.send({
        type: 'relay.pickup',
        protocol_version: PROTOCOL_VERSION,
        session_id: activeSession.sessionId,
      });

      const messages = (response as any).messages;
      if (messages && messages.length > 0) {
        // Emit event for each pending message
        for (const msg of messages) {
          this.emit('relay.message_received', msg);
        }
      }
    } catch {
      // Silently fail on pickup errors — will retry on next interval
    }
  }

  // --- Internal ---

  private handleIncoming(message: Record<string, unknown>): void {
    const type = message.type as string;
    if (!type) return;

    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      for (const handler of [...handlers]) {
        handler(message);
      }
    }

    // Also emit to wildcard handlers
    const wildcardHandlers = this.messageHandlers.get('*');
    if (wildcardHandlers) {
      for (const handler of [...wildcardHandlers]) {
        handler(message);
      }
    }
  }

  private emit(type: string, data: unknown): void {
    this.handleIncoming({ type, ...(data as Record<string, unknown>) });
  }

  private addHandler(type: string, handler: MessageHandler): void {
    const existing = this.messageHandlers.get(type) || [];
    existing.push(handler);
    this.messageHandlers.set(type, existing);
  }

  private removeHandler(type: string, handler: MessageHandler): void {
    const existing = this.messageHandlers.get(type);
    if (existing) {
      const idx = existing.indexOf(handler);
      if (idx !== -1) existing.splice(idx, 1);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        this.scheduleReconnect();
      }
    }, 5000);
  }
}

function getExpectedResponseType(requestType: string): string {
  const responseMap: Record<string, string> = {
    'presence.register': 'presence.ack',
    'presence.refresh': 'presence.ack',
    'presence.withdraw': 'presence.withdrawn',
    'discovery.query': 'discovery.results',
    'relay.deposit': 'relay.deposited',
    'relay.pickup': 'relay.messages',
    'relay.ack': 'relay.ack_confirmed',
  };
  return responseMap[requestType] || 'unknown';
}
