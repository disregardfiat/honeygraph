#!/usr/bin/env node

import { createNetworkManager } from './lib/network-manager.js';

async function debugContractLinks() {
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
    
    console.log('🔍 Debugging contract file relationships...\n');
    
    // Check ContractFile entities
    const fileQuery = `{
      files(func: type(ContractFile), first: 3) {
        cid
        name
        id
        contract {
          id
          blockNumber
        }
      }
    }`;
    
    const fileResult = await network.dgraphClient.query(fileQuery);
    console.log('📄 ContractFile entities:', JSON.stringify(fileResult.files, null, 2));
    
    // Check contracts
    const contractQuery = `{
      contracts(func: type(StorageContract), first: 3) {
        id
        blockNumber
        owner { username }
      }
    }`;
    
    const contractResult = await network.dgraphClient.query(contractQuery);
    console.log('\n📋 StorageContract entities:', JSON.stringify(contractResult.contracts, null, 2));
    
    // Check paths with currentFile relationships
    const pathQuery = `{
      paths(func: eq(fullPath, "/NFTs/Resources/bees-set-logo"), first: 3) {
        fullPath
        pathName
        pathType
        owner { username }
        currentFile {
          cid
          name
          id
          contract {
            id
            blockNumber
          }
        }
      }
    }`;
    
    const pathResult = await network.dgraphClient.query(pathQuery);
    console.log('\n📂 Path -> currentFile -> contract relationships:', JSON.stringify(pathResult.paths, null, 2));
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
  
  process.exit(0);
}

debugContractLinks();