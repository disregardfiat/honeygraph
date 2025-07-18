import { jest } from '@jest/globals';
import { createDataTransformer } from '../lib/data-transformer.js';

describe('Data Transformer - Core Functionality', () => {
  let transformer;
  let mockDgraphClient;
  let mockNetworkManager;

  beforeEach(() => {
    mockDgraphClient = {
      namespace: 'default',
      query: jest.fn(),
      addNamespacePrefix: jest.fn(data => data)
    };

    mockNetworkManager = {
      getNetwork: jest.fn(() => ({ dgraphClient: mockDgraphClient }))
    };

    transformer = createDataTransformer(mockDgraphClient, mockNetworkManager);
  });

  describe('Account Management', () => {
    it('should reuse existing account UIDs', async () => {
      mockDgraphClient.query.mockResolvedValue({
        account: [{ uid: '0x12345' }]
      });

      const mutations = {
        accounts: new Map(),
        other: []
      };

      const uid = await transformer.ensureAccount('testuser', mutations);
      expect(uid).toBe('0x12345');
      expect(mutations.accounts.get('testuser').uid).toBe('0x12345');
    });

    it('should create new accounts with consistent UID patterns', async () => {
      mockDgraphClient.query.mockResolvedValue({ account: [] });

      const mutations = {
        accounts: new Map(),
        other: []
      };

      const uid = await transformer.ensureAccount('newuser', mutations);
      expect(uid).toBe('_:account_newuser');
      expect(mutations.accounts.get('newuser').username).toBe('newuser');
    });
  });

  describe('Contract Processing', () => {
    it('should transform basic contract operations', async () => {
      mockDgraphClient.query.mockResolvedValue({
        account: [{ uid: '0x12345' }]
      });

      const contractData = {
        f: 'purchaser',
        t: 'owner',
        c: 3, // status = active
        a: 1000,
        p: 500
      };

      const mutations = await transformer.transformOperation({
        type: 'put',
        path: ['contract', 'owner', 'test123'],
        data: contractData,
        blockNum: 12345,
        timestamp: Date.now()
      });

      expect(mutations.length).toBeGreaterThan(0);
      
      const contractMutation = mutations.find(m => m['dgraph.type'] === 'StorageContract');
      expect(contractMutation).toBeDefined();
      expect(contractMutation.status).toBe(3);
      expect(contractMutation.authorized).toBe(1000);
      expect(contractMutation.power).toBe(500);
    });

    it('should process contracts with files and create mutations', async () => {
      mockDgraphClient.query.mockResolvedValue({
        account: [{ uid: '0x12345' }]
      });

      const contractData = {
        f: 'fileowner',
        t: 'fileowner',
        c: 3,
        df: {
          'QmFile1': 1024
        },
        m: '1|Images,file1,txt.1,thumb,0--'
      };

      const mutations = await transformer.transformOperation({
        type: 'put',
        path: ['contract', 'fileowner', 'file-contract'],
        data: contractData,
        blockNum: 12345,
        timestamp: Date.now()
      });

      expect(mutations.length).toBeGreaterThan(0);
      
      // Should have contract mutation
      const contractMutation = mutations.find(m => m['dgraph.type'] === 'StorageContract');
      expect(contractMutation).toBeDefined();
      expect(contractMutation.id).toBe('fileowner:0:file-contract');
      expect(contractMutation.fileCount).toBe(1);

      // Should have account mutations
      const accountMutations = mutations.filter(m => m['dgraph.type'] === 'Account');
      expect(accountMutations.length).toBeGreaterThan(0);
    });
  });

  describe('Balance Transformations', () => {
    it('should handle LARYNX balance updates', async () => {
      mockDgraphClient.query.mockResolvedValue({
        account: [{ uid: '0x12345' }]
      });

      const mutations = await transformer.transformOperation({
        type: 'put',
        path: ['balances', 'testuser'],
        data: 5000,
        blockNum: 12345,
        timestamp: Date.now()
      });

      const accountMutation = mutations.find(m => m['dgraph.type'] === 'Account');
      expect(accountMutation).toBeDefined();
      expect(accountMutation.larynxBalance).toBe(5000);
    });

    it('should handle SPK balance updates', async () => {
      mockDgraphClient.query.mockResolvedValue({
        account: [{ uid: '0x12345' }]
      });

      const mutations = await transformer.transformOperation({
        type: 'put',
        path: ['spk', 'testuser'],
        data: 10000,
        blockNum: 12345,
        timestamp: Date.now()
      });

      const accountMutation = mutations.find(m => m['dgraph.type'] === 'Account');
      expect(accountMutation).toBeDefined();
      expect(accountMutation.spkBalance).toBe(10000);
    });
  });

  describe('Universal Account Integration', () => {
    it('should handle accounts consistently across operations', async () => {
      let queryCallCount = 0;
      mockDgraphClient.query.mockImplementation(() => {
        queryCallCount++;
        return Promise.resolve({ account: [{ uid: '0x77c8d' }] });
      });

      const mutations1 = await transformer.transformOperation({
        type: 'put',
        path: ['balances', 'disregardfiat'],
        data: 1000,
        blockNum: 12345,
        timestamp: Date.now()
      });

      const mutations2 = await transformer.transformOperation({
        type: 'put',
        path: ['spk', 'disregardfiat'],
        data: 2000,
        blockNum: 12346,
        timestamp: Date.now()
      });

      // Both operations should reference the same account UID
      const account1 = mutations1.find(m => m['dgraph.type'] === 'Account');
      const account2 = mutations2.find(m => m['dgraph.type'] === 'Account');
      
      expect(account1.uid).toBe('0x77c8d');
      expect(account2.uid).toBe('0x77c8d');
      expect(account1.username).toBe('disregardfiat');
      expect(account2.username).toBe('disregardfiat');
    });
  });

  describe('Path Creation Integration', () => {
    it('should create path mutations when processing contracts with files', async () => {
      mockDgraphClient.query.mockResolvedValue({
        account: [{ uid: '0x12345' }]
      });

      const contractData = {
        f: 'testuser',
        t: 'testuser',
        c: 3,
        df: {
          'QmTest123': 2048,
          'QmTest456': 1024
        },
        m: '1|Images,image,jpg.1,thumb,0--,file,txt.1,thumb,0--'
      };

      const mutations = await transformer.transformOperation({
        type: 'put',
        path: ['contract', 'testuser', 'multi-file'],
        data: contractData,
        blockNum: 12345,
        timestamp: Date.now()
      });

      // Should contain path mutations for directories
      const pathMutations = mutations.filter(m => m['dgraph.type'] === 'Path');
      expect(pathMutations.length).toBeGreaterThan(0);

      // Should have root path
      const rootPath = pathMutations.find(p => p.fullPath === '/');
      expect(rootPath).toBeDefined();
      expect(rootPath.pathType).toBe('directory');
      expect(rootPath.owner.uid).toBe('0x12345');
    });
  });

  describe('Real Data Integration', () => {
    it('should handle real SPK contract data format', async () => {
      mockDgraphClient.query.mockResolvedValue({
        account: [{ uid: '0x77c8d' }]
      });

      // Real data from SPK testnet
      const realContractData = {
        a: 10000,
        b: '',
        c: 3,
        f: 'disregardfiat',
        t: 'disregardfiat',
        df: {
          'QmNtnyxRkgL8qQHyvxszYtoibYKi4Ar8xiorHJLjE5qLET': 7706,
          'QmPHwNRwJviUH9gYqBcqdwt7Sm75temVGYdDbHJQ47P8gw': 8446
        },
        m: '1|NFTs,thumbdc05-8c0icj7w,jpg.1,thumb,0--,thumbdcb5-jryrjh20,jpg.1,thumb,0--',
        p: 5000,
        r: 0,
        u: 1023
      };

      const mutations = await transformer.transformOperation({
        type: 'put',
        path: ['contract', 'disregardfiat', '93273146-061aa8e8d79a033ed70e27572c31bba071369582'],
        data: realContractData,
        blockNum: 93273146,
        timestamp: Date.now()
      });

      expect(mutations.length).toBeGreaterThan(0);

      const contractMutation = mutations.find(m => m['dgraph.type'] === 'StorageContract');
      expect(contractMutation).toMatchObject({
        'dgraph.type': 'StorageContract',
        id: 'disregardfiat:0:93273146-061aa8e8d79a033ed70e27572c31bba071369582',
        status: 3,
        authorized: 10000,
        power: 5000,
        utilized: 1023,
        fileCount: 2
      });

      // Should have account
      const accountMutation = mutations.find(m => m['dgraph.type'] === 'Account');
      expect(accountMutation.uid).toBe('0x77c8d');
      expect(accountMutation.username).toBe('disregardfiat');
    });
  });
});