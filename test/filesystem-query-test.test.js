import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { createFileSystemRoutes } from '../routes/filesystem.js';
import { createDataTransformer } from '../lib/data-transformer.js';

describe('Filesystem Query Test', () => {
  let app;
  let mockDgraphClient;
  let mockNetworkManager;

  beforeEach(() => {
    // Setup mock Dgraph client
    mockDgraphClient = {
      namespace: 'spkccT_',
      query: jest.fn(),
      queryGlobal: jest.fn(),
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
        dgraphClient: mockDgraphClient,
        namespace: 'spkccT_'
      }))
    };

    // Create Express app with routes
    app = express();
    app.use('/', createFileSystemRoutes({ dgraphClient: mockDgraphClient, networkManager: mockNetworkManager }));
  });

  describe('Global Account Query', () => {
    it('should use queryGlobal for finding user accounts', async () => {
      // Mock user query response
      mockDgraphClient.queryGlobal.mockResolvedValueOnce({ 
        user: [{ 
          uid: '0x123', 
          username: 'testuser' 
        }] 
      });
      
      // Mock paths query response - empty since we're at root
      mockDgraphClient.query.mockResolvedValueOnce({ 
        paths: [],
        totalPaths: [{ count: 0 }]
      });

      const response = await request(app)
        .get('/fs/testuser/')
        .expect(200);

      // Verify queryGlobal was called for user lookup
      expect(mockDgraphClient.queryGlobal).toHaveBeenCalledWith(
        expect.stringContaining('user(func: eq(username, $username))'),
        { $username: 'testuser' }
      );

      // Verify the response includes preset folders when no paths exist
      expect(response.body.contents).toBeDefined();
      expect(response.body.contents.length).toBeGreaterThan(0);
      // Should have preset folders like Documents, Images, etc.
      const docsDir = response.body.contents.find(c => c.name === 'Documents');
      expect(docsDir).toBeDefined();
      expect(docsDir.type).toBe('directory');
    });

    it('should handle case when queryGlobal is not available', async () => {
      // Remove queryGlobal to test fallback
      delete mockDgraphClient.queryGlobal;
      
      // Mock regular query response
      mockDgraphClient.query
        .mockResolvedValueOnce({ user: [{ uid: '0x123', username: 'testuser' }] })
        .mockResolvedValueOnce({ paths: [] });

      const response = await request(app)
        .get('/fs/testuser/')
        .expect(200);

      // Should fall back to regular query
      expect(mockDgraphClient.query).toHaveBeenCalledWith(
        expect.stringContaining('user(func: eq(username, $username))'),
        { $username: 'testuser' }
      );
    });
  });

  describe('Path-File Associations', () => {
    it('should properly display files in directories', async () => {
      // Setup user
      mockDgraphClient.queryGlobal.mockResolvedValueOnce({ 
        user: [{ uid: '0x123', username: 'fileuser' }] 
      });
      
      // Setup paths with files
      mockDgraphClient.query.mockResolvedValueOnce({ 
        paths: [
          {
            fullPath: '/',
            pathName: '',  // Root path has empty name
            pathType: 'directory',
            itemCount: 2,
            files: [
              {
                uid: '0x456',
                cid: 'QmFile1',
                name: 'document.pdf',
                size: 2048,
                flags: 0,
                contract: {
                  id: 'contract1',
                  blockNumber: 12345
                }
              },
              {
                uid: '0x457',
                cid: 'QmFile2',
                name: 'image.png',
                size: 4096,
                flags: 0,
                contract: {
                  id: 'contract2',
                  blockNumber: 12346
                }
              }
            ]
          },
          {
            fullPath: '/Documents',
            pathName: 'Documents',
            pathType: 'directory',
            itemCount: 1,
            files: [
              {
                uid: '0x458',
                cid: 'QmFile3',
                name: 'report.doc',
                size: 8192,
                flags: 0,
                contract: {
                  id: 'contract3',
                  blockNumber: 12347
                }
              }
            ]
          }
        ],
        totalPaths: [{ count: 2 }]
      });

      const response = await request(app)
        .get('/fs/fileuser/')
        .expect(200);

      // Check response structure
      expect(response.body.type).toBe('directory');
      expect(response.body.username).toBe('fileuser');
      expect(response.body.contents).toBeInstanceOf(Array);
      
      // Find Documents directory
      const docsDir = response.body.contents.find(c => c.name === 'Documents');
      expect(docsDir).toBeDefined();
      expect(docsDir.type).toBe('directory');
      expect(docsDir.itemCount).toBe(1);
      
      // Check for files in root
      const files = response.body.contents.filter(c => c.type === 'file');
      expect(files.length).toBe(2);
      
      const pdfFile = files.find(f => f.name === 'document.pdf');
      expect(pdfFile).toBeDefined();
      expect(pdfFile.size).toBe(2048);
    });
  });

  describe('Empty Filesystem Handling', () => {
    it('should show preset folders when no paths exist', async () => {
      // User exists but has no paths
      mockDgraphClient.queryGlobal.mockResolvedValueOnce({ 
        user: [{ uid: '0x123', username: 'emptyuser' }] 
      });
      
      // No paths found
      mockDgraphClient.query.mockResolvedValueOnce({ paths: [] });

      const response = await request(app)
        .get('/fs/emptyuser/')
        .expect(200);

      // Should show preset folders
      expect(response.body.contents.length).toBeGreaterThan(0);
      
      const presetNames = ['Documents', 'Images', 'Videos', 'Music', 'Archives', 'Code', 'Trash', 'Misc'];
      presetNames.forEach(name => {
        const folder = response.body.contents.find(c => c.name === name);
        expect(folder).toBeDefined();
        expect(folder.type).toBe('directory');
        expect(folder.itemCount).toBe(0);
      });
    });
  });
});