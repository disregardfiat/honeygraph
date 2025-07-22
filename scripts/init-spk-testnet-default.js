#!/usr/bin/env node

/**
 * Initialize SPK Testnet data into DEFAULT namespace
 * Use this for production where the API expects data in the default namespace
 */

import fetch from 'node-fetch';
import { createDgraphClient } from '../lib/dgraph-client.js';
import { createDataTransformer } from '../lib/data-transformer.js';
import { createLogger } from '../lib/logger.js';
import dgraph from 'dgraph-js';
import ora from 'ora';
import chalk from 'chalk';

const logger = createLogger('init-spk-testnet-default');

async function main() {
  console.log(chalk.bold.blue('🚀 Initializing SPK Testnet (Default Namespace)\n'));
  
  let spinner;
  
  try {
    // Step 1: Create dgraph client for default namespace
    spinner = ora('Connecting to Dgraph...').start();
    const dgraphClient = createDgraphClient({
      url: process.env.DGRAPH_URL || 'http://localhost:9080'
    });
    await dgraphClient.connect();
    spinner.succeed('Connected to Dgraph');
    
    // Step 2: Initialize schema
    spinner = ora('Initializing schema...').start();
    await dgraphClient.initializeSchema();
    spinner.succeed('Schema initialized');
    
    // Step 3: Download state
    spinner = ora('Downloading SPK testnet state...').start();
    const response = await fetch('https://spktest.dlux.io/state');
    const stateData = await response.json();
    spinner.succeed('State downloaded');
    
    // Log state overview
    console.log(chalk.yellow('\nState Overview:'));
    console.log(`  Block Number: ${stateData.state.stats?.block_num || 'Unknown'}`);
    console.log(`  Contracts: ${Object.keys(stateData.state.contract || {}).reduce((sum, user) => sum + Object.keys(stateData.state.contract[user]).length, 0)}`);
    console.log(`  Accounts: ${Object.keys(stateData.state.balances || {}).length}`);
    console.log('');
    
    // Step 4: Transform and import data
    spinner = ora('Transforming and importing data...').start();
    const transformer = createDataTransformer(dgraphClient);
    
    // Process different state paths
    const statePaths = [
      "authorities",
      "balances",
      "bpow",
      "broca",
      "cbalances",
      "cbroca",
      "chain",
      "chrono",
      "contract",
      "contracts",
      "cspk",
      "dex",
      "dexb",
      "dexs",
      "feed",
      "granted",
      "granting",
      "lbroca",
      "list",
      "markets",
      "nomention",
      "pow",
      "priceFeeds",
      "runners",
      "sbroca",
      "service",
      "services",
      "spk",
      "spkVote",
      "spkb",
      "spow",
      "stats",
      "ubroca",
      "val",
      "vbroca",
    ];
    
    let totalOperations = 0;
    let totalMutations = 0;
    
    for (const pathKey of statePaths) {
      if (stateData.state[pathKey]) {
        let operations;
        
        // Special handling for contracts - process individually for reliability
        if (pathKey === 'contract') {
          console.log(chalk.yellow(`\nProcessing contracts individually for maximum reliability...`));
          let contractsProcessed = 0;
          let contractsErrors = 0;
          
          for (const [username, userContracts] of Object.entries(stateData.state[pathKey])) {
            for (const [contractId, contractData] of Object.entries(userContracts)) {
              try {
                const operation = {
                  type: 'put',
                  path: ['contract', username, contractId],
                  data: contractData,
                  blockNum: stateData.state.stats?.block_num || 0,
                  timestamp: Date.now()
                };
                
                // Process single contract
                const mutations = await transformer.transformOperation(operation);
                
                if (mutations.length > 0) {
                  const txn = dgraphClient.client.newTxn();
                  try {
                    const mu = new dgraph.Mutation();
                    mu.setSetJson(mutations);
                    await txn.mutate(mu);
                    await txn.commit();
                    contractsProcessed++;
                  } catch (error) {
                    console.log(chalk.red(`Contract import error ${contractId}: ${error.message}`));
                    contractsErrors++;
                  } finally {
                    await txn.discard();
                  }
                }
              } catch (error) {
                console.log(chalk.red(`Contract transform error ${contractId}: ${error.message}`));
                contractsErrors++;
              }
            }
          }
          
          console.log(chalk.green(`✨ Processed ${contractsProcessed} contracts successfully!`));
          if (contractsErrors > 0) {
            console.log(chalk.yellow(`⚠️  ${contractsErrors} contracts failed`));
          }
          
          totalOperations += contractsProcessed;
          continue; // Skip the batch processing below for contracts
        } else {
          // For other paths, use the normal flattening
          operations = flattenStateToOperations(stateData.state[pathKey], [pathKey], stateData.state.stats?.block_num || 0);
        }
        
        // Process other data types in batch (not contracts)
        if (operations.length > 0) {
          try {
            const blockInfo = {
              blockNum: stateData.state.stats?.block_num || 0,
              timestamp: Date.now()
            };
            
            const mutations = await transformer.transformOperations(operations, blockInfo);
            
            if (mutations.length > 0) {
              // Import mutations
              const txn = dgraphClient.client.newTxn();
              try {
                const mu = new dgraph.Mutation();
                mu.setSetJson(mutations);
                await txn.mutate(mu);
                await txn.commit();
                totalMutations += mutations.length;
              } finally {
                await txn.discard();
              }
            }
            totalOperations += operations.length;
            
            // Update progress
            spinner.text = `Importing data... (${totalOperations} operations, ${totalMutations} mutations)`;
          } catch (error) {
            logger.error('Failed to process operation batch', { 
              pathKey: pathKey, 
              operationCount: operations.length,
              error: error.message 
            });
          }
        }
      }
    }
    
    spinner.succeed(`Data imported: ${totalOperations} operations, ${totalMutations} mutations`);
    
    // Step 5: Verify import
    spinner = ora('Verifying import...').start();
    
    // Query contract count
    const contractQuery = `{ contracts(func: type(StorageContract)) { count(uid) } }`;
    const contractResult = await dgraphClient.query(contractQuery);
    const contractCount = contractResult.contracts?.[0]?.count || 0;
    
    // Query account count
    const accountQuery = `{ accounts(func: type(Account)) { count(uid) } }`;
    const accountResult = await dgraphClient.query(accountQuery);
    const accountCount = accountResult.accounts?.[0]?.count || 0;
    
    spinner.succeed('Import verified');
    
    console.log(chalk.green('\n✨ SPK Testnet initialized successfully!\n'));
    console.log(chalk.cyan('Summary:'));
    console.log(`  Namespace: DEFAULT`);
    console.log(`  Contracts: ${contractCount}`);
    console.log(`  Accounts: ${accountCount}`);
    console.log(`  Total Operations: ${totalOperations}`);
    console.log(`  Total Mutations: ${totalMutations}`);
    console.log('');
    console.log(chalk.yellow('API endpoints are now available'));
    console.log('');
    
  } catch (error) {
    if (spinner) spinner.fail('Failed');
    console.error(chalk.red('Error:'), error.message);
    logger.error('Initialization failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Helper function to flatten state object to operations
function flattenStateToOperations(obj, path = [], blockNum = 0) {
  const operations = [];
  
  if (obj && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Recurse into nested objects
        operations.push(...flattenStateToOperations(value, [...path, key], blockNum));
      } else {
        // Create operation for this value
        operations.push({
          type: 'put',
          path: [...path, key],
          data: value,
          blockNum,
          timestamp: Date.now()
        });
      }
    }
  }
  
  return operations;
}

// Run the initialization
main().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});