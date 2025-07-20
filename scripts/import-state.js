#!/usr/bin/env node

/**
 * Import SPK Network State into Dgraph
 * 
 * This script downloads the current state from an SPK node and imports it into Dgraph
 * Usage: node scripts/import-state.js [state-url]
 */

import fetch from 'node-fetch';
import dgraph from 'dgraph-js';
import { createDataTransformer } from '../lib/data-transformer.js';
import { createDgraphClient } from '../lib/dgraph-client.js';
import { createNetworkManager } from '../lib/network-manager.js';
import { createLogger } from '../lib/logger.js';
import ora from 'ora';
import chalk from 'chalk';

const logger = createLogger('state-import');

// Default state URL
const DEFAULT_STATE_URL = 'https://spktest.dlux.io/state';

class StateImporter {
  constructor(stateUrl = DEFAULT_STATE_URL) {
    this.stateUrl = stateUrl;
    this.dgraphClient = createDgraphClient();
    this.networkManager = null; // Will be initialized in run()
    this.transformer = null; // Will be created after networkManager
    this.stats = {
      total: 0,
      processed: 0,
      errors: 0,
      skipped: 0,
      categories: {}
    };
  }

  async run() {
    console.log(chalk.bold.blue('🚀 SPK Network State Importer\n'));
    
    try {
      // Initialize network manager and register networks
      console.log(chalk.yellow('🔧 Initializing network manager...'));
      this.networkManager = createNetworkManager({
        baseDataPath: './data/honeygraph',
        dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080'
      });
      await this.networkManager.initialize();
      
      // Register spkccT_ network if not already registered
      const prefix = 'spkccT_';
      if (!this.networkManager.getNetwork(prefix)) {
        console.log(chalk.yellow(`📡 Registering ${prefix} network...`));
        const { DEFAULT_NETWORKS } = await import('../lib/network-manager.js');
        await this.networkManager.registerNetwork(prefix, DEFAULT_NETWORKS[prefix]);
      }
      
      // Create transformer with network manager
      this.transformer = createDataTransformer(this.dgraphClient, this.networkManager);
      
      // 1. Download state
      const state = await this.downloadState();
      
      // 2. Validate state
      this.validateState(state);
      
      // 3. Convert to operations
      const operations = this.stateToOperations(state);
      
      // 4. Transform operations
      const mutations = await this.transformOperations(operations);
      
      // 5. Import to Dgraph
      await this.importToDgraph(mutations);
      
      // 6. Print summary
      this.printSummary();
      
    } catch (error) {
      console.error(chalk.red('\n❌ Import failed:'), error.message);
      logger.error('Import failed', { error: error.stack });
      process.exit(1);
    }
  }

  async downloadState() {
    const spinner = ora(`Downloading state from ${this.stateUrl}`).start();
    
    try {
      const response = await fetch(this.stateUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const state = await response.json();
      spinner.succeed(`Downloaded state (${this.formatBytes(JSON.stringify(state).length)})`);
      
      return state;
    } catch (error) {
      spinner.fail('Failed to download state');
      throw error;
    }
  }

  validateState(state) {
    console.log(chalk.yellow('\n📋 Validating state...'));
    
    if (!state || typeof state !== 'object') {
      throw new Error('Invalid state: not an object');
    }
    
    // Handle nested state structure
    const stateData = state.state || state;
    
    // Check for required top-level keys
    const requiredKeys = ['balances', 'stats'];
    const missingKeys = requiredKeys.filter(key => !(key in stateData));
    
    if (missingKeys.length > 0) {
      logger.warn('Missing expected keys', { missingKeys });
    }
    
    // Count entries
    let totalEntries = 0;
    const categoryCounts = {};
    
    for (const [category, data] of Object.entries(stateData)) {
      if (typeof data === 'object' && data !== null) {
        const count = Object.keys(data).length;
        categoryCounts[category] = count;
        totalEntries += count;
      }
    }
    
    console.log(chalk.green(`✓ Valid state with ${totalEntries} total entries`));
    console.log(chalk.gray('  Categories:'));
    
    // Sort by count and display top categories
    const sortedCategories = Object.entries(categoryCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 15);
    
    for (const [category, count] of sortedCategories) {
      console.log(chalk.gray(`    ${category}: ${count}`));
    }
    
    if (Object.keys(categoryCounts).length > 15) {
      console.log(chalk.gray(`    ... and ${Object.keys(categoryCounts).length - 15} more categories`));
    }
  }

  stateToOperations(state) {
    console.log(chalk.yellow('\n🔄 Converting state to operations...'));
    const operations = [];
    
    // Handle nested state structure
    const stateData = state.state || state;
    
    // Helper to create operation
    const createOp = (path, data) => ({
      type: 'put',
      path: Array.isArray(path) ? path : path.split('.'),
      data,
      // Add metadata for import
      blockNum: stateData.stats?.block_num || 0,
      timestamp: Date.now()
    });
    
    // Process each category
    for (const [category, categoryData] of Object.entries(stateData)) {
      // Skip certain top-level keys that aren't data
      if (['id', 'block_num', 'hash', 'signature'].includes(category)) {
        continue;
      }
      
      // Log contract data specifically
      if (category === 'contract') {
        console.log(chalk.blue(`Found contract data with ${Object.keys(categoryData).length} users`));
        const firstUser = Object.keys(categoryData)[0];
        if (firstUser && categoryData[firstUser]) {
          console.log(chalk.gray(`  First user: ${firstUser} with ${Object.keys(categoryData[firstUser]).length} contracts`));
        }
      }
      
      if (typeof categoryData === 'object' && categoryData !== null) {
        // Handle nested structures
        for (const [key, value] of Object.entries(categoryData)) {
          if (category === 'stats') {
            // Stats are single values
            operations.push(createOp(['stats', key], value));
          } else if (category === 'contract') {
            // Contracts have special nesting: contract.username.contractId
            // But contractId is in format "username:type:block-txid"
            // We need to extract just the block-txid part for the path
            if (typeof value === 'object' && value !== null) {
              console.log(chalk.blue(`Processing contracts for user: ${key} with ${Object.keys(value).length} contracts`));
              for (const [contractId, contractData] of Object.entries(value)) {
                // Parse contractId format: "username:type:block-txid"
                const parts = contractId.split(':');
                if (parts.length >= 3) {
                  const blockTxid = parts.slice(2).join(':'); // Handle cases with colons in txid
                  console.log(chalk.gray(`  Creating operation: ['contract', '${key}', '${blockTxid}']`));
                  operations.push(createOp(['contract', key, blockTxid], contractData));
                } else {
                  // Fallback for unexpected format
                  console.log(chalk.gray(`  Fallback operation: ['contract', '${key}', '${contractId}']`));
                  operations.push(createOp(['contract', key, contractId], contractData));
                }
              }
            }
          } else if (typeof value === 'object' && value !== null) {
            // Handle deeper nesting (like dex.hbd.sellOrders)
            for (const [subKey, subValue] of Object.entries(value)) {
              operations.push(createOp([category, key, subKey], subValue));
            }
          } else {
            // Direct key-value pairs
            operations.push(createOp([category, key], value));
          }
        }
      }
    }
    
    console.log(chalk.green(`✓ Created ${operations.length} operations`));
    this.stats.total = operations.length;
    
    return operations;
  }

  async transformOperations(operations) {
    console.log(chalk.yellow('\n🔧 Transforming operations...'));
    const spinner = ora('Processing operations').start();
    
    const allMutations = [];
    const batchSize = 100;
    
    // Process in batches to avoid memory issues
    for (let i = 0; i < operations.length; i += batchSize) {
      const batch = operations.slice(i, i + batchSize);
      
      try {
        // Use a common block info for all operations in the state
        const blockInfo = {
          blockNum: operations[0]?.blockNum || 0,
          timestamp: Date.now()
        };
        
        // Transform batch
        const mutations = await this.transformer.transformOperations(batch, blockInfo);
        allMutations.push(...mutations);
        
        this.stats.processed += batch.length;
        
        // Update progress
        const progress = Math.round((this.stats.processed / this.stats.total) * 100);
        spinner.text = `Processing operations... ${progress}% (${this.stats.processed}/${this.stats.total})`;
        
      } catch (error) {
        logger.error('Batch transformation failed', { 
          batchStart: i, 
          error: error.message 
        });
        this.stats.errors += batch.length;
      }
    }
    
    spinner.succeed(`Transformed ${allMutations.length} entities`);
    return allMutations;
  }

  async importToDgraph(mutations) {
    console.log(chalk.yellow(`\n💾 Importing ${mutations.length} entities to Dgraph...`));
    
    if (mutations.length === 0) {
      console.log(chalk.yellow('No mutations to import'));
      return;
    }
    
    const spinner = ora('Importing to Dgraph').start();
    const batchSize = 1000;
    let imported = 0;
    
    try {
      // Process in batches
      for (let i = 0; i < mutations.length; i += batchSize) {
        const batch = mutations.slice(i, i + batchSize);
        
        const txn = this.dgraphClient.client.newTxn();
        try {
          // Convert to Dgraph mutation format
          const mu = new dgraph.Mutation();
          mu.setSetJson(batch);
          
          await txn.mutate(mu);
          await txn.commit();
          
          imported += batch.length;
          const progress = Math.round((imported / mutations.length) * 100);
          spinner.text = `Importing to Dgraph... ${progress}% (${imported}/${mutations.length})`;
          
        } catch (error) {
          logger.error('Batch import failed', { 
            batchStart: i,
            error: error.message 
          });
          this.stats.errors++;
        } finally {
          await txn.discard();
        }
      }
      
      spinner.succeed(`Imported ${imported} entities to Dgraph`);
      
    } catch (error) {
      spinner.fail('Import failed');
      throw error;
    }
  }

  printSummary() {
    console.log(chalk.bold.blue('\n📊 Import Summary\n'));
    
    const table = [
      ['Total Operations', this.stats.total],
      ['Processed', chalk.green(this.stats.processed)],
      ['Errors', this.stats.errors > 0 ? chalk.red(this.stats.errors) : '0'],
      ['Skipped', this.stats.skipped]
    ];
    
    const maxLabel = Math.max(...table.map(([label]) => label.length));
    
    for (const [label, value] of table) {
      console.log(`  ${label.padEnd(maxLabel)} : ${value}`);
    }
    
    console.log(chalk.green('\n✨ Import completed successfully!\n'));
    console.log('Next steps:');
    console.log('  1. Check the data in Ratel UI: http://localhost:8000');
    console.log('  2. Run some test queries');
    console.log('  3. Start the sync process for ongoing updates: npm run sync');
  }

  formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

// Main execution
async function main() {
  const stateUrl = process.argv[2] || DEFAULT_STATE_URL;
  
  console.log(chalk.gray(`State URL: ${stateUrl}\n`));
  
  const importer = new StateImporter(stateUrl);
  await importer.run();
  
  process.exit(0);
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('Unhandled error:'), error);
  process.exit(1);
});

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}