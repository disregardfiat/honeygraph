import { jest } from '@jest/globals';
import { createDataTransformer } from '../lib/data-transformer.js';

describe('Data Transformer - Path Creation', () => {
  let transformer;
  let mockDgraphClient;
  let mockNetworkManager;

  beforeEach(() => {
    mockDgraphClient = {
      namespace: 'default',
      query: jest.fn(),
      addNamespacePrefix: jest.fn(data => data) // Mock passthrough
    };

    mockNetworkManager = {
      getNetwork: jest.fn(() => ({ dgraphClient: mockDgraphClient }))
    };

    transformer = createDataTransformer(mockDgraphClient, mockNetworkManager);
  });

  describe('Account Deduplication', () => {
    it('should reuse existing account UIDs from database', async () => {
      // Mock existing account query
      mockDgraphClient.query.mockResolvedValue({
        account: [{ uid: '0x12345' }]
      });

      const mutations = {
        accounts: new Map(),
        other: []
      };

      const accountUid = await transformer.ensureAccount('testuser', mutations);

      expect(mockDgraphClient.query).toHaveBeenCalledWith(
        '{ account(func: eq(username, "testuser"), first: 1) { uid } }'
      );
      expect(accountUid).toBe('0x12345');
      expect(mutations.accounts.get('testuser').uid).toBe('0x12345');
    });

    it('should create new account when none exists', async () => {
      // Mock no existing account
      mockDgraphClient.query.mockResolvedValue({
        account: []
      });

      const mutations = {
        accounts: new Map(),
        other: []
      };

      const accountUid = await transformer.ensureAccount('newuser', mutations);

      expect(accountUid).toMatch(/^_:account_newuser$/);
      expect(mutations.accounts.get('newuser')).toMatchObject({
        uid: accountUid,
        username: 'newuser',
        'dgraph.type': 'Account'
      });
    });

    it('should handle usernames with special characters', async () => {
      mockDgraphClient.query.mockResolvedValue({
        account: []
      });

      const mutations = {
        accounts: new Map(),
        other: []
      };

      const accountUid = await transformer.ensureAccount('user.with-dash', mutations);

      // Should replace dots and dashes in UID
      expect(accountUid).toBe('_:account_user_with_dash');
    });
  });

  describe('Path Creation', () => {
    beforeEach(() => {
      // Mock account creation
      mockDgraphClient.query.mockResolvedValue({
        account: [{ uid: '0x12345' }]
      });
    });

    it('should create root directory path', async () => {
      const mutations = {
        accounts: new Map(),
        paths: new Map(),
        other: []
      };

      await transformer.getOrCreatePath('testuser', '/', 'directory', mutations);

      const rootPath = mutations.paths.get('testuser:/');
      expect(rootPath).toMatchObject({
        'dgraph.type': 'Path',
        fullPath: '/',
        pathName: 'Root',
        pathType: 'directory',
        owner: { uid: '0x12345' },
        children: [],
        itemCount: 0
      });
    });

    it('should create nested directory paths with parent relationships', async () => {
      const mutations = {
        accounts: new Map(),
        paths: new Map(),
        other: []
      };

      await transformer.getOrCreatePath('testuser', '/Documents/Projects', 'directory', mutations);

      // Should create all parent paths
      expect(mutations.paths.has('testuser:/')).toBe(true);
      expect(mutations.paths.has('testuser:/Documents')).toBe(true);
      expect(mutations.paths.has('testuser:/Documents/Projects')).toBe(true);

      const projectsPath = mutations.paths.get('testuser:/Documents/Projects');
      expect(projectsPath.pathName).toBe('Projects');
      expect(projectsPath.parent).toMatchObject({
        uid: expect.stringMatching(/^_:path_/)
      });
    });

    it('should create file paths with proper metadata', async () => {
      const mutations = {
        accounts: new Map(),
        paths: new Map(),
        other: []
      };

      const fileMutation = {
        uid: '_:file_123',
        cid: 'QmTest123',
        name: 'test.jpg',
        size: 1024
      };

      const contractMutation = {
        uid: '_:contract_456',
        id: 'testuser:0:12345',
        blockNumber: 12345
      };

      await transformer.updatePathWithFile('testuser', '/Images/test.jpg', fileMutation, contractMutation, mutations);

      const filePath = mutations.paths.get('testuser:/Images/test.jpg');
      expect(filePath).toMatchObject({
        'dgraph.type': 'Path',
        fullPath: '/Images/test.jpg',
        pathName: 'test.jpg',
        pathType: 'directory', // updatePathWithFile creates directory paths that contain files
        currentFile: { uid: '_:file_123' },
        owner: { uid: '0x12345' }
      });
    });

    it('should update path item counts when files are added', async () => {
      const mutations = {
        accounts: new Map(),
        paths: new Map(),
        other: []
      };

      // Create some files in different directories
      const files = [
        { path: '/Documents', name: 'doc1.txt' },
        { path: '/Documents', name: 'doc2.txt' },
        { path: '/Images', name: 'img1.jpg' }
      ];

      for (const file of files) {
        const fileMutation = {
          uid: `_:file_${file.name}`,
          name: file.name
        };
        const contractMutation = { uid: '_:contract_test' };
        
        await transformer.updatePathWithFile('testuser', `${file.path}/${file.name}`, fileMutation, contractMutation, mutations);
      }

      await transformer.calculatePathCounts(mutations);

      const documentsPath = mutations.paths.get('testuser:/Documents');
      const imagesPath = mutations.paths.get('testuser:/Images');
      const rootPath = mutations.paths.get('testuser:/');

      expect(documentsPath.itemCount).toBe(2);
      expect(imagesPath.itemCount).toBe(1);
      expect(rootPath.itemCount).toBe(2); // 2 subdirectories
    });

    it('should handle path names with special characters', async () => {
      const mutations = {
        accounts: new Map(),
        paths: new Map(),
        other: []
      };

      await transformer.getOrCreatePath('testuser', '/Documents/My Files & Photos', 'directory', mutations);

      const path = mutations.paths.get('testuser:/Documents/My Files & Photos');
      expect(path.pathName).toBe('My Files & Photos');
      expect(path.fullPath).toBe('/Documents/My Files & Photos');
    });
  });

  describe('Contract Processing with Path Creation', () => {
    it('should create paths for all files in a contract', async () => {
      mockDgraphClient.query.mockResolvedValue({
        account: [{ uid: '0x12345' }]
      });

      const contractData = {
        f: 'fileowner',
        t: 'fileowner', 
        c: 3, // status = 3 (active)
        df: {
          'QmFile1': 1024,
          'QmFile2': 2048
        },
        m: '1|subfolder,file1,txt.1,thumb,0--,file2,jpg.1,thumb,0--'
      };

      const mutations = await transformer.transformOperation({
        type: 'put',
        path: ['contract', 'fileowner', 'test123'],
        data: contractData,
        blockNum: 12345,
        timestamp: Date.now()
      });

      expect(mutations.length).toBeGreaterThan(0);
      
      // Verify contract mutation exists
      const contractMutation = mutations.find(m => m['dgraph.type'] === 'StorageContract');
      expect(contractMutation).toBeDefined();
      expect(contractMutation.status).toBe(3);

      // Verify file mutations exist
      const fileMutations = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
      expect(fileMutations).toHaveLength(2);

      // Verify path mutations exist
      const pathMutations = mutations.filter(m => m['dgraph.type'] === 'Path');
      expect(pathMutations.length).toBeGreaterThan(0);

      // Should have root, subfolder, and file paths
      const pathsByType = pathMutations.reduce((acc, p) => {
        acc[p.pathType] = acc[p.pathType] || [];
        acc[p.pathType].push(p);
        return acc;
      }, {});

      expect(pathsByType.directory).toBeDefined();
      expect(pathsByType.file).toBeDefined();
    });

    it('should handle contracts with complex metadata', async () => {
      mockDgraphClient.query.mockResolvedValue({
        account: [{ uid: '0x12345' }]
      });

      const contractData = {
        f: 'testuser',
        t: 'testuser',
        c: 3,
        df: {
          'QmTest': 1024
        },
        m: '1#encdata|folder1|subfolder,filename,ext.0,thumb,0-license-labels'
      };

      const mutations = await transformer.transformOperation({
        type: 'put',
        path: ['contract', 'testuser', 'complex123'],
        data: contractData,
        blockNum: 12345,
        timestamp: Date.now()
      });

      // Should parse metadata and create appropriate paths
      const pathMutations = mutations.filter(m => m['dgraph.type'] === 'Path');
      const filePaths = pathMutations.filter(p => p.pathType === 'file');
      
      expect(filePaths.length).toBeGreaterThan(0);
      
      // Should have parsed file metadata
      const fileWithMetadata = filePaths.find(p => p.currentFile);
      expect(fileWithMetadata).toBeDefined();
    });
  });

  describe('Universal Account Integration', () => {
    it('should use consistent UID patterns across network prefixes', async () => {
      // Simulate account exists from previous network
      mockDgraphClient.query.mockResolvedValue({
        account: [{ uid: '0x77c8d' }]
      });

      const mutations = {
        accounts: new Map(),
        paths: new Map(),
        other: []
      };

      const uid1 = await transformer.ensureAccount('disregardfiat', mutations);
      const uid2 = await transformer.ensureAccount('disregardfiat', mutations);

      // Should reuse the same UID
      expect(uid1).toBe('0x77c8d');
      expect(uid2).toBe('0x77c8d');
      expect(mutations.accounts.size).toBe(1);
    });

    it('should create paths that reference universal account UIDs', async () => {
      mockDgraphClient.query.mockResolvedValue({
        account: [{ uid: '0x77c8d' }]
      });

      const mutations = {
        accounts: new Map(),
        paths: new Map(),
        other: []
      };

      await transformer.getOrCreatePath('disregardfiat', '/Ragnarok', 'directory', mutations);

      const path = mutations.paths.get('disregardfiat:/Ragnarok');
      expect(path.owner.uid).toBe('0x77c8d');
    });
  });
});