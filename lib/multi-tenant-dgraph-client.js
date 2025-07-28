/**
 * Multi-Tenant DGraph Client
 * Provides namespace isolation and sharding for multi-tenant blockchain data
 */

import dgraph from 'dgraph-js';
import grpc from '@grpc/grpc-js';
import crypto from 'crypto';
import { createLogger } from './logger.js';

const logger = createLogger('multi-tenant-dgraph');

export class MultiTenantDgraphClient {
  constructor(config = {}) {
    this.config = {
      urls: config.urls || ['localhost:9080'],
      shardCount: config.shardCount || 3,
      namespacePrefix: config.namespacePrefix || 'ns_',
      ...config
    };
    
    this.clients = new Map();
    this.stubs = [];
    this.shardMap = new Map();
  }

  async initialize() {
    // Create gRPC stubs for each DGraph instance
    for (const url of this.config.urls) {
      const stub = new dgraph.DgraphClientStub(
        url,
        grpc.credentials.createInsecure()
      );
      this.stubs.push(stub);
    }
    
    // Create main client with all stubs
    this.mainClient = new dgraph.DgraphClient(...this.stubs);
    
    // Test connection
    const version = await this.mainClient.checkVersion();
    logger.info('Connected to DGraph cluster', { version });
  }

  /**
   * Get or create a namespace-specific client
   */
  getNamespaceClient(namespace) {
    if (this.clients.has(namespace)) {
      return this.clients.get(namespace);
    }
    
    // Create namespace client with same stubs
    const client = new NamespaceClient(this.mainClient, namespace);
    this.clients.set(namespace, client);
    
    return client;
  }

  /**
   * Determine shard for an account
   */
  getAccountShard(accountName) {
    const hash = crypto.createHash('sha256').update(accountName).digest();
    const shardIndex = hash.readUInt32BE(0) % this.config.shardCount;
    return shardIndex;
  }

  /**
   * Get shard-specific predicate name
   */
  getShardedPredicate(basePredicate, accountName) {
    const shard = this.getAccountShard(accountName);
    return `${basePredicate}_s${shard}`;
  }

  /**
   * Apply multi-tenant schema
   */
  async applyMultiTenantSchema(schema) {
    // Add namespace predicates to schema
    const namespacedSchema = this.addNamespacePredicates(schema);
    
    // Add sharding predicates
    const shardedSchema = this.addShardingPredicates(namespacedSchema);
    
    const op = new dgraph.Operation();
    op.setSchema(shardedSchema);
    await this.mainClient.alter(op);
    
    logger.info('Multi-tenant schema applied');
  }

  /**
   * Add namespace isolation predicates
   */
  addNamespacePredicates(schema) {
    const namespacePredicates = `
# Namespace isolation
namespace.id: string @index(exact) .
namespace.created: datetime @index(hour) .
namespace.active: bool @index(bool) .

type Namespace {
  namespace.id
  namespace.created
  namespace.active
}

# All entities must have namespace
entity.namespace: uid @reverse .
`;
    
    return namespacePredicates + '\n' + schema;
  }

  /**
   * Add sharding predicates
   */
  addShardingPredicates(schema) {
    const shardingPredicates = [];
    
    // Create sharded versions of account-related predicates
    const accountPredicates = [
      'balance.amount',
      'operation.from',
      'operation.to',
      'networkAccount.account'
    ];
    
    for (let i = 0; i < this.config.shardCount; i++) {
      for (const predicate of accountPredicates) {
        const [prefix, suffix] = predicate.split('.');
        shardingPredicates.push(`${prefix}_s${i}.${suffix}: ${this.getPredicateType(predicate)} .`);
      }
    }
    
    return schema + '\n# Sharded predicates\n' + shardingPredicates.join('\n');
  }

  /**
   * Get predicate type from schema
   */
  getPredicateType(predicate) {
    // This would parse the schema to get the correct type
    // For now, return sensible defaults
    if (predicate.includes('amount')) return 'string @index(exact)';
    if (predicate.includes('from') || predicate.includes('to')) return 'uid @reverse';
    if (predicate.includes('account')) return 'uid @reverse';
    return 'string';
  }

  /**
   * Execute a multi-tenant query
   */
  async query(namespace, query, vars = {}) {
    const namespacedQuery = this.addNamespaceFilter(query, namespace);
    const txn = this.mainClient.newTxn({ readOnly: true });
    
    try {
      const response = await txn.queryWithVars(namespacedQuery, vars);
      return response.getJson();
    } finally {
      await txn.discard();
    }
  }

  /**
   * Execute a multi-tenant mutation
   */
  async mutate(namespace, mutations) {
    const txn = this.mainClient.newTxn();
    
    try {
      // Add namespace to all mutations
      const namespacedMutations = this.addNamespaceToMutations(mutations, namespace);
      
      for (const mutation of namespacedMutations) {
        const dgraphMutation = new dgraph.Mutation();
        dgraphMutation.setSetJson(mutation);
        await txn.mutate(dgraphMutation);
      }
      
      await txn.commit();
    } catch (error) {
      await txn.discard();
      throw error;
    }
  }

  /**
   * Add namespace filter to query
   */
  addNamespaceFilter(query, namespace) {
    // This is a simplified version - a real implementation would parse the GraphQL
    return query.replace(/func: ([^)]+)\)/, `func: $1) @filter(eq(entity.namespace, "${namespace}"))`);
  }

  /**
   * Add namespace to mutations
   */
  addNamespaceToMutations(mutations, namespace) {
    return mutations.map(mutation => ({
      ...mutation,
      'entity.namespace': { uid: `namespace:${namespace}` }
    }));
  }

  /**
   * Close all connections
   */
  async close() {
    for (const stub of this.stubs) {
      stub.close();
    }
    logger.info('Closed all DGraph connections');
  }
}

/**
 * Namespace-specific client wrapper
 */
class NamespaceClient {
  constructor(dgraphClient, namespace) {
    this.client = dgraphClient;
    this.namespace = namespace;
  }

  async query(query, vars = {}) {
    // Add namespace filter
    const namespacedQuery = this.addNamespaceFilter(query);
    const txn = this.client.newTxn({ readOnly: true });
    
    try {
      const response = await txn.queryWithVars(namespacedQuery, vars);
      return response.getJson();
    } finally {
      await txn.discard();
    }
  }

  async mutate(data) {
    const txn = this.client.newTxn();
    
    try {
      // Add namespace to data
      const namespacedData = {
        ...data,
        'entity.namespace': `namespace:${this.namespace}`
      };
      
      const mutation = new dgraph.Mutation();
      mutation.setSetJson(namespacedData);
      await txn.mutate(mutation);
      await txn.commit();
    } catch (error) {
      await txn.discard();
      throw error;
    }
  }

  addNamespaceFilter(query) {
    // Add namespace filtering to all queries
    if (query.includes('@filter')) {
      return query.replace(/@filter\(([^)]+)\)/, `@filter($1 AND eq(entity.namespace, "namespace:${this.namespace}"))`);
    } else {
      return query.replace(/\{/, `@filter(eq(entity.namespace, "namespace:${this.namespace}")) {`);
    }
  }
}

/**
 * Account sharding strategy
 */
export class AccountShardingStrategy {
  constructor(shardCount = 3) {
    this.shardCount = shardCount;
  }

  /**
   * Get shard for account using consistent hashing
   */
  getAccountShard(accountName) {
    const hash = crypto.createHash('sha256').update(accountName).digest();
    return hash.readUInt32BE(0) % this.shardCount;
  }

  /**
   * Get all shards (for queries that need to check all shards)
   */
  getAllShards() {
    return Array.from({ length: this.shardCount }, (_, i) => i);
  }

  /**
   * Shard a predicate path
   */
  shardPredicate(predicate, accountName) {
    const shard = this.getAccountShard(accountName);
    const parts = predicate.split('.');
    parts[0] = `${parts[0]}_s${shard}`;
    return parts.join('.');
  }

  /**
   * Create a sharded query
   */
  createShardedQuery(baseQuery, accountName) {
    const shard = this.getAccountShard(accountName);
    return baseQuery.replace(/(\w+)\./g, (match, predicate) => {
      if (this.isShardedPredicate(predicate)) {
        return `${predicate}_s${shard}.`;
      }
      return match;
    });
  }

  /**
   * Check if predicate should be sharded
   */
  isShardedPredicate(predicate) {
    const shardedPredicates = ['balance', 'operation', 'networkAccount'];
    return shardedPredicates.includes(predicate);
  }
}

/**
 * Factory function
 */
export function createMultiTenantDgraphClient(config) {
  return new MultiTenantDgraphClient(config);
}