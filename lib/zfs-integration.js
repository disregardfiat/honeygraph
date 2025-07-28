/**
 * ZFS Integration for Honeygraph
 * Manages ZFS snapshots for fork management and data recovery
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from './logger.js';
import EventEmitter from 'events';

const execAsync = promisify(exec);
const logger = createLogger('zfs-integration');

export class ZFSManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      dataset: config.dataset || 'honeygraph/data',
      snapshotPrefix: config.snapshotPrefix || 'checkpoint',
      maxSnapshots: config.maxSnapshots || 100,
      autoSnapshot: config.autoSnapshot !== false,
      snapshotInterval: config.snapshotInterval || 3600000, // 1 hour
      ...config
    };
    
    this.snapshots = new Map();
    this.isAvailable = false;
    this.snapshotTimer = null;
  }

  async initialize() {
    // Check if ZFS is available
    this.isAvailable = await this.checkZFSAvailable();
    
    if (!this.isAvailable) {
      logger.warn('ZFS is not available on this system');
      return false;
    }
    
    // Check if dataset exists
    const datasetExists = await this.datasetExists(this.config.dataset);
    
    if (!datasetExists) {
      logger.info(`Creating ZFS dataset: ${this.config.dataset}`);
      await this.createDataset(this.config.dataset);
    }
    
    // Load existing snapshots
    await this.loadSnapshots();
    
    // Start auto-snapshot if enabled
    if (this.config.autoSnapshot) {
      this.startAutoSnapshot();
    }
    
    logger.info('ZFS manager initialized', {
      dataset: this.config.dataset,
      snapshotCount: this.snapshots.size
    });
    
    return true;
  }

  /**
   * Check if ZFS is available on the system
   */
  async checkZFSAvailable() {
    try {
      await execAsync('which zfs');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if a dataset exists
   */
  async datasetExists(dataset) {
    try {
      await execAsync(`zfs list -H -o name ${dataset}`);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create a new dataset
   */
  async createDataset(dataset) {
    try {
      // Create parent datasets if needed
      const parts = dataset.split('/');
      let currentPath = '';
      
      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        
        if (!(await this.datasetExists(currentPath))) {
          await execAsync(`zfs create ${currentPath}`);
          logger.info(`Created dataset: ${currentPath}`);
        }
      }
      
      // Set properties for better performance
      await execAsync(`zfs set compression=lz4 ${dataset}`);
      await execAsync(`zfs set atime=off ${dataset}`);
      await execAsync(`zfs set recordsize=128K ${dataset}`);
      
    } catch (error) {
      logger.error(`Failed to create dataset: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a snapshot for a specific block/checkpoint
   */
  async createSnapshot(blockNum, checkpointHash, metadata = {}) {
    if (!this.isAvailable) {
      logger.warn('ZFS not available, skipping snapshot creation');
      return null;
    }
    
    const snapshotName = `${this.config.dataset}@${this.config.snapshotPrefix}_${blockNum}_${checkpointHash.substring(0, 8)}`;
    
    try {
      // Create the snapshot
      await execAsync(`zfs snapshot ${snapshotName}`);
      
      // Store metadata
      const snapshot = {
        name: snapshotName,
        blockNum,
        checkpointHash,
        createdAt: new Date().toISOString(),
        metadata
      };
      
      this.snapshots.set(blockNum, snapshot);
      
      // Set user properties for metadata
      await execAsync(`zfs set honeygraph:block=${blockNum} ${snapshotName}`);
      await execAsync(`zfs set honeygraph:hash=${checkpointHash} ${snapshotName}`);
      await execAsync(`zfs set honeygraph:created="${snapshot.createdAt}" ${snapshotName}`);
      
      logger.info(`Created snapshot: ${snapshotName}`);
      this.emit('snapshot:created', snapshot);
      
      // Clean up old snapshots if needed
      await this.pruneSnapshots();
      
      return snapshot;
    } catch (error) {
      logger.error(`Failed to create snapshot: ${error.message}`);
      throw error;
    }
  }

  /**
   * Restore from a snapshot
   */
  async restoreSnapshot(blockNum) {
    const snapshot = this.snapshots.get(blockNum);
    
    if (!snapshot) {
      throw new Error(`Snapshot for block ${blockNum} not found`);
    }
    
    try {
      // Create a clone for safety
      const cloneName = `${this.config.dataset}_restore_${Date.now()}`;
      await execAsync(`zfs clone ${snapshot.name} ${cloneName}`);
      
      logger.info(`Created clone from snapshot: ${cloneName}`);
      this.emit('snapshot:restored', { snapshot, cloneName });
      
      return cloneName;
    } catch (error) {
      logger.error(`Failed to restore snapshot: ${error.message}`);
      throw error;
    }
  }

  /**
   * Rollback to a snapshot (destructive)
   */
  async rollbackToSnapshot(blockNum) {
    const snapshot = this.snapshots.get(blockNum);
    
    if (!snapshot) {
      throw new Error(`Snapshot for block ${blockNum} not found`);
    }
    
    try {
      // Rollback to the snapshot
      await execAsync(`zfs rollback -r ${snapshot.name}`);
      
      logger.info(`Rolled back to snapshot: ${snapshot.name}`);
      this.emit('snapshot:rollback', snapshot);
      
      // Remove newer snapshots from our map
      for (const [block, snap] of this.snapshots) {
        if (block > blockNum) {
          this.snapshots.delete(block);
        }
      }
      
      return snapshot;
    } catch (error) {
      logger.error(`Failed to rollback snapshot: ${error.message}`);
      throw error;
    }
  }

  /**
   * Load existing snapshots
   */
  async loadSnapshots() {
    try {
      const { stdout } = await execAsync(
        `zfs list -H -t snapshot -o name,honeygraph:block,honeygraph:hash,honeygraph:created ${this.config.dataset}`
      );
      
      const lines = stdout.trim().split('\n').filter(line => line);
      
      for (const line of lines) {
        const [name, block, hash, created] = line.split('\t');
        
        if (block && block !== '-') {
          const blockNum = parseInt(block);
          this.snapshots.set(blockNum, {
            name,
            blockNum,
            checkpointHash: hash || '',
            createdAt: created || '',
            metadata: {}
          });
        }
      }
      
      logger.info(`Loaded ${this.snapshots.size} existing snapshots`);
    } catch (error) {
      logger.error(`Failed to load snapshots: ${error.message}`);
    }
  }

  /**
   * Prune old snapshots
   */
  async pruneSnapshots() {
    if (this.snapshots.size <= this.config.maxSnapshots) {
      return;
    }
    
    // Sort snapshots by block number
    const sortedSnapshots = Array.from(this.snapshots.entries())
      .sort((a, b) => a[0] - b[0]);
    
    // Calculate how many to remove
    const toRemove = this.snapshots.size - this.config.maxSnapshots;
    
    for (let i = 0; i < toRemove; i++) {
      const [blockNum, snapshot] = sortedSnapshots[i];
      
      try {
        await execAsync(`zfs destroy ${snapshot.name}`);
        this.snapshots.delete(blockNum);
        logger.info(`Pruned snapshot: ${snapshot.name}`);
      } catch (error) {
        logger.error(`Failed to prune snapshot: ${error.message}`);
      }
    }
  }

  /**
   * Create a fork dataset
   */
  async createForkDataset(forkId, parentBlockNum) {
    const parentSnapshot = this.snapshots.get(parentBlockNum);
    
    if (!parentSnapshot) {
      throw new Error(`Parent snapshot for block ${parentBlockNum} not found`);
    }
    
    const forkDataset = `${this.config.dataset}_fork_${forkId}`;
    
    try {
      // Clone the parent snapshot to create fork
      await execAsync(`zfs clone ${parentSnapshot.name} ${forkDataset}`);
      
      // Set fork metadata
      await execAsync(`zfs set honeygraph:fork_id=${forkId} ${forkDataset}`);
      await execAsync(`zfs set honeygraph:parent_block=${parentBlockNum} ${forkDataset}`);
      await execAsync(`zfs set honeygraph:created="${new Date().toISOString()}" ${forkDataset}`);
      
      logger.info(`Created fork dataset: ${forkDataset}`);
      this.emit('fork:created', { forkId, forkDataset, parentBlockNum });
      
      return forkDataset;
    } catch (error) {
      logger.error(`Failed to create fork dataset: ${error.message}`);
      throw error;
    }
  }

  /**
   * Start automatic snapshots
   */
  startAutoSnapshot() {
    this.snapshotTimer = setInterval(async () => {
      try {
        // Get current block from DGraph
        const currentBlock = await this.getCurrentBlock();
        
        if (currentBlock) {
          await this.createSnapshot(currentBlock, `auto_${Date.now()}`, {
            type: 'automatic',
            interval: this.config.snapshotInterval
          });
        }
      } catch (error) {
        logger.error(`Auto-snapshot failed: ${error.message}`);
      }
    }, this.config.snapshotInterval);
    
    logger.info('Started automatic snapshots', {
      interval: this.config.snapshotInterval
    });
  }

  /**
   * Stop automatic snapshots
   */
  stopAutoSnapshot() {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
      logger.info('Stopped automatic snapshots');
    }
  }

  /**
   * Get current block (override this method)
   */
  async getCurrentBlock() {
    // This should be overridden to get the actual current block
    return null;
  }

  /**
   * Get snapshot statistics
   */
  getStats() {
    const snapshots = Array.from(this.snapshots.values());
    
    return {
      available: this.isAvailable,
      dataset: this.config.dataset,
      snapshotCount: snapshots.length,
      oldestSnapshot: snapshots[0]?.blockNum || null,
      newestSnapshot: snapshots[snapshots.length - 1]?.blockNum || null,
      autoSnapshot: this.config.autoSnapshot,
      maxSnapshots: this.config.maxSnapshots
    };
  }

  /**
   * Export snapshot list
   */
  exportSnapshots() {
    return Array.from(this.snapshots.values()).map(snapshot => ({
      blockNum: snapshot.blockNum,
      checkpointHash: snapshot.checkpointHash,
      createdAt: snapshot.createdAt,
      name: snapshot.name
    }));
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown() {
    this.stopAutoSnapshot();
    this.removeAllListeners();
    logger.info('ZFS manager shutdown');
  }
}

/**
 * Factory function
 */
export function createZFSManager(config) {
  return new ZFSManager(config);
}