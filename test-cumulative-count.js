#!/usr/bin/env node

import { DataTransformer } from './lib/data-transformer.js';
import { DgraphClient } from './lib/dgraph-client.js';
import { createLogger } from './lib/logger.js';

async function testCumulativeCount() {
  const logger = createLogger('test-cumulative');
  
  const dgraphClient = new DgraphClient({
    url: 'http://dgraph-alpha:9080',
    namespace: 'spkccT_',
    logger
  });
  
  try {
    const dataTransformer = new DataTransformer(dgraphClient, logger);
    
    // First, let's query the current state of a path like Images
    const initialQuery = `
      {
        path(func: type(Path)) @filter(eq(fullPath, "/Images") AND has(owner)) {
          uid
          fullPath
          itemCount
          owner @filter(eq(username, "disregardfiat")) {
            uid
            username
          }
          fileCount: count(~parentPath)
        }
      }
    `;
    
    const initialResult = await dgraphClient.query(initialQuery, { $username: "disregardfiat" });
    const imagesPath = initialResult.path?.find(p => p.owner?.username === "disregardfiat");
    
    if (imagesPath) {
      console.log('\nInitial Images path state:');
      console.log(`  UID: ${imagesPath.uid}`);
      console.log(`  itemCount: ${imagesPath.itemCount}`);
      console.log(`  actual file count: ${imagesPath.fileCount}`);
    }
    
    // Create a test contract that adds one more image
    const metadata = "1|Images,newimage,jpg,,0";
    
    const contract = {
      id: 'test-images-count',
      type: 'upload',
      t: 'disregardfiat',
      r: 't',
      m: metadata,
      e: ["QmNewImage"],
      p: 1,
      c: 'test-count',
      df: {
        "QmNewImage": 50000
      }
    };
    
    // Process the contract
    console.log('\nProcessing contract to add 1 more image...');
    const ops = [{
      type: 'put',
      path: ['contract', contract.id],
      data: contract
    }];
    
    const mutations = await dataTransformer.transformOperations(ops, { num: 200 });
    console.log(`Generated ${mutations.length} mutations`);
    
    // Apply mutations
    if (mutations.length > 0) {
      await dgraphClient.writeOperation(mutations);
      console.log('Applied mutations');
    }
    
    // Query again to see the updated count
    const finalResult = await dgraphClient.query(initialQuery);
    const updatedPath = finalResult.path?.find(p => p.owner?.username === "disregardfiat");
    
    if (updatedPath) {
      console.log('\nFinal Images path state:');
      console.log(`  UID: ${updatedPath.uid}`);
      console.log(`  itemCount: ${updatedPath.itemCount}`);
      console.log(`  actual file count: ${updatedPath.fileCount}`);
      
      if (imagesPath) {
        console.log(`\nitemCount change: ${imagesPath.itemCount} -> ${updatedPath.itemCount} (expected: ${imagesPath.itemCount} -> ${imagesPath.itemCount + 1})`);
        console.log(`File count change: ${imagesPath.fileCount} -> ${updatedPath.fileCount}`);
      }
    }
    
  } finally {
    dgraphClient.close();
  }
}

testCumulativeCount().catch(console.error);