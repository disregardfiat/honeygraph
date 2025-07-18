#!/usr/bin/env node

import fetch from 'node-fetch';
import dgraph from 'dgraph-js';
import { createDataTransformer } from '../lib/data-transformer.js';
import { createDgraphClient } from '../lib/dgraph-client.js';
import { createNetworkManager } from '../lib/network-manager.js';

async function testStateContracts() {
  console.log('Testing state contract import...\n');
  
  // Download state
  console.log('Downloading state...');
  const response = await fetch('https://spktest.dlux.io/state');
  const state = await response.json();
  
  // Extract contracts
  const stateData = state.state || state;
  const contracts = stateData.contract || {};
  
  console.log(`Found ${Object.keys(contracts).length} users with contracts\n`);
  
  // Count total contracts
  let totalContracts = 0;
  let sampleContracts = [];
  
  for (const [username, userContracts] of Object.entries(contracts)) {
    const contractCount = Object.keys(userContracts).length;
    totalContracts += contractCount;
    
    if (sampleContracts.length < 3) {
      for (const [contractId, contractData] of Object.entries(userContracts)) {
        if (sampleContracts.length < 3) {
          sampleContracts.push({
            username,
            contractId,
            data: contractData
          });
        }
      }
    }
  }
  
  console.log(`Total contracts: ${totalContracts}\n`);
  console.log('Sample contracts:');
  sampleContracts.forEach(sc => {
    console.log(`- ${sc.contractId} (owner: ${sc.username})`);
    console.log(`  Status: ${sc.data.c}, Files: ${sc.data.df ? Object.keys(sc.data.df).length : 0}`);
  });
  
  // Test transforming one contract
  console.log('\nTesting transformation...');
  
  const dgraphClient = createDgraphClient();
  const networkManager = createNetworkManager({
    baseDataPath: './data/honeygraph',
    dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080'
  });
  await networkManager.initialize();
  
  const transformer = createDataTransformer(dgraphClient, networkManager);
  
  const sample = sampleContracts[0];
  const operation = {
    type: 'put',
    path: ['contract', sample.username, sample.contractId],
    data: sample.data,
    blockNum: 0,
    timestamp: Date.now()
  };
  
  const mutations = await transformer.transformOperation(operation);
  console.log(`Generated ${mutations.length} mutations`);
  
  // Import
  console.log('\nImporting sample to Dgraph...');
  const txn = dgraphClient.client.newTxn();
  
  try {
    const mu = new dgraph.Mutation();
    mu.setSetJson(mutations);
    await txn.mutate(mu);
    await txn.commit();
    console.log('✓ Import successful!');
    
    // Query
    const query = `{
      contracts(func: has(id), first: 5) @filter(eq(dgraph.type, "StorageContract")) {
        id
        status
        fileCount
        purchaser {
          username
        }
      }
    }`;
    
    const result = await dgraphClient.client.newTxn().query(query);
    console.log('\nContracts in DB:');
    console.log(JSON.stringify(result.getJson(), null, 2));
    
  } catch (error) {
    console.error('Import failed:', error.message);
  } finally {
    await txn.discard();
  }
}

testStateContracts().catch(console.error);