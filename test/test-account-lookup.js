#!/usr/bin/env node

import fetch from 'node-fetch';

async function debugAccountIssue() {
  console.log('=== Debugging Account Lookup Issue ===\n');
  
  try {
    // 1. First, let's see what accounts exist
    console.log('1. Checking what accounts exist in the system...');
    const accountsResponse = await fetch('http://localhost:3030/api/spk/accounts?limit=10');
    const accountsData = await accountsResponse.json();
    
    if (accountsData.accounts) {
      console.log(`Found ${accountsData.accounts.length} accounts:`);
      accountsData.accounts.forEach(acc => console.log(`  - ${acc.username}`));
    } else if (accountsData.error) {
      console.log('Error getting accounts:', accountsData.error);
    }
    
    // 2. Let's check the understored contracts to see what storage nodes they have
    console.log('\n2. Checking understored contracts for storage nodes...');
    const understoredResponse = await fetch('http://localhost:3030/api/spk/contracts/understored?limit=5');
    const understoredData = await understoredResponse.json();
    
    if (understoredData.contracts) {
      const storageNodeAccounts = new Set();
      understoredData.contracts.forEach(contract => {
        if (contract.storageNodes) {
          if (Array.isArray(contract.storageNodes)) {
            contract.storageNodes.forEach(node => {
              if (node.username) storageNodeAccounts.add(node.username);
            });
          } else if (contract.storageNodes.username) {
            storageNodeAccounts.add(contract.storageNodes.username);
          }
        }
      });
      
      console.log('Storage node accounts found in contracts:');
      Array.from(storageNodeAccounts).forEach(acc => console.log(`  - ${acc}`));
    }
    
    // 3. Try different username formats
    console.log('\n3. Testing different username formats for dlux-io...');
    const usernamesToTest = ['dlux-io', 'dlux.io', 'dluxio', 'dlux_io'];
    
    for (const username of usernamesToTest) {
      const response = await fetch(`http://localhost:3030/api/spk/contracts/stored-by/${username}`);
      const data = await response.json();
      console.log(`  ${username}: ${data.error ? 'Not found' : `Found (${data.count} contracts)`}`);
    }
    
    // 4. Check if the issue is with the Account.username predicate
    console.log('\n4. Testing raw account lookup...');
    // This would need a raw query endpoint, but we can infer from the results above
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

debugAccountIssue();