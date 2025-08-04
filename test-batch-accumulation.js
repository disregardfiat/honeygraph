#!/usr/bin/env node

import { DataTransformer } from './lib/data-transformer.js';
import { DgraphClient } from './lib/dgraph-client.js';
import { createLogger } from './lib/logger.js';
import { pathAccumulator } from './lib/path-accumulator.js';

async function testBatchAccumulation() {
  const logger = createLogger('test-batch');
  
  const dgraphClient = new DgraphClient({
    url: 'http://dgraph-alpha:9080',
    namespace: 'spkccT_',
    logger
  });
  
  try {
    const dataTransformer = new DataTransformer(dgraphClient, logger);
    
    // Start batch mode like the import script does
    pathAccumulator.startBatch();
    
    // Contract 1: Add 2 images
    const contract1 = {
      id: 'batch-test-1',
      type: 'upload',
      t: 'batchtest',
      r: 't',
      m: "1|Images,img1,jpg,,0,img2,jpg,,0",
      e: ["QmBatch1", "QmBatch2"],
      p: 1,
      c: 'batch-1',
      df: {
        "QmBatch1": 1000,
        "QmBatch2": 2000
      }
    };
    
    // Contract 2: Add 2 more images
    const contract2 = {
      id: 'batch-test-2',
      type: 'upload',
      t: 'batchtest',
      r: 't',
      m: "1|Images,img3,jpg,,0,img4,jpg,,0",
      e: ["QmBatch3", "QmBatch4"],
      p: 1,
      c: 'batch-2',
      df: {
        "QmBatch3": 3000,
        "QmBatch4": 4000
      }
    };
    
    console.log('\nProcessing Contract 1 (2 images)...');
    const ops1 = [{
      type: 'put',
      path: ['contract', contract1.id],
      data: contract1
    }];
    
    const mutations1 = await dataTransformer.transformOperations(ops1, { num: 300 });
    if (mutations1.length > 0) {
      await dgraphClient.writeOperation(mutations1);
    }
    
    console.log('Processing Contract 2 (2 more images)...');
    const ops2 = [{
      type: 'put',
      path: ['contract', contract2.id],
      data: contract2
    }];
    
    const mutations2 = await dataTransformer.transformOperations(ops2, { num: 301 });
    if (mutations2.length > 0) {
      await dgraphClient.writeOperation(mutations2);
    }
    
    // End batch mode
    pathAccumulator.endBatch();
    
    // Query to check the results
    const query = `
      {
        paths(func: type(Path)) @filter(eq(fullPath, "/Images")) {
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
    console.log(`\nFound ${result.paths?.length || 0} /Images paths total`);
    
    const imagePath = result.paths?.find(p => p.owner?.username === "batchtest");
    
    if (imagePath) {
      console.log('\nFinal /Images path for batchtest:');
      console.log(`  UID: ${imagePath.uid}`);
      console.log(`  itemCount: ${imagePath.itemCount} (expected: 4)`);
      console.log(`  actual file count: ${imagePath.fileCount}`);
      console.log(`  Result: ${imagePath.itemCount === 4 ? '✅ PASS' : '❌ FAIL'}`);
    } else {
      console.log('\nNo Images path found for batchtest user');
    }
    
  } finally {
    dgraphClient.close();
  }
}

testBatchAccumulation().catch(console.error);