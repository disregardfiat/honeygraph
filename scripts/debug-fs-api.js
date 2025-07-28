#!/usr/bin/env node

import { DgraphClient } from '../lib/dgraph-client.js';
import { createLogger } from '../lib/logger.js';
import chalk from 'chalk';

const logger = createLogger('debug-fs-api');

async function debugFilesystemAPI() {
  console.log(chalk.bold.blue('🔍 Debugging Filesystem API Issues\n'));
  
  const dgraphUrl = process.env.DGRAPH_URL || 'http://dgraph-alpha:9080';
  const username = 'disregardfiat';
  
  // Create client with namespace
  const dgraphClient = new DgraphClient({
    url: dgraphUrl,
    logger,
    namespace: 'spkccT_'
  });
  
  console.log(chalk.yellow('Testing queries for user:'), username);
  console.log(chalk.gray('Dgraph URL:'), dgraphUrl);
  console.log(chalk.gray('Namespace:'), 'spkccT_\n');
  
  // Test 1: Check if user exists (with global query)
  console.log(chalk.cyan('1. Checking if user exists (global query):'));
  const userQuery = `
    {
      user(func: eq(username, "${username}")) {
        uid
        username
        dgraph.type
      }
    }
  `;
  
  try {
    const userResult = await dgraphClient.query(userQuery);
    console.log('User query result:', JSON.stringify(userResult, null, 2));
  } catch (error) {
    console.log(chalk.red('User query error:'), error.message);
  }
  
  // Test 2: Check paths owned by user
  console.log(chalk.cyan('\n2. Checking paths owned by user:'));
  const pathQuery = `
    {
      user(func: eq(username, "${username}")) {
        uid
        username
        ~owner @filter(type(Path)) {
          uid
          path
          isDirectory
          fileSize
          cid
        }
      }
    }
  `;
  
  try {
    const pathResult = await dgraphClient.query(pathQuery);
    console.log('Path query result:', JSON.stringify(pathResult, null, 2));
  } catch (error) {
    console.log(chalk.red('Path query error:'), error.message);
  }
  
  // Test 3: Direct path search
  console.log(chalk.cyan('\n3. Direct path search:'));
  const directPathQuery = `
    {
      paths(func: type(Path)) @filter(regexp(path, "^${username}/")) {
        uid
        path
        owner {
          uid
          username
        }
        isDirectory
        fileSize
        cid
      }
    }
  `;
  
  try {
    const directResult = await dgraphClient.query(directPathQuery);
    console.log('Direct path query result:', JSON.stringify(directResult, null, 2));
  } catch (error) {
    console.log(chalk.red('Direct path query error:'), error.message);
  }
  
  // Test 4: Check Account type
  console.log(chalk.cyan('\n4. Checking Account type:'));
  const accountQuery = `
    {
      accounts(func: type(Account)) @filter(eq(username, "${username}")) {
        uid
        username
        dgraph.type
      }
    }
  `;
  
  try {
    const accountResult = await dgraphClient.query(accountQuery);
    console.log('Account query result:', JSON.stringify(accountResult, null, 2));
  } catch (error) {
    console.log(chalk.red('Account query error:'), error.message);
  }
  
  // Test 5: Sample of all paths
  console.log(chalk.cyan('\n5. Sample of all paths (first 5):'));
  const allPathsQuery = `
    {
      paths(func: type(Path), first: 5) {
        uid
        path
        owner {
          uid
          username
          dgraph.type
        }
        isDirectory
      }
    }
  `;
  
  try {
    const allPathsResult = await dgraphClient.query(allPathsQuery);
    console.log('All paths sample:', JSON.stringify(allPathsResult, null, 2));
  } catch (error) {
    console.log(chalk.red('All paths query error:'), error.message);
  }
  
  // Test 6: Count statistics
  console.log(chalk.cyan('\n6. Database statistics:'));
  const statsQuery = `
    {
      accounts(func: type(Account)) { count: count(uid) }
      paths(func: type(Path)) { count: count(uid) }
      contracts(func: type(StorageContract)) { count: count(uid) }
    }
  `;
  
  try {
    const statsResult = await dgraphClient.query(statsQuery);
    console.log('Statistics:', JSON.stringify(statsResult, null, 2));
  } catch (error) {
    console.log(chalk.red('Stats query error:'), error.message);
  }
}

// Run debug
debugFilesystemAPI().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});