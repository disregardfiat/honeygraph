#!/usr/bin/env node

import chalk from 'chalk';
import { DgraphClient } from '../lib/dgraph-client.js';
import { createLogger } from '../lib/logger.js';

async function main() {
  console.log(chalk.bold.blue('🔍 Checking Raw Database State\n'));
  
  try {
    const logger = createLogger('check-database');
    
    // Create a direct dgraph client
    const dgraphClient = new DgraphClient({
      url: process.env.DGRAPH_URL || 'http://localhost:9080',
      namespace: 'spkccT_',
      logger
    });
    
    // 1. Check for any Accounts
    console.log(chalk.yellow('📊 Checking Accounts:'));
    const accountQuery = `{
      accounts(func: type(Account), first: 10) {
        uid
        username
      }
      accountCount(func: type(Account)) {
        count(uid)
      }
    }`;
    
    try {
      const accountResult = await dgraphClient.query(accountQuery);
      console.log(`Total accounts: ${accountResult.accountCount?.[0]?.count || 0}`);
      if (accountResult.accounts && accountResult.accounts.length > 0) {
        console.log('Sample accounts:');
        accountResult.accounts.forEach(acc => {
          console.log(`  - ${acc.username} (${acc.uid})`);
        });
      }
    } catch (error) {
      console.log('Account query failed:', error.message);
    }
    
    // 2. Check for StorageContracts
    console.log(chalk.yellow('\n📦 Checking Storage Contracts:'));
    const contractQuery = `{
      contracts(func: type(StorageContract), first: 10) {
        uid
        id
        owner {
          username
        }
        fileCount
      }
      contractCount(func: type(StorageContract)) {
        count(uid)
      }
    }`;
    
    try {
      const contractResult = await dgraphClient.query(contractQuery);
      console.log(`Total contracts: ${contractResult.contractCount?.[0]?.count || 0}`);
      if (contractResult.contracts && contractResult.contracts.length > 0) {
        console.log('Sample contracts:');
        contractResult.contracts.forEach(contract => {
          console.log(`  - ${contract.id} (Owner: ${contract.owner?.username}, Files: ${contract.fileCount || 0})`);
        });
      }
    } catch (error) {
      console.log('Contract query failed:', error.message);
    }
    
    // 3. Check for Paths
    console.log(chalk.yellow('\n📁 Checking Paths:'));
    const pathQuery = `{
      paths(func: type(Path), first: 10) {
        uid
        fullPath
        pathType
        owner {
          username
        }
        files {
          uid
        }
      }
      pathCount(func: type(Path)) {
        count(uid)
      }
    }`;
    
    try {
      const pathResult = await dgraphClient.query(pathQuery);
      console.log(`Total paths: ${pathResult.pathCount?.[0]?.count || 0}`);
      if (pathResult.paths && pathResult.paths.length > 0) {
        console.log('Sample paths:');
        pathResult.paths.forEach(path => {
          console.log(`  - ${path.fullPath} (Owner: ${path.owner?.username}, Files: ${path.files?.length || 0})`);
        });
      }
    } catch (error) {
      console.log('Path query failed:', error.message);
    }
    
    // 4. Check for Files
    console.log(chalk.yellow('\n📄 Checking Files:'));
    const fileQuery = `{
      files(func: type(ContractFile), first: 10) {
        uid
        cid
        name
        size
        parentPath {
          fullPath
        }
      }
      fileCount(func: type(ContractFile)) {
        count(uid)
      }
    }`;
    
    try {
      const fileResult = await dgraphClient.query(fileQuery);
      console.log(`Total files: ${fileResult.fileCount?.[0]?.count || 0}`);
      if (fileResult.files && fileResult.files.length > 0) {
        console.log('Sample files:');
        fileResult.files.forEach(file => {
          console.log(`  - ${file.name || file.cid} (Path: ${file.parentPath?.fullPath || 'none'}, Size: ${file.size})`);
        });
      }
    } catch (error) {
      console.log('File query failed:', error.message);
    }
    
    // 5. Check for NetworkStats
    console.log(chalk.yellow('\n📈 Checking NetworkStats:'));
    const statsQuery = `{
      stats(func: type(NetworkStats), first: 5) {
        uid
        statKey
        statCategory
        statValue
      }
      statsCount(func: type(NetworkStats)) {
        count(uid)
      }
    }`;
    
    try {
      const statsResult = await dgraphClient.query(statsQuery);
      console.log(`Total stats: ${statsResult.statsCount?.[0]?.count || 0}`);
      if (statsResult.stats && statsResult.stats.length > 0) {
        console.log('Sample stats:');
        statsResult.stats.forEach(stat => {
          console.log(`  - ${stat.statCategory}/${stat.statKey}: ${stat.statValue}`);
        });
      }
    } catch (error) {
      console.log('Stats query failed:', error.message);
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
    console.error(error.stack);
  }
}

main().catch(console.error);