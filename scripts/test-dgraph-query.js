const dgraph = require('dgraph-js');
const grpc = require('@grpc/grpc-js');

async function testQuery() {
  // Create Dgraph client for spkccT_ namespace
  const clientStub = new dgraph.DgraphClientStub(
    'dgraph-alpha:9080',
    grpc.credentials.createInsecure()
  );
  
  const dgraphClient = new dgraph.DgraphClient(clientStub);
  dgraphClient.setSlashEndpoint('spkccT_');
  
  try {
    // Test 1: Simple type query
    console.log('Test 1: Query accounts');
    const query1 = `{
      accounts(func: type(Account), first: 5) {
        username
      }
    }`;
    const txn1 = dgraphClient.newTxn();
    const res1 = await txn1.query(query1);
    console.log('Result:', JSON.stringify(res1.getJson(), null, 2));
    await txn1.discard();
    
    // Test 2: Query with count
    console.log('\nTest 2: Count query');
    const query2 = `{
      totalAccounts(func: type(Account)) {
        count(uid)
      }
    }`;
    const txn2 = dgraphClient.newTxn();
    const res2 = await txn2.query(query2);
    console.log('Result:', JSON.stringify(res2.getJson(), null, 2));
    await txn2.discard();
    
    // Test 3: Contracts with inverse edge
    console.log('\nTest 3: User with contracts');
    const query3 = `{
      user(func: eq(username, "disregardfiat")) {
        username
        contracts: ~purchaser @filter(type(StorageContract)) {
          id
        }
      }
    }`;
    const txn3 = dgraphClient.newTxn();
    const res3 = await txn3.query(query3);
    console.log('Result:', JSON.stringify(res3.getJson(), null, 2));
    await txn3.discard();
    
    // Test 4: Direct contract query
    console.log('\nTest 4: Direct contract query');
    const query4 = `{
      contracts(func: type(StorageContract), first: 5) {
        id
        purchaser {
          username
        }
      }
    }`;
    const txn4 = dgraphClient.newTxn();
    const res4 = await txn4.query(query4);
    console.log('Result:', JSON.stringify(res4.getJson(), null, 2));
    await txn4.discard();
    
  } catch (error) {
    console.error('Query error:', error.message);
    console.error('Details:', error);
  }
}

testQuery();