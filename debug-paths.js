#!/usr/bin/env node

import { createNetworkManager } from './lib/network-manager.js';

async function debugPaths() {
  try {
    const networkManager = createNetworkManager({
      baseDataPath: './data/honeygraph',
      dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080'
    });
    await networkManager.initialize();
    
    const network = networkManager.getNetwork('spkccT_');
    if (!network) {
      console.log('spkccT_ network not found');
      return;
    }
    
    console.log('🔍 Debugging disregardfiat paths...\n');
    
    // Query for disregardfiat account
    const accountQuery = `{
      account(func: eq(username, "disregardfiat"), first: 1) {
        username
        uid
      }
    }`;
    
    const accountResult = await network.dgraphClient.query(accountQuery);
    console.log('✅ Account found:', accountResult.account?.[0]);
    
    if (!accountResult.account?.[0]) {
      console.log('❌ No disregardfiat account found');
      return;
    }
    
    const accountUid = accountResult.account[0].uid;
    
    // Query for all paths (we'll filter by owner afterwards)
    const pathQuery = `{
      paths(func: type(Path)) {
        fullPath
        pathName
        pathType
        itemCount
        owner { username }
        currentFile {
          cid
          name
          contract {
            id
          }
        }
      }
    }`;
    
    const pathResult = await network.dgraphClient.query(pathQuery);
    console.log('\\n📁 All paths in database:');
    
    if (pathResult.paths && pathResult.paths.length > 0) {
      // Filter for disregardfiat paths
      const disregardfiatPaths = pathResult.paths.filter(path => 
        path.owner && path.owner.username === 'disregardfiat'
      );
      
      console.log(`\\n📊 Total paths in database: ${pathResult.paths.length}`);
      console.log(`📁 Disregardfiat paths: ${disregardfiatPaths.length}`);
      
      if (disregardfiatPaths.length > 0) {
        console.log('\\n📂 Disregardfiat paths:');
        disregardfiatPaths.forEach(path => {
          console.log(`  ${path.pathType === 'directory' ? '📂' : '📄'} ${path.fullPath} (${path.pathType}) - items: ${path.itemCount || 0}`);
        });
        
        // Count directories vs files
        const dirs = disregardfiatPaths.filter(p => p.pathType === 'directory');
        const files = disregardfiatPaths.filter(p => p.pathType === 'file');
        console.log(`\\n  📂 Directories: ${dirs.length}`);
        console.log(`  📄 Files: ${files.length}`);
      } else {
        console.log('❌ No disregardfiat paths found');
        
        // Show sample paths from other users
        console.log('\\n📄 Sample paths from other users:');
        pathResult.paths.slice(0, 10).forEach(path => {
          console.log(`  ${path.pathType === 'directory' ? '📂' : '📄'} ${path.fullPath} (owner: ${path.owner?.username || 'unknown'})`);
        });
      }
      
    } else {
      console.log('❌ No paths found in database');
    }
    
    // Query for all contracts (we'll filter afterwards)
    const contractQuery = `{
      contracts(func: type(StorageContract)) {
        id
        fileCount
        owner { username }
        purchaser { username }
      }
    }`;
    
    try {
      const contractResult = await network.dgraphClient.query(contractQuery);
      console.log('\\n📋 All contracts in database:');
      
      if (contractResult.contracts && contractResult.contracts.length > 0) {
        // Filter for disregardfiat contracts
        const disregardfiatContracts = contractResult.contracts.filter(contract => 
          (contract.owner && contract.owner.username === 'disregardfiat') ||
          (contract.purchaser && contract.purchaser.username === 'disregardfiat')
        );
        
        console.log(`\\n📊 Total contracts in database: ${contractResult.contracts.length}`);
        console.log(`📜 Disregardfiat contracts: ${disregardfiatContracts.length}`);
        
        if (disregardfiatContracts.length > 0) {
          console.log('\\n📋 Disregardfiat contracts:');
          disregardfiatContracts.forEach(contract => {
            const owner = contract.owner?.username || 'unknown';
            const purchaser = contract.purchaser?.username || 'unknown';
            console.log(`  📜 ${contract.id} - files: ${contract.fileCount || 0} (owner: ${owner}, purchaser: ${purchaser})`);
          });
        } else {
          console.log('❌ No disregardfiat contracts found');
          
          // Show sample contracts
          console.log('\\n📄 Sample contracts from other users:');
          contractResult.contracts.slice(0, 5).forEach(contract => {
            const owner = contract.owner?.username || 'unknown';
            console.log(`  📜 ${contract.id} (owner: ${owner})`);
          });
        }
      } else {
        console.log('❌ No contracts found in database');
      }
    } catch (error) {
      console.log('⚠️ Contract query failed:', error.message);
    }
    
    // Query for contract files
    const fileQuery = `{
      files(func: type(ContractFile)) {
        cid
        name
        path
        flags
      }
    }`;
    
    const fileResult = await network.dgraphClient.query(fileQuery);
    console.log(`\\n📄 Total contract files: ${fileResult.files?.length || 0}`);
    if (fileResult.files?.length > 0) {
      console.log('  Sample files:');
      fileResult.files.slice(0, 5).forEach(file => {
        console.log(`    📎 ${file.name} at ${file.path} (flags: ${file.flags || 0})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
  
  process.exit(0);
}

debugPaths();