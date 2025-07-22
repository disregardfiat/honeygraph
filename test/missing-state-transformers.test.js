import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { DataTransformer } from '../lib/data-transformer.js';

describe('Missing State Transformers', () => {
  let transformer;
  let mockDgraphClient;
  let mutations;

  beforeEach(() => {
    mockDgraphClient = {
      query: jest.fn().mockResolvedValue({ account: [] })
    };
    transformer = new DataTransformer(mockDgraphClient);
    mutations = {
      accounts: new Map(),
      contracts: new Map(),
      files: new Map(),
      paths: new Map(),
      transactions: [],
      orders: new Map(),
      dexMarkets: new Map(),
      ohlc: [],
      other: []
    };
  });

  describe('priceFeeds transformer', () => {
    it('should transform price feed data', async () => {
      const op = {
        type: 'put',
        path: ['priceFeeds', 'hive', 'usd'],
        data: {
          price: 0.34,
          volume: 125000,
          timestamp: 1704067200,
          source: 'coingecko'
        }
      };

      await transformer.transformOperationInternal(op, {}, mutations);

      expect(mutations.other).toHaveLength(1);
      const priceFeed = mutations.other[0];
      expect(priceFeed['dgraph.type']).toBe('PriceFeed');
      expect(priceFeed.baseCurrency).toBe('hive');
      expect(priceFeed.quoteCurrency).toBe('usd');
      expect(priceFeed.price).toBe(0.34);
      expect(priceFeed.volume).toBe(125000);
      expect(priceFeed.source).toBe('coingecko');
    });

    it('should handle simple price value format', async () => {
      const op = {
        type: 'put',
        path: ['priceFeeds', 'spk', 'hive'],
        data: 0.001234
      };

      await transformer.transformOperationInternal(op, {}, mutations);

      expect(mutations.other).toHaveLength(1);
      const priceFeed = mutations.other[0];
      expect(priceFeed.price).toBe(0.001234);
      expect(priceFeed.baseCurrency).toBe('spk');
      expect(priceFeed.quoteCurrency).toBe('hive');
    });
  });

  describe('runners transformer', () => {
    it('should transform runner node data', async () => {
      const op = {
        type: 'put',
        path: ['runners', 'validator-node-1'],
        data: {
          api: 'https://api.node1.com',
          location: 'US-East',
          version: '1.2.3',
          lastSeen: 1704067200,
          services: ['ipfs', 'validator', 'api'],
          performance: {
            uptime: 99.9,
            latency: 23,
            successRate: 98.5
          }
        }
      };

      await transformer.transformOperationInternal(op, {}, mutations);

      expect(mutations.accounts.has('validator-node-1')).toBe(true);
      const accountData = mutations.accounts.get('validator-node-1');
      expect(accountData.runnerNode).toBeDefined();
      expect(accountData.runnerNode.api).toBe('https://api.node1.com');
      expect(accountData.runnerNode.location).toBe('US-East');
      expect(accountData.runnerNode.version).toBe('1.2.3');
      expect(accountData.runnerNode.uptime).toBe(99.9);
    });

    it('should handle simple runner registration', async () => {
      const op = {
        type: 'put',
        path: ['runners', 'simple-runner'],
        data: 'https://simple.runner.com'
      };

      await transformer.transformOperationInternal(op, {}, mutations);

      const accountData = mutations.accounts.get('simple-runner');
      expect(accountData.runnerNode).toBeDefined();
      expect(accountData.runnerNode.api).toBe('https://simple.runner.com');
    });
  });

  describe('spow transformer', () => {
    it('should transform SPK power data', async () => {
      const op = {
        type: 'put',
        path: ['spow', 'alice'],
        data: 150000
      };

      await transformer.transformOperationInternal(op, {}, mutations);

      expect(mutations.accounts.has('alice')).toBe(true);
      const accountData = mutations.accounts.get('alice');
      expect(accountData.spkPower).toBe(150000);
    });

    it('should handle complex spow data with delegation info', async () => {
      const op = {
        type: 'put',
        path: ['spow', 'bob'],
        data: {
          total: 250000,
          self: 100000,
          delegated: 150000,
          delegators: ['alice', 'charlie']
        }
      };

      await transformer.transformOperationInternal(op, {}, mutations);

      const accountData = mutations.accounts.get('bob');
      expect(accountData.spkPower).toBe(250000);
      expect(accountData.spkPowerSelf).toBe(100000);
      expect(accountData.spkPowerDelegated).toBe(150000);
    });
  });

  describe('ubroca transformer', () => {
    it('should transform unclaimed BROCA data', async () => {
      const op = {
        type: 'put',
        path: ['ubroca', 'alice'],
        data: 75000
      };

      await transformer.transformOperationInternal(op, {}, mutations);

      expect(mutations.accounts.has('alice')).toBe(true);
      const accountData = mutations.accounts.get('alice');
      expect(accountData.unclaimedBroca).toBe(75000);
    });

    it('should handle ubroca with expiration data', async () => {
      const op = {
        type: 'put',
        path: ['ubroca', 'bob'],
        data: {
          amount: 100000,
          expiresBlock: 98765432,
          source: 'mining_rewards'
        }
      };

      await transformer.transformOperationInternal(op, {}, mutations);

      const accountData = mutations.accounts.get('bob');
      expect(accountData.unclaimedBroca).toBe(100000);
      expect(accountData.unclaimedBrocaExpires).toBe(98765432);
    });
  });

  describe('chain transformer', () => {
    it('should transform chain state data', async () => {
      const op = {
        type: 'put',
        path: ['chain', 'head_block'],
        data: 98765432
      };

      await transformer.transformOperationInternal(op, {}, mutations);

      expect(mutations.other).toHaveLength(1);
      const chainData = mutations.other[0];
      expect(chainData['dgraph.type']).toBe('ChainState');
      expect(chainData.key).toBe('head_block');
      expect(chainData.value).toBe(98765432);
    });

    it('should handle complex chain configuration', async () => {
      const op = {
        type: 'put',
        path: ['chain', 'config'],
        data: {
          prefix: 'SPK',
          precision: 3,
          multisig: ['alice', 'bob', 'charlie'],
          fees: {
            transfer: 1,
            contract: 100,
            market: 10
          }
        }
      };

      await transformer.transformOperationInternal(op, {}, mutations);

      const chainData = mutations.other[0];
      expect(chainData['dgraph.type']).toBe('ChainState');
      expect(chainData.key).toBe('config');
      expect(JSON.parse(chainData.value)).toHaveProperty('multisig');
    });
  });

  describe('chrono transformer', () => {
    it('should transform scheduled operation data', async () => {
      const op = {
        type: 'put',
        path: ['chrono', '98765432', 'expire_contract_alice_0_98765432-abc123'],
        data: {
          operation: 'expire_contract',
          target: 'alice:0:98765432-abc123',
          scheduled_block: 98765432
        }
      };

      await transformer.transformOperationInternal(op, {}, mutations);

      expect(mutations.other).toHaveLength(1);
      const chronoOp = mutations.other[0];
      expect(chronoOp['dgraph.type']).toBe('ScheduledOperation');
      expect(chronoOp.scheduledBlock).toBe(98765432);
      expect(chronoOp.operationType).toBe('expire_contract');
      expect(chronoOp.target).toBe('alice:0:98765432-abc123');
    });

    it('should handle simple chrono entries', async () => {
      const op = {
        type: 'put',
        path: ['chrono', '98765433', 'process_auction'],
        data: 'auction:12345'
      };

      await transformer.transformOperationInternal(op, {}, mutations);

      const chronoOp = mutations.other[0];
      expect(chronoOp.scheduledBlock).toBe(98765433);
      expect(chronoOp.operationId).toBe('process_auction');
      expect(chronoOp.targetData).toBe('auction:12345');
    });
  });

  describe('enhanced stats transformer', () => {
    it('should transform stats data with proper structure', async () => {
      const op = {
        type: 'put',
        path: ['stats', 'total_supply'],
        data: 1000000000
      };

      await transformer.transformOperationInternal(op, {}, mutations);

      expect(mutations.other).toHaveLength(1);
      const stats = mutations.other[0];
      expect(stats['dgraph.type']).toBe('NetworkStats');
      expect(stats.statKey).toBe('total_supply');
      expect(stats.statValue).toBe(1000000000);
    });

    it('should handle complex stats objects', async () => {
      const op = {
        type: 'put',
        path: ['stats', 'network_overview'],
        data: {
          total_accounts: 5432,
          total_contracts: 1234,
          total_storage: 9876543210,
          active_nodes: 25,
          last_updated: 1704067200
        }
      };

      await transformer.transformOperationInternal(op, {}, mutations);

      const stats = mutations.other[0];
      expect(stats['dgraph.type']).toBe('NetworkStats');
      expect(stats.statKey).toBe('network_overview');
      const parsedValue = JSON.parse(stats.statValue);
      expect(parsedValue.total_accounts).toBe(5432);
      expect(parsedValue.active_nodes).toBe(25);
    });

    it('should handle nested stats paths', async () => {
      const op = {
        type: 'put',
        path: ['stats', 'daily', '2024-01-01', 'transactions'],
        data: 15432
      };

      await transformer.transformOperationInternal(op, {}, mutations);

      const stats = mutations.other[0];
      expect(stats.statKey).toBe('daily.2024-01-01.transactions');
      expect(stats.statValue).toBe(15432);
      expect(stats.statCategory).toBe('daily');
    });
  });
});