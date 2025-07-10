import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from './logger.js';

const execAsync = promisify(exec);
const logger = createLogger('zfs-checkpoint');

export class ZFSCheckpointManager {
  constructor(options = {}) {
    this.dataset = options.dataset || 'rpool/dgraph'; // ZFS dataset for Dgraph data
    this.snapshotPrefix = options.snapshotPrefix || 'checkpoint';
    this.maxSnapshots = options.maxSnapshots || 100;
    this.dgraphDataPath = options.dgraphDataPath || '/dgraph';
    this.checkpoints = new Map(); // blockNum -> snapshot name
  }

  // Create a ZFS snapshot for a checkpoint
  async createCheckpoint(blockNum, ipfsHash) {
    const snapshotName = `${this.snapshotPrefix}_${blockNum}_${ipfsHash.substring(0, 8)}`;
    const fullSnapshot = `${this.dataset}@${snapshotName}`;
    
    try {
      // Create ZFS snapshot
      await execAsync(`sudo zfs snapshot ${fullSnapshot}`);
      
      // Store checkpoint info
      this.checkpoints.set(blockNum, {
        snapshot: fullSnapshot,
        ipfsHash,
        blockNum,
        createdAt: new Date()
      });
      
      logger.info('ZFS checkpoint created', { 
        blockNum, 
        snapshot: fullSnapshot,
        ipfsHash 
      });
      
      // Cleanup old snapshots if needed
      await this.cleanupOldSnapshots();
      
      return {
        success: true,
        snapshot: fullSnapshot,
        blockNum,
        ipfsHash
      };
    } catch (error) {
      logger.error('Failed to create ZFS checkpoint', { 
        error: error.message,
        blockNum 
      });
      throw error;
    }
  }

  // Rollback to a specific checkpoint
  async rollbackToCheckpoint(targetBlockNum) {
    const checkpoint = this.checkpoints.get(targetBlockNum);
    
    if (!checkpoint) {
      throw new Error(`No checkpoint found for block ${targetBlockNum}`);
    }
    
    try {
      logger.info('Rolling back to checkpoint', {
        blockNum: targetBlockNum,
        snapshot: checkpoint.snapshot
      });
      
      // Stop Dgraph before rollback
      await this.stopDgraph();
      
      // Rollback to snapshot
      await execAsync(`sudo zfs rollback -r ${checkpoint.snapshot}`);
      
      // Remove newer snapshots from our tracking
      for (const [blockNum, cp] of this.checkpoints) {
        if (blockNum > targetBlockNum) {
          this.checkpoints.delete(blockNum);
        }
      }
      
      // Restart Dgraph
      await this.startDgraph();
      
      logger.info('Rollback completed', {
        blockNum: targetBlockNum,
        ipfsHash: checkpoint.ipfsHash
      });
      
      return {
        success: true,
        rolledBackTo: checkpoint
      };
    } catch (error) {
      logger.error('Rollback failed', {
        error: error.message,
        targetBlockNum
      });
      throw error;
    }
  }

  // Clone a checkpoint for testing/branching
  async cloneCheckpoint(blockNum, cloneName) {
    const checkpoint = this.checkpoints.get(blockNum);
    
    if (!checkpoint) {
      throw new Error(`No checkpoint found for block ${blockNum}`);
    }
    
    const cloneDataset = `${this.dataset}_${cloneName}`;
    
    try {
      // Create clone from snapshot
      await execAsync(`sudo zfs clone ${checkpoint.snapshot} ${cloneDataset}`);
      
      logger.info('Checkpoint cloned', {
        blockNum,
        snapshot: checkpoint.snapshot,
        clone: cloneDataset
      });
      
      return {
        success: true,
        cloneDataset,
        sourceCheckpoint: checkpoint
      };
    } catch (error) {
      logger.error('Clone failed', {
        error: error.message,
        blockNum
      });
      throw error;
    }
  }

  // List all checkpoints
  async listCheckpoints() {
    try {
      const { stdout } = await execAsync(
        `zfs list -t snapshot -o name,creation,used,refer -s creation | grep ${this.dataset}@${this.snapshotPrefix}`
      );
      
      const snapshots = stdout.trim().split('\n').map(line => {
        const [name, creation, used, refer] = line.split(/\s+/);
        return {
          name,
          creation,
          used,
          refer,
          checkpoint: this.checkpoints.get(this.extractBlockNum(name))
        };
      });
      
      return snapshots;
    } catch (error) {
      logger.error('Failed to list checkpoints', { error: error.message });
      return [];
    }
  }

  // Get checkpoint by IPFS hash
  async getCheckpointByHash(ipfsHash) {
    for (const [blockNum, checkpoint] of this.checkpoints) {
      if (checkpoint.ipfsHash === ipfsHash) {
        return checkpoint;
      }
    }
    return null;
  }

  // Cleanup old snapshots
  async cleanupOldSnapshots() {
    const snapshots = await this.listCheckpoints();
    
    if (snapshots.length > this.maxSnapshots) {
      const toDelete = snapshots
        .sort((a, b) => new Date(a.creation) - new Date(b.creation))
        .slice(0, snapshots.length - this.maxSnapshots);
      
      for (const snapshot of toDelete) {
        try {
          await execAsync(`sudo zfs destroy ${snapshot.name}`);
          const blockNum = this.extractBlockNum(snapshot.name);
          this.checkpoints.delete(blockNum);
          
          logger.info('Deleted old snapshot', { 
            snapshot: snapshot.name,
            blockNum 
          });
        } catch (error) {
          logger.error('Failed to delete snapshot', {
            error: error.message,
            snapshot: snapshot.name
          });
        }
      }
    }
  }

  // Create automated snapshots at intervals
  async enableAutoSnapshots(intervalBlocks = 1000) {
    logger.info('Enabling auto snapshots', { intervalBlocks });
    
    // This would be called from the block processor
    // when blockNum % intervalBlocks === 0
    return {
      enabled: true,
      interval: intervalBlocks
    };
  }

  // Compare two checkpoints
  async diffCheckpoints(blockNum1, blockNum2) {
    const cp1 = this.checkpoints.get(blockNum1);
    const cp2 = this.checkpoints.get(blockNum2);
    
    if (!cp1 || !cp2) {
      throw new Error('One or both checkpoints not found');
    }
    
    try {
      const { stdout } = await execAsync(
        `sudo zfs diff ${cp1.snapshot} ${cp2.snapshot} | head -100`
      );
      
      return {
        from: cp1,
        to: cp2,
        differences: stdout.trim().split('\n')
      };
    } catch (error) {
      logger.error('Failed to diff checkpoints', {
        error: error.message,
        blockNum1,
        blockNum2
      });
      throw error;
    }
  }

  // Helper methods
  extractBlockNum(snapshotName) {
    const match = snapshotName.match(new RegExp(`${this.snapshotPrefix}_(\\d+)_`));
    return match ? parseInt(match[1]) : null;
  }

  async stopDgraph() {
    try {
      await execAsync('docker-compose stop dgraph-alpha dgraph-zero');
      logger.info('Dgraph stopped');
    } catch (error) {
      logger.error('Failed to stop Dgraph', { error: error.message });
    }
  }

  async startDgraph() {
    try {
      await execAsync('docker-compose start dgraph-zero dgraph-alpha');
      // Wait for Dgraph to be ready
      await this.waitForDgraph();
      logger.info('Dgraph started');
    } catch (error) {
      logger.error('Failed to start Dgraph', { error: error.message });
    }
  }

  async waitForDgraph(maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const { stdout } = await execAsync('curl -s http://localhost:8080/health');
        if (stdout.includes('OK')) {
          return true;
        }
      } catch (e) {
        // Ignore errors during startup
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Dgraph failed to start');
  }

  // Initialize from existing snapshots
  async loadExistingCheckpoints() {
    try {
      const { stdout } = await execAsync(
        `zfs list -t snapshot -o name -H | grep "${this.dataset}@${this.snapshotPrefix}"`
      );
      
      const snapshots = stdout.trim().split('\n').filter(Boolean);
      
      for (const snapshot of snapshots) {
        const blockNum = this.extractBlockNum(snapshot);
        if (blockNum) {
          // Extract IPFS hash from snapshot name
          const match = snapshot.match(new RegExp(`${this.snapshotPrefix}_\\d+_([a-f0-9]{8})`));
          const ipfsHashPrefix = match ? match[1] : '';
          
          this.checkpoints.set(blockNum, {
            snapshot,
            blockNum,
            ipfsHash: ipfsHashPrefix, // Note: this is just the prefix
            createdAt: new Date() // Would need to get actual creation time
          });
        }
      }
      
      logger.info('Loaded existing checkpoints', { 
        count: this.checkpoints.size 
      });
    } catch (error) {
      logger.error('Failed to load existing checkpoints', { 
        error: error.message 
      });
    }
  }
}

// Factory function
export function createZFSCheckpointManager(options) {
  return new ZFSCheckpointManager(options);
}