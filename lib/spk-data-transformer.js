/**
 * SPK-specific Data Transformer
 * Extends the base transformer with SPK VFS support
 */

import { DataTransformer } from './data-transformer.js';
import { createLogger } from './logger.js';

const logger = createLogger('spk-transformer');

export class SPKDataTransformer extends DataTransformer {
  constructor(dgraphClient, networkManager = null) {
    super(dgraphClient, networkManager);
    this.pathCache = new Map();
  }

  /**
   * Override transformContract to ensure proper VFS path handling
   */
  async transformContract(path, contract, mutations) {
    // Call parent implementation first
    await super.transformContract(path, contract, mutations);
    
    // Get the contract ID
    let contractId;
    let purchaser;
    
    if (path.length === 3) {
      purchaser = path[1];
      if (path[2].includes(':')) {
        contractId = path[2];
      } else {
        contractId = `${purchaser}:0:${path[2]}`;
      }
    } else {
      contractId = path[1];
      purchaser = contractId.split(':')[0];
    }
    
    // Ensure we have proper path entities for VFS
    if (contract.df && contract.m) {
      await this.createVFSPaths(contractId, contract, mutations, purchaser);
    }
  }

  /**
   * Create VFS path entities for proper directory structure
   */
  async createVFSPaths(contractId, contract, mutations, username) {
    logger.info('Creating VFS paths for contract', { contractId, username });
    
    // Parse metadata to get folder structure
    const parsedMeta = this.parseMetadata(contract.m, contractId);
    const folderStructure = parsedMeta.folderStructure 
      ? JSON.parse(parsedMeta.folderStructure)
      : {}; // Don't create default folder structure
    
    // Create path entities for each folder
    const processedPaths = new Set();
    
    for (const [index, folderPath] of Object.entries(folderStructure)) {
      if (folderPath && folderPath !== '' && !processedPaths.has(folderPath)) {
        processedPaths.add(folderPath);
        
        // Normalize path
        const normalizedPath = folderPath.startsWith('/') ? folderPath : `/${folderPath}`;
        const pathParts = normalizedPath.split('/').filter(p => p);
        const pathName = pathParts[pathParts.length - 1] || 'root';
        
        // Create path entity
        const pathId = `${username}:${normalizedPath}`;
        
        if (!mutations.paths.has(pathId)) {
          // Count files in this path
          let fileCount = 0;
          const fileNames = Object.keys(contract.df);
          const parsedMetadata = this.parseMetadataString(contract.m, fileNames);
          
          for (const [cid, fileMetadata] of parsedMetadata.files) {
            if (fileMetadata.pathIndex === index) {
              fileCount++;
            }
          }
          
          mutations.paths.set(pathId, {
            uid: `_:path_${pathId.replace(/[:/\-]/g, '_')}`,
            'dgraph.type': 'Path',
            id: pathId,
            fullPath: normalizedPath,
            pathName: pathName,
            pathType: 'directory',
            itemCount: fileCount,
            owner: { uid: mutations.accounts.get(username).uid }
          });
          
          // Link files to this path
          for (const [cid, fileMetadata] of parsedMetadata.files) {
            if (fileMetadata.pathIndex === index) {
              const fileId = cid;
              if (mutations.files.has(fileId)) {
                const file = mutations.files.get(fileId);
                file.parentPath = { uid: mutations.paths.get(pathId).uid };
              }
            }
          }
        }
      }
    }
    
    // Create parent paths if they don't exist
    for (const folderPath of processedPaths) {
      await this.ensureParentPaths(folderPath, username, mutations);
    }
  }

  /**
   * Ensure all parent paths exist in the hierarchy
   */
  async ensureParentPaths(fullPath, username, mutations) {
    const pathParts = fullPath.split('/').filter(p => p);
    let currentPath = '';
    
    for (let i = 0; i < pathParts.length; i++) {
      currentPath += '/' + pathParts[i];
      const pathId = `${username}:${currentPath}`;
      
      if (!mutations.paths.has(pathId)) {
        // Count items in this directory (subdirs + files)
        let itemCount = 0;
        
        // Count subdirectories
        for (const otherPath of mutations.paths.keys()) {
          if (otherPath.startsWith(`${username}:${currentPath}/`) && 
              otherPath.split(':')[1].slice(currentPath.length + 1).indexOf('/') === -1) {
            itemCount++;
          }
        }
        
        mutations.paths.set(pathId, {
          uid: `_:path_${pathId.replace(/[:/\-]/g, '_')}`,
          'dgraph.type': 'Path',
          id: pathId,
          fullPath: currentPath,
          pathName: pathParts[i],
          pathType: 'directory',
          itemCount: itemCount,
          owner: { uid: mutations.accounts.get(username).uid }
        });
      }
    }
  }

  /**
   * Override buildMutations to add path relationships
   */
  buildMutations(mutations, blockInfo) {
    const dgraphMutations = super.buildMutations(mutations, blockInfo);
    
    // Add path->file relationships
    const pathFileMutations = [];
    
    for (const [pathId, pathData] of mutations.paths) {
      // Find all files in this path
      const pathUsername = pathId.split(':')[0];
      const pathFullPath = pathId.split(':')[1];
      const filesInPath = [];
      
      for (const [fileId, fileData] of mutations.files) {
        if (fileData.path === pathFullPath) {
          filesInPath.push({ uid: fileData.uid });
        }
      }
      
      if (filesInPath.length > 0) {
        pathFileMutations.push({
          uid: pathData.uid,
          files: filesInPath
        });
      }
    }
    
    return [...dgraphMutations, ...pathFileMutations];
  }
}

// Factory function
export function createSPKDataTransformer(dgraphClient, networkManager = null) {
  return new SPKDataTransformer(dgraphClient, networkManager);
}