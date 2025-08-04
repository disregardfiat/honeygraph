#!/usr/bin/env node

import { DataTransformer } from '../lib/data-transformer.js';
import { DgraphClient } from '../lib/dgraph-client.js';
import { createLogger } from '../lib/logger.js';
import { pathAccumulator } from '../lib/path-accumulator.js';
import dgraph from 'dgraph-js';

// Override console.log to capture all logs
const originalLog = console.log;
const logs = [];
console.log = (...args) => {
  logs.push(args.join(' '));
  originalLog(...args);
};

async function tracePathLookup() {
  const logger = createLogger('trace-path');
  
  const dgraphClient = new DgraphClient({
    url: 'http://dgraph-alpha:9080',
    namespace: 'spkccT_',
    logger
  });
  
  try {
    // Clean test data
    const cleanData = await dgraphClient.query(`{
      accounts(func: eq(username, "tracetest")) { uid }
      paths(func: type(Path)) @filter(eq(fullPath, "/TracePath")) { uid }
    }`);
    
    const deleteNquads = [];
    [cleanData.accounts, cleanData.paths].forEach(items => {
      if (items) items.forEach(item => deleteNquads.push(`<${item.uid}> * * .`));
    });
    
    if (deleteNquads.length > 0) {
      const cleanTxn = dgraphClient.client.newTxn();
      try {
        const delMutation = new dgraph.Mutation();
        delMutation.setDelNquads(deleteNquads.join('\n'));
        await cleanTxn.mutate(delMutation);
        await cleanTxn.commit();
      } finally {
        await cleanTxn.discard();
      }
    }
    
    const dataTransformer = new DataTransformer(dgraphClient, logger);
    pathAccumulator.startBatch();
    
    // Create first contract
    console.log('\n=== Creating path with first contract ===');
    const contract1 = {
      id: 'trace1',
      type: 'upload',
      t: 'tracetest',
      m: "1|TracePath,file1,txt,,0",
      e: ["QmTrace1"],
      df: { "QmTrace1": 1000 }
    };
    
    const mutations1 = await dataTransformer.transformOperations([{
      type: 'put',
      path: ['contract', 'tracetest', 'trace1'],
      data: contract1
    }], { num: 1 });
    
    const txn1 = dgraphClient.client.newTxn();
    try {
      const mu1 = new dgraph.Mutation();
      mu1.setSetJson(mutations1);
      await txn1.mutate(mu1);
      await txn1.commit();
    } finally {
      await txn1.discard();
    }
    
    // Verify path was created
    const verify1 = await dgraphClient.query(`{
      path(func: type(Path)) @filter(eq(fullPath, "/TracePath")) {
        uid
        fullPath
        itemCount
        Path.externalId
        owner { username }
      }
    }`);
    
    console.log('\nPaths after contract 1:');
    console.log(JSON.stringify(verify1.path, null, 2));
    
    // Now try to add to the same path
    console.log('\n=== Adding to existing path with second contract ===');
    
    // Clear logs to focus on the path lookup
    logs.length = 0;
    
    const contract2 = {
      id: 'trace2',
      type: 'upload',
      t: 'tracetest',
      m: "1|TracePath,file2,txt,,0",
      e: ["QmTrace2"],
      df: { "QmTrace2": 2000 }
    };
    
    const mutations2 = await dataTransformer.transformOperations([{
      type: 'put',
      path: ['contract', 'tracetest', 'trace2'],
      data: contract2
    }], { num: 2 });
    
    // Look for path query logs
    console.log('\n=== Path lookup logs ===');
    const pathLogs = logs.filter(log => 
      log.includes('Path query') || 
      log.includes('getOrCreatePath') ||
      log.includes('Found path') ||
      log.includes('Creating new path')
    );
    pathLogs.forEach(log => console.log(log));
    
    pathAccumulator.endBatch();
    
  } finally {
    dgraphClient.close();
  }
}

tracePathLookup().catch(console.error);