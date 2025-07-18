#!/usr/bin/env node

import { createDataTransformer } from '../lib/data-transformer.js';
import { createDgraphClient } from '../lib/dgraph-client.js';
import { createNetworkManager } from '../lib/network-manager.js';

async function testMetadataParsing() {
  console.log('Testing metadata parsing with disregardfiat contract...\n');
  
  // Sample contract data from disregardfiat
  const contract = {
    "a": 419840000,
    "b": "dlux-io",
    "c": 3,
    "df": {
      "QmNqBFVafpQLgFj8FvRVEKTyGMwmuyxBb85C6sGGNPAxJo": 9510,
      "QmNrykxqWKYZkyHtYLM7keoHVwVgnuCE8yH5xmHotiD5v3": 12474,
      "QmNtnyxRkgL8qQHyvxszYtoibYKi4Ar8xiorHJLjE5qLET": 7706
    },
    "e": "98457468:QmewM4WohqHhq7irmJHKZB87grWoEsnrWiYKDqzzCjyBPm",
    "ex": "disregardfiat:37135:97593445-98457468",
    "f": "disregardfiat",
    "i": "disregardfiat:0:93273146-061aa8e8d79a033ed70e27572c31bba071369582",
    "m": "1|Ragnarok,thumbe4e8-js5gns2x,png.0,,2--,thumbea47-4bx4dl0s,png.0,,2--,thumbdc05-8c0icj7w,png.0,,2--,thumbdcb5-jryrjh20,png.0,,2--,thumbe832-nil2y5bq,png.0,,2--,e832-nil2y5bq,png,QmQG3gWfgz791HkWWLkmTH6xQ1GJwdJXJLp5GqDpX6vDL7,0--,ee28-lpu1nd1c,png,QmcEGzqyq9tjk6pKeDxgFjWW1e8D6SmEnvnrjxbwvwhkET,0--,f973-5zs03o10,png,Qma4qP2WyTWrd7hQtwRt4mBpqi2gtqTgaSEjBUEk6V2VQo,0--",
    "n": {
      "1": "dlux-io"
    },
    "nt": "1",
    "p": 4,
    "r": 1154,
    "t": "disregardfiat",
    "u": 1182398
  };
  
  // Initialize transformer
  const dgraphClient = createDgraphClient();
  const networkManager = createNetworkManager({
    baseDataPath: './data/honeygraph',
    dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080'
  });
  await networkManager.initialize();
  
  const transformer = createDataTransformer(dgraphClient, networkManager);
  
  // Test metadata parsing
  const cids = Object.keys(contract.df);
  console.log('Contract CIDs:', cids);
  console.log('Metadata string:', contract.m);
  console.log('');
  
  const parsedMetadata = transformer.parseMetadataString(contract.m, cids);
  
  console.log('Parsed metadata:');
  console.log('Version:', parsedMetadata.version);
  console.log('Encryption keys:', parsedMetadata.encryptionKeys);
  console.log('Folders:', Array.from(parsedMetadata.folderMap.entries()));
  console.log('');
  
  console.log('Files:');
  for (const [cid, metadata] of parsedMetadata.files.entries()) {
    console.log(`${cid}:`);
    console.log(`  name: ${metadata.name}`);
    console.log(`  ext: ${metadata.ext}`);
    console.log(`  pathIndex: ${metadata.pathIndex}`);
    console.log(`  folder: ${metadata.folder}`);
    console.log(`  fullPath: ${metadata.fullPath}`);
    console.log('');
  }
  
  // Test transforming the contract
  console.log('Testing contract transformation...');
  
  const operation = {
    type: 'put',
    path: ['contract', 'disregardfiat', contract.i],
    data: contract,
    blockNum: 0,
    timestamp: Date.now()
  };
  
  const mutations = await transformer.transformOperation(operation);
  console.log(`Generated ${mutations.length} mutations`);
  
  // Find contract files
  const contractFiles = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
  console.log(`\nContract files (${contractFiles.length}):`);
  contractFiles.forEach(file => {
    console.log(`- ${file.name} (${file.mimeType}) in ${file.path}`);
  });
  
  process.exit(0);
}

testMetadataParsing().catch(console.error);