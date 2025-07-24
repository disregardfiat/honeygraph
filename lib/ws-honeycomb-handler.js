/**
 * WebSocket Handler specifically for Honeycomb clients
 * Uses protocol adapter and block recovery system
 * Keeps all complexity on Honeygraph side, lightweight for Honeycomb
 */

import { EventEmitter } from 'events';
import { HoneycombProtocolAdapter } from './honeycomb-protocol-adapter.js';
import { BlockDownloadRecovery } from './block-download-recovery.js';
import IPFSCheckpointRecovery from './ipfs-checkpoint-recovery.js';

export class WSHoneycombHandler extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      maxForksPerBlock: config.maxForksPerBlock || 10,
      forkRetentionTime: config.forkRetentionTime || 3600000, // 1 hour
      operationBufferSize: config.operationBufferSize || 10000,
      blockRecoveryEnabled: config.blockRecoveryEnabled !== false,
      honeycombUrls: config.honeycombUrls || [
        'https://spktest.dlux.io',
        'https://duat.dlux.io',
        'https://token.dlux.io'
      ],
      ...config
    };
    
    // Initialize protocol adapter
    this.protocolAdapter = new HoneycombProtocolAdapter({
      supportedTokens: ['DLUX', 'SPK', 'LARYNX', 'BROCA'],
      autoDetectNetwork: true
    });
    
    // Initialize block recovery system
    if (this.config.blockRecoveryEnabled) {
      this.blockRecovery = new BlockDownloadRecovery({
        honeycombUrls: this.config.honeycombUrls,
        zfsCheckpoints: config.zfsCheckpoints,
        dgraphClient: config.dgraphClient,
        dataTransformer: config.dataTransformer,
        logger: config.logger || console
      });
    }
    
    // Initialize IPFS checkpoint recovery
    this.ipfsRecovery = new IPFSCheckpointRecovery({
      ipfsGateway: config.ipfsGateway,
      dataTransformer: config.dataTransformer,
      networkManager: config.networkManager
    });
    
    // Fork tracking (inherited from original handler)
    this.forks = new Map(); // forkHash -> ForkData
    this.activeForks = new Map(); // nodeId -> forkHash
    this.checkpoints = new Map(); // blockNum -> confirmedHash
    
    // Setup protocol adapter events
    this.setupProtocolAdapterEvents();
    
    // Setup block recovery events
    if (this.blockRecovery) {
      this.setupBlockRecoveryEvents();
    }
  }

  /**
   * Handle incoming WebSocket connection from Honeycomb
   */
  handleConnection(ws, req) {
    console.log(`New Honeycomb connection from: ${req.connection.remoteAddress}`);
    
    // Initialize connection through protocol adapter
    const connState = this.protocolAdapter.handleConnection(ws, req);
    
    // Set up WebSocket event handlers
    this.setupWebSocketEvents(ws);
    
    // Send welcome message in Honeycomb format
    ws.send(JSON.stringify({
      type: 'connected',
      nodeId: connState.nodeId,
      timestamp: Date.now(),
      server: 'honeygraph'
    }));
    
    return connState;
  }

  /**
   * Handle incoming message from Honeycomb
   */
  handleMessage(ws, rawData) {
    // Track last message time
    ws.lastMessage = Date.now();
    
    try {
      // Parse message
      let message;
      try {
        message = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      } catch (e) {
        this.protocolAdapter.sendResponse(ws, 'error', {
          error: 'Invalid JSON format'
        });
        return;
      }

      // Translate through protocol adapter
      const translatedMessage = this.protocolAdapter.translateMessage(ws, message);
      
      if (!translatedMessage) {
        return; // Message was handled by adapter (like sync_status)
      }

      // Process translated message
      this.processTranslatedMessage(ws, translatedMessage);

    } catch (error) {
      console.error('Error handling Honeycomb message:', error);
      this.protocolAdapter.sendResponse(ws, 'error', {
        error: error.message
      });
    }
  }

  /**
   * Process translated message from protocol adapter
   */
  processTranslatedMessage(ws, msg) {
    switch (msg.type) {
      case 'identify':
        // Already handled by protocol adapter
        break;

      case 'sendCheckpoint':
        this.handleCheckpoint(ws, msg);
        break;

      case 'write_marker':
        this.handleWriteMarker(ws, msg);
        break;

      case 'batch':
        this.handleBatch(ws, msg);
        break;

      default:
        // Regular operation
        this.handleOperation(ws, msg);
        break;
    }
  }

  /**
   * Handle operation from Honeycomb
   */
  handleOperation(ws, msg) {
    const forkHash = msg.forkHash || 'pending';
    
    // Ensure fork exists
    if (!this.forks.has(forkHash)) {
      this.createFork(forkHash, msg.blockNum, ws.nodeId);
    }
    
    const fork = this.forks.get(forkHash);
    fork.nodes.add(ws.nodeId);
    
    // Add operation to fork
    fork.operations.push(msg);
    fork.operationCount++;
    fork.lastUpdate = msg.timestamp;
    
    // Buffer management
    if (fork.operations.length > this.config.operationBufferSize) {
      fork.operations.shift();
    }
    
    // Update active fork for node
    this.activeForks.set(ws.nodeId, forkHash);
    
    // Emit operation event
    this.emit('operation', {
      forkHash,
      operation: msg,
      blockNum: msg.blockNum,
      nodeId: ws.nodeId
    });
    
    // Send acknowledgment in Honeycomb format
    this.protocolAdapter.sendResponse(ws, 'ack', {
      index: msg.index,
      success: true
    });
  }

  /**
   * Handle write marker
   */
  handleWriteMarker(ws, msg) {
    const forkHash = msg.forkHash || 'pending';
    
    // Ensure fork exists
    if (!this.forks.has(forkHash)) {
      this.createFork(forkHash, msg.blockNum, ws.nodeId);
    }
    
    const fork = this.forks.get(forkHash);
    fork.nodes.add(ws.nodeId);
    
    // Store write marker details
    fork.lastWriteMarker = {
      index: msg.index,
      blockNum: msg.blockNum,
      timestamp: msg.timestamp,
      prevCheckpointHash: msg.prevCheckpointHash
    };
    
    // Add to operations
    fork.operations.push(msg);
    fork.operationCount++;
    fork.lastUpdate = msg.timestamp;
    
    // Buffer management
    if (fork.operations.length > this.config.operationBufferSize) {
      fork.operations.shift();
    }
    
    // Update active fork for node
    this.activeForks.set(ws.nodeId, forkHash);
    
    // Emit as operation event (for consistency with tests)
    this.emit('operation', {
      forkHash,
      operation: msg,
      blockNum: msg.blockNum,
      nodeId: ws.nodeId
    });
    
    // Also emit specific write marker event
    this.emit('write_marker', {
      forkHash,
      writeMarker: msg,
      nodeId: ws.nodeId
    });
  }

  /**
   * Handle checkpoint notification from Honeycomb
   */
  handleCheckpoint(ws, msg) {
    const { blockNum, hash, prevHash, timestamp } = msg;
    
    console.log(`[Honeygraph] Checkpoint received from ${ws.nodeId}:`, {
      blockNum,
      hash,
      prevHash,
      timestamp,
      currentActiveFork: this.activeForks.get(ws.nodeId)
    });
    
    // Validate checkpoint boundary
    const activeFork = this.activeForks.get(ws.nodeId);
    if (activeFork) {
      const fork = this.forks.get(activeFork);
      if (fork && !this.validateCheckpointBoundary(fork, blockNum)) {
        console.warn(`Invalid checkpoint boundary for fork ${activeFork}`);
        this.emit('checkpoint:invalid', {
          reason: 'invalid_boundary',
          forkHash: activeFork,
          blockNum,
          nodeId: ws.nodeId
        });
        return;
      }
    }
    
    // Store checkpoint
    this.checkpoints.set(blockNum, hash);
    
    // Detect fork if hash doesn't match existing
    const existingHash = this.checkpoints.get(blockNum - 1);
    if (existingHash && prevHash && existingHash !== prevHash) {
      console.log(`Fork detected at block ${blockNum}: expected ${existingHash}, got ${prevHash}`);
      this.handleForkDetection(blockNum, hash, prevHash, ws.nodeId);
    }
    
    // Get the last operation index from the previous fork
    let lastOperationIndex = 0;
    let totalOperations = 0;
    if (activeFork) {
      const oldFork = this.forks.get(activeFork);
      if (oldFork) {
        totalOperations = oldFork.operationCount || oldFork.operations.length;
        if (oldFork.operations.length > 0) {
          const lastOp = oldFork.operations[oldFork.operations.length - 1];
          lastOperationIndex = lastOp.index || 0;
        }
      }
    }
    
    console.log(`[Honeygraph] Previous fork had ${totalOperations} operations, last index: ${lastOperationIndex}`);
    
    // Create new fork for the next checkpoint period
    // The current checkpoint hash becomes the new fork hash
    if (!this.forks.has(hash)) {
      this.createFork(hash, blockNum, ws.nodeId);
    }
    
    // Update active fork for this node to the new checkpoint
    this.activeForks.set(ws.nodeId, hash);
    
    // Request missing operations if needed
    // If the previous fork exists, we should have operations for it
    if (activeFork && prevHash) {
      // The previous checkpoint should contain all operations for that period
      // Try to recover from IPFS if we don't have them
      const expectedOperations = totalOperations > 0 ? totalOperations : 1000; // Estimate if no operations
      
      if (lastOperationIndex === 0 || totalOperations === 0) {
        console.log(`[Honeygraph] No operations found for previous checkpoint, recovering from IPFS`);
        
        // Use prevHash as the checkpoint to download
        this.recoverCheckpointFromIPFS(prevHash, ws.prefix || 'dlux_').then(operations => {
          console.log(`[Honeygraph] Recovered ${operations.length} operations from IPFS for checkpoint ${prevHash}`);
          
          // Process recovered operations
          operations.forEach(op => {
            op.forkHash = prevHash; // Ensure operations are tagged with correct fork
            this.handleOperation(ws, op);
          });
        }).catch(error => {
          console.error(`[Honeygraph] Failed to recover checkpoint from IPFS:`, error);
          
          // Fall back to requesting from honeycomb
          this.protocolAdapter.sendResponse(ws, 'request_missing', {
            from: 1,
            to: 1000
          });
        });
      }
    }
    
    // Emit checkpoint event
    this.emit('checkpoint', {
      blockNum,
      hash,
      prevHash,
      timestamp,
      nodeId: ws.nodeId
    });
    
    // Clean up old forks
    this.cleanupForksForBlock(blockNum - 100, prevHash); // Clean up forks older than previous checkpoint
  }

  /**
   * Handle batch operations
   */
  handleBatch(ws, msg) {
    // Check if batch is empty (honeycomb doesn't have operations)
    if (!msg.operations || msg.operations.length === 0) {
      console.log(`[Honeygraph] Received empty batch from ${ws.nodeId}, attempting IPFS recovery`);
      
      // If we have a fork hash, try to recover from IPFS
      const activeFork = this.activeForks.get(ws.nodeId);
      if (activeFork && msg.requestedRange) {
        this.recoverCheckpointFromIPFS(activeFork, ws.prefix || 'dlux_')
          .then(operations => {
            // Filter to requested range if specified
            const filtered = operations.filter(op => 
              op.index >= msg.requestedRange.from && 
              op.index <= msg.requestedRange.to
            );
            
            console.log(`[Honeygraph] Recovered ${filtered.length} operations from IPFS`);
            this.processBatchFromIPFS(ws, filtered);
          })
          .catch(error => {
            console.error(`[Honeygraph] IPFS recovery failed:`, error);
            this.emit('operations:missing', {
              nodeId: ws.nodeId,
              range: msg.requestedRange,
              reason: 'ipfs_recovery_failed'
            });
          });
      }
      return;
    }
    
    // Process normal batch
    for (const operation of msg.operations) {
      this.handleOperation(ws, operation);
    }
  }

  /**
   * Handle fork detection and trigger recovery
   */
  async handleForkDetection(blockNum, canonicalHash, forkHash, nodeId) {
    console.log(`Fork detected by ${nodeId} at block ${blockNum}`);
    
    this.emit('fork:detected', {
      blockNum,
      canonicalHash,
      forkHash,
      nodeId
    });
    
    // If block recovery is enabled, attempt automatic recovery
    if (this.blockRecovery) {
      try {
        // Find last good checkpoint
        const checkpointBlock = this.findLastGoodCheckpoint(blockNum);
        
        if (checkpointBlock) {
          console.log(`Attempting block recovery from checkpoint ${checkpointBlock}`);
          
          await this.blockRecovery.recoverFromFork({
            currentBlock: blockNum,
            targetBlock: blockNum,
            checkpointBlock,
            forkHash,
            canonicalHash
          });
          
          this.emit('fork:recovered', {
            blockNum,
            checkpointBlock,
            canonicalHash
          });
        }
      } catch (error) {
        console.error('Automatic fork recovery failed:', error);
        this.emit('fork:recovery_failed', {
          blockNum,
          error: error.message
        });
      }
    }
  }

  /**
   * Find last good checkpoint before the given block
   */
  findLastGoodCheckpoint(blockNum) {
    // Look for checkpoints in descending order
    for (let i = blockNum - 1; i > 0; i--) {
      if (this.checkpoints.has(i)) {
        return i;
      }
    }
    return null;
  }

  /**
   * Create new fork
   */
  createFork(forkHash, blockNum, nodeId) {
    const fork = {
      hash: forkHash,
      blockNum,
      startTime: Date.now(),
      lastUpdate: Date.now(),
      nodes: new Set([nodeId]),
      operations: [],
      operationCount: 0,
      lastWriteMarker: null,
      isConfirmed: false
    };
    
    this.forks.set(forkHash, fork);
    
    this.emit('fork:new', {
      forkHash,
      blockNum,
      nodeId
    });
    
    console.log(`New fork created: ${forkHash} at block ${blockNum}`);
  }

  /**
   * Validate checkpoint boundary (same logic as original)
   */
  validateCheckpointBoundary(fork, checkpointBlock) {
    if (!fork || !fork.operations || fork.operations.length === 0) {
      return false;
    }
    
    // Find the last write marker
    let lastWriteMarkerIndex = -1;
    for (let i = fork.operations.length - 1; i >= 0; i--) {
      if (fork.operations[i].type === 'write_marker') {
        lastWriteMarkerIndex = i;
        break;
      }
    }
    
    if (lastWriteMarkerIndex === -1) {
      return false; // No write marker found
    }
    
    // Check if write marker is the last operation
    if (lastWriteMarkerIndex !== fork.operations.length - 1) {
      return false; // Operations after write marker
    }
    
    // Validate write marker block number
    const writeMarker = fork.operations[lastWriteMarkerIndex];
    if (writeMarker.blockNum !== checkpointBlock - 1) {
      return false; // Wrong block number
    }
    
    return true;
  }

  /**
   * Clean up forks for a confirmed block
   */
  /**
   * Recover checkpoint operations from IPFS
   * @param {string} checkpointHash - IPFS hash of the checkpoint
   * @param {string} prefix - Network prefix
   * @returns {Promise<Array>} Recovered operations
   */
  async recoverCheckpointFromIPFS(checkpointHash, prefix) {
    try {
      console.log(`[Honeygraph] Attempting to recover checkpoint ${checkpointHash} from IPFS`);
      
      // Download checkpoint data
      const checkpointData = await this.ipfsRecovery.downloadCheckpoint(checkpointHash);
      
      // Parse operations
      const operations = this.ipfsRecovery.parseCheckpointOperations(checkpointData);
      
      // Transform operations if transformer is available
      if (this.config.dataTransformer) {
        return await this.ipfsRecovery.transformOperations(operations, prefix, checkpointHash);
      }
      
      return operations;
      
    } catch (error) {
      console.error(`[Honeygraph] Failed to recover checkpoint from IPFS:`, error);
      throw error;
    }
  }

  /**
   * Handle batch of operations from IPFS recovery
   * @param {string} ws - WebSocket connection
   * @param {Array} operations - Recovered operations
   */
  processBatchFromIPFS(ws, operations) {
    console.log(`[Honeygraph] Processing ${operations.length} operations from IPFS recovery`);
    
    // Sort operations by index to ensure correct order
    operations.sort((a, b) => a.index - b.index);
    
    // Process each operation
    operations.forEach(op => {
      this.handleOperation(ws, op);
    });
    
    // Emit batch complete event
    this.emit('ipfs:batch:complete', {
      nodeId: ws.nodeId,
      operationCount: operations.length,
      forkHash: operations[0]?.forkHash
    });
  }

  cleanupForksForBlock(blockNum, confirmedHash) {
    const forksToRemove = [];
    
    for (const [hash, fork] of this.forks) {
      if (fork.blockNum === blockNum && hash !== confirmedHash) {
        forksToRemove.push(hash);
      }
    }
    
    forksToRemove.forEach(hash => {
      console.log(`Removing invalid fork ${hash} for block ${blockNum}`);
      this.forks.delete(hash);
      
      // Remove from active forks
      for (const [nodeId, forkHash] of this.activeForks) {
        if (forkHash === hash) {
          this.activeForks.delete(nodeId);
        }
      }
    });
  }

  /**
   * Handle node disconnect
   */
  handleDisconnect(ws) {
    console.log(`Honeycomb node disconnected: ${ws.nodeId}`);
    
    // Protocol adapter cleanup
    this.protocolAdapter.handleDisconnect(ws);
    
    // Fork cleanup
    const activeFork = this.activeForks.get(ws.nodeId);
    if (activeFork) {
      const fork = this.forks.get(activeFork);
      if (fork) {
        fork.nodes.delete(ws.nodeId);
      }
    }
    
    this.activeForks.delete(ws.nodeId);
    
    this.emit('node:disconnected', {
      nodeId: ws.nodeId
    });
  }

  /**
   * Setup WebSocket event handlers
   */
  setupWebSocketEvents(ws) {
    ws.on('message', (data) => {
      this.handleMessage(ws, data);
    });
    
    ws.on('close', () => {
      this.handleDisconnect(ws);
    });
    
    ws.on('error', (error) => {
      console.error(`WebSocket error for ${ws.nodeId}:`, error);
    });
    
    // Heartbeat
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  }

  /**
   * Setup protocol adapter events
   */
  setupProtocolAdapterEvents() {
    this.protocolAdapter.on('network:identified', (data) => {
      this.emit('network:identified', data);
    });
    
    this.protocolAdapter.on('sync:status', (data) => {
      this.emit('sync:status', data);
    });
    
    this.protocolAdapter.on('operation', (data) => {
      // Already handled in processTranslatedMessage
    });
    
    this.protocolAdapter.on('checkpoint', (data) => {
      // Already handled in processTranslatedMessage
    });
  }

  /**
   * Setup block recovery events
   */
  setupBlockRecoveryEvents() {
    this.blockRecovery.on('recovery:complete', (data) => {
      console.log('Block recovery completed:', data);
      this.emit('recovery:complete', data);
    });
    
    this.blockRecovery.on('recovery:failed', (data) => {
      console.error('Block recovery failed:', data);
      this.emit('recovery:failed', data);
    });
    
    this.blockRecovery.on('block:replayed', (data) => {
      this.emit('block:replayed', data);
    });
  }

  /**
   * Manual recovery trigger
   */
  async triggerRecovery(fromBlock, toBlock, checkpointBlock) {
    if (!this.blockRecovery) {
      throw new Error('Block recovery is not enabled');
    }
    
    return this.blockRecovery.recoverFromFork({
      currentBlock: fromBlock,
      targetBlock: toBlock,
      checkpointBlock,
      forkHash: 'manual',
      canonicalHash: 'manual'
    });
  }

  /**
   * Get handler statistics
   */
  getStats() {
    const protocolStats = this.protocolAdapter.getStats();
    const recoveryStats = this.blockRecovery ? this.blockRecovery.getCacheStats() : null;
    
    return {
      protocol: protocolStats,
      forks: {
        total: this.forks.size,
        active: this.activeForks.size,
        checkpoints: this.checkpoints.size
      },
      recovery: recoveryStats
    };
  }

  /**
   * Cleanup old forks periodically
   */
  cleanupOldForks() {
    const now = Date.now();
    const forksToRemove = [];
    
    for (const [hash, fork] of this.forks) {
      if (now - fork.lastUpdate > this.config.forkRetentionTime) {
        forksToRemove.push(hash);
      }
    }
    
    forksToRemove.forEach(hash => {
      console.log(`Removing old fork ${hash}`);
      this.forks.delete(hash);
    });
  }

  /**
   * Start periodic cleanup
   */
  startCleanup(interval = 300000) { // 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldForks();
    }, interval);
  }

  /**
   * Stop periodic cleanup
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

export default WSHoneycombHandler;