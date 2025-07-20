#!/usr/bin/env node

import { createNetworkManager } from './lib/network-manager.js';

async function debugContractFileDirect() {
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
    
    console.log('🔍 Testing ContractFile entity directly...\n');
    
    // Find the specific ContractFile by CID
    const fileQuery = `{
      file(func: eq(cid, "Qma1aE2ntCwMw5pAZo3cCYCmMZ4byVvyGDbK22HiH92WN7")) {
        uid
        cid
        name
        extension
        size
        mimeType
        flags
        contract {
          uid
          id
          blockNumber
          owner { username }
        }
      }
    }`;
    
    const result = await network.dgraphClient.query(fileQuery);
    console.log('📄 ContractFile by CID:');
    console.log(JSON.stringify(result.file, null, 2));
    
    // Now test if that UID can be resolved with contract
    if (result.file?.[0]?.uid) {
      const uidQuery = `{
        fileByUid(func: uid(${result.file[0].uid})) {
          uid
          cid
          name
          extension
          size
          contract {
            uid
            id
            blockNumber
          }
        }
      }`;
      
      const uidResult = await network.dgraphClient.query(uidQuery);
      console.log('\n📄 Same file queried by UID:');
      console.log(JSON.stringify(uidResult.fileByUid, null, 2));
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
  
  process.exit(0);
}

debugContractFileDirect();