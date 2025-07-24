import dgraph from 'dgraph-js';
import grpc from '@grpc/grpc-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Factory function for convenience
export function createDgraphClient(options = {}) {
  const defaults = {
    url: process.env.DGRAPH_URL || 'http://localhost:9080',
    logger: console,
    namespace: options.namespace || 'default'
  };
  return new DgraphClient({ ...defaults, ...options });
}

export class DgraphClient {
  constructor({ url, logger, namespace }) {
    this.url = url;
    this.logger = logger;
    this.namespace = namespace || 'default'; // Token namespace for data isolation
    this.client = null;
    this.connected = false;
    this.connect();
  }

  connect() {
    try {
      // Remove http:// or https:// prefix for gRPC connection
      const grpcUrl = this.url.replace(/^https?:\/\//, '');
      
      // Create gRPC options with increased message size limits
      const grpcOptions = {
        'grpc.max_receive_message_length': 50 * 1024 * 1024, // 50MB
        'grpc.max_send_message_length': 50 * 1024 * 1024     // 50MB
      };
      
      const clientStub = new dgraph.DgraphClientStub(
        grpcUrl,
        grpc.credentials.createInsecure(),
        grpcOptions
      );
      this.client = new dgraph.DgraphClient(clientStub);
      this.clientStub = clientStub;
      
      this.connected = true;
      this.logger.info('Connected to Dgraph', { url: this.url, namespace: this.namespace });
    } catch (error) {
      this.logger.error('Failed to connect to Dgraph', { error: error.message });
      throw error;
    }
  }

  // Expose transaction method
  newTxn() {
    if (!this.client) {
      throw new Error('Dgraph client not connected');
    }
    return this.client.newTxn();
  }

  // Add namespace prefix to UIDs and data
  addNamespacePrefix(data) {
    if (!this.namespace || this.namespace === 'default') {
      return data;
    }
    
    if (Array.isArray(data)) {
      return data.map(item => this.addNamespacePrefix(item));
    }
    
    if (typeof data === 'object' && data !== null) {
      const prefixed = {};
      
      // Check if this is an Account or Path type - both should be global
      const isAccount = data['dgraph.type'] === 'Account';
      const isPath = data['dgraph.type'] === 'Path';
      
      for (const [key, value] of Object.entries(data)) {
        if (key === 'uid' && typeof value === 'string' && value.startsWith('_:')) {
          // Don't prefix Account or Path UIDs
          if (isAccount || isPath) {
            prefixed[key] = value;
          } else {
            // Prefix temporary UIDs for other types
            prefixed[key] = `_:${this.namespace}${value.substring(2)}`;
          }
        } else if ((key === 'id' || key === 'username') && typeof value === 'string' && !value.startsWith(this.namespace)) {
          // Don't prefix usernames for Account type, and don't prefix Path IDs
          if ((isAccount && key === 'username') || (isPath && (key === 'id' || key === 'fullPath'))) {
            prefixed[key] = value;
          } else {
            // Prefix IDs and usernames with namespace for other types
            prefixed[key] = `${this.namespace}${value}`;
          }
        } else {
          prefixed[key] = this.addNamespacePrefix(value);
        }
      }
      return prefixed;
    }
    
    return data;
  }

  // Query with namespace context
  async query(query, variables = {}) {
    const txn = this.client.newTxn();
    try {
      // Add namespace prefix to query variables if needed
      const namespacedVars = this.addNamespacePrefixToVariables(variables);
      const result = await txn.queryWithVars(query, namespacedVars);
      return result.getJson();
    } finally {
      await txn.discard();
    }
  }

  // Add namespace prefix to query variables
  addNamespacePrefixToVariables(variables) {
    if (!this.namespace || this.namespace === 'default') {
      return variables;
    }
    
    const prefixed = {};
    for (const [key, value] of Object.entries(variables)) {
      // Don't prefix username variables - accounts are global
      prefixed[key] = value;
    }
    return prefixed;
  }

  async initializeSchema() {
    const schema = readFileSync(join(__dirname, '../schema/schema.dgraph'), 'utf8');
    return this.setSchema(schema);
  }
  
  async setSchema(schema) {
    const op = new dgraph.Operation();
    op.setSchema(schema);
    
    try {
      await this.client.alter(op);
      this.logger.info('Schema initialized successfully', { 
        namespace: this.namespace || 'default' 
      });
    } catch (error) {
      this.logger.error('Failed to initialize schema', { 
        error: error.message,
        namespace: this.namespace 
      });
      throw error;
    }
  }

  async health() {
    const query = `{ 
      health(func: has(dgraph.type)) @filter(eq(dgraph.type, "Fork")) { 
        count(uid) 
      } 
    }`;
    try {
      const res = await this.client.newTxn().query(query);
      return { status: 'healthy', data: res.getJson() };
    } catch (error) {
      return { status: 'unhealthy', error: error.message };
    }
  }

  // Write operations with fork awareness
  async writeOperation(operation) {
    const txn = this.client.newTxn();
    try {
      // If operation is an array of mutations from data transformer
      if (Array.isArray(operation)) {
        const namespacedOperation = this.addNamespacePrefix(operation);
        const mutation = new dgraph.Mutation();
        mutation.setSetJson(namespacedOperation);
        await txn.mutate(mutation);
      } else {
        // Single operation
        const namespacedOperation = this.addNamespacePrefix(operation);
        const mutation = this.createOperationMutation(namespacedOperation);
        await txn.mutate(mutation);
      }
      await txn.commit();
      return { success: true };
    } catch (error) {
      await txn.discard();
      this.logger.error('Write operation failed', { error: error.message, operation });
      throw error;
    }
  }

  // Batch write for efficiency
  async writeBatch(operations, blockInfo) {
    const txn = this.client.newTxn();
    try {
      // Create block node with namespace prefix
      const blockMutation = {
        uid: '_:block',
        'dgraph.type': 'Block',
        blockNum: blockInfo.blockNum,
        blockHash: blockInfo.blockHash,
        previousHash: blockInfo.previousHash,
        timestamp: new Date().toISOString(),
        forkId: blockInfo.forkId,
        isFinalized: blockInfo.blockNum <= blockInfo.lib,
        namespace: this.namespace || 'default'
      };

      // Create operation nodes
      const operationMutations = operations.map((op, index) => ({
        uid: `_:op${index}`,
        'dgraph.type': 'Operation',
        block: { uid: '_:block' },
        blockNum: blockInfo.blockNum,
        index,
        type: op.type.toUpperCase(),
        path: op.path.join('/'),
        data: JSON.stringify(op.data),
        forkId: blockInfo.forkId,
        isFinalized: blockInfo.blockNum <= blockInfo.lib,
        timestamp: new Date().toISOString()
      }));

      // Update state nodes
      const stateMutations = await this.createStateMutations(operations, blockInfo);

      const mutation = new dgraph.Mutation();
      mutation.setSetJson({
        block: blockMutation,
        operations: operationMutations,
        states: stateMutations
      });

      await txn.mutate(mutation);
      await txn.commit();

      this.logger.debug('Batch written successfully', { 
        blockNum: blockInfo.blockNum,
        operationCount: operations.length 
      });

      return { success: true, blockNum: blockInfo.blockNum };
    } catch (error) {
      await txn.discard();
      this.logger.error('Batch write failed', { error: error.message, blockInfo });
      throw error;
    }
  }

  // Query operations by path
  async queryByPath(path, options = {}) {
    const { fork = null, beforeBlock = null, includeHistory = false } = options;
    
    let query = `
      query getPath($path: string, $fork: string, $beforeBlock: int) {
        states(func: eq(path, $path)) @filter(${this.buildFilter(fork, beforeBlock)}) {
          uid
          path
          value
          lastUpdate
          forkId
          isDeleted
          ${includeHistory ? `
          history {
            blockNum
            value
            timestamp
          }` : ''}
        }
      }
    `;

    const vars = { 
      $path: path,
      $fork: fork,
      $beforeBlock: beforeBlock
    };

    const res = await this.client.newTxn().queryWithVars(query, vars);
    return res.getJson();
  }

  // Get operations for a specific fork
  async getForkOperations(forkId, fromBlock, toBlock) {
    const query = `
      query getForkOps($forkId: string, $fromBlock: int, $toBlock: int) {
        operations(func: eq(forkId, $forkId)) 
          @filter(ge(blockNum, $fromBlock) AND le(blockNum, $toBlock)) 
          @order(asc: blockNum, asc: index) {
          uid
          blockNum
          index
          type
          path
          data
          previousValue
          timestamp
        }
      }
    `;

    const vars = {
      $forkId: forkId,
      $fromBlock: fromBlock,
      $toBlock: toBlock
    };

    const res = await this.client.newTxn().queryWithVars(query, vars);
    return res.getJson().operations || [];
  }

  // Mark fork as orphaned and revert operations
  async revertFork(forkId, toBlock) {
    const txn = this.client.newTxn();
    try {
      // Get all operations to revert
      const operations = await this.getForkOperations(forkId, toBlock, Number.MAX_SAFE_INTEGER);
      
      // Mark fork as orphaned
      const forkUpdate = {
        uid: await this.getForkUid(forkId),
        status: 'ORPHANED',
        orphanedAt: new Date().toISOString()
      };

      // Mark operations as reverted
      const operationUpdates = operations.map(op => ({
        uid: op.uid,
        reverted: true
      }));

      const mutation = new dgraph.Mutation();
      mutation.setSetJson({
        fork: forkUpdate,
        operations: operationUpdates
      });

      await txn.mutate(mutation);
      await txn.commit();

      this.logger.info('Fork reverted', { forkId, operationCount: operations.length });
      return { success: true, revertedOperations: operations.length };
    } catch (error) {
      await txn.discard();
      this.logger.error('Fork reversion failed', { error: error.message, forkId });
      throw error;
    }
  }

  // Create checkpoint
  async createCheckpoint(checkpointData) {
    const txn = this.client.newTxn();
    try {
      const checkpoint = {
        uid: '_:checkpoint',
        'dgraph.type': 'Checkpoint',
        ...checkpointData,
        timestamp: new Date().toISOString(),
        validated: true
      };

      const mutation = new dgraph.Mutation();
      mutation.setSetJson(checkpoint);

      await txn.mutate(mutation);
      await txn.commit();

      this.logger.info('Checkpoint created', { blockNum: checkpointData.blockNum });
      return { success: true };
    } catch (error) {
      await txn.discard();
      this.logger.error('Checkpoint creation failed', { error: error.message });
      throw error;
    }
  }

  // Helper methods
  createOperationMutation(operation) {
    const mutation = new dgraph.Mutation();
    mutation.setSetJson({
      uid: '_:op',
      'dgraph.type': 'Operation',
      ...operation,
      timestamp: new Date().toISOString()
    });
    return mutation;
  }

  async createStateMutations(operations, blockInfo) {
    const stateMutations = [];
    
    for (const op of operations) {
      const pathStr = op.path.join('/');
      const stateUid = await this.getOrCreateStateUid(pathStr);
      
      if (op.type === 'put') {
        stateMutations.push({
          uid: stateUid,
          'dgraph.type': 'StateNode',
          path: pathStr,
          value: JSON.stringify(op.data),
          lastUpdate: blockInfo.blockNum,
          forkId: blockInfo.forkId,
          isDeleted: false
        });
      } else if (op.type === 'del') {
        stateMutations.push({
          uid: stateUid,
          isDeleted: true,
          lastUpdate: blockInfo.blockNum
        });
      }
    }
    
    return stateMutations;
  }

  async getOrCreateStateUid(path) {
    const query = `{ state(func: eq(path, "${path}")) { uid } }`;
    const res = await this.client.newTxn().query(query);
    const data = res.getJson();
    
    if (data.state && data.state.length > 0) {
      return data.state[0].uid;
    }
    
    return '_:state_' + path.replace(/\//g, '_');
  }

  async getForkUid(forkId) {
    const query = `{ fork(func: eq(forkId, "${forkId}")) { uid } }`;
    const res = await this.client.newTxn().query(query);
    const data = res.getJson();
    
    if (data.fork && data.fork.length > 0) {
      return data.fork[0].uid;
    }
    
    throw new Error(`Fork ${forkId} not found`);
  }

  buildFilter(fork, beforeBlock) {
    const filters = [];
    if (fork) filters.push(`eq(forkId, $fork)`);
    if (beforeBlock) filters.push(`le(lastUpdate, $beforeBlock)`);
    return filters.join(' AND ') || 'true';
  }

  async close() {
    this.connected = false;
    this.logger.info('Dgraph client closed');
  }
}