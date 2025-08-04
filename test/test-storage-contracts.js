#!/usr/bin/env node

import { DgraphClient } from '../lib/dgraph-client.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('test-storage-contracts');
const dgraphClient = new DgraphClient({
  url: process.env.DGRAPH_URL || 'http://localhost:8080',
  logger
});

async function main() {
  try {
    console.log('=== Testing Storage Contracts ===\n');
    
    // 1. Check if accounts exist
    console.log('1. Checking accounts...');
    const accountQuery = `
      {
        accounts(func: has(Account.username), first: 20) {
          uid
          username: Account.username
          contractsStoring {
            uid
            id
          }
        }
        
        dluxAccount(func: eq(Account.username, "dlux-io")) {
          uid
          username: Account.username
          contractsStoring {
            uid
            id
            owner {
              username: Account.username
            }
          }
        }
      }
    `;
    
    const txn1 = dgraphClient.client.newTxn();
    const accountResult = await txn1.query(accountQuery);
    const accountData = accountResult.getJson();
    
    console.log('Total accounts found:', accountData.accounts?.length || 0);
    console.log('Sample accounts:', accountData.accounts?.slice(0, 5).map(a => a.username));
    console.log('\ndlux-io account:', accountData.dluxAccount);
    
    // 2. Check storage contracts
    console.log('\n2. Checking storage contracts...');
    const contractQuery = `
      {
        contracts(func: type(StorageContract), first: 5) {
          uid
          id
          owner {
            username: Account.username
          }
          status
          power
          nodeTotal
          isUnderstored
          storageNodes {
            uid
            username: Account.username
          }
        }
        
        understored(func: type(StorageContract)) @filter(eq(isUnderstored, true)) {
          total: count(uid)
        }
      }
    `;
    
    const txn2 = dgraphClient.client.newTxn();
    const contractResult = await txn2.query(contractQuery);
    const contractData = contractResult.getJson();
    
    console.log('\nTotal understored contracts:', contractData.understored?.[0]?.total || 0);
    console.log('\nSample contracts:');
    contractData.contracts?.forEach(contract => {
      console.log(`\nContract: ${contract.id}`);
      console.log(`  Owner: ${contract.owner?.username}`);
      console.log(`  Status: ${contract.status}`);
      console.log(`  Power: ${contract.power}, NodeTotal: ${contract.nodeTotal}`);
      console.log(`  Understored: ${contract.isUnderstored}`);
      console.log(`  Storage Nodes:`, contract.storageNodes);
    });
    
    // 3. Test specific contract with multiple nodes
    console.log('\n3. Looking for contracts with multiple storage nodes...');
    const multiNodeQuery = `
      {
        multiNode(func: type(StorageContract)) @filter(gt(nodeTotal, 1)) {
          uid
          id
          owner {
            username: Account.username
          }
          power
          nodeTotal
          storageNodes {
            uid
            username: Account.username
          }
        }
      }
    `;
    
    const txn3 = dgraphClient.client.newTxn();
    const multiNodeResult = await txn3.query(multiNodeQuery);
    const multiNodeData = multiNodeResult.getJson();
    
    console.log('\nContracts with multiple nodes:', multiNodeData.multiNode?.length || 0);
    if (multiNodeData.multiNode?.length > 0) {
      console.log('Sample multi-node contract:', multiNodeData.multiNode[0]);
    }
    
    // 4. Check reverse edge (contractsStoring)
    console.log('\n4. Checking reverse edges (contractsStoring)...');
    const reverseQuery = `
      {
        storageProviders(func: has(contractsStoring)) {
          uid
          username: Account.username
          contractsStoring {
            uid
            id
            owner {
              username: Account.username
            }
            power
            nodeTotal
          }
        }
      }
    `;
    
    const txn4 = dgraphClient.client.newTxn();
    const reverseResult = await txn4.query(reverseQuery);
    const reverseData = reverseResult.getJson();
    
    console.log('\nStorage providers found:', reverseData.storageProviders?.length || 0);
    reverseData.storageProviders?.slice(0, 3).forEach(provider => {
      console.log(`\nProvider: ${provider.username}`);
      console.log(`  Storing ${provider.contractsStoring?.length || 0} contracts`);
      provider.contractsStoring?.slice(0, 2).forEach(contract => {
        console.log(`    - ${contract.id} (owner: ${contract.owner?.username}, power: ${contract.power})`);
      });
    });
    
    console.log('\n=== Test Complete ===');
    
  } catch (error) {
    console.error('Error:', error.message);
    logger.error('Test failed', { error: error.stack });
  } finally {
    await dgraphClient.close();
  }
}

main();