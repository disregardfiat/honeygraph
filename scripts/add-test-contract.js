import { DgraphClient } from '../lib/dgraph-client.js';
import { createDataTransformer } from '../lib/data-transformer.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('test-script');

const dgraphClient = new DgraphClient({
  url: process.env.DGRAPH_URL || 'http://localhost:9080',
  logger
});

const transformer = createDataTransformer(dgraphClient);

// Create test contract with files that have different flags
const testState = {
  contract: {
    'disregardfiat:1:123-abc': {
      f: 'disregardfiat',
      a: 30000,
      b: 'broker1',
      c: 3, // status: active
      p: 3,
      r: 0,
      u: 1000,
      v: 1,
      e: '999999:QmTest',
      m: '1|Documents|Videos,file1,txt.1,,0--,file2,jpg.3,QmThumb1,0--,thumb1,jpg.3,,2--,file3,mp4.4,,0--,thumb2,jpg.4,QmThumb2,2--',
      df: {
        'QmFile1': 1024,
        'QmFile2': 2048,
        'QmThumb1': 512,
        'QmFile3': 4096,
        'QmThumb2': 256
      },
      n: {
        1: 'node1',
        2: 'node2'
      }
    }
  }
};

async function addTestData() {
  try {
    console.log('Transforming test data...');
    
    // Create mutations structure
    const mutations = {
      accounts: new Map(),
      contracts: new Map(),
      files: new Map(),
      other: []
    };
    
    // Transform the contract
    for (const [contractId, contractData] of Object.entries(testState.contract)) {
      transformer.transformContract(['contract', contractId], contractData, mutations);
    }
    
    console.log('Contracts created:', mutations.contracts.size);
    console.log('Files created:', mutations.files.size);
    for (const [id, file] of mutations.files) {
      console.log(`- ${file.name} (flags: ${file.flags})`);
    }
    
    // Convert mutations to Dgraph format
    const dgraphMutations = {
      setNquads: []
    };
    
    // Add accounts
    for (const [username, account] of mutations.accounts) {
      dgraphMutations.setNquads.push({
        ...account,
        uid: `_:account_${username}`
      });
    }
    
    // Add contracts
    for (const [id, contract] of mutations.contracts) {
      dgraphMutations.setNquads.push(contract);
    }
    
    // Add files
    for (const [id, file] of mutations.files) {
      dgraphMutations.setNquads.push(file);
    }
    
    // Add other mutations
    dgraphMutations.setNquads.push(...mutations.other);
    
    console.log('\nApplying mutations to Dgraph...');
    console.log('Total mutations:', dgraphMutations.setNquads.length);
    
    // Apply mutations using writeOperation
    await dgraphClient.writeOperation(dgraphMutations.setNquads);
    
    console.log('Test data added successfully!');
    
    // Query to verify
    const query = `{
      contracts(func: type(StorageContract)) @filter(eq(purchaser.username, "disregardfiat")) {
        id
        fileCount
        metadata {
          rawMetadata
        }
        files {
          name
          flags
          path
        }
      }
    }`;
    
    const txn = dgraphClient.client.newTxn();
    const res = await txn.query(query);
    const result = res.getJson();
    console.log('\nVerification query result:', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('Error adding test data:', error);
  } finally {
    await dgraphClient.close();
  }
}

addTestData();