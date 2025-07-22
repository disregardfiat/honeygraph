#!/usr/bin/env node

import { createDgraphClient } from '../lib/dgraph-client.js';
import chalk from 'chalk';

async function checkDatabase() {
  console.log(chalk.cyan('Checking database contents...\n'));
  
  const dgraphClient = createDgraphClient();
  await dgraphClient.connect();
  
  try {
    // Check accounts
    const accountQuery = `{ 
      accounts(func: type(Account), first: 10) { 
        count(uid) 
      }
      accountSample(func: type(Account), first: 3) {
        username
        larynxBalance
        spkBalance
        contracts {
          id
        }
      }
    }`;
    
    const accountResult = await dgraphClient.query(accountQuery);
    const accountCount = accountResult.accounts?.[0]?.count || 0;
    console.log(chalk.green(`✓ Accounts: ${accountCount}`));
    if (accountResult.accountSample) {
      console.log('  Sample accounts:', accountResult.accountSample.map(a => a.username).join(', '));
    }
    
    // Check contracts
    const contractQuery = `{ 
      contracts(func: type(StorageContract), first: 10) { 
        count(uid) 
      }
      contractSample(func: type(StorageContract), first: 3) {
        id
        purchaser {
          username
        }
        fileCount
        utilized
      }
    }`;
    
    const contractResult = await dgraphClient.query(contractQuery);
    const contractCount = contractResult.contracts?.[0]?.count || 0;
    console.log(chalk.green(`✓ Contracts: ${contractCount}`));
    if (contractResult.contractSample) {
      console.log('  Sample contracts:', contractResult.contractSample.map(c => c.id).join(', '));
    }
    
    // Check files
    const fileQuery = `{ 
      files(func: type(ContractFile), first: 10) { 
        count(uid) 
      }
      fileSample(func: type(ContractFile), first: 3) {
        cid
        name
        size
        contract {
          id
        }
      }
    }`;
    
    const fileResult = await dgraphClient.query(fileQuery);
    const fileCount = fileResult.files?.[0]?.count || 0;
    console.log(chalk.green(`✓ Files: ${fileCount}`));
    if (fileResult.fileSample) {
      console.log('  Sample files:', fileResult.fileSample.map(f => f.name || f.cid).join(', '));
    }
    
    // Check paths
    const pathQuery = `{ 
      paths(func: type(Path), first: 10) { 
        count(uid) 
      }
      pathSample(func: type(Path), first: 3) @filter(eq(pathType, "directory") AND gt(itemCount, 0)) {
        fullPath
        itemCount
        owner {
          username
        }
      }
    }`;
    
    const pathResult = await dgraphClient.query(pathQuery);
    const pathCount = pathResult.paths?.[0]?.count || 0;
    console.log(chalk.green(`✓ Paths: ${pathCount}`));
    if (pathResult.pathSample) {
      console.log('  Sample paths with items:', pathResult.pathSample.map(p => `${p.owner?.username}:${p.fullPath} (${p.itemCount} items)`).join(', '));
    }
    
    // Check new types
    const newTypesQuery = `{
      priceFeeds(func: type(PriceFeed), first: 5) { count(uid) }
      chainState(func: type(ChainState), first: 5) { count(uid) }
      scheduledOps(func: type(ScheduledOperation), first: 5) { count(uid) }
      networkStats(func: type(NetworkStats), first: 5) { count(uid) }
      runnerNodes(func: type(RunnerNode), first: 5) { count(uid) }
    }`;
    
    const newTypesResult = await dgraphClient.query(newTypesQuery);
    console.log(chalk.cyan('\nNew Types:'));
    console.log(`  PriceFeeds: ${newTypesResult.priceFeeds?.[0]?.count || 0}`);
    console.log(`  ChainState: ${newTypesResult.chainState?.[0]?.count || 0}`);
    console.log(`  ScheduledOps: ${newTypesResult.scheduledOps?.[0]?.count || 0}`);
    console.log(`  NetworkStats: ${newTypesResult.networkStats?.[0]?.count || 0}`);
    console.log(`  RunnerNodes: ${newTypesResult.runnerNodes?.[0]?.count || 0}`);
    
    // Check disregardfiat specifically
    console.log(chalk.cyan('\nChecking disregardfiat account...'));
    const userQuery = `{
      user(func: eq(username, "disregardfiat")) {
        username
        larynxBalance
        spkBalance
        spkPower
        contracts {
          id
          fileCount
          utilized
        }
        contractCount: count(contracts)
      }
    }`;
    
    const userResult = await dgraphClient.query(userQuery);
    if (userResult.user?.[0]) {
      const user = userResult.user[0];
      console.log(chalk.green('✓ Found disregardfiat'));
      console.log(`  Larynx: ${user.larynxBalance || 0}`);
      console.log(`  SPK: ${user.spkBalance || 0}`);
      console.log(`  SPK Power: ${user.spkPower || 0}`);
      console.log(`  Contracts: ${user.contractCount || 0}`);
    } else {
      console.log(chalk.red('✗ disregardfiat not found'));
    }
    
  } catch (error) {
    console.error(chalk.red('Query error:'), error.message);
  }
}

checkDatabase().catch(console.error);