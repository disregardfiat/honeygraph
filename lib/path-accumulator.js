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
    // Key: "username:fullPath", Value: Map of file UID to file object
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
      totalFiles: Array.from(this.pathFiles.values()).reduce((sum, map) => sum + map.size, 0)
    });
    this.batchMode = false;
  }
  
  /**
   * Register a path UID
   */
  registerPath(username, fullPath, uid) {
    const key = `${username}:${fullPath}`;
    this.pathUids.set(key, uid);
    
    // Initialize file map if not exists
    if (!this.pathFiles.has(key)) {
      this.pathFiles.set(key, new Map());
    }
  }
  
  /**
   * Add a file to a path
   */
  addFileToPath(username, fullPath, fileData) {
    const key = `${username}:${fullPath}`;
    
    if (!this.pathFiles.has(key)) {
      this.pathFiles.set(key, new Map());
    }
    
    const fileMap = this.pathFiles.get(key);
    const before = fileMap.size;
    
    // Handle both string UIDs and file objects
    if (typeof fileData === 'string') {
      fileMap.set(fileData, { uid: fileData });
    } else {
      fileMap.set(fileData.uid, fileData);
    }
    
    const after = fileMap.size;
    
    if (after > before) {
      logger.debug('Added file to path accumulator', {
        username,
        fullPath,
        fileUid: typeof fileData === 'string' ? fileData : fileData.uid,
        totalFiles: after
      });
    }
  }
  
  /**
   * Get all accumulated files for a path
   */
  getPathFiles(username, fullPath) {
    const key = `${username}:${fullPath}`;
    const fileMap = this.pathFiles.get(key);
    
    if (!fileMap) {
      return [];
    }
    
    return Array.from(fileMap.values());
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