#!/usr/bin/env node

// Direct test of VFS query without running the full server

import dgraph from 'dgraph-js';
import grpc from '@grpc/grpc-js';

async function testVFS() {
  const dgraphUrl = 'localhost:9080';
  
  console.log(`Connecting to DGraph at ${dgraphUrl}...`);
  
  const clientStub = new dgraph.DgraphClientStub(
    dgraphUrl,
    grpc.credentials.createInsecure()
  );
  
  const client = new dgraph.DgraphClient(clientStub);
  
  // Query for paths
  const query = `
    query getDirectory($username: string, $directoryPath: string) {
      user as var(func: eq(username, $username), first: 1)
      
      paths(func: type(Path), first: 100) @filter(uid_in(owner, uid(user)) AND eq(fullPath, $directoryPath)) {
        fullPath
        pathName
        pathType
        itemCount
        files(first: 50) {
          uid
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
  
  const vars = { 
    $username: 'disregardfiat',
    $directoryPath: '/NFTs'
  };
  
  try {
    const txn = client.newTxn();
    const response = await txn.queryWithVars(query, vars);
    const result = response.getJson();
    
    console.log('\nQuery result:', JSON.stringify(result, null, 2));
    
    // Check if we have the NFTs path
    if (result.paths && result.paths.length > 0) {
      const nftsPath = result.paths[0];
      console.log(`\nFound ${nftsPath.files?.length || 0} files in /NFTs`);
      
      // Build VFS output
      const output = {
        path: '/NFTs',
        username: 'disregardfiat',
        type: 'directory',
        contents: []
      };
      
      // Add files
      if (nftsPath.files) {
        for (const file of nftsPath.files) {
          if ((file.flags || 0) & 2) continue; // Skip thumbnails
          
          const contract = file.contract || {};
          output.contents.push({
            name: file.name,
            type: 'file',
            cid: file.cid,
            extension: file.extension || 'nft',
            size: file.size,
            mimeType: file.mimeType || 'application/nft',
            license: file.license || '',
            labels: file.labels || '',
            thumbnail: file.thumbnail || '',
            contract: {
              id: contract.id || '',
              blockNumber: contract.blockNumber || 0,
              encryptionData: contract.encryptionData || null,
              storageNodeCount: contract.storageNodes?.length || 1,
              storageNodes: contract.storageNodes?.map(n => n.storageAccount?.username || 'dlux-io') || ['dlux-io']
            },
            metadata: {
              encrypted: false,
              autoRenew: true
            }
          });
        }
      }
      
      console.log('\nVFS Output:');
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log('\nNo paths found for user disregardfiat');
      
      // Try a simpler query
      const simpleQuery = `
        query {
          accounts(func: eq(username, "disregardfiat"), first: 1) {
            username
            contracts(first: 10) {
              id
              fileCount
            }
          }
        }
      `;
      
      const simpleResponse = await txn.queryWithVars(simpleQuery, {});
      const simpleResult = simpleResponse.getJson();
      console.log('\nSimple query result:', JSON.stringify(simpleResult, null, 2));
    }
    
  } catch (error) {
    console.error('Query failed:', error);
  }
}

testVFS().catch(console.error);