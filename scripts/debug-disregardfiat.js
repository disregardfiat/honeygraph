#!/usr/bin/env node

import fetch from 'node-fetch';
import { createDataTransformer } from '../lib/data-transformer.js';
import { createDgraphClient } from '../lib/dgraph-client.js';
import { createNetworkManager } from '../lib/network-manager.js';

console.log('🔍 Debug disregardfiat contracts');

// Initialize Dgraph connection and network manager
const dgraphClient = createDgraphClient();
const networkManager = createNetworkManager({
  baseDataPath: './data/honeygraph',
  dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080'
});
await networkManager.initialize();

const network = networkManager.getNetwork();
console.log(`Using network: ${network.namespace}`);

// Create data transformer
const transformer = createDataTransformer(networkManager.getDgraphClient(), networkManager);

// Fetch state
console.log('📥 Fetching state...');
const response = await fetch('https://spktest.dlux.io/state');
const data = await response.json();

const contractData = data.state.contract.disregardfiat;
console.log(`Found ${Object.keys(contractData).length} disregardfiat contracts`);

// Process just disregardfiat contracts
const operations = [];
for (const [contractId, contract] of Object.entries(contractData)) {
  operations.push({
    type: 'put',
    path: ['contract', 'disregardfiat', contractId],
    data: contract
  });
}

console.log(`Created ${operations.length} operations for disregardfiat contracts`);

// Transform operations
console.log('🔄 Transforming operations...');
const blockInfo = { blockNum: 12345, timestamp: Date.now() };
const mutations = await transformer.transformOperations(operations, blockInfo);

console.log(`Generated ${mutations.length} mutations`);

// Count different types
const contracts = mutations.filter(m => m['dgraph.type'] === 'StorageContract');
const files = mutations.filter(m => m['dgraph.type'] === 'ContractFile');
const paths = mutations.filter(m => m['dgraph.type'] === 'Path');

console.log(`  Contracts: ${contracts.length}`);
console.log(`  Files: ${files.length}`);
console.log(`  Paths: ${paths.length}`);

// Show contract details
console.log('\nContract details:');
contracts.forEach(contract => {
  console.log(`  ${contract.id}: ${contract.fileCount} files`);
});

// Show file details
console.log('\nFile details:');
files.slice(0, 5).forEach(file => {
  console.log(`  ${file.cid}: ${file.name}.${file.extension} (flags: ${file.flags})`);
});

// Show path details
console.log('\nPath details:');
paths.slice(0, 10).forEach(path => {
  console.log(`  ${path.fullPath} (${path.pathType})`);
});

// Count files by flags
const filesByFlags = {};
files.forEach(file => {
  const flags = file.flags || 0;
  filesByFlags[flags] = (filesByFlags[flags] || 0) + 1;
});

console.log('\nFiles by flags:');
Object.entries(filesByFlags).forEach(([flags, count]) => {
  console.log(`  Flag ${flags}: ${count} files${flags == 2 ? ' (thumbnails - should not create paths)' : ''}`);
});

// Check bitflag filtering
const filesWithFlag2 = files.filter(f => (f.flags & 2) === 2);
const pathsForFlag2Files = paths.filter(p => {
  return p.pathType === 'file' && filesWithFlag2.some(f => p.fullPath.includes(f.name));
});

console.log(`\nBitflag analysis:`);
console.log(`  Files with flag 2 (thumbnails): ${filesWithFlag2.length}`);
console.log(`  Paths for flag 2 files: ${pathsForFlag2Files.length} (should be 0)`);

if (pathsForFlag2Files.length > 0) {
  console.log('  ERROR: Found paths for files with flag 2!');
  pathsForFlag2Files.forEach(path => {
    console.log(`    ${path.fullPath}`);
  });
} else {
  console.log('  ✅ Bitflag filtering working correctly');
}

// Save mutations for potential manual import
console.log('\n💾 Saving mutations to file...');
const fs = await import('fs');
await fs.promises.writeFile(
  '/home/jr/dlux/honeygraph/debug-mutations.json',
  JSON.stringify(mutations, null, 2)
);

console.log('✅ Debug complete. Check debug-mutations.json for full mutation data.');