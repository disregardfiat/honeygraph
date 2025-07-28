import { jest } from '@jest/globals';
import { createDataTransformer } from '../lib/data-transformer.js';

describe('Filesystem Files Issue', () => {
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

  describe('Path-File Associations', () => {
    test('should create proper file-to-path associations with UIDs', async () => {
      const contractOp = {
        type: 'put',
        path: ['contract', 'disregardfiat', 'dlux-io:0:96585668-542e7cd8f72324413e0cff1768670c058e854a0d'],
        data: {
          a: "disregardfiat",
          b: "QmNVkoKKmWsXuHJVPG5pGhCXfYsGJZjLE3RhfwfBhTizmp",
          c: "96585668-96656732",
          df: {
            "0": { n: "index.html", s: 15234, p: "/" },
            "1": { n: "style.css", s: 3456, p: "/" },
            "2": { n: "logo.png", s: 45678, p: "/Images" },
            "3": { n: "banner.jpg", s: 89012, p: "/Images" }
          },
          e: "97938326:QmenexSVsQsaKqoDZdeTY8Us2bVyPaNyha1wc2MCRVQvRm",
          m: "1|dApp,web3,dlux,,0--"
        },
        blockNum: 96585668,
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(contractOp);
      
      // Should create path mutations
      const pathMutations = mutations.filter(m => m['dgraph.type'] === 'Path');
      expect(pathMutations.length).toBeGreaterThan(0);
      
      // Find the root and Images paths
      const rootPath = pathMutations.find(p => p.fullPath === '/');
      const imagesPath = pathMutations.find(p => p.fullPath === '/Images');
      
      expect(rootPath).toBeDefined();
      expect(imagesPath).toBeDefined();
      
      // Check that paths have files arrays
      expect(rootPath.files).toBeDefined();
      expect(Array.isArray(rootPath.files)).toBe(true);
      expect(rootPath.files.length).toBe(2); // index.html and style.css
      
      expect(imagesPath.files).toBeDefined();
      expect(Array.isArray(imagesPath.files)).toBe(true);
      expect(imagesPath.files.length).toBe(2); // logo.png and banner.jpg
      
      // Check file mutations
      const fileMutations = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
      expect(fileMutations.length).toBe(4);
      
      // Check that files have parentPath references
      fileMutations.forEach(file => {
        expect(file.parentPath).toBeDefined();
        expect(file.parentPath.uid).toBeDefined();
        expect(file.parentPath.uid).toMatch(/^_:/); // Should be a blank node
      });
      
      // Verify the UIDs match
      const rootFiles = fileMutations.filter(f => f.path === '/');
      rootFiles.forEach(file => {
        const fileUidRef = { uid: file.uid };
        const isInRootPath = rootPath.files.some(f => f.uid === file.uid);
        expect(isInRootPath).toBe(true);
      });
    });

    test('should handle nested directory structures', async () => {
      const contractOp = {
        type: 'put',
        path: ['contract', 'testuser', 'test-nested-dirs'],
        data: {
          a: "testuser",
          b: "QmTestNestedDirs",
          c: "96585668-96656732",
          df: {
            "0": { n: "readme.md", s: 1024, p: "/Documents" },
            "1": { n: "report.pdf", s: 2048, p: "/Documents/Reports" },
            "2": { n: "photo.jpg", s: 4096, p: "/Images/Photos/2024" }
          }
        },
        blockNum: 96585668,
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(contractOp);
      
      // Should create all necessary path mutations
      const pathMutations = mutations.filter(m => m['dgraph.type'] === 'Path');
      const pathNames = pathMutations.map(p => p.fullPath).sort();
      
      expect(pathNames).toContain('/Documents');
      expect(pathNames).toContain('/Documents/Reports');
      expect(pathNames).toContain('/Images');
      expect(pathNames).toContain('/Images/Photos');
      expect(pathNames).toContain('/Images/Photos/2024');
      
      // Each directory with files should have the files array
      const docsPath = pathMutations.find(p => p.fullPath === '/Documents');
      const reportsPath = pathMutations.find(p => p.fullPath === '/Documents/Reports');
      const photos2024Path = pathMutations.find(p => p.fullPath === '/Images/Photos/2024');
      
      expect(docsPath.files.length).toBe(1); // readme.md
      expect(reportsPath.files.length).toBe(1); // report.pdf
      expect(photos2024Path.files.length).toBe(1); // photo.jpg
    });

    test('should verify mutation structure matches filesystem API expectations', async () => {
      const contractOp = {
        type: 'put',
        path: ['contract', 'apiuser', 'api-test-contract'],
        data: {
          a: "apiuser",
          b: "QmApiTest",
          c: "96585668-96656732",
          df: {
            "0": { n: "test.txt", s: 100, p: "/" }
          }
        },
        blockNum: 96585668,
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(contractOp);
      
      // Get the path mutation
      const pathMutation = mutations.find(m => m['dgraph.type'] === 'Path' && m.fullPath === '/');
      
      // Verify it has all fields expected by the filesystem API query
      expect(pathMutation).toMatchObject({
        'dgraph.type': 'Path',
        fullPath: '/',
        pathName: 'Root',
        pathType: 'directory',
        owner: expect.objectContaining({ uid: expect.any(String) }),
        files: expect.arrayContaining([
          expect.objectContaining({ uid: expect.any(String) })
        ])
      });
      
      // Verify file mutation structure
      const fileMutation = mutations.find(m => m['dgraph.type'] === 'ContractFile');
      expect(fileMutation).toMatchObject({
        'dgraph.type': 'ContractFile',
        cid: expect.any(String),
        name: 'test.txt',
        size: 100,
        path: '/',
        parentPath: expect.objectContaining({ uid: expect.any(String) }),
        contract: expect.objectContaining({ uid: expect.any(String) })
      });
    });
  });

  describe('Debug Filesystem Query', () => {
    test('should log the exact mutations that would be sent to Dgraph', async () => {
      const contractOp = {
        type: 'put',
        path: ['contract', 'debuguser', 'debug-contract'],
        data: {
          a: "debuguser",
          b: "QmDebugContract",
          c: "96585668-96656732",
          df: {
            "0": { n: "file1.txt", s: 100, p: "/" },
            "1": { n: "file2.txt", s: 200, p: "/Documents" }
          }
        },
        blockNum: 96585668,
        timestamp: Date.now()
      };

      const mutations = await transformer.transformOperation(contractOp);
      
      console.log('\n=== DEBUG: Mutations for Dgraph ===');
      
      // Log account mutation
      const accountMutation = mutations.find(m => m['dgraph.type'] === 'Account');
      console.log('\nAccount:', JSON.stringify(accountMutation, null, 2));
      
      // Log path mutations
      const pathMutations = mutations.filter(m => m['dgraph.type'] === 'Path');
      console.log('\nPaths:');
      pathMutations.forEach(p => {
        console.log(`- ${p.fullPath}: ${p.files ? p.files.length : 0} files`);
        if (p.files) {
          console.log(`  Files: ${JSON.stringify(p.files)}`);
        }
      });
      
      // Log file mutations
      const fileMutations = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
      console.log('\nFiles:');
      fileMutations.forEach(f => {
        console.log(`- ${f.name} (${f.uid}) in ${f.path}, parentPath: ${JSON.stringify(f.parentPath)}`);
      });
      
      // Log the relationships
      console.log('\n=== Relationships ===');
      pathMutations.forEach(path => {
        console.log(`\nPath: ${path.fullPath} (${path.uid})`);
        if (path.files && path.files.length > 0) {
          path.files.forEach(fileRef => {
            const file = fileMutations.find(f => f.uid === fileRef.uid);
            if (file) {
              console.log(`  → Contains file: ${file.name} (${file.uid})`);
            }
          });
        }
      });
    });
  });
});