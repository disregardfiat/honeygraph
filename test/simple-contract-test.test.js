import { jest } from '@jest/globals';
import { createDataTransformer } from '../lib/data-transformer.js';

describe('Simple Contract Test', () => {
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

  test('should handle simple contract without metadata', async () => {
    // Most basic contract structure - no metadata
    const contractOp = {
      type: 'put',
      path: ['contract', 'testuser', 'simple-contract-001'],
      data: {
        a: "testuser",
        b: "QmRootCID123",
        c: "96585668-96656732",
        df: {
          "QmFile1": 1234,
          "QmFile2": 5678
        },
        e: "97938326"
      },
      blockNum: 96585668,
      timestamp: Date.now()
    };

    const mutations = await transformer.transformOperation(contractOp);
    
    console.log('\n=== Simple Contract Mutations ===');
    mutations.forEach(m => {
      console.log(`${m['dgraph.type']}: ${m.uid || m.id || 'no-id'}`);
      if (m['dgraph.type'] === 'ContractFile') {
        console.log(`  - CID: ${m.cid}, Name: ${m.name}, Path: ${m.path}`);
      }
      if (m['dgraph.type'] === 'Path') {
        console.log(`  - FullPath: ${m.fullPath}, Files: ${m.files ? m.files.length : 0}`);
      }
    });
    
    // Should create basic mutations
    expect(mutations.length).toBeGreaterThan(0);
    
    const contractMutation = mutations.find(m => m['dgraph.type'] === 'StorageContract');
    expect(contractMutation).toBeDefined();
    expect(contractMutation.id).toBe('testuser:0:simple-contract-001');
    
    // Files should be created
    const fileMutations = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
    expect(fileMutations.length).toBe(2);
    
    // Files should have CIDs as names when no metadata
    expect(fileMutations[0].cid).toBe('QmFile1');
    expect(fileMutations[0].size).toBe(1234);
  });

  test('should handle contract with simple metadata', async () => {
    // Contract with basic metadata string
    const contractOp = {
      type: 'put',
      path: ['contract', 'testuser', 'metadata-contract-001'],
      data: {
        a: "testuser",
        b: "QmRootCID456",
        c: "96585668-96656732",
        df: {
          "QmFile1": 1234,
          "QmFile2": 5678
        },
        e: "97938326",
        m: "1|" // Simple metadata - version 1, no folders
      },
      blockNum: 96585668,
      timestamp: Date.now()
    };

    const mutations = await transformer.transformOperation(contractOp);
    
    console.log('\n=== Contract with Metadata Mutations ===');
    const contractMutation = mutations.find(m => m['dgraph.type'] === 'StorageContract');
    if (contractMutation && contractMutation.metadata) {
      console.log('Metadata:', contractMutation.metadata);
    }
    
    expect(mutations.length).toBeGreaterThan(0);
  });

  test('should NOT create subdirectory paths without proper metadata', async () => {
    // This mimics the test data format that was failing
    const contractOp = {
      type: 'put',
      path: ['contract', 'testuser', 'no-metadata-contract'],
      data: {
        a: "testuser",
        b: "QmRootCID789",
        c: "96585668-96656732",
        df: {
          "QmFileInRoot": 1000,
          "QmFileInImages": 2000  // Without metadata, we don't know this is in /Images
        },
        e: "97938326"
      },
      blockNum: 96585668,
      timestamp: Date.now()
    };

    const mutations = await transformer.transformOperation(contractOp);
    
    // Should only create root path
    const pathMutations = mutations.filter(m => m['dgraph.type'] === 'Path');
    console.log('\n=== Paths without metadata ===');
    pathMutations.forEach(p => console.log(`Path: ${p.fullPath}`));
    
    expect(pathMutations.length).toBe(1);
    expect(pathMutations[0].fullPath).toBe('/');
    
    // All files should be in root
    const fileMutations = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
    fileMutations.forEach(f => {
      expect(f.path).toBe('/');
    });
  });
});