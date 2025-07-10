import dgraph from 'dgraph-js';
import grpc from '@grpc/grpc-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function initializeSchema() {
  const dgraphUrl = process.env.DGRAPH_URL || 'http://localhost:9080';
  const grpcUrl = dgraphUrl.replace(/^https?:\/\//, '');
  
  console.log(`Connecting to Dgraph at ${dgraphUrl}...`);
  
  const clientStub = new dgraph.DgraphClientStub(
    grpcUrl,
    grpc.credentials.createInsecure()
  );
  
  const client = new dgraph.DgraphClient(clientStub);
  
  try {
    // Drop all data (optional - comment out in production)
    if (process.env.DROP_ALL === 'true') {
      console.log('Dropping all data...');
      const op = new dgraph.Operation();
      op.setDropAll(true);
      await client.alter(op);
    }
    
    // Read schema
    console.log('Reading schema...');
    const schema = readFileSync(
      join(__dirname, '../schema/schema.dgraph'), 
      'utf8'
    );
    
    // Apply schema
    console.log('Applying schema...');
    const schemaOp = new dgraph.Operation();
    schemaOp.setSchema(schema);
    await client.alter(schemaOp);
    
    // Create initial data
    console.log('Creating initial fork...');
    const txn = client.newTxn();
    
    const initialData = {
      uid: '_:main',
      'dgraph.type': 'Fork',
      'fork.id': 'main',
      'fork.parentFork': '',
      'fork.branchBlock': 0,
      'fork.tipBlock': 0,
      'fork.isActive': true,
      'fork.consensusScore': 1.0
    };
    
    const mutation = new dgraph.Mutation();
    mutation.setSetJson(initialData);
    await txn.mutate(mutation);
    await txn.commit();
    
    console.log('Schema initialization complete!');
    
    // Test query
    console.log('\nTesting query...');
    const query = `{
      forks(func: type(Fork)) {
        fork.id
        fork.isActive
        fork.tipBlock
      }
    }`;
    
    const response = await client.newTxn().query(query);
    console.log('Query result:', JSON.stringify(response.getJson(), null, 2));
    
  } catch (error) {
    console.error('Schema initialization failed:', error.message);
    process.exit(1);
  } finally {
    clientStub.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initializeSchema();
}

export { initializeSchema };