#!/usr/bin/env node

import fetch from 'node-fetch';
import dgraph from 'dgraph-js';
import { createDataTransformer } from '../lib/data-transformer.js';
import { createDgraphClient } from '../lib/dgraph-client.js';
import { createNetworkManager } from '../lib/network-manager.js';

async function importDisregardfiatContracts() {
  console.log('Importing disregardfiat contracts...\n');
  
  // Load state from file
  console.log('Loading state from file...');
  const fs = await import('fs/promises');
  const stateData = await fs.readFile('/tmp/spk-state.json', 'utf-8');
  const state = JSON.parse(stateData);
  
  // Extract disregardfiat contracts
  const stateDataObj = state.state || state;
  const contracts = stateDataObj.contract || {};
  const disregardfiatContracts = contracts.disregardfiat || {};
  
  console.log(`Found ${Object.keys(disregardfiatContracts).length} disregardfiat contracts\n`);
  
  // Initialize
  const dgraphClient = createDgraphClient();
  const networkManager = createNetworkManager({
    baseDataPath: './data/honeygraph',
    dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080'
  });
  await networkManager.initialize();
  
  const transformer = createDataTransformer(dgraphClient, networkManager);
  
  let totalMutations = [];
  
  // Process just the first contract for testing
  const firstContract = Object.entries(disregardfiatContracts)[0];
  const [contractId, contractData] = firstContract;
  
  console.log(`Processing contract: ${contractId}`);
  console.log(`Contract data:`, JSON.stringify(contractData, null, 2));
  
  const operation = {
    type: 'put',
    path: ['contract', 'disregardfiat', contractId],
    data: contractData,
    blockNum: 0,
    timestamp: Date.now()
  };
  
  const mutations = await transformer.transformOperation(operation);
  totalMutations.push(...mutations);
  
  console.log(`Generated ${mutations.length} mutations`);
  console.log('Sample mutations:', JSON.stringify(mutations.slice(0, 3), null, 2));
  
  // Import all mutations to Dgraph
  console.log(`\nImporting ${totalMutations.length} total mutations to Dgraph...`);
  
  const txn = dgraphClient.client.newTxn();
  
  try {
    const mu = new dgraph.Mutation();
    mu.setSetJson(totalMutations);
    await txn.mutate(mu);
    await txn.commit();
    console.log('✓ Import successful!');
    
    // Query to verify
    const query = `{
      contracts(func: type(StorageContract)) @filter(regexp(id, /^disregardfiat:/)) {
        id
        status
        fileCount
        purchaser {
          username
        }
      }
    }`;
    
    const result = await dgraphClient.client.newTxn().query(query);
    const resultData = result.getJson();
    
    console.log(`\nImported contracts (${resultData.contracts?.length || 0}):`);
    resultData.contracts?.forEach(contract => {
      console.log(`- ${contract.id} (status: ${contract.status}, files: ${contract.fileCount})`);
    });
    
  } catch (error) {
    console.error('Import failed:', error.message);
  } finally {
    await txn.discard();
  }
}

importDisregardfiatContracts().catch(console.error);