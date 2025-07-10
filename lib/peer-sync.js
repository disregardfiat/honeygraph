import fetch from 'node-fetch';
import { createLogger } from './logger.js';
import PQueue from 'p-queue';

const logger = createLogger('peer-sync');

export class PeerSyncManager {
  constructor({ dgraphClient, forkManager, zfsCheckpoints }) {
    this.dgraph = dgraphClient;
    this.forkManager = forkManager;
    this.zfsCheckpoints = zfsCheckpoints;
    this.peers = new Map();
    this.syncQueue = new PQueue({ concurrency: 3 });
    this.isSyncing = false;
    this.lastSyncBlock = 0;
  }

  // Register a peer honeygraph node
  registerPeer(peerId, url, options = {}) {
    this.peers.set(peerId, {
      id: peerId,
      url,
      lastSeen: Date.now(),
      reliability: 1.0,
      isAlive: true,
      ...options
    });
    
    logger.info('Peer registered', { peerId, url });
  }

  // Discover peers from honeycomb network
  async discoverPeers(honeycombNodes) {
    const discoveryPromises = honeycombNodes.map(async (node) => {
      try {
        const response = await fetch(`${node.url}/api/honeygraph-peers`);
        if (response.ok) {
          const peers = await response.json();
          peers.forEach(peer => {
            if (!this.peers.has(peer.id)) {
              this.registerPeer(peer.id, peer.url, { source: node.id });
            }
          });
        }
      } catch (error) {
        logger.debug('Failed to discover peers from node', { 
          node: node.id, 
          error: error.message 
        });
      }
    });

    await Promise.all(discoveryPromises);
    logger.info('Peer discovery complete', { totalPeers: this.peers.size });
  }

  // Check for gaps in our blockchain data
  async detectGaps(fromBlock, toBlock) {
    const gaps = [];
    let lastBlock = fromBlock;
    
    const query = `
      query findGaps($from: int, $to: int) {
        blocks(func: between(blockNum, $from, $to)) @normalize {
          blockNum
        }
      }
    `;
    
    const vars = { $from: fromBlock, $to: toBlock };
    const result = await this.dgraph.client.newTxn().queryWithVars(query, vars);
    const blocks = result.getJson().blocks || [];
    const blockNums = blocks.map(b => b.blockNum).sort((a, b) => a - b);
    
    // Find gaps
    for (const blockNum of blockNums) {
      if (blockNum > lastBlock + 1) {
        gaps.push({
          start: lastBlock + 1,
          end: blockNum - 1,
          size: blockNum - lastBlock - 1
        });
      }
      lastBlock = blockNum;
    }
    
    // Check for gap at the end
    if (lastBlock < toBlock) {
      gaps.push({
        start: lastBlock + 1,
        end: toBlock,
        size: toBlock - lastBlock
      });
    }
    
    return gaps;
  }

  // Sync missing blocks from peers
  async syncGaps(gaps, targetFork = null) {
    if (this.isSyncing) {
      logger.warn('Sync already in progress');
      return { success: false, reason: 'sync_in_progress' };
    }

    this.isSyncing = true;
    const results = {
      totalGaps: gaps.length,
      syncedBlocks: 0,
      failedBlocks: 0,
      peers: {}
    };

    try {
      for (const gap of gaps) {
        logger.info('Syncing gap', { 
          start: gap.start, 
          end: gap.end, 
          size: gap.size 
        });

        // Try to sync from multiple peers in parallel
        const syncTasks = [];
        for (let blockNum = gap.start; blockNum <= gap.end; blockNum++) {
          syncTasks.push(this.syncQueue.add(() => this.syncBlock(blockNum, targetFork)));
        }

        const blockResults = await Promise.allSettled(syncTasks);
        
        blockResults.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value.success) {
            results.syncedBlocks++;
            const peerId = result.value.peerId;
            results.peers[peerId] = (results.peers[peerId] || 0) + 1;
          } else {
            results.failedBlocks++;
            logger.error('Failed to sync block', {
              blockNum: gap.start + index,
              reason: result.reason || 'unknown'
            });
          }
        });
      }

      // Update last sync block
      this.lastSyncBlock = Math.max(...gaps.map(g => g.end));

      return {
        success: true,
        results
      };
    } finally {
      this.isSyncing = false;
    }
  }

  // Sync a single block from peers
  async syncBlock(blockNum, targetFork = null) {
    const peers = this.getHealthyPeers();
    
    for (const peer of peers) {
      try {
        // Query peer for block data
        const blockData = await this.fetchBlockFromPeer(peer, blockNum, targetFork);
        
        if (blockData) {
          // Verify block data
          if (await this.verifyBlockData(blockData)) {
            // Import block into our Dgraph
            await this.importBlock(blockData);
            
            // Update peer reliability
            this.updatePeerReliability(peer.id, true);
            
            return {
              success: true,
              blockNum,
              peerId: peer.id
            };
          }
        }
      } catch (error) {
        logger.debug('Failed to sync block from peer', {
          peerId: peer.id,
          blockNum,
          error: error.message
        });
        
        // Update peer reliability
        this.updatePeerReliability(peer.id, false);
      }
    }
    
    return {
      success: false,
      blockNum,
      reason: 'no_valid_data'
    };
  }

  // Fetch block data from a peer
  async fetchBlockFromPeer(peer, blockNum, targetFork) {
    const url = `${peer.url}/api/query/block/${blockNum}/full`;
    const params = new URLSearchParams();
    if (targetFork) params.append('fork', targetFork);
    
    const response = await fetch(`${url}?${params}`, {
      timeout: 10000,
      headers: {
        'X-Honeygraph-Peer': process.env.PEER_ID || 'unknown'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return await response.json();
  }

  // Verify block data integrity
  async verifyBlockData(blockData) {
    // Verify block has required fields
    if (!blockData.blockNum || !blockData.blockHash || !blockData.operations) {
      return false;
    }
    
    // Verify IPFS hash if provided
    if (blockData.ipfsHash) {
      // Could verify by checking with multiple IPFS nodes
      // For now, trust but verify later
    }
    
    // Check consensus if we have multiple sources
    if (this.peers.size >= 3) {
      const consensusData = await this.checkBlockConsensus(blockData.blockNum);
      if (consensusData && consensusData.blockHash !== blockData.blockHash) {
        logger.warn('Block hash mismatch with consensus', {
          blockNum: blockData.blockNum,
          providedHash: blockData.blockHash,
          consensusHash: consensusData.blockHash
        });
        return false;
      }
    }
    
    return true;
  }

  // Import block data into our Dgraph
  async importBlock(blockData) {
    const txn = this.dgraph.client.newTxn();
    
    try {
      // Create block node
      const blockMutation = {
        uid: '_:block',
        'dgraph.type': 'Block',
        blockNum: blockData.blockNum,
        blockHash: blockData.blockHash,
        previousHash: blockData.previousHash,
        timestamp: blockData.timestamp || new Date().toISOString(),
        forkId: blockData.forkId,
        isFinalized: blockData.isFinalized || false,
        syncedFrom: blockData.peerId,
        syncedAt: new Date().toISOString()
      };

      // Import operations
      const operationMutations = blockData.operations.map((op, index) => ({
        uid: `_:op${index}`,
        'dgraph.type': 'Operation',
        block: { uid: '_:block' },
        ...op
      }));

      const mutation = new dgraph.Mutation();
      mutation.setSetJson({
        block: blockMutation,
        operations: operationMutations
      });

      await txn.mutate(mutation);
      await txn.commit();
      
      logger.info('Block imported successfully', { 
        blockNum: blockData.blockNum 
      });
    } catch (error) {
      await txn.discard();
      throw error;
    }
  }

  // Check consensus among peers for a block
  async checkBlockConsensus(blockNum) {
    const peers = this.getHealthyPeers();
    const responses = {};
    
    const queries = peers.map(async (peer) => {
      try {
        const data = await this.fetchBlockFromPeer(peer, blockNum);
        if (data) {
          const hash = data.blockHash;
          responses[hash] = (responses[hash] || []).concat(peer.id);
        }
      } catch (error) {
        // Ignore individual peer failures
      }
    });
    
    await Promise.all(queries);
    
    // Find consensus (majority)
    let consensusHash = null;
    let maxVotes = 0;
    
    for (const [hash, peerIds] of Object.entries(responses)) {
      if (peerIds.length > maxVotes && peerIds.length > peers.length / 2) {
        consensusHash = hash;
        maxVotes = peerIds.length;
      }
    }
    
    return consensusHash ? {
      blockHash: consensusHash,
      peers: responses[consensusHash],
      confidence: maxVotes / peers.length
    } : null;
  }

  // Continuous sync process
  async startContinuousSync(intervalMs = 60000) {
    logger.info('Starting continuous sync', { intervalMs });
    
    const syncProcess = async () => {
      try {
        // Get current blockchain head
        const localHead = await this.getLocalHead();
        const networkHead = await this.getNetworkHead();
        
        if (networkHead > localHead) {
          logger.info('Local node behind network', {
            localHead,
            networkHead,
            behind: networkHead - localHead
          });
          
          // Detect and sync gaps
          const gaps = await this.detectGaps(this.lastSyncBlock, networkHead);
          if (gaps.length > 0) {
            await this.syncGaps(gaps);
          }
        }
      } catch (error) {
        logger.error('Continuous sync error', { error: error.message });
      }
    };
    
    // Run immediately
    syncProcess();
    
    // Then run periodically
    this.syncInterval = setInterval(syncProcess, intervalMs);
  }

  // Stop continuous sync
  stopContinuousSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      logger.info('Continuous sync stopped');
    }
  }

  // Get local blockchain head
  async getLocalHead() {
    const query = `{
      head(func: type(Block)) @normalize {
        maxBlock: max(blockNum)
      }
    }`;
    
    const result = await this.dgraph.client.newTxn().query(query);
    const data = result.getJson();
    return data.head?.[0]?.maxBlock || 0;
  }

  // Get network head from peers
  async getNetworkHead() {
    const peers = this.getHealthyPeers();
    let maxHead = 0;
    
    const queries = peers.map(async (peer) => {
      try {
        const response = await fetch(`${peer.url}/api/query/head`);
        if (response.ok) {
          const data = await response.json();
          maxHead = Math.max(maxHead, data.head || 0);
        }
      } catch (error) {
        // Ignore individual peer failures
      }
    });
    
    await Promise.all(queries);
    return maxHead;
  }

  // Get healthy peers sorted by reliability
  getHealthyPeers() {
    return Array.from(this.peers.values())
      .filter(peer => peer.isAlive && peer.reliability > 0.5)
      .sort((a, b) => b.reliability - a.reliability);
  }

  // Update peer reliability based on success/failure
  updatePeerReliability(peerId, success) {
    const peer = this.peers.get(peerId);
    if (peer) {
      // Exponential moving average
      const alpha = 0.1;
      peer.reliability = alpha * (success ? 1 : 0) + (1 - alpha) * peer.reliability;
      peer.lastSeen = Date.now();
      
      // Mark as dead if reliability too low
      if (peer.reliability < 0.1) {
        peer.isAlive = false;
        logger.warn('Peer marked as dead', { peerId, reliability: peer.reliability });
      }
    }
  }

  // Health check all peers
  async healthCheckPeers() {
    const checks = Array.from(this.peers.values()).map(async (peer) => {
      try {
        const response = await fetch(`${peer.url}/health`, { timeout: 5000 });
        peer.isAlive = response.ok;
        if (response.ok) {
          peer.lastSeen = Date.now();
        }
      } catch (error) {
        peer.isAlive = false;
      }
    });
    
    await Promise.all(checks);
    
    const alive = Array.from(this.peers.values()).filter(p => p.isAlive).length;
    logger.info('Peer health check complete', { 
      alive, 
      total: this.peers.size 
    });
  }
}

// Factory function
export function createPeerSyncManager(options) {
  return new PeerSyncManager(options);
}