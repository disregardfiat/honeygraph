/**
 * Simple Data Transformer for Multi-Tenant Blockchain Data
 * Transforms raw blockchain operations into DGraph-compatible format
 */

import { createLogger } from './logger.js';

const logger = createLogger('data-transformer');

export class SimpleDataTransformer {
  constructor(dgraphClient, networkManager) {
    this.dgraph = dgraphClient;
    this.networkManager = networkManager;
    this.accountCache = new Map();
    this.tokenCache = new Map();
  }

  /**
   * Transform a single operation from blockchain format to DGraph format
   */
  async transformOperation(operation) {
    const { type, data, blockNum, timestamp, index, path, token } = operation;
    
    // Extract network prefix from path or token
    const network = this.extractNetwork(path, token);
    
    switch (type) {
      case 'transfer':
        return await this.transformTransfer(operation, network);
      
      case 'balance_update':
        return await this.transformBalanceUpdate(operation, network);
      
      case 'account_update':
        return await this.transformAccountUpdate(operation, network);
      
      case 'contract_deploy':
        return await this.transformContractDeploy(operation, network);
      
      case 'state_update':
        return await this.transformStateUpdate(operation, network);
      
      default:
        logger.warn(`Unknown operation type: ${type}`);
        return this.transformGenericOperation(operation, network);
    }
  }

  /**
   * Transform multiple operations in a batch
   */
  async transformOperations(operations, blockData) {
    const transformed = [];
    
    for (const op of operations) {
      try {
        const result = await this.transformOperation({
          ...op,
          blockNum: blockData.blockNum,
          timestamp: blockData.timestamp,
          checkpointHash: blockData.blockHash
        });
        
        if (result) {
          transformed.push(result);
        }
      } catch (error) {
        logger.error(`Failed to transform operation: ${error.message}`, op);
      }
    }
    
    return transformed;
  }

  /**
   * Extract network prefix from path or token
   */
  extractNetwork(path, token) {
    if (path) {
      // Path format: "spkccT_account:balance"
      const match = path.match(/^([a-zA-Z0-9_-]+_)/);
      if (match) return match[1];
    }
    
    if (token) {
      // Try to find network by token
      const networkInfo = this.networkManager?.getNetworkForToken(token);
      if (networkInfo) return networkInfo.prefix;
    }
    
    // Default fallback
    return 'unknown_';
  }

  /**
   * Transform transfer operation
   */
  async transformTransfer(operation, network) {
    const { data, blockNum, timestamp, index, checkpointHash } = operation;
    const { from, to, amount, token, memo } = data;
    
    // Ensure accounts exist
    const fromUid = await this.ensureAccount(from, network);
    const toUid = await this.ensureAccount(to, network);
    const tokenUid = await this.ensureToken(token, network);
    
    return {
      uid: `_:op_${blockNum}_${index}`,
      'dgraph.type': 'Operation',
      'operation.network': await this.getNetworkUid(network),
      'operation.blockNum': blockNum,
      'operation.index': index,
      'operation.type': 'transfer',
      'operation.timestamp': timestamp,
      'operation.from': { uid: fromUid },
      'operation.to': { uid: toUid },
      'operation.token': { uid: tokenUid },
      'operation.amount': amount.toString(),
      'operation.memo': memo || '',
      'operation.checkpointHash': checkpointHash,
      'operation.status': 'completed'
    };
  }

  /**
   * Transform balance update operation
   */
  async transformBalanceUpdate(operation, network) {
    const { data, blockNum, timestamp } = operation;
    const { account, token, balance } = data;
    
    const accountUid = await this.ensureAccount(account, network);
    const tokenUid = await this.ensureToken(token, network);
    const networkAccountUid = await this.ensureNetworkAccount(account, network);
    
    return {
      uid: `_:balance_${network}${token}_${account}`,
      'dgraph.type': 'Balance',
      'balance.networkAccount': { uid: networkAccountUid },
      'balance.token': { uid: tokenUid },
      'balance.amount': balance.toString(),
      'balance.blockNum': blockNum,
      'balance.timestamp': timestamp
    };
  }

  /**
   * Transform account update operation
   */
  async transformAccountUpdate(operation, network) {
    const { data, blockNum, timestamp } = operation;
    const { account, metadata } = data;
    
    const accountUid = await this.ensureAccount(account, network);
    
    return {
      uid: accountUid,
      'account.updatedAt': timestamp,
      'account.metadata': JSON.stringify(metadata || {})
    };
  }

  /**
   * Transform contract deployment
   */
  async transformContractDeploy(operation, network) {
    const { data, blockNum, timestamp } = operation;
    const { account, code, abi } = data;
    
    const accountUid = await this.ensureAccount(account, network);
    const networkUid = await this.getNetworkUid(network);
    
    // Mark account as contract
    await this.markAccountAsContract(accountUid);
    
    return {
      uid: `_:contract_${network}${account}`,
      'dgraph.type': 'Contract',
      'contract.network': { uid: networkUid },
      'contract.account': { uid: accountUid },
      'contract.code': code,
      'contract.abi': JSON.stringify(abi || {}),
      'contract.deployedAt': timestamp,
      'contract.lastUpdated': timestamp,
      'contract.isActive': true
    };
  }

  /**
   * Transform state update
   */
  async transformStateUpdate(operation, network) {
    const { data, blockNum, timestamp } = operation;
    const { contract, key, value } = data;
    
    const contractUid = await this.getContractUid(contract, network);
    const networkUid = await this.getNetworkUid(network);
    
    return {
      uid: `_:state_${network}${contract}_${key}`,
      'dgraph.type': 'State',
      'state.network': { uid: networkUid },
      'state.contract': { uid: contractUid },
      'state.key': key,
      'state.value': JSON.stringify(value),
      'state.blockNum': blockNum,
      'state.timestamp': timestamp
    };
  }

  /**
   * Transform generic operation
   */
  transformGenericOperation(operation, network) {
    const { type, data, blockNum, timestamp, index, checkpointHash } = operation;
    
    return {
      uid: `_:op_${blockNum}_${index}`,
      'dgraph.type': 'Operation',
      'operation.network': this.getNetworkUid(network),
      'operation.blockNum': blockNum,
      'operation.index': index,
      'operation.type': type,
      'operation.timestamp': timestamp,
      'operation.metadata': JSON.stringify(data),
      'operation.checkpointHash': checkpointHash,
      'operation.status': 'completed'
    };
  }

  /**
   * Ensure account exists and return UID
   */
  async ensureAccount(accountName, network) {
    const cacheKey = `account:${accountName}`;
    
    if (this.accountCache.has(cacheKey)) {
      return this.accountCache.get(cacheKey);
    }
    
    // Query for existing account
    const query = `{
      account(func: eq(account.name, "${accountName}")) {
        uid
      }
    }`;
    
    const response = await this.dgraph.query(query);
    const result = response.getJson();
    
    if (result.account && result.account.length > 0) {
      const uid = result.account[0].uid;
      this.accountCache.set(cacheKey, uid);
      return uid;
    }
    
    // Account doesn't exist, create it
    const uid = `_:account_${accountName}`;
    this.accountCache.set(cacheKey, uid);
    
    // The actual creation will happen when the mutation is applied
    return uid;
  }

  /**
   * Ensure network account association exists
   */
  async ensureNetworkAccount(accountName, network) {
    const cacheKey = `na:${network}${accountName}`;
    
    if (this.accountCache.has(cacheKey)) {
      return this.accountCache.get(cacheKey);
    }
    
    const uid = `_:na_${network}${accountName}`;
    this.accountCache.set(cacheKey, uid);
    return uid;
  }

  /**
   * Ensure token exists and return UID
   */
  async ensureToken(tokenSymbol, network) {
    const cacheKey = `token:${network}${tokenSymbol}`;
    
    if (this.tokenCache.has(cacheKey)) {
      return this.tokenCache.get(cacheKey);
    }
    
    // Query for existing token
    const query = `{
      token(func: eq(token.symbol, "${tokenSymbol}")) @filter(eq(token.network, "${network}")) {
        uid
      }
    }`;
    
    const response = await this.dgraph.query(query);
    const result = response.getJson();
    
    if (result.token && result.token.length > 0) {
      const uid = result.token[0].uid;
      this.tokenCache.set(cacheKey, uid);
      return uid;
    }
    
    // Token doesn't exist, create placeholder
    const uid = `_:token_${network}${tokenSymbol}`;
    this.tokenCache.set(cacheKey, uid);
    return uid;
  }

  /**
   * Get network UID
   */
  async getNetworkUid(networkPrefix) {
    const cacheKey = `network:${networkPrefix}`;
    
    if (this.accountCache.has(cacheKey)) {
      return this.accountCache.get(cacheKey);
    }
    
    // Query for network
    const query = `{
      network(func: eq(network.prefix, "${networkPrefix}")) {
        uid
      }
    }`;
    
    const response = await this.dgraph.query(query);
    const result = response.getJson();
    
    if (result.network && result.network.length > 0) {
      const uid = result.network[0].uid;
      this.accountCache.set(cacheKey, uid);
      return { uid };
    }
    
    // Network should exist from initialization
    logger.error(`Network not found: ${networkPrefix}`);
    return { uid: `_:network_${networkPrefix}` };
  }

  /**
   * Get contract UID
   */
  async getContractUid(accountName, network) {
    const cacheKey = `contract:${network}${accountName}`;
    
    if (this.accountCache.has(cacheKey)) {
      return this.accountCache.get(cacheKey);
    }
    
    const uid = `_:contract_${network}${accountName}`;
    this.accountCache.set(cacheKey, uid);
    return uid;
  }

  /**
   * Mark account as contract
   */
  async markAccountAsContract(accountUid) {
    // This will be applied in the batch mutation
    return {
      uid: accountUid,
      'account.isContract': true
    };
  }

  /**
   * Clear caches (useful for long-running processes)
   */
  clearCaches() {
    this.accountCache.clear();
    this.tokenCache.clear();
  }
}

/**
 * Factory function to create data transformer
 */
export function createDataTransformer(dgraphClient, networkManager) {
  return new SimpleDataTransformer(dgraphClient, networkManager);
}