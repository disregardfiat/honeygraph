# SPK Init Script Fix Documentation

## Problem Summary

When running the SPK testnet initialization script, the following error occurred:
```
{"error":"2 UNKNOWN: strconv.ParseInt: parsing \"0.00\": invalid syntax"}
```

This error was caused by Dgraph attempting to parse float string values as integers due to missing schema definitions.

## Root Causes

1. **Missing NetworkStats Schema**: The `NetworkStats` type and its predicates (`statKey`, `statCategory`, `statValue`) were not defined in the Dgraph schema file.

2. **Type Mismatch**: The data transformer was storing numeric values directly, but the Dgraph schema expected strings for `statValue`.

3. **Contract Expiration Format**: The transformer expected only one format for contract expiration data, but the actual data had multiple formats (timestamps and block:chronId strings).

## Fixes Applied

### 1. Schema Update (schema/schema.dgraph)

Added the missing NetworkStats predicates and type:

```graphql
# NetworkStats predicates - for storing network statistics
statKey: string @index(term) .
statCategory: string @index(term) .
statValue: string .
# blockNumber and timestamp already defined above

# NetworkStats type - represents network statistics and metrics
type NetworkStats {
  statKey
  statCategory
  statValue
  blockNumber
  timestamp
}
```

### 2. Data Transformer Updates (lib/data-transformer.js)

#### Contract Expiration Handling
Updated to handle multiple formats:
```javascript
// Parse expiration field (e.g., "97938326:QmenexSVsQsaKqoDZdeTY8Us2bVyPaNyha1wc2MCRVQvRm" or timestamp)
if (contract.e) {
  if (typeof contract.e === 'string' && contract.e.includes(':')) {
    const [expiresBlock, chronId] = contract.e.split(':');
    dgraphContract.expiresBlock = parseInt(expiresBlock) || 0;
    dgraphContract.expiresChronId = chronId || '';
  } else if (typeof contract.e === 'number') {
    // Handle timestamp format (convert to block number estimate)
    // Assuming ~3 second blocks and using a reference point
    const msPerBlock = 3000;
    const referenceTimestamp = 1721145000000; // July 2024
    const referenceBlock = 96585668;
    const blockDiff = Math.floor((contract.e - referenceTimestamp) / msPerBlock);
    dgraphContract.expiresBlock = referenceBlock + blockDiff;
  } else if (typeof contract.e === 'string') {
    // Try to parse as block number
    dgraphContract.expiresBlock = parseInt(contract.e) || 0;
  }
}
```

#### Stats Value Type Enforcement
Ensured statValue is always stored as a string:
```javascript
// Store value based on type - always as string for Dgraph compatibility
if (typeof data === 'object' && data !== null) {
  stats.statValue = JSON.stringify(data);
} else {
  // Convert to string to match Dgraph schema
  stats.statValue = String(data);
}
```

## Tests Added

### 1. Stats ParseInt Error Test (test/stats-parseint-error.test.js)
- Tests handling of float string values in stats operations
- Verifies numeric values are properly converted
- Ensures blockNumber fields remain as integers

### 2. Init Script Validation Test (test/init-script-validation.test.js)
- Validates schema includes NetworkStats predicates
- Tests contract operations with various data formats
- Verifies VFS operations are handled correctly

### 3. Init Process Integration Test (test/init-process-integration.test.js)
- Simulates the full initialization process
- Tests edge cases and data type compliance
- Ensures all mutations comply with Dgraph schema

## Empty Filesystem Issue

The empty filesystem is not a bug. The filesystem structure is created on-demand when queried through the API, not during data import. VFS operations are stored as "other" data and interpreted when the filesystem API is accessed.

## How to Apply the Fix

1. **Update the schema**:
   ```bash
   # Load the updated schema into Dgraph
   curl -X POST localhost:8080/admin/schema --data-binary @schema/schema.dgraph
   ```

2. **Restart the honeygraph service** to pick up the data transformer changes.

3. **Re-run the initialization** - it should now complete without ParseInt errors.

## Verification

After applying the fix, verify by:

1. Running the test suite:
   ```bash
   npm test -- test/init-script-validation.test.js
   npm test -- test/init-process-integration.test.js
   ```

2. Checking the filesystem API:
   ```bash
   curl http://localhost:3030/fs/disregardfiat/
   ```

3. Querying stats data:
   ```bash
   curl http://localhost:3030/graphql -H "Content-Type: application/json" \
     -d '{"query": "{ queryNetworkStats(first: 10) { statKey statValue blockNumber } }"}'
   ```

## Future Improvements

1. Add schema validation in the init script before importing data
2. Create a pre-flight check that validates data types match schema
3. Add more comprehensive error messages when type mismatches occur
4. Consider creating a schema migration tool for updates