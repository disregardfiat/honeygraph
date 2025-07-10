export class ForkManager {
  constructor(dgraphClient, logger) {
    this.dgraph = dgraphClient;
    this.logger = logger;
    this.activeForks = new Map();
    this.canonicalFork = 'main';
  }

  async createFork(parentFork, atBlock, forkId) {
    const fork = {
      forkId,
      parentFork,
      createdAtBlock: atBlock,
      status: 'ACTIVE',
      lastBlock: atBlock,
      createdAt: new Date().toISOString()
    };

    try {
      const txn = this.dgraph.client.newTxn();
      const mutation = {
        uid: '_:fork',
        'dgraph.type': 'Fork',
        ...fork
      };

      await txn.mutate({ setJson: mutation });
      await txn.commit();

      this.activeForks.set(forkId, fork);
      this.logger.info('Fork created', { forkId, parentFork, atBlock });

      return fork;
    } catch (error) {
      this.logger.error('Failed to create fork', { error: error.message, forkId });
      throw error;
    }
  }

  async updateForkStatus(forkId, status, lastBlock = null) {
    try {
      const uid = await this.dgraph.getForkUid(forkId);
      const update = {
        uid,
        status
      };

      if (lastBlock !== null) {
        update.lastBlock = lastBlock;
      }

      if (status === 'ORPHANED') {
        update.orphanedAt = new Date().toISOString();
      }

      const txn = this.dgraph.client.newTxn();
      await txn.mutate({ setJson: update });
      await txn.commit();

      if (this.activeForks.has(forkId)) {
        this.activeForks.get(forkId).status = status;
        if (lastBlock !== null) {
          this.activeForks.get(forkId).lastBlock = lastBlock;
        }
      }

      this.logger.info('Fork status updated', { forkId, status, lastBlock });
    } catch (error) {
      this.logger.error('Failed to update fork status', { error: error.message, forkId });
      throw error;
    }
  }

  async detectFork(blockNum, blockHash, expectedHash) {
    if (blockHash !== expectedHash) {
      // Fork detected
      const forkId = `fork_${blockNum}_${blockHash.substring(0, 8)}`;
      
      // Find parent fork (the one with expectedHash)
      const parentFork = await this.findForkByBlockHash(blockNum - 1, expectedHash);
      
      await this.createFork(parentFork || this.canonicalFork, blockNum, forkId);
      
      this.logger.warn('Fork detected', { 
        blockNum, 
        blockHash, 
        expectedHash, 
        forkId 
      });

      return forkId;
    }

    return null;
  }

  async reconcileForks(consensusData) {
    const { blockNum, consensusHash, agreedNodes } = consensusData;
    
    // Find all active forks at this block height
    const query = `
      query findForks($blockNum: int) {
        forks(func: eq(status, "ACTIVE")) @filter(le(createdAtBlock, $blockNum)) {
          uid
          forkId
          createdAtBlock
          lastBlock
          operations @filter(eq(blockNum, $blockNum)) {
            blockHash
          }
        }
      }
    `;

    const res = await this.dgraph.client.newTxn().queryWithVars(query, { $blockNum: blockNum });
    const forks = res.getJson().forks || [];

    // Determine canonical fork
    let canonicalFork = null;
    const orphanedForks = [];

    for (const fork of forks) {
      if (fork.operations && fork.operations.length > 0) {
        const forkHash = fork.operations[0].blockHash;
        
        if (forkHash === consensusHash) {
          canonicalFork = fork.forkId;
        } else {
          orphanedForks.push(fork.forkId);
        }
      }
    }

    // Update canonical fork
    if (canonicalFork) {
      this.canonicalFork = canonicalFork;
      await this.updateForkStatus(canonicalFork, 'CANONICAL', blockNum);
    }

    // Orphan non-consensus forks
    for (const forkId of orphanedForks) {
      await this.orphanFork(forkId, blockNum);
    }

    this.logger.info('Fork reconciliation complete', {
      blockNum,
      canonicalFork,
      orphanedCount: orphanedForks.length
    });

    return {
      canonical: canonicalFork,
      orphaned: orphanedForks
    };
  }

  async orphanFork(forkId, atBlock) {
    // Update fork status
    await this.updateForkStatus(forkId, 'ORPHANED', atBlock);
    
    // Revert operations on this fork
    const revertResult = await this.dgraph.revertFork(forkId, atBlock);
    
    // Remove from active forks
    this.activeForks.delete(forkId);
    
    this.logger.info('Fork orphaned', { 
      forkId, 
      atBlock, 
      revertedOps: revertResult.revertedOperations 
    });
  }

  async findForkByBlockHash(blockNum, blockHash) {
    const query = `
      query findFork($blockNum: int, $blockHash: string) {
        blocks(func: eq(blockNum, $blockNum)) @filter(eq(blockHash, $blockHash)) {
          forkId
        }
      }
    `;

    const res = await this.dgraph.client.newTxn().queryWithVars(query, { 
      $blockNum: blockNum,
      $blockHash: blockHash 
    });
    
    const blocks = res.getJson().blocks || [];
    return blocks.length > 0 ? blocks[0].forkId : null;
  }

  async getActiveForks() {
    const query = `
      {
        forks(func: eq(status, "ACTIVE")) {
          forkId
          parentFork
          createdAtBlock
          lastBlock
          createdAt
        }
      }
    `;

    const res = await this.dgraph.client.newTxn().query(query);
    return res.getJson().forks || [];
  }

  getCanonicalFork() {
    return this.canonicalFork;
  }

  async pruneForks(beforeBlock) {
    // Remove old orphaned forks to save space
    const query = `
      query findOldForks($beforeBlock: int) {
        forks(func: eq(status, "ORPHANED")) @filter(lt(orphanedAt, $beforeBlock)) {
          uid
          forkId
        }
      }
    `;

    const res = await this.dgraph.client.newTxn().queryWithVars(query, { 
      $beforeBlock: beforeBlock 
    });
    
    const oldForks = res.getJson().forks || [];
    
    for (const fork of oldForks) {
      // Delete fork and associated data
      const deleteQuery = `
        {
          delete {
            <${fork.uid}> * * .
          }
        }
      `;
      
      await this.dgraph.client.newTxn().mutate({ deleteJson: deleteQuery });
      this.logger.info('Pruned old fork', { forkId: fork.forkId });
    }

    return oldForks.length;
  }
}