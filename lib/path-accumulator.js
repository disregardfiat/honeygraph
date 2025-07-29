/**
 * Path Accumulator - Handles accumulating files across multiple contract batches
 * 
 * This singleton ensures that when multiple contracts add files to the same path,
 * all files are properly accumulated rather than overwritten.
 */

import { createLogger } from './logger.js';

const logger = createLogger('path-accumulator');

class PathAccumulator {
  constructor() {
    // Map to track all files added to each path during the entire import process
    // Key: "username:fullPath", Value: Set of file UIDs
    this.pathFiles = new Map();
    
    // Map to track path UIDs once they're known
    // Key: "username:fullPath", Value: path UID
    this.pathUids = new Map();
    
    // Track if we're in batch processing mode
    this.batchMode = false;
  }
  
  /**
   * Start a new batch processing session
   */
  startBatch() {
    logger.info('Starting batch mode - clearing accumulator');
    this.pathFiles.clear();
    this.pathUids.clear();
    this.batchMode = true;
  }
  
  /**
   * End batch processing
   */
  endBatch() {
    logger.info('Ending batch mode', {
      totalPaths: this.pathFiles.size,
      totalFiles: Array.from(this.pathFiles.values()).reduce((sum, set) => sum + set.size, 0)
    });
    this.batchMode = false;
  }
  
  /**
   * Register a path UID
   */
  registerPath(username, fullPath, uid) {
    const key = `${username}:${fullPath}`;
    this.pathUids.set(key, uid);
    
    // Initialize file set if not exists
    if (!this.pathFiles.has(key)) {
      this.pathFiles.set(key, new Set());
    }
  }
  
  /**
   * Add a file to a path
   */
  addFileToPath(username, fullPath, fileUid) {
    const key = `${username}:${fullPath}`;
    
    if (!this.pathFiles.has(key)) {
      this.pathFiles.set(key, new Set());
    }
    
    const before = this.pathFiles.get(key).size;
    this.pathFiles.get(key).add(fileUid);
    const after = this.pathFiles.get(key).size;
    
    if (after > before) {
      logger.debug('Added file to path accumulator', {
        username,
        fullPath,
        fileUid,
        totalFiles: after
      });
    }
  }
  
  /**
   * Get all accumulated files for a path
   */
  getPathFiles(username, fullPath) {
    const key = `${username}:${fullPath}`;
    const fileSet = this.pathFiles.get(key);
    
    if (!fileSet) {
      return [];
    }
    
    return Array.from(fileSet).map(uid => ({ uid }));
  }
  
  /**
   * Get path UID if known
   */
  getPathUid(username, fullPath) {
    const key = `${username}:${fullPath}`;
    return this.pathUids.get(key);
  }
  
  /**
   * Check if we have files for a path
   */
  hasPath(username, fullPath) {
    const key = `${username}:${fullPath}`;
    return this.pathFiles.has(key) && this.pathFiles.get(key).size > 0;
  }
  
  /**
   * Get statistics
   */
  getStats() {
    const stats = {
      totalPaths: this.pathFiles.size,
      totalFiles: 0,
      pathsWithMultipleFiles: 0,
      largestPath: { path: '', fileCount: 0 }
    };
    
    for (const [key, fileSet] of this.pathFiles) {
      stats.totalFiles += fileSet.size;
      
      if (fileSet.size > 1) {
        stats.pathsWithMultipleFiles++;
      }
      
      if (fileSet.size > stats.largestPath.fileCount) {
        stats.largestPath = {
          path: key,
          fileCount: fileSet.size
        };
      }
    }
    
    return stats;
  }
}

// Export singleton instance
export const pathAccumulator = new PathAccumulator();