#!/usr/bin/env node

import { createNetworkManager } from './lib/network-manager.js';

async function debugSpecificFile() {
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
    
    console.log('🔍 Debugging specific NFTs/Resources files...\n');
    
    // Query for specific files in NFTs/Resources
    const fileQuery = `{
      paths(func: eq(fullPath, "/NFTs/Resources/bees-set-logo"), first: 3) {
        fullPath
        pathName
        pathType
        owner { username }
        currentFile {
          cid
          name
          contract {
            id
            blockNumber
          }
        }
      }
    }`;
    
    const result = await network.dgraphClient.query(fileQuery);
    console.log('📄 bees-set-logo file paths:', JSON.stringify(result.paths, null, 2));
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
  
  process.exit(0);
}

debugSpecificFile();