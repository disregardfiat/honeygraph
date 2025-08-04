#!/usr/bin/env node

import { DgraphClient } from './lib/dgraph-client.js';
import { createLogger } from './lib/logger.js';

async function testCascade() {
  const logger = createLogger('test-cascade');
  const dgraphClient = new DgraphClient({
    url: 'http://dgraph-alpha:9080',
    namespace: 'spkccT_',
    logger
  });

  try {
    const username = 'disregardfiat';
    const fullPath = '/Ragnarok';
    
    // Test 1: Simple query without cascade
    const query1 = `
      {
        paths(func: type(Path)) @filter(eq(fullPath, "/Ragnarok")) {
          uid
          fullPath
          owner {
            uid
            username
          }
        }
      }
    `;
    
    console.log('Test 1: Simple query without cascade');
    const result1 = await dgraphClient.query(query1);
    console.log(`Found ${result1.paths?.length || 0} paths`);
    
    // Test 2: With cascade but no filter on owner
    const query2 = `
      {
        paths(func: type(Path)) @filter(eq(fullPath, "/Ragnarok")) @cascade {
          uid
          fullPath
          owner {
            uid
            username
          }
        }
      }
    `;
    
    console.log('\nTest 2: With cascade but no filter on owner');
    const result2 = await dgraphClient.query(query2);
    console.log(`Found ${result2.paths?.length || 0} paths`);
    
    // Test 3: With cascade and owner filter
    const query3 = `
      query testCascade($username: string) {
        paths(func: type(Path)) @filter(eq(fullPath, "/Ragnarok")) @cascade {
          uid
          fullPath
          owner @filter(eq(username, $username)) {
            uid
            username
          }
        }
      }
    `;
    
    console.log('\nTest 3: With cascade and owner filter');
    const result3 = await dgraphClient.query(query3, { $username: username });
    console.log(`Found ${result3.paths?.length || 0} paths`);
    
    // Test 4: Move cascade to after has(owner)
    const query4 = `
      query testCascade($username: string) {
        paths(func: type(Path)) @filter(eq(fullPath, "/Ragnarok") AND has(owner)) @cascade {
          uid
          fullPath
          owner @filter(eq(username, $username)) {
            uid
            username
          }
        }
      }
    `;
    
    console.log('\nTest 4: With has(owner) and cascade');
    const result4 = await dgraphClient.query(query4, { $username: username });
    console.log(`Found ${result4.paths?.length || 0} paths`);
    
    // Test 5: Use eq filter with cascade at owner level
    const query5 = `
      query testCascade($username: string, $fullPath: string) {
        paths(func: type(Path)) @filter(eq(fullPath, $fullPath)) {
          uid
          fullPath
          owner @filter(eq(username, $username)) @cascade {
            uid
            username
          }
        }
      }
    `;
    
    console.log('\nTest 5: Cascade at owner level');
    const result5 = await dgraphClient.query(query5, { 
      $username: username,
      $fullPath: fullPath 
    });
    console.log(`Found ${result5.paths?.length || 0} paths`);
    if (result5.paths?.length > 0) {
      console.log('Paths with matching owner:');
      result5.paths.forEach(p => {
        if (p.owner) {
          console.log(`  ${p.uid}: owner=${p.owner.username}`);
        }
      });
    }
    
  } finally {
    dgraphClient.close();
  }
}

testCascade().catch(console.error);