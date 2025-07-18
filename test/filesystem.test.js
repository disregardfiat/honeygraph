import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { createFileSystemRoutes } from '../routes/filesystem.js';

describe('FileSystem API', () => {
  let app;
  let mockDgraphClient;

  beforeEach(() => {
    // Setup mock Dgraph client
    mockDgraphClient = {
      namespace: 'default',
      query: jest.fn(),
      client: {
        newTxn: jest.fn(() => ({
          queryWithVars: jest.fn(),
          discard: jest.fn()
        }))
      }
    };

    // Create Express app with routes
    app = express();
    app.use('/', createFileSystemRoutes({ dgraphClient: mockDgraphClient }));
  });

  describe('GET /fs/:username/', () => {
    it('should return preset folders for user with no contracts', async () => {
      // Mock user query response
      mockDgraphClient.query
        .mockResolvedValueOnce({ user: [{ uid: '0x12345', username: 'testuser' }] })
        .mockResolvedValueOnce({ path: [{ 
          fullPath: '/', 
          pathName: 'Root', 
          pathType: 'directory',
          children: [
            { fullPath: '/malformed', pathType: 'file' }
          ]
        }] });

      const response = await request(app)
        .get('/fs/testuser/')
        .expect(200);

      expect(response.body.path).toBe('/');
      expect(response.body.username).toBe('testuser');
      expect(response.body.type).toBe('directory');
      
      // Should have preset folders even with no contracts
      const folderNames = response.body.contents.map(item => item.name);
      expect(folderNames).toContain('Documents');
      expect(folderNames).toContain('Images');
      expect(folderNames.length).toBeGreaterThan(0);
    });

    it('should return contracts where user is owner (not purchaser)', async () => {
      // Mock user query response first, then path query
      mockDgraphClient.query
        .mockResolvedValueOnce({ user: [{ uid: '0x12345', username: 'testuser' }] })
        .mockResolvedValueOnce({ path: [] }); // No paths initially

      await request(app)
        .get('/fs/testuser/')
        .expect(200);
    });

    it('should show preset folders at root level', async () => {
      // Mock user query response first, then path query with preset folders
      mockDgraphClient.query
        .mockResolvedValueOnce({ user: [{ uid: '0x12345', username: 'testuser' }] })
        .mockResolvedValueOnce({ path: [{ 
          fullPath: '/', 
          pathName: 'Root', 
          pathType: 'directory',
          children: []
        }] });

      const response = await request(app)
        .get('/fs/testuser/')
        .expect(200);

      const folderNames = response.body.contents.map(item => item.name);
      expect(folderNames).toContain('Documents');
      expect(folderNames).toContain('Images');
      expect(folderNames).toContain('Videos');
      expect(folderNames).toContain('Music');
    });

    it('should include custom folders from contracts', async () => {
      // Mock user query response first, then path query with custom folders
      mockDgraphClient.query
        .mockResolvedValueOnce({ user: [{ uid: '0x12345', username: 'testuser' }] })
        .mockResolvedValueOnce({ path: [{ 
          fullPath: '/', 
          pathName: 'Root', 
          pathType: 'directory',
          children: [
            { fullPath: '/NFTs', pathName: 'NFTs', pathType: 'directory' },
            { fullPath: '/NFTs/Resources', pathName: 'Resources', pathType: 'directory' }
          ]
        }] });

      const response = await request(app)
        .get('/fs/testuser/')
        .expect(200);

      const folderNames = response.body.contents.map(item => item.name);
      expect(folderNames).toContain('NFTs');
      expect(folderNames).toContain('Documents'); // Preset folders still included
    });

    it('should show subfolders when navigating to parent folder', async () => {
      // Mock user query response first, then path query for NFTs folder
      mockDgraphClient.query
        .mockResolvedValueOnce({ user: [{ uid: '0x12345', username: 'testuser' }] })
        .mockResolvedValueOnce({ path: [{ 
          fullPath: '/NFTs', 
          pathName: 'NFTs', 
          pathType: 'directory',
          children: [
            { fullPath: '/NFTs/Resources', pathName: 'Resources', pathType: 'directory', itemCount: 1 }
          ]
        }] });

      const response = await request(app)
        .get('/fs/testuser/NFTs/')
        .expect(200);

      const items = response.body.contents;
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({
        name: 'Resources',
        type: 'directory',
        path: '/NFTs/Resources',
        itemCount: 1
      });
    });

    it('should calculate correct item counts for directories', async () => {
      const mockContracts = [
        {
          id: 'testuser:0:12345',
          blockNumber: 12345,
          status: 3,
          owner: { username: 'testuser' },
          purchaser: { username: 'testuser' },
          files: [
            { cid: 'Qm1', name: 'doc1.txt', extension: 'txt', size: 100, path: '/Documents', flags: 0, license: 'MIT', labels: 'document', thumbnail: '' },
            { cid: 'Qm2', name: 'doc2.txt', extension: 'txt', size: 200, path: '/Documents', flags: 0, license: '', labels: '', thumbnail: '' },
            { cid: 'Qm3', name: 'img1.jpg', extension: 'jpg', size: 300, path: '/Images', flags: 0, license: 'CC0', labels: 'image,photo', thumbnail: 'QmThumb123' },
            { cid: 'Qm4', name: 'thumb.jpg', extension: 'jpg', size: 50, path: '/Images', flags: 2, license: '', labels: '', thumbnail: '' } // Should be excluded
          ],
          metadata: JSON.stringify({})
        }
      ];

      const mockTxn = {
        queryWithVars: jest.fn().mockResolvedValue({
          getJson: () => ({ contracts: mockContracts })
        }),
        discard: jest.fn()
      };
      mockDgraphClient.client.newTxn.mockReturnValue(mockTxn);

      const response = await request(app)
        .get('/fs/testuser/')
        .expect(200);

      const documentsFolder = response.body.contents.find(item => item.name === 'Documents');
      const imagesFolder = response.body.contents.find(item => item.name === 'Images');
      
      expect(documentsFolder.itemCount).toBe(2);
      expect(imagesFolder.itemCount).toBe(1); // Thumbnail excluded
    });

    it('should handle contracts with owner different from purchaser', async () => {
      const mockContracts = [
        {
          id: 'purchaser:0:12345',
          blockNumber: 12345,
          status: 3,
          owner: { username: 'fileowner' },
          purchaser: { username: 'purchaser' },
          files: [
            { cid: 'Qm1', name: 'shared.txt', extension: 'txt', size: 100, path: '/', flags: 0, license: 'MIT', labels: 'shared', thumbnail: '', mimeType: 'text/plain' }
          ],
          metadata: JSON.stringify({})
        }
      ];

      const mockTxn = {
        queryWithVars: jest.fn().mockResolvedValue({
          getJson: () => ({ contracts: mockContracts })
        }),
        discard: jest.fn()
      };
      mockDgraphClient.client.newTxn.mockReturnValue(mockTxn);

      // Query for fileowner (who owns the files)
      const response = await request(app)
        .get('/fs/fileowner/')
        .expect(200);

      expect(response.body.contents).toHaveLength(9); // 8 preset folders + 1 file
      const file = response.body.contents.find(item => item.type === 'file');
      expect(file.name).toBe('shared.txt');

      // Query for purchaser (who paid but doesn't own files)
      mockTxn.queryWithVars.mockResolvedValue({
        getJson: () => ({ contracts: [] }) // No contracts where purchaser is owner
      });

      const response2 = await request(app)
        .get('/fs/purchaser/')
        .expect(200);

      // Should only see preset folders, no files
      expect(response2.body.contents.every(item => item.type === 'directory')).toBe(true);
    });

    it('should include all file metadata fields', async () => {
      const mockContracts = [
        {
          id: 'testuser:0:12345',
          blockNumber: 12345,
          status: 3,
          owner: { username: 'testuser' },
          purchaser: { username: 'testuser' },
          encryptionData: '1#key123',
          storageNodes: [
            { storageAccount: { username: 'node1' }, validated: true },
            { storageAccount: { username: 'node2' }, validated: true },
            { storageAccount: { username: 'node3' }, validated: false }
          ],
          files: [
            { 
              cid: 'QmTest123', 
              name: 'test-file', 
              extension: 'json',
              size: 1024, 
              path: '/', 
              flags: 0,
              license: 'MIT',
              labels: 'test,data',
              thumbnail: 'QmThumb456'
            }
          ],
          metadata: JSON.stringify({
            encrypted: true,
            autoRenew: false,
            folderStructure: '{"1": "/"}'
          })
        }
      ];

      const mockTxn = {
        queryWithVars: jest.fn().mockResolvedValue({
          getJson: () => ({ contracts: mockContracts })
        }),
        discard: jest.fn()
      };
      mockDgraphClient.client.newTxn.mockReturnValue(mockTxn);

      const response = await request(app)
        .get('/fs/testuser/')
        .expect(200);

      const file = response.body.contents.find(item => item.type === 'file');
      expect(file).toEqual({
        name: 'test-file',
        type: 'file',
        cid: 'QmTest123',
        extension: 'json',
        size: 1024,
        mimeType: undefined,
        license: 'MIT',
        labels: 'test,data',
        thumbnail: 'QmThumb456',
        contract: {
          id: 'testuser:0:12345',
          blockNumber: 12345,
          encryptionData: '1#key123',
          storageNodeCount: 2
        },
        metadata: {
          encrypted: true,
          autoRenew: false
        }
      });
    });
  });

  describe('GET /fs/:username/path/to/file.ext', () => {
    it('should redirect to IPFS gateway for file requests', async () => {
      const mockFile = {
        cid: 'QmTest123',
        name: 'test.jpg',
        size: 1024,
        mimeType: 'image/jpeg',
        extension: 'jpg',
        license: 'MIT',
        labels: 'test',
        thumbnail: 'QmThumb123',
        path: '/Images',
        flags: 0,
        contract: {
          id: 'testuser:0:12345',
          blockNumber: 12345,
          purchaser: { username: 'testuser' }
        }
      };

      const mockTxn = {
        queryWithVars: jest.fn().mockResolvedValue({
          getJson: () => ({ files: [mockFile] })
        }),
        discard: jest.fn()
      };
      mockDgraphClient.client.newTxn.mockReturnValue(mockTxn);

      const response = await request(app)
        .get('/fs/testuser/Images/test.jpg')
        .expect(302);

      expect(response.headers.location).toContain('/ipfs/QmTest123');
      expect(response.headers['x-ipfs-cid']).toBe('QmTest123');
    });
  });
});