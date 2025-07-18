#!/usr/bin/env node

import fetch from 'node-fetch';
import dgraph from 'dgraph-js';
import grpc from '@grpc/grpc-js';

console.log('🔍 Debug disregardfiat contracts in database');

// Simple Dgraph connection
const dgraphStub = dgraph.newDgraphClientStub('localhost:9080', grpc.credentials.createInsecure());
const dgraphClient = dgraph.newDgraphClient(dgraphStub);

// Check current contracts in database
console.log('📊 Checking current database state...');

try {
  const query = `{
    disregard_contracts(func: eq(owner.username, "disregardfiat")) {
      id
      owner { username }
      fileCount
      status
    }
    
    all_contracts(func: type(StorageContract), first: 10) {
      id
      owner { username }
      fileCount
      status
    }
  }`;
  
  const txn = dgraphClient.newTxn();
  const res = await txn.query(query);
  await txn.discard();
  
  const data = res.getJson();
  
  console.log(`\nDisregardfiat contracts in DB: ${data.disregard_contracts.length}`);
  console.log(`Total contracts in DB: ${data.all_contracts.length}`);
  
  if (data.all_contracts.length > 0) {
    console.log('\nSample contracts:');
    data.all_contracts.forEach(contract => {
      console.log(`  ${contract.id} (owner: ${contract.owner.username}, files: ${contract.fileCount})`);
    });
  }
  
} catch (error) {
  console.error('Database query error:', error);
}

// Check state data
console.log('\n📥 Checking state data...');
try {
  const response = await fetch('https://spktest.dlux.io/state');
  const stateData = await response.json();
  
  const contractData = stateData.state.contract.disregardfiat;
  console.log(`Disregardfiat contracts in state: ${Object.keys(contractData).length}`);
  
  // Show first contract details
  const firstContractId = Object.keys(contractData)[0];
  const firstContract = contractData[firstContractId];
  
  console.log(`\nFirst contract (${firstContractId}):`);
  console.log(`  Status: ${firstContract.c}`);
  console.log(`  Purchaser: ${firstContract.f}`);
  console.log(`  Owner: ${firstContract.t || 'N/A'}`);
  console.log(`  Files: ${firstContract.df ? Object.keys(firstContract.df).length : 0}`);
  console.log(`  Metadata: ${firstContract.m || 'N/A'}`);
  
  if (firstContract.df) {
    console.log(`  File CIDs: ${Object.keys(firstContract.df).slice(0, 3).join(', ')}...`);
  }
  
} catch (error) {
  console.error('State fetch error:', error);
}

console.log('\n✅ Debug complete');