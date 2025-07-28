import { jest } from '@jest/globals';
import { createDataTransformer } from '../lib/data-transformer.js';

describe('Stats ParseInt Error - "0.00" Issue', () => {
  let transformer;
  let mockDgraphClient;
  let mockNetworkManager;

  beforeEach(() => {
    mockDgraphClient = {
      query: jest.fn().mockResolvedValue({ account: [] })
    };
    mockNetworkManager = {
      getNetwork: jest.fn().mockReturnValue({
        dgraphClient: mockDgraphClient,
        namespace: 'spkccT_'
      })
    };
    transformer = createDataTransformer(mockDgraphClient, mockNetworkManager);
  });

  describe('Stats Path Float Values', () => {
    test('should handle float values in stats path without parseInt errors', async () => {
      // This is the actual error case from the init script
      const operation = {
        type: 'put',
        path: ['stats', 'dao_balance'],
        data: "0.00", // String float causing parseInt error
        blockNum: 12345,
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(operation);
      
      // Should create stats mutation without errors
      const statsMutations = mutations.filter(m => m['dgraph.type'] === 'NetworkStats');
      expect(statsMutations.length).toBe(1);
      
      const stats = statsMutations[0];
      expect(stats.statKey).toBe('dao_balance');
      expect(stats.statValue).toBe("0.00"); // Should store as string
      expect(stats.blockNumber).toBe(12345);
    });

    test('should handle numeric float values in stats', async () => {
      const operation = {
        type: 'put',
        path: ['stats', 'price_feed'],
        data: 0.00, // Numeric float
        blockNum: 12345,
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(operation);
      
      const statsMutations = mutations.filter(m => m['dgraph.type'] === 'NetworkStats');
      expect(statsMutations.length).toBe(1);
      
      const stats = statsMutations[0];
      expect(stats.statValue).toBe(0.00);
    });

    test('should handle complex stats objects with float values', async () => {
      const operation = {
        type: 'put',
        path: ['stats', 'node_rewards'],
        data: {
          total: "1234.56",
          pending: "0.00",
          claimed: 789.12
        },
        blockNum: 12345,
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(operation);
      
      const statsMutations = mutations.filter(m => m['dgraph.type'] === 'NetworkStats');
      expect(statsMutations.length).toBe(1);
      
      const stats = statsMutations[0];
      expect(stats.statValue).toBe(JSON.stringify({
        total: "1234.56",
        pending: "0.00",
        claimed: 789.12
      }));
    });

    test('should handle all value types that might be in stats', async () => {
      const testCases = [
        { value: "0.00", desc: "string float with decimals" },
        { value: "0", desc: "string integer" },
        { value: 0.00, desc: "numeric float" },
        { value: 0, desc: "numeric integer" },
        { value: null, desc: "null value" },
        { value: { amount: "0.00" }, desc: "object with float string" },
        { value: ["0.00", "1.23"], desc: "array of float strings" }
      ];

      for (const testCase of testCases) {
        const operation = {
          type: 'put',
          path: ['stats', 'test_value'],
          data: testCase.value,
          blockNum: 12345,
          timestamp: Date.now()
        };

        // Should not throw errors
        const mutations = await transformer.transformOperation(operation);
        expect(mutations).toBeDefined();
        
        const statsMutations = mutations.filter(m => m['dgraph.type'] === 'NetworkStats');
        expect(statsMutations.length).toBe(1);
      }
    });
  });

  describe('Dgraph Integer Field Protection', () => {
    test('should ensure blockNumber is always an integer', async () => {
      const operation = {
        type: 'put',
        path: ['stats', 'test'],
        data: "test",
        blockNum: "12345.00", // String float block number
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(operation);
      
      const statsMutations = mutations.filter(m => m['dgraph.type'] === 'NetworkStats');
      expect(statsMutations.length).toBe(1);
      
      const stats = statsMutations[0];
      // blockNumber should be converted to integer
      expect(stats.blockNumber).toBe(12345);
      expect(typeof stats.blockNumber).toBe('number');
    });
  });
});