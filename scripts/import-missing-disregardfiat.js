#!/usr/bin/env node

import fetch from 'node-fetch';
import { createDataTransformer } from '../lib/data-transformer.js';
import { createDgraphClient } from '../lib/dgraph-client.js';
import { createNetworkManager } from '../lib/network-manager.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('missing-disregardfiat');

console.log('🔄 Import missing disregardfiat contracts');

try {
  // Initialize
  const dgraphClient = createDgraphClient();
  const networkManager = createNetworkManager({
    baseDataPath: './data/honeygraph',
    dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080'
  });
  await networkManager.initialize();
  
  // Check which contracts are already in DB
  console.log('📊 Checking existing contracts...');
  const query = `{
    existing(func: eq(owner.username, "disregardfiat")) {
      id
    }
  }`;
  
  const txn = networkManager.getDgraphClient().client.newTxn();
  const res = await txn.queryWithVars(query, {});
  await txn.discard();
  
  const existingContracts = res.getJson().existing.map(c => c.id);
  console.log(`Found ${existingContracts.length} existing disregardfiat contracts`);
  
  // Fetch all contracts from state
  console.log('📥 Fetching state...');
  const response = await fetch('https://spktest.dlux.io/state');
  const stateData = await response.json();
  const contractData = stateData.state.contract.disregardfiat;
  
  console.log(`Found ${Object.keys(contractData).length} contracts in state`);
  
  // Find missing contracts
  const allContractIds = Object.keys(contractData);
  const missingContracts = allContractIds.filter(id => !existingContracts.includes(id));
  
  console.log(`Missing contracts: ${missingContracts.length}`);
  missingContracts.forEach(id => console.log(`  - ${id}`));
  
  if (missingContracts.length === 0) {
    console.log('✅ All contracts already imported');
    process.exit(0);
  }
  
  // Create operations for missing contracts
  const operations = missingContracts.map(contractId => ({
    type: 'put',
    path: ['contract', 'disregardfiat', contractId],
    data: contractData[contractId]
  }));
  
  console.log(`🔄 Processing ${operations.length} missing contracts...`);
  
  // Transform and import
  const transformer = createDataTransformer(networkManager.getDgraphClient(), networkManager);
  const blockInfo = { blockNum: 12345, timestamp: Date.now() };
  const mutations = await transformer.transformOperations(operations, blockInfo);
  
  console.log(`Generated ${mutations.length} mutations`);
  
  // Import mutations
  if (mutations.length > 0) {
    console.log('💾 Importing mutations...');
    const importTxn = networkManager.getDgraphClient().client.newTxn();
    const mu = networkManager.getDgraphClient().newMutation();
    mu.setSetJson(mutations);
    await importTxn.mutate(mu);
    await importTxn.commit();
    
    console.log('✅ Import complete');
    
    // Verify import
    console.log('🔍 Verifying import...');
    const verifyTxn = networkManager.getDgraphClient().client.newTxn();
    const verifyRes = await verifyTxn.queryWithVars(`{
      count(func: eq(owner.username, "disregardfiat")) {
        count(uid)
      }
    }`, {});
    await verifyTxn.discard();
    
    const newCount = verifyRes.getJson().count[0].count;
    console.log(`Total disregardfiat contracts now: ${newCount}`);
  }
  
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
}