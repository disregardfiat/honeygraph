#!/usr/bin/env node

import { createNetworkManager } from '../lib/network-manager.js';

async function testImportFiles() {
  console.log('Testing file import after database drop...\n');
  
  // Create network manager
  const networkManager = createNetworkManager({
    dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080',
    baseDataPath: process.env.DATA_PATH || '/home/jr/dlux/honeygraph/data'
  });
  await networkManager.initialize();
  
  // Get spkccT_ network
  const network = networkManager.getNetwork('spkccT_');
  if (!network) {
    throw new Error('spkccT_ network not found');
  }
  const dgraphClient = network.dgraphClient;
  
  // Test 1: Check if any files exist
  console.log('Test 1: Checking if files exist...');
  const query1 = `{
    files(func: type(ContractFile)) {
      count: count(uid)
    }
  }`;
  
  const result1 = await dgraphClient.query(query1);
  console.log(`Total files in database: ${result1.files?.[0]?.count || 0}`);
  
  // Test 2: Check a specific contract's files
  console.log('\nTest 2: Checking specific contract files...');
  const query2 = `{
    contracts(func: type(StorageContract), first: 3) @filter(has(fileCount)) {
      id
      fileCount
      files: ~contract @filter(type(ContractFile)) {
        cid
        name
        size
      }
    }
  }`;
  
  const result2 = await dgraphClient.query(query2);
  console.log('Contracts with files:');
  console.log(JSON.stringify(result2.contracts, null, 2));
  
  // Test 3: Check paths
  console.log('\nTest 3: Checking paths...');
  const query3 = `{
    paths(func: type(Path), first: 10) @filter(has(files)) {
      fullPath
      owner {
        username
      }
      itemCount
      files {
        cid
        name
      }
    }
  }`;
  
  const result3 = await dgraphClient.query(query3);
  console.log('Paths with files:');
  console.log(JSON.stringify(result3.paths, null, 2));
  
  // Test 4: Direct file query
  console.log('\nTest 4: Direct file query...');
  const query4 = `{
    files(func: type(ContractFile), first: 5) {
      cid
      name
      size
      path
      contract {
        id
      }
      parentPath {
        fullPath
      }
    }
  }`;
  
  const result4 = await dgraphClient.query(query4);
  console.log('Sample files:');
  console.log(JSON.stringify(result4.files, null, 2));
}

testImportFiles().catch(console.error);