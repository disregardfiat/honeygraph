#!/usr/bin/env node

import { DgraphClient } from './lib/dgraph-client.js';
import { createLogger } from './lib/logger.js';

async function checkAllCounts() {
  const logger = createLogger('check-counts');
  const dgraphClient = new DgraphClient({
    url: 'http://dgraph-alpha:9080',
    namespace: 'spkccT_',
    logger
  });

  try {
    const query = `
      {
        paths(func: type(Path)) @filter(has(owner)) {
          uid
          fullPath
          itemCount
          fileCount: count(~parentPath)
          owner {
            uid
            username
          }
        }
      }
    `;
    
    const result = await dgraphClient.query(query);
    
    console.log('\nPath counts:');
    console.log('================================');
    
    if (result.paths) {
      // Filter for disregardfiat only
      const disregardPaths = result.paths.filter(p => p.owner?.username === 'disregardfiat');
      
      // Group by fullPath to show duplicates
      const pathGroups = {};
      disregardPaths.forEach(p => {
        if (!pathGroups[p.fullPath]) {
          pathGroups[p.fullPath] = [];
        }
        pathGroups[p.fullPath].push(p);
      });
      
      // Sort paths by name
      const sortedPaths = Object.keys(pathGroups).sort();
      
      for (const fullPath of sortedPaths) {
        const paths = pathGroups[fullPath];
        if (paths.length === 1) {
          const p = paths[0];
          const mismatch = p.itemCount !== p.fileCount ? ' ⚠️ MISMATCH' : '';
          console.log(`${fullPath}: itemCount=${p.itemCount}, fileCount=${p.fileCount}${mismatch}`);
        } else {
          console.log(`\n${fullPath}: ${paths.length} DUPLICATES`);
          paths.forEach(p => {
            const mismatch = p.itemCount !== p.fileCount ? ' ⚠️ MISMATCH' : '';
            console.log(`  ${p.uid}: itemCount=${p.itemCount}, fileCount=${p.fileCount}${mismatch}`);
          });
        }
      }
      
      console.log('\n================================');
      console.log('Summary:');
      const totalPaths = disregardPaths.length;
      const uniquePaths = Object.keys(pathGroups).length;
      const duplicates = totalPaths - uniquePaths;
      console.log(`Total path entities: ${totalPaths}`);
      console.log(`Unique paths: ${uniquePaths}`);
      console.log(`Duplicate paths: ${duplicates}`);
      
      // Count mismatches
      const mismatches = disregardPaths.filter(p => p.itemCount !== p.fileCount);
      if (mismatches.length > 0) {
        console.log(`\nPaths with count mismatches: ${mismatches.length}`);
        mismatches.forEach(p => {
          console.log(`  ${p.fullPath} (${p.uid}): itemCount=${p.itemCount}, fileCount=${p.fileCount}`);
        });
      }
    }
    
  } finally {
    dgraphClient.close();
  }
}

checkAllCounts().catch(console.error);