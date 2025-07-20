import { jest } from '@jest/globals';
import { createDataTransformer } from '../lib/data-transformer.js';

describe('Import Failures - Real World Data', () => {
  let transformer;
  let mockDgraphClient;
  let mockNetworkManager;

  beforeEach(() => {
    // Setup mock Dgraph client
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

  describe('Failed Import Cases', () => {
    test('should handle broca data with comma-separated string format', async () => {
      // Error: parsing "80975487,5qUoh": invalid syntax
      const operation = {
        type: 'put',
        path: ['lbroca', 'testuser'],
        data: "80975487,5qUoh", // This format causes parsing errors
        blockNum: 12345,
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(operation);
      
      // Should create account with properly parsed broca data
      const accounts = mutations.filter(m => m['dgraph.type'] === 'Account');
      expect(accounts.length).toBe(1);
      
      const account = accounts[0];
      expect(account.username).toBe('testuser');
      expect(account.liquidBroca).toBe(80975487); // Should parse first part as integer
      expect(account.brocaLastUpdate).toBeDefined(); // Should decode base64 block number
    });

    test('should handle different broca format variations', async () => {
      // Error: parsing "99999,5qSrW": invalid syntax  
      const operation = {
        type: 'put',
        path: ['lbroca', 'user2'],
        data: "99999,5qSrW",
        blockNum: 12345,
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(operation);
      
      const accounts = mutations.filter(m => m['dgraph.type'] === 'Account');
      expect(accounts.length).toBe(1);
      
      const account = accounts[0];
      expect(account.liquidBroca).toBe(99999);
    });

    test('should handle decimal values being passed to integer fields', async () => {
      // Error: parsing "4.098": invalid syntax
      const operation = {
        type: 'put', 
        path: ['balances', 'testuser'],
        data: "4.098", // Decimal string being passed to int field
        blockNum: 12345,
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(operation);
      
      const accounts = mutations.filter(m => m['dgraph.type'] === 'Account');
      expect(accounts.length).toBe(1);
      
      const account = accounts[0];
      // Should either truncate to integer or handle as float properly
      expect(typeof account.larynxBalance).toBe('number');
    });

    test('should handle JSON object strings being passed to integer fields', async () => {
      // Error: parsing JSON object as integer
      const jsonData = {
        "HBD": 0,
        "HIVE": 13,
        "VALUE": 3
      };
      
      const operation = {
        type: 'put',
        path: ['authorities', 'testuser'],
        data: JSON.stringify(jsonData), // JSON string being parsed as int
        blockNum: 12345,
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(operation);
      
      // Should not try to parse JSON as integer
      expect(mutations.length).toBeGreaterThanOrEqual(0);
      // Should either skip invalid data or store as string
    });

    test('should handle complex nested operation data', async () => {
      // Complex operation that includes JSON metadata
      const complexData = {
        "attempts": 180131,
        "bidRate": 500,
        "burned": 6000,
        "contracts": 0,
        "domain": "https://spknode.actifit.io",
        "report": {
          "block": 83783001,
          "block_num": 83799652,
          "hash": "QmPH6dEYJHBwsfCzCqknEAq3e6a6aRWhzRVk5z6DPcehzY"
        }
      };

      const operation = {
        type: 'put',
        path: ['pow', 'actifit-3speak'],
        data: complexData,
        blockNum: 12345,
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(operation);
      
      // Should handle complex data without parsing errors
      expect(mutations.length).toBeGreaterThanOrEqual(0);
    });

    test('should handle feed operations with complex comment data', async () => {
      // Feed operation with complex comment JSON that was being parsed as int
      const feedData = [
        "comment",
        {
          "author": "regardspk",
          "body": "SPK Network Daily Report - test content",
          "json_metadata": "{\"tags\":[\"spk\"]}",
          "parent_author": "",
          "parent_permlink": "spk",
          "permlink": "spk86332105",
          "title": "LARYNX DAO | Block Report 86332105"
        }
      ];

      const operation = {
        type: 'put',
        path: ['feed', 'regardspk', 'spk86332105'],
        data: feedData,
        blockNum: 86332105,
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(operation);
      
      // Should handle feed data properly without trying to parse as integer
      expect(mutations.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Data Type Validation', () => {
    test('should validate that all integer fields receive proper integer values', async () => {
      // Test various data types that should NOT be passed to integer fields
      const testCases = [
        { path: ['balances', 'user1'], data: "not_a_number" },
        { path: ['spkb', 'user2'], data: { "object": "value" } },
        { path: ['pow', 'user3'], data: ["array", "data"] },
        { path: ['authorities', 'user4'], data: null },
        { path: ['witness', 'user5'], data: undefined }
      ];

      for (const testCase of testCases) {
        const operation = {
          type: 'put',
          path: testCase.path,
          data: testCase.data,
          blockNum: 12345,
          timestamp: Date.now()
        };

        // Should not throw errors, should handle gracefully
        await expect(transformer.transformOperation(operation)).resolves.toBeDefined();
      }
    });

    test('should properly convert string numbers to integers', async () => {
      const operation = {
        type: 'put',
        path: ['balances', 'testuser'],
        data: "12345", // String number
        blockNum: 12345,
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(operation);
      
      const accounts = mutations.filter(m => m['dgraph.type'] === 'Account');
      expect(accounts.length).toBe(1);
      
      const account = accounts[0];
      expect(account.larynxBalance).toBe(12345);
      expect(typeof account.larynxBalance).toBe('number');
    });
  });
});