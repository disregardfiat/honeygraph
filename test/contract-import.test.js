import { jest } from '@jest/globals';
import { createDataTransformer } from '../lib/data-transformer.js';

describe('Contract Import', () => {
  let transformer;
  let mockDgraphClient;
  let mockNetworkManager;

  beforeEach(() => {
    // Setup mock Dgraph client with query method
    mockDgraphClient = {
      query: jest.fn().mockResolvedValue({ account: [] })
    };
    mockNetworkManager = {
      getNetwork: jest.fn().mockReturnValue({
        namespace: 'spkccT_'
      })
    };
    transformer = createDataTransformer(mockDgraphClient, mockNetworkManager);
  });

  describe('transformContract', () => {
    it('should set owner field from contract.t', async () => {
      const mutations = {
        accounts: new Map(),
        contracts: new Map(),
        files: new Map(),
        transactions: [],
        orders: new Map(),
        dexMarkets: new Map(),
        ohlc: [],
        other: []
      };

      const contractData = {
        a: 1000,
        b: 'broker123',
        c: 3, // status
        f: 'purchaser123', // from/purchaser
        t: 'fileowner123', // to/owner
        df: {
          'QmTest123': 1024
        },
        m: '1|NFTs,testfile,txt.1,QmThumb123,0-MIT-test,data'
      };

      await transformer.transformContract(['contract', 'purchaser123', 'purchaser123:0:12345'], contractData, mutations);

      expect(mutations.contracts.size).toBe(1);
      const contract = mutations.contracts.get('purchaser123:0:12345');
      
      expect(contract.purchaser.username).toBe('purchaser123');
      expect(contract.owner.username).toBe('fileowner123');
      expect(contract['dgraph.type']).toBe('StorageContract');
    });

    it('should fall back to path[1] if contract.t is not provided', async () => {
      const mutations = {
        accounts: new Map(),
        contracts: new Map(),
        files: new Map(),
        paths: new Map(),
        transactions: [],
        orders: new Map(),
        dexMarkets: new Map(),
        ohlc: [],
        other: []
      };

      const contractData = {
        a: 1000,
        c: 3,
        f: 'purchaser123',
        // No 't' field
        df: {
          'QmTest123': 1024
        }
      };

      await transformer.transformContract(['contract', 'actualowner', 'actualowner:0:12345'], contractData, mutations);

      const contract = mutations.contracts.get('actualowner:0:12345');
      expect(contract.owner.username).toBe('actualowner');
    });

    it('should create file entities with correct paths', () => {
      const mutations = {
        accounts: new Map(),
        contracts: new Map(),
        files: new Map(),
        transactions: [],
        orders: new Map(),
        dexMarkets: new Map(),
        ohlc: [],
        other: []
      };

      const contractData = {
        c: 3,
        f: 'user123',
        t: 'owner123',
        df: {
          'QmFile1': 1024,
          'QmFile2': 2048
        },
        m: '1|NFTs|1/Resources,file1,txt.1,QmThumb1,0-MIT-test,file2,jpg.A,QmThumb2,0-CC0-image'
      };

      transformer.transformContract(['contract', 'user123', 'user123:0:12345'], contractData, mutations);

      expect(mutations.files.size).toBe(2);
      
      const file1 = mutations.files.get('user123:0:12345:QmFile1');
      expect(file1.name).toBe('file1');
      expect(file1.extension).toBe('txt');
      expect(file1.path).toBe('/NFTs');
      expect(file1.mimeType).toBe('text/plain');
      expect(file1.license).toBe('MIT');
      expect(file1.labels).toBe('test');
      expect(file1.thumbnail).toBe('QmThumb1');
      expect(file1.flags).toBe(0);

      const file2 = mutations.files.get('user123:0:12345:QmFile2');
      expect(file2.name).toBe('file2');
      expect(file2.extension).toBe('jpg');
      expect(file2.path).toBe('/NFTs/Resources');
      expect(file2.mimeType).toBe('image/jpeg');
      expect(file2.license).toBe('CC0');
      expect(file2.labels).toBe('image');
      expect(file2.thumbnail).toBe('QmThumb2');
      expect(file2.flags).toBe(0);
    });

    it('should parse folder structure correctly', () => {
      const mutations = {
        accounts: new Map(),
        contracts: new Map(),
        files: new Map(),
        transactions: [],
        orders: new Map(),
        dexMarkets: new Map(),
        ohlc: [],
        other: []
      };

      const contractData = {
        c: 3,
        f: 'user123',
        df: {},
        m: '1|NFTs|1/Resources|1/Thumbnails'
      };

      transformer.transformContract(['contract', 'user123', 'user123:0:12345'], contractData, mutations);

      const contract = mutations.contracts.get('user123:0:12345');
      const metadata = JSON.parse(contract.metadata);
      const folderStructure = metadata.folderStructure ? JSON.parse(metadata.folderStructure) : {};
      
      expect(folderStructure['1']).toBe('NFTs');
      expect(folderStructure['A']).toBe('NFTs/Resources');
      expect(folderStructure['B']).toBe('NFTs/Thumbnails');
    });

    it('should handle contracts with no files', () => {
      const mutations = {
        accounts: new Map(),
        contracts: new Map(),
        files: new Map(),
        transactions: [],
        orders: new Map(),
        dexMarkets: new Map(),
        ohlc: [],
        other: []
      };

      const contractData = {
        c: 3,
        f: 'user123',
        // No df field
        m: '1|'
      };

      transformer.transformContract(['contract', 'user123', 'user123:0:12345'], contractData, mutations);

      const contract = mutations.contracts.get('user123:0:12345');
      expect(contract.fileCount).toBe(0);
      expect(mutations.files.size).toBe(0);
    });

    it('should exclude files with flag 2 (thumbnails) from item count', () => {
      const mutations = {
        accounts: new Map(),
        contracts: new Map(),
        files: new Map(),
        transactions: [],
        orders: new Map(),
        dexMarkets: new Map(),
        ohlc: [],
        other: []
      };

      const contractData = {
        c: 3,
        f: 'user123',
        df: {
          'QmFile1': 1024,
          'QmThumb': 512
        },
        m: '1|Images,photo,jpg.3,QmThumb1,0-MIT-photo,thumb,jpg.3,,2'
      };

      transformer.transformContract(['contract', 'user123', 'user123:0:12345'], contractData, mutations);

      const contract = mutations.contracts.get('user123:0:12345');
      expect(contract.fileCount).toBe(2); // Both files counted in contract

      const file1 = mutations.files.get('user123:0:12345:QmFile1');
      const file2 = mutations.files.get('user123:0:12345:QmThumb');
      
      expect(file1.flags).toBe(0);
      expect(file1.extension).toBe('jpg');
      expect(file1.license).toBe('MIT');
      expect(file1.labels).toBe('photo');
      expect(file1.thumbnail).toBe('QmThumb1');
      
      expect(file2.flags).toBe(2); // Thumbnail flag
      expect(file2.extension).toBe('jpg');
      expect(file2.license).toBe('');
      expect(file2.labels).toBe('');
      expect(file2.thumbnail).toBe('');
    });

    it('should parse all file metadata fields correctly', () => {
      const mutations = {
        accounts: new Map(),
        contracts: new Map(),
        files: new Map(),
        transactions: [],
        orders: new Map(),
        dexMarkets: new Map(),
        ohlc: [],
        other: []
      };

      const contractData = {
        c: 3,
        f: 'user123',
        t: 'owner123',
        df: {
          'QmFile1': 1024,
          'QmFile2': 2048,
          'QmFile3': 512
        },
        m: '1|NFTs,document,pdf.1,QmThumb1,0-MIT-legal,image,jpg.1,QmThumb2,1-CC0-photo,encrypted,dat.1,,2-GPL-data'
      };

      transformer.transformContract(['contract', 'user123', 'user123:0:12345'], contractData, mutations);

      expect(mutations.files.size).toBe(3);
      
      // Test first file - document with full metadata
      const file1 = mutations.files.get('user123:0:12345:QmFile1');
      expect(file1.name).toBe('document');
      expect(file1.extension).toBe('pdf');
      expect(file1.path).toBe('/NFTs');
      expect(file1.flags).toBe(0);
      expect(file1.license).toBe('MIT');
      expect(file1.labels).toBe('legal');
      expect(file1.thumbnail).toBe('QmThumb1');
      expect(file1.mimeType).toBe('application/pdf');

      // Test second file - image with encrypted flag
      const file2 = mutations.files.get('user123:0:12345:QmFile2');
      expect(file2.name).toBe('image');
      expect(file2.extension).toBe('jpg');
      expect(file2.path).toBe('/NFTs');
      expect(file2.flags).toBe(1);
      expect(file2.license).toBe('CC0');
      expect(file2.labels).toBe('photo');
      expect(file2.thumbnail).toBe('QmThumb2');
      expect(file2.mimeType).toBe('image/jpeg');

      // Test third file - encrypted data with no thumbnail
      const file3 = mutations.files.get('user123:0:12345:QmFile3');
      expect(file3.name).toBe('encrypted');
      expect(file3.extension).toBe('dat');
      expect(file3.path).toBe('/NFTs');
      expect(file3.flags).toBe(2);
      expect(file3.license).toBe('GPL');
      expect(file3.labels).toBe('data');
      expect(file3.thumbnail).toBe('');
      expect(file3.mimeType).toBe('application/octet-stream');
    });
  });

  describe('batch processing', () => {
    it('should maintain separate mutations for each batch', async () => {
      const operations = [
        {
          type: 'put',
          path: ['contract', 'user1', 'user1:0:12345'],
          data: { c: 3, f: 'user1', t: 'owner1', df: { 'QmTest1': 1024 }, m: '1|NFTs,file1,txt.1,QmThumb1,0-MIT-test' }
        },
        {
          type: 'put',
          path: ['contract', 'user2', 'user2:0:12346'],
          data: { c: 3, f: 'user2', t: 'owner2', df: { 'QmTest2': 2048 }, m: '1|Images,file2,jpg.2,QmThumb2,0-CC0-image' }
        }
      ];

      const blockInfo = { blockNum: 12345, timestamp: Date.now() };
      const mutations = await transformer.transformOperations(operations, blockInfo);

      // Should have 2 contracts in the final mutations
      const contracts = mutations.filter(m => m['dgraph.type'] === 'StorageContract');
      expect(contracts).toHaveLength(2);
      expect(contracts[0].owner.username).toBe('owner1');
      expect(contracts[1].owner.username).toBe('owner2');
      
      // Should have 2 files with metadata
      const files = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
      expect(files).toHaveLength(2);
      expect(files[0].extension).toBe('txt');
      expect(files[0].license).toBe('MIT');
      expect(files[0].labels).toBe('test');
      expect(files[0].thumbnail).toBe('QmThumb1');
      expect(files[1].extension).toBe('jpg');
      expect(files[1].license).toBe('CC0');
      expect(files[1].labels).toBe('image');
      expect(files[1].thumbnail).toBe('QmThumb2');
    });
  });

  describe('file placement with bitflags', () => {
    it('should not place files with bitflag &2 in any folder paths', async () => {
      const mutations = {
        accounts: new Map(),
        contracts: new Map(),
        files: new Map(),
        paths: new Map(),
        transactions: [],
        orders: new Map(),
        dexMarkets: new Map(),
        ohlc: [],
        other: []
      };

      const contractData = {
        c: 3,
        f: 'user123',
        t: 'owner123',
        df: {
          'QmAAA_RegularFile': 1024,     // Should get first metadata (0 flags)
          'QmBBB_ThumbnailFile1': 512,   // Should get second metadata (2 flags)
          'QmCCC_ThumbnailFile2': 256,   // Should get third metadata (3 flags)
          'QmDDD_HiddenFile': 128        // Should get fourth metadata (2 flags)
        },
        // Files with different bitflags: 0=normal, 2=thumbnail, 3=thumbnail+encrypted  
        // Format: contractflag|folder,name1,ext.folderindex,thumb,flags-license-labels,name2,ext.folderindex,thumb,flags-license-labels...
        m: '1|Images,regular,jpg.3,QmThumb1,0-MIT-photo,thumbnail1,jpg.3,,2--,thumbnail2,jpg.3,,3--,hidden,dat.3,,2--'
      };

      await transformer.transformContract(['contract', 'user123', 'user123:0:12345'], contractData, mutations);

      // Check that files exist in mutations
      expect(mutations.files.size).toBe(4);
      
      // Verify bitflags are correctly parsed
      const regularFile = mutations.files.get('user123:0:12345:QmAAA_RegularFile');
      const thumbFile1 = mutations.files.get('user123:0:12345:QmBBB_ThumbnailFile1');
      const thumbFile2 = mutations.files.get('user123:0:12345:QmCCC_ThumbnailFile2');
      const hiddenFile = mutations.files.get('user123:0:12345:QmDDD_HiddenFile');
      
      expect(regularFile.flags).toBe(0);  // Normal file
      expect(thumbFile1.flags).toBe(2);   // Thumbnail
      expect(thumbFile2.flags).toBe(3);   // Thumbnail + encrypted (bit 2 set)
      expect(hiddenFile.flags).toBe(2);   // Hidden/thumbnail
      
      // Check paths - only files without bitflag 2 should create path entries
      const pathEntries = Array.from(mutations.paths.values());
      
      // Find file paths (not directory paths)
      const filePaths = pathEntries.filter(path => path.pathType === 'file');
      
      // Only the regular file (flags=0) should have a path entry
      // Files with bitflag 2 (thumbFile1, thumbFile2, hiddenFile) should NOT have paths
      expect(filePaths.length).toBe(1);
      expect(filePaths[0].fullPath).toBe('/Images/regular');
      
      // Verify no paths exist for files with bitflag 2
      const thumbnailPaths = filePaths.filter(path => 
        path.fullPath.includes('thumbnail') || path.fullPath.includes('hidden')
      );
      expect(thumbnailPaths.length).toBe(0);
      
      // Double-check: ensure thumbnail files don't create folder structure
      const imagesFolderPaths = pathEntries.filter(path => 
        path.fullPath === '/Images' && path.pathType === 'directory'
      );
      
      if (imagesFolderPaths.length > 0) {
        const imagesFolder = imagesFolderPaths[0];
        // The Images folder should only have children for non-bitflag-2 files
        const childPaths = pathEntries.filter(path => 
          path.parent && path.parent.uid === imagesFolder.uid
        );
        
        // Should only contain the regular file, not any thumbnail files
        expect(childPaths.length).toBe(1);
        expect(childPaths[0].fullPath).toBe('/Images/regular');
      }
    });

    it('should handle mixed bitflags correctly in folder placement', async () => {
      const mutations = {
        accounts: new Map(),
        contracts: new Map(),
        files: new Map(),
        paths: new Map(),
        transactions: [],
        orders: new Map(),
        dexMarkets: new Map(),
        ohlc: [],
        other: []
      };

      const contractData = {
        c: 3,
        f: 'user123',
        t: 'owner123',
        df: {
          'QmAAA_Doc1': 1024,     // Should get first metadata (0 flags)
          'QmBBB_Doc2': 512,      // Should get second metadata (1 flags)
          'QmCCC_Thumb1': 128,    // Should get third metadata (2 flags)
          'QmDDD_Thumb2': 64      // Should get fourth metadata (6 flags)
        },
        // Mix of normal files and thumbnails in Documents folder
        m: '1|Documents,doc1,pdf.2,QmThumb1,0-MIT-document,doc2,txt.2,,1-GPL-text,thumb1,jpg.2,,2--,thumb2,png.2,,6--'
      };

      await transformer.transformContract(['contract', 'user123', 'user123:0:12345'], contractData, mutations);

      // All files should exist
      expect(mutations.files.size).toBe(4);
      
      const doc1 = mutations.files.get('user123:0:12345:QmAAA_Doc1');
      const doc2 = mutations.files.get('user123:0:12345:QmBBB_Doc2');
      const thumb1 = mutations.files.get('user123:0:12345:QmCCC_Thumb1');
      const thumb2 = mutations.files.get('user123:0:12345:QmDDD_Thumb2');
      
      expect(doc1.flags).toBe(0);  // Normal
      expect(doc2.flags).toBe(1);  // Encrypted (but not thumbnail)
      expect(thumb1.flags).toBe(2); // Thumbnail (bit 2 set)
      expect(thumb2.flags).toBe(6); // Thumbnail + other flags (bit 2 set: 6 & 2 = 2)
      
      // Check paths - only files without bit 2 should create paths
      const pathEntries = Array.from(mutations.paths.values());
      const filePaths = pathEntries.filter(path => path.pathType === 'file');
      
      // Only doc1 (flags=0) and doc2 (flags=1) should have paths
      // thumb1 (flags=2) and thumb2 (flags=6) should not
      expect(filePaths.length).toBe(2);
      
      const filePathNames = filePaths.map(p => p.fullPath).sort();
      expect(filePathNames).toEqual(['/Documents/doc1', '/Documents/doc2']);
      
      // Verify thumbnail files don't create paths
      const thumbPaths = filePaths.filter(path => 
        path.fullPath.includes('thumb')
      );
      expect(thumbPaths.length).toBe(0);
    });
  });
});