import fetch from 'node-fetch';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ipfs-checkpoint-recovery');

/**
 * IPFS Checkpoint Recovery
 * Downloads and processes checkpoint data from IPFS when operations are missing
 */
export class IPFSCheckpointRecovery {
  constructor(options = {}) {
    this.ipfsGateway = options.ipfsGateway || process.env.IPFS_GATEWAY || 'https://ipfs.dlux.io';
    this.dataTransformer = options.dataTransformer;
    this.networkManager = options.networkManager;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
  }

  /**
   * Download checkpoint data from IPFS
   * @param {string} ipfsHash - The IPFS hash of the checkpoint
   * @returns {Promise<Object>} The checkpoint data
   */
  async downloadCheckpoint(ipfsHash) {
    const url = `${this.ipfsGateway}/ipfs/${ipfsHash}`;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.info(`Downloading checkpoint from IPFS: ${ipfsHash} (attempt ${attempt}/${this.maxRetries})`);
        
        const response = await fetch(url, {
          timeout: 30000, // 30 second timeout
          headers: {
            'Accept': 'application/json'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        logger.info(`Successfully downloaded checkpoint ${ipfsHash}`);
        return data;
        
      } catch (error) {
        logger.error(`Failed to download checkpoint ${ipfsHash}:`, error);
        
        if (attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Process checkpoint data and extract operations
   * @param {Object} checkpointData - The raw checkpoint data from IPFS
   * @returns {Array} Array of operations with metadata
   */
  parseCheckpointOperations(checkpointData) {
    const operations = [];
    
    // Extract block number from checkpoint
    const blockNum = checkpointData[0];
    const checkpoint = checkpointData[1];
    
    if (!checkpoint || !checkpoint.ops) {
      logger.warn('Invalid checkpoint format - missing ops array');
      return operations;
    }
    
    // Parse each operation
    checkpoint.ops.forEach((opString, index) => {
      try {
        const op = JSON.parse(opString);
        
        // Add metadata to operation
        operations.push({
          index: index,
          blockNum: blockNum,
          type: op.type || 'unknown',
          path: op.path,
          data: op.data,
          timestamp: op.timestamp || Date.now(),
          raw: op
        });
        
      } catch (error) {
        logger.error(`Failed to parse operation at index ${index}:`, error);
      }
    });
    
    logger.info(`Parsed ${operations.length} operations from checkpoint at block ${blockNum}`);
    return operations;
  }

  /**
   * Transform operations into honeygraph format
   * @param {Array} operations - Raw operations from checkpoint
   * @param {string} prefix - Network prefix (e.g., 'spkccT_')
   * @param {string} forkHash - The fork hash for these operations
   * @returns {Array} Transformed operations
   */
  async transformOperations(operations, prefix, forkHash) {
    if (!this.dataTransformer) {
      logger.warn('No data transformer available, returning raw operations');
      return operations;
    }
    
    const transformed = [];
    
    for (const op of operations) {
      try {
        // Transform based on operation type
        let transformedOp;
        
        if (op.type === 'put') {
          transformedOp = await this.dataTransformer.transformPutOperation({
            path: op.path,
            data: op.data,
            blockNum: op.blockNum
          }, prefix);
        } else if (op.type === 'del') {
          transformedOp = await this.dataTransformer.transformDelOperation({
            path: op.path,
            blockNum: op.blockNum
          }, prefix);
        } else {
          // Generic transformation
          transformedOp = {
            type: op.type,
            path: op.path,
            data: op.data,
            blockNum: op.blockNum
          };
        }
        
        // Add fork and index information
        if (transformedOp) {
          transformedOp.forkHash = forkHash;
          transformedOp.index = op.index;
          transformedOp.timestamp = op.timestamp;
          transformed.push(transformedOp);
        }
        
      } catch (error) {
        logger.error(`Failed to transform operation:`, error);
      }
    }
    
    return transformed;
  }

  /**
   * Download and process a chain of checkpoints
   * @param {string} startHash - Starting checkpoint hash
   * @param {string} endHash - Ending checkpoint hash (optional)
   * @param {string} prefix - Network prefix
   * @returns {Promise<Array>} All operations in the chain
   */
  async downloadCheckpointChain(startHash, endHash, prefix) {
    const allOperations = [];
    let currentHash = startHash;
    const visited = new Set();
    
    while (currentHash && currentHash !== endHash) {
      // Prevent infinite loops
      if (visited.has(currentHash)) {
        logger.warn(`Circular reference detected at ${currentHash}`);
        break;
      }
      visited.add(currentHash);
      
      try {
        // Download checkpoint
        const checkpointData = await this.downloadCheckpoint(currentHash);
        
        // Parse operations
        const operations = this.parseCheckpointOperations(checkpointData);
        
        // Transform operations
        const transformed = await this.transformOperations(operations, prefix, currentHash);
        allOperations.push(...transformed);
        
        // Get next checkpoint in chain
        if (checkpointData[1] && checkpointData[1].chain && checkpointData[1].chain.length > 0) {
          // The chain array contains [hash, blockNum] pairs
          // Find the next checkpoint (usually every 100 blocks)
          const lastEntry = checkpointData[1].chain[checkpointData[1].chain.length - 1];
          if (Array.isArray(lastEntry) && lastEntry[0]) {
            currentHash = lastEntry[0];
          } else {
            break;
          }
        } else {
          break;
        }
        
      } catch (error) {
        logger.error(`Failed to process checkpoint ${currentHash}:`, error);
        break;
      }
    }
    
    logger.info(`Downloaded ${allOperations.length} operations from checkpoint chain`);
    return allOperations;
  }

  /**
   * Recover missing operations for a fork
   * @param {string} forkHash - The fork hash (which is the checkpoint IPFS hash)
   * @param {number} fromIndex - Starting operation index
   * @param {number} toIndex - Ending operation index
   * @param {string} prefix - Network prefix
   * @returns {Promise<Array>} The recovered operations
   */
  async recoverMissingOperations(forkHash, fromIndex, toIndex, prefix) {
    try {
      logger.info(`Recovering operations ${fromIndex}-${toIndex} for fork ${forkHash}`);
      
      // Download the checkpoint
      const checkpointData = await this.downloadCheckpoint(forkHash);
      
      // Parse all operations
      const operations = this.parseCheckpointOperations(checkpointData);
      
      // Filter to requested range
      const filtered = operations.filter(op => 
        op.index >= fromIndex && op.index <= toIndex
      );
      
      // Transform operations
      const transformed = await this.transformOperations(filtered, prefix, forkHash);
      
      logger.info(`Recovered ${transformed.length} operations from IPFS`);
      return transformed;
      
    } catch (error) {
      logger.error('Failed to recover operations from IPFS:', error);
      throw error;
    }
  }
}

export default IPFSCheckpointRecovery;