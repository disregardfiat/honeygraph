#!/usr/bin/env node

import { createNetworkManager } from './lib/network-manager.js';

async function debugDgraphResolve() {
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
    
    console.log('🔍 Testing currentFile UID resolution...\n');
    
    // Test the exact query used by filesystem API
    const filesystemQuery = `
      query getAllPaths($userUid: string) {
        paths(func: type(Path)) @filter(uid_in(owner, $userUid) AND eq(fullPath, "/NFTs/Resources/bees-set-logo")) {
          fullPath
          pathName
          pathType
          itemCount
          currentFile {
            cid
            name
            extension
            size
            mimeType
            license
            labels
            thumbnail
            flags
            contract {
              id
              blockNumber
              encryptionData
              storageNodes {
                storageAccount {
                  username
                }
              }
            }
          }
        }
      }
    `;
    
    // Get disregardfiat UID
    const userQuery = `{
      user(func: eq(username, "disregardfiat"), first: 1) {
        uid
        username
      }
    }`;
    
    const userResult = await network.dgraphClient.query(userQuery);
    const userUid = userResult.user[0].uid;
    console.log('User UID:', userUid);
    
    const result = await network.dgraphClient.query(filesystemQuery, { $userUid: userUid });
    console.log('\n📂 Filesystem query result:');
    console.log(JSON.stringify(result.paths, null, 2));
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
  
  process.exit(0);
}

debugDgraphResolve();