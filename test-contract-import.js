#!/usr/bin/env node

import fetch from 'node-fetch';
import dgraph from 'dgraph-js';
import { createDataTransformer } from './lib/data-transformer.js';
import { createDgraphClient } from './lib/dgraph-client.js';
import { createNetworkManager } from './lib/network-manager.js';
import { createLogger } from './lib/logger.js';
import chalk from 'chalk';

const logger = createLogger('contract-import');

(async () => {
  console.log(chalk.bold.blue('📦 Storage Contract Import Test\n'));
  
  try {
    // Download state
    console.log('Downloading state...');
    const response = await fetch('https://spktest.dlux.io/state');
    const state = await response.json();
    const stateData = state.state || state;
    
    // Initialize components
    const dgraphClient = createDgraphClient();
    const networkManager = createNetworkManager({
      baseDataPath: './data/honeygraph',
      dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080'
    });
    await networkManager.initialize();
    
    // Register network
    const { DEFAULT_NETWORKS } = await import('./lib/network-manager.js');
    if (!networkManager.getNetwork('spkccT_')) {
      await networkManager.registerNetwork('spkccT_', DEFAULT_NETWORKS['spkccT_']);
    }
    
    const transformer = createDataTransformer(dgraphClient, networkManager);
    
    // Create operations ONLY for contracts
    const operations = [];
    
    if (stateData.contract) {
      for (const [account, contracts] of Object.entries(stateData.contract)) {
        for (const [contractId, contractData] of Object.entries(contracts)) {
          operations.push({
            type: 'put',
            path: ['contract', account, contractId],
            data: contractData,
            blockNum: stateData.stats?.block_num || 0,
            timestamp: Date.now()
          });
        }
      }
    }
    
    console.log(chalk.green(`\n✓ Found ${operations.length} storage contracts\n`));
    
    // Transform in small batches
    console.log('Transforming contracts...');
    const batchSize = 10;
    const allMutations = [];
    
    for (let i = 0; i < operations.length; i += batchSize) {
      const batch = operations.slice(i, i + batchSize);
      try {
        const mutations = await transformer.transformOperations(batch, {
          blockNum: operations[0]?.blockNum || 0,
          timestamp: Date.now()
        });
        allMutations.push(...mutations);
        
        process.stdout.write(`\r  Progress: ${Math.min(i + batchSize, operations.length)}/${operations.length}`);
      } catch (error) {
        logger.error('Batch transformation failed', { 
          batchStart: i, 
          error: error.message 
        });
      }
    }
    
    console.log(chalk.green(`\n\n✓ Transformed ${allMutations.length} entities`));
    
    // Count entity types
    const typeCounts = {};
    for (const mutation of allMutations) {
      const type = mutation['dgraph.type'] || 'unknown';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    }
    
    console.log('\nEntity types:');
    for (const [type, count] of Object.entries(typeCounts)) {
      console.log(`  ${type}: ${count}`);
    }
    
    // Import to Dgraph
    console.log(chalk.yellow('\n💾 Importing to Dgraph...'));
    
    const txn = dgraphClient.client.newTxn();
    try {
      const mu = new dgraph.Mutation();
      // Remove circular references before sending to Dgraph
      const cleanMutations = JSON.parse(JSON.stringify(allMutations));
      mu.setSetJson(cleanMutations);
      
      await txn.mutate(mu);
      await txn.commit();
      
      console.log(chalk.green('✅ Import successful!\n'));
      
      // Query to verify
      const query = `{
        contracts(func: type(StorageContract), first: 10) {
          id
          purchaser {
            username
          }
          status
          statusText
          fileCount
          utilized
          power
          isUnderstored
        }
        
        contractCount(func: type(StorageContract)) {
          count(uid)
        }
      }`;
      
      const res = await dgraphClient.client.newTxn().query(query);
      const result = JSON.parse(res.getJson());
      
      console.log(chalk.bold('📊 Verification Results:\n'));
      console.log(`Total contracts imported: ${result.contractCount?.[0]?.count || 0}`);
      
      if (result.contracts && result.contracts.length > 0) {
        console.log('\nSample contracts:');
        result.contracts.forEach(contract => {
          console.log(`\n  ID: ${contract.id}`);
          console.log(`  Owner: ${contract.purchaser?.username}`);
          console.log(`  Status: ${contract.statusText} (${contract.status})`);
          console.log(`  Files: ${contract.fileCount}`);
          console.log(`  Power: ${contract.power}`);
          console.log(`  Understored: ${contract.isUnderstored}`);
        });
      }
      
    } catch (error) {
      console.error(chalk.red('\n❌ Import failed:'), error.message);
      if (error.message.includes('strconv')) {
        console.log(chalk.yellow('\nThis appears to be a data type mismatch error.'));
      }
    } finally {
      await txn.discard();
    }
    
  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    logger.error('Import failed', { error: error.stack });
  }
})();