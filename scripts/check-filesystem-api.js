#!/usr/bin/env node

import fetch from 'node-fetch';
import chalk from 'chalk';

async function queryAPI(endpoint, query = null) {
  const url = `http://localhost:3030${endpoint}`;
  const options = {
    method: query ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  };
  
  if (query) {
    options.body = JSON.stringify(query);
  }
  
  const response = await fetch(url, options);
  return response.json();
}

async function main() {
  console.log(chalk.bold.blue('🔍 Checking Filesystem via API\n'));
  
  try {
    // Check health
    const health = await queryAPI('/health');
    console.log(chalk.green('✓ API is healthy'));
    console.log(`  Uptime: ${Math.floor(health.uptime)}s`);
    
    // Check filesystem for disregardfiat
    console.log(chalk.yellow('\n📁 Checking /fs/disregardfiat/:'));
    const fsRoot = await queryAPI('/fs/disregardfiat/');
    console.log(`Type: ${fsRoot.type}`);
    console.log(`Contents: ${fsRoot.contents.length} items`);
    
    fsRoot.contents.forEach(item => {
      console.log(`  - ${item.name} (${item.type}) - ${item.itemCount} items`);
    });
    
    // Check a specific directory
    console.log(chalk.yellow('\n📁 Checking /fs/disregardfiat/Images/:'));
    const fsImages = await queryAPI('/fs/disregardfiat/Images/');
    console.log(`Type: ${fsImages.type}`);
    console.log(`Contents: ${fsImages.contents.length} items`);
    
    if (fsImages.contents.length > 0) {
      fsImages.contents.forEach(item => {
        console.log(`  - ${item.name} (${item.type})`);
      });
    } else {
      console.log(chalk.red('  No files found in Images directory!'));
    }
    
    // Try a few other users
    const testUsers = ['regardspk', 'actifit-3speak', 'testuser'];
    console.log(chalk.yellow('\n👥 Checking other users:'));
    
    for (const user of testUsers) {
      try {
        const userFs = await queryAPI(`/fs/${user}/`);
        console.log(`\n${user}:`);
        const hasContent = userFs.contents.some(item => item.itemCount > 0 || (item.type === 'file'));
        if (hasContent) {
          console.log(chalk.green('  ✓ Has content'));
          userFs.contents.forEach(item => {
            if (item.itemCount > 0 || item.type === 'file') {
              console.log(`    - ${item.name}: ${item.itemCount || 'file'}`);
            }
          });
        } else {
          console.log('  Empty filesystem');
        }
      } catch (error) {
        console.log(`  Error: ${error.message}`);
      }
    }
    
    // Check if we can access the network stats
    console.log(chalk.yellow('\n📊 Checking stats endpoint:'));
    try {
      const stats = await queryAPI('/stats/spkccT_');
      console.log('Stats available:', Object.keys(stats).length > 0 ? 'Yes' : 'No');
      if (stats.contracts) {
        console.log(`  Contracts: ${stats.contracts}`);
      }
      if (stats.accounts) {
        console.log(`  Accounts: ${stats.accounts}`);
      }
    } catch (error) {
      console.log('  Stats endpoint error:', error.message);
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
  }
}

main().catch(console.error);