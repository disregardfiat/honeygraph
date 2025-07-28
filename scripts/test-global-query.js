#!/usr/bin/env node

import { DgraphClient } from '../lib/dgraph-client.js';
import { createLogger } from '../lib/logger.js';
import chalk from 'chalk';

const logger = createLogger('test-global');

async function main() {
  console.log(chalk.bold.blue('🔍 Testing Global Query\n'));
  
  // Create a namespaced client
  const dgraphClient = new DgraphClient({
    url: process.env.DGRAPH_URL || 'http://dgraph-alpha:9080',
    namespace: 'spkccT_',
    logger
  });
  
  // Test 1: Regular query (should be namespaced)
  console.log(chalk.yellow('Test 1: Regular query for disregardfiat'));
  try {
    const regularQuery = `{ 
      account(func: eq(username, "disregardfiat")) @filter(type(Account)) { 
        uid 
        username
      } 
    }`;
    const regularResult = await dgraphClient.query(regularQuery);
    console.log(`Regular query found ${regularResult.account?.length || 0} accounts`);
    if (regularResult.account) {
      regularResult.account.forEach(acc => console.log(`  - ${acc.uid}: ${acc.username}`));
    }
  } catch (error) {
    console.error('Regular query error:', error.message);
  }
  
  // Test 2: Global query (should NOT be namespaced)
  console.log(chalk.yellow('\nTest 2: Global query for disregardfiat'));
  try {
    const globalQuery = `{ 
      account(func: eq(username, "disregardfiat")) @filter(type(Account)) { 
        uid 
        username
      } 
    }`;
    const globalResult = await dgraphClient.queryGlobal(globalQuery);
    console.log(`Global query found ${globalResult.account?.length || 0} accounts`);
    if (globalResult.account) {
      globalResult.account.forEach(acc => console.log(`  - ${acc.uid}: ${acc.username}`));
    }
  } catch (error) {
    console.error('Global query error:', error.message);
  }
  
  // Test 3: Check if Account type has namespace prefix
  console.log(chalk.yellow('\nTest 3: Check all types with "Account" in name'));
  try {
    const typeQuery = `{ 
      types(func: regexp(dgraph.type, /Account/)) { 
        uid 
        dgraph.type
      } 
    }`;
    const typeResult = await dgraphClient.query(typeQuery);
    console.log(`Found ${typeResult.types?.length || 0} types with "Account":`);
    if (typeResult.types) {
      typeResult.types.forEach(t => console.log(`  - ${t['dgraph.type']}`));
    }
  } catch (error) {
    console.error('Type query error:', error.message);
  }
  
  // Test 4: Raw query without type filter
  console.log(chalk.yellow('\nTest 4: Raw query for username without type filter'));
  try {
    const rawQuery = `{ 
      users(func: eq(username, "disregardfiat")) { 
        uid 
        username
        dgraph.type
      } 
    }`;
    const rawResult = await dgraphClient.query(rawQuery);
    console.log(`Raw query found ${rawResult.users?.length || 0} nodes with username "disregardfiat"`);
    if (rawResult.users) {
      rawResult.users.forEach(u => console.log(`  - ${u.uid}: ${u.username} (types: ${u['dgraph.type']})`));
    }
  } catch (error) {
    console.error('Raw query error:', error.message);
  }
}

main().catch(console.error);