#!/usr/bin/env node

import { DgraphClient } from './lib/dgraph-client.js';
import { createLogger } from './lib/logger.js';

async function checkOwner() {
  const logger = createLogger('check-owner');
  const dgraphClient = new DgraphClient({
    url: 'http://dgraph-alpha:9080',
    namespace: 'spkccT_',
    logger
  });

  try {
    // Check one of the Ragnarok paths
    const query = `
      {
        path(func: uid(0x1ce0)) {
          uid
          fullPath
          owner {
            uid
            username
            dgraph.type
          }
        }
        
        # Check if owner edge exists
        hasOwner(func: uid(0x1ce0)) @filter(has(owner)) {
          uid
          owner {
            uid
          }
        }
        
        # Try reverse query
        account(func: eq(username, "disregardfiat")) @filter(type(Account)) {
          uid
          username
          ownsPaths: ~owner @filter(type(Path)) {
            uid
            fullPath
          }
        }
      }
    `;
    
    const result = await dgraphClient.query(query);
    
    console.log('Path 0x1ce0:');
    if (result.path?.[0]) {
      console.log('  owner:', result.path[0].owner);
    }
    
    console.log('\nHas owner edge:', result.hasOwner?.length > 0);
    
    console.log('\nAccount disregardfiat:');
    if (result.account?.[0]) {
      console.log('  uid:', result.account[0].uid);
      console.log('  owns paths:', result.account[0].ownsPaths?.length || 0);
      if (result.account[0].ownsPaths?.length > 0) {
        console.log('  First 3 paths:');
        result.account[0].ownsPaths.slice(0, 3).forEach(p => {
          console.log(`    ${p.uid}: ${p.fullPath}`);
        });
      }
    }
    
  } finally {
    dgraphClient.close();
  }
}

checkOwner().catch(console.error);