#!/usr/bin/env node

import { createNetworkManager } from './lib/network-manager.js';

async function queryContracts() {
  try {
    // Initialize network manager  
    const networkManager = createNetworkManager({
      baseDataPath: './data/honeygraph',
      dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080'
    });
    await networkManager.initialize();
    
    // Get spkccT_ network client
    const network = networkManager.getNetwork('spkccT_');
    if (!network) {
      console.log('spkccT_ network not found');
      return;
    }
    
    console.log('Querying disregardfiat account...');
    
    // Query for disregardfiat account
    const accountQuery = `{
      account(func: eq(username, "disregardfiat")) {
        username
        uid
        contracts {
          uid
          id
          fileCount
        }
      }
    }`;
    
    const accountResult = await network.dgraphClient.query(accountQuery);
    console.log('Account result:', JSON.stringify(accountResult, null, 2));
    
    // Query for all StorageContract entities
    console.log('\nQuerying all contracts...');
    const contractQuery = `{
      contracts(func: type(StorageContract)) {
        uid
        id
        purchaser { username }
        owner { username }
        fileCount
      }
    }`;
    
    const contractResult = await network.dgraphClient.query(contractQuery);
    console.log('Contract result:', JSON.stringify(contractResult, null, 2));
    
    // Query for contract files
    console.log('\nQuerying contract files...');
    const fileQuery = `{
      files(func: type(ContractFile)) @filter(eq(contract, uid(c))) {
        uid
        cid
        name
        path
        flags
        contract { id }
      }
      
      c as var(func: type(StorageContract)) @filter(eq(owner, uid(u)))
      u as var(func: eq(username, "disregardfiat"))
    }`;
    
    const fileResult = await network.dgraphClient.query(fileQuery);
    console.log('File result:', JSON.stringify(fileResult, null, 2));
    
  } catch (error) {
    console.error('Query failed:', error);
  }
  
  process.exit(0);
}

queryContracts();