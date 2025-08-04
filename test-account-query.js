import { DgraphClient } from './lib/dgraph-client.js';
import { createLogger } from './lib/logger.js';

const logger = createLogger('test-query');
const dgraphClient = new DgraphClient({
  url: process.env.DGRAPH_URL || 'http://localhost:9080',
  logger
});

async function main() {
  try {
    // Check if dlux-io account exists
    const query = `
      {
        accounts(func: has(Account.username), first: 10) {
          uid
          username: Account.username
        }
        
        dluxAccount(func: eq(Account.username, "dlux-io")) {
          uid
          username: Account.username
          contractsStoring {
            uid
            id
          }
        }
      }
    `;
    
    const txn = dgraphClient.client.newTxn();
    const result = await txn.query(query);
    const data = result.getJson();
    
    console.log('Sample accounts:', data.accounts);
    console.log('\ndlux-io account:', data.dluxAccount);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await dgraphClient.close();
  }
}

main();
