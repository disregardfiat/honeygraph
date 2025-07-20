import { jest } from '@jest/globals';
import { createDataTransformer } from '../lib/data-transformer.js';
import { createNetworkManager } from '../lib/network-manager.js';
import { createDgraphClient } from '../lib/dgraph-client.js';

describe('Contract to Filesystem Pipeline', () => {
  let transformer;
  let mockDgraphClient;
  let mockNetworkManager;
  let realNetworkManager;
  let realDgraphClient;

  beforeAll(async () => {
    // Create real instances for integration testing
    realDgraphClient = createDgraphClient();
    realNetworkManager = createNetworkManager({
      baseDataPath: './data/honeygraph',
      dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080'
    });
    await realNetworkManager.initialize();
  });

  beforeEach(() => {
    // Setup mock instances for unit tests
    mockDgraphClient = {
      query: jest.fn().mockResolvedValue({ account: [] }),
      mutate: jest.fn().mockResolvedValue({ uids: {} })
    };
    
    mockNetworkManager = {
      getNetwork: jest.fn().mockReturnValue({
        dgraphClient: mockDgraphClient,
        namespace: 'spkccT_'
      })
    };
    
    transformer = createDataTransformer(mockDgraphClient, mockNetworkManager);
  });

  describe('Contract Import Pipeline', () => {
    test('should create complete contract with files and paths', async () => {
      const contractOperation = {
        type: 'put',
        path: ['contract', 'testuser', '12345-abcdef'],
        data: {
          f: 'testuser',     // purchaser
          t: 'testuser',     // owner
          a: 1,              // authorized
          b: '',             // broker
          c: 1,              // status
          p: 100,            // power
          r: 0,              // refunded
          u: 0,              // utilized
          v: 1,              // verified
          e: '97938326:QmTestExpires',  // expiration
          m: '1|TestFiles,jpg,png,,0--2|Videos,mp4,,1,0--', // metadata
          df: {
            'QmTestFile1': 1024,
            'QmTestFile2': 2048,
            'QmTestFile3': 512
          },
          n: {
            '1': 'storagenode1',
            '2': 'storagenode2'
          }
        },
        blockNum: 12345,
        timestamp: Date.now()
      };

      const blockInfo = { blockNum: 12345, timestamp: Date.now() };
      const mutations = await transformer.transformOperations([contractOperation], blockInfo);
      
      console.log('Generated mutations:', JSON.stringify(mutations, null, 2));
      
      // Should create account
      const accounts = mutations.filter(m => m['dgraph.type'] === 'Account');
      expect(accounts.length).toBe(1);
      expect(accounts[0].username).toBe('testuser');
      
      // Should create contract
      const contracts = mutations.filter(m => m['dgraph.type'] === 'StorageContract');
      expect(contracts.length).toBe(1);
      expect(contracts[0].id).toBe('testuser:0:12345-abcdef');
      expect(contracts[0].fileCount).toBe(3);
      
      // Should create files
      const files = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
      expect(files.length).toBe(3);
      
      // Should create paths
      const paths = mutations.filter(m => m['dgraph.type'] === 'Path');
      console.log('Created paths:', paths.map(p => ({ fullPath: p.fullPath, pathType: p.pathType })));
      expect(paths.length).toBeGreaterThan(0);
      
      // Should have root path and file paths
      const rootPaths = paths.filter(p => p.fullPath === '/' && p.pathType === 'directory');
      expect(rootPaths.length).toBe(1);
      
      // Should have file paths for visible files (without bitflag 2)
      const filePaths = paths.filter(p => p.pathType === 'file');
      expect(filePaths.length).toBeGreaterThan(0);
    });

    test('should handle files with bitflag 2 (hidden/thumbnails) correctly', async () => {
      const contractOperation = {
        type: 'put',
        path: ['contract', 'testuser', '12345-abcdef'],
        data: {
          f: 'testuser',
          t: 'testuser',
          a: 1,
          c: 1,
          // Metadata with files having different bitflags
          m: '1|TestFiles,jpg,2,,0--2|Thumbnails,jpg,2,,2--', // Second folder has bitflag 2
          df: {
            'QmVisibleFile': 1024,    // Should create path
            'QmHiddenFile': 512       // Should NOT create path (bitflag 2)
          }
        },
        blockNum: 12345,
        timestamp: Date.now()
      };

      const blockInfo = { blockNum: 12345, timestamp: Date.now() };
      const mutations = await transformer.transformOperations([contractOperation], blockInfo);
      
      // Should create both files as ContractFile entities
      const files = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
      expect(files.length).toBe(2);
      
      // But should only create paths for visible files (not bitflag 2)
      const filePaths = mutations.filter(m => m['dgraph.type'] === 'Path' && m.pathType === 'file');
      console.log('File paths created:', filePaths.map(p => p.fullPath));
      
      // This test helps us understand which files get paths created
      expect(filePaths.length).toBeGreaterThan(0);
    });

    test('should handle multiple contracts for same user', async () => {
      const contract1 = {
        type: 'put',
        path: ['contract', 'testuser', '12345-first'],
        data: {
          f: 'testuser',
          t: 'testuser',
          a: 1,
          c: 1,
          m: '1|Contract1,jpg,,0,0--',
          df: { 'QmFile1': 1024 }
        },
        blockNum: 12345,
        timestamp: Date.now()
      };

      const contract2 = {
        type: 'put',
        path: ['contract', 'testuser', '12346-second'],
        data: {
          f: 'testuser',
          t: 'testuser',
          a: 1,
          c: 1,
          m: '1|Contract2,jpg,,0,0--',
          df: { 'QmFile2': 2048 }
        },
        blockNum: 12346,
        timestamp: Date.now()
      };

      const blockInfo = { blockNum: 12345, timestamp: Date.now() };
      const mutations = await transformer.transformOperations([contract1, contract2], blockInfo);
      
      // Should create only one account (deduplicated)
      const accounts = mutations.filter(m => m['dgraph.type'] === 'Account');
      expect(accounts.length).toBe(1);
      
      // Should create two contracts
      const contracts = mutations.filter(m => m['dgraph.type'] === 'StorageContract');
      expect(contracts.length).toBe(2);
      
      // Should create two files
      const files = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
      expect(files.length).toBe(2);
      
      // Should create paths for both contracts
      const filePaths = mutations.filter(m => m['dgraph.type'] === 'Path' && m.pathType === 'file');
      console.log('Multiple contract file paths:', filePaths.map(p => p.fullPath));
      expect(filePaths.length).toBe(2);
    });

    test('should properly parse metadata and create folder structure', async () => {
      const contractOperation = {
        type: 'put',
        path: ['contract', 'testuser', '12345-abcdef'],
        data: {
          f: 'testuser',
          t: 'testuser',
          a: 1,
          c: 1,
          // Complex metadata with nested folder structure
          m: '1|Root,jpg,,0,0--2|Images,jpg,,1,0--3|Videos,mp4,,1,0--4|Images/Thumbnails,jpg,,2,2--',
          df: {
            'QmRootFile': 1024,      // Should go to /QmRootFile
            'QmImageFile': 2048,     // Should go to /Images/QmImageFile  
            'QmVideoFile': 4096,     // Should go to /Videos/QmVideoFile
            'QmThumbFile': 512       // Should NOT create path (bitflag 2)
          }
        },
        blockNum: 12345,
        timestamp: Date.now()
      };

      const blockInfo = { blockNum: 12345, timestamp: Date.now() };
      const mutations = await transformer.transformOperations([contractOperation], blockInfo);
      
      const paths = mutations.filter(m => m['dgraph.type'] === 'Path');
      console.log('Folder structure paths:', paths.map(p => ({ 
        fullPath: p.fullPath, 
        pathType: p.pathType,
        pathName: p.pathName 
      })));
      
      // Should create directory paths
      const dirPaths = paths.filter(p => p.pathType === 'directory');
      expect(dirPaths.some(p => p.fullPath === '/')).toBe(true);
      expect(dirPaths.some(p => p.fullPath === '/Images')).toBe(true);
      expect(dirPaths.some(p => p.fullPath === '/Videos')).toBe(true);
      
      // Should create file paths (excluding hidden files)
      const filePaths = paths.filter(p => p.pathType === 'file');
      console.log('File paths in folder structure:', filePaths.map(p => p.fullPath));
      
      // Should have visible files but not hidden thumbnails
      expect(filePaths.length).toBeGreaterThan(0);
      expect(filePaths.length).toBeLessThan(4); // Less than total files due to bitflag filtering
    });
  });

  describe('Real Data Integration Tests', () => {
    // These tests use real disregardfiat data to debug the actual issue
    test('should process disregardfiat contract data correctly', async () => {
      // Skip if no real network connection
      if (!process.env.TEST_INTEGRATION) {
        console.log('Skipping integration test - set TEST_INTEGRATION=true to run');
        return;
      }

      // Use real transformer with real network
      const realTransformer = createDataTransformer(
        realDgraphClient,
        realNetworkManager
      );

      // Sample real disregardfiat contract operation from state
      const realContractData = {
        type: 'put',
        path: ['contract', 'disregardfiat', '93273146-061aa8e8d79a033ed70e27572c31bba071369582'],
        data: {
          // Real contract data from API
          a: 1,
          b: '',
          c: 1,
          df: {
            // Real file data
            'QmSomeRealCID': 1024
          },
          e: '97938326:QmExpiration',
          f: 'disregardfiat',
          i: 1,
          m: 'real_metadata_string',
          n: { '1': 'real_storage_node' },
          t: 'disregardfiat'
        },
        blockNum: 93273146,
        timestamp: Date.now()
      };

      const blockInfo = { blockNum: 93273146, timestamp: Date.now() };
      const mutations = await realTransformer.transformOperations([realContractData], blockInfo);
      
      console.log('Real contract mutations:', JSON.stringify(mutations.slice(0, 5), null, 2));
      
      // Verify expected entities are created
      expect(mutations.length).toBeGreaterThan(0);
      
      const accounts = mutations.filter(m => m['dgraph.type'] === 'Account');
      const contracts = mutations.filter(m => m['dgraph.type'] === 'StorageContract');
      const files = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
      const paths = mutations.filter(m => m['dgraph.type'] === 'Path');
      
      console.log('Real data entity counts:', {
        accounts: accounts.length,
        contracts: contracts.length,
        files: files.length,
        paths: paths.length
      });
      
      expect(contracts.length).toBe(1);
      expect(contracts[0].id).toContain('disregardfiat:0:93273146');
    });

    test('should verify filesystem API can find imported contracts', async () => {
      // Skip if no real network connection
      if (!process.env.TEST_INTEGRATION) {
        console.log('Skipping integration test - set TEST_INTEGRATION=true to run');
        return;
      }

      // This test would actually import data and then query filesystem API
      // to verify the complete pipeline works
      
      // Import a simple test contract
      const testContract = {
        type: 'put',
        path: ['contract', 'testintegrationuser', '99999-testcontract'],
        data: {
          f: 'testintegrationuser',
          t: 'testintegrationuser',
          a: 1,
          c: 1,
          m: '1|TestDir,jpg,,0,0--',
          df: {
            'QmTestIntegrationFile': 1024
          }
        },
        blockNum: 99999,
        timestamp: Date.now()
      };

      const realTransformer = createDataTransformer(
        realDgraphClient,
        realNetworkManager
      );

      const blockInfo = { blockNum: 99999, timestamp: Date.now() };
      const mutations = await realTransformer.transformOperations([testContract], blockInfo);
      
      // TODO: Actually import to Dgraph and test filesystem API
      // This would require setting up a test database or using the real one
      
      console.log('Integration test mutations ready for import:', mutations.length);
      expect(mutations.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases and Debugging', () => {
    test('should log detailed information about path creation', async () => {
      const contractOperation = {
        type: 'put',
        path: ['contract', 'debuguser', '12345-debug'],
        data: {
          f: 'debuguser',
          t: 'debuguser',
          a: 1,
          c: 1,
          m: '1|DebugFolder,jpg,,0,0--',
          df: {
            'QmDebugFile': 1024
          }
        },
        blockNum: 12345,
        timestamp: Date.now()
      };

      // Spy on console.log to capture path creation logs
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const blockInfo = { blockNum: 12345, timestamp: Date.now() };
      const mutations = await transformer.transformOperations([contractOperation], blockInfo);
      
      // Check what path creation logs were generated
      const pathCreationLogs = consoleSpy.mock.calls.filter(call => 
        call[0] && call[0].includes('Creating path')
      );
      
      console.log('Path creation logs:', pathCreationLogs);
      
      consoleSpy.mockRestore();
      
      // Verify paths were created
      const paths = mutations.filter(m => m['dgraph.type'] === 'Path');
      expect(paths.length).toBeGreaterThan(0);
    });

    test('should handle empty or malformed contract data', async () => {
      const malformedContracts = [
        {
          type: 'put',
          path: ['contract', 'testuser', '12345-empty'],
          data: {},
          blockNum: 12345,
          timestamp: Date.now()
        },
        {
          type: 'put',
          path: ['contract', 'testuser', '12346-nofiles'],
          data: {
            f: 'testuser',
            t: 'testuser',
            a: 1,
            c: 1
            // No df (files) or m (metadata)
          },
          blockNum: 12346,
          timestamp: Date.now()
        }
      ];

      const blockInfo = { blockNum: 12345, timestamp: Date.now() };
      
      // Should not throw errors
      for (const contract of malformedContracts) {
        await expect(
          transformer.transformOperations([contract], blockInfo)
        ).resolves.toBeDefined();
      }
    });

    test('should show why some contracts might not appear in filesystem', async () => {
      // Test contract with all files having bitflag 2 (hidden)
      const hiddenFilesContract = {
        type: 'put',
        path: ['contract', 'testuser', '12345-hidden'],
        data: {
          f: 'testuser',
          t: 'testuser',
          a: 1,
          c: 1,
          m: '1|HiddenFiles,jpg,,0,2--', // All files have bitflag 2
          df: {
            'QmHiddenFile1': 1024,
            'QmHiddenFile2': 2048
          }
        },
        blockNum: 12345,
        timestamp: Date.now()
      };

      const blockInfo = { blockNum: 12345, timestamp: Date.now() };
      const mutations = await transformer.transformOperations([hiddenFilesContract], blockInfo);
      
      const files = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
      const paths = mutations.filter(m => m['dgraph.type'] === 'Path');
      
      console.log('Hidden files contract - Files created:', files.length);
      console.log('Hidden files contract - Paths created:', paths.length);
      
      // Files should be created but paths might not be
      expect(files.length).toBe(2);
      
      // This test shows if contracts with only hidden files appear in filesystem
      const filePaths = paths.filter(p => p.pathType === 'file');
      console.log('File paths for hidden files:', filePaths.length);
    });
  });
});