import type { AgentRegistry } from '../registry.js';
import type {
  BridgeConnection,
  WSSocket,
  WSCommand,
  WSMessage,
  WSRunCommand,
  WSStreamCommand,
  WSResumeCommand,
  WSCancelCommand,
  WSStateEvent,
  WSErrorEvent,
  WSRunResultEvent,
  WSStreamEvent,
  WSStreamCompleteEvent,
  WSCancelledEvent,
  WSPongEvent,
} from './types.js';
import { randomUUID } from 'node:crypto';
import { sanitizeError } from './sanitize-error.js';

export type { BridgeConnection, WSMessage, WSSocket } from './types.js';

interface ActiveStream {
  controller: AbortController;
  connectionId: string;
}

export class WebSocketBridge {
  private registry: AgentRegistry;
  private connections = new Map<string, BridgeConnection>();
  private activeStreams = new Map<string, ActiveStream>(); // requestId -> stream

  constructor(registry: AgentRegistry) {
    this.registry = registry;
  }

  /** Number of currently connected clients. */
  get connectionCount(): number {
    return this.connections.size;
  }

  /**
   * Handle a new WebSocket upgrade.
   * Returns the BridgeConnection for the caller to track.
   */
  handleUpgrade(socket: WSSocket): BridgeConnection {
    const id = `ws-${randomUUID()}`;
    const conn: BridgeConnection = { id, socket };
    this.connections.set(id, conn);

    socket.on('message', (raw: unknown) => {
      this.handleMessage(conn, typeof raw === 'string' ? raw : String(raw));
    });

    socket.on('close', () => {
      this.cleanupConnection(conn);
    });

    socket.on('error', () => {
      this.cleanupConnection(conn);
    });

    return conn;
  }

  /** Close all active connections. */
  closeAll(): void {
    for (const conn of this.connections.values()) {
      try {
        conn.socket.close();
      } catch {
        // best effort
      }
    }
    this.connections.clear();
    // Abort all active streams
    for (const stream of this.activeStreams.values()) {
      stream.controller.abort();
    }
    this.activeStreams.clear();
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private send(conn: BridgeConnection, msg: WSMessage): void {
    try {
      conn.socket.send(JSON.stringify(msg));
    } catch {
      // socket may have closed between message receipt and send
    }
  }

  private handleMessage(conn: BridgeConnection, raw: string): void {
    let parsed: WSCommand;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.send(conn, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    switch (parsed.type) {
      case 'ping':
        this.handlePing(conn);
        break;
      case 'run':
        this.handleRun(conn, parsed as unknown as WSRunCommand);
        break;
      case 'stream':
        this.handleStream(conn, parsed as unknown as WSStreamCommand);
        break;
      case 'resume':
        this.handleResume(conn, parsed as unknown as WSResumeCommand);
        break;
      case 'cancel':
        this.handleCancel(conn, parsed as unknown as WSCancelCommand);
        break;
      default:
        this.send(conn, {
          type: 'error',
          requestId: (parsed as { requestId?: string }).requestId,
          message: `Unknown command type: ${parsed.type}`,
        });
    }
  }

  private handlePing(conn: BridgeConnection): void {
    this.send(conn, { type: 'pong' } as WSPongEvent);
  }

  private async handleRun(conn: BridgeConnection, cmd: WSRunCommand): Promise<void> {
    if (!cmd.agentId || cmd.input === undefined) {
      this.send(conn, {
        type: 'error',
        requestId: cmd.requestId,
        message: 'Missing required fields: agentId, input',
      } as WSErrorEvent);
      return;
    }

    const agent = this.registry.get(cmd.agentId);
    if (!agent) {
      this.send(conn, {
        type: 'error',
        requestId: cmd.requestId,
        message: `Agent '${cmd.agentId}' not found`,
      } as WSErrorEvent);
      return;
    }

    // Emit state notification
    this.emitState(conn, cmd.agentId, agent.state ?? 'running');

    try {
      const result = await agent.run(cmd.input, cmd.sessionId ? { sessionId: cmd.sessionId } : undefined);
      this.send(conn, {
        type: 'run_result',
        requestId: cmd.requestId,
        response: result.response,
        tokenUsage: result.tokenUsage,
        sessionId: result.sessionId,
      } as WSRunResultEvent);

      this.emitState(conn, cmd.agentId, agent.state ?? 'completed');
    } catch (err) {
      const { message, correlationId } = sanitizeError(err);
      this.send(conn, {
        type: 'error',
        requestId: cmd.requestId,
        message,
        correlationId,
      } as WSErrorEvent);
    }
  }

  private async handleStream(conn: BridgeConnection, cmd: WSStreamCommand): Promise<void> {
    if (!cmd.agentId || cmd.input === undefined) {
      this.send(conn, {
        type: 'error',
        requestId: cmd.requestId,
        message: 'Missing required fields: agentId, input',
      } as WSErrorEvent);
      return;
    }

    const agent = this.registry.get(cmd.agentId);
    if (!agent) {
      this.send(conn, {
        type: 'error',
        requestId: cmd.requestId,
        message: `Agent '${cmd.agentId}' not found`,
      } as WSErrorEvent);
      return;
    }

    const controller = new AbortController();
    this.activeStreams.set(cmd.requestId, { controller, connectionId: conn.id });

    this.emitState(conn, cmd.agentId, agent.state ?? 'running');

    try {
      for await (const event of agent.streamEvents(cmd.input, cmd.sessionId ? { sessionId: cmd.sessionId, signal: controller.signal } : controller.signal)) {
        // Check if still connected
        if (!this.connections.has(conn.id)) return;

        if ((event as { type: string }).type === 'tool_call') {
          const toolEvent = event as { type: 'tool_call'; name: string; args: unknown };
          this.send(conn, {
            type: 'tool_call',
            requestId: cmd.requestId,
            name: toolEvent.name,
            args: toolEvent.args,
          });
        } else {
          this.send(conn, {
            type: 'stream_event',
            requestId: cmd.requestId,
            event,
          } as WSStreamEvent);
        }
      }

      this.send(conn, {
        type: 'stream_complete',
        requestId: cmd.requestId,
      } as WSStreamCompleteEvent);
    } catch (err) {
      // If aborted, don't send error — the cancel handler already sent cancelled
      if (controller.signal.aborted) return;
      const { message, correlationId } = sanitizeError(err);
      this.send(conn, {
        type: 'error',
        requestId: cmd.requestId,
        message,
        correlationId,
      } as WSErrorEvent);
    } finally {
      this.activeStreams.delete(cmd.requestId);
      this.emitState(conn, cmd.agentId, agent.state ?? 'completed');
    }
  }

  private async handleResume(conn: BridgeConnection, cmd: WSResumeCommand): Promise<void> {
    if (!cmd.agentId || !cmd.sessionId) {
      this.send(conn, {
        type: 'error',
        requestId: cmd.requestId,
        message: 'Missing required fields: agentId, sessionId',
      } as WSErrorEvent);
      return;
    }

    const agent = this.registry.get(cmd.agentId);
    if (!agent) {
      this.send(conn, {
        type: 'error',
        requestId: cmd.requestId,
        message: `Agent '${cmd.agentId}' not found`,
      } as WSErrorEvent);
      return;
    }

    this.emitState(conn, cmd.agentId, agent.state ?? 'running');

    try {
      const result = await agent.resume(cmd.sessionId);
      this.send(conn, {
        type: 'run_result',
        requestId: cmd.requestId,
        response: result.response,
        tokenUsage: result.tokenUsage,
        sessionId: result.sessionId,
      } as WSRunResultEvent);

      this.emitState(conn, cmd.agentId, agent.state ?? 'completed');
    } catch (err) {
      const { message, correlationId } = sanitizeError(err);
      this.send(conn, {
        type: 'error',
        requestId: cmd.requestId,
        message,
        correlationId,
      } as WSErrorEvent);
    }
  }

  private handleCancel(conn: BridgeConnection, cmd: WSCancelCommand): void {
    const stream = this.activeStreams.get(cmd.requestId);
    if (stream) {
      stream.controller.abort();
      this.activeStreams.delete(cmd.requestId);
    }
    this.send(conn, {
      type: 'cancelled',
      requestId: cmd.requestId,
    } as WSCancelledEvent);
  }

  private emitState(conn: BridgeConnection, agentId: string, state: string): void {
    this.send(conn, { type: 'state', agentId, state } as WSStateEvent);
  }

  private cleanupConnection(conn: BridgeConnection): void {
    this.connections.delete(conn.id);
    // Abort only the streams belonging to this connection
    for (const [requestId, stream] of [...this.activeStreams.entries()]) {
      if (stream.connectionId === conn.id) {
        stream.controller.abort();
        this.activeStreams.delete(requestId);
      }
    }
  }
}
