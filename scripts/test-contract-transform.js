#!/usr/bin/env node

import { createDataTransformer } from '../lib/data-transformer.js';
import { createDgraphClient } from '../lib/dgraph-client.js';
import fetch from 'node-fetch';
import chalk from 'chalk';

async function testContractTransform() {
  console.log(chalk.cyan('Testing contract transformation...\n'));
  
  // Get state data
  const response = await fetch('https://spktest.dlux.io/state');
  const stateData = await response.json();
  
  // Create transformer
  const dgraphClient = createDgraphClient();
  await dgraphClient.connect();
  const transformer = createDataTransformer(dgraphClient);
  
  // Find disregardfiat contracts
  const disregardfiatContracts = stateData.state.contract['disregardfiat'];
  if (!disregardfiatContracts) {
    console.log(chalk.red('No contracts found for disregardfiat'));
    return;
  }
  
  console.log(chalk.green(`Found ${Object.keys(disregardfiatContracts).length} contracts for disregardfiat\n`));
  
  // Test transform the first contract
  const [contractId, contractData] = Object.entries(disregardfiatContracts)[0];
  console.log(chalk.yellow('Contract ID:'), contractId);
  console.log(chalk.yellow('Contract owner (t):'), contractData.t);
  console.log(chalk.yellow('Contract purchaser (f):'), contractData.f);
  console.log(chalk.yellow('Files (df):'), Object.keys(contractData.df || {}).length);
  
  // Create operation as the init script does
  const operation = {
    type: 'put',
    path: ['contract', 'disregardfiat', contractId],
    data: contractData,
    blockNum: stateData.state.stats?.block_num || 0,
    timestamp: Date.now()
  };
  
  console.log(chalk.cyan('\nOperation path:'), operation.path);
  
  try {
    // Transform the operation
    const mutations = await transformer.transformOperation(operation);
    
    console.log(chalk.green(`\nGenerated ${mutations.length} mutations`));
    
    // Check for contracts in mutations
    const contractMutations = mutations.filter(m => m['dgraph.type'] === 'StorageContract');
    const fileMutations = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
    const pathMutations = mutations.filter(m => m['dgraph.type'] === 'Path');
    
    console.log(chalk.blue('Contract mutations:'), contractMutations.length);
    console.log(chalk.blue('File mutations:'), fileMutations.length);
    console.log(chalk.blue('Path mutations:'), pathMutations.length);
    
    if (contractMutations.length > 0) {
      console.log(chalk.cyan('\nFirst contract mutation:'));
      console.log(JSON.stringify(contractMutations[0], null, 2));
    }
    
    if (fileMutations.length > 0) {
      console.log(chalk.cyan('\nFirst file mutation:'));
      console.log(JSON.stringify(fileMutations[0], null, 2));
    }
    
  } catch (error) {
    console.error(chalk.red('Transform error:'), error.message);
    console.error(error.stack);
  }
}

testContractTransform().catch(console.error);