#!/usr/bin/env node

import chalk from 'chalk';

async function runDockerExec(command) {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  
  try {
    const { stdout, stderr } = await execAsync(command);
    if (stderr) console.error('stderr:', stderr);
    return stdout;
  } catch (error) {
    console.error('exec error:', error);
    throw error;
  }
}

async function queryDgraph(query) {
  // Execute query inside the api container which has network access to dgraph
  const command = `docker exec honeygraph-api node -e "
    import { DgraphClient } from './lib/dgraph-client.js';
    import { createLogger } from './lib/logger.js';
    
    const logger = createLogger('query');
    const dgraphClient = new DgraphClient({
      url: 'http://dgraph-alpha:9080',
      namespace: 'spkccT_',
      logger
    });
    
    const query = \\\`${query.replace(/`/g, '\\`')}\\\`;
    
    dgraphClient.query(query).then(result => {
      console.log(JSON.stringify(result, null, 2));
    }).catch(err => {
      console.error('Query error:', err.message);
    });
  "`;
  
  const result = await runDockerExec(command);
  try {
    return JSON.parse(result);
  } catch (e) {
    console.log('Raw result:', result);
    return null;
  }
}

async function main() {
  console.log(chalk.bold.blue('🔍 Checking Database via Docker\n'));
  
  try {
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
    
    const accountResult = await queryDgraph(accountQuery);
    if (accountResult) {
      console.log(`Total accounts: ${accountResult.accountCount?.[0]?.count || 0}`);
      if (accountResult.accounts && accountResult.accounts.length > 0) {
        console.log('Sample accounts:');
        accountResult.accounts.forEach(acc => {
          console.log(`  - ${acc.username} (${acc.uid})`);
        });
      }
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
    
    const contractResult = await queryDgraph(contractQuery);
    if (contractResult) {
      console.log(`Total contracts: ${contractResult.contractCount?.[0]?.count || 0}`);
      if (contractResult.contracts && contractResult.contracts.length > 0) {
        console.log('Sample contracts:');
        contractResult.contracts.forEach(contract => {
          console.log(`  - ${contract.id} (Owner: ${contract.owner?.username}, Files: ${contract.fileCount || 0})`);
        });
      }
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
    
    const pathResult = await queryDgraph(pathQuery);
    if (pathResult) {
      console.log(`Total paths: ${pathResult.pathCount?.[0]?.count || 0}`);
      if (pathResult.paths && pathResult.paths.length > 0) {
        console.log('Sample paths:');
        pathResult.paths.forEach(path => {
          console.log(`  - ${path.fullPath} (Owner: ${path.owner?.username}, Files: ${path.files?.length || 0})`);
        });
      }
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
    
    const fileResult = await queryDgraph(fileQuery);
    if (fileResult) {
      console.log(`Total files: ${fileResult.fileCount?.[0]?.count || 0}`);
      if (fileResult.files && fileResult.files.length > 0) {
        console.log('Sample files:');
        fileResult.files.forEach(file => {
          console.log(`  - ${file.name || file.cid} (Path: ${file.parentPath?.fullPath || 'none'}, Size: ${file.size})`);
        });
      }
    }
    
    // 5. Check specific user's filesystem
    console.log(chalk.yellow('\n🔍 Checking Specific User Filesystem:'));
    const userFsQuery = `{
      user(func: eq(username, "disregardfiat")) @filter(type(Account)) {
        uid
        username
        paths: ~owner @filter(type(Path)) {
          fullPath
          pathType
          files {
            name
            cid
            size
          }
        }
      }
    }`;
    
    const userFsResult = await queryDgraph(userFsQuery);
    if (userFsResult && userFsResult.user && userFsResult.user.length > 0) {
      const user = userFsResult.user[0];
      console.log(`User: ${user.username} (${user.uid})`);
      if (user.paths && user.paths.length > 0) {
        console.log('Paths:');
        user.paths.forEach(path => {
          console.log(`  - ${path.fullPath} (${path.files?.length || 0} files)`);
          if (path.files && path.files.length > 0) {
            path.files.forEach(file => {
              console.log(`    * ${file.name} (${file.size} bytes)`);
            });
          }
        });
      } else {
        console.log('  No paths found for this user');
      }
    } else {
      console.log('  User disregardfiat not found');
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
  }
}

main().catch(console.error);