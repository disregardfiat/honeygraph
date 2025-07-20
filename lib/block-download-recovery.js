/**
 * Block Download and Replay Recovery System
 * Downloads block data directly from Honeycomb nodes and replays against checkpoints
 * instead of querying missing operations - more reliable for fork recovery
 */

import { EventEmitter } from 'events';
import fetch from 'node-fetch';

export class BlockDownloadRecovery extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      honeycombUrls: options.honeycombUrls || [
        'https://spktest.dlux.io',
        'https://duat.dlux.io', 
        'https://token.dlux.io'
      ],
      maxConcurrentDownloads: options.maxConcurrentDownloads || 5,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000,
      blockCacheSize: options.blockCacheSize || 1000,
      timeoutMs: options.timeoutMs || 30000,
      ...options
    };
    
    this.blockCache = new Map(); // blockNum -> blockData
    this.downloadQueue = new Map(); // blockNum -> Promise
    this.zfsCheckpoints = options.zfsCheckpoints;
    this.dgraphClient = options.dgraphClient;
    this.dataTransformer = options.dataTransformer;
    this.logger = options.logger || console;
  }

  /**
   * Recover from fork by downloading blocks and replaying against checkpoint
   */
  async recoverFromFork(forkInfo) {
    const { 
      currentBlock, 
      targetBlock, 
      checkpointBlock, 
      forkHash, 
      canonicalHash 
    } = forkInfo;

    this.logger.info('Starting fork recovery', {
      currentBlock,
      targetBlock,
      checkpointBlock,
      forkHash,
      canonicalHash
    });

    try {
      // Step 1: Rollback to last good checkpoint
      if (this.zfsCheckpoints && checkpointBlock) {
        this.logger.info('Rolling back to checkpoint', { checkpointBlock });
        await this.zfsCheckpoints.rollbackToCheckpoint(checkpointBlock);
      }

      // Step 2: Download canonical blocks from checkpoint to target
      const blocksToDownload = [];
      for (let blockNum = checkpointBlock + 1; blockNum <= targetBlock; blockNum++) {
        blocksToDownload.push(blockNum);
      }

      this.logger.info('Downloading canonical blocks', { 
        blocks: blocksToDownload.length,
        range: `${checkpointBlock + 1}-${targetBlock}`
      });

      // Step 3: Download blocks in batches
      const blockData = await this.downloadBlocksBatch(blocksToDownload);

      // Step 4: Replay blocks against the checkpoint
      this.logger.info('Replaying blocks against checkpoint', { 
        blocksDownloaded: blockData.length 
      });

      await this.replayBlocks(blockData, checkpointBlock);

      // Step 5: Create new checkpoint at target block
      if (this.zfsCheckpoints) {
        this.logger.info('Creating recovery checkpoint', { targetBlock });
        await this.zfsCheckpoints.createCheckpoint(targetBlock, canonicalHash);
      }

      this.emit('recovery:complete', {
        recoveredBlocks: blockData.length,
        fromBlock: checkpointBlock,
        toBlock: targetBlock,
        canonicalHash
      });

      return {
        success: true,
        recoveredBlocks: blockData.length,
        fromBlock: checkpointBlock,
        toBlock: targetBlock
      };

    } catch (error) {
      this.logger.error('Fork recovery failed', { 
        error: error.message,
        forkInfo 
      });

      this.emit('recovery:failed', {
        error: error.message,
        forkInfo
      });

      throw error;
    }
  }

  /**
   * Download multiple blocks in batches with concurrency control
   */
  async downloadBlocksBatch(blockNumbers) {
    const results = [];
    const concurrency = this.options.maxConcurrentDownloads;
    
    // Process in chunks to control concurrency
    for (let i = 0; i < blockNumbers.length; i += concurrency) {
      const chunk = blockNumbers.slice(i, i + concurrency);
      const promises = chunk.map(blockNum => this.downloadBlock(blockNum));
      
      const chunkResults = await Promise.allSettled(promises);
      
      for (let j = 0; j < chunkResults.length; j++) {
        const result = chunkResults[j];
        const blockNum = chunk[j];
        
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
        } else {
          this.logger.warn('Failed to download block', { 
            blockNum, 
            error: result.reason?.message 
          });
        }
      }
    }

    // Sort by block number to ensure correct order
    return results.sort((a, b) => a.blockNum - b.blockNum);
  }

  /**
   * Download single block from Honeycomb nodes
   */
  async downloadBlock(blockNum) {
    // Check cache first
    if (this.blockCache.has(blockNum)) {
      return this.blockCache.get(blockNum);
    }

    // Check if already downloading
    if (this.downloadQueue.has(blockNum)) {
      return this.downloadQueue.get(blockNum);
    }

    // Start download
    const downloadPromise = this._downloadBlockFromNodes(blockNum);
    this.downloadQueue.set(blockNum, downloadPromise);

    try {
      const blockData = await downloadPromise;
      
      // Cache the result
      if (blockData) {
        this.blockCache.set(blockNum, blockData);
        this._trimCache();
      }
      
      return blockData;
    } finally {
      this.downloadQueue.delete(blockNum);
    }
  }

  /**
   * Download block from multiple Honeycomb nodes with fallback
   */
  async _downloadBlockFromNodes(blockNum) {
    let lastError;

    // Try each Honeycomb node
    for (const baseUrl of this.options.honeycombUrls) {
      try {
        const blockData = await this._downloadFromNode(baseUrl, blockNum);
        if (blockData) {
          this.logger.debug('Downloaded block from node', { blockNum, node: baseUrl });
          return blockData;
        }
      } catch (error) {
        lastError = error;
        this.logger.warn('Failed to download from node', { 
          blockNum, 
          node: baseUrl, 
          error: error.message 
        });
      }
    }

    throw new Error(`Failed to download block ${blockNum} from any node: ${lastError?.message}`);
  }

  /**
   * Download block from specific Honeycomb node
   */
  async _downloadFromNode(baseUrl, blockNum) {
    const url = `${baseUrl}/api/block/${blockNum}`;
    
    for (let attempt = 0; attempt < this.options.retryAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.options.timeoutMs);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Honeygraph-Recovery/1.0'
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const blockData = await response.json();
        
        // Validate block data structure
        if (!this._validateBlockData(blockData, blockNum)) {
          throw new Error('Invalid block data structure');
        }

        return {
          blockNum,
          blockHash: blockData.hash || blockData.id,
          timestamp: blockData.timestamp || Date.now(),
          operations: blockData.operations || blockData.ops || [],
          metadata: {
            downloadedFrom: baseUrl,
            downloadedAt: Date.now()
          },
          raw: blockData
        };

      } catch (error) {
        if (attempt === this.options.retryAttempts - 1) {
          throw error;
        }
        
        this.logger.debug('Retrying block download', { 
          blockNum, 
          attempt: attempt + 1, 
          error: error.message 
        });
        
        await this._delay(this.options.retryDelay * (attempt + 1));
      }
    }
  }

  /**
   * Validate downloaded block data
   */
  _validateBlockData(blockData, expectedBlockNum) {
    if (!blockData || typeof blockData !== 'object') {
      return false;
    }

    // Check block number matches
    const blockNum = blockData.blockNum || blockData.block_num || blockData.number;
    if (blockNum !== expectedBlockNum) {
      return false;
    }

    // Must have operations array
    if (!Array.isArray(blockData.operations) && !Array.isArray(blockData.ops)) {
      return false;
    }

    return true;
  }

  /**
   * Replay blocks against checkpoint
   */
  async replayBlocks(blockDataArray, fromCheckpoint) {
    this.logger.info('Starting block replay', { 
      blocks: blockDataArray.length,
      fromCheckpoint 
    });

    for (const blockData of blockDataArray) {
      try {
        await this.replayBlock(blockData);
        
        this.emit('block:replayed', {
          blockNum: blockData.blockNum,
          operationCount: blockData.operations.length
        });

      } catch (error) {
        this.logger.error('Block replay failed', {
          blockNum: blockData.blockNum,
          error: error.message
        });

        this.emit('block:replay_failed', {
          blockNum: blockData.blockNum,
          error: error.message
        });

        throw error;
      }
    }

    this.logger.info('Block replay completed', { 
      blocks: blockDataArray.length 
    });
  }

  /**
   * Replay single block
   */
  async replayBlock(blockData) {
    if (!this.dataTransformer || !this.dgraphClient) {
      throw new Error('Data transformer and Dgraph client required for block replay');
    }

    // Transform operations to Dgraph format
    const transformedOps = await this.dataTransformer.transformOperations(
      blockData.operations,
      {
        blockNum: blockData.blockNum,
        blockHash: blockData.blockHash,
        timestamp: blockData.timestamp,
        isReplay: true
      }
    );

    // Write to Dgraph
    const result = await this.dgraphClient.writeBatch(transformedOps, {
      blockNum: blockData.blockNum,
      blockHash: blockData.blockHash,
      isReplay: true
    });

    this.logger.debug('Block replayed successfully', {
      blockNum: blockData.blockNum,
      operations: transformedOps.length,
      dgraphResult: result
    });

    return result;
  }

  /**
   * Get recovery status for a range of blocks
   */
  async getRecoveryStatus(fromBlock, toBlock) {
    const status = {
      totalBlocks: toBlock - fromBlock + 1,
      cachedBlocks: 0,
      missingBlocks: [],
      availableNodes: []
    };

    // Check cached blocks
    for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
      if (this.blockCache.has(blockNum)) {
        status.cachedBlocks++;
      } else {
        status.missingBlocks.push(blockNum);
      }
    }

    // Check node availability
    for (const baseUrl of this.options.honeycombUrls) {
      try {
        const healthUrl = `${baseUrl}/api/health`;
        const response = await fetch(healthUrl, { timeout: 5000 });
        if (response.ok) {
          status.availableNodes.push(baseUrl);
        }
      } catch (error) {
        // Node unavailable
      }
    }

    return status;
  }

  /**
   * Trim block cache to max size
   */
  _trimCache() {
    if (this.blockCache.size <= this.options.blockCacheSize) {
      return;
    }

    // Remove oldest entries (LRU)
    const entriesToRemove = this.blockCache.size - this.options.blockCacheSize;
    const entries = Array.from(this.blockCache.entries())
      .sort((a, b) => a[1].metadata.downloadedAt - b[1].metadata.downloadedAt);

    for (let i = 0; i < entriesToRemove; i++) {
      this.blockCache.delete(entries[i][0]);
    }
  }

  /**
   * Utility delay function
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear cache and queues
   */
  clearCache() {
    this.blockCache.clear();
    this.downloadQueue.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      cacheSize: this.blockCache.size,
      maxCacheSize: this.options.blockCacheSize,
      activeDownloads: this.downloadQueue.size,
      cacheHitRate: this._calculateCacheHitRate()
    };
  }

  /**
   * Calculate cache hit rate
   */
  _calculateCacheHitRate() {
    // This would need to be tracked separately for accurate metrics
    return this.blockCache.size > 0 ? 0.8 : 0; // Placeholder
  }
}

export default BlockDownloadRecovery;