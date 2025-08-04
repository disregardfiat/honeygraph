#!/usr/bin/env node

import { DgraphClient } from './lib/dgraph-client.js';
import { createLogger } from './lib/logger.js';

async function debugPaths() {
  const logger = createLogger('debug-paths');
  const dgraphClient = new DgraphClient({
    url: 'http://dgraph-alpha:9080',
    namespace: 'spkccT_',
    logger
  });

  try {
    const query = `
      {
        allPaths(func: type(Path)) {
          uid
          fullPath
          itemCount
          owner {
            uid
            username
          }
          fileCount: count(~parentPath)
        }
      }
    `;
    
    const result = await dgraphClient.query(query);
    
    console.log(`\nTotal paths: ${result.allPaths?.length || 0}`);
    
    // Group by owner
    const byOwner = {};
    result.allPaths?.forEach(p => {
      const owner = p.owner?.username || 'NO_OWNER';
      if (!byOwner[owner]) byOwner[owner] = [];
      byOwner[owner].push(p);
    });
    
    Object.entries(byOwner).forEach(([owner, paths]) => {
      console.log(`\n${owner}: ${paths.length} paths`);
      paths.slice(0, 5).forEach(p => {
        console.log(`  ${p.fullPath}: itemCount=${p.itemCount}, fileCount=${p.fileCount}`);
      });
      if (paths.length > 5) console.log(`  ... and ${paths.length - 5} more`);
    });
    
  } finally {
    dgraphClient.close();
  }
}

debugPaths().catch(console.error);