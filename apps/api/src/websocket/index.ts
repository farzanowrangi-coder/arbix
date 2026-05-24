import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import type { WsEvent, ScannerStatus } from '@arbix/shared';
import { logger } from '../logger';

interface Client {
  ws: WebSocket;
  userId?: string;
  isAlive: boolean;
}

export class WebSocketManager {
  private clients = new Map<string, Client>();
  private heartbeatInterval?: ReturnType<typeof setInterval>;

  initialize(fastify: FastifyInstance, getStatus?: () => ScannerStatus): void {
    fastify.get('/ws', { websocket: true }, (socket, req) => {
      const clientId = Math.random().toString(36).slice(2);
      const client: Client = { ws: socket, isAlive: true };

      // Authenticate via token query param
      const token = (req.query as any)?.token;
      if (token) {
        try {
          const payload = fastify.jwt.verify(token) as { id: string };
          client.userId = payload.id;
        } catch {
          logger.debug('WS connection with invalid token, proceeding unauthenticated');
        }
      }

      this.clients.set(clientId, client);
      logger.debug(`WebSocket client connected: ${clientId} (user: ${client.userId ?? 'anon'})`);

      socket.on('pong', () => {
        const c = this.clients.get(clientId);
        if (c) c.isAlive = true;
      });

      socket.on('message', (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') {
            this.send(socket, { type: 'pong', payload: {}, timestamp: new Date().toISOString() });
          }
        } catch {
          // ignore malformed messages
        }
      });

      socket.on('close', () => {
        this.clients.delete(clientId);
        logger.debug(`WebSocket client disconnected: ${clientId}`);
      });

      socket.on('error', (err: Error) => {
        logger.error('WebSocket error', { clientId, error: err.message });
        this.clients.delete(clientId);
      });

      if (getStatus) {
        this.send(socket, {
          type: 'scanner:status',
          payload: getStatus(),
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Heartbeat to prune dead connections
    this.heartbeatInterval = setInterval(() => {
      for (const [id, client] of this.clients.entries()) {
        if (!client.isAlive) {
          client.ws.terminate();
          this.clients.delete(id);
          continue;
        }
        client.isAlive = false;
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.ping();
        }
      }
    }, 30_000);
  }

  broadcast<T>(event: WsEvent<T>): void {
    const payload = JSON.stringify(event);
    let sent = 0;

    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
        sent++;
      }
    }

    if (sent > 0) {
      logger.debug(`Broadcast ${event.type} to ${sent} clients`);
    }
  }

  broadcastToUser<T>(userId: string, event: WsEvent<T>): void {
    const payload = JSON.stringify(event);

    for (const client of this.clients.values()) {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    }
  }

  private send<T>(ws: WebSocket, event: WsEvent<T>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  get connectedCount(): number {
    return this.clients.size;
  }

  destroy(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    for (const client of this.clients.values()) {
      client.ws.terminate();
    }
    this.clients.clear();
  }
}

export const wsManager = new WebSocketManager();
