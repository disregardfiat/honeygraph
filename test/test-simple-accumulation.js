#!/usr/bin/env node

import { DataTransformer } from '../lib/data-transformer.js';
import { DgraphClient } from '../lib/dgraph-client.js';
import { createLogger } from '../lib/logger.js';
import { pathAccumulator } from '../lib/path-accumulator.js';
import dgraph from 'dgraph-js';

async function testSimpleAccumulation() {
  const logger = createLogger('test-simple');
  
  const dgraphClient = new DgraphClient({
    url: 'http://dgraph-alpha:9080',
    namespace: 'spkccT_',
    logger
  });
  
  try {
    // Clear any existing test data first
    const clearQuery = `
      {
        paths(func: type(Path)) @filter(has(owner)) {
          uid
          owner @filter(eq(username, "simpletest")) {
            username
          }
        }
        files(func: type(ContractFile)) @filter(has(parentPath)) {
          uid
          parentPath @filter(eq(owner.username, "simpletest")) {
            owner {
              username
            }
          }
        }
      }
    `;
    
    const clearResult = await dgraphClient.query(clearQuery);
    if (clearResult.paths?.length > 0 || clearResult.files?.length > 0) {
      console.log('Clearing existing test data...');
      const txn = dgraphClient.client.newTxn();
      try {
        const delMutation = new dgraph.Mutation();
        const deleteNquads = [];
        
        clearResult.paths?.filter(p => p.owner?.username === "simpletest").forEach(p => {
          deleteNquads.push(`<${p.uid}> * * .`);
        });
        
        clearResult.files?.filter(f => f.parentPath?.owner?.username === "simpletest").forEach(f => {
          deleteNquads.push(`<${f.uid}> * * .`);
        });
        
        if (deleteNquads.length > 0) {
          delMutation.setDelNquads(deleteNquads.join('\n'));
          await txn.mutate(delMutation);
          await txn.commit();
        }
      } finally {
        await txn.discard();
      }
    }
    
    const dataTransformer = new DataTransformer(dgraphClient, logger);
    
    // Start batch mode
    pathAccumulator.startBatch();
    
    // Process two contracts that add to the same path
    console.log('\n=== Processing Contract 1 ===');
    const ops1 = [{
      type: 'put',
      path: ['contract', 'simple-1'],
      data: {
        id: 'simple-1',
        type: 'upload',
        t: 'simpletest',
        r: 't',
        m: "1|TestPath,file1,txt,,0",
        e: ["QmSimple1"],
        p: 1,
        c: 'simple-1',
        df: { "QmSimple1": 1000 }
      }
    }];
    
    const blockInfo1 = { num: 500 };
    const mutations1 = await dataTransformer.transformOperations(ops1, blockInfo1);
    
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
    
    // Check state after first contract
    const check1 = await dgraphClient.query(`{
      path(func: type(Path)) @filter(eq(fullPath, "/TestPath") AND eq(owner.username, "simpletest")) {
        uid
        itemCount
      }
    }`);
    console.log('After Contract 1:', check1.path?.[0]);
    
    console.log('\n=== Processing Contract 2 ===');
    const ops2 = [{
      type: 'put',
      path: ['contract', 'simple-2'],
      data: {
        id: 'simple-2',
        type: 'upload',
        t: 'simpletest',
        r: 't',
        m: "1|TestPath,file2,txt,,0",
        e: ["QmSimple2"],
        p: 1,
        c: 'simple-2',
        df: { "QmSimple2": 2000 }
      }
    }];
    
    const blockInfo2 = { num: 501 };
    const mutations2 = await dataTransformer.transformOperations(ops2, blockInfo2);
    
    // Apply mutations
    const txn2 = dgraphClient.client.newTxn();
    try {
      const mu2 = new dgraph.Mutation();
      mu2.setSetJson(mutations2);
      await txn2.mutate(mu2);
      await txn2.commit();
      console.log('Contract 2 committed');
    } finally {
      await txn2.discard();
    }
    
    // Check final state
    const checkFinal = await dgraphClient.query(`{
      path(func: type(Path)) @filter(eq(fullPath, "/TestPath") AND eq(owner.username, "simpletest")) {
        uid
        itemCount
        fileCount: count(~parentPath)
      }
    }`);
    
    const finalPath = checkFinal.path?.[0];
    console.log('\nFinal state:', finalPath);
    console.log(`Result: ${finalPath?.itemCount === 2 ? '✅ PASS' : '❌ FAIL'} (expected itemCount: 2)`);
    
    // End batch mode
    pathAccumulator.endBatch();
    
  } finally {
    dgraphClient.close();
  }
}

testSimpleAccumulation().catch(console.error);