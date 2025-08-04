#!/usr/bin/env node

import { DataTransformer } from './lib/data-transformer.js';
import { DgraphClient } from './lib/dgraph-client.js';
import { createLogger } from './lib/logger.js';
import { pathAccumulator } from './lib/path-accumulator.js';
import dgraph from 'dgraph-js';

async function debugItemCount() {
  const logger = createLogger('debug-itemcount');
  
  const dgraphClient = new DgraphClient({
    url: 'http://dgraph-alpha:9080',
    namespace: 'spkccT_',
    logger
  });
  
  try {
    // Start with a clean test
    console.log('\n=== CLEANING TEST DATA ===');
    const cleanData = await dgraphClient.query(`{
      accounts(func: eq(username, "itemtest")) { uid }
      paths(func: type(Path)) @filter(has(owner)) { 
        uid 
        owner @filter(eq(username, "itemtest")) { username }
      }
      files(func: type(ContractFile)) { 
        uid 
        owner @filter(eq(username, "itemtest")) { username }
      }
    }`);
    
    const deleteNquads = [];
    
    if (cleanData.accounts) {
      cleanData.accounts.forEach(item => deleteNquads.push(`<${item.uid}> * * .`));
    }
    if (cleanData.paths) {
      cleanData.paths.filter(p => p.owner?.username === 'itemtest').forEach(item => deleteNquads.push(`<${item.uid}> * * .`));
    }
    if (cleanData.files) {
      cleanData.files.filter(f => f.owner?.username === 'itemtest').forEach(item => deleteNquads.push(`<${item.uid}> * * .`));
    }
    
    if (deleteNquads.length > 0) {
      const cleanTxn = dgraphClient.client.newTxn();
      try {
        const delMutation = new dgraph.Mutation();
        delMutation.setDelNquads(deleteNquads.join('\n'));
        await cleanTxn.mutate(delMutation);
        await cleanTxn.commit();
        console.log(`Cleaned ${deleteNquads.length} nodes`);
      } finally {
        await cleanTxn.discard();
      }
    }
    
    const dataTransformer = new DataTransformer(dgraphClient, logger);
    pathAccumulator.startBatch();
    
    // Contract 1: Creates path with 2 files
    console.log('\n=== CONTRACT 1: Creating /TestFolder with 2 files ===');
    const contract1 = {
      id: 'itemtest:0:block1',
      type: 'upload',
      t: 'itemtest',
      m: "1|TestFolder,file1,txt,,0,file2,txt,,0",
      e: ["QmFile1", "QmFile2"],
      df: { "QmFile1": 1000, "QmFile2": 2000 }
    };
    
    const op1 = {
      type: 'put',
      path: ['contract', 'itemtest', 'itemtest:0:block1'],
      data: contract1
    };
    
    const mutations1 = await dataTransformer.transformOperations([op1], { num: 1000 });
    console.log(`Generated ${mutations1.length} mutations`);
    
    // Apply mutations
    const txn1 = dgraphClient.client.newTxn();
    try {
      const mu1 = new dgraph.Mutation();
      mu1.setSetJson(mutations1);
      await txn1.mutate(mu1);
      await txn1.commit();
      console.log('Contract 1 committed');
    } finally {
      await txn1.discard();
    }
    
    // Check state
    const check1 = await dgraphClient.query(`{
      path(func: type(Path)) @filter(eq(fullPath, "/TestFolder") AND eq(owner.username, "itemtest")) {
        uid
        fullPath
        itemCount
        owner { username }
        fileCount: count(~parentPath)
      }
    }`);
    console.log('\nAfter Contract 1:');
    console.log(JSON.stringify(check1.path?.[0], null, 2));
    
    // Contract 2: Adds 1 more file to same path
    console.log('\n=== CONTRACT 2: Adding 1 more file to /TestFolder ===');
    const contract2 = {
      id: 'itemtest:0:block2',
      type: 'upload',
      t: 'itemtest',
      m: "1|TestFolder,file3,txt,,0",
      e: ["QmFile3"],
      df: { "QmFile3": 3000 }
    };
    
    const op2 = {
      type: 'put',
      path: ['contract', 'itemtest', 'itemtest:0:block2'],
      data: contract2
    };
    
    // Let's trace through the transformation
    console.log('\nTransforming Contract 2...');
    const mutations2 = await dataTransformer.transformOperations([op2], { num: 1001 });
    console.log(`Generated ${mutations2.length} mutations`);
    
    // Look at the mutations to see what's happening to the path
    console.log('\nMutations for paths:');
    mutations2.forEach(mut => {
      if (mut['dgraph.type'] === 'Path' || mut.fullPath) {
        console.log(JSON.stringify(mut, null, 2));
      }
    });
    
    // Apply mutations
    const txn2 = dgraphClient.client.newTxn();
    try {
      const mu2 = new dgraph.Mutation();
      mu2.setSetJson(mutations2);
      await txn2.mutate(mu2);
      await txn2.commit();
      console.log('\nContract 2 committed');
    } finally {
      await txn2.discard();
    }
    
    // Final check
    const checkFinal = await dgraphClient.query(`{
      path(func: type(Path)) @filter(eq(fullPath, "/TestFolder") AND eq(owner.username, "itemtest")) {
        uid
        fullPath
        itemCount
        owner { username }
        fileCount: count(~parentPath)
      }
    }`);
    
    console.log('\nFinal state:');
    console.log(JSON.stringify(checkFinal.path?.[0], null, 2));
    
    const expected = 3;
    const actual = checkFinal.path?.[0]?.itemCount;
    console.log(`\nExpected itemCount: ${expected}`);
    console.log(`Actual itemCount: ${actual}`);
    console.log(`Result: ${actual === expected ? '✅ PASS' : '❌ FAIL'}`);
    
    pathAccumulator.endBatch();
    
  } finally {
    dgraphClient.close();
  }
}

debugItemCount().catch(console.error);