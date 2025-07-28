#!/usr/bin/env node

/**
 * SPK Contract Importer with enhanced VFS support
 */

import fetch from 'node-fetch';
import dgraph from 'dgraph-js';
import grpc from '@grpc/grpc-js';
import { createSPKDataTransformer } from '../lib/spk-data-transformer.js';
import { DgraphClient } from '../lib/dgraph-client.js';
import { createLogger } from '../lib/logger.js';
import ora from 'ora';
import chalk from 'chalk';

const logger = createLogger('spk-contracts-import');

class SPKContractsImporter {
  constructor() {
    // Create dgraph client with spkccT_ namespace for test network
    this.dgraphClient = new DgraphClient({
      url: process.env.DGRAPH_URL || 'http://localhost:9080',
      logger,
      namespace: 'spkccT_'
    });
    this.networkManager = null;
    this.transformer = null;
    this.targetUser = process.env.TARGET_USER || null; // Import specific user only
  }

  async run() {
    console.log(chalk.bold.blue('🚀 SPK Contracts Import with VFS Support\n'));
    
    try {
      // Initialize
      await this.initialize();
      
      // Download state
      const spinner = ora('Downloading SPK state...').start();
      const response = await fetch('https://spktest.dlux.io/state');
      const stateData = await response.json();
      spinner.succeed('State downloaded');
      
      // Get contracts to import
      const allContracts = stateData.state.contract || {};
      let contractsToImport = [];
      
      if (this.targetUser) {
        // Import only target user's contracts
        const userContracts = allContracts[this.targetUser] || {};
        for (const [contractId, contractData] of Object.entries(userContracts)) {
          contractsToImport.push({
            username: this.targetUser,
            contractId,
            data: contractData
          });
        }
        console.log(chalk.yellow(`\nImporting ${contractsToImport.length} contracts for user: ${this.targetUser}\n`));
      } else {
        // Import all contracts
        for (const [username, userContracts] of Object.entries(allContracts)) {
          for (const [contractId, contractData] of Object.entries(userContracts)) {
            contractsToImport.push({
              username,
              contractId,
              data: contractData
            });
          }
        }
        console.log(chalk.yellow(`\nFound ${contractsToImport.length} total contracts\n`));
      }
      
      // Import contracts
      let processed = 0;
      let errors = 0;
      const startTime = Date.now();
      
      for (const contract of contractsToImport) {
        const progress = Math.round((processed / contractsToImport.length) * 100);
        process.stdout.write(`\rProcessing: ${processed}/${contractsToImport.length} (${progress}%) - ${errors} errors`);
        
        // Create operation for this contract
        const operation = {
          type: 'put',
          path: ['contract', contract.username, contract.contractId],
          data: contract.data,
          blockNum: parseInt(contract.contractId.split(':')[2]?.split('-')[0]) || stateData.state.stats?.block_num || 0,
          timestamp: Date.now()
        };
        
        try {
          // Transform using SPK transformer
          const mutations = await this.transformer.transformOperation(operation);
          
          if (mutations.length > 0) {
            // Import mutations
            const txn = this.dgraphClient.client.newTxn();
            try {
              // Log sample mutation for first contract
              if (processed === 0) {
                logger.info('First mutation example', { 
                  mutation: JSON.stringify(mutations[0], null, 2)
                });
              }
              
              const mu = new dgraph.Mutation();
              mu.setSetJson(mutations);
              const assigned = await txn.mutate(mu);
              await txn.commit();
              
              // Log details for contracts with files
              const fileCount = Object.keys(contract.data.df || {}).length;
              if (fileCount > 0) {
                logger.info('Contract with files imported', { 
                  contractId: contract.contractId,
                  username: contract.username,
                  fileCount,
                  mutationCount: mutations.length,
                  uidsAssigned: Object.keys(assigned.getUidsMap().toObject()).length
                });
              }
              
              processed++;
            } catch (error) {
              logger.error('Import error', { 
                contractId: contract.contractId, 
                error: error.message 
              });
              errors++;
            } finally {
              await txn.discard();
            }
          }
        } catch (error) {
          logger.error('Transform error', { 
            contractId: contract.contractId, 
            error: error.message 
          });
          errors++;
        }
      }
      
      const duration = Math.round((Date.now() - startTime) / 1000);
      console.log(chalk.green(`\n\n✨ Import completed in ${duration} seconds!`));
      console.log(chalk.green(`✓ Successfully imported: ${processed} contracts`));
      if (errors > 0) {
        console.log(chalk.yellow(`⚠️  Failed to import: ${errors} contracts`));
      }
      
      // Show sample VFS query
      if (this.targetUser) {
        await this.showSampleVFS();
      }
      
    } catch (error) {
      console.error(chalk.red('\nImport failed:'), error);
      process.exit(1);
    }
  }
  
  async initialize() {
    const spinner = ora('Initializing SPK data transformer...').start();
    
    try {
      await this.dgraphClient.initialize();
      
      // Create network manager that returns spkccT_ namespace for test network
      this.networkManager = {
        getNetwork: () => ({ namespace: 'spkccT_' })
      };
      
      // Use SPK-specific transformer
      this.transformer = createSPKDataTransformer(this.dgraphClient, this.networkManager);
      
      spinner.succeed('Initialized');
    } catch (error) {
      spinner.fail('Initialization failed');
      throw error;
    }
  }
  
  async showSampleVFS() {
    console.log(chalk.cyan('\n📁 Sample VFS Query Result:\n'));
    
    try {
      // Query for paths
      const query = `
        query getUserPaths($username: string) {
          paths(func: type(Path), first: 10) @filter(eq(owner.username, $username)) {
            fullPath
            pathName
            itemCount
            files(first: 5) {
              name
              cid
              size
              extension
            }
          }
        }
      `;
      
      const result = await this.dgraphClient.query(query, { $username: this.targetUser });
      
      if (result.paths && result.paths.length > 0) {
        console.log('Found paths:');
        for (const path of result.paths) {
          console.log(`  ${path.fullPath} (${path.itemCount} items)`);
          if (path.files && path.files.length > 0) {
            for (const file of path.files) {
              console.log(`    - ${file.name} (${file.cid.substring(0, 8)}...)`);
            }
          }
        }
      } else {
        console.log('No paths found. Contract metadata may need proper parsing.');
      }
      
    } catch (error) {
      logger.error('Failed to query VFS', { error: error.message });
    }
  }
}

// Run
const importer = new SPKContractsImporter();
importer.run();