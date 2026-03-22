/**
 * WebSocket Client for connecting to Local Chrome Server
 */

import type { Command, CommandResponse } from '../types';

const DEFAULT_WS_URL = 'ws://127.0.0.1:8766';
const RECONNECT_DELAY = 3000; // 3 seconds
const MAX_RECONNECT_ATTEMPTS = 10;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private isConnecting = false;
  private messageHandlers: ((data: any) => void)[] = [];
  private responseHandlers = new Map<
    string,
    (response: CommandResponse) => void
  >();
  private disconnectHandlers: (() => void)[] = [];
  private heartbeatTimer: number | null = null;
  private lastPongTime: number = 0;
  private lastPingTime: number = 0;
  private readonly HEARTBEAT_INTERVAL = 5000; // Send ping every 5 seconds
  private readonly PONG_TIMEOUT = 15000; // Consider connection dead if no pong for 15 seconds
  private activeCommandCount = 0;
  private isHeartbeatScheduled = false;
  private activeCommands = new Map<
    string,
    { type: string; startTime: number; data?: any }
  >();

  constructor(url: string = DEFAULT_WS_URL) {
    this.url = url;
  }

  connect(): Promise<void> {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.isConnecting = true;

      try {
        console.log(`🔌 Connecting to WebSocket server at ${this.url}`);
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('✅ WebSocket connected to server at', this.url);
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          const now = Date.now();
          this.lastPongTime = now;
          this.lastPingTime = now - this.HEARTBEAT_INTERVAL; // Initialize so first ping can be sent immediately
          this.startHeartbeat();
          resolve();
        };

        this.ws.onclose = (event) => {
          console.log(
            `WebSocket disconnected from ${this.url}: code=${event.code}, reason=${event.reason}, wasClean=${event.wasClean}`,
          );
          this.isConnecting = false;
          this.stopHeartbeat();
          this.ws = null;

          // Notify disconnect handlers
          this.notifyDisconnect();

          // Special handling for heartbeat timeout (code 1001)
          if (event.code === 1001 && event.reason === 'Heartbeat timeout') {
            // Heartbeat timeout is usually due to temporary main thread blocking
            // Try to reconnect immediately with minimal delay
            console.log(
              '💓 Heartbeat timeout detected, attempting immediate reconnection...',
            );

            // Use a short delay to allow main thread to recover
            const shortDelay = 500; // 0.5 seconds
            setTimeout(() => {
              console.log('💓 Attempting heartbeat timeout reconnection...');
              this.connect().catch((error) => {
                console.error('💓 Heartbeat reconnection failed:', error);
                // If immediate reconnection fails, fall back to normal reconnection logic
                this.scheduleNormalReconnection(event);
              });
            }, shortDelay);
            return;
          }

          // Attempt to reconnect if not intentionally closed (1000 = normal closure)
          // Also avoid reconnecting for some specific error codes
          const shouldReconnect =
            event.code !== 1000 && // Normal closure
            event.code !== 1008 && // Policy violation
            event.code !== 1011 && // Server error
            this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS;

          if (shouldReconnect) {
            this.scheduleNormalReconnection(event);
          } else if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error(
              `Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`,
            );
          } else {
            console.log(
              `Not reconnecting: code=${event.code}, wasClean=${event.wasClean}`,
            );
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.isConnecting = false;
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            // Handle pong messages for heartbeat
            if (data.type === 'pong') {
              this.lastPongTime = Date.now();
              console.log('❤️ Received pong from server');
              return;
            }

            this.handleMessage(data);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnected');
      this.ws = null;
    }
    this.reconnectAttempts = 0;
  }

  sendCommand(command: Command): Promise<CommandResponse> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      // Generate command ID if not present
      const commandId =
        command.command_id ||
        `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const commandWithId = { ...command, command_id: commandId };

      // Set up response handler
      const timeout = setTimeout(() => {
        this.responseHandlers.delete(commandId);
        reject(new Error(`Command timeout: ${commandId}`));
      }, 15000); // Reduced from 30000 to 15000ms (15 seconds) for better heartbeat responsiveness

      this.responseHandlers.set(commandId, (response) => {
        clearTimeout(timeout);
        this.responseHandlers.delete(commandId);
        resolve(response);
      });

      // Send command
      try {
        this.ws.send(JSON.stringify(commandWithId));
      } catch (error) {
        this.responseHandlers.delete(commandId);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  sendMessage(message: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      try {
        this.ws.send(JSON.stringify(message));
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  onMessage(handler: (data: any) => void): void {
    this.messageHandlers.push(handler);
  }

  offMessage(handler: (data: any) => void): void {
    const index = this.messageHandlers.indexOf(handler);
    if (index > -1) {
      this.messageHandlers.splice(index, 1);
    }
  }

  private handleMessage(data: any): void {
    // Handle command responses
    if (data.command_id && this.responseHandlers.has(data.command_id)) {
      const handler = this.responseHandlers.get(data.command_id)!;
      handler(data);
      return;
    }

    // Handle other messages
    for (const handler of this.messageHandlers) {
      try {
        handler(data);
      } catch (error) {
        console.error('Error in message handler:', error);
      }
    }
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandlers.push(handler);
  }

  offDisconnect(handler: () => void): void {
    const index = this.disconnectHandlers.indexOf(handler);
    if (index > -1) {
      this.disconnectHandlers.splice(index, 1);
    }
  }

  private notifyDisconnect(): void {
    for (const handler of this.disconnectHandlers) {
      try {
        handler();
      } catch (error) {
        console.error('Error in disconnect handler:', error);
      }
    }
  }

  private startHeartbeat(): void {
    // Clear any existing heartbeat
    this.stopHeartbeat();

    console.log('❤️ Starting WebSocket heartbeat');

    // Use recursive setTimeout instead of setInterval to prevent callback stacking
    this.isHeartbeatScheduled = true;
    this.scheduleNextHeartbeat();
  }

  private scheduleNextHeartbeat(): void {
    if (!this.isHeartbeatScheduled || this.heartbeatTimer !== null) {
      return;
    }

    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      this.performHeartbeat();
      this.scheduleNextHeartbeat();
    }, this.HEARTBEAT_INTERVAL) as unknown as number;
  }

  private performHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('❤️ Heartbeat skipped: WebSocket not open');
      return;
    }

    const now = Date.now();
    const timeSinceLastPong = now - this.lastPongTime;
    const timeSinceLastPing = now - this.lastPingTime;

    // Early warning: if we haven't sent a ping in > 2x heartbeat interval
    if (timeSinceLastPing > this.HEARTBEAT_INTERVAL * 2) {
      console.warn(
        `⚠️ Possible main thread slowdown: Haven't sent ping for ${timeSinceLastPing}ms (> 2x interval ${this.HEARTBEAT_INTERVAL * 2}ms)`,
      );
    }

    // Critical check: if we haven't sent a ping in too long, send immediately
    if (timeSinceLastPing > this.PONG_TIMEOUT) {
      console.error(
        `🚨 CRITICAL: Haven't sent ping for ${timeSinceLastPing}ms (> PONG timeout ${this.PONG_TIMEOUT}ms)! Main thread may be blocked.`,
      );
      // Still try to send ping
    }

    // Check if we haven't received a pong in too long
    if (timeSinceLastPong > this.PONG_TIMEOUT) {
      console.warn(
        `❤️ No pong received for ${timeSinceLastPong}ms (timeout: ${this.PONG_TIMEOUT}ms). Connection may be dead.`,
      );
      // Try to reconnect - use code 1001 (Going Away) to trigger reconnection
      // 1001: "The endpoint is going away" - appropriate for heartbeat timeout
      this.ws.close(1001, 'Heartbeat timeout');
      return;
    }

    // Check if there are active commands that might block the main thread
    if (this.activeCommandCount > 0) {
      console.log(
        `❤️ Active commands: ${this.activeCommandCount}, still sending ping`,
      );

      // Log detailed information about active commands
      if (this.activeCommands.size > 0) {
        const now = Date.now();
        console.log('🔍 Active command details:');
        for (const [commandId, cmdInfo] of this.activeCommands.entries()) {
          const duration = now - cmdInfo.startTime;
          console.log(
            `  - ${cmdInfo.type} (ID: ${commandId}): ${duration}ms, data: ${JSON.stringify(cmdInfo.data || {}).substring(0, 100)}`,
          );

          // Warn about very long-running commands
          if (duration > 20000) {
            console.error(
              `🚨 EXTREMELY LONG COMMAND: ${cmdInfo.type} running for ${duration}ms!`,
            );
          } else if (duration > 10000) {
            console.warn(
              `⚠️ Long command: ${cmdInfo.type} running for ${duration}ms`,
            );
          }
        }
      }

      // If there are active commands and last ping was recent, we might delay this ping
      // to avoid overloading the main thread
      if (timeSinceLastPing < this.HEARTBEAT_INTERVAL) {
        console.log(
          `❤️ Delaying ping due to active commands and recent ping (${timeSinceLastPing}ms ago)`,
        );
        return;
      }
    }

    // Check if last ping was too recent (shouldn't happen with proper scheduling)
    if (timeSinceLastPing < this.HEARTBEAT_INTERVAL / 2) {
      console.warn(
        `❤️ Last ping was only ${timeSinceLastPing}ms ago, skipping to avoid flooding`,
      );
      return;
    }

    // Send ping to server
    try {
      this.ws.send(JSON.stringify({ type: 'ping' }));
      this.lastPingTime = now;
      console.log(
        `❤️ Sent ping to server (active commands: ${this.activeCommandCount}, last pong: ${timeSinceLastPong}ms ago)`,
      );
    } catch (error) {
      console.error('❤️ Failed to send ping:', error);
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.isHeartbeatScheduled = false;
    console.log('❤️ Stopped WebSocket heartbeat');
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Track command execution for heartbeat health monitoring
   */
  trackCommandStart(commandId: string, commandType: string, data?: any): void {
    this.activeCommandCount++;
    this.activeCommands.set(commandId, {
      type: commandType,
      startTime: Date.now(),
      data: data,
    });

    if (this.activeCommandCount > 5) {
      console.warn(`⚠️ High active command count: ${this.activeCommandCount}`);
    }

    console.log(
      `📊 Command tracking: Started ${commandType} (ID: ${commandId}), active: ${this.activeCommandCount}`,
    );
  }

  trackCommandEnd(commandId: string): void {
    if (this.activeCommands.has(commandId)) {
      const cmdInfo = this.activeCommands.get(commandId)!;
      const duration = Date.now() - cmdInfo.startTime;
      this.activeCommands.delete(commandId);

      if (this.activeCommandCount > 0) {
        this.activeCommandCount--;
      }

      console.log(
        `📊 Command tracking: Completed ${cmdInfo.type} (ID: ${commandId}) in ${duration}ms, active: ${this.activeCommandCount}`,
      );

      if (duration > 10000) {
        console.warn(
          `⏱️ Long command completed: ${cmdInfo.type} took ${duration}ms`,
        );
      }
    } else {
      // Command not found in tracking, still decrement count
      if (this.activeCommandCount > 0) {
        this.activeCommandCount--;
      }
      console.warn(
        `📊 Command tracking: Command ${commandId} not found in active commands, decremented count anyway`,
      );
    }
  }

  /**
   * Schedule a normal reconnection with exponential backoff
   */
  private scheduleNormalReconnection(_event: CloseEvent): void {
    this.reconnectAttempts++;

    // Exponential backoff: 3s, 6s, 12s, 24s, 48s... capped at 60s
    const baseDelay = RECONNECT_DELAY; // 3000ms
    const exponentialDelay = Math.min(
      baseDelay * Math.pow(2, this.reconnectAttempts - 1),
      60000,
    );
    const jitter = Math.random() * 1000; // Add up to 1s jitter to avoid thundering herd
    const delay = exponentialDelay + jitter;

    console.log(
      `Attempting to reconnect (${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${Math.round(delay)}ms (exponential backoff)...`,
    );
    setTimeout(() => this.connect().catch(console.error), delay);
  }

  incrementActiveCommandCount(): void {
    this.activeCommandCount++;
    if (this.activeCommandCount > 5) {
      console.warn(`⚠️ High active command count: ${this.activeCommandCount}`);
    }
  }

  decrementActiveCommandCount(): void {
    if (this.activeCommandCount > 0) {
      this.activeCommandCount--;
    }
  }

  getActiveCommandCount(): number {
    return this.activeCommandCount;
  }

  getActiveCommands(): Map<
    string,
    { type: string; startTime: number; data?: any }
  > {
    return this.activeCommands;
  }
}

// Global WebSocket client instance
export const wsClient = new WebSocketClient();
