#!/usr/bin/env node

import fetch from 'node-fetch';

async function testDgraphRelationships() {
  console.log('=== Testing Dgraph Relationships ===\n');
  
  try {
    // 1. First, let's see if dlux-io account exists and what fields it has
    console.log('1. Testing if dlux-io account exists...');
    let response = await fetch('http://localhost:3030/api/spk/user/dlux-io');
    let data = await response.json();
    
    console.log('Account found:', !!data.username);
    if (data.username) {
      console.log('Account data keys:', Object.keys(data));
      console.log('contractsStoring:', data.contractsStoring);
    }
    
    // 2. Let's check if any contracts have dlux-io as a storage node
    console.log('\n2. Looking for contracts with dlux-io as storage node...');
    response = await fetch('http://localhost:3030/api/spk/contracts/understored?limit=100');
    data = await response.json();
    
    let contractsWithDluxIo = 0;
    if (data.contracts) {
      data.contracts.forEach(contract => {
        let hasDluxIo = false;
        if (Array.isArray(contract.storageNodes)) {
          hasDluxIo = contract.storageNodes.some(node => node.username === 'dlux-io');
        } else if (contract.storageNodes && contract.storageNodes.username === 'dlux-io') {
          hasDluxIo = true;
        }
        
        if (hasDluxIo) {
          contractsWithDluxIo++;
          if (contractsWithDluxIo <= 3) {
            console.log(`  Contract ${contract.id} has dlux-io as storage node`);
          }
        }
      });
    }
    console.log(`Total contracts with dlux-io as storage node: ${contractsWithDluxIo}`);
    
    // 3. Test a direct query to see the actual data structure
    console.log('\n3. Testing direct query for contract relationships...');
    // Since we can't do raw queries through the API, let's check a specific contract
    if (data.contracts && data.contracts.length > 0) {
      const contractId = data.contracts[0].id;
      console.log(`Checking contract: ${contractId}`);
      console.log(`Storage nodes:`, data.contracts[0].storageNodes);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testDgraphRelationships();