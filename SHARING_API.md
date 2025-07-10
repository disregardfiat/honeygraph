# File Sharing API Documentation

The File Sharing API provides endpoints for accessing encrypted files that have been shared between users on the SPK Network.

## Endpoints

### Files Shared With Me

Access encrypted files that other users have shared with you.

```
GET /fse/:username/:path
```

#### Parameters
- `username` - Your SPK account username
- `path` - The directory path (optional, defaults to root)

#### Example Requests
```bash
# Get all files shared with me
GET /fse/alice/

# Get shared files in a specific directory
GET /fse/alice/Documents

# Access a specific shared file
GET /fse/alice/Documents/report.pdf
```

#### Response Format (Directory)
```json
{
  "path": "/Documents",
  "username": "alice",
  "type": "shared-with-me",
  "contents": [
    {
      "name": "confidential-report.pdf",
      "type": "file",
      "cid": "QmXkEeNVh3Q2wK8MG5RCxA2tZsJmZaHtBFmkYgAPndu5jC",
      "size": 1048576,
      "mimeType": "application/pdf",
      "contract": {
        "id": "bob:0:94477061-457c1cb54b53658ec034b719ff8c158bd85ea430",
        "blockNumber": 94477061
      },
      "sharing": {
        "sharedBy": "bob",
        "encrypted": true,
        "hasKey": true
      }
    }
  ]
}
```

#### Response (File Access)
- **302 Redirect** to IPFS gateway
- **Headers**:
  - `X-IPFS-CID`: The IPFS content identifier
  - `X-Contract-ID`: The storage contract ID
  - `X-Shared-By`: Username of the person who shared the file
  - `X-Encrypted`: "true" (always true for shared files)
  - `X-Encryption-Key`: Your encrypted key for this file
  - `X-Key-Type`: Encryption algorithm (e.g., "AES-256")

### Files I've Shared

View encrypted files you've shared with other users.

```
GET /fss/:username/:path
```

#### Parameters
- `username` - Your SPK account username
- `path` - The directory path (optional, defaults to root)

#### Example Requests
```bash
# Get all files I've shared
GET /fss/bob/

# Get shared files in a specific directory
GET /fss/bob/Projects

# Access a file I've shared
GET /fss/bob/Projects/proposal.docx
```

#### Response Format (Directory)
```json
{
  "path": "/Projects",
  "username": "bob",
  "type": "shared-by-me",
  "contents": [
    {
      "name": "proposal.docx",
      "type": "file",
      "cid": "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
      "size": 524288,
      "mimeType": "application/msword",
      "contract": {
        "id": "bob:0:94477061-457c1cb54b53658ec034b719ff8c158bd85ea430",
        "blockNumber": 94477061
      },
      "sharing": {
        "sharedWith": ["alice", "charlie", "dave"],
        "totalShares": 3,
        "encrypted": true
      }
    }
  ]
}
```

## How Encryption Sharing Works

### 1. File Encryption
When a file is encrypted and uploaded:
- File is encrypted with a symmetric key (e.g., AES-256)
- The symmetric key is stored in the contract metadata

### 2. Key Sharing
When sharing with another user:
- The file's symmetric key is encrypted with the recipient's public key
- The encrypted key is stored in the contract metadata
- Format: `encData: "flags#alice:encryptedKey1#bob:encryptedKey2"`

### 3. Access Control
- Only users with encrypted keys in the metadata can access the file
- Each user's key is encrypted specifically for them
- The original owner always has access

### 4. Decryption Process
1. User requests the file
2. API returns the encrypted file and the user's encrypted key
3. User decrypts the key with their private key
4. User decrypts the file with the symmetric key

## Query Examples

### Find All Files Shared With Me
```graphql
query SharedWithMe($username: string) {
  keys(func: eq(EncryptionKey.sharedWith, $username)) {
    encryptedKey
    metadata {
      contract {
        id
        purchaser {
          username
        }
        files {
          name
          size
          path
        }
      }
    }
  }
}
```

### Find Who I've Shared Files With
```graphql
query SharedByMe($username: string) {
  user(func: eq(Account.username, $username)) {
    contracts @filter(has(metadata)) {
      metadata @filter(eq(encrypted, true)) {
        encryptionKeys {
          sharedWith {
            username
          }
        }
      }
      files {
        name
        path
      }
    }
  }
}
```

## Client Implementation Example

```javascript
// Fetch files shared with me
async function getSharedFiles(username) {
  const response = await fetch(`/fse/${username}/`);
  const data = await response.json();
  
  return data.contents.filter(item => item.type === 'file');
}

// Download and decrypt a shared file
async function downloadSharedFile(username, filePath) {
  // Get file with encryption metadata
  const response = await fetch(`/fse/${username}${filePath}`, {
    redirect: 'manual' // Don't follow redirect automatically
  });
  
  // Extract encryption info from headers
  const encryptedKey = response.headers.get('X-Encryption-Key');
  const keyType = response.headers.get('X-Key-Type');
  const ipfsCid = response.headers.get('X-IPFS-CID');
  
  // Decrypt the key with user's private key
  const symmetricKey = await decryptWithPrivateKey(encryptedKey);
  
  // Fetch encrypted file from IPFS
  const fileResponse = await fetch(`https://ipfs.io/ipfs/${ipfsCid}`);
  const encryptedData = await fileResponse.arrayBuffer();
  
  // Decrypt file with symmetric key
  const decryptedData = await decryptFile(encryptedData, symmetricKey, keyType);
  
  return decryptedData;
}

// Share a file with another user
async function shareFile(contractId, recipientUsername, recipientPublicKey) {
  // This would be done through a SPK Network transaction
  // that updates the contract metadata with the new encryption key
  
  // 1. Get the file's symmetric key
  const symmetricKey = await getFileKey(contractId);
  
  // 2. Encrypt the key for the recipient
  const encryptedKey = await encryptWithPublicKey(symmetricKey, recipientPublicKey);
  
  // 3. Update contract metadata via SPK transaction
  const tx = {
    op: 'contract_update',
    contract: contractId,
    metadata: {
      addKey: {
        user: recipientUsername,
        key: encryptedKey
      }
    }
  };
  
  return broadcastTransaction(tx);
}
```

## Security Considerations

1. **Key Management**
   - Private keys should never leave the client
   - Symmetric keys should be generated client-side
   - Use strong encryption algorithms (AES-256 or better)

2. **Access Revocation**
   - Currently, once shared, access cannot be revoked
   - Consider implementing re-encryption for revocation

3. **Metadata Privacy**
   - File names and paths are visible in metadata
   - Consider encrypting metadata for sensitive files

4. **IPFS Gateway Trust**
   - Files pass through IPFS gateways unencrypted
   - Use client-side decryption for sensitive data
   - Consider running your own IPFS gateway

## Best Practices

1. **Client-Side Encryption**: Always encrypt files before uploading
2. **Key Backup**: Ensure users backup their private keys
3. **Selective Sharing**: Only share with trusted users
4. **Metadata Sanitization**: Avoid sensitive info in file names/paths
5. **Regular Audits**: Review who has access to your files

This sharing system enables secure, decentralized file sharing while maintaining the benefits of IPFS content addressing and SPK Network's storage contracts.