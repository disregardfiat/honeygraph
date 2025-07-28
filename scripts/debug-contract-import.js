#!/usr/bin/env node

import fetch from 'node-fetch';
import { createDataTransformer } from '../lib/data-transformer.js';
import { createLogger } from '../lib/logger.js';
import chalk from 'chalk';

const logger = createLogger('debug-contract-import');

async function main() {
  console.log(chalk.bold.blue('🔍 Debugging Contract Import\n'));
  
  try {
    // Fetch state data
    console.log('Fetching SPK testnet state...');
    const response = await fetch('https://spktest.dlux.io/state');
    const stateData = await response.json();
    
    // Find a sample contract with files
    let sampleContract = null;
    let sampleUsername = null;
    let sampleContractId = null;
    
    for (const [username, contracts] of Object.entries(stateData.state.contract || {})) {
      for (const [contractId, contract] of Object.entries(contracts)) {
        if (contract.df && Object.keys(contract.df).length > 0) {
          sampleContract = contract;
          sampleUsername = username;
          sampleContractId = contractId;
          break;
        }
      }
      if (sampleContract) break;
    }
    
    if (!sampleContract) {
      console.log(chalk.red('No contracts with files found!'));
      return;
    }
    
    console.log(chalk.yellow('\n📄 Sample Contract:'));
    console.log(`Username: ${sampleUsername}`);
    console.log(`Contract ID: ${sampleContractId}`);
    console.log(`Contract data:`, JSON.stringify(sampleContract, null, 2));
    
    // Create a mock transformer to see what mutations would be created
    const mockDgraph = {
      query: async () => ({ account: [] }), // No existing accounts
      queryGlobal: async () => ({ account: [] })
    };
    
    const transformer = createDataTransformer(mockDgraph);
    
    const operation = {
      type: 'put',
      path: ['contract', sampleUsername, sampleContractId],
      data: sampleContract,
      blockNum: 96585668,
      timestamp: Date.now()
    };
    
    console.log(chalk.yellow('\n🔄 Transforming contract...'));
    const mutations = await transformer.transformOperation(operation);
    
    console.log(chalk.yellow('\n📊 Mutations Summary:'));
    const mutationTypes = {};
    mutations.forEach(m => {
      const type = m['dgraph.type'] || 'other';
      mutationTypes[type] = (mutationTypes[type] || 0) + 1;
    });
    console.log(mutationTypes);
    
    // Examine Path mutations
    const paths = mutations.filter(m => m['dgraph.type'] === 'Path');
    console.log(chalk.yellow('\n📁 Path Mutations:'));
    paths.forEach(path => {
      console.log(`\nPath: ${path.fullPath}`);
      console.log(`  Owner: ${JSON.stringify(path.owner)}`);
      console.log(`  Files: ${path.files ? path.files.length : 0}`);
      if (path.files && path.files.length > 0) {
        path.files.forEach(f => console.log(`    - ${f.uid}`));
      }
    });
    
    // Examine File mutations
    const files = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
    console.log(chalk.yellow('\n📄 File Mutations:'));
    files.forEach(file => {
      console.log(`\nFile: ${file.name || file.cid}`);
      console.log(`  CID: ${file.cid}`);
      console.log(`  Path: ${file.path}`);
      console.log(`  ParentPath: ${JSON.stringify(file.parentPath)}`);
      console.log(`  Size: ${file.size}`);
    });
    
    // Check the contract mutation
    const contracts = mutations.filter(m => m['dgraph.type'] === 'StorageContract');
    console.log(chalk.yellow('\n📦 Contract Mutations:'));
    contracts.forEach(contract => {
      console.log(`\nContract: ${contract.id}`);
      console.log(`  Owner: ${JSON.stringify(contract.owner)}`);
      console.log(`  Files: ${contract.fileCount || 0}`);
      console.log(`  Metadata: ${contract.metadata ? 'Yes' : 'No'}`);
    });
    
    // Check if metadata is being parsed
    if (sampleContract.m) {
      console.log(chalk.yellow('\n🔍 Metadata Analysis:'));
      console.log(`Raw metadata: ${sampleContract.m}`);
      
      // Try to understand the metadata format
      const parts = sampleContract.m.split(',');
      console.log(`Metadata parts: ${parts.length}`);
      parts.forEach((part, i) => {
        if (i < 10) { // First 10 parts
          console.log(`  [${i}]: ${part}`);
        }
      });
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
    logger.error('Debug failed', { error: error.stack });
  }
}

main().catch(console.error);