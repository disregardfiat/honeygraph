# Honeygraph Operation Filtering Guide

## Overview

This document describes which operations from honeycomb should be excluded from honeygraph replication to reduce unnecessary data storage and improve query performance.

## Operations to Exclude

### 1. Witness Operations
- **Path**: `["witness", 0-99]`
- **Purpose**: Internal L2 tracking of witness nodes for price feeds
- **Storage**: Rolling window of last 100 witnesses (blockNum % 100)
- **Why Exclude**: This is internal consensus data not needed for application queries

### 2. Random Operations  
- **Path**: `["rand", 0-199]`
- **Purpose**: Deterministic random number generation for the L2
- **Storage**: Rolling window of last 200 random values (blockNum % 200)
- **Why Exclude**: Internal consensus mechanism, not application data

### 3. IPFS Operations
- **Path**: `["IPFS", cid-reversed]`
- **Purpose**: Maps reversed CIDs to internal lottery and contract pointers
- **Example**: `["IPFS", "L3bTD5UQsKtUuzU2jUuzKtusbU2sBmUQ"]` → `"owner,contractId"`
- **Why Exclude**: Internal lookup table for storage mechanics, redundant with contract data

### 4. Contract Pointers
- **Path**: `["cPointers", contractID]`
- **Purpose**: Maps contract IDs to internal contract pointers
- **Example**: `["cPointers", "alice:0:12345-abc"]` → pointer data
- **Why Exclude**: Internal reference system, actual contract data is stored elsewhere

### 5. Chain Operations
- **Path**: `["chain"]`
- **Purpose**: Internal blockchain state and configuration
- **Example**: `["chain"]` → blockchain metadata, config, state info
- **Why Exclude**: Internal blockchain mechanics, not application data

### 6. Internal Consensus Operations
- **Path**: Various temporary consensus paths
- **Examples**: 
  - `chrono` - Scheduled operations
  - `forks` - Fork management
  - `temp` - Temporary data
  - `validation` - Validation state
- **Why Exclude**: Transient data only needed during consensus

## Operations to Transform

Some operations need transformation rather than direct replication. See ACCOUNT_DATA_PATHS.md for complete account transformations.

### Key Transformations:

1. **BROCA Balances** (`broca[account]`):
   - Original: `"milliBRC,Base64BlockNumber"`
   - Transform: Parse into brocaAmount and brocaLastUpdate fields

2. **Power Grants** (`granted` and `granting`):
   - Original: Nested objects with special 't' key for totals
   - Transform: Create PowerGrant relationships and track totals

3. **Service Registrations**:
   - `service[type][account]`: CSV of service IDs → ServiceEndpoint
   - `services[account][type][serviceID]`: Service details → Service entities

4. **Storage Contracts** (`contract[account]`):
   - Original: Complex nested structure with encoded metadata
   - Transform: Expand into full StorageContract entities with files, nodes, and metadata

5. **Node Market** (`market.node[account]`):
   - Original: Compact object with bid info and validation codes
   - Transform: NodeMarketBid entity with performance metrics

## Implementation

To filter operations in the data transformer:

```javascript
// In data-transformer.js
transformOperationInternal(op, blockInfo, mutations) {
  const { type, path, data } = op;
  
  // Skip operations that should not be replicated
  if (this.shouldSkipOperation(path)) {
    logger.debug('Skipping filtered operation', { path: path.join('.') });
    return;
  }
  
  // Continue with normal processing...
}

shouldSkipOperation(path) {
  // Skip witness operations (internal price tracking)
  if (path[0] === 'witness') {
    return true;
  }
  
  // Skip rand operations (internal randomness)
  if (path[0] === 'rand') {
    return true;
  }
  
  // Skip IPFS operations (cid-reversed -> internal lottery and contract pointer)
  if (path[0] === 'IPFS') {
    return true;
  }
  
  // Skip cPointers operations (contractID -> contract pointers)
  if (path[0] === 'cPointers') {
    return true;
  }
  
  // Skip chain operations (internal blockchain state)
  if (path[0] === 'chain') {
    return true;
  }
  
  // Skip other internal consensus paths
  const internalPaths = [
    'chrono',      // Scheduled operations (internal)
    'forks',       // Fork management (internal)
    'temp',        // Temporary data
    'validation',  // Validation state (internal)
  ];
  
  if (internalPaths.includes(path[0])) {
    return true;
  }
  
  return false;
}
```

## Benefits

1. **Reduced Storage**: Eliminates unnecessary historical data
2. **Better Performance**: Fewer operations to process and index
3. **Cleaner Schema**: Focus on application-relevant data
4. **Lower Costs**: Less data to replicate and store

## Monitoring

Track filtered operations to ensure important data isn't accidentally excluded:

```javascript
// Add metrics
this.metrics.operationsFiltered.inc({
  path: path[0],
  reason: 'internal_consensus'
});
```