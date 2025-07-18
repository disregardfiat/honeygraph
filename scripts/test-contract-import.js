#!/usr/bin/env node

import dgraph from 'dgraph-js';
import grpc from '@grpc/grpc-js';
import { createDataTransformer } from '../lib/data-transformer.js';
import { createDgraphClient } from '../lib/dgraph-client.js';
import { createNetworkManager } from '../lib/network-manager.js';

async function testContractImport() {
  console.log('Testing contract import...\n');
  
  // Initialize
  const dgraphClient = createDgraphClient();
  const networkManager = createNetworkManager({
    baseDataPath: './data/honeygraph',
    dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080'
  });
  await networkManager.initialize();
  
  const transformer = createDataTransformer(dgraphClient, networkManager);
  
  // Sample contract data from the state
  const sampleContract = {
    "a": 1024000000,
    "b": "dlux-io",
    "c": 3,
    "df": {
      "QmSfjCEJpmssfLHJEiZeRSQ4rm7sUknqFXdcgydxxAaoez": 1182398
    },
    "e": "97851411:QmXf8pNB236so7CSfiLp4hv4hMgvQKmNJSGpZYd3ZS9LLk",
    "ex": "",
    "f": "actifit-3speak",
    "i": "actifit-3speak:0:86379027-3a16fdafc7b7b2b412fae9b976782ba3c82f8875",
    "m": "#2Xov3zNbHKNvZoALAhr96VpGV7B34ZydDXS6uRFUxniJGYxDJKVwPrRb7GUZDcfgwv43nE48txVu4XtLTy3iWW4o9f1vNAhsTQxHtr5oou8EgczQELY8tP7pTsJhRVBv8Nkw91vkhMiW8Tx7fXYZaX1dxBc1Y2cfZiWf9phngFr6zsDKwtpWKLrxZ4qv3C7YRL8gs4FmFP8oXRPaYLmzBRXgZ@actifit-3speak;#2Xov3zNbHKNvZoALAhr96VpGV7B34ZydDXS6uRFUxniJGYnj73FszJhBKYkiJd8EgFi5qe1sgVyffsiCDWYLX2BhYXoEzqqrSTogAUhFUMwtmSTarZM83gLiefSFu96FdQgyiisKm36RFzDFKUwumokckp1MHrUQjtdY3zymEHkEchyqbWi92RkAwtS7TpYgqVTF4wxMTnNL4m6HJMNDAxvif@mcfarhat,bitmap7327815353772609778,jpg,,1,",
    "n": {
      "1": "dlux-io"
    },
    "nt": "1",
    "p": 4,
    "r": 1154,
    "t": "actifit-3speak",
    "u": 1182398
  };
  
  // Create operation
  const operation = {
    type: 'put',
    path: ['contract', 'actifit-3speak', 'actifit-3speak:0:86379027-3a16fdafc7b7b2b412fae9b976782ba3c82f8875'],
    data: sampleContract,
    blockNum: 0,
    timestamp: Date.now()
  };
  
  // Transform
  console.log('Transforming contract...');
  const mutations = await transformer.transformOperation(operation);
  console.log(`Generated ${mutations.length} mutations\n`);
  console.log('Mutations:', JSON.stringify(mutations, null, 2));
  
  // Import to Dgraph
  console.log('Importing to Dgraph...');
  const txn = dgraphClient.client.newTxn();
  
  try {
    const mu = new dgraph.Mutation();
    mu.setSetJson(mutations);
    await txn.mutate(mu);
    await txn.commit();
    console.log('✓ Import successful!\n');
    
    // Query to verify
    console.log('Verifying import...');
    const query = `{
      contract(func: eq(id, "actifit-3speak:0:86379027-3a16fdafc7b7b2b412fae9b976782ba3c82f8875")) {
        id
        status
        purchaser {
          username
        }
        fileCount
      }
    }`;
    
    const result = await dgraphClient.client.newTxn().query(query);
    console.log('Result:', JSON.stringify(result.getJson(), null, 2));
    
  } catch (error) {
    console.error('Import failed:', error.message);
    console.error('Error details:', error);
  } finally {
    await txn.discard();
  }
  
  process.exit(0);
}

// Run
testContractImport().catch(console.error);