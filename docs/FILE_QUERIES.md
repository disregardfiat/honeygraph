# File Query Examples with Path and Metadata

With the expanded file metadata parsing, you can now query files by name, type, path, and more.

## Finding Files by Path

```graphql
query FilesByPath($path: string) {
  files(func: eq(ContractFile.path, $path)) {
    cid
    name
    size
    mimeType
    path
    contract {
      id
      purchaser {
        username
      }
      status
      metadata {
        encrypted
        autoRenew
      }
    }
  }
}
```

## Search Files by Name

```graphql
query SearchFiles($searchTerm: string) {
  files(func: alloftext(ContractFile.name, $searchTerm)) {
    cid
    name
    size
    mimeType
    path
    contract {
      id
      purchaser {
        username
      }
    }
  }
}
```

## Find Files by Type

```graphql
query ImageFiles {
  files(func: anyofterms(ContractFile.mimeType, "image/jpeg image/png image/gif")) 
    @orderby(desc: size) {
    cid
    name
    size
    mimeType
    path
    contract {
      id
      purchaser {
        username
      }
      broker
    }
  }
}
```

## File System View

Get a hierarchical view of files for a user:

```graphql
query UserFileSystem($username: string) {
  user(func: eq(Account.username, $username)) {
    username
    contracts @filter(eq(status, 3)) {
      id
      metadata {
        folderStructure
        encrypted
      }
      files @groupby(path) {
        count(uid)
        groupby: path
      }
      filesByPath: files {
        path
        name
        cid
        size
        mimeType
      }
    }
  }
}
```

## Encrypted Files

Find all encrypted files:

```graphql
query EncryptedFiles {
  metadata(func: eq(ContractMetadata.encrypted, true)) {
    contract {
      id
      purchaser {
        username
      }
      files {
        cid
        name
        path
        size
      }
    }
  }
}
```

## Auto-Renew Contracts with Files

```graphql
query AutoRenewContracts {
  metadata(func: eq(ContractMetadata.autoRenew, true)) {
    contract @filter(eq(status, 3)) {
      id
      purchaser {
        username
      }
      expiresBlock
      utilized
      files(first: 5) {
        name
        size
        path
      }
    }
  }
}
```

## Large Files in Specific Folders

```graphql
query LargeFilesInFolder($folderPath: string, $minSize: int) {
  files(func: eq(ContractFile.path, $folderPath)) 
    @filter(gt(size, $minSize)) 
    @orderby(desc: size) {
    cid
    name
    size
    mimeType
    contract {
      id
      purchaser {
        username
      }
      storageNodes {
        storageAccount {
          username
        }
      }
    }
  }
}
```

## Contract Storage Analysis by File Type

```graphql
query StorageByType($contractId: string) {
  contract(func: eq(StorageContract.id, $contractId)) {
    id
    utilized
    files @groupby(mimeType) {
      type: mimeType
      count: count(uid)
      totalSize: sum(size)
    }
    fileList: files {
      name
      path
      mimeType
      size
    }
  }
}
```

## Find Duplicate Files

Find files with the same CID across different contracts:

```graphql
query DuplicateFiles {
  var(func: has(ContractFile.cid)) @groupby(cid) {
    c as count(uid)
  }
  
  duplicates(func: has(ContractFile.cid)) @filter(gt(val(c), 1)) @groupby(cid) {
    cid
    instances: ~ContractFile.cid {
      contract {
        id
        purchaser {
          username
        }
      }
      name
      path
      size
    }
  }
}
```

## File Organization Report

```graphql
query FileOrganization($username: string) {
  user(func: eq(Account.username, $username)) {
    username
    contracts @filter(eq(status, 3)) {
      id
      fileCount
      utilized
      
      # Files by path
      filesByPath: files @groupby(path) {
        path
        fileCount: count(uid)
        totalSize: sum(size)
      }
      
      # Files by type
      filesByType: files @groupby(mimeType) {
        mimeType
        fileCount: count(uid) 
        totalSize: sum(size)
      }
      
      # Folder structure from metadata
      metadata {
        folderStructure
      }
    }
  }
}
```

## Key Benefits

1. **Path-based Navigation**: Query files by their virtual path within contracts
2. **Name Search**: Find files by name instead of just CID
3. **Type Filtering**: Filter by MIME type for specific file kinds
4. **Folder Structure**: Understand the organization of files within contracts
5. **Encryption Status**: Identify encrypted vs unencrypted files
6. **Auto-renewal Tracking**: Find contracts set to auto-renew

The metadata parsing transforms the compact storage format into a queryable file system structure, enabling rich file management queries.