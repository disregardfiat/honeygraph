#!/usr/bin/env node

/**
 * Import ALL disregardfiat contracts from SPK state
 */

import fetch from 'node-fetch';
import dgraph from 'dgraph-js';
import { createDataTransformer } from '../lib/data-transformer.js';
import { createDgraphClient } from '../lib/dgraph-client.js';
import { createNetworkManager } from '../lib/network-manager.js';
import { createLogger } from '../lib/logger.js';
import ora from 'ora';
import chalk from 'chalk';

const logger = createLogger('disregardfiat-import');

class DisregardfiatImporter {
  constructor() {
    this.dgraphClient = createDgraphClient();
    this.networkManager = null;
    this.transformer = null;
  }

  async run() {
    console.log(chalk.bold.blue('🚀 Importing ALL disregardfiat contracts\n'));
    
    try {
      // Initialize
      await this.initialize();
      
      // Download state
      const spinner = ora('Downloading state...').start();
      const response = await fetch('https://spktest.dlux.io/state');
      const stateData = await response.json();
      spinner.succeed('State downloaded');
      
      // Get ALL disregardfiat contracts
      const contracts = stateData.state.contract.disregardfiat || {};
      console.log(chalk.yellow(`\nFound ${Object.keys(contracts).length} disregardfiat contracts\n`));
      
      // Process each contract
      let processed = 0;
      for (const [contractId, contractData] of Object.entries(contracts)) {
        console.log(chalk.blue(`Processing: ${contractId}`));
        
        // Create operation for this contract
        const operation = {
          type: 'put',
          path: ['contract', 'disregardfiat', contractId],
          data: contractData,
          blockNum: stateData.state.stats?.block_num || 0,
          timestamp: Date.now()
        };
        
        // Transform and import
        try {
          const mutations = await this.transformer.transformOperation(operation);
          if (mutations.length > 0) {
            await this.importMutations(mutations);
            processed++;
            
            // Show folder info if present
            const metadata = this.parseMetadata(contractData.m);
            if (metadata.folders.length > 0) {
              console.log(chalk.green(`  ✓ Folders: ${metadata.folders.join(', ')}`));
            }
          }
        } catch (error) {
          console.error(chalk.red(`  ✗ Error: ${error.message}`));
        }
      }
      
      console.log(chalk.green(`\n✨ Imported ${processed} contracts successfully!\n`));
      
    } catch (error) {
      console.error(chalk.red('Import failed:'), error);
      process.exit(1);
    }
  }
  
  async initialize() {
    this.networkManager = createNetworkManager({
      baseDataPath: './data/honeygraph',
      dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080'
    });
    await this.networkManager.initialize();
    
    const prefix = 'spkccT_';
    if (!this.networkManager.getNetwork(prefix)) {
      const { DEFAULT_NETWORKS } = await import('../lib/network-manager.js');
      await this.networkManager.registerNetwork(prefix, DEFAULT_NETWORKS[prefix]);
    }
    
    this.transformer = createDataTransformer(this.dgraphClient, this.networkManager);
  }
  
  async importMutations(mutations) {
    const txn = this.dgraphClient.client.newTxn();
    try {
      const mu = new dgraph.Mutation();
      mu.setSetJson(mutations);
      await txn.mutate(mu);
      await txn.commit();
    } finally {
      await txn.discard();
    }
  }
  
  parseMetadata(metadataString) {
    if (!metadataString) return { folders: [] };
    
    const parts = metadataString.split(',');
    const contractHeader = parts[0] || '';
    const pipeIndex = contractHeader.indexOf('|');
    
    if (pipeIndex === -1) return { folders: [] };
    
    const folderString = contractHeader.substring(pipeIndex + 1);
    const folders = [];
    
    if (folderString) {
      const folderDefs = folderString.split('|');
      for (const folderDef of folderDefs) {
        if (folderDef && folderDef !== '/') {
          const folderName = folderDef.split('/').pop();
          if (folderName) folders.push(folderName);
        }
      }
    }
    
    return { folders };
  }
}

// Run
const importer = new DisregardfiatImporter();
importer.run();