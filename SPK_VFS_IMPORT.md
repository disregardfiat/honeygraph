# SPK VFS Import Guide

This guide explains how to import SPK Network data into DGraph with proper Virtual File System (VFS) support.

## Overview

The SPK VFS import system transforms SPK blockchain contract data into a hierarchical file system structure that can be queried via the `/fs/:username/:path` endpoint.

## Components

### 1. SPK Data Transformer (`lib/spk-data-transformer.js`)
- Extends the base data transformer with VFS-specific functionality
- Creates `Path` entities for directory structure
- Links files to their parent paths
- Ensures proper hierarchy for nested folders

### 2. Import Scripts

#### `scripts/import-spk-contracts.js`
Enhanced import script with VFS support:
```bash
# Import all contracts
node scripts/import-spk-contracts.js

# Import specific user's contracts
TARGET_USER=disregardfiat node scripts/import-spk-contracts.js
```

#### `scripts/import-contracts-only.js`
Updated to use SPK transformer for better VFS support.

### 3. Test Scripts

#### `scripts/test-spk-vfs.js`
Comprehensive test that:
- Initializes DGraph with SPK schema
- Imports test data
- Verifies VFS output format

#### `scripts/quick-spk-test.sh`
Quick bash script to test the complete flow:
```bash
./scripts/quick-spk-test.sh
```

## Usage

### Step 1: Initialize Schema
```bash
node scripts/init-schema.js
```

### Step 2: Import SPK Data
```bash
# Import specific user (recommended for testing)
TARGET_USER=disregardfiat node scripts/import-spk-contracts.js

# Or import all contracts
node scripts/import-spk-contracts.js
```

### Step 3: Query VFS
```bash
# Get directory listing
curl http://localhost:3030/fs/disregardfiat/NFTs

# Get file (redirects to IPFS)
curl http://localhost:3030/fs/disregardfiat/NFTs/bz.nft
```

## Expected Output Format

When querying `/fs/disregardfiat/NFTs`, you should get:

```json
{
  "path": "/NFTs",
  "username": "disregardfiat",
  "type": "directory",
  "contents": [
    {
      "name": "Resources",
      "type": "directory",
      "path": "/NFTs/Resources",
      "itemCount": 8
    },
    {
      "name": "bz",
      "type": "file",
      "cid": "QmUM2sBkUtuzUUj2kUJzSTD7Wz2S4hCqVoeBKzSBDjTb3L",
      "extension": "nft",
      "size": 509777,
      "mimeType": "application/nft",
      "license": "",
      "labels": "",
      "thumbnail": "",
      "contract": {
        "id": "disregardfiat:0:94477061-457c1cb54b53658ec034b719ff8c158bd85ea430",
        "blockNumber": 94477061,
        "encryptionData": null,
        "storageNodeCount": 1,
        "storageNodes": ["dlux-io"]
      },
      "metadata": {
        "encrypted": false,
        "autoRenew": true
      }
    },
    {
      "name": "dlux",
      "type": "file",
      "cid": "QmYSRLiGaEmucSXoNiq9RqazmDuEZmCELRDg4wyE7Fo8kX",
      "extension": "nft",
      "size": 7909,
      "mimeType": "application/nft",
      "license": "",
      "labels": "",
      "thumbnail": "",
      "contract": {
        "id": "disregardfiat:0:94477131-b5bc053e44135711615c14a1aedcb3d031417efe",
        "blockNumber": 94477131,
        "encryptionData": null,
        "storageNodeCount": 1,
        "storageNodes": ["dlux-io"]
      },
      "metadata": {
        "encrypted": false,
        "autoRenew": true
      }
    }
  ]
}
```

## Troubleshooting

### No files showing up
1. Check that contracts have proper metadata (`m` field)
2. Verify the metadata parser is correctly extracting folder structure
3. Check DGraph logs for any mutation errors

### Path entities not created
1. Ensure SPK transformer is being used (not base transformer)
2. Check that `Path` type is defined in schema
3. Verify owner relationships are properly set

### Import errors
1. Check DGraph is running: `curl http://localhost:8080/health`
2. Verify schema is applied: `node scripts/init-schema.js`
3. Check logs for specific error messages

## Architecture Notes

The VFS system works by:
1. Parsing contract metadata to extract folder structure
2. Creating `Path` entities for each directory
3. Linking `ContractFile` entities to their parent paths
4. Building hierarchical queries that traverse the path structure

Files are stored with their full path, allowing efficient queries for directory contents.

## Development

To extend or modify the VFS functionality:

1. **Transformer**: Edit `lib/spk-data-transformer.js`
2. **Schema**: Update path-related types in `schema/base-schema.dgraph`
3. **Queries**: Modify filesystem queries in `routes/filesystem.js`

Remember to test changes with:
```bash
./scripts/quick-spk-test.sh
```