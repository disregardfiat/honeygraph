#!/usr/bin/env node

/**
 * Initialize SPK Testnet (spkccT_) - Production version with schema fixes
 * Handles missing ZFS and waits for Dgraph to be ready
 */

import fetch from 'node-fetch';
import { createNetworkManager } from '../lib/network-manager.js';
import { createDataTransformer } from '../lib/data-transformer.js';
import { createLogger } from '../lib/logger.js';
import { DgraphClient } from '../lib/dgraph-client.js';
import dgraph from 'dgraph-js';
import ora from 'ora';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger('init-spk-testnet');

// Wait for Dgraph to be ready
async function waitForDgraph(url, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const testClient = new DgraphClient({
        url,
        logger: {
          info: () => {},
          error: () => {},
          debug: () => {},
          warn: () => {}
        }
      });
      
      // Try a simple query
      await testClient.query('{ test(func: has(dgraph.type)) { count(uid) } }');
      return true;
    } catch (error) {
      if (i === maxAttempts - 1) {
        throw new Error(`Dgraph failed to become ready after ${maxAttempts} attempts: ${error.message}`);
      }
      console.log(`Waiting for Dgraph... attempt ${i + 1}/${maxAttempts}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// Apply schema directly without network manager to avoid duplication
async function applySchemaDirectly(dgraphClient, networkPrefix) {
  try {
    // Load honeygraph core schema
    const coreSchemaPath = path.join(__dirname, '../schema/schema.dgraph');
    const coreSchema = await fs.readFile(coreSchemaPath, 'utf8');
    
    // Load network-specific schema
    const networkSchemaPath = path.join(__dirname, '../schema/networks', `${networkPrefix.slice(0, -1)}.dgraph`);
    const networkSchema = await fs.readFile(networkSchemaPath, 'utf8');
    
    // Apply schemas separately to avoid conflicts
    console.log(chalk.yellow('Applying core schema...'));
    await dgraphClient.setSchema(coreSchema);
    
    console.log(chalk.yellow('Applying network-specific schema...'));
    await dgraphClient.setSchema(networkSchema);
    
    console.log(chalk.green('✓ Schemas applied successfully'));
  } catch (error) {
    console.error(chalk.red('Schema application error:'), error.message);
    throw error;
  }
}

async function main() {
  console.log(chalk.bold.blue('🚀 Initializing SPK Testnet (spkccT_) - Production Mode\\n'));
  
  let spinner;
  
  try {
    // Wait for Dgraph to be ready
    spinner = ora('Waiting for Dgraph to be ready...').start();
    const dgraphUrl = process.env.DGRAPH_URL || 'http://dgraph-alpha:9080';
    await waitForDgraph(dgraphUrl);
    spinner.succeed('Dgraph is ready');
    
    // Create dgraph client directly
    spinner = ora('Creating Dgraph client...').start();
    const dgraphClient = new DgraphClient({
      url: dgraphUrl,
      logger: createLogger('dgraph-spkccT'),
      namespace: 'spkccT_'
    });
    spinner.succeed('Dgraph client created');
    
    // Apply schema directly
    spinner = ora('Applying schemas...').start();
    await applySchemaDirectly(dgraphClient, 'spkccT_');
    spinner.succeed('Schemas applied');
    
    // Create network manager for registry only
    const networkManager = createNetworkManager({
      dgraphUrl,
      baseDataPath: process.env.DATA_PATH || './data',
      enableZFS: false
    });
    await networkManager.initialize();
    
    // Register network in the manager
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
    
    // Register without applying schema again
    try {
      const network = new (networkManager.constructor.prototype.constructor.bind(networkManager))('spkccT_', {
        ...networkConfig,
        baseDataPath: networkManager.config.baseDataPath,
        dgraphUrl: networkManager.config.dgraphUrl,
        zfsPoolPrefix: networkManager.config.zfsPoolPrefix,
        schemaPath: networkManager.config.schemaPath
      });
      
      await network.initialize();
      network.dgraphClient = dgraphClient;
      networkManager.networks.set('spkccT_', network);
      await networkManager.saveNetworkRegistry();
      
      spinner.succeed('Network spkccT_ registered');
    } catch (error) {
      if (error.message.includes('already registered')) {
        spinner.succeed('Network spkccT_ already registered');
      } else {
        throw error;
      }
    }
    
    // Step 4: Download state
    spinner = ora('Downloading SPK testnet state...').start();
    const response = await fetch('https://spktest.dlux.io/state');
    const stateData = await response.json();
    spinner.succeed('State downloaded');
    
    // Log state overview
    console.log(chalk.yellow('\\nState Overview:'));
    console.log(`  Block Number: ${stateData.state.stats?.block_num || 'Unknown'}`);
    console.log(`  Contracts: ${Object.keys(stateData.state.contract || {}).reduce((sum, user) => sum + Object.keys(stateData.state.contract[user]).length, 0)}`);
    console.log(`  Accounts: ${Object.keys(stateData.state.balances || {}).length}`);
    console.log('');
    
    // Step 5: Transform and import data
    spinner = ora('Transforming and importing data...').start();
    const transformer = createDataTransformer(dgraphClient, networkManager);
    
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
        
        // Special handling for contracts - process by user to maintain consistency
        if (pathKey === 'contract') {
          console.log(chalk.yellow(`\\nProcessing contracts by user for better consistency...`));
          let contractsProcessed = 0;
          let contractsErrors = 0;
          let usersProcessed = 0;
          
          for (const [username, userContracts] of Object.entries(stateData.state[pathKey])) {
            try {
              // Collect all contracts for this user
              const userOperations = [];
              for (const [contractId, contractData] of Object.entries(userContracts)) {
                userOperations.push({
                  type: 'put',
                  path: ['contract', username, contractId],
                  data: contractData,
                  blockNum: stateData.state.stats?.block_num || 0,
                  timestamp: Date.now()
                });
              }
              
              // Process all user contracts together
              const blockInfo = {
                blockNum: stateData.state.stats?.block_num || 0,
                timestamp: Date.now()
              };
              
              const mutations = await transformer.transformOperations(userOperations, blockInfo);
              
              if (mutations.length > 0) {
                const txn = dgraphClient.client.newTxn();
                try {
                  const mu = new dgraph.Mutation();
                  mu.setSetJson(mutations);
                  await txn.mutate(mu);
                  await txn.commit();
                  contractsProcessed += userOperations.length;
                  usersProcessed++;
                } catch (error) {
                  console.log(chalk.red(`User ${username} contracts import error: ${error.message}`));
                  contractsErrors += userOperations.length;
                } finally {
                  await txn.discard();
                }
              }
            } catch (error) {
              console.log(chalk.red(`User ${username} contracts transform error: ${error.message}`));
              contractsErrors += Object.keys(userContracts).length;
            }
          }
          
          console.log(chalk.green(`✨ Processed ${contractsProcessed} contracts from ${usersProcessed} users!`));
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
    
    console.log(chalk.green('\\n✨ SPK Testnet initialized successfully!\\n'));
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