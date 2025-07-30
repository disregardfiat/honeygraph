#!/usr/bin/env node

import { createNetworkManager } from '../lib/network-manager.js';

async function testStorageNodes() {
  console.log('Testing storage nodes in database...\n');
  
  // Create network manager
  const networkManager = createNetworkManager({
    dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080',
    baseDataPath: process.env.DATA_PATH || './data'
  });
  await networkManager.initialize();
  
  // Get spkccT_ network
  const network = networkManager.getNetwork('spkccT_');
  if (!network) {
    throw new Error('spkccT_ network not found');
  }
  const dgraphClient = network.dgraphClient;
  
  // Test 1: Check if any contracts have storage nodes
  console.log('Test 1: Checking contracts with storage nodes...');
  const query1 = `{
    contracts(func: type(StorageContract)) @filter(has(storageNodes)) {
      count: count(uid)
    }
    totalContracts(func: type(StorageContract)) {
      count: count(uid)
    }
  }`;
  
  const result1 = await dgraphClient.query(query1);
  console.log(`Contracts with storage nodes: ${result1.contracts?.[0]?.count || 0}`);
  console.log(`Total contracts: ${result1.totalContracts?.[0]?.count || 0}\n`);
  
  // Test 2: Check a specific contract
  console.log('Test 2: Checking specific contract...');
  const query2 = `{
    contracts(func: type(StorageContract), first: 3) {
      uid
      id
      contractAccount
      nodeTotal
      storageNodes {
        uid
        username
      }
    }
  }`;
  
  const result2 = await dgraphClient.query(query2);
  console.log('Sample contracts:');
  console.log(JSON.stringify(result2.contracts, null, 2));
  
  // Test 3: Check if accounts have contractsStoring
  console.log('\nTest 3: Checking accounts with contractsStoring...');
  const query3 = `{
    accounts(func: type(Account)) @filter(has(contractsStoring)) {
      count: count(uid)
    }
    dluxio(func: eq(username, "dlux-io")) {
      uid
      username
      contractsStoring {
        id
      }
    }
  }`;
  
  const result3 = await dgraphClient.query(query3);
  console.log(`Accounts storing contracts: ${result3.accounts?.[0]?.count || 0}`);
  console.log('dlux-io account:', JSON.stringify(result3.dluxio, null, 2));
  
  // Test 4: Raw edge check
  console.log('\nTest 4: Raw edge check...');
  const query4 = `{
    contracts(func: type(StorageContract), first: 1) {
      uid
      id
      expand(_all_) {
        uid
        username
        id
      }
    }
  }`;
  
  const result4 = await dgraphClient.query(query4);
  console.log('Contract with all edges:');
  console.log(JSON.stringify(result4.contracts?.[0], null, 2));
}

testStorageNodes().catch(console.error);