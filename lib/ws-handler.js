/**
 * WebSocket Handler for Honeygraph
 * Receives streaming operations from Honeycomb nodes
 */

const WebSocket = require('ws');
const EventEmitter = require('events');

class HoneygraphWSHandler extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      heartbeatInterval: config.heartbeatInterval || 30000,
      clientTimeout: config.clientTimeout || 60000,
      maxBatchSize: config.maxBatchSize || 1000,
      ...config
    };
    
    this.clients = new Map(); // Map of token -> Set of clients
    this.indexTracking = new Map(); // Map of token -> last received index
    this.pendingOperations = new Map(); // Map of token -> operations buffer
    this.operationHandlers = new Map(); // Map of token -> handler function
  }

  /**
   * Initialize WebSocket server on existing HTTP server
   * @param {http.Server} server - HTTP server instance
   * @param {String} path - WebSocket path (default: /ws)
   */
  initialize(server, path = '/ws') {
    this.wss = new WebSocket.Server({
      server,
      path: path + '/:token',
      verifyClient: (info, callback) => {
        // Extract token from URL
        const match = info.req.url.match(/\/ws\/(\w+)/);
        if (match) {
          info.req.token = match[1];
          callback(true);
        } else {
          callback(false, 400, 'Invalid token path');
        }
      }
    });

    this.wss.on('connection', (ws, req) => {
      const token = req.token;
      const clientId = this.generateClientId();
      
      console.log(`[HoneygraphWS] New client connected for token: ${token}, ID: ${clientId}`);
      
      // Initialize client tracking
      if (!this.clients.has(token)) {
        this.clients.set(token, new Map());
      }
      
      const tokenClients = this.clients.get(token);
      tokenClients.set(clientId, {
        ws,
        id: clientId,
        token,
        lastActivity: Date.now(),
        lastReceivedIndex: 0
      });
      
      // Setup client handlers
      this.setupClientHandlers(ws, clientId, token);
      
      // Emit connection event
      this.emit('client_connected', { clientId, token });
    });

    // Start heartbeat checker
    this.startHeartbeatChecker();
    
    console.log('[HoneygraphWS] WebSocket handler initialized');
  }

  /**
   * Register operation handler for a token
   * @param {String} token - Token symbol
   * @param {Function} handler - Handler function(operation)
   */
  registerOperationHandler(token, handler) {
    this.operationHandlers.set(token, handler);
  }

  /**
   * Setup handlers for a connected client
   * @private
   */
  setupClientHandlers(ws, clientId, token) {
    const client = this.clients.get(token)?.get(clientId);
    if (!client) return;

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        client.lastActivity = Date.now();
        
        await this.handleClientMessage(client, message);
      } catch (error) {
        console.error(`[HoneygraphWS] Error handling message from ${clientId}:`, error);
        this.sendError(ws, error.message);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[HoneygraphWS] Client disconnected - ID: ${clientId}, Code: ${code}`);
      
      const tokenClients = this.clients.get(token);
      if (tokenClients) {
        tokenClients.delete(clientId);
        if (tokenClients.size === 0) {
          this.clients.delete(token);
        }
      }
      
      this.emit('client_disconnected', { clientId, token, code, reason });
    });

    ws.on('error', (error) => {
      console.error(`[HoneygraphWS] Client error - ID: ${clientId}:`, error);
    });

    ws.on('pong', () => {
      client.lastActivity = Date.now();
    });
  }

  /**
   * Handle incoming client message
   * @private
   */
  async handleClientMessage(client, message) {
    const { ws, token } = client;
    
    switch (message.type) {
      case 'sync_status':
        await this.handleSyncStatus(client, message);
        break;
        
      case 'op':
        await this.handleOperation(client, message);
        break;
        
      case 'batch':
        await this.handleBatch(client, message);
        break;
        
      case 'checkpoint':
        await this.handleCheckpoint(client, message);
        break;
        
      default:
        console.warn(`[HoneygraphWS] Unknown message type: ${message.type}`);
    }
  }

  /**
   * Handle sync status message
   * @private
   */
  async handleSyncStatus(client, message) {
    const { token } = client;
    const lastIndex = this.indexTracking.get(token) || 0;
    
    console.log(`[HoneygraphWS] Sync status - Token: ${token}, Client last: ${message.lastIndex}, Server last: ${lastIndex}`);
    
    // Send current sync status
    this.sendMessage(client.ws, {
      type: 'sync_status',
      lastIndex: lastIndex
    });
    
    // Check if client is behind
    if (message.lastIndex < lastIndex) {
      const missingFrom = message.lastIndex + 1;
      const missingTo = Math.min(lastIndex, message.lastIndex + this.config.maxBatchSize);
      
      console.log(`[HoneygraphWS] Requesting missing operations ${missingFrom}-${missingTo} for ${token}`);
      
      this.sendMessage(client.ws, {
        type: 'request_missing',
        from: missingFrom,
        to: missingTo
      });
    }
    
    client.lastReceivedIndex = message.lastIndex;
  }

  /**
   * Handle single operation
   * @private
   */
  async handleOperation(client, message) {
    const { token } = client;
    const handler = this.operationHandlers.get(token);
    
    if (!handler) {
      console.warn(`[HoneygraphWS] No handler registered for token: ${token}`);
      this.sendError(client.ws, `No handler for token: ${token}`);
      return;
    }
    
    try {
      // Process operation
      const operation = {
        index: message.index,
        blockNum: message.blockNum,
        checkpointHash: message.checkpointHash,
        type: message.opType,
        path: message.path,
        data: message.data,
        timestamp: message.timestamp
      };
      
      await handler(operation);
      
      // Update tracking
      const currentIndex = this.indexTracking.get(token) || 0;
      if (message.index > currentIndex) {
        this.indexTracking.set(token, message.index);
      }
      
      client.lastReceivedIndex = message.index;
      
      // Send acknowledgment
      this.sendMessage(client.ws, {
        type: 'ack',
        index: message.index,
        success: true
      });
      
      // Emit event
      this.emit('operation_processed', { token, operation });
      
    } catch (error) {
      console.error(`[HoneygraphWS] Error processing operation:`, error);
      this.sendMessage(client.ws, {
        type: 'ack',
        index: message.index,
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Handle batch of operations
   * @private
   */
  async handleBatch(client, message) {
    const { token } = client;
    const handler = this.operationHandlers.get(token);
    
    if (!handler) {
      console.warn(`[HoneygraphWS] No handler registered for token: ${token}`);
      this.sendError(client.ws, `No handler for token: ${token}`);
      return;
    }
    
    console.log(`[HoneygraphWS] Processing batch of ${message.operations.length} operations for ${token}`);
    
    let successCount = 0;
    let lastIndex = 0;
    
    try {
      // Process operations in order
      for (const op of message.operations) {
        const operation = {
          index: op.index,
          blockNum: op.blockNum,
          checkpointHash: op.checkpointHash,
          type: op.opType,
          path: op.path,
          data: op.data,
          timestamp: op.timestamp
        };
        
        await handler(operation);
        successCount++;
        lastIndex = Math.max(lastIndex, op.index);
      }
      
      // Update tracking
      const currentIndex = this.indexTracking.get(token) || 0;
      if (lastIndex > currentIndex) {
        this.indexTracking.set(token, lastIndex);
      }
      
      client.lastReceivedIndex = lastIndex;
      
      // Send acknowledgment
      this.sendMessage(client.ws, {
        type: 'ack',
        success: true,
        processed: successCount
      });
      
      // Emit event
      this.emit('batch_processed', { token, count: successCount });
      
    } catch (error) {
      console.error(`[HoneygraphWS] Error processing batch:`, error);
      this.sendMessage(client.ws, {
        type: 'ack',
        success: false,
        processed: successCount,
        error: error.message
      });
    }
  }

  /**
   * Handle checkpoint message
   * @private
   */
  async handleCheckpoint(client, message) {
    const { token } = client;
    
    console.log(`[HoneygraphWS] Checkpoint received - Token: ${token}, Block: ${message.blockNum}, Hash: ${message.hash}`);
    
    // Emit checkpoint event
    this.emit('checkpoint', {
      token,
      blockNum: message.blockNum,
      hash: message.hash,
      timestamp: message.timestamp
    });
    
    // Acknowledge receipt
    this.sendMessage(client.ws, {
      type: 'ack',
      success: true
    });
  }

  /**
   * Send message to client
   * @private
   */
  sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send error to client
   * @private
   */
  sendError(ws, error) {
    this.sendMessage(ws, {
      type: 'error',
      error: error
    });
  }

  /**
   * Broadcast message to all clients of a token
   */
  broadcast(token, message) {
    const tokenClients = this.clients.get(token);
    if (!tokenClients) return;
    
    for (const [clientId, client] of tokenClients) {
      this.sendMessage(client.ws, message);
    }
  }

  /**
   * Start heartbeat checker
   * @private
   */
  startHeartbeatChecker() {
    setInterval(() => {
      const now = Date.now();
      
      for (const [token, tokenClients] of this.clients) {
        for (const [clientId, client] of tokenClients) {
          // Check if client is alive
          if (now - client.lastActivity > this.config.clientTimeout) {
            console.log(`[HoneygraphWS] Client timeout - ID: ${clientId}`);
            client.ws.terminate();
            tokenClients.delete(clientId);
          } else {
            // Send ping
            if (client.ws.readyState === WebSocket.OPEN) {
              client.ws.ping();
            }
          }
        }
        
        // Clean up empty token maps
        if (tokenClients.size === 0) {
          this.clients.delete(token);
        }
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Generate unique client ID
   * @private
   */
  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get client statistics
   */
  getStats() {
    const stats = {
      tokens: {},
      totalClients: 0
    };
    
    for (const [token, tokenClients] of this.clients) {
      stats.tokens[token] = {
        clients: tokenClients.size,
        lastIndex: this.indexTracking.get(token) || 0
      };
      stats.totalClients += tokenClients.size;
    }
    
    return stats;
  }

  /**
   * Get last index for token
   */
  getLastIndex(token) {
    return this.indexTracking.get(token) || 0;
  }

  /**
   * Close all connections
   */
  close() {
    if (this.wss) {
      this.wss.close();
    }
    
    for (const [token, tokenClients] of this.clients) {
      for (const [clientId, client] of tokenClients) {
        client.ws.close(1000, 'Server shutdown');
      }
    }
    
    this.clients.clear();
    this.indexTracking.clear();
    this.pendingOperations.clear();
  }
}

module.exports = HoneygraphWSHandler;