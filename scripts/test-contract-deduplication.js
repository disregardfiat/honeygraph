#!/usr/bin/env node

import { DgraphClient } from '../lib/dgraph-client.js';
import { createSPKDataTransformer } from '../lib/spk-data-transformer.js';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';

async function testContractDeduplication() {
  console.log(chalk.cyan('\n📋 Testing Storage Contract Deduplication\n'));
  
  const dgraphClient = new DgraphClient({
    url: process.env.DGRAPH_URL || 'http://localhost:9080',
    logger: console
  });
  
  const networkManager = {
    getNetwork: () => ({ namespace: 'spkccT_' })
  };
  
  const transformer = createSPKDataTransformer(dgraphClient, networkManager);
  
  try {
    // Query for duplicate contracts
    console.log(chalk.yellow('Checking for duplicate storage contracts...'));
    
    const query = `
      {
        duplicateCheck(func: type(StorageContract)) {
          id
          count: count(uid)
        }
        
        groupedContracts(func: type(StorageContract)) @groupby(id) {
          count(uid)
        }
      }
    `;
    
    const result = await dgraphClient.query(query);
    
    // Process results to find duplicates
    const contractCounts = {};
    if (result.duplicateCheck) {
      for (const contract of result.duplicateCheck) {
        if (!contractCounts[contract.id]) {
          contractCounts[contract.id] = 0;
        }
        contractCounts[contract.id]++;
      }
    }
    
    // Find duplicates
    const duplicates = Object.entries(contractCounts)
      .filter(([id, count]) => count > 1)
      .sort((a, b) => b[1] - a[1]);
    
    if (duplicates.length > 0) {
      console.log(chalk.red(`\n❌ Found ${duplicates.length} duplicate contract IDs:\n`));
      
      // Show top 10 duplicates
      for (const [contractId, count] of duplicates.slice(0, 10)) {
        console.log(chalk.red(`  - ${contractId}: ${count} copies`));
        
        // Query for details of this duplicate
        const detailQuery = `
          query getContractDetails($contractId: string) {
            contracts(func: eq(id, $contractId)) @filter(type(StorageContract)) {
              uid
              id
              blockNumber
              fileCount
              purchaser {
                username
              }
              owner {
                username
              }
            }
          }
        `;
        
        const details = await dgraphClient.query(detailQuery, { $contractId: contractId });
        if (details.contracts && details.contracts.length > 1) {
          console.log(chalk.gray(`    Found ${details.contracts.length} instances:`));
          for (const instance of details.contracts) {
            console.log(chalk.gray(`      - UID: ${instance.uid}, Block: ${instance.blockNumber}, Files: ${instance.fileCount || 0}`));
          }
        }
      }
      
      console.log(chalk.yellow(`\n⚠️  Total duplicate contracts: ${duplicates.length}`));
      console.log(chalk.yellow(`⚠️  Total extra copies: ${duplicates.reduce((sum, [, count]) => sum + (count - 1), 0)}`));
      
    } else {
      console.log(chalk.green('\n✅ No duplicate storage contracts found!'));
    }
    
    // Check total unique contracts
    const uniqueCount = Object.keys(contractCounts).length;
    const totalCount = Object.values(contractCounts).reduce((sum, count) => sum + count, 0);
    
    console.log(chalk.cyan(`\n📊 Summary:`));
    console.log(`  - Total contract entries: ${totalCount}`);
    console.log(`  - Unique contract IDs: ${uniqueCount}`);
    console.log(`  - Duplication ratio: ${(totalCount / uniqueCount).toFixed(2)}x`);
    
  } catch (error) {
    console.error(chalk.red('\nError checking duplicates:'), error);
  } finally {
    await dgraphClient.close();
  }
}

// Run the test
testContractDeduplication().catch(console.error);