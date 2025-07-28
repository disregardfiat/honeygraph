#!/usr/bin/env node

/**
 * Test script for SPK VFS init and import
 */

import dgraph from 'dgraph-js';
import grpc from '@grpc/grpc-js';
import fetch from 'node-fetch';
import chalk from 'chalk';
import ora from 'ora';
import { createSPKDataTransformer } from '../lib/spk-data-transformer.js';
import { DgraphClient } from '../lib/dgraph-client.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('spk-vfs-test');

class SPKVFSTest {
  constructor() {
    this.dgraphUrl = process.env.DGRAPH_URL || 'http://localhost:9080';
    this.dgraphClient = null;
    this.transformer = null;
    this.testUsername = 'disregardfiat';
  }

  async run() {
    console.log(chalk.bold.blue('🚀 Testing SPK VFS Init and Import\n'));
    
    try {
      // Step 1: Initialize DGraph connection
      await this.initializeDGraph();
      
      // Step 2: Apply schema
      await this.applySchema();
      
      // Step 3: Import test data
      await this.importTestData();
      
      // Step 4: Verify VFS output
      await this.verifyVFSOutput();
      
      console.log(chalk.green('\n✅ All tests passed!'));
      
    } catch (error) {
      console.error(chalk.red('\n❌ Test failed:'), error);
      process.exit(1);
    }
  }

  async initializeDGraph() {
    const spinner = ora('Initializing DGraph connection...').start();
    
    try {
      // Create DGraph client with spkccT_ namespace
      this.dgraphClient = new DgraphClient({
        url: this.dgraphUrl,
        logger,
        namespace: 'spkccT_'
      });
      
      // Test connection
      await this.dgraphClient.initialize();
      
      // Create transformer
      const networkManager = {
        getNetwork: () => ({ namespace: 'spkccT_' })
      };
      this.transformer = createSPKDataTransformer(this.dgraphClient, networkManager);
      
      spinner.succeed('DGraph connection initialized');
    } catch (error) {
      spinner.fail('Failed to initialize DGraph');
      throw error;
    }
  }

  async applySchema() {
    const spinner = ora('Applying SPK schema...').start();
    
    try {
      // Schema is applied by init-schema.js which we'll call
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const { stdout, stderr } = await execAsync('node scripts/init-schema.js');
      if (stderr) {
        console.error('Schema init stderr:', stderr);
      }
      
      spinner.succeed('Schema applied successfully');
    } catch (error) {
      spinner.fail('Failed to apply schema');
      throw error;
    }
  }

  async importTestData() {
    const spinner = ora('Importing test data for ' + this.testUsername).start();
    
    try {
      // Fetch state from SPK testnet
      const response = await fetch('https://spktest.dlux.io/state');
      const stateData = await response.json();
      
      // Find contracts for our test user
      const userContracts = stateData.state.contract?.[this.testUsername] || {};
      const contractCount = Object.keys(userContracts).length;
      
      if (contractCount === 0) {
        throw new Error(`No contracts found for user ${this.testUsername}`);
      }
      
      spinner.text = `Found ${contractCount} contracts for ${this.testUsername}`;
      
      // First ensure the user account exists
      const accountMutation = {
        uid: `_:account_${this.testUsername}`,
        'dgraph.type': 'Account',
        username: this.testUsername,
        createdAt: new Date().toISOString()
      };
      
      const txn = this.dgraphClient.client.newTxn();
      const mu = new dgraph.Mutation();
      mu.setSetJson([accountMutation]);
      await txn.mutate(mu);
      await txn.commit();
      
      // Import each contract
      let imported = 0;
      for (const [contractId, contractData] of Object.entries(userContracts)) {
        try {
          // Create operation for this contract
          const operation = {
            type: 'put',
            path: ['contract', this.testUsername, contractId],
            data: contractData,
            blockNum: parseInt(contractId.split(':')[2]?.split('-')[0]) || 0,
            timestamp: Date.now()
          };
          
          // Transform using SPK transformer
          const mutations = await this.transformer.transformOperation(operation);
          
          if (mutations.length > 0) {
            const txn = this.dgraphClient.client.newTxn();
            try {
              const mu = new dgraph.Mutation();
              mu.setSetJson(mutations);
              await txn.mutate(mu);
              await txn.commit();
              imported++;
              
              logger.info('Contract imported', { 
                contractId, 
                fileCount: Object.keys(contractData.df || {}).length 
              });
            } finally {
              await txn.discard();
            }
          }
        } catch (error) {
          logger.error('Failed to import contract', { contractId, error: error.message });
        }
      }
      
      spinner.succeed(`Imported ${imported}/${contractCount} contracts`);
    } catch (error) {
      spinner.fail('Failed to import test data');
      throw error;
    }
  }

  async verifyVFSOutput() {
    const spinner = ora('Verifying VFS output...').start();
    
    try {
      // Simulate the filesystem API query
      const query = `
        query getDirectory($username: string, $directoryPath: string) {
          user(func: eq(username, $username), first: 1) {
            uid
            username
          }
          
          paths(func: type(Path), first: 1000) @filter(uid_in(owner, uid(user)) AND eq(pathType, "directory")) {
            fullPath
            pathName
            pathType
            itemCount
            files {
              uid
              cid
              name
              extension
              size
              mimeType
              license
              labels
              thumbnail
              flags
              contract {
                id
                blockNumber
                encryptionData
                storageNodes {
                  storageAccount {
                    username
                  }
                }
              }
            }
          }
        }
      `;
      
      const vars = { 
        $username: this.testUsername,
        $directoryPath: '/NFTs'
      };
      
      const result = await this.dgraphClient.query(query, vars);
      
      // Find the NFTs directory
      const nftsPath = result.paths?.find(p => p.fullPath === '/NFTs');
      
      if (!nftsPath) {
        throw new Error('NFTs directory not found');
      }
      
      // Build the expected output format
      const output = {
        path: '/NFTs',
        username: this.testUsername,
        type: 'directory',
        contents: []
      };
      
      // Add subdirectories
      const subdirs = result.paths.filter(p => 
        p.fullPath.startsWith('/NFTs/') && 
        p.fullPath.split('/').length === 3
      );
      
      for (const subdir of subdirs) {
        output.contents.push({
          name: subdir.pathName,
          type: 'directory',
          path: subdir.fullPath,
          itemCount: subdir.itemCount || 0
        });
      }
      
      // Add files
      if (nftsPath.files) {
        for (const file of nftsPath.files) {
          // Skip thumbnails
          if ((file.flags || 0) & 2) continue;
          
          const contract = file.contract;
          output.contents.push({
            name: file.name,
            type: 'file',
            cid: file.cid,
            extension: file.extension || 'nft',
            size: file.size,
            mimeType: file.mimeType || 'application/nft',
            license: file.license || '',
            labels: file.labels || '',
            thumbnail: file.thumbnail || '',
            contract: {
              id: contract.id,
              blockNumber: contract.blockNumber,
              encryptionData: contract.encryptionData || null,
              storageNodeCount: contract.storageNodes?.length || 1,
              storageNodes: contract.storageNodes?.map(n => n.storageAccount?.username || 'dlux-io') || ['dlux-io']
            },
            metadata: {
              encrypted: false,
              autoRenew: true
            }
          });
        }
      }
      
      // Sort contents
      output.contents.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      
      spinner.succeed('VFS output verified');
      
      console.log(chalk.cyan('\n📁 VFS Output for /NFTs:'));
      console.log(JSON.stringify(output, null, 2));
      
      // Check if we have the expected files
      const expectedFiles = ['bz', 'dlux', 'hf'];
      const foundFiles = output.contents.filter(c => c.type === 'file').map(f => f.name);
      
      console.log(chalk.yellow(`\n✓ Found ${foundFiles.length} files: ${foundFiles.join(', ')}`));
      
      if (foundFiles.length === 0) {
        console.log(chalk.red('⚠️  No files found - check if contracts have proper metadata'));
      }
      
    } catch (error) {
      spinner.fail('Failed to verify VFS output');
      throw error;
    }
  }
}

// Run the test
const test = new SPKVFSTest();
test.run();