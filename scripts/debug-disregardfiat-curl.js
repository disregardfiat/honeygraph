#!/usr/bin/env node

import fetch from 'node-fetch';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

console.log('🔍 Debug disregardfiat contracts with curl');

async function queryDgraph(query) {
  try {
    const { stdout } = await execAsync(`curl -X POST "http://localhost:8180/query" -H "Content-Type: application/dql" -d '${query}'`);
    return JSON.parse(stdout);
  } catch (error) {
    console.error('Query error:', error);
    return null;
  }
}

// Check current contracts in database
console.log('📊 Checking current database state...');

const contractQuery = `{
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

const dbResult = await queryDgraph(contractQuery);
if (dbResult && dbResult.data) {
  console.log(`\nDisregardfiat contracts in DB: ${dbResult.data.disregard_contracts.length}`);
  console.log(`Total contracts in DB: ${dbResult.data.all_contracts.length}`);
  
  if (dbResult.data.all_contracts.length > 0) {
    console.log('\nSample contracts:');
    dbResult.data.all_contracts.forEach(contract => {
      console.log(`  ${contract.id} (owner: ${contract.owner.username}, files: ${contract.fileCount})`);
    });
  }
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
  
  // Check for owner field vs contractId mismatch
  console.log(`\nOwnership analysis:`);
  let ownedContracts = 0;
  let purchasedContracts = 0;
  
  Object.entries(contractData).forEach(([contractId, contract]) => {
    if (contract.t === 'disregardfiat') {
      ownedContracts++;
    }
    if (contract.f === 'disregardfiat') {
      purchasedContracts++;
    }
  });
  
  console.log(`  Contracts owned by disregardfiat (t field): ${ownedContracts}`);
  console.log(`  Contracts purchased by disregardfiat (f field): ${purchasedContracts}`);
  console.log(`  Total contracts with disregardfiat in path: ${Object.keys(contractData).length}`);
  
} catch (error) {
  console.error('State fetch error:', error);
}

console.log('\n✅ Debug complete');