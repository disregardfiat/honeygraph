import { jest } from '@jest/globals';
import { createDataTransformer } from '../lib/data-transformer.js';

describe('Preset Folder Fix', () => {
  let transformer;
  let mockDgraphClient;

  beforeEach(() => {
    mockDgraphClient = {
      query: jest.fn().mockResolvedValue({ account: [] }),
      mutate: jest.fn().mockResolvedValue({ uids: {} })
    };
    
    transformer = createDataTransformer(mockDgraphClient);
  });

  test('should correctly parse files with preset folder indices', () => {
    // Test metadata with files using preset folder indices
    // Format: version,name1,ext.pathIndex1,thumb1,flags1,name2,ext.pathIndex2,thumb2,flags2
    const metadata = '1,dlux-logo,png.3,Qme4561YAjzmLHoF7R4iRkkw8n3irPHL86u3R7oxjHZgzQ,0--,southamerica,.0,,0--';
    const cids = ['QmbyzCt76bVK1nxGKzQ69huvdegqFXwuy2Ln32AA1Kbpmu', 'QmS25z74bp9g3zdXPpDQiQcAmJxd7zPmUJiH16CkNSEe3b'];
    
    const result = transformer.parseMetadataString(metadata, cids);
    
    // Check that files have correct path indices
    const file1 = result.files.get('QmbyzCt76bVK1nxGKzQ69huvdegqFXwuy2Ln32AA1Kbpmu');
    const file2 = result.files.get('QmS25z74bp9g3zdXPpDQiQcAmJxd7zPmUJiH16CkNSEe3b');
    
    expect(file1.pathIndex).toBe('3'); // Images folder
    expect(file1.name).toBe('dlux-logo');
    expect(file1.ext).toBe('png');
    
    expect(file2.pathIndex).toBe('0'); // Root folder
    expect(file2.name).toBe('southamerica');
    expect(file2.ext).toBe('');
  });

  test('should not create spurious directory 1', () => {
    const metadata = '1,file1,jpg.3,,0--,file2,png.0,,0--';
    const cids = ['QmTest1', 'QmTest2'];
    
    const result = transformer.parseMetadataString(metadata, cids);
    
    // Should not have a folder with index '1'
    expect(result.folderMap.has('1')).toBe(false);
    
    // Should have preset folders
    expect(result.folderMap.has('0')).toBe(true); // Root
    expect(result.folderMap.has('3')).toBe(true); // Images
    expect(result.folderMap.get('3').name).toBe('Images');
  });

  test('should map files to correct preset folders in transform', async () => {
    const contractOperation = {
      type: 'put',
      path: ['contract', 'testuser', '12345-abcdef'],
      data: {
        f: 'testuser',
        t: 'testuser',
        a: 1,
        c: 3,
        p: 100,
        m: '1,photo1,jpg.3,QmThumb1,0--,video1,mp4.4,,0--,doc1,pdf.2,,0--',
        df: {
          'QmPhoto1': 1024,
          'QmVideo1': 2048,
          'QmDoc1': 512
        }
      },
      blockNum: 12345,
      timestamp: Date.now()
    };

    const blockInfo = { blockNum: 12345, timestamp: Date.now() };
    const mutations = await transformer.transformOperations([contractOperation], blockInfo);
    
    // Find the files in mutations
    const files = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
    
    const photo = files.find(f => f.name === 'photo1');
    const video = files.find(f => f.name === 'video1');
    const doc = files.find(f => f.name === 'doc1');
    
    // Note: The path might be stored without leading slash in some cases
    expect(photo.path).toMatch(/^\/?Images$/);
    expect(video.path).toMatch(/^\/?Videos$/);
    expect(doc.path).toMatch(/^\/?Documents$/);
    
    // Should not have any path called /1
    const paths = mutations.filter(m => m['dgraph.type'] === 'Path');
    const directory1 = paths.find(p => p.fullPath === '/1');
    expect(directory1).toBeUndefined();
  });
});