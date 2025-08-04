#!/usr/bin/env node

import fetch from 'node-fetch';

async function testStorageAPIs() {
  const baseUrl = 'http://localhost:3030/api/spk';
  
  console.log('=== Testing Storage Contract APIs ===\n');
  
  try {
    // 1. Test understored contracts endpoint
    console.log('1. Testing /contracts/understored endpoint...');
    const understored = await fetch(`${baseUrl}/contracts/understored?limit=3`);
    const understoredData = await understored.json();
    
    console.log(`Found ${understoredData.total || 0} understored contracts`);
    if (understoredData.contracts && understoredData.contracts.length > 0) {
      console.log('\nFirst contract:');
      const contract = understoredData.contracts[0];
      console.log(`  ID: ${contract.id}`);
      console.log(`  Owner: ${contract.owner?.username}`);
      console.log(`  Power: ${contract.power}, NodeTotal: ${contract.nodeTotal}`);
      console.log(`  StorageNodes:`, JSON.stringify(contract.storageNodes, null, 2));
      console.log(`  StorageNodes type:`, Array.isArray(contract.storageNodes) ? 'array' : typeof contract.storageNodes);
    }
    
    // 2. Test stored-by endpoint for dlux-io
    console.log('\n2. Testing /contracts/stored-by/dlux-io endpoint...');
    const storedBy = await fetch(`${baseUrl}/contracts/stored-by/dlux-io`);
    const storedByData = await storedBy.json();
    
    if (storedByData.error) {
      console.log(`Error: ${storedByData.error}`);
    } else {
      console.log(`dlux-io is storing ${storedByData.count || 0} contracts`);
      if (storedByData.contractsStoring && storedByData.contractsStoring.length > 0) {
        console.log('\nFirst contract stored:');
        const contract = storedByData.contractsStoring[0];
        console.log(`  ID: ${contract.id}`);
        console.log(`  Owner: ${contract.owner?.username}`);
        console.log(`  Power: ${contract.power}, NodeTotal: ${contract.nodeTotal}`);
      }
    }
    
    // 3. Test contract details endpoint
    console.log('\n3. Testing /contracts/:id endpoint...');
    if (understoredData.contracts && understoredData.contracts.length > 0) {
      const contractId = understoredData.contracts[0].id;
      const details = await fetch(`${baseUrl}/contracts/${encodeURIComponent(contractId)}`);
      const detailsData = await details.json();
      
      if (detailsData.error) {
        console.log(`Error: ${detailsData.error}`);
      } else {
        console.log(`Contract ${contractId}:`);
        console.log(`  Status: ${detailsData.status}`);
        console.log(`  Files: ${detailsData.fileCount}`);
        console.log(`  Storage Nodes:`, JSON.stringify(detailsData.storageNodes, null, 2));
      }
    }
    
    // 4. Raw query test
    console.log('\n4. Testing raw query through /api/query...');
    const rawQuery = await fetch('http://localhost:3030/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{
          accounts(func: eq(Account.username, "dlux-io")) {
            uid
            username: Account.username
            contractsStoring {
              uid
              id
            }
          }
          
          contracts(func: type(StorageContract), first: 1) {
            uid
            id
            storageNodes {
              uid
              username: Account.username
            }
          }
        }`
      })
    });
    
    const rawData = await rawQuery.json();
    console.log('Raw query results:', JSON.stringify(rawData, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
  }
  
  console.log('\n=== Test Complete ===');
}

testStorageAPIs();