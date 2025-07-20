#!/usr/bin/env node

import fs from 'fs';

async function debugFileDuplicates() {
  const stateData = JSON.parse(fs.readFileSync('spk-state-2025-01-17.json', 'utf8'));
  const contracts = stateData.state.contract;
  let fileOccurrences = new Map();

  for (const [username, userContracts] of Object.entries(contracts)) {
    for (const [contractId, contractData] of Object.entries(userContracts)) {
      if (contractData.df) {
        for (const cid of Object.keys(contractData.df)) {
          if (!fileOccurrences.has(cid)) {
            fileOccurrences.set(cid, []);
          }
          fileOccurrences.get(cid).push({username, contractId});
        }
      }
    }
  }

  // Find files that appear in multiple contracts
  const duplicateFiles = [];
  for (const [cid, contracts] of fileOccurrences.entries()) {
    if (contracts.length > 1) {
      duplicateFiles.push({cid, contracts});
    }
  }

  console.log(`Found ${duplicateFiles.length} files that appear in multiple contracts`);
  if (duplicateFiles.length > 0) {
    console.log('First few examples:');
    duplicateFiles.slice(0, 3).forEach(file => {
      console.log(`CID: ${file.cid}`);
      console.log(`Contracts: ${file.contracts.map(c => `${c.username}:${c.contractId}`).join(', ')}`);
      console.log('---');
    });
  }
  
  // Check the specific file we've been debugging
  const targetCID = "Qma1aE2ntCwMw5pAZo3cCYCmMZ4byVvyGDbK22HiH92WN7";
  if (fileOccurrences.has(targetCID)) {
    console.log(`\\nTarget file ${targetCID} appears in:`);
    fileOccurrences.get(targetCID).forEach(contract => {
      console.log(`  ${contract.username}:${contract.contractId}`);
    });
  }
}

debugFileDuplicates();