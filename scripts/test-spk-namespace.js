#!/usr/bin/env node

import { createNetworkManager } from '../lib/network-manager.js';
import chalk from 'chalk';

async function test() {
  console.log(chalk.cyan('Testing SPK Namespace Configuration\n'));
  
  try {
    // Initialize network manager
    const networkManager = createNetworkManager({
      dgraphUrl: process.env.DGRAPH_URL || 'http://dgraph-alpha:9080'
    });
    await networkManager.initialize();
    
    // Get spkccT_ network
    const networks = networkManager.getNetworks();
    console.log('Available networks:', networks);
    
    const spkNetwork = networkManager.getNetwork('spkccT_');
    if (!spkNetwork) {
      console.log(chalk.red('ERROR: spkccT_ network not found!'));
      return;
    }
    
    console.log(chalk.green('✓ spkccT_ network found'));
    console.log('Namespace:', spkNetwork.namespace);
    
    // Test query
    const testQuery = `{
      accounts(func: type(Account), first: 5) {
        username
      }
      contracts(func: type(StorageContract), first: 5) {
        id
      }
    }`;
    
    console.log('\nRunning test query...');
    const result = await spkNetwork.dgraphClient.query(testQuery);
    console.log('Query result:', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error.message);
    console.error(error.stack);
  }
}

test();