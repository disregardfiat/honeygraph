/**
 * Multi-Tenant DGraph Tests
 * Comprehensive test suite for multi-tenant operations
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { MultiTenantDgraphClient, AccountShardingStrategy } from '../lib/multi-tenant-dgraph-client.js';
import { SimpleDataTransformer } from '../lib/simple-data-transformer.js';
import { NetworkManager } from '../lib/network-manager.js';
import { BlockchainDataImporter } from '../scripts/import-blockchain-data.js';

describe('Multi-Tenant DGraph System', () => {
  let mtClient;
  let networkManager;
  let transformer;
  
  beforeAll(async () => {
    // Initialize multi-tenant client
    mtClient = new MultiTenantDgraphClient({
      urls: [process.env.DGRAPH_URL || 'localhost:9080'],
      shardCount: 3
    });
    
    await mtClient.initialize();
    
    // Initialize network manager
    networkManager = new NetworkManager({
      dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080'
    });
    
    await networkManager.initialize();
    
    // Initialize transformer
    transformer = new SimpleDataTransformer(mtClient.mainClient, networkManager);
  });
  
  afterAll(async () => {
    await mtClient.close();
  });
  
  describe('Network Management', () => {
    test('should register a new network', async () => {
      const networkConfig = {
        name: 'Test Network',
        description: 'Test blockchain network',
        tokens: [
          {
            symbol: 'TEST',
            name: 'Test Token',
            precision: 3,
            features: {
              transfers: true
            }
          }
        ]
      };
      
      const network = await networkManager.registerNetwork('test_', networkConfig);
      expect(network).toBeDefined();
      expect(network.prefix).toBe('test_');
      expect(network.tokens).toHaveLength(1);
    });
    
    test('should retrieve network by token', () => {
      const result = networkManager.getNetworkForToken('TEST');
      expect(result).toBeDefined();
      expect(result.prefix).toBe('test_');
    });
    
    test('should handle multiple networks', async () => {
      const networks = networkManager.getAllNetworks();
      expect(networks.length).toBeGreaterThan(0);
      expect(networks.some(n => n.prefix === 'test_')).toBe(true);
    });
  });
  
  describe('Account Sharding', () => {
    let sharding;
    
    beforeEach(() => {
      sharding = new AccountShardingStrategy(3);
    });
    
    test('should consistently shard accounts', () => {
      const account = 'alice';
      const shard1 = sharding.getAccountShard(account);
      const shard2 = sharding.getAccountShard(account);
      
      expect(shard1).toBe(shard2);
      expect(shard1).toBeGreaterThanOrEqual(0);
      expect(shard1).toBeLessThan(3);
    });
    
    test('should distribute accounts across shards', () => {
      const accounts = ['alice', 'bob', 'charlie', 'david', 'eve', 'frank'];
      const shardCounts = [0, 0, 0];
      
      for (const account of accounts) {
        const shard = sharding.getAccountShard(account);
        shardCounts[shard]++;
      }
      
      // Check that accounts are distributed (not all in one shard)
      expect(shardCounts.filter(count => count > 0).length).toBeGreaterThan(1);
    });
    
    test('should shard predicates correctly', () => {
      const predicate = 'balance.amount';
      const sharded = sharding.shardPredicate(predicate, 'alice');
      
      expect(sharded).toMatch(/^balance_s\d\.amount$/);
    });
  });
  
  describe('Data Transformation', () => {
    test('should transform transfer operation', async () => {
      const operation = {
        type: 'transfer',
        data: {
          from: 'alice',
          to: 'bob',
          amount: '1000',
          token: 'TEST',
          memo: 'Test transfer'
        },
        blockNum: 12345,
        timestamp: new Date().toISOString(),
        index: 0,
        path: 'test_transfer',
        checkpointHash: 'abc123'
      };
      
      const result = await transformer.transformOperation(operation);
      
      expect(result).toBeDefined();
      expect(result['dgraph.type']).toBe('Operation');
      expect(result['operation.type']).toBe('transfer');
      expect(result['operation.amount']).toBe('1000');
      expect(result['operation.blockNum']).toBe(12345);
    });
    
    test('should transform balance update', async () => {
      const operation = {
        type: 'balance_update',
        data: {
          account: 'alice',
          token: 'TEST',
          balance: '5000'
        },
        blockNum: 12346,
        timestamp: new Date().toISOString()
      };
      
      const result = await transformer.transformOperation(operation);
      
      expect(result).toBeDefined();
      expect(result['dgraph.type']).toBe('Balance');
      expect(result['balance.amount']).toBe('5000');
    });
    
    test('should handle batch transformations', async () => {
      const operations = [
        {
          type: 'transfer',
          data: { from: 'alice', to: 'bob', amount: '100', token: 'TEST' }
        },
        {
          type: 'transfer',
          data: { from: 'bob', to: 'charlie', amount: '50', token: 'TEST' }
        }
      ];
      
      const blockData = {
        blockNum: 12347,
        timestamp: new Date().toISOString(),
        blockHash: 'def456'
      };
      
      const results = await transformer.transformOperations(operations, blockData);
      
      expect(results).toHaveLength(2);
      expect(results[0]['operation.blockNum']).toBe(12347);
      expect(results[1]['operation.blockNum']).toBe(12347);
    });
  });
  
  describe('Namespace Isolation', () => {
    test('should create namespace-specific client', () => {
      const nsClient = mtClient.getNamespaceClient('test_');
      expect(nsClient).toBeDefined();
      expect(nsClient.namespace).toBe('test_');
    });
    
    test('should add namespace filter to queries', () => {
      const nsClient = mtClient.getNamespaceClient('test_');
      const query = '{ accounts(func: type(Account)) { account.name } }';
      const filtered = nsClient.addNamespaceFilter(query);
      
      expect(filtered).toContain('entity.namespace');
      expect(filtered).toContain('test_');
    });
    
    test('should isolate data between namespaces', async () => {
      const ns1 = mtClient.getNamespaceClient('test1_');
      const ns2 = mtClient.getNamespaceClient('test2_');
      
      // Create data in namespace 1
      await ns1.mutate({
        'dgraph.type': 'TestEntity',
        'test.value': 'namespace1'
      });
      
      // Create data in namespace 2
      await ns2.mutate({
        'dgraph.type': 'TestEntity',
        'test.value': 'namespace2'
      });
      
      // Query from namespace 1
      const result1 = await ns1.query('{ test(func: type(TestEntity)) { test.value } }');
      
      // Should only see namespace1 data
      expect(result1.test).toBeDefined();
      expect(result1.test.every(t => t['test.value'] !== 'namespace2')).toBe(true);
    });
  });
  
  describe('Data Import', () => {
    test('should import accounts correctly', async () => {
      const importer = new BlockchainDataImporter({
        dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080',
        networks: ['test_'],
        dropData: false
      });
      
      await importer.initialize();
      
      const mockState = {
        head_block: 12348,
        accounts: {
          alice: { balance: '1000' },
          bob: { balance: '2000' },
          charlie: { balance: '3000' }
        },
        balances: {
          TEST: {
            alice: '1000',
            bob: '2000',
            charlie: '3000'
          }
        }
      };
      
      await importer.importAccounts('test_', mockState);
      
      expect(importer.stats.accountsCreated).toBeGreaterThan(0);
    });
  });
  
  describe('Query Performance', () => {
    test('should handle concurrent queries', async () => {
      const queries = [];
      
      for (let i = 0; i < 10; i++) {
        queries.push(
          mtClient.query('test_', '{ accounts(func: type(Account), first: 10) { account.name } }')
        );
      }
      
      const start = Date.now();
      const results = await Promise.all(queries);
      const duration = Date.now() - start;
      
      expect(results).toHaveLength(10);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });
    
    test('should efficiently query sharded data', async () => {
      const account = 'alice';
      const shard = mtClient.getAccountShard(account);
      const shardedPredicate = mtClient.getShardedPredicate('balance.amount', account);
      
      const query = `{
        balance(func: has(${shardedPredicate})) @filter(eq(account.name, "${account}")) {
          ${shardedPredicate}
        }
      }`;
      
      const start = Date.now();
      const result = await mtClient.query('test_', query);
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(100); // Sharded query should be fast
    });
  });
  
  describe('Error Handling', () => {
    test('should handle network registration conflicts', async () => {
      await expect(
        networkManager.registerNetwork('test_', { name: 'Duplicate', tokens: [] })
      ).rejects.toThrow('already registered');
    });
    
    test('should handle invalid operations gracefully', async () => {
      const invalidOp = {
        type: 'unknown_operation',
        data: {}
      };
      
      const result = await transformer.transformOperation(invalidOp);
      expect(result).toBeDefined();
      expect(result['operation.type']).toBe('unknown_operation');
    });
    
    test('should handle connection failures', async () => {
      const badClient = new MultiTenantDgraphClient({
        urls: ['localhost:9999'] // Invalid port
      });
      
      await expect(badClient.initialize()).rejects.toThrow();
    });
  });
});

describe('Integration Tests', () => {
  test('should handle complete data flow', async () => {
    // This test simulates the complete flow from receiving blockchain data
    // to storing it in DGraph with proper multi-tenant isolation
    
    const networkPrefix = 'integration_';
    const networkManager = new NetworkManager();
    await networkManager.initialize();
    
    // 1. Register network
    await networkManager.registerNetwork(networkPrefix, {
      name: 'Integration Test Network',
      description: 'Test network for integration testing',
      tokens: [
        {
          symbol: 'INT',
          name: 'Integration Token',
          precision: 3
        }
      ]
    });
    
    // 2. Create operations
    const operations = [
      {
        type: 'account_update',
        data: { account: 'integrator', metadata: { type: 'test' } }
      },
      {
        type: 'transfer',
        data: {
          from: 'integrator',
          to: 'recipient',
          amount: '1000',
          token: 'INT',
          memo: 'Integration test transfer'
        }
      },
      {
        type: 'balance_update',
        data: { account: 'integrator', token: 'INT', balance: '9000' }
      },
      {
        type: 'balance_update',
        data: { account: 'recipient', token: 'INT', balance: '1000' }
      }
    ];
    
    // 3. Transform operations
    const transformer = new SimpleDataTransformer(null, networkManager);
    const blockData = {
      blockNum: 99999,
      timestamp: new Date().toISOString(),
      blockHash: 'integration123'
    };
    
    const transformed = await transformer.transformOperations(operations, blockData);
    
    // 4. Verify transformations
    expect(transformed).toHaveLength(4);
    expect(transformed[0]['account.updatedAt']).toBeDefined();
    expect(transformed[1]['operation.amount']).toBe('1000');
    expect(transformed[2]['balance.amount']).toBe('9000');
    expect(transformed[3]['balance.amount']).toBe('1000');
    
    // 5. Check network isolation
    const network = networkManager.getNetwork(networkPrefix);
    expect(network).toBeDefined();
    expect(network.hasToken('INT')).toBe(true);
  });
});