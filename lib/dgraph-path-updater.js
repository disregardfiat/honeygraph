/**
 * Dgraph Path Updater - Handles proper updates to path files using Dgraph's list operations
 */

import dgraph from 'dgraph-js';
import { createLogger } from './logger.js';

const logger = createLogger('dgraph-path-updater');

export class DgraphPathUpdater {
  constructor(dgraphClient) {
    this.dgraph = dgraphClient;
  }
  
  /**
   * Update paths with their accumulated files using proper Dgraph list operations
   * This avoids the issue where setSetJson replaces the entire object
   */
  async updatePathsWithFiles(pathMutations) {
    if (!pathMutations || pathMutations.size === 0) {
      logger.info('No path mutations to process');
      return;
    }
    
    logger.info('Updating paths with accumulated files', {
      pathCount: pathMutations.size
    });
    
    const results = {
      updated: 0,
      failed: 0,
      errors: []
    };
    
    // Process each path separately to handle list operations properly
    for (const [key, path] of pathMutations) {
      try {
        if (path.uid && path.uid.startsWith('0x') && path.files && path.files.length > 0) {
          // This is an existing path that needs file updates
          await this.updateExistingPathFiles(path);
          results.updated++;
        } else if (!path.uid || path.uid.startsWith('_:')) {
          // New path - will be handled by regular mutation
          logger.debug('Skipping new path (will be created normally)', {
            fullPath: path.fullPath
          });
        }
      } catch (error) {
        logger.error('Failed to update path', {
          path: path.fullPath,
          error: error.message
        });
        results.failed++;
        results.errors.push({ path: path.fullPath, error: error.message });
      }
    }
    
    logger.info('Path update results', results);
    return results;
  }
  
  /**
   * Update an existing path's files using proper Dgraph operations
   */
  async updateExistingPathFiles(path) {
    const txn = this.dgraph.client.newTxn();
    
    try {
      // First, get the current files for this path
      const query = `
        query getPath($uid: string) {
          path(func: uid($uid)) {
            uid
            files {
              uid
            }
          }
        }
      `;
      
      const response = await txn.queryWithVars(query, { $uid: path.uid });
      const result = response.getJson();
      
      const existingPath = result.path?.[0];
      if (!existingPath) {
        throw new Error(`Path not found: ${path.uid}`);
      }
      
      // Get existing file UIDs
      const existingFileUids = new Set();
      if (existingPath.files) {
        const files = Array.isArray(existingPath.files) ? existingPath.files : [existingPath.files];
        files.forEach(f => existingFileUids.add(f.uid));
      }
      
      // Find new files to add
      const newFiles = path.files.filter(f => !existingFileUids.has(f.uid));
      
      if (newFiles.length === 0) {
        logger.debug('No new files to add to path', {
          fullPath: path.fullPath,
          existingCount: existingFileUids.size
        });
        return;
      }
      
      // Create mutation to add new files
      const mutation = new dgraph.Mutation();
      
      // Use N-Quad format to append to the files list
      let nquads = '';
      for (const file of newFiles) {
        nquads += `<${path.uid}> <files> <${file.uid}> .\n`;
      }
      
      mutation.setNquads(nquads);
      
      // Also update itemCount
      const updateObj = {
        uid: path.uid,
        itemCount: existingFileUids.size + newFiles.length
      };
      mutation.setSetJson(updateObj);
      
      await txn.mutate(mutation);
      await txn.commit();
      
      logger.info('Successfully updated path with new files', {
        fullPath: path.fullPath,
        existingFiles: existingFileUids.size,
        newFiles: newFiles.length,
        totalFiles: existingFileUids.size + newFiles.length
      });
      
    } catch (error) {
      await txn.discard();
      throw error;
    }
  }
}

export function createDgraphPathUpdater(dgraphClient) {
  return new DgraphPathUpdater(dgraphClient);
}