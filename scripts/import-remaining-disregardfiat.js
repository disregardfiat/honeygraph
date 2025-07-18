#!/usr/bin/env node

// Based on import-disregardfiat.js but for all missing contracts

import fetch from 'node-fetch';
import dgraph from 'dgraph-js';
import grpc from '@grpc/grpc-js';

console.log('🔄 Import all remaining disregardfiat contracts');

// Create Dgraph client using same approach as working script
const clientStub = new dgraph.DgraphClientStub('localhost:9080', grpc.credentials.createInsecure());
const dgraphClient = new dgraph.DgraphClient(clientStub);

// Query which contracts already exist
console.log('📊 Checking existing contracts...');
const checkQuery = `{
  existing(func: eq(owner.username, "disregardfiat")) {
    id
  }
}`;

let existingContracts = [];
try {
  const txn = dgraphClient.newTxn();
  const res = await txn.query(checkQuery);
  await txn.discard();
  existingContracts = res.getJson().existing.map(c => c.id);
  console.log(`Found ${existingContracts.length} existing contracts`);
} catch (error) {
  console.log(`Error checking existing: ${error.message}`);
}

// Fetch state
console.log('📥 Fetching state...');
const response = await fetch('https://spktest.dlux.io/state');
const stateData = await response.json();
const contractData = stateData.state.contract.disregardfiat;

console.log(`Found ${Object.keys(contractData).length} total contracts in state`);

// Find missing contracts
const allContractIds = Object.keys(contractData);
const missingContracts = allContractIds.filter(id => !existingContracts.includes(id));

console.log(`Missing contracts: ${missingContracts.length}`);
if (missingContracts.length > 0) {
  console.log('Missing contract IDs:');
  missingContracts.forEach(id => console.log(`  ${id}`));
}

if (missingContracts.length === 0) {
  console.log('✅ All contracts already imported');
  process.exit(0);
}

// Import missing contracts
console.log(`🔄 Importing ${missingContracts.length} missing contracts...`);

const mutations = [];

for (const contractId of missingContracts) {
  const contract = contractData[contractId];
  
  console.log(`Processing ${contractId}...`);
  
  // Create contract mutation
  const contractMutation = {
    'dgraph.type': 'StorageContract',
    id: contractId,
    status: contract.c,
    fileCount: contract.df ? Object.keys(contract.df).length : 0,
    purchaser: {
      'dgraph.type': 'Account',
      username: contract.f
    },
    owner: {
      'dgraph.type': 'Account', 
      username: contract.t || contract.f  // Use owner (t) if available, fallback to purchaser (f)
    }
  };
  
  mutations.push(contractMutation);
  
  // Add files if they exist
  if (contract.df && contract.m) {
    const files = Object.keys(contract.df);
    const metadataStr = contract.m;
    console.log(`  Processing ${files.length} files...`);
    
    // Parse metadata - format: contractflag|folder,name1,ext.folderindex,thumb,flags-license-labels,name2,ext.folderindex,thumb,flags-license-labels...
    const parts = metadataStr.split('|');
    if (parts.length >= 2) {
      const folderName = parts[1];
      const fileMetadata = parts.slice(2).join(',').split(',');
      
      let fileIndex = 0;
      for (let i = 0; i < fileMetadata.length && fileIndex < files.length; i += 5) {
        const fileName = fileMetadata[i];
        const extension = fileMetadata[i + 1] ? fileMetadata[i + 1].split('.')[0] : '';
        const flagsStr = fileMetadata[i + 4] || '0';
        const flags = parseInt(flagsStr.split('-')[0]) || 0;
        
        if (fileName) {
          const cid = files[fileIndex];
          const size = contract.df[cid];
          
          const fileMutation = {
            'dgraph.type': 'ContractFile',
            cid,
            name: fileName,
            extension,
            size,
            path: folderName ? `/${folderName}` : '/',
            flags,
            contract: {
              id: contractId
            }
          };
          
          mutations.push(fileMutation);
          
          // Only create path if bitflag 2 is NOT set (no thumbnails in folder structure)
          if (!(flags & 2)) {
            console.log(`  Creating path /${folderName}/${fileName}`);
            
            // Create directory path if needed
            if (folderName) {
              const dirPath = {
                'dgraph.type': 'Path',
                fullPath: `/${folderName}`,
                pathType: 'directory',
                owner: {
                  username: contract.t || contract.f
                }
              };
              mutations.push(dirPath);
            }
            
            // Create file path
            const filePath = folderName ? `/${folderName}/${fileName}` : `/${fileName}`;
            const filePathMutation = {
              'dgraph.type': 'Path',
              fullPath: filePath,
              pathType: 'file',
              owner: {
                username: contract.t || contract.f
              },
              file: {
                cid
              }
            };
            mutations.push(filePathMutation);
          } else {
            console.log(`  Skipping path for ${fileName} (flag ${flags} has bit 2 set - thumbnail)`);
          }
          
          fileIndex++;
        }
      }
    }
  }
}

console.log(`Generated ${mutations.length} mutations`);

// Import
if (mutations.length > 0) {
  console.log('💾 Importing to database...');
  const txn = dgraphClient.newTxn();
  try {
    const mu = new dgraph.Mutation();
    mu.setSetJson(mutations);
    await txn.mutate(mu);
    await txn.commit();
    console.log('✅ Import successful');
  } catch (error) {
    console.error('Import error:', error);
    await txn.discard();
  }
}

console.log('✅ Import complete');