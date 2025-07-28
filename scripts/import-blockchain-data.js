#!/usr/bin/env node

import dgraph from 'dgraph-js';
import grpc from '@grpc/grpc-js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ora from 'ora';
import chalk from 'chalk';
import { createLogger } from '../lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = createLogger('data-importer');

// Configuration
const config = {
  dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080',
  batchSize: parseInt(process.env.BATCH_SIZE) || 1000,
  networks: process.env.NETWORKS?.split(',') || ['spkccT_', 'spkcc_', 'dlux_'],
  dataSource: process.env.DATA_SOURCE || 'honeycomb', // 'honeycomb' or 'file'
  honeycombUrl: process.env.HONEYCOMB_URL || 'http://spktest.dlux.io',
  startBlock: parseInt(process.env.START_BLOCK) || 0,
  endBlock: parseInt(process.env.END_BLOCK) || 0, // 0 means current
  dropData: process.env.DROP_DATA === 'true'
};

class BlockchainDataImporter {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.networks = new Map();
    this.accounts = new Map();
    this.tokens = new Map();
    this.stats = {
      blocksProcessed: 0,
      operationsProcessed: 0,
      accountsCreated: 0,
      errors: 0,
      startTime: Date.now()
    };
  }

  async initialize() {
    // Setup DGraph connection
    const urlParts = this.config.dgraphUrl.replace(/^https?:\/\//, '').split(':');
    const host = urlParts[0];
    const grpcPort = '9080';
    const grpcUrl = `${host}:${grpcPort}`;

    console.log(chalk.blue(`Connecting to DGraph at ${grpcUrl}...`));
    
    const clientStub = new dgraph.DgraphClientStub(
      grpcUrl,
      grpc.credentials.createInsecure()
    );
    
    this.client = new dgraph.DgraphClient(clientStub);
    
    // Test connection
    const version = await this.client.checkVersion();
    console.log(chalk.green(`Connected to DGraph version: ${JSON.stringify(version)}`));
    
    // Drop data if requested
    if (this.config.dropData) {
      console.log(chalk.yellow('Dropping all existing data...'));
      const op = new dgraph.Operation();
      op.setDropAll(true);
      await this.client.alter(op);
    }
    
    // Apply schema
    await this.applySchema();
    
    // Initialize networks
    await this.initializeNetworks();
  }

  async applySchema() {
    const spinner = ora('Applying schema...').start();
    
    try {
      // Read base schema
      const schemaPath = join(__dirname, '../schema/base-schema.dgraph');
      if (!existsSync(schemaPath)) {
        throw new Error(`Schema file not found: ${schemaPath}`);
      }
      
      const schema = readFileSync(schemaPath, 'utf8');
      
      // Apply schema
      const op = new dgraph.Operation();
      op.setSchema(schema);
      await this.client.alter(op);
      
      spinner.succeed('Schema applied successfully');
    } catch (error) {
      spinner.fail(`Failed to apply schema: ${error.message}`);
      throw error;
    }
  }

  async initializeNetworks() {
    const spinner = ora('Initializing networks...').start();
    
    try {
      const txn = this.client.newTxn();
      const mutations = [];
      
      for (const prefix of this.config.networks) {
        // Network configurations
        const networkConfigs = {
          'spkccT_': {
            name: 'SPK Test Network',
            description: 'SPK Network testnet for development',
            chainId: 'spk-testnet',
            tokens: ['LARYNX', 'SPK', 'BROCA']
          },
          'spkcc_': {
            name: 'SPK Main Network',
            description: 'SPK Network mainnet',
            chainId: 'spk-mainnet',
            tokens: ['LARYNX', 'SPK', 'BROCA']
          },
          'dlux_': {
            name: 'DLUX Network',
            description: 'Decentralized Limitless User eXperience',
            chainId: 'dlux-mainnet',
            tokens: ['DLUX']
          }
        };
        
        const config = networkConfigs[prefix] || {
          name: prefix.slice(0, -1).toUpperCase(),
          description: `${prefix} network`,
          chainId: prefix.slice(0, -1),
          tokens: []
        };
        
        // Create network
        const networkData = {
          uid: `_:${prefix}`,
          'dgraph.type': 'Network',
          'network.prefix': prefix,
          'network.name': config.name,
          'network.description': config.description,
          'network.chainId': config.chainId,
          'network.createdAt': new Date().toISOString(),
          'network.isActive': true,
          'network.genesisBlock': 0,
          'network.currentBlock': 0
        };
        
        mutations.push(networkData);
        this.networks.set(prefix, networkData);
        
        // Create tokens for network
        for (const tokenSymbol of config.tokens) {
          const tokenData = {
            uid: `_:${prefix}${tokenSymbol}`,
            'dgraph.type': 'Token',
            'token.symbol': tokenSymbol,
            'token.name': tokenSymbol,
            'token.network': { uid: `_:${prefix}` },
            'token.precision': tokenSymbol === 'BROCA' ? 0 : 3,
            'token.createdAt': new Date().toISOString()
          };
          
          mutations.push(tokenData);
          this.tokens.set(`${prefix}${tokenSymbol}`, tokenData);
        }
        
        // Create initial fork
        const forkData = {
          uid: `_:${prefix}fork`,
          'dgraph.type': 'Fork',
          'fork.id': `${prefix}main`,
          'fork.network': { uid: `_:${prefix}` },
          'fork.parentFork': '',
          'fork.branchBlock': 0,
          'fork.tipBlock': 0,
          'fork.consensusScore': 1.0,
          'fork.isActive': true,
          'fork.createdAt': new Date().toISOString()
        };
        
        mutations.push(forkData);
      }
      
      // Apply mutations
      for (const data of mutations) {
        const mutation = new dgraph.Mutation();
        mutation.setSetJson(data);
        await txn.mutate(mutation);
      }
      
      await txn.commit();
      spinner.succeed(`Initialized ${this.config.networks.length} networks`);
    } catch (error) {
      spinner.fail(`Failed to initialize networks: ${error.message}`);
      throw error;
    }
  }

  async importFromHoneycomb(network) {
    const spinner = ora(`Importing data from Honeycomb for ${network}...`).start();
    
    try {
      // Get current state
      const stateUrl = `${this.config.honeycombUrl}/state`;
      const response = await fetch(stateUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch state: ${response.statusText}`);
      }
      
      const state = await response.json();
      spinner.text = `Processing ${network} state...`;
      
      // Import accounts
      await this.importAccounts(network, state);
      
      // Import balances
      await this.importBalances(network, state);
      
      // Import recent operations
      if (this.config.startBlock > 0 || this.config.endBlock > 0) {
        await this.importOperations(network, this.config.startBlock, this.config.endBlock || state.head_block);
      }
      
      // Update network current block
      await this.updateNetworkBlock(network, state.head_block);
      
      spinner.succeed(`Imported ${network} data successfully`);
    } catch (error) {
      spinner.fail(`Failed to import ${network}: ${error.message}`);
      this.stats.errors++;
    }
  }

  async importAccounts(network, state) {
    const accounts = Object.entries(state.accounts || {});
    const batchSize = this.config.batchSize;
    
    for (let i = 0; i < accounts.length; i += batchSize) {
      const batch = accounts.slice(i, i + batchSize);
      const txn = this.client.newTxn();
      
      try {
        for (const [accountName, accountData] of batch) {
          // Check if account exists
          let accountUid = this.accounts.get(accountName);
          
          if (!accountUid) {
            // Create account
            const account = {
              uid: `_:account_${accountName}`,
              'dgraph.type': 'Account',
              'account.name': accountName,
              'account.createdAt': new Date().toISOString(),
              'account.updatedAt': new Date().toISOString()
            };
            
            const mutation = new dgraph.Mutation();
            mutation.setSetJson(account);
            await txn.mutate(mutation);
            
            accountUid = `_:account_${accountName}`;
            this.accounts.set(accountName, accountUid);
            this.stats.accountsCreated++;
          }
          
          // Create network account association
          const networkAccount = {
            uid: `_:na_${network}${accountName}`,
            'dgraph.type': 'NetworkAccount',
            'networkAccount.network': { uid: this.networks.get(network).uid },
            'networkAccount.account': { uid: accountUid },
            'networkAccount.firstSeen': new Date().toISOString(),
            'networkAccount.lastActive': new Date().toISOString(),
            'networkAccount.transactionCount': 0
          };
          
          const naMutation = new dgraph.Mutation();
          naMutation.setSetJson(networkAccount);
          await txn.mutate(naMutation);
        }
        
        await txn.commit();
      } catch (error) {
        logger.error(`Failed to import account batch: ${error.message}`);
        await txn.discard();
      }
    }
  }

  async importBalances(network, state) {
    const balances = state.balances || {};
    const tokens = Object.keys(this.tokens).filter(key => key.startsWith(network));
    
    for (const tokenKey of tokens) {
      const tokenSymbol = tokenKey.replace(network, '');
      const tokenBalances = balances[tokenSymbol] || {};
      const entries = Object.entries(tokenBalances);
      
      for (let i = 0; i < entries.length; i += this.config.batchSize) {
        const batch = entries.slice(i, i + this.config.batchSize);
        const txn = this.client.newTxn();
        
        try {
          for (const [account, amount] of batch) {
            if (amount && amount !== '0') {
              const balance = {
                uid: `_:balance_${network}${tokenSymbol}_${account}`,
                'dgraph.type': 'Balance',
                'balance.networkAccount': { uid: `_:na_${network}${account}` },
                'balance.token': { uid: this.tokens.get(tokenKey).uid },
                'balance.amount': amount.toString(),
                'balance.blockNum': state.head_block,
                'balance.timestamp': new Date().toISOString()
              };
              
              const mutation = new dgraph.Mutation();
              mutation.setSetJson(balance);
              await txn.mutate(mutation);
            }
          }
          
          await txn.commit();
        } catch (error) {
          logger.error(`Failed to import balance batch: ${error.message}`);
          await txn.discard();
        }
      }
    }
  }

  async importOperations(network, startBlock, endBlock) {
    // This would fetch and import operations from the blockchain
    // For now, this is a placeholder
    logger.info(`Would import operations for ${network} from block ${startBlock} to ${endBlock}`);
  }

  async updateNetworkBlock(network, blockNum) {
    const txn = this.client.newTxn();
    
    try {
      // Query for network UID
      const query = `{
        network(func: eq(network.prefix, "${network}")) {
          uid
        }
      }`;
      
      const response = await this.client.newTxn().query(query);
      const result = response.getJson();
      
      if (result.network && result.network.length > 0) {
        const networkUid = result.network[0].uid;
        
        const mutation = new dgraph.Mutation();
        mutation.setSetJson({
          uid: networkUid,
          'network.currentBlock': blockNum
        });
        
        await txn.mutate(mutation);
        await txn.commit();
      }
    } catch (error) {
      logger.error(`Failed to update network block: ${error.message}`);
      await txn.discard();
    }
  }

  async importFromFile(filePath) {
    // Implement file-based import
    throw new Error('File-based import not yet implemented');
  }

  async run() {
    try {
      await this.initialize();
      
      console.log(chalk.blue('Starting data import...'));
      console.log(chalk.gray(`Networks: ${this.config.networks.join(', ')}`));
      console.log(chalk.gray(`Data source: ${this.config.dataSource}`));
      
      if (this.config.dataSource === 'honeycomb') {
        for (const network of this.config.networks) {
          await this.importFromHoneycomb(network);
        }
      } else if (this.config.dataSource === 'file') {
        const filePath = process.env.DATA_FILE;
        if (!filePath) {
          throw new Error('DATA_FILE environment variable required for file import');
        }
        await this.importFromFile(filePath);
      }
      
      // Print stats
      const duration = (Date.now() - this.stats.startTime) / 1000;
      console.log(chalk.green('\nImport completed!'));
      console.log(chalk.gray(`Duration: ${duration.toFixed(2)}s`));
      console.log(chalk.gray(`Blocks processed: ${this.stats.blocksProcessed}`));
      console.log(chalk.gray(`Operations processed: ${this.stats.operationsProcessed}`));
      console.log(chalk.gray(`Accounts created: ${this.stats.accountsCreated}`));
      console.log(chalk.gray(`Errors: ${this.stats.errors}`));
      
    } catch (error) {
      console.error(chalk.red(`Import failed: ${error.message}`));
      console.error(error.stack);
      process.exit(1);
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const importer = new BlockchainDataImporter(config);
  importer.run();
}

export { BlockchainDataImporter };