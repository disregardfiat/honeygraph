#!/usr/bin/env node

import { createNetworkManager } from '../lib/network-manager.js';
import dgraph from 'dgraph-js';

async function testContractStorage() {
  console.log('Testing contract storage nodes...\n');
  
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
  
  // Query for a contract with storage nodes
  const query = `{
    contracts(func: type(StorageContract), first: 5) {
      uid
      id
      nodeTotal
      storageNodes {
        uid
        username
      }
    }
  }`;
  
  console.log('Querying contracts...');
  const result = await dgraphClient.query(query);
  console.log('Query result:', JSON.stringify(result, null, 2));
  
  // Try to manually add storage nodes to a contract
  if (result.contracts && result.contracts.length > 0) {
    const contract = result.contracts[0];
    console.log('\nAttempting to add storage nodes to contract:', contract.id);
    
    // Check if dlux-io account exists
    const accountQuery = `{
      account(func: eq(username, "dlux-io")) {
        uid
        username
      }
    }`;
    
    const accountResult = await dgraphClient.query(accountQuery);
    console.log('Account query result:', JSON.stringify(accountResult, null, 2));
    
    if (accountResult.account && accountResult.account.length > 0) {
      const dluxUid = accountResult.account[0].uid;
      console.log('Found dlux-io with UID:', dluxUid);
      
      // Try to update the contract with storage nodes
      const mutation = {
        uid: contract.uid,
        storageNodes: [{ uid: dluxUid }]
      };
      
      console.log('Mutation:', JSON.stringify(mutation, null, 2));
      
      const txn = dgraphClient.client.newTxn();
      try {
        const mu = new dgraph.Mutation();
        mu.setSetJson(mutation);
        await txn.mutate(mu);
        await txn.commit();
        console.log('Mutation committed successfully');
        
        // Query again to verify
        const verifyResult = await dgraphClient.query(query);
        console.log('\nVerification query result:', JSON.stringify(verifyResult.contracts[0], null, 2));
      } catch (error) {
        console.error('Mutation failed:', error.message);
      } finally {
        await txn.discard();
      }
    }
  }
}

testContractStorage().catch(console.error);