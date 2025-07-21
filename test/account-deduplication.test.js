import { jest } from '@jest/globals';
import { createDataTransformer } from '../lib/data-transformer.js';

describe('Account Deduplication', () => {
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

  describe('Single batch operations', () => {
    test('should reuse account within same batch', async () => {
      const operations = [
        {
          type: 'put',
          path: ['balances', 'testuser'],
          data: '1000',
          blockNum: 12345,
          timestamp: Date.now()
        },
        {
          type: 'put', 
          path: ['spkb', 'testuser'],
          data: '500',
          blockNum: 12345,
          timestamp: Date.now()
        }
      ];

      const blockInfo = { blockNum: 12345, timestamp: Date.now() };
      const mutations = await transformer.transformOperations(operations, blockInfo);
      
      // Should only create ONE account mutation for testuser despite multiple operations
      const accountMutations = mutations.filter(m => m['dgraph.type'] === 'Account');
      expect(accountMutations.length).toBe(1);
      expect(accountMutations[0].username).toBe('testuser');
    });

    test('should create separate accounts for different users in same batch', async () => {
      const operations = [
        {
          type: 'put',
          path: ['balances', 'user1'],
          data: '1000',
          blockNum: 12345,
          timestamp: Date.now()
        },
        {
          type: 'put',
          path: ['balances', 'user2'], 
          data: '500',
          blockNum: 12345,
          timestamp: Date.now()
        }
      ];

      const blockInfo = { blockNum: 12345, timestamp: Date.now() };
      const mutations = await transformer.transformOperations(operations, blockInfo);
      
      // Should create two account mutations for different users
      const accountMutations = mutations.filter(m => m['dgraph.type'] === 'Account');
      expect(accountMutations.length).toBe(2);
      
      const usernames = accountMutations.map(m => m.username).sort();
      expect(usernames).toEqual(['user1', 'user2']);
    });
  });

  describe('Multiple batch operations (cross-batch deduplication)', () => {
    test('should reuse account from cache across multiple batches', async () => {
      // First batch creates testuser account
      const batch1 = [{
        type: 'put',
        path: ['balances', 'testuser'],
        data: '1000',
        blockNum: 12345,
        timestamp: Date.now()
      }];

      const blockInfo = { blockNum: 12345, timestamp: Date.now() };
      const mutations1 = await transformer.transformOperations(batch1, blockInfo);
      
      // Verify first batch creates account
      const accountMutations1 = mutations1.filter(m => m['dgraph.type'] === 'Account');
      expect(accountMutations1.length).toBe(1);
      expect(accountMutations1[0].username).toBe('testuser');

      // Second batch should reuse the same account
      const batch2 = [{
        type: 'put',
        path: ['spkb', 'testuser'],
        data: '500',
        blockNum: 12346,
        timestamp: Date.now()
      }];

      const mutations2 = await transformer.transformOperations(batch2, blockInfo);
      
      // Second batch should create account mutation with updated balance data
      const accountMutations2 = mutations2.filter(m => m['dgraph.type'] === 'Account');
      expect(accountMutations2.length).toBe(1); // Updated account created
      expect(accountMutations2[0].username).toBe('testuser');
      expect(accountMutations2[0].spkBlock).toBe(500); // New balance field
    });

    test('should handle existing database accounts correctly', async () => {
      // Mock existing account in database
      mockDgraphClient.query.mockResolvedValueOnce({
        account: [{ uid: '0x123' }]
      });

      const operations = [{
        type: 'put',
        path: ['balances', 'existinguser'],
        data: '1000',
        blockNum: 12345,
        timestamp: Date.now()
      }];

      const blockInfo = { blockNum: 12345, timestamp: Date.now() };
      const mutations = await transformer.transformOperations(operations, blockInfo);
      
      // Should create account mutation for existing user with updated balance
      const accountMutations = mutations.filter(m => m['dgraph.type'] === 'Account');
      expect(accountMutations.length).toBe(1);
      expect(accountMutations[0].uid).toBe('0x123'); // Uses existing UID
      expect(accountMutations[0].larynxBalance).toBe(1000); // Has new balance data
      
      // Should query database for existing account
      expect(mockDgraphClient.query).toHaveBeenCalledWith(
        expect.stringContaining('existinguser')
      );
    });

    test('should use consistent UIDs across batches for same user', async () => {
      // Process same user across multiple batches
      const batches = [
        [{ type: 'put', path: ['balances', 'testuser'], data: '1000', blockNum: 12345, timestamp: Date.now() }],
        [{ type: 'put', path: ['spkb', 'testuser'], data: '500', blockNum: 12346, timestamp: Date.now() }],
        [{ type: 'put', path: ['pow', 'testuser'], data: '100', blockNum: 12347, timestamp: Date.now() }]
      ];

      const blockInfo = { blockNum: 12345, timestamp: Date.now() };
      let firstAccountUid = null;

      for (let i = 0; i < batches.length; i++) {
        const mutations = await transformer.transformOperations(batches[i], blockInfo);
        
        if (i === 0) {
          // First batch should create account
          const accountMutations = mutations.filter(m => m['dgraph.type'] === 'Account');
          expect(accountMutations.length).toBe(1);
          firstAccountUid = accountMutations[0].uid;
        } else {
          // Subsequent batches should create account mutations with updates
          const accountMutations = mutations.filter(m => m['dgraph.type'] === 'Account');
          expect(accountMutations.length).toBe(1);
          // Should use the same UID as the first batch
          expect(accountMutations[0].uid).toBe(firstAccountUid);
          expect(accountMutations[0].username).toBe('testuser');
        }
      }

      // Verify the account cache has the correct UID
      expect(firstAccountUid).toBeTruthy();
      expect(firstAccountUid).toMatch(/^_:account_testuser$/);
    });
  });

  describe('Contract operations with account deduplication', () => {
    test('should not create duplicate accounts for contract owner and purchaser', async () => {
      const contractOperation = {
        type: 'put',
        path: ['contract', 'testuser', '12345-abcdef'],
        data: {
          f: 'testuser',    // purchaser
          t: 'testuser',    // owner (same as purchaser)
          a: 1,
          c: 1,
          df: {
            'QmTestFile': 1024
          }
        },
        blockNum: 12345,
        timestamp: Date.now()
      };

      const blockInfo = { blockNum: 12345, timestamp: Date.now() };
      const mutations = await transformer.transformOperations([contractOperation], blockInfo);
      
      // Should create only ONE account for testuser (not separate for owner/purchaser)
      const accountMutations = mutations.filter(m => m['dgraph.type'] === 'Account');
      expect(accountMutations.length).toBe(1);
      expect(accountMutations[0].username).toBe('testuser');
    });

    test('should handle contract with different owner and purchaser', async () => {
      const contractOperation = {
        type: 'put',
        path: ['contract', 'purchaser', '12345-abcdef'],
        data: {
          f: 'purchaser',
          t: 'owner',
          a: 1,
          c: 1,
          df: {
            'QmTestFile': 1024
          }
        },
        blockNum: 12345,
        timestamp: Date.now()
      };

      const blockInfo = { blockNum: 12345, timestamp: Date.now() };
      const mutations = await transformer.transformOperations([contractOperation], blockInfo);
      
      // Should create TWO accounts (one for purchaser, one for owner)
      const accountMutations = mutations.filter(m => m['dgraph.type'] === 'Account');
      expect(accountMutations.length).toBe(2);
      
      const usernames = accountMutations.map(m => m.username).sort();
      expect(usernames).toEqual(['owner', 'purchaser']);
    });
  });

  describe('Error handling and edge cases', () => {
    test('should handle database query errors gracefully', async () => {
      // Mock database error
      mockDgraphClient.query.mockRejectedValueOnce(new Error('Database error'));

      const operations = [{
        type: 'put',
        path: ['balances', 'testuser'],
        data: '1000',
        blockNum: 12345,
        timestamp: Date.now()
      }];

      const blockInfo = { blockNum: 12345, timestamp: Date.now() };
      
      // Should not throw error and should create new account
      const mutations = await transformer.transformOperations(operations, blockInfo);
      const accountMutations = mutations.filter(m => m['dgraph.type'] === 'Account');
      expect(accountMutations.length).toBe(1);
    });

    test('should handle special characters in usernames', async () => {
      const specialUsers = ['user.with.dots', 'user-with-dashes', 'user_with_underscores'];
      
      const operations = specialUsers.map(username => ({
        type: 'put',
        path: ['balances', username],
        data: '1000',
        blockNum: 12345,
        timestamp: Date.now()
      }));

      const blockInfo = { blockNum: 12345, timestamp: Date.now() };
      const mutations = await transformer.transformOperations(operations, blockInfo);
      
      // Should create accounts for all special usernames
      const accountMutations = mutations.filter(m => m['dgraph.type'] === 'Account');
      expect(accountMutations.length).toBe(3);
      
      const usernames = accountMutations.map(m => m.username).sort();
      expect(usernames).toEqual(specialUsers.sort());
      
      // UIDs should be sanitized (dots and dashes replaced with underscores)
      accountMutations.forEach(account => {
        expect(account.uid).toMatch(/^_:account_[a-zA-Z0-9_]+$/);
      });
    });
  });
});