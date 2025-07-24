import Bull from 'bull';
import Redis from 'ioredis';

import { createDataTransformer } from './data-transformer.js';

export class ReplicationQueue {
  constructor({ dgraphClient, forkManager, zfsCheckpoints, logger, networkManager }) {
    this.dgraph = dgraphClient; // Default client for backward compatibility
    this.forkManager = forkManager;
    this.zfsCheckpoints = zfsCheckpoints;
    this.logger = logger;
    this.networkManager = networkManager;
    this.dataTransformer = createDataTransformer(dgraphClient, networkManager);
    
    // Track processed operations to prevent duplicates
    this.processedOperations = new Set();
    this.operationCleanupInterval = null;
    
    // Initialize Redis connection
    const redisOptions = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      maxRetriesPerRequest: null
    };
    
    // Create Bull queue for processing replication jobs
    this.queue = new Bull('replication', {
      redis: redisOptions,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 1000,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      }
    });

    this.setupProcessors();
    this.setupEventHandlers();
    this.startOperationCleanup();
  }

  setupProcessors() {
    // Process block replication jobs
    this.queue.process('replicate-block', async (job) => {
      const { blockData, operations } = job.data;
      
      try {
        // Check for fork
        const forkId = await this.forkManager.detectFork(
          blockData.blockNum,
          blockData.blockHash,
          blockData.expectedHash
        ) || this.forkManager.getCanonicalFork();

        // Add fork information to block data
        blockData.forkId = forkId;

        // Transform operations to rich schema
        const transformedOps = await this.dataTransformer.transformOperations(
          operations, 
          blockData
        );

        // Write batch to Dgraph
        const result = await this.dgraph.writeBatch(transformedOps, blockData);
        
        // Update fork last block
        await this.forkManager.updateForkStatus(
          forkId, 
          'ACTIVE', 
          blockData.blockNum
        );

        // Create checkpoint if at LIB
        if (blockData.isLib) {
          await this.createCheckpoint(blockData);
        }

        this.logger.info('Block replicated', { 
          blockNum: blockData.blockNum,
          operationCount: operations.length,
          forkId 
        });

        return result;
      } catch (error) {
        this.logger.error('Block replication failed', { 
          error: error.message,
          blockNum: blockData.blockNum 
        });
        throw error;
      }
    });

    // Process consensus updates
    this.queue.process('update-consensus', async (job) => {
      const { consensusData } = job.data;
      
      try {
        const result = await this.forkManager.reconcileForks(consensusData);
        
        this.logger.info('Consensus updated', {
          blockNum: consensusData.blockNum,
          canonical: result.canonical,
          orphaned: result.orphaned.length
        });

        return result;
      } catch (error) {
        this.logger.error('Consensus update failed', { 
          error: error.message,
          blockNum: consensusData.blockNum 
        });
        throw error;
      }
    });

    // Process checkpoint creation
    this.queue.process('create-checkpoint', async (job) => {
      const { checkpointData } = job.data;
      
      try {
        await this.createCheckpoint(checkpointData);
        
        // Prune old forks
        const pruned = await this.forkManager.pruneForks(
          checkpointData.blockNum - 1000 // Keep 1000 blocks of history
        );

        this.logger.info('Checkpoint created', {
          blockNum: checkpointData.blockNum,
          prunedForks: pruned
        });

        return { success: true, pruned };
      } catch (error) {
        this.logger.error('Checkpoint creation failed', { 
          error: error.message,
          blockNum: checkpointData.blockNum 
        });
        throw error;
      }
    });
    
    // Process individual operations from honeycomb
    this.queue.process('process-operation', async (job) => {
      const { operation, checkpointHash } = job.data;
      
      try {
        // Create operation ID for deduplication
        const operationId = `${operation.blockNum}:${operation.index}:${operation.type}:${JSON.stringify(operation.path)}`;
        
        // Check if operation was already processed
        if (this.processedOperations.has(operationId)) {
          this.logger.debug('Skipping duplicate operation', {
            type: operation.type,
            index: operation.index,
            blockNum: operation.blockNum
          });
          return { success: true, duplicate: true };
        }
        
        // Get token-specific client if available
        let dgraphClient = this.dgraph;
        if (operation.token && this.multiTokenManager) {
          try {
            dgraphClient = this.multiTokenManager.getDgraphClient(operation.token);
          } catch (err) {
            // Token not registered yet, use default client
            this.logger.warn(`Token ${operation.token} not registered, using default client`);
          }
        }
        
        // Create token-specific transformer
        const transformer = createDataTransformer(dgraphClient);
        
        // Transform the raw operation to Dgraph format
        const transformedOp = await transformer.transformOperation(operation);
        
        // Write to Dgraph
        await dgraphClient.writeOperation(transformedOp);
        
        // Mark operation as processed
        this.processedOperations.add(operationId);
        
        this.logger.debug('Operation processed', {
          type: operation.type,
          index: operation.index,
          blockNum: operation.blockNum,
          token: operation.token
        });
        
        return { success: true };
      } catch (error) {
        this.logger.error('Operation processing failed', {
          error: error.message,
          operation: operation
        });
        throw error;
      }
    });
    
    // Process checkpoint notifications from honeycomb
    this.queue.process('process-checkpoint', async (job) => {
      const { blockNum, hash, prevHash, timestamp, nodeId } = job.data;
      
      try {
        // Create checkpoint data
        const checkpointData = {
          blockNum,
          blockHash: hash,
          prevBlockHash: prevHash,
          timestamp,
          nodeId,
          forkId: hash // Using hash as fork ID
        };
        
        // Update fork tracking
        const forkId = await this.forkManager.detectFork(
          blockNum,
          hash,
          prevHash
        ) || hash;
        
        // Create the checkpoint
        await this.createCheckpoint({
          ...checkpointData,
          forkId,
          isLib: true // Checkpoints are always LIB
        });
        
        this.logger.info('Checkpoint processed from honeycomb', {
          blockNum,
          hash,
          prevHash,
          nodeId
        });
        
        return { success: true, forkId };
      } catch (error) {
        this.logger.error('Checkpoint processing failed', {
          error: error.message,
          blockNum,
          hash
        });
        throw error;
      }
    });
  }

  setupEventHandlers() {
    this.queue.on('completed', (job, result) => {
      this.logger.debug('Job completed', { 
        id: job.id, 
        type: job.name,
        data: job.data 
      });
    });

    this.queue.on('failed', (job, err) => {
      this.logger.error('Job failed', { 
        id: job.id, 
        type: job.name,
        error: err.message,
        attempts: job.attemptsMade 
      });
    });

    this.queue.on('stalled', (job) => {
      this.logger.warn('Job stalled', { 
        id: job.id, 
        type: job.name 
      });
    });
  }

  // Add block replication job
  async addBlockReplication(blockData, operations, priority = 0) {
    const job = await this.queue.add('replicate-block', {
      blockData,
      operations
    }, {
      priority,
      delay: 0
    });

    return job.id;
  }

  // Add consensus update job
  async addConsensusUpdate(consensusData) {
    const job = await this.queue.add('update-consensus', {
      consensusData
    }, {
      priority: 10 // Higher priority for consensus updates
    });

    return job.id;
  }

  // Add checkpoint creation job
  async addCheckpointCreation(checkpointData) {
    const job = await this.queue.add('create-checkpoint', {
      checkpointData
    }, {
      priority: 5
    });

    return job.id;
  }

  // Create checkpoint
  async createCheckpoint(blockData) {
    const checkpointData = {
      blockNum: blockData.blockNum,
      blockHash: blockData.blockHash,
      forkId: blockData.forkId,
      stateHash: await this.calculateStateHash(blockData.blockNum)
    };

    // Create Dgraph checkpoint
    await this.dgraph.createCheckpoint(checkpointData);
    
    // Create ZFS snapshot if enabled
    if (this.zfsCheckpoints) {
      try {
        await this.zfsCheckpoints.createCheckpoint(
          blockData.blockNum,
          blockData.forkId // Using fork ID (IPFS hash) as identifier
        );
        this.logger.info('ZFS checkpoint created', {
          blockNum: blockData.blockNum,
          forkId: blockData.forkId
        });
      } catch (error) {
        this.logger.error('Failed to create ZFS checkpoint', {
          error: error.message,
          blockNum: blockData.blockNum
        });
      }
    }
  }

  // Calculate state hash at a given block
  async calculateStateHash(blockNum) {
    // This would calculate a merkle root of the state at blockNum
    // For now, return a placeholder
    return `state_hash_${blockNum}`;
  }

  // Get queue metrics
  async getMetrics() {
    const [
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused
    ] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
      this.queue.getPausedCount()
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused
    };
  }

  // Clean up old jobs
  async cleanup(grace = 3600000) { // 1 hour default
    await this.queue.clean(grace, 'completed');
    await this.queue.clean(grace, 'failed');
  }

  // Add operation from honeycomb WebSocket
  async addOperation(operation) {
    // Group operations by checkpoint hash for batching
    const checkpointHash = operation.prevCheckpointHash || operation.forkHash || 'pending';
    
    // Check if this is a write marker
    if (operation.type === 'write_marker') {
      // Write markers indicate end of a batch
      this.logger.debug('Write marker received', {
        index: operation.index,
        blockNum: operation.blockNum,
        checkpointHash
      });
      // Could trigger batch processing here if needed
      return;
    }
    
    // For now, we'll process operations individually
    // In production, you'd want to batch these
    const job = await this.queue.add('process-operation', {
      operation,
      checkpointHash
    }, {
      priority: 0,
      delay: 0
    });
    
    return job.id;
  }
  
  // Process checkpoint notification from honeycomb
  async processCheckpoint(checkpointData) {
    const { blockNum, hash, prevHash, timestamp, nodeId } = checkpointData;
    
    this.logger.info('Processing checkpoint notification', {
      blockNum,
      hash,
      prevHash,
      nodeId
    });
    
    // Add checkpoint processing job
    const job = await this.queue.add('process-checkpoint', {
      blockNum,
      hash,
      prevHash,
      timestamp,
      nodeId
    }, {
      priority: 5, // Higher priority than regular operations
      delay: 0
    });
    
    return job.id;
  }

  // Start periodic cleanup of processed operations cache
  startOperationCleanup(interval = 600000) { // 10 minutes
    this.operationCleanupInterval = setInterval(() => {
      const sizeBefore = this.processedOperations.size;
      // Keep operations from last 2 hours only
      const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
      const newSet = new Set();
      
      for (const opId of this.processedOperations) {
        // Extract blockNum from operation ID
        const blockNum = parseInt(opId.split(':')[0]);
        // Estimate: ~3 seconds per block, so 2 hours = ~2400 blocks
        const currentBlock = blockNum + 2400;
        if (blockNum > currentBlock - 2400) {
          newSet.add(opId);
        }
      }
      
      this.processedOperations = newSet;
      const sizeAfter = this.processedOperations.size;
      
      if (sizeBefore !== sizeAfter) {
        this.logger.info('Cleaned up processed operations cache', {
          before: sizeBefore,
          after: sizeAfter,
          removed: sizeBefore - sizeAfter
        });
      }
    }, interval);
  }

  // Close queue connections
  async close() {
    if (this.operationCleanupInterval) {
      clearInterval(this.operationCleanupInterval);
    }
    await this.queue.close();
    this.logger.info('Replication queue closed');
  }
}