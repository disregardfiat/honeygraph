#!/usr/bin/env node

import { createDgraphClient } from '../lib/dgraph-client.js';
import chalk from 'chalk';

async function checkContracts() {
  console.log(chalk.cyan('Checking contracts for disregardfiat...\n'));
  
  const dgraphClient = createDgraphClient();
  await dgraphClient.connect();
  
  try {
    // Check contracts for disregardfiat
    const query = `{
      user(func: eq(username, "disregardfiat")) {
        username
        contracts: ~purchaser {
          id
          fileCount
          utilized
          status
          files: ~contract {
            cid
            name
            path
            size
          }
        }
      }
    }`;
    
    const result = await dgraphClient.query(query);
    console.log('Query result:', JSON.stringify(result, null, 2));
    
    // Also check if contracts exist at all
    const contractQuery = `{
      contracts(func: type(StorageContract), first: 5) {
        id
        purchaser {
          username
        }
        fileCount
      }
    }`;
    
    const contractResult = await dgraphClient.query(contractQuery);
    console.log('\nSample contracts:', JSON.stringify(contractResult, null, 2));
    
  } catch (error) {
    console.error(chalk.red('Query error:'), error.message);
  }
}

checkContracts().catch(console.error);