#!/usr/bin/env node

import { createDgraphClient } from '../lib/dgraph-client.js';
import { createNetworkManager } from '../lib/network-manager.js';
import chalk from 'chalk';

async function diagnose() {
  console.log(chalk.cyan('Diagnosing Honeygraph Production Issues\n'));
  
  try {
    // Test 1: Default namespace query
    console.log(chalk.yellow('1. Testing default namespace:'));
    const defaultClient = createDgraphClient();
    await defaultClient.connect();
    
    const defaultQuery = `{
      accounts(func: eq(username, "disregardfiat")) {
        username
        larynxBalance
        spkBalance
        contracts: ~purchaser @filter(type(StorageContract)) {
          id
        }
      }
    }`;
    
    const defaultResult = await defaultClient.query(defaultQuery);
    console.log('Default namespace result:', JSON.stringify(defaultResult, null, 2));
    
    // Test 2: Network manager and spkccT_ namespace
    console.log(chalk.yellow('\n2. Testing spkccT_ network:'));
    const networkManager = createNetworkManager({
      dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080',
      baseDataPath: process.env.DATA_PATH || './data'
    });
    await networkManager.initialize();
    
    // Check if network is registered
    const networks = networkManager.getNetworks();
    console.log('Registered networks:', networks);
    
    // Get spkccT_ network
    const network = networkManager.getNetwork('spkccT_');
    if (!network) {
      console.log(chalk.red('spkccT_ network not found!'));
      return;
    }
    
    console.log('spkccT_ network found, namespace:', network.namespace);
    
    // Query in spkccT_ namespace
    const spkQuery = `{
      accounts(func: eq(username, "disregardfiat")) {
        username
        larynxBalance
        spkBalance
        contracts: ~purchaser @filter(type(StorageContract)) {
          id
        }
      }
    }`;
    
    const spkResult = await network.dgraphClient.query(spkQuery);
    console.log('spkccT_ namespace result:', JSON.stringify(spkResult, null, 2));
    
    // Test 3: Check total counts in each namespace
    console.log(chalk.yellow('\n3. Checking data counts:'));
    
    const countQuery = `{
      accounts(func: type(Account)) { count(uid) }
      contracts(func: type(StorageContract)) { count(uid) }
    }`;
    
    const defaultCounts = await defaultClient.query(countQuery);
    console.log('Default namespace counts:', JSON.stringify(defaultCounts, null, 2));
    
    const spkCounts = await network.dgraphClient.query(countQuery);
    console.log('spkccT_ namespace counts:', JSON.stringify(spkCounts, null, 2));
    
    // Test 4: Check environment variables
    console.log(chalk.yellow('\n4. Environment configuration:'));
    console.log('DGRAPH_URL:', process.env.DGRAPH_URL || 'not set (using default)');
    console.log('DATA_PATH:', process.env.DATA_PATH || 'not set (using default)');
    console.log('NODE_ENV:', process.env.NODE_ENV || 'not set');
    console.log('API_PORT:', process.env.API_PORT || 'not set');
    
  } catch (error) {
    console.error(chalk.red('Diagnostic error:'), error.message);
    console.error(error.stack);
  }
}

diagnose().catch(console.error);