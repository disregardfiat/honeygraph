import { EventEmitter } from 'events';

/**
 * WebSocket Fork Handler for Honeygraph
 * 
 * Manages fork tracking and operation streaming from Honeycomb nodes.
 * Each fork is identified by its pendingHash, which is deterministically
 * calculated before any operations are written.
 */
class WSForkHandler extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.forks = new Map(); // forkHash -> ForkData
    this.activeForks = new Map(); // nodeId -> forkHash
    this.checkpoints = new Map(); // blockNum -> confirmedHash
    
    this.maxForksPerBlock = config.maxForksPerBlock || 10;
    this.forkRetentionTime = config.forkRetentionTime || 3600000; // 1 hour
    this.operationBufferSize = config.operationBufferSize || 10000;
  }
  
  /**
   * Handle incoming WebSocket connection
   */
  handleConnection(ws, req) {
    const nodeId = this.generateNodeId(req);
    
    console.log(`New connection from node: ${nodeId}`);
    
    // Set up connection state
    ws.nodeId = nodeId;
    ws.isAlive = true;
    
    // Heartbeat
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    
    // Handle messages
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        this.handleMessage(ws, msg);
      } catch (err) {
        console.error('Failed to parse message:', err);
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Invalid message format'
        }));
      }
    });
    
    // Handle disconnect
    ws.on('close', () => {
      console.log(`Node disconnected: ${nodeId}`);
      this.handleDisconnect(ws);
    });
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      nodeId: nodeId,
      timestamp: Date.now()
    }));
  }
  
  /**
   * Handle incoming message from a node
   */
  handleMessage(ws, msg) {
    switch (msg.type) {
      case 'identify':
        this.handleIdentify(ws, msg);
        break;
        
      case 'fork_start':
        this.handleForkStart(ws, msg);
        break;
        
      case 'fork_detected':
        this.handleForkDetected(ws, msg);
        break;
        
      case 'put':
      case 'del':
      case 'write_marker':
        this.handleOperation(ws, msg);
        break;
        
      case 'checkpoint':
        this.handleCheckpoint(ws, msg);
        break;
        
      case 'sendCheckpoint':
        // Handle checkpoint notification from honeycomb
        this.handleCheckpointNotification(ws, msg);
        break;
        
      case 'sync_status':
        // Handle sync status request
        this.handleSyncStatus(ws, msg);
        break;
        
      default:
        console.log(`Unknown message type from ${ws.nodeId}: ${msg.type}`);
    }
  }
  
  /**
   * Handle node identification
   */
  handleIdentify(ws, msg) {
    ws.source = msg.source;
    ws.version = msg.version;
    
    console.log(`Node ${ws.nodeId} identified as ${msg.source} v${msg.version}`);
    
    // Send acknowledgment
    ws.send(JSON.stringify({
      type: 'ack',
      message: 'Identification received'
    }));
  }
  
  /**
   * Handle sync status request
   */
  handleSyncStatus(ws, msg) {
    const lastIndex = msg.lastIndex || 0;
    
    // Send sync status response
    ws.send(JSON.stringify({
      type: 'sync_status',
      lastIndex: lastIndex,
      status: 'synced'
    }));
  }
  
  /**
   * Handle fork start notification
   */
  handleForkStart(ws, msg) {
    const { forkHash, blockNum, timestamp } = msg;
    
    // Check if we already know about this fork
    let fork = this.forks.get(forkHash);
    
    if (!fork) {
      // New fork
      fork = {
        hash: forkHash,
        blockNum: blockNum,
        startTime: timestamp,
        lastUpdate: timestamp,
        nodes: new Set([ws.nodeId]),
        operations: [],
        operationCount: 0,
        isConfirmed: false
      };
      
      this.forks.set(forkHash, fork);
      
      // Emit new fork event
      this.emit('fork:new', {
        forkHash,
        blockNum,
        nodeId: ws.nodeId
      });
      
      console.log(`New fork started: ${forkHash} at block ${blockNum}`);
    } else {
      // Existing fork, add node
      fork.nodes.add(ws.nodeId);
      fork.lastUpdate = timestamp;
    }
    
    // Update active fork for this node
    const previousFork = this.activeForks.get(ws.nodeId);
    if (previousFork && previousFork !== forkHash) {
      // Node switched forks
      const oldFork = this.forks.get(previousFork);
      if (oldFork) {
        oldFork.nodes.delete(ws.nodeId);
      }
    }
    
    this.activeForks.set(ws.nodeId, forkHash);
    
    // Check fork limits
    this.checkForkLimits(blockNum);
  }
  
  /**
   * Handle fork detection (when a node switches forks)
   */
  handleForkDetected(ws, msg) {
    const { oldForkHash, newForkHash, blockNum } = msg;
    
    console.log(`Fork detected by ${ws.nodeId}: ${oldForkHash} -> ${newForkHash}`);
    
    // Emit fork switch event
    this.emit('fork:switch', {
      nodeId: ws.nodeId,
      oldForkHash,
      newForkHash,
      blockNum
    });
    
    // Update fork node counts
    const oldFork = this.forks.get(oldForkHash);
    if (oldFork) {
      oldFork.nodes.delete(ws.nodeId);
    }
  }
  
  /**
   * Handle operation from a node
   */
  handleOperation(ws, msg) {
    let activeFork = this.activeForks.get(ws.nodeId);
    
    // If no active fork, create one based on the operation's forkHash
    if (!activeFork && msg.forkHash) {
      const forkHash = msg.forkHash;
      const blockNum = msg.blockNum || 0;
      
      if (!this.forks.has(forkHash)) {
        // Create new fork
        this.forks.set(forkHash, {
          hash: forkHash,
          blockNum: blockNum,
          startTime: Date.now(),
          lastUpdate: Date.now(),
          nodes: new Set([ws.nodeId]),
          operations: [],
          operationCount: 0,
          isConfirmed: false
        });
        
        this.emit('fork:new', {
          forkHash,
          blockNum,
          nodeId: ws.nodeId
        });
      }
      
      this.activeForks.set(ws.nodeId, forkHash);
      activeFork = forkHash;
    }
    
    if (!activeFork) {
      console.error(`No fork hash available for operation from node ${ws.nodeId}`);
      return;
    }
    
    const fork = this.forks.get(activeFork);
    if (!fork) {
      console.error(`Fork ${activeFork} not found`);
      return;
    }
    
    // Store the raw operation data from honeycomb
    const operation = {
      ...msg,  // Keep all original data
      nodeId: ws.nodeId  // Just add the nodeId for tracking
    };
    
    // Buffer management - keep only recent operations
    if (fork.operations.length >= this.operationBufferSize) {
      fork.operations.shift();
    }
    
    fork.operations.push(operation);
    fork.operationCount++;
    fork.lastUpdate = msg.timestamp;
    
    // Emit operation event
    this.emit('operation', {
      forkHash: activeFork,
      operation,
      blockNum: fork.blockNum
    });
  }
  
  /**
   * Handle checkpoint notification
   */
  handleCheckpoint(ws, msg) {
    const { forkHash, confirmedHash, blockNum, matches } = msg;
    
    console.log(`Checkpoint at block ${blockNum}: ${matches ? 'MATCH' : 'MISMATCH'}`);
    
    // Store checkpoint
    this.checkpoints.set(blockNum, confirmedHash);
    
    // Update fork status
    const fork = this.forks.get(forkHash);
    if (fork && matches) {
      fork.isConfirmed = true;
      
      // This is the canonical fork for this block
      this.emit('fork:confirmed', {
        forkHash,
        blockNum
      });
      
      // Clean up other forks for this block
      this.cleanupForksForBlock(blockNum, forkHash);
    } else if (fork && !matches) {
      // Fork mismatch - this fork is invalid
      this.emit('fork:invalid', {
        forkHash,
        blockNum,
        expectedHash: confirmedHash
      });
    }
  }
  
  /**
   * Handle checkpoint notification from honeycomb
   */
  handleCheckpointNotification(ws, msg) {
    const { blockNum, hash, prevHash, timestamp } = msg;
    
    console.log(`Checkpoint notification from ${ws.nodeId}: block ${blockNum}, ${prevHash} -> ${hash}`);
    
    // Emit checkpoint event for processing
    this.emit('checkpoint', {
      blockNum,
      hash,
      prevHash,
      timestamp,
      nodeId: ws.nodeId
    });
    
    // Update fork tracking
    const activeFork = this.activeForks.get(ws.nodeId);
    if (activeFork !== hash) {
      // Node has moved to a new checkpoint
      if (activeFork) {
        const oldFork = this.forks.get(activeFork);
        if (oldFork) {
          oldFork.nodes.delete(ws.nodeId);
        }
      }
      
      // Create or update new fork
      if (!this.forks.has(hash)) {
        this.forks.set(hash, {
          hash: hash,
          blockNum: blockNum,
          prevHash: prevHash,
          startTime: timestamp,
          lastUpdate: timestamp,
          nodes: new Set([ws.nodeId]),
          operations: [],
          operationCount: 0,
          isConfirmed: true  // Checkpoints are confirmed by definition
        });
      } else {
        const fork = this.forks.get(hash);
        fork.nodes.add(ws.nodeId);
        fork.isConfirmed = true;
      }
      
      this.activeForks.set(ws.nodeId, hash);
    }
    
    // Clean up old forks that are now finalized
    this.cleanupForksForBlock(blockNum, hash);
  }
  
  /**
   * Handle node disconnect
   */
  handleDisconnect(ws) {
    const activeFork = this.activeForks.get(ws.nodeId);
    
    if (activeFork) {
      const fork = this.forks.get(activeFork);
      if (fork) {
        fork.nodes.delete(ws.nodeId);
        
        // If no nodes are on this fork anymore, mark for cleanup
        if (fork.nodes.size === 0) {
          console.log(`Fork ${activeFork} has no active nodes`);
        }
      }
    }
    
    this.activeForks.delete(ws.nodeId);
  }
  
  /**
   * Check and enforce fork limits per block
   */
  checkForkLimits(blockNum) {
    const forksForBlock = Array.from(this.forks.values())
      .filter(f => f.blockNum === blockNum);
    
    if (forksForBlock.length > this.maxForksPerBlock) {
      console.warn(`Too many forks for block ${blockNum}: ${forksForBlock.length}`);
      
      // Sort by node count and keep most popular
      forksForBlock.sort((a, b) => b.nodes.size - a.nodes.size);
      
      const toRemove = forksForBlock.slice(this.maxForksPerBlock);
      toRemove.forEach(fork => {
        console.log(`Removing fork ${fork.hash} (low node count)`);
        this.forks.delete(fork.hash);
      });
    }
  }
  
  /**
   * Clean up forks for a confirmed block
   */
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
   * Periodic cleanup of old forks
   */
  cleanupOldForks() {
    const now = Date.now();
    const forksToRemove = [];
    
    for (const [hash, fork] of this.forks) {
      if (now - fork.lastUpdate > this.forkRetentionTime) {
        forksToRemove.push(hash);
      }
    }
    
    forksToRemove.forEach(hash => {
      console.log(`Removing old fork ${hash}`);
      this.forks.delete(hash);
    });
  }
  
  /**
   * Generate node ID from request
   */
  generateNodeId(req) {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const timestamp = Date.now();
    return `${ip}-${timestamp}`;
  }
  
  /**
   * Get current fork statistics
   */
  getStats() {
    const stats = {
      totalForks: this.forks.size,
      activeForks: this.activeForks.size,
      checkpoints: this.checkpoints.size,
      forksByBlock: {}
    };
    
    // Group forks by block
    for (const fork of this.forks.values()) {
      if (!stats.forksByBlock[fork.blockNum]) {
        stats.forksByBlock[fork.blockNum] = {
          count: 0,
          confirmed: null,
          forks: []
        };
      }
      
      stats.forksByBlock[fork.blockNum].count++;
      
      if (fork.isConfirmed) {
        stats.forksByBlock[fork.blockNum].confirmed = fork.hash;
      }
      
      stats.forksByBlock[fork.blockNum].forks.push({
        hash: fork.hash,
        nodes: fork.nodes.size,
        operations: fork.operationCount,
        isConfirmed: fork.isConfirmed
      });
    }
    
    return stats;
  }
  
  /**
   * Get detailed fork information
   */
  getForkDetails(forkHash) {
    const fork = this.forks.get(forkHash);
    if (!fork) return null;
    
    return {
      hash: fork.hash,
      blockNum: fork.blockNum,
      startTime: fork.startTime,
      lastUpdate: fork.lastUpdate,
      nodeCount: fork.nodes.size,
      nodes: Array.from(fork.nodes),
      operationCount: fork.operationCount,
      recentOperations: fork.operations.slice(-100), // Last 100 operations
      isConfirmed: fork.isConfirmed
    };
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

export { WSForkHandler };