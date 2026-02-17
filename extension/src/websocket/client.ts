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
          resolve();
        };
        
        this.ws.onclose = (event) => {
          console.log(`WebSocket disconnected from ${this.url}: code=${event.code}, reason=${event.reason}, wasClean=${event.wasClean}`);
          this.isConnecting = false;
          this.ws = null;
          
          // Attempt to reconnect if not intentionally closed
          if (event.code !== 1000 && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            this.reconnectAttempts++;
            console.log(`Attempting to reconnect (${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${RECONNECT_DELAY}ms...`);
            setTimeout(() => this.connect().catch(console.error), RECONNECT_DELAY);
          } else if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error(`Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
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

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Global WebSocket client instance
export const wsClient = new WebSocketClient();