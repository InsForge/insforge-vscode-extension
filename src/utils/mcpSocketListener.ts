import { io, Socket } from 'socket.io-client';

export interface McpConnectedEvent {
  tool_name: string;
  created_at: string;
}

export interface McpSocketCallbacks {
  onConnected?: () => void;
  onMcpEvent?: (event: McpConnectedEvent) => void;
  onDisconnected?: () => void;
  onError?: (error: string) => void;
}

/**
 * MCP Socket Listener - Listens for mcp:connected events from the project backend
 * Used to verify that MCP is actually working with the coding agent
 */
export class McpSocketListener {
  private socket: Socket | null = null;
  private projectId: string;
  private apiKey: string;
  private apiBaseUrl: string;
  private callbacks: McpSocketCallbacks;
  private hasReceivedEvent: boolean = false;

  constructor(
    projectId: string,
    apiKey: string,
    apiBaseUrl: string,
    callbacks: McpSocketCallbacks
  ) {
    this.projectId = projectId;
    this.apiKey = apiKey;
    this.apiBaseUrl = apiBaseUrl;
    this.callbacks = callbacks;
  }

  /**
   * Start listening for MCP connected events
   */
  connect(): void {
    if (this.socket?.connected) {
      return;
    }

    try {
      // Connect to the project's Socket.IO server with API key auth
      this.socket = io(this.apiBaseUrl, {
        auth: {
          apiKey: this.apiKey,
        },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      });

      this.socket.on('connect', () => {
        console.log(`[McpSocketListener] Connected to ${this.apiBaseUrl} for project ${this.projectId}`);
        this.callbacks.onConnected?.();
      });

      this.socket.on('disconnect', (reason) => {
        console.log(`[McpSocketListener] Disconnected: ${reason}`);
        this.callbacks.onDisconnected?.();
      });

      this.socket.on('connect_error', (error) => {
        console.error(`[McpSocketListener] Connection error:`, error.message);
        this.callbacks.onError?.(error.message);
      });

      // Listen for mcp:connected events
      this.socket.on('mcp:connected', (data: McpConnectedEvent) => {
        console.log(`[McpSocketListener] Received mcp:connected event:`, data);
        
        if (!this.hasReceivedEvent) {
          this.hasReceivedEvent = true;
          this.callbacks.onMcpEvent?.(data);
          
          // Disconnect after receiving the first event (we only need one confirmation)
          stopMcpSocketListener(this.projectId);
        }
      });

    } catch (error) {
      console.error('[McpSocketListener] Failed to create socket:', error);
      this.callbacks.onError?.(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Stop listening and disconnect
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Check if an MCP event has been received
   */
  hasReceived(): boolean {
    return this.hasReceivedEvent;
  }
}

// Store active listeners by project ID
const activeListeners: Map<string, McpSocketListener> = new Map();

/**
 * Start listening for MCP connected events for a project
 */
export function startMcpSocketListener(
  projectId: string,
  apiKey: string,
  apiBaseUrl: string,
  callbacks: McpSocketCallbacks
): McpSocketListener {
  // Stop any existing listener for this project
  stopMcpSocketListener(projectId);

  const listener = new McpSocketListener(projectId, apiKey, apiBaseUrl, callbacks);
  activeListeners.set(projectId, listener);
  listener.connect();

  return listener;
}

/**
 * Stop listening for a specific project
 */
export function stopMcpSocketListener(projectId: string): void {
  const listener = activeListeners.get(projectId);
  if (listener) {
    listener.disconnect();
    activeListeners.delete(projectId);
  }
}

/**
 * Stop all active listeners
 */
export function stopAllMcpSocketListeners(): void {
  for (const listener of activeListeners.values()) {
    listener.disconnect();
  }
  activeListeners.clear();
}
