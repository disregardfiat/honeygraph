# Global Account Uniqueness Fix

## Problem Statement

In the multi-tenant Honeygraph setup, accounts should be globally unique across ALL networks/prefixes. The principle is:
- `disregardfiat` from one prefix is `disregardfiat` from any prefix
- Each username should exist only once in the entire system

## Issues Fixed

### 1. Account Deduplication
The original implementation was creating duplicate accounts because:
- Each network had its own namespace context
- Account queries were network-scoped
- Processing contracts individually broke batch deduplication

### 2. Path Ownership
Paths were being owned by orphaned nodes instead of Account nodes because:
- Temporary UIDs were being resolved differently per transaction
- Account lookups weren't finding existing global accounts

## Changes Made

### 1. Data Transformer (`lib/data-transformer.js`)

Updated `ensureAccount` method to query globally:
```javascript
// Query database for existing account across ALL namespaces
// Accounts are global - a username exists only once in the entire system
const query = `{ 
  account(func: eq(username, "${username}")) @filter(type(Account)) { 
    uid 
  } 
}`;
// Use global query for accounts - they exist across all networks
const result = await (this.dgraph.queryGlobal ? 
  this.dgraph.queryGlobal(query) : 
  this.dgraph.query(query));
```

### 2. Dgraph Client (`lib/dgraph-client.js`)

Added `queryGlobal` method for cross-namespace queries:
```javascript
// Global query without namespace restrictions (for accounts)
async queryGlobal(query, variables = {}) {
  const txn = this.client.newTxn();
  try {
    // Do not add namespace prefixes - query across all data
    const result = await txn.queryWithVars(query, variables);
    return result.getJson();
  } finally {
    await txn.discard();
  }
}
```

The existing namespace logic already prevents Account types from being prefixed.

### 3. Init Script (`scripts/init-spk-testnet.js`)

Changed contract processing to batch by user:
```javascript
// Process all user contracts together
const userOperations = [];
for (const [contractId, contractData] of Object.entries(userContracts)) {
  userOperations.push({
    type: 'put',
    path: ['contract', username, contractId],
    data: contractData,
    blockNum: stateData.state.stats?.block_num || 0,
    timestamp: Date.now()
  });
}

// Process all user operations together
const mutations = await transformer.transformOperations(userOperations, blockInfo);
```

This ensures that:
- All contracts for a user are processed in the same transaction
- Account deduplication works correctly within the batch
- Path-file associations are created properly

## How It Works

1. **Account Creation**: When creating/referencing an account, the system:
   - First checks the current batch mutations
   - Then checks the global account cache
   - Finally queries Dgraph globally (across all namespaces)
   - Creates the account only if it doesn't exist anywhere

2. **Namespace Handling**: The DgraphClient:
   - Never prefixes Account or Path types
   - Account usernames remain global
   - Other data types get namespace prefixes as needed

3. **Batch Processing**: The init script:
   - Groups all operations for a user together
   - Commits them in a single transaction
   - Maintains referential integrity

## Testing

After reinstalling with these changes:
1. Accounts should be unique across the system
2. Filesystem should show files properly
3. No duplicate account entries

```bash
# Verify with:
curl http://localhost:3030/fs/disregardfiat/
# Should show files in directories, not empty
```

## Benefits

1. **True Multi-Tenancy**: Users own their data globally
2. **Simplified Queries**: No need to search across namespaces for users
3. **Better Performance**: Fewer duplicate accounts = smaller database
4. **Consistent Experience**: Same username works across all networks