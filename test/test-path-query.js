#!/usr/bin/env node

import { DgraphClient } from '../lib/dgraph-client.js';
import { createLogger } from '../lib/logger.js';

async function testPathQuery() {
  const logger = createLogger('test-query');
  const dgraphClient = new DgraphClient({
    url: 'http://dgraph-alpha:9080',
    namespace: 'spkccT_',
    logger
  });

  try {
    // Test the exact query used in getOrCreatePath
    const username = 'disregardfiat';
    const fullPath = '/Ragnarok';
    
    const existingPathQuery = `
      query getExistingPath($username: string, $fullPath: string) {
        path(func: type(Path)) @filter(eq(fullPath, $fullPath) AND has(owner)) @cascade {
          uid
          fullPath
          pathName
          pathType
          owner @filter(eq(username, $username)) {
            uid
            username
          }
          files {
            uid
            cid
            name
          }
          itemCount
          newestBlockNumber
          currentFile {
            uid
          }
          children {
            uid
          }
          parent {
            uid
          }
        }
      }
    `;
    
    console.log('Testing query with:');
    console.log(`  username: ${username}`);
    console.log(`  fullPath: ${fullPath}`);
    console.log('');
    
    const result = await dgraphClient.query(existingPathQuery, { 
      $username: username,
      $fullPath: fullPath 
    });
    
    console.log(`Found ${result.path?.length || 0} paths\n`);
    
    if (result.path) {
      for (const path of result.path) {
        console.log(`Path ${path.uid}:`);
        console.log(`  fullPath: ${path.fullPath}`);
        console.log(`  owner: ${path.owner?.username} (${path.owner?.uid})`);
        console.log(`  itemCount: ${path.itemCount}`);
        console.log(`  files: ${path.files?.length || 0}`);
        console.log('');
      }
    }
    
    // Also test without cascade
    const simpleQuery = `
      query getSimple($fullPath: string) {
        paths(func: type(Path)) @filter(eq(fullPath, $fullPath)) {
          uid
          fullPath
          itemCount
          owner {
            uid
            username
          }
        }
      }
    `;
    
    const simpleResult = await dgraphClient.query(simpleQuery, { $fullPath: fullPath });
    
    console.log('\nWithout cascade filter:');
    console.log(`Found ${simpleResult.paths?.length || 0} paths total`);
    if (simpleResult.paths) {
      for (const path of simpleResult.paths) {
        console.log(`  ${path.uid}: owner=${path.owner?.username || 'none'}, itemCount=${path.itemCount}`);
      }
    }
    
  } finally {
    dgraphClient.close();
  }
}

testPathQuery().catch(console.error);