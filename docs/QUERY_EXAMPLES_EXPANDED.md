# Expanded Schema Query Examples

With the expanded contract metadata, you can now perform rich queries that weren't possible with the compact format.

## Finding Contracts by File Properties

### Search contracts containing large files
```graphql
query LargeFileContracts {
  contracts(func: has(StorageContract.files)) @filter(gt(dataSize, 10000000)) {
    id
    owner {
      username
    }
    dataSize
    fileCount
    files @filter(gt(size, 1000000)) {
      cid
      name
      size
      mimeType
    }
  }
}
```

### Find contracts by file type
```graphql
query VideoContracts {
  files(func: eq(ContractFile.mimeType, "video/mp4")) {
    contract {
      id
      owner {
        username
      }
      totalPrice
      expiresBlock
    }
    cid
    name
    size
  }
}
```

## Storage Node Performance Queries

### Find best performing storage nodes
```graphql
query TopStorageNodes {
  nodes(func: has(StorageNode.validationSuccessRate)) 
    @filter(gt(validationSuccessRate, 0.95)) 
    @orderby(desc: uptime) {
    account {
      username
    }
    validationSuccessRate
    uptime
    averageResponseTime
    contracts {
      id
      status
    }
  }
}
```

### Find contracts by storage provider
```graphql
query ContractsByProvider($provider: string) {
  var(func: eq(Account.username, $provider)) {
    StorageNode.contracts {
      c as uid
    }
  }
  
  contracts(func: uid(c)) {
    id
    owner {
      username
    }
    totalPrice
    dataSize
    status
    expiresBlock
  }
}
```

## Contract Extensions and History

### Find recently extended contracts
```graphql
query RecentExtensions {
  extensions(func: has(ContractExtension.extensionBlock)) 
    @filter(gt(extensionBlock, 1000000)) {
    contract {
      id
      owner {
        username
      }
      originalExpiry: expiresBlock
    }
    buyer {
      username
    }
    extensionBlock
    endBlock
    price
  }
}
```

### Track validation history
```graphql
query ValidationHistory($contractId: string) {
  contract(func: eq(StorageContract.id, $contractId)) {
    id
    validations
    lastValidated
    validationHistory(orderby: desc: blockNum, first: 10) {
      blockNum
      timestamp
      validator {
        username
      }
      success
      filesChecked
      responseTime
    }
  }
}
```

## Advanced Filtering

### Find expiring contracts with specific criteria
```graphql
query ExpiringContracts {
  contracts(func: has(StorageContract.expiresBlock)) 
    @filter(
      AND(
        lt(expiresBlock, 2000000),
        gt(expiresBlock, 1900000),
        gt(dataSize, 5000000),
        eq(status, "ACTIVE")
      )
    ) {
    id
    owner {
      username
    }
    expiresBlock
    dataSize
    fileCount
    totalPrice
    storageNodes {
      account {
        username
      }
    }
  }
}
```

### Search by tags and metadata
```graphql
query TaggedContracts {
  contracts(func: anyofterms(StorageContract.tags, "backup archive important")) 
    @filter(alloftext(description, "database")) {
    id
    owner {
      username
    }
    tags
    description
    contractType
    dataSize
    files(first: 5) {
      name
      size
      tags
    }
  }
}
```

## Aggregations

### Storage statistics by user
```graphql
query UserStorageStats($username: string) {
  user(func: eq(Account.username, $username)) {
    username
    contracts @facets {
      totalStorage: sum(dataSize)
      totalFiles: sum(fileCount)
      activeContracts: count(uid) @filter(eq(status, "ACTIVE"))
      totalSpent: sum(totalPrice)
    }
    storageProvided {
      contract {
        dataSize
        status
      }
    }
  }
}
```

### Network-wide storage metrics
```graphql
query NetworkMetrics {
  var(func: has(StorageContract.dataSize)) {
    total as sum(dataSize)
    active as count(uid) @filter(eq(status, "ACTIVE"))
  }
  
  var(func: has(ContractFile.size)) {
    fileCount as count(uid)
  }
  
  metrics() {
    totalStorage: val(total)
    activeContracts: val(active)
    totalFiles: val(fileCount)
  }
}
```

## Benefits of Expanded Schema

1. **Rich Queries**: Search by file properties, not just contract metadata
2. **Performance Tracking**: Monitor storage node reliability and speed
3. **Historical Analysis**: Track validations and extensions over time
4. **Flexible Filtering**: Combine multiple criteria for precise results
5. **Aggregations**: Calculate statistics across contracts and files
6. **Relationships**: Navigate between accounts, contracts, files, and nodes

The expanded schema transforms the compact k:v data into a queryable graph structure, enabling powerful analytics and search capabilities for the SPK storage network.