#!/usr/bin/env node

/**
 * Import ONLY contracts from SPK state
 */

import fetch from 'node-fetch';
import dgraph from 'dgraph-js';
import grpc from '@grpc/grpc-js';
import { createDataTransformer } from '../lib/data-transformer.js';
import { DgraphClient } from '../lib/dgraph-client.js';
import { createNetworkManager } from '../lib/network-manager.js';
import { createLogger } from '../lib/logger.js';
import ora from 'ora';
import chalk from 'chalk';

const logger = createLogger('contracts-import');

class ContractsImporter {
  constructor() {
    // Create dgraph client with spkccT_ namespace for test network
    this.dgraphClient = new DgraphClient({
      url: process.env.DGRAPH_URL || 'http://localhost:9080',
      logger,
      namespace: 'spkccT_'
    });
    this.networkManager = null;
    this.transformer = null;
  }

  async run() {
    console.log(chalk.bold.blue('🚀 Importing ONLY contracts\n'));
    
    try {
      // Initialize
      await this.initialize();
      
      // Download state
      const spinner = ora('Downloading state...').start();
      const response = await fetch('https://spktest.dlux.io/state');
      const stateData = await response.json();
      spinner.succeed('State downloaded');
      
      // Get ALL contracts
      const allContracts = stateData.state.contract || {};
      let totalContracts = 0;
      for (const user of Object.values(allContracts)) {
        totalContracts += Object.keys(user).length;
      }
      
      console.log(chalk.yellow(`\nFound ${totalContracts} total contracts\n`));
      
      // Process contracts one by one to avoid batch errors
      let processed = 0;
      let errors = 0;
      
      for (const [username, userContracts] of Object.entries(allContracts)) {
        for (const [contractId, contractData] of Object.entries(userContracts)) {
          process.stdout.write(`\rProcessing: ${processed}/${totalContracts} (${errors} errors)`);
          
          // Create operation for this contract
          const operation = {
            type: 'put',
            path: ['contract', username, contractId],
            data: contractData,
            blockNum: stateData.state.stats?.block_num || 0,
            timestamp: Date.now()
          };
          
          try {
            // Transform single contract
            const mutations = await this.transformer.transformOperation(operation);
            
            if (mutations.length > 0) {
              // Import just this contract's mutations
              const txn = this.dgraphClient.client.newTxn();
              try {
                // Log first mutation for debugging
                if (processed === 0) {
                  logger.info('First mutation example', { 
                    mutation: JSON.stringify(mutations[0], null, 2)
                  });
                }
                
                const mu = new dgraph.Mutation();
                mu.setSetJson(mutations);
                const assigned = await txn.mutate(mu);
                await txn.commit();
                logger.info('Contract imported', { 
                  contractId, 
                  mutationCount: mutations.length,
                  uidsCount: Object.keys(assigned.getUidsMap().toObject()).length
                });
                processed++;
              } catch (error) {
                logger.error('Import error', { contractId, error: error.message });
                errors++;
              } finally {
                await txn.discard();
              }
            }
          } catch (error) {
            logger.error('Transform error', { contractId, error: error.message });
            errors++;
          }
        }
      }
      
      console.log(chalk.green(`\n\n✨ Imported ${processed} contracts successfully!`));
      if (errors > 0) {
        console.log(chalk.yellow(`⚠️  ${errors} contracts failed to import`));
      }
      
    } catch (error) {
      console.error(chalk.red('Import failed:'), error);
      process.exit(1);
    }
  }
  
  async initialize() {
    // Create network manager that returns spkccT_ namespace for test network
    this.networkManager = {
      getNetwork: () => ({ namespace: 'spkccT_' })
    };
    this.transformer = createDataTransformer(this.dgraphClient, this.networkManager);
  }
}

// Run
const importer = new ContractsImporter();
importer.run();