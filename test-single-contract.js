#!/usr/bin/env node

import { DataTransformer } from './lib/data-transformer.js';
import { DgraphClient } from './lib/dgraph-client.js';
import { createLogger } from './lib/logger.js';

async function testSingleContract() {
  const logger = createLogger('test-single');
  
  const dgraphClient = new DgraphClient({
    url: 'http://dgraph-alpha:9080',
    namespace: 'spkccT_',
    logger
  });
  
  try {
    const dataTransformer = new DataTransformer(dgraphClient, logger);
    
    // Create metadata string in the expected format
    // Format: "autorenew|folder1|folder2,file1,ext1,thumb1,flags1,file2,ext2,thumb2,flags2,..."
    // For simple uploads to Ragnarok folder: "1|Ragnarok,test1,txt,,0,test2,txt,,0,test3,txt,,0"
    const metadata1 = "1|Ragnarok,test1,txt,,0,test2,txt,,0,test3,txt,,0";
    
    // Create a test contract that should deduplicate paths
    const contract1 = {
      id: 'test-contract-1',
      type: 'upload',
      t: 'disregardfiat',
      r: 't',
      m: metadata1,
      e: ["QmTest1", "QmTest2", "QmTest3"],
      p: 1,
      c: 'contract-1',
      df: {
        "QmTest1": 100,
        "QmTest2": 200,
        "QmTest3": 300
      }
    };
    
    // Second contract - also to Ragnarok folder
    const metadata2 = "1|Ragnarok,test4,txt,,0,test5,txt,,0";
    
    const contract2 = {
      id: 'test-contract-2', 
      type: 'upload',
      t: 'disregardfiat',
      r: 't',
      m: metadata2,
      e: ["QmTest4", "QmTest5"],
      p: 1,
      c: 'contract-2',
      df: {
        "QmTest4": 400,
        "QmTest5": 500
      }
    };
    
    // Process first contract
    console.log('\nProcessing first contract...');
    const ops1 = [{
      type: 'put',
      path: ['contract', contract1.id],
      data: contract1
    }];
    const mutations1 = await dataTransformer.transformOperations(ops1, { num: 100 });
    console.log('Mutations from contract 1:', mutations1.length);
    
    // Apply first contract
    if (mutations1.length > 0) {
      await dgraphClient.writeOperation(mutations1);
      console.log('Applied contract 1');
    }
    
    // Process second contract - should reuse the Ragnarok path
    console.log('\nProcessing second contract...');
    const ops2 = [{
      type: 'put',
      path: ['contract', contract2.id],
      data: contract2
    }];
    const mutations2 = await dataTransformer.transformOperations(ops2, { num: 101 });
    console.log('Mutations from contract 2:', mutations2.length);
    
    // Apply second contract
    if (mutations2.length > 0) {
      await dgraphClient.writeOperation(mutations2);
      console.log('Applied contract 2');
    }
    
    // Query to verify results
    const query = `
      {
        paths(func: type(Path)) @filter(eq(fullPath, "/Ragnarok")) {
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
    console.log('\nFinal Ragnarok paths:', result.paths?.length || 0);
    if (result.paths) {
      result.paths.forEach(p => {
        console.log(`  ${p.uid}: owner=${p.owner?.username}, itemCount=${p.itemCount}, fileCount=${p.fileCount}`);
      });
    }
    
  } finally {
    dgraphClient.close();
  }
}

testSingleContract().catch(console.error);