# Contract Query Examples with Real Structure

Based on the actual contract structure from honeycomb, here are practical queries.

## Finding Understored Contracts

This is a critical query - finding contracts where the number of storage nodes is less than the power (payout multiplier):

```graphql
query UnderstoredContracts {
  contracts(func: has(StorageContract.isUnderstored)) 
    @filter(eq(isUnderstored, true) AND eq(status, 3)) {
    id
    purchaser {
      username
    }
    power          # Required nodes for full payout
    nodeTotal      # Actual nodes storing
    utilized       # Bytes being stored
    expiresBlock
    storageNodes {
      storageAccount {
        username
      }
      nodeNumber
    }
  }
}
```

## Query by Contract Status

```graphql
query ActiveContracts {
  contracts(func: eq(StorageContract.status, 3)) {
    id
    purchaser {
      username
    }
    broker
    authorized    # Max bytes allowed
    utilized      # Actual bytes used
    verified      # Verified bytes
    lastValidated
    statusText
  }
}
```

## Find Contracts by Purchaser

```graphql
query UserContracts($username: string) {
  user(func: eq(Account.username, $username)) {
    username
    contracts {
      id
      contractType
      status
      statusText
      authorized
      utilized
      power
      nodeTotal
      isUnderstored
      expiresBlock
      files {
        cid
        size
      }
    }
  }
}
```

## Storage Provider View

Find all contracts a specific account is storing:

```graphql
query StorageProviderContracts($provider: string) {
  assignments(func: eq(StorageNodeAssignment.storageAccount, $provider)) {
    contract {
      id
      purchaser {
        username
      }
      utilized
      verified
      power
      lastValidated
      expiresBlock
      status
    }
    nodeNumber
    assignedBlock
  }
}
```

## Contract Extensions History

```graphql
query ContractExtensions($contractId: string) {
  contract(func: eq(StorageContract.id, $contractId)) {
    id
    expiresBlock
    extensions {
      paidBy {
        username
      }
      paidAmount
      blocksPaid
      startBlock
      endBlock
    }
  }
}
```

## Find Contracts by Metadata

```graphql
query NFTContracts {
  metadata(func: anyofterms(ContractMetadata.tags, "NFTs nft")) {
    contract {
      id
      purchaser {
        username
      }
      utilized
      fileCount
      files(first: 10) {
        cid
        size
      }
    }
    tags
    fileType
    version
  }
}
```

## Validation Status

Find contracts that haven't been validated recently:

```graphql
query StaleValidations($blockThreshold: int) {
  contracts(func: has(StorageContract.lastValidated)) 
    @filter(
      lt(lastValidated, $blockThreshold) 
      AND eq(status, 3)
    ) {
    id
    purchaser {
      username
    }
    lastValidated
    verified
    utilized
    storageNodes {
      storageAccount {
        username
      }
    }
  }
}
```

## Contract Economics

Analyze refunds and utilization:

```graphql
query ContractEconomics {
  contracts(func: has(StorageContract.refunded)) 
    @filter(gt(refunded, 0)) {
    id
    purchaser {
      username
    }
    authorized
    utilized
    refunded
    percentage: math("utilized / authorized * 100")
  }
}
```

## File Search within Contracts

```graphql
query LargeFiles($minSize: int) {
  files(func: has(ContractFile.size)) 
    @filter(gt(size, $minSize)) 
    @orderby(desc: size) {
    cid
    size
    contract {
      id
      purchaser {
        username
      }
      broker
      status
    }
  }
}
```

## Network Health Metrics

```graphql
query NetworkHealth {
  var(func: has(StorageContract.status)) @filter(eq(status, 3)) {
    activeCount as count(uid)
    totalUtilized as sum(utilized)
    totalAuthorized as sum(authorized)
  }
  
  var(func: has(StorageContract.isUnderstored)) 
    @filter(eq(isUnderstored, true) AND eq(status, 3)) {
    understoredCount as count(uid)
  }
  
  metrics() {
    activeContracts: val(activeCount)
    understoredContracts: val(understoredCount)
    totalBytesStored: val(totalUtilized)
    totalBytesAuthorized: val(totalAuthorized)
    utilizationRate: math("totalUtilized / totalAuthorized * 100")
  }
}
```

## Key Fields Reference

- **id**: Full contract identifier (purchaser:type:block-txid)
- **status**: Numeric status (3 = active/finalized)
- **power**: Payout multiplier (number of nodes that should store)
- **nodeTotal**: Actual number of nodes storing
- **isUnderstored**: true if nodeTotal < power
- **authorized**: Maximum bytes allowed
- **utilized**: Actual bytes stored
- **verified**: Bytes that have been validated
- **refunded**: BROCA refunded for unused space