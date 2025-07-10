# Honeygraph Query Examples

With the rich Dgraph schema, honeygraph enables powerful queries that would be impossible with just key-value storage.

## User Queries

### Get Complete User Profile
```bash
# Get all user data including files, contracts, and market activity
curl http://localhost:3030/api/spk/user/disregardfiat?include=all

# Response includes:
# - Token balances (LARYNX, SPK, BROCA)
# - Storage contracts with files
# - DEX orders
# - Node market stats
# - Delegations
```

### Get User's File System
```bash
# Browse user's virtual file system
curl http://localhost:3030/api/spk/fs/disregardfiat/videos/2024

# Returns folder structure with files
```

## File Queries

### Search Files by Tags
```bash
# Find all videos tagged with "tutorial"
curl http://localhost:3030/api/spk/files/search?tags=tutorial,video

# Search by name
curl http://localhost:3030/api/spk/files/search?q=introduction

# Filter by owner
curl http://localhost:3030/api/spk/files/search?owner=disregardfiat&tags=music
```

### Get Storage Network Stats
```bash
curl http://localhost:3030/api/spk/storage/stats

# Returns:
# - Total files and contracts
# - Top storage nodes by reliability
# - Recent uploads
# - Network capacity
```

## Market Queries

### DEX Market Depth
```bash
# Get order book for LARYNX/HIVE pair
curl http://localhost:3030/api/spk/dex/LARYNX:HIVE?depth=50

# Returns:
# - Buy/sell orders sorted by price
# - Recent trades
# - Liquidity pool stats
# - 24h volume
```

### Rich List
```bash
# Get top LARYNX holders
curl http://localhost:3030/api/spk/richlist/larynx?limit=100

# Get top SPK holders
curl http://localhost:3030/api/spk/richlist/spk?limit=100

# Get accounts with most power
curl http://localhost:3030/api/spk/richlist/power?limit=50
```

## Complex GraphQL Queries

### Find Storage Providers for Specific Files
```graphql
query findProviders {
  files(func: anyofterms(tags, "important")) {
    cid
    name
    contract {
      nodes {
        username
        reliability
        uptime
      }
    }
  }
}
```

### Track File Validation History
```graphql
query fileValidations($cid: string) {
  file(func: eq(cid, $cid)) {
    validations(orderdesc: timestamp, first: 100) {
      node {
        username
      }
      valid
      reportedSize
      timestamp
      reward
    }
  }
}
```

### Find Accounts with Expiring Contracts
```graphql
query expiringContracts($beforeBlock: int) {
  accounts: var(func: type(Account)) {
    contracts @filter(lt(expiresBlock, $beforeBlock) AND eq(status, "ACTIVE")) {
      owner
    }
  }
  
  result(func: uid(accounts)) {
    username
    contracts @filter(lt(expiresBlock, $beforeBlock) AND eq(status, "ACTIVE")) {
      id
      expiresBlock
      files: count(files)
    }
  }
}
```

### Analyze DEX Trading Patterns
```graphql
query tradingPatterns($user: string) {
  user(func: eq(username, $user)) {
    dexOrders(first: 100) @facets {
      pair
      type
      rate
      filled
      createdAt
    }
    
    fills: ~counterparty {
      amount
      rate
      timestamp
    }
  }
}
```

### Network Health Overview
```graphql
query networkHealth {
  nodes(func: type(StorageNode)) @filter(gt(reliability, 0.9)) {
    reliable: count(uid)
  }
  
  activeContracts: count(func: type(StorageContract)) @filter(eq(status, "ACTIVE"))
  
  recentValidations(func: type(Validation), orderdesc: timestamp, first: 1000) {
    successRate: avg(valid)
  }
  
  storage: sum(func: type(File)) {
    totalBytes: sum(size)
  }
}
```

## Aggregation Queries

### Storage Node Performance
```graphql
query nodePerformance {
  nodes(func: type(StorageNode), orderdesc: rewardsEarned, first: 20) {
    account { username }
    validations: count(validations)
    successfulValidations: count(validations @filter(eq(valid, true)))
    totalRewards: sum(validations) { sum(reward) }
    avgReliability: avg(reliability)
  }
}
```

### Token Distribution Analysis
```graphql
query tokenDistribution {
  top1percent: count(func: type(Account)) @filter(gt(larynxBalance, 1000000))
  top10percent: count(func: type(Account)) @filter(gt(larynxBalance, 100000))
  
  whales(func: type(Account), orderdesc: larynxBalance, first: 10) {
    username
    larynxBalance
    percentOfSupply: math(larynxBalance / 1000000000 * 100)
  }
}
```

## Time-Series Queries

### Account Activity Timeline
```graphql
query accountTimeline($user: string, $days: int) {
  user(func: eq(username, $user)) {
    transactions(orderdesc: timestamp) 
      @filter(ge(timestamp, "2024-01-01")) {
      operation
      amount
      memo
      timestamp
    }
    
    recentFiles: files(orderdesc: uploadedAt, first: 10) {
      name
      size
      uploadedAt
    }
  }
}
```

## New Relationship Queries

### Find Who Stores Your Files
```bash
# Get all storage providers for a user's files
curl http://localhost:3030/api/spk/storage-providers/disregardfiat

# Returns accounts storing your contracts with their services and reliability
```

### Find Storage Providers for Specific File
```bash
# Get providers storing a specific file
curl http://localhost:3030/api/spk/file/QmXxx.../providers

# Returns storage nodes with their IPFS endpoints and reliability scores
```

### Find Service Providers by Type
```bash
# Find all IPFS gateway providers
curl http://localhost:3030/api/spk/services/IPFS_GATEWAY/providers?minUptime=0.95

# Find video encoding services
curl http://localhost:3030/api/spk/services/VIDEO_ENCODER/providers

# Find Proof of Access nodes
curl http://localhost:3030/api/spk/services/PROOF_OF_ACCESS/providers
```

### Network Topology View
```bash
# See who stores for whom in the network
curl http://localhost:3030/api/spk/network/topology

# Returns storage relationships and service distribution
```

## Complex Relationship Queries

### Find Reliable Multi-Service Providers
```graphql
query multiServiceProviders {
  accounts(func: type(Account)) @cascade {
    username
    services @filter(gt(count(uid), 2) AND eq(active, true)) {
      type
      uptime
    }
    contractsStoring @filter(eq(status, "ACTIVE")) {
      count: count(uid)
    }
    storageNode @filter(gt(reliability, 0.95)) {
      reliability
      rewardsEarned
    }
  }
}
```

### Track File Redundancy
```graphql
query fileRedundancy($owner: string) {
  user(func: eq(username, $owner)) {
    files {
      cid
      name
      contract {
        storageNodes {
          username
          region: serviceEndpoints {
            region
          }
        }
      }
      redundancy: count(contract.storageNodes)
    }
  }
}
```

### Find Storage Providers with Specific Services
```graphql
query storageWithServices {
  providers(func: type(Account)) @cascade {
    username
    contractsStoring @filter(eq(status, "ACTIVE")) {
      owner {
        username
      }
    }
    services @filter(eq(type, "IPFS_GATEWAY") OR eq(type, "CDN")) {
      type
      endpoint
      uptime
    }
  }
}
```

### Service Health Dashboard
```graphql
query serviceHealth {
  services(func: type(Service)) @groupby(type) {
    count(uid)
    avgUptime: avg(uptime)
    avgReliability: avg(reliability)
  }
  
  unhealthyEndpoints: endpoints(func: type(ServiceEndpoint)) 
    @filter(eq(healthy, false)) {
    account {
      username
    }
    service {
      type
    }
    url
    lastCheck
  }
}
```

## Benefits Over K:V Storage

1. **Relationship Traversal**: Find all files owned by accounts that delegate to a specific node
2. **Service Discovery**: Find providers offering specific services with minimum uptime
3. **Storage Analysis**: See who stores whose files and track redundancy
4. **Multi-hop Queries**: Find files stored by providers who also offer CDN services
5. **Aggregations**: Calculate network-wide statistics in real-time
6. **Complex Filters**: Find contracts expiring in next 100 blocks with >10 files
7. **Full-Text Search**: Search files by name, tags, or metadata
8. **Time-Based Queries**: Track changes over time, analyze patterns
9. **Graph Algorithms**: Find shortest path between accounts, detect communities

## Performance Tips

1. Use indexes on frequently queried fields
2. Limit result sets with `first` parameter
3. Use facets for metadata instead of separate nodes
4. Batch related queries together
5. Cache common aggregations
6. Use @cascade for filtering connected nodes