/**
 * Task Notification Manager
 *
 * Handles notifications for task events via WebSocket, Webhook, and internal handlers.
 */
import type { TaskEvent } from '@primo-ai/sdk';

type NotificationHandler = (data: unknown) => void;

interface WebSocketLike {
  send: (msg: string) => void;
}

export class TaskNotificationManager {
  private websockets = new Set<WebSocketLike>();
  private webhooks = new Set<string>();
  private eventHandlers = new Map<TaskEvent, Set<NotificationHandler>>();

  addWebSocket(ws: WebSocketLike): void {
    this.websockets.add(ws);
  }

  removeWebSocket(ws: WebSocketLike): void {
    this.websockets.delete(ws);
  }

  addWebhook(url: string): void {
    this.webhooks.add(url);
  }

  removeWebhook(url: string): void {
    this.webhooks.delete(url);
  }

  on(event: TaskEvent, handler: NotificationHandler): void {
    const handlers = this.eventHandlers.get(event) ?? new Set();
    handlers.add(handler);
    this.eventHandlers.set(event, handlers);
  }

  off(event: TaskEvent, handler: NotificationHandler): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  async notify(event: TaskEvent, data: unknown): Promise<void> {
    const message = JSON.stringify({ type: event, data, timestamp: Date.now() });

    // WebSocket push
    for (const ws of this.websockets) {
      try {
        ws.send(message);
      } catch {
        // Ignore WebSocket errors
      }
    }

    // Webhook callbacks
    for (const url of this.webhooks) {
      try {
        await fetch(url, {
          method: 'POST',
          body: message,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch {
        // Ignore webhook errors
      }
    }

    // Internal event handlers
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch {
          // Ignore handler errors
        }
      }
    }
  }
}
