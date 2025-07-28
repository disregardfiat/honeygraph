#!/usr/bin/env node

import { createLogger } from '../lib/logger.js';
import chalk from 'chalk';

const logger = createLogger('debug-filesystem');

async function main() {
  console.log(chalk.bold.blue('🔍 Debugging Filesystem Data\n'));
  
  try {
    // Create a simple dgraph client directly
    const dgraph = await import('dgraph-js');
    const grpc = await import('@grpc/grpc-js');
    
    const clientStub = new dgraph.DgraphClientStub(
      'localhost:9080',
      grpc.credentials.createInsecure()
    );
    const dgraphClient = new dgraph.DgraphClient(clientStub);
    
    // Mock the expected structure
    const network = {
      dgraphClient: {
        client: dgraphClient,
        query: async (query, vars) => {
          const txn = dgraphClient.newTxn({ readOnly: true });
          try {
            const res = await txn.queryWithVars(query, vars || {});
            return JSON.parse(res.getJson());
          } finally {
            await txn.discard();
          }
        }
      }
    };
    
    const dgraphClientWrapper = network.dgraphClient;
    
    // Query 1: Count Path objects
    console.log(chalk.yellow('\n📁 Path Objects:'));
    const pathCountQuery = `{ 
      paths(func: type(Path)) { 
        count(uid) 
      } 
    }`;
    const pathCountResult = await dgraphClientWrapper.query(pathCountQuery);
    console.log(`Total Paths: ${pathCountResult.paths?.[0]?.count || 0}`);
    
    // Query 2: Sample Path objects with files
    const pathQuery = `{ 
      paths(func: type(Path), first: 5) @filter(has(files)) {
        uid
        fullPath
        pathType
        owner {
          username
        }
        files {
          uid
          cid
          name
          size
        }
        itemCount
      } 
    }`;
    const pathResult = await dgraphClientWrapper.query(pathQuery);
    
    if (pathResult.paths && pathResult.paths.length > 0) {
      console.log('\nPaths with files:');
      pathResult.paths.forEach(path => {
        console.log(`  ${path.fullPath} (owner: ${path.owner?.username || 'unknown'})`);
        if (path.files && path.files.length > 0) {
          console.log(`    Files: ${path.files.length}`);
          path.files.forEach(file => {
            console.log(`      - ${file.name || file.cid} (${file.size} bytes)`);
          });
        }
      });
    } else {
      console.log(chalk.red('  No paths with files found!'));
    }
    
    // Query 3: Count ContractFile objects
    console.log(chalk.yellow('\n📄 ContractFile Objects:'));
    const fileCountQuery = `{ 
      files(func: type(ContractFile)) { 
        count(uid) 
      } 
    }`;
    const fileCountResult = await dgraphClientWrapper.query(fileCountQuery);
    console.log(`Total ContractFiles: ${fileCountResult.files?.[0]?.count || 0}`);
    
    // Query 4: Sample ContractFile objects
    const fileQuery = `{ 
      files(func: type(ContractFile), first: 5) {
        uid
        cid
        name
        size
        path
        parentPath {
          uid
          fullPath
        }
        contract {
          id
          owner {
            username
          }
        }
      } 
    }`;
    const fileResult = await dgraphClientWrapper.query(fileQuery);
    
    if (fileResult.files && fileResult.files.length > 0) {
      console.log('\nSample files:');
      fileResult.files.forEach(file => {
        console.log(`  ${file.name || file.cid}`);
        console.log(`    Path: ${file.path}`);
        console.log(`    Parent Path: ${file.parentPath ? file.parentPath.fullPath : 'NOT SET'}`);
        console.log(`    Contract: ${file.contract?.id || 'unknown'}`);
        console.log(`    Owner: ${file.contract?.owner?.username || 'unknown'}`);
      });
    }
    
    // Query 5: Check disregardfiat specifically
    console.log(chalk.yellow('\n👤 Checking disregardfiat:'));
    const userQuery = `{ 
      user(func: eq(username, "disregardfiat"), first: 1) {
        uid
        username
        contracts {
          count(uid)
        }
      }
    }`;
    const userResult = await dgraphClientWrapper.query(userQuery);
    
    if (userResult.user?.[0]) {
      console.log(`User found: ${userResult.user[0].username}`);
      console.log(`User UID: ${userResult.user[0].uid}`);
      console.log(`Contracts: ${userResult.user[0].contracts?.count || 0}`);
      
      // Query paths owned by disregardfiat
      const userPathQuery = `{ 
        paths(func: type(Path)) @filter(uid_in(owner, "${userResult.user[0].uid}")) {
          fullPath
          files {
            count(uid)
          }
        }
      }`;
      const userPathResult = await dgraphClientWrapper.query(userPathQuery);
      
      if (userPathResult.paths && userPathResult.paths.length > 0) {
        console.log('\nPaths owned by disregardfiat:');
        userPathResult.paths.forEach(path => {
          console.log(`  ${path.fullPath} - Files: ${path.files?.count || 0}`);
        });
      } else {
        console.log(chalk.red('  No paths found for disregardfiat!'));
      }
    }
    
    // Query 6: Check if files are orphaned (no parentPath)
    console.log(chalk.yellow('\n🔗 Checking file-path relationships:'));
    const orphanQuery = `{ 
      orphaned(func: type(ContractFile)) @filter(NOT has(parentPath)) {
        count(uid)
      }
      withParent(func: type(ContractFile)) @filter(has(parentPath)) {
        count(uid)
      }
    }`;
    const orphanResult = await dgraphClientWrapper.query(orphanQuery);
    console.log(`Files without parentPath: ${orphanResult.orphaned?.[0]?.count || 0}`);
    console.log(`Files with parentPath: ${orphanResult.withParent?.[0]?.count || 0}`);
    
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
    logger.error('Debug failed', { error: error.stack });
  }
}

main().catch(console.error);