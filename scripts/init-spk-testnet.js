#!/usr/bin/env node

/**
 * Initialize SPK Testnet (spkccT_) with full state import
 */

import fetch from 'node-fetch';
import { createNetworkManager } from '../lib/network-manager.js';
import { createDataTransformer } from '../lib/data-transformer.js';
import { createLogger } from '../lib/logger.js';
import { DgraphClient } from '../lib/dgraph-client.js';
import { pathAccumulator } from '../lib/path-accumulator.js';
import dgraph from 'dgraph-js';
import ora from 'ora';
import chalk from 'chalk';

const logger = createLogger('init-spk-testnet');

async function main() {
  console.log(chalk.bold.blue('🚀 Initializing SPK Testnet (spkccT_)\n'));
  
  let spinner;
  
  try {
    // Step 1: Create and initialize network manager
    spinner = ora('Creating network manager...').start();
    const networkManager = createNetworkManager({
      dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080',
      baseDataPath: process.env.DATA_PATH || './data'
    });
    await networkManager.initialize();
    spinner.succeed('Network manager initialized');
    
    // Step 2: Register spkccT_ network
    spinner = ora('Registering spkccT_ network...').start();
    const networkConfig = {
      name: 'SPK Test Network',
      description: 'SPK Network testnet for development and testing',
      tokens: [
        {
          symbol: 'LARYNX',
          name: 'Larynx Token',
          precision: 3,
          type: 'utility'
        },
        {
          symbol: 'SPK',
          name: 'SPK Token',
          precision: 3,
          type: 'governance'
        },
        {
          symbol: 'BROCA',
          name: 'Broca Token',
          precision: 3,
          type: 'resource'
        }
      ],
      consensusEndpoint: 'https://spktest.dlux.io',
      rpcEndpoint: 'https://spktest.dlux.io',
      chainId: 'spktest'
    };
    
    try {
      await networkManager.registerNetwork('spkccT_', networkConfig);
      spinner.succeed('Network spkccT_ registered');
    } catch (error) {
      if (error.message.includes('already registered')) {
        spinner.succeed('Network spkccT_ already registered');
      } else {
        throw error;
      }
    }
    
    // Step 3: Get the network and its dgraph client
    const network = networkManager.getNetwork('spkccT_');
    if (!network) {
      throw new Error('Failed to get spkccT_ network after registration');
    }
    const dgraphClient = network.dgraphClient;
    
    // Step 4: Download state
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
    
    // Step 5: Transform and import data
    spinner = ora('Transforming and importing data...').start();
    const transformer = createDataTransformer(dgraphClient, networkManager);
    
    // Start batch mode for path accumulator
    pathAccumulator.startBatch();
    
    // Process different state paths
    const statePaths = [
      "authorities",
      "balances",
      "bpow",
      "broca",
      "cbalances",
      "cbroca",
      "chain",
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
        
        // Special handling for contracts - process one at a time like streaming
        if (pathKey === 'contract') {
          console.log(chalk.yellow(`\nProcessing contracts individually...`));
          
          let totalContracts = 0;
          let contractsProcessed = 0;
          let contractsErrors = 0;
          
          // Process each contract individually, just like in streaming
          for (const [username, userContracts] of Object.entries(stateData.state[pathKey])) {
            for (const [contractId, contractData] of Object.entries(userContracts)) {
              totalContracts++;
              
              const operation = {
                type: 'put',
                path: ['contract', username, contractId],
                data: contractData,
                blockNum: stateData.state.stats?.block_num || 0,
                timestamp: Date.now()
              };
              
              try {
                const blockInfo = {
                  blockNum: stateData.state.stats?.block_num || 0,
                  timestamp: Date.now()
                };
                
                // Transform single contract
                const mutations = await transformer.transformOperations([operation], blockInfo);
                
                if (mutations.length > 0) {
                  const txn = dgraphClient.client.newTxn();
                  try {
                    const mu = new dgraph.Mutation();
                    mu.setSetJson(mutations);
                    await txn.mutate(mu);
                    await txn.commit();
                    contractsProcessed++;
                  } catch (error) {
                    console.log(chalk.red(`Contract ${contractId} import error: ${error.message}`));
                    contractsErrors++;
                  } finally {
                    await txn.discard();
                  }
                }
                
                // Progress indicator every 100 contracts
                if (contractsProcessed % 100 === 0) {
                  console.log(chalk.gray(`Processed ${contractsProcessed}/${totalContracts} contracts...`));
                }
              } catch (error) {
                console.log(chalk.red(`Contract ${contractId} transform error: ${error.message}`));
                contractsErrors++;
              }
            }
          }
          
          console.log(chalk.green(`✨ Processed ${contractsProcessed} contracts!`));
          if (contractsErrors > 0) {
            console.log(chalk.yellow(`⚠️  ${contractsErrors} contracts failed`));
          }
          
          totalOperations += contractsProcessed;
          continue; // Skip the batch processing below for contracts
        } else {
          // For other paths, use the normal flattening
          operations = flattenStateToOperations(stateData.state[pathKey], [pathKey], stateData.state.stats?.block_num || 0);
        }
        
        // Process other data types atomically, one operation at a time
        if (operations.length > 0) {
          console.log(chalk.yellow(`\nProcessing ${operations.length} ${pathKey} operations atomically...`));
          
          let opsProcessed = 0;
          let opsErrors = 0;
          
          // Process each operation individually, just like streaming
          for (const operation of operations) {
            try {
              const blockInfo = {
                blockNum: stateData.state.stats?.block_num || 0,
                timestamp: Date.now()
              };
              
              // Transform single operation
              const mutations = await transformer.transformOperations([operation], blockInfo);
              
              if (mutations.length > 0) {
                const txn = dgraphClient.client.newTxn();
                try {
                  const mu = new dgraph.Mutation();
                  mu.setSetJson(mutations);
                  await txn.mutate(mu);
                  await txn.commit();
                  totalMutations += mutations.length;
                  opsProcessed++;
                } catch (error) {
                  console.log(chalk.red(`${pathKey} operation import error: ${error.message}`));
                  opsErrors++;
                } finally {
                  await txn.discard();
                }
              }
              
              // Progress indicator every 100 operations
              if (opsProcessed % 100 === 0) {
                console.log(chalk.gray(`Processed ${opsProcessed}/${operations.length} ${pathKey} operations...`));
              }
            } catch (error) {
              console.log(chalk.red(`${pathKey} operation transform error: ${error.message}`));
              opsErrors++;
            }
          }
          
          console.log(chalk.green(`✨ Processed ${opsProcessed} ${pathKey} operations!`));
          if (opsErrors > 0) {
            console.log(chalk.yellow(`⚠️  ${opsErrors} operations failed`));
          }
          
          totalOperations += opsProcessed;
        }
      }
    }
    
    spinner.succeed(`Data imported: ${totalOperations} operations, ${totalMutations} mutations`);
    
    // End batch mode and show path accumulator stats
    pathAccumulator.endBatch();
    const accumulatorStats = pathAccumulator.getStats();
    console.log(chalk.yellow('\nPath Accumulator Stats:'));
    console.log(`  Total Paths: ${accumulatorStats.totalPaths}`);
    console.log(`  Total Files: ${accumulatorStats.totalFiles}`);
    console.log(`  Paths with Multiple Files: ${accumulatorStats.pathsWithMultipleFiles}`);
    if (accumulatorStats.largestPath.fileCount > 0) {
      console.log(`  Largest Path: ${accumulatorStats.largestPath.path} (${accumulatorStats.largestPath.fileCount} files)`);
    }
    
    // Step 6: Verify import
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
    console.log(`  Network: spkccT_`);
    console.log(`  Contracts: ${contractCount}`);
    console.log(`  Accounts: ${accountCount}`);
    console.log(`  Total Operations: ${totalOperations}`);
    console.log(`  Total Mutations: ${totalMutations}`);
    console.log('');
    console.log(chalk.yellow('Filesystem API is now available at:'));
    console.log(`  http://localhost:3030/fs/<username>/`);
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