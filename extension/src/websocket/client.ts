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
  private responseHandlers = new Map<string, (response: CommandResponse) => void>();
  private disconnectHandlers: (() => void)[] = [];
  private heartbeatTimer: number | null = null;
  private lastPongTime: number = 0;
  private readonly HEARTBEAT_INTERVAL = 20000; // Send ping every 20 seconds
  private readonly PONG_TIMEOUT = 30000; // Consider connection dead if no pong for 30 seconds

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
          this.lastPongTime = Date.now();
          this.startHeartbeat();
          resolve();
        };
        
        this.ws.onclose = (event) => {
          console.log(`WebSocket disconnected from ${this.url}: code=${event.code}, reason=${event.reason}, wasClean=${event.wasClean}`);
          this.isConnecting = false;
          this.stopHeartbeat();
          this.ws = null;
          
          // Notify disconnect handlers
          this.notifyDisconnect();
          
          // Attempt to reconnect if not intentionally closed (1000 = normal closure)
          // Also avoid reconnecting for some specific error codes
          const shouldReconnect = event.code !== 1000 && // Normal closure
                                 event.code !== 1008 && // Policy violation
                                 event.code !== 1011 && // Server error
                                 this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS;
          
          if (shouldReconnect) {
            this.reconnectAttempts++;
            
            // Exponential backoff: 3s, 6s, 12s, 24s, 48s... capped at 60s
            const baseDelay = RECONNECT_DELAY; // 3000ms
            const exponentialDelay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts - 1), 60000);
            const jitter = Math.random() * 1000; // Add up to 1s jitter to avoid thundering herd
            const delay = exponentialDelay + jitter;
            
            console.log(`Attempting to reconnect (${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${Math.round(delay)}ms (exponential backoff)...`);
            setTimeout(() => this.connect().catch(console.error), delay);
          } else if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error(`Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
          } else {
            console.log(`Not reconnecting: code=${event.code}, wasClean=${event.wasClean}`);
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
      const commandId = command.command_id || `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const commandWithId = { ...command, command_id: commandId };

      // Set up response handler
      const timeout = setTimeout(() => {
        this.responseHandlers.delete(commandId);
        reject(new Error(`Command timeout: ${commandId}`));
      }, 30000); // 30 second timeout

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
    
    // Use global setInterval (works in both window context and Service Worker)
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        console.log('❤️ Heartbeat skipped: WebSocket not open');
        return;
      }
      
      // Check if we haven't received a pong in too long
      const timeSinceLastPong = Date.now() - this.lastPongTime;
      if (timeSinceLastPong > this.PONG_TIMEOUT) {
        console.warn(`❤️ No pong received for ${timeSinceLastPong}ms (timeout: ${this.PONG_TIMEOUT}ms). Connection may be dead.`);
        // Try to reconnect
        this.ws.close(1000, 'Heartbeat timeout');
        return;
      }
      
      // Send ping to server
      try {
        this.ws.send(JSON.stringify({ type: 'ping' }));
        console.log('❤️ Sent ping to server');
      } catch (error) {
        console.error('❤️ Failed to send ping:', error);
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      console.log('❤️ Stopped WebSocket heartbeat');
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Global WebSocket client instance
export const wsClient = new WebSocketClient();