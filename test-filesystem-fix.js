#!/usr/bin/env node
import { createDgraphClient } from './lib/dgraph-client.js';
import { createLogger } from './lib/logger.js';

const logger = createLogger('test-filesystem-fix');

async function testFilesystemQuery() {
  const dgraphUrl = process.env.DGRAPH_URL || 'http://localhost:9080';
  
  try {
    // Create a client with spkccT_ namespace
    const client = createDgraphClient({
      url: dgraphUrl,
      namespace: 'spkccT_',
      logger
    });

    // Test 1: Check if Path type exists
    logger.info('Test 1: Checking if Path type exists...');
    const typeQuery = `{
      test(func: type(Path), first: 1) {
        fullPath
        pathType
      }
    }`;
    
    try {
      const typeResult = await client.query(typeQuery);
      logger.info('Path type query successful', { result: typeResult });
    } catch (error) {
      logger.error('Path type query failed', { error: error.message });
    }

    // Test 2: Test the exact query from filesystem.js
    logger.info('\nTest 2: Testing filesystem.js query pattern...');
    const filesystemQuery = `
      query getFile($username: string, $parentPath: string, $fileName: string) {
        paths(func: type(Path)) @filter(eq(fullPath, $parentPath) AND has(owner)) @cascade {
          fullPath
          owner @filter(eq(username, $username)) {
            username
          }
          files @filter(eq(name, $fileName)) {
            uid
            cid
            name
            extension
          }
        }
      }
    `;
    
    const testVars = {
      $username: 'disregardfiat',
      $parentPath: '/NFTs',
      $fileName: 'hf'
    };
    
    try {
      const queryResult = await client.query(filesystemQuery, testVars);
      logger.info('Filesystem query successful', { 
        result: queryResult,
        pathsFound: queryResult.paths ? queryResult.paths.length : 0 
      });
    } catch (error) {
      logger.error('Filesystem query failed', { 
        error: error.message,
        errorCode: error.code 
      });
    }

    // Test 3: Check if fullPath predicate is indexed
    logger.info('\nTest 3: Checking fullPath predicate...');
    const predicateQuery = `{
      schema(func: has(fullPath), first: 1) {
        fullPath
      }
    }`;
    
    try {
      const predicateResult = await client.query(predicateQuery);
      logger.info('fullPath predicate query successful', { result: predicateResult });
    } catch (error) {
      logger.error('fullPath predicate query failed', { error: error.message });
    }

    // Test 4: Try the old query pattern that was failing
    logger.info('\nTest 4: Testing old query pattern (should fail)...');
    const oldQuery = `
      query getFile($parentPath: string) {
        paths(func: eq(fullPath, $parentPath)) {
          fullPath
        }
      }
    `;
    
    try {
      const oldResult = await client.query(oldQuery, { $parentPath: '/NFTs' });
      logger.info('Old query unexpectedly succeeded', { result: oldResult });
    } catch (error) {
      logger.info('Old query failed as expected', { error: error.message });
    }

  } catch (error) {
    logger.error('Test failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Run the test
testFilesystemQuery().then(() => {
  logger.info('All tests completed');
  process.exit(0);
}).catch(error => {
  logger.error('Test suite failed', { error });
  process.exit(1);
});