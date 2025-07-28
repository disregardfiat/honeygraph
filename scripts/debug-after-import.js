#!/usr/bin/env node

import fetch from 'node-fetch';
import chalk from 'chalk';

async function queryHoneygraph(query) {
  // Query through the network-specific API endpoint
  const response = await fetch('http://localhost:3030/query/spkccT_', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query })
  });
  
  if (!response.ok) {
    throw new Error(`Query failed: ${response.statusText}`);
  }
  
  return response.json();
}

async function main() {
  console.log(chalk.bold.blue('🔍 Debugging Database After Import\n'));
  
  try {
    // First, let's check what's actually in the database
    console.log(chalk.yellow('📊 Database Statistics:'));
    
    // Check accounts
    const accountQuery = `{
      accounts(func: type(Account), first: 5) {
        uid
        username
        dgraph.type
      }
      accountCount(func: type(Account)) {
        count(uid)
      }
    }`;
    
    console.log('\nQuerying accounts...');
    try {
      const accountResult = await queryHoneygraph(accountQuery);
      console.log(`Total accounts: ${accountResult.accountCount?.[0]?.count || 0}`);
      if (accountResult.accounts) {
        console.log('Sample accounts:');
        accountResult.accounts.forEach(acc => {
          console.log(`  - ${acc.username} (${acc.uid})`);
        });
      }
    } catch (error) {
      console.log('Account query failed:', error.message);
    }
    
    // Check paths
    const pathQuery = `{
      paths(func: type(Path), first: 10) {
        uid
        fullPath
        owner {
          uid
          username
        }
        files {
          uid
          cid
          name
        }
      }
      pathCount(func: type(Path)) {
        count(uid)
      }
    }`;
    
    console.log('\nQuerying paths...');
    try {
      const pathResult = await queryHoneygraph(pathQuery);
      console.log(`\nTotal paths: ${pathResult.pathCount?.[0]?.count || 0}`);
      if (pathResult.paths) {
        console.log('Paths with details:');
        pathResult.paths.forEach(path => {
          console.log(`\n  Path: ${path.fullPath} (${path.uid})`);
          console.log(`    Owner: ${path.owner?.username || 'NO USERNAME'} (${path.owner?.uid || 'NO UID'})`);
          console.log(`    Files: ${path.files?.length || 0}`);
          if (path.files) {
            path.files.forEach(file => {
              console.log(`      - ${file.name || file.cid} (${file.uid})`);
            });
          }
        });
      }
    } catch (error) {
      console.log('Path query failed:', error.message);
    }
    
    // Check specific user
    const userToCheck = 'disregardfiat';
    console.log(chalk.yellow(`\n🔍 Checking specific user: ${userToCheck}`));
    
    const userQuery = `{
      users(func: eq(username, "${userToCheck}")) @filter(type(Account)) {
        uid
        username
        contracts {
          id
        }
      }
      userPaths(func: type(Path)) @filter(eq(owner.username, "${userToCheck}")) {
        fullPath
        files {
          name
          cid
        }
      }
    }`;
    
    try {
      const userResult = await queryHoneygraph(userQuery);
      if (userResult.users && userResult.users.length > 0) {
        console.log(`Found ${userResult.users.length} account(s) for ${userToCheck}`);
        userResult.users.forEach(user => {
          console.log(`  - ${user.username} (${user.uid}) - Contracts: ${user.contracts?.length || 0}`);
        });
      } else {
        console.log(`No accounts found for ${userToCheck}`);
      }
      
      if (userResult.userPaths && userResult.userPaths.length > 0) {
        console.log(`\nPaths owned by ${userToCheck}:`);
        userResult.userPaths.forEach(path => {
          console.log(`  - ${path.fullPath}: ${path.files?.length || 0} files`);
        });
      } else {
        console.log(`No paths found for ${userToCheck}`);
      }
    } catch (error) {
      console.log('User query failed:', error.message);
    }
    
    // Test the filesystem API
    console.log(chalk.yellow('\n🌐 Testing Filesystem API:'));
    
    const testUsers = ['disregardfiat', 'actifit-3speak', 'dlux-io'];
    for (const username of testUsers) {
      try {
        const fsResponse = await fetch(`http://localhost:3030/fs/${username}/`);
        const fsData = await fsResponse.json();
        
        console.log(`\n${username}:`);
        console.log(`  Type: ${fsData.type}`);
        console.log(`  Contents: ${fsData.contents?.length || 0} items`);
        
        // Count files vs directories
        let fileCount = 0;
        let dirCount = 0;
        fsData.contents?.forEach(item => {
          if (item.type === 'file') fileCount++;
          else if (item.type === 'directory') dirCount++;
        });
        
        console.log(`    - ${dirCount} directories`);
        console.log(`    - ${fileCount} files`);
        
        // Check if any directory has items
        const dirsWithItems = fsData.contents?.filter(item => 
          item.type === 'directory' && item.itemCount > 0
        );
        if (dirsWithItems?.length > 0) {
          console.log(`    - Directories with items:`);
          dirsWithItems.forEach(dir => {
            console.log(`      * ${dir.name}: ${dir.itemCount} items`);
          });
        }
      } catch (error) {
        console.log(`${username}: API error - ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
    console.error(error.stack);
  }
}

main().catch(console.error);