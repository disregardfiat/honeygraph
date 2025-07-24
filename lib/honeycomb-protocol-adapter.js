/**
 * Protocol adapter to handle Honeycomb's lightweight WebSocket messages
 * Translates between Honeycomb format and Honeygraph internal format
 */

import { EventEmitter } from 'events';

export class HoneycombProtocolAdapter extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      supportedTokens: ['DLUX', 'SPK', 'LARYNX', 'BROCA'],
      defaultToken: 'DLUX',
      autoDetectNetwork: true,
      ...options
    };
    
    this.connectionState = new Map(); // nodeId -> connection state
  }

  /**
   * Handle incoming WebSocket connection from Honeycomb
   */
  handleConnection(ws, req) {
    // Use existing nodeId if available (for testing), otherwise generate
    const nodeId = ws.nodeId || this.generateNodeId(req);
    
    // Initialize connection state
    const connState = {
      nodeId,
      token: this.options.defaultToken,
      source: 'honeycomb',
      version: 'unknown',
      authenticated: true, // Honeycomb doesn't use auth by default
      lastIndex: 0,
      isIdentified: false
    };
    
    this.connectionState.set(nodeId, connState);
    
    ws.nodeId = nodeId;
    if (ws.send && typeof ws.send === 'function') {
      ws.send(JSON.stringify({
        type: 'connected',
        nodeId: nodeId,
        timestamp: Date.now()
      }));
    }
    
    return connState;
  }

  /**
   * Translate Honeycomb message to Honeygraph internal format
   */
  translateMessage(ws, rawMessage) {
    const connState = this.connectionState.get(ws.nodeId);
    if (!connState) {
      throw new Error(`No connection state for node ${ws.nodeId}`);
    }

    // Handle identification
    if (rawMessage.type === 'identify') {
      return this.handleIdentify(ws, rawMessage, connState);
    }

    // Handle sync status
    if (rawMessage.type === 'sync_status') {
      return this.handleSyncStatus(ws, rawMessage, connState);
    }

    // Handle checkpoint from Honeycomb
    if (rawMessage.type === 'checkpoint') {
      return this.handleCheckpoint(ws, rawMessage, connState);
    }

    // Handle batch operations
    if (rawMessage.type === 'batch') {
      return this.handleBatch(ws, rawMessage, connState);
    }

    // Handle single operation (the main case)
    if (this.isOperation(rawMessage)) {
      return this.handleOperation(ws, rawMessage, connState);
    }

    // Unknown message type - pass through with warning
    console.warn(`Unknown Honeycomb message type: ${rawMessage.type || 'undefined'}`);
    return null;
  }

  /**
   * Handle identify message from Honeycomb
   */
  handleIdentify(ws, msg, connState) {
    connState.source = msg.source || 'honeycomb';
    connState.version = msg.version || '1.0.0';
    connState.token = msg.token || this.options.defaultToken;
    connState.isIdentified = true;

    // Auto-detect network based on token
    if (this.options.autoDetectNetwork) {
      connState.prefix = this.detectNetworkPrefix(connState.token);
    }

    // Copy identification data to WebSocket for health endpoint
    ws.source = connState.source;
    ws.version = connState.version;
    ws.token = connState.token;
    ws.prefix = connState.prefix;

    // Emit network identification for schema setup
    this.emit('network:identified', {
      nodeId: ws.nodeId,
      prefix: connState.prefix,
      tokens: this.getTokensForNetwork(connState.token),
      source: connState.source,
      version: connState.version
    });

    // Send acknowledgment
    ws.send(JSON.stringify({
      type: 'ack',
      message: 'Identification received',
      token: connState.token
    }));

    return {
      type: 'identify',
      nodeId: ws.nodeId,
      source: connState.source,
      version: connState.version,
      token: connState.token,
      prefix: connState.prefix
    };
  }

  /**
   * Handle sync status from Honeycomb
   */
  handleSyncStatus(ws, msg, connState) {
    connState.lastIndex = msg.lastIndex || 0;

    // Emit sync status event
    this.emit('sync:status', {
      nodeId: ws.nodeId,
      lastIndex: connState.lastIndex,
      token: connState.token
    });

    // Respond with server status
    ws.send(JSON.stringify({
      type: 'sync_status',
      lastIndex: connState.lastIndex,
      status: 'synced'
    }));

    return null; // No further processing needed
  }

  /**
   * Handle checkpoint from Honeycomb
   */
  handleCheckpoint(ws, msg, connState) {
    const translated = {
      type: 'sendCheckpoint',
      blockNum: msg.blockNum,
      hash: msg.hash,
      prevHash: msg.prevHash || null,
      timestamp: msg.timestamp || Date.now(),
      nodeId: ws.nodeId,
      token: connState.token
    };

    this.emit('checkpoint', translated);
    return translated;
  }

  /**
   * Handle batch operations from Honeycomb
   */
  handleBatch(ws, msg, connState) {
    const operations = msg.operations || [];
    const translatedOps = [];

    for (const op of operations) {
      const translated = this.translateSingleOperation(op, connState);
      if (translated) {
        translatedOps.push(translated);
      }
    }

    // Emit batch event
    this.emit('batch', {
      nodeId: ws.nodeId,
      operations: translatedOps,
      token: connState.token
    });

    return {
      type: 'batch',
      operations: translatedOps,
      nodeId: ws.nodeId
    };
  }

  /**
   * Handle single operation from Honeycomb
   */
  handleOperation(ws, msg, connState) {
    const translated = this.translateSingleOperation(msg, connState);
    
    if (translated) {
      this.emit('operation', {
        operation: translated,
        nodeId: ws.nodeId
      });
    }

    return translated;
  }

  /**
   * Translate single operation to internal format
   */
  translateSingleOperation(op, connState) {
    // Handle write markers (sent as 'W' or with type 'write_marker')
    if (op === 'W' || op.type === 'write_marker') {
      return {
        type: 'write_marker',
        index: op.index || 0,
        blockNum: op.blockNum || 0,
        forkHash: op.forkHash || null,
        prevCheckpointHash: op.prevCheckpointHash || null,
        timestamp: op.timestamp || Date.now(),
        nodeId: connState.nodeId,
        token: connState.token
      };
    }

    // Regular operations - Honeycomb sends them as raw data
    // Convert Honeycomb fields to Honeygraph format
    const translated = {
      // Operation type handling
      type: op.type || 'put', // Default to put if not specified
      
      // Honeycomb tracking fields (keep as-is)
      index: op.index || 0,
      blockNum: op.blockNum || 0,
      forkHash: op.forkHash || null,
      prevCheckpointHash: op.prevCheckpointHash || null,
      
      // Operation data
      path: op.path || null,
      data: op.data || null,
      
      // Metadata
      timestamp: op.timestamp || Date.now(),
      nodeId: connState.nodeId,
      token: connState.token
    };

    return translated;
  }

  /**
   * Check if message is an operation
   */
  isOperation(msg) {
    // Write marker
    if (msg === 'W' || msg.type === 'write_marker') {
      return true;
    }

    // Regular operation - has index, blockNum, and either path or type
    return (
      (typeof msg.index === 'number' || typeof msg.blockNum === 'number') &&
      (msg.path || msg.type) &&
      !['identify', 'sync_status', 'checkpoint', 'batch'].includes(msg.type)
    );
  }

  /**
   * Detect network prefix from token
   */
  detectNetworkPrefix(token) {
    switch (token.toUpperCase()) {
      case 'SPK':
      case 'LARYNX':
      case 'BROCA':
        return 'spkcc_';
      case 'DLUX':
      default:
        return 'dlux_';
    }
  }

  /**
   * Get tokens for network
   */
  getTokensForNetwork(token) {
    switch (token.toUpperCase()) {
      case 'SPK':
      case 'LARYNX':
      case 'BROCA':
        return ['SPK', 'LARYNX', 'BROCA'];
      case 'DLUX':
      default:
        return ['DLUX'];
    }
  }

  /**
   * Generate node ID from request
   */
  generateNodeId(req) {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const timestamp = Date.now();
    return `honeycomb-${ip}-${timestamp}`;
  }

  /**
   * Handle node disconnect
   */
  handleDisconnect(ws) {
    const connState = this.connectionState.get(ws.nodeId);
    if (connState) {
      this.emit('disconnect', {
        nodeId: ws.nodeId,
        token: connState.token,
        lastIndex: connState.lastIndex
      });
      
      this.connectionState.delete(ws.nodeId);
    }
  }

  /**
   * Send response to Honeycomb (translate back to their format)
   */
  sendResponse(ws, type, data = {}) {
    const connState = this.connectionState.get(ws.nodeId);
    if (!connState) return;

    let response;

    switch (type) {
      case 'request_missing':
        response = {
          type: 'request_missing',
          from: data.from,
          to: data.to
        };
        break;

      case 'ack':
        response = {
          type: 'ack',
          index: data.index,
          success: data.success !== false
        };
        break;

      case 'error':
        response = {
          type: 'error',
          error: data.error || 'Unknown error'
        };
        break;

      default:
        response = { type, ...data };
    }

    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(response));
    }
  }

  /**
   * Get connection statistics
   */
  getStats() {
    const stats = {
      connections: this.connectionState.size,
      tokens: {},
      identified: 0,
      totalOperations: 0
    };

    for (const [nodeId, state] of this.connectionState) {
      stats.tokens[state.token] = (stats.tokens[state.token] || 0) + 1;
      if (state.isIdentified) stats.identified++;
      stats.totalOperations += state.lastIndex;
    }

    return stats;
  }
}

export default HoneycombProtocolAdapter;