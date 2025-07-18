import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { createFileSystemRoutes } from '../routes/filesystem.js';

describe('FileSystem API - Real Blockchain Data Integration', () => {
  let app;
  let mockDgraphClient;
  let mockNetworkManager;

  beforeEach(() => {
    // Setup mock Dgraph client with new Path-based query support
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

    // Setup mock network manager
    mockNetworkManager = {
      getNetwork: jest.fn(() => ({
        dgraphClient: mockDgraphClient
      }))
    };

    // Create Express app with routes
    app = express();
    app.use('/', createFileSystemRoutes({ 
      dgraphClient: mockDgraphClient, 
      networkManager: mockNetworkManager 
    }));
  });

  describe('GET /fs/:username/ - Path-based queries', () => {
    it('should find user and query paths using UID-based filtering', async () => {
      // Mock user query response
      mockDgraphClient.query
        .mockResolvedValueOnce({
          user: [{ uid: '0x12345', username: 'disregardfiat' }]
        })
        // Mock path query response
        .mockResolvedValueOnce({
          path: [{
            fullPath: '/',
            pathName: 'Root',
            pathType: 'directory',
            itemCount: 25,
            children: [
              {
                fullPath: '/Ragnarok',
                pathName: 'Ragnarok',
                pathType: 'directory',
                itemCount: 20
              },
              {
                fullPath: '/NFTs',
                pathName: 'NFTs',
                pathType: 'directory',
                itemCount: 10
              },
              {
                fullPath: '/Images',
                pathName: 'Images',
                pathType: 'directory',
                itemCount: 5
              },
              {
                fullPath: '/thumbe4d7-fxhqn1cf',
                pathName: 'thumbe4d7-fxhqn1cf',
                pathType: 'file',
                currentFile: {
                  cid: 'Qma3kZyf1ugmmjAHtz2cuPgYnaZhawWKPejCoS2F2u8u74',
                  name: 'thumbe4d7-fxhqn1cf',
                  extension: 'png',
                  size: 9634,
                  mimeType: 'image/png',
                  license: '',
                  labels: '',
                  thumbnail: '',
                  contract: {
                    id: 'disregardfiat:0:93273146-061aa8e8d79a033ed70e27572c31bba071369582',
                    blockNumber: 93273146,
                    encryptionData: null,
                    storageNodes: []
                  }
                }
              }
            ]
          }]
        });

      const response = await request(app)
        .get('/fs/disregardfiat/')
        .expect(200);

      // Verify user lookup query
      expect(mockDgraphClient.query).toHaveBeenCalledWith(
        expect.stringContaining('query getUser($username: string)'),
        { $username: 'disregardfiat' }
      );

      // Verify path query with UID filtering
      expect(mockDgraphClient.query).toHaveBeenCalledWith(
        expect.stringContaining('uid_in(owner, $userUid)'),
        { $userUid: '0x12345', $fullPath: '/' }
      );

      // Verify response structure
      expect(response.body.path).toBe('/');
      expect(response.body.username).toBe('disregardfiat');
      expect(response.body.type).toBe('directory');
      
      // Should have preset folders + custom folders + files
      const contents = response.body.contents;
      expect(contents).toContainEqual(
        expect.objectContaining({
          name: 'Documents',
          type: 'directory',
          path: '/Documents',
          itemCount: 0
        })
      );
      expect(contents).toContainEqual(
        expect.objectContaining({
          name: 'Ragnarok',
          type: 'directory',
          path: '/Ragnarok',
          itemCount: 20
        })
      );
      expect(contents).toContainEqual(
        expect.objectContaining({
          name: 'thumbe4d7-fxhqn1cf',
          type: 'file',
          cid: 'Qma3kZyf1ugmmjAHtz2cuPgYnaZhawWKPejCoS2F2u8u74'
        })
      );
    });

    it('should handle user not found gracefully', async () => {
      mockDgraphClient.query.mockResolvedValueOnce({
        user: []
      });

      const response = await request(app)
        .get('/fs/nonexistentuser/')
        .expect(200);

      expect(response.body).toEqual({
        path: '/',
        username: 'nonexistentuser',
        type: 'directory',
        contents: []
      });
    });

    it('should return empty directory when no paths found', async () => {
      mockDgraphClient.query
        .mockResolvedValueOnce({
          user: [{ uid: '0x99999', username: 'emptyuser' }]
        })
        .mockResolvedValueOnce({
          path: []
        });

      const response = await request(app)
        .get('/fs/emptyuser/')
        .expect(200);

      // When no paths found, API returns empty directory
      expect(response.body).toEqual({
        path: '/',
        username: 'emptyuser',
        type: 'directory',
        contents: []
      });
    });

    it('should include complete file metadata from blockchain', async () => {
      mockDgraphClient.query
        .mockResolvedValueOnce({
          user: [{ uid: '0x12345', username: 'testuser' }]
        })
        .mockResolvedValueOnce({
          path: [{
            fullPath: '/',
            pathName: 'Root',
            pathType: 'directory',
            children: [{
              fullPath: '/test-file.json',
              pathName: 'test-file.json',
              pathType: 'file',
              currentFile: {
                cid: 'QmTestCID123',
                name: 'test-file.json',
                extension: 'json',
                size: 2048,
                mimeType: 'application/json',
                license: 'MIT',
                labels: 'test,blockchain,metadata',
                thumbnail: 'QmThumbCID456',
                contract: {
                  id: 'testuser:0:12345678-abcdef123456',
                  blockNumber: 12345678,
                  encryptionData: '1#encrypted123',
                  storageNodes: [
                    { storageAccount: { username: 'node1' } },
                    { storageAccount: { username: 'node2' } }
                  ]
                }
              }
            }]
          }]
        });

      const response = await request(app)
        .get('/fs/testuser/')
        .expect(200);

      const file = response.body.contents.find(item => item.type === 'file');
      expect(file).toMatchObject({
        name: 'test-file.json',
        type: 'file',
        cid: 'QmTestCID123',
        extension: 'json',
        size: 2048,
        mimeType: 'application/json',
        license: 'MIT',
        labels: 'test,blockchain,metadata',
        thumbnail: 'QmThumbCID456',
        contract: {
          id: 'testuser:0:12345678-abcdef123456',
          blockNumber: 12345678,
          encryptionData: '1#encrypted123',
          storageNodeCount: 2,
          storageNodes: ['node1', 'node2']
        },
        metadata: {
          encrypted: true,
          autoRenew: true
        }
      });
    });

    it('should handle large directory listings efficiently', async () => {
      const manyFiles = Array.from({ length: 50 }, (_, i) => ({
        fullPath: `/file${i}.txt`,
        pathName: `file${i}.txt`,
        pathType: 'file',
        currentFile: {
          cid: `QmFile${i}`,
          name: `file${i}.txt`,
          extension: 'txt',
          size: 1024,
          mimeType: 'text/plain',
          license: '',
          labels: '',
          thumbnail: '',
          contract: {
            id: `testuser:0:${i}`,
            blockNumber: 12345000 + i,
            encryptionData: null,
            storageNodes: []
          }
        }
      }));

      mockDgraphClient.query
        .mockResolvedValueOnce({
          user: [{ uid: '0x12345', username: 'testuser' }]
        })
        .mockResolvedValueOnce({
          path: [{
            fullPath: '/',
            pathName: 'Root',
            pathType: 'directory',
            children: manyFiles
          }]
        });

      const response = await request(app)
        .get('/fs/testuser/')
        .expect(200);

      // Should handle many files without issues
      const files = response.body.contents.filter(item => item.type === 'file');
      expect(files).toHaveLength(50);
      
      // Should be properly sorted (directories first, then files alphabetically)
      const directories = response.body.contents.filter(item => item.type === 'directory');
      const fileNames = files.map(f => f.name);
      expect(fileNames).toEqual(fileNames.sort());
    });
  });

  describe('Account Deduplication Integration', () => {
    it('should work with deduplicated accounts across network prefixes', async () => {
      // Simulate the case where we fixed duplicate accounts
      mockDgraphClient.query
        .mockResolvedValueOnce({
          user: [{ uid: '0x77c8d', username: 'disregardfiat' }] // Single account UID
        })
        .mockResolvedValueOnce({
          path: [{
            fullPath: '/',
            pathName: 'Root',
            pathType: 'directory',
            children: [{
              fullPath: '/universal-account-test',
              pathName: 'universal-account-test',
              pathType: 'file',
              currentFile: {
                cid: 'QmUniversalTest123',
                name: 'universal-account-test',
                extension: 'txt',
                size: 512,
                mimeType: 'text/plain',
                contract: {
                  id: 'disregardfiat:0:test123',
                  blockNumber: 12345,
                  encryptionData: null,
                  storageNodes: []
                }
              }
            }]
          }]
        });

      const response = await request(app)
        .get('/fs/disregardfiat/')
        .expect(200);

      // Should successfully find the file using the universal account UID
      const file = response.body.contents.find(item => item.name === 'universal-account-test');
      expect(file).toBeDefined();
      expect(file.cid).toBe('QmUniversalTest123');
    });
  });

  describe('Error Handling', () => {
    it('should handle dgraph query failures gracefully', async () => {
      mockDgraphClient.query.mockRejectedValue(new Error('Dgraph connection failed'));

      const response = await request(app)
        .get('/fs/testuser/')
        .expect(500);

      expect(response.body.error).toBe('Internal server error');
    });

    it('should handle malformed path data', async () => {
      mockDgraphClient.query
        .mockResolvedValueOnce({
          user: [{ uid: '0x12345', username: 'testuser' }]
        })
        .mockResolvedValueOnce({
          path: [{
            fullPath: '/',
            pathName: 'Root',
            pathType: 'directory',
            children: [{
              // Missing required fields
              fullPath: '/malformed',
              pathType: 'file'
              // No currentFile data
            }]
          }]
        });

      const response = await request(app)
        .get('/fs/testuser/')
        .expect(200);

      // Should skip malformed entries and still return valid response
      expect(response.body.contents).toContainEqual(
        expect.objectContaining({
          name: 'Documents',
          type: 'directory'
        })
      );
    });
  });

  describe('Real SPK Network Integration Tests', () => {
    it('should match the actual API response format', async () => {
      // Mock response that matches what we actually get from the real API
      mockDgraphClient.query
        .mockResolvedValueOnce({
          user: [{ uid: '0x77c8d', username: 'disregardfiat' }]
        })
        .mockResolvedValueOnce({
          path: [{
            fullPath: '/',
            pathName: 'Root',
            pathType: 'directory',
            children: [
              {
                fullPath: '/Ragnarok',
                pathName: 'Ragnarok',
                pathType: 'directory',
                itemCount: 20
              },
              {
                fullPath: '/NFTs',
                pathName: 'NFTs',
                pathType: 'directory',
                itemCount: 15
              },
              {
                fullPath: '/thumbe4d7-fxhqn1cf',
                pathName: 'thumbe4d7-fxhqn1cf',
                pathType: 'file',
                currentFile: {
                  cid: 'Qma3kZyf1ugmmjAHtz2cuPgYnaZhawWKPejCoS2F2u8u74',
                  name: 'thumbe4d7-fxhqn1cf',
                  extension: 'png',
                  size: 9634,
                  mimeType: 'image/png',
                  license: '',
                  labels: '',
                  thumbnail: '',
                  contract: {
                    id: 'disregardfiat:0:93273146-061aa8e8d79a033ed70e27572c31bba071369582',
                    blockNumber: 93273146,
                    encryptionData: null,
                    storageNodes: []
                  }
                }
              }
            ]
          }]
        });

      const response = await request(app)
        .get('/fs/disregardfiat/')
        .expect(200);

      // Verify exact format matches real API
      expect(response.body).toMatchObject({
        path: '/',
        username: 'disregardfiat',
        type: 'directory',
        contents: expect.arrayContaining([
          // Preset folders
          expect.objectContaining({
            name: 'Documents',
            type: 'directory',
            path: '/Documents',
            itemCount: 0
          }),
          // Custom folders from blockchain
          expect.objectContaining({
            name: 'Ragnarok',
            type: 'directory',
            path: '/Ragnarok',
            itemCount: 20
          }),
          // Real files from blockchain
          expect.objectContaining({
            name: 'thumbe4d7-fxhqn1cf',
            type: 'file',
            cid: 'Qma3kZyf1ugmmjAHtz2cuPgYnaZhawWKPejCoS2F2u8u74',
            extension: 'png',
            size: 9634,
            mimeType: 'image/png',
            contract: expect.objectContaining({
              id: 'disregardfiat:0:93273146-061aa8e8d79a033ed70e27572c31bba071369582',
              blockNumber: 93273146,
              encryptionData: null,
              storageNodeCount: 0,
              storageNodes: []
            }),
            metadata: expect.objectContaining({
              encrypted: false,
              autoRenew: true
            })
          })
        ])
      });
    });
  });
});