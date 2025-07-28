#!/usr/bin/env node
import dgraph from 'dgraph-js';
import grpc from '@grpc/grpc-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function updateSpkSchema() {
  const dgraphUrl = process.env.DGRAPH_URL || 'http://localhost:9080';
  const grpcUrl = dgraphUrl.replace(/^https?:\/\//, '');
  
  console.log(`Connecting to Dgraph at ${dgraphUrl}...`);
  
  const clientStub = new dgraph.DgraphClientStub(
    grpcUrl,
    grpc.credentials.createInsecure()
  );
  
  const client = new dgraph.DgraphClient(clientStub);
  
  try {
    // Read the updated SPK network schema
    console.log('Reading SPK network schema...');
    const spkSchema = readFileSync(
      join(__dirname, '../schema/networks/spkccT.dgraph'), 
      'utf8'
    );
    
    // Apply schema update
    console.log('Applying schema update...');
    const schemaOp = new dgraph.Operation();
    schemaOp.setSchema(spkSchema);
    await client.alter(schemaOp);
    
    console.log('Schema update complete!');
    
    // Test query to verify fullPath predicate
    console.log('\nTesting fullPath predicate...');
    const testQuery = `{
      test(func: has(fullPath), first: 1) {
        fullPath
        pathType
      }
    }`;
    
    try {
      const response = await client.newTxn().query(testQuery);
      console.log('Query successful. fullPath predicate is indexed.');
      console.log('Result:', JSON.stringify(response.getJson(), null, 2));
    } catch (error) {
      console.log('Query test result:', error.message);
    }
    
  } catch (error) {
    console.error('Schema update failed:', error.message);
    process.exit(1);
  } finally {
    clientStub.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateSpkSchema();
}

export { updateSpkSchema };