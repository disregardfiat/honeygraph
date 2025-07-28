# Filesystem Population Fix

## Problem Summary

After running the SPK testnet initialization, the filesystem API shows empty directories with no files, even though:
- 378 ContractFile objects were created
- 25 Path objects were created  
- 24 Paths have files attached

## Root Causes Identified

### 1. Account Deduplication Failure
- The database has 33 duplicate Account entries for users like "disregardfiat"
- This happened because the init script processes contracts individually, committing after each one
- The `ensureAccount` method's deduplication logic fails across transaction boundaries

### 2. Path Owner References Are Broken
- Path objects are owned by non-Account nodes (e.g., `0x1de2`)
- These are orphaned blank nodes created during import
- The filesystem query filters paths by Account ownership: `@filter(uid_in(owner, $userUid))`
- Since paths aren't owned by Account nodes, the query returns empty results

### 3. Init Script Processing Issue
The init script processes contracts like this:
```javascript
for (const [username, userContracts] of Object.entries(stateData.state.contract)) {
  for (const [contractId, contractData] of Object.entries(userContracts)) {
    // Process single contract
    const mutations = await transformer.transformOperation(operation);
    // Commit immediately - breaks deduplication!
    await txn.commit();
  }
}
```

## Solution

### Option 1: Fix the Data (Post-Import)

Create a data cleanup script that:
1. Deduplicates Account nodes (keep first, update references)
2. Updates Path owner references to point to the correct Account UIDs
3. Ensures all file-path relationships are correct

### Option 2: Fix the Import Process

Modify the init script to:
1. Process contracts in batches instead of individually
2. Use a single transaction for related data
3. Ensure account deduplication works across the entire import

### Option 3: Fix the Filesystem Query

Modify the filesystem API to:
1. Handle multiple account UIDs when querying
2. Use a more robust path ownership query
3. Fall back to checking contract ownership if path ownership fails

## Recommended Fix

**Option 2 is the best long-term solution**, but **Option 1 provides an immediate fix** for the current data.

### Implementation for Option 1 (Data Cleanup Script)

```javascript
// 1. Find all duplicate accounts
const duplicatesQuery = `{
  accounts(func: type(Account)) @groupby(username) {
    count(uid)
    username
  }
}`;

// 2. For each duplicate, keep the first UID and update all references
const deduplicateAccount = async (username) => {
  // Get all UIDs for this username
  const query = `{ 
    accounts(func: eq(username, "${username}")) @filter(type(Account)) { 
      uid 
    } 
  }`;
  
  const result = await dgraph.query(query);
  if (result.accounts.length <= 1) return;
  
  const [keepUid, ...removeUids] = result.accounts.map(a => a.uid);
  
  // Update all Path objects owned by duplicate accounts
  for (const oldUid of removeUids) {
    const updateQuery = `{
      paths as var(func: type(Path)) @filter(uid_in(owner, "${oldUid}"))
    }`;
    
    const mutation = new dgraph.Mutation();
    mutation.setSetNquads(`
      uid(paths) <owner> <${keepUid}> .
    `);
    mutation.setDelNquads(`
      uid(paths) <owner> <${oldUid}> .
    `);
    
    await dgraph.mutate(mutation);
    
    // Delete the duplicate account
    mutation.setDelNquads(`<${oldUid}> * * .`);
  }
};
```

### Implementation for Option 2 (Fix Import)

Modify `init-spk-testnet.js`:

```javascript
// Process contracts in batches by user
const batchSize = 100;
let batch = [];

for (const [username, userContracts] of Object.entries(stateData.state.contract)) {
  // Collect all operations for this user
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
  batch.push(...mutations);
  
  // Commit when batch is full
  if (batch.length >= batchSize) {
    await commitBatch(batch);
    batch = [];
  }
}

// Commit remaining
if (batch.length > 0) {
  await commitBatch(batch);
}
```

## Testing

After applying the fix, verify with:

```bash
# Check account deduplication
curl http://localhost:3030/fs/disregardfiat/

# Should return files in directories, not empty
```

## Prevention

1. Always process related data in the same transaction
2. Use batch operations for imports
3. Add integration tests that verify filesystem population
4. Monitor for duplicate accounts during import