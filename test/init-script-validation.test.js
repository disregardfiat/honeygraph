import { jest } from '@jest/globals';
import { createDataTransformer } from '../lib/data-transformer.js';
import fs from 'fs';
import path from 'path';

describe('Init Script Validation', () => {
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

  describe('Schema Validation', () => {
    test('schema should include all required NetworkStats predicates', () => {
      const schemaPath = path.join(process.cwd(), 'schema', 'schema.dgraph');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      
      // Check for NetworkStats predicates
      expect(schema).toContain('statKey: string @index(term)');
      expect(schema).toContain('statCategory: string @index(term)');
      expect(schema).toContain('statValue: string');
      expect(schema).toContain('type NetworkStats {');
    });

    test('schema should define statValue as string not int', () => {
      const schemaPath = path.join(process.cwd(), 'schema', 'schema.dgraph');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      
      // Ensure statValue is NOT defined as int
      expect(schema).not.toMatch(/statValue:\s*int/);
      // Ensure it's defined as string
      expect(schema).toMatch(/statValue:\s*string/);
    });
  });

  describe('Common Init Data Patterns', () => {
    test('should handle stats operations that caused ParseInt errors', async () => {
      // These are actual patterns from the init script that failed
      const problematicOperations = [
        {
          type: 'put',
          path: ['stats', 'dao_balance'],
          data: "0.00"
        },
        {
          type: 'put',
          path: ['stats', 'node', 'spktest'],
          data: {
            attempts: 180131,
            bidRate: 500,
            burned: 6000,
            contracts: 0,
            domain: "https://spknode.actifit.io"
          }
        },
        {
          type: 'put',
          path: ['stats', 'prices', 'hive'],
          data: 0.3245
        }
      ];

      for (const op of problematicOperations) {
        const operation = {
          ...op,
          blockNum: 96585668,
          timestamp: Date.now()
        };

        // Should not throw errors
        const mutations = await transformer.transformOperation(operation);
        
        // Should create valid NetworkStats mutations
        const statsMutations = mutations.filter(m => m['dgraph.type'] === 'NetworkStats');
        expect(statsMutations.length).toBe(1);
        
        const stats = statsMutations[0];
        expect(stats).toHaveProperty('statKey');
        expect(stats).toHaveProperty('statValue');
        expect(stats).toHaveProperty('blockNumber');
        expect(stats).toHaveProperty('timestamp');
        
        // Verify statValue is stored appropriately
        if (typeof op.data === 'object') {
          expect(stats.statValue).toBe(JSON.stringify(op.data));
        } else {
          expect(stats.statValue).toBe(op.data);
        }
      }
    });

    test('should handle contract operations with proper file mappings', async () => {
      const contractOp = {
        type: 'put',
        path: ['contract', 'disregardfiat', 'dlux-io:0:96585668-542e7cd8f72324413e0cff1768670c058e854a0d'],
        data: {
          a: "disregardfiat",
          b: "QmNVkoKKmWsXuHJVPG5pGhCXfYsGJZjLE3RhfwfBhTizmp", 
          c: "96585668-96656732",
          df: {
            "3": { n: "index.html", s: 1234 },
            "10": { n: "style.css", s: 567 }
          },
          e: 1721145000000
        },
        blockNum: 96585668,
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(contractOp);
      
      // Should create contract and file mutations
      const contractMutations = mutations.filter(m => m['dgraph.type'] === 'StorageContract');
      const fileMutations = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
      
      expect(contractMutations.length).toBe(1);
      expect(fileMutations.length).toBeGreaterThan(0);
    });
  });

  describe('Empty Filesystem Prevention', () => {
    test('should create proper file-to-path associations', async () => {
      // First create a user with a contract
      const contractOp = {
        type: 'put',
        path: ['contract', 'testuser', 'test-contract-001'],
        data: {
          a: "testuser",
          b: "QmTestRootCID",
          c: "96585668-96656732",
          df: {
            "0": { n: "README.md", s: 1024, p: "/" },
            "1": { n: "image.png", s: 2048, p: "/Images" },
            "2": { n: "document.pdf", s: 4096, p: "/Documents" }
          },
          e: Date.now() + 86400000
        },
        blockNum: 96585668,
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(contractOp);
      
      // Should create path mutations for directories
      const pathMutations = mutations.filter(m => m['dgraph.type'] === 'Path');
      expect(pathMutations.length).toBeGreaterThan(0);
      
      // Should have proper file associations
      const fileMutations = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
      expect(fileMutations.length).toBe(3);
      
      // Each file should have a parentPath reference
      fileMutations.forEach(file => {
        expect(file).toHaveProperty('parentPath');
      });
    });

    test('should handle VFS operations as other data (filesystem created on-demand)', async () => {
      const vfsOp = {
        type: 'put',
        path: ['vfs', 'testuser'],
        data: {
          "Archives": { t: "d", c: [] },
          "Code": { t: "d", c: [] },
          "Documents": { t: "d", c: [] },
          "Images": { t: "d", c: [] },
          "Videos": { t: "d", c: [] }
        },
        blockNum: 96585668,
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(vfsOp);
      
      // VFS operations are stored as "other" data, not Path mutations
      // The filesystem structure is created on-demand when queried
      const otherMutations = mutations.filter(m => m.path === 'vfs.testuser');
      expect(otherMutations.length).toBe(1);
      
      // Verify the VFS data is stored correctly
      const vfsMutation = otherMutations[0];
      expect(vfsMutation.value).toBe(JSON.stringify(vfsOp.data));
    });
  });
});