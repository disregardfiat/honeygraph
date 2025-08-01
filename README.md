# Honeygraph - Dgraph-based Read Replication for SPK Network

Honeygraph provides a scalable, fork-aware read replication layer for the SPK Network blockchain using Dgraph as the backend.

## Features

- **Fork-Aware Replication**: Tracks multiple blockchain forks simultaneously
- **Checkpoint Support**: Creates immutable checkpoints at Last Irreversible Block (LIB)
- **Automatic Fork Reconciliation**: Detects and handles chain reorganizations
- **High-Performance Queries**: Dgraph provides fast GraphQL queries for blockchain state
- **DDoS Protection**: Separates read traffic from consensus nodes
- **Queue-Based Processing**: Reliable replication using Bull queue with Redis

## Architecture

```
honeycomb-spkcc nodes → Honeygraph API → Bull Queue → Dgraph
                                              ↓
                                          Read Clients
```

## Installation

### Prerequisites
- Docker and Docker Compose
- Node.js 18+ (for local development)
- Git

### Quick Start - Complete SPK Network Setup

1. **Clone the repository**:
```bash
git clone https://github.com/disregardfiat/honeygraph.git
cd honeygraph
```

2. **Configure environment** (optional):
```bash
cp .env.example .env
# Edit .env to set your configuration if needed
```

3. **Install dependencies** (for local development):
```bash
npm install
```

4. **Start the services**:
```bash
docker compose up -d
sudo ./scripts/setup-zfs.sh
```

5. **Initialize SPK Testnet with complete file system**:
```bash
docker exec honeygraph-api node scripts/init-schema.js
# Import ALL SPK data from public testnet API (https://spktest.dlux.io/state)
# Includes: accounts, balances, tokens, contracts, DEX data, services, etc.
# Uses individual processing for contracts, batch processing for other data
docker exec honeygraph-api node scripts/init-spk-testnet.js
```

6. **Verify setup**:
```bash
# Check health
curl http://localhost:3030/health

# Test filesystem API - should show directories with file counts
curl http://localhost:3030/fs/disregardfiat/

# Test a specific directory - should show actual files
curl http://localhost:3030/fs/disregardfiat/Ragnarok/

# Test file Redirects
curl http://localhost:3030/fs/disregardfiat/NFTs/hf.txt

# Test SPK user API (confirms all data imported)
curl http://localhost:3030/api/spk/user/disregardfiat

# Test account balances
curl "http://localhost:3030/api/spk/user/disregardfiat?include=all" | jq '.larynxBalance, .spkBalance'
```

**Expected Results:**
- Health check: `{"status":"healthy"}`
- Root filesystem: Should show directories like "Ragnarok", "NFTs" with `itemCount > 0`
- Directory contents: Should show array of files with `name`, `cid`, `type: "file"`
- User API: Should return complete user data with `larynxBalance`, `spkBalance`, contracts, etc.
- Balances: Should show numeric values (not null), confirming all SPK data imported

### Complete Reset (Clean Slate)

To completely reset your local setup and start fresh:

```bash
# Run the reset script (removes ALL data)
echo "" | ./scripts/reset-dgraph.sh

# Remove any remaining Docker volumes
docker volume prune -f

# Initialize fresh SPK testnet with all data
docker exec honeygraph-api node scripts/init-schema.js
docker exec honeygraph-api node scripts/init-spk-testnet.js
```

**⚠️ Warning**: This will delete ALL local data permanently!

### Authentication Setup

To enable Hive-based authentication for honeycomb nodes:

1. **Edit your `.env` file**:
```bash
# Enable authentication
REQUIRE_HIVE_AUTH=true

# Optional: Whitelist specific accounts
AUTHORIZED_HONEYCOMB_NODES=your-node1,your-node2
```

2. **Restart the services**:
```bash
docker compose up --build honeygraph-api
```

3. **Configure your honeycomb node** to authenticate (see [Authentication Guide](docs/AUTHENTICATION.md))

## Working APIs After Setup

### File System API (Primary Feature)
- `GET /fs/:username/` - Browse user's virtual file system
- `GET /fs/:username/path/to/folder/` - Browse specific directory
- `GET /fs/:username/path/to/file.ext` - Redirect to IPFS file
   - Files with out extensions must have a trailing . ~/file.
- `GET /fse/:username/` - Files shared with user (encrypted)
- `GET /fss/:username/` - Files shared by user

#### SPK Network File System Overview

The SPK Network implements a decentralized virtual file system where users can store files on IPFS with metadata managed on-chain. Key features:

- **Virtual Paths**: Files are organized in a hierarchical folder structure
- **IPFS Storage**: Actual file content is stored on IPFS (content-addressed)
- **On-Chain Metadata**: File names, paths, and metadata stored in storage contracts
- **Deduplication**: Files are deduplicated by CID across the entire network
- **Storage Nodes**: Users can volunteer to store files and earn rewards
- **Revisions**: Files can have multiple versions while maintaining the same path

#### File Metadata Format

Files in storage contracts use a compact metadata format to save blockchain space:

```
Contract metadata: "autoRenew|folderStructure,file1,file2,..."
File format: "name,ext.pathIndex,thumb,flags-license-labels"
```

Example:
```
"1|NFTs,Resources,bz,nft.3,,0--,hf,txt.3,,0--"
```

This represents:
- Auto-renew enabled (1)
- Custom folder "NFTs" at index 1, "Resources" at index 2
- File "bz.nft" in folder 3 (Images preset)
- File "hf.txt" in folder 3 (Images preset)

#### Folder Structure

1. **Root Directory** (`/`) - Path index 0
2. **First Custom Folder** - Path index 1 (or contract block number if no custom folder)
3. **Preset Folders** - Path indices 2-9:
   - 2: Documents
   - 3: Images
   - 4: Videos
   - 5: Music
   - 6: Archives
   - 7: Code
   - 8: Trash
   - 9: Misc

#### Storage Contracts

Storage contracts define who stores files and for how long:

```json
{
  "id": "username:type:blockNumber-txid",
  "purchaser": "buyer-username",
  "owner": "file-owner-username",
  "power": 1000,              // Storage power required
  "nodeTotal": 3,             // Current storage nodes
  "storageNodes": ["node1", "node2", "node3"],
  "expiresBlock": 97938326,
  "status": "ACTIVE",
  "fileCount": 5,
  "metadata": {
    "autoRenew": true,
    "encrypted": false
  }
}
```

#### API Response Format

The filesystem API returns a structured response:

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
      "itemCount": 11
    },
    {
      "name": "bz",
      "type": "file",
      "extension": "nft",
      "cid": "QmUM2sBkUtuzUUj2kUJzSTD7Wz2S4hCqVoeBKzSBDjTb3L",
      "size": 509777,
      "mimeType": "application/nft",
      "contract": {
        "id": "disregardfiat:0:94477061-457c1cb54b53658ec034b719ff8c158bd85ea430",
        "blockNumber": 94477061,
        "storageNodes": ["dlux-io"]
      },
      "revisions": [
        {
          "cid": "QmUM2sBkUtuzUUj2kUJzSTD7Wz2S4hCqVoeBKzSBDjTb3L",
          "contract": { "blockNumber": 94477061 }
        }
      ]
    }
  ]
}
```

#### File Deduplication

Files are automatically deduplicated by their IPFS CID:
- Multiple contracts can reference the same file
- Files appear in each owner's filesystem
- The most recent contract is shown as the primary
- All contracts are available in the `revisions` array

#### Storage Node APIs

Query which nodes are storing contracts:

```bash
# Get contracts stored by a specific user
curl http://localhost:3030/spk/contracts/stored-by/dlux-io

# Find understored contracts (nodeTotal < power)
curl http://localhost:3030/spk/contracts/understored
```

#### Example Usage

**Browse a user's filesystem:**
```bash
# Get root directory
curl http://localhost:3030/fs/disregardfiat/

# Browse into a directory
curl http://localhost:3030/fs/disregardfiat/NFTs/

# Get file redirect (follows to IPFS gateway)
curl -L http://localhost:3030/fs/disregardfiat/NFTs/bz.nft
```

**Search for files:**
```bash
# Search by name
curl "http://localhost:3030/api/spk/files/search?q=banner"

# Search by tags
curl "http://localhost:3030/api/spk/files/search?tags=nft,art"

# Search by owner
curl "http://localhost:3030/api/spk/files/search?owner=disregardfiat"
```

#### Technical Implementation

**Data Flow:**
1. Storage contracts are created on the SPK Network blockchain
2. Honeygraph processes contracts individually (like streaming)
3. Files are deduplicated by CID using the `ensureFile` method
4. Virtual paths are created/updated with file references
5. Storage nodes are tracked as Account references

**Key Components:**
- `data-transformer.js` - Transforms blockchain data to Dgraph format
- `filesystem.js` - Builds virtual filesystem views from Path entities
- `spk-data-transformer.js` - SPK-specific transformations
- `init-spk-testnet.js` - Imports complete network state

**Deduplication Process:**
1. Check if file CID exists in current batch (mutations map)
2. Query database for existing file with same CID
3. Create new file only if not found
4. Update contract reference if newer

### SPK Network APIs
- `GET /api/spk/user/:username` - Complete user profile with balances
- `GET /api/spk/files/search` - Search files across network
- `GET /api/spk/storage/stats` - Network storage statistics
- `GET /api/spk/richlist/:token` - Token holder rankings (larynx/spk/power)

## API Endpoints

### SPK Network Enhanced APIs
- `GET /api/spk/user/:username` - Complete user profile with relationships
- `GET /api/spk/fs/:username/*` - Virtual file system browser
- `GET /api/spk/files/search` - Search files by tags, name, owner
- `GET /api/spk/file/:cid/providers` - Find who stores a specific file
- `GET /api/spk/services/:type/providers` - Find service providers by type
- `GET /api/spk/storage-providers/:owner` - Who stores files for user
- `GET /api/spk/network/topology` - Network storage relationships
- `GET /api/spk/dex/:pair` - Market depth and trading data
- `GET /api/spk/richlist/:token` - Token distribution analysis
- `GET /api/spk/governance/proposals` - Governance proposals
- `GET /api/spk/network/stats` - Network-wide statistics

### Replication
- `POST /api/replicate/block` - Replicate a block with operations
- `POST /api/replicate/consensus` - Update consensus information
- `POST /api/replicate/checkpoint` - Create a checkpoint
- `GET /api/replicate/status` - Get replication status

### Query
- `GET /api/query/path/:path` - Query state by path
- `POST /api/query/paths` - Query multiple paths
- `GET /api/query/forks` - Get fork information
- `GET /api/query/block/:blockNum/operations` - Get operations for a block
- `GET /api/query/state-at/:blockNum` - Get state at specific block

### Admin
- `GET /api/admin/metrics` - Get system metrics
- `POST /api/admin/reconcile-forks` - Force fork reconciliation
- `POST /api/admin/prune` - Prune old data
- `POST /api/admin/clear-queue` - Clear replication queue

## Integration with honeycomb-spkcc

```javascript
import { createForkAwarePathwise } from './pathwise-fork.js';

const pathwise = createForkAwarePathwise(db, {
  enabled: true,
  baseUrl: 'http://honeygraph:3030',
  apiKey: process.env.HONEYGRAPH_API_KEY
});

// Operations are automatically replicated to honeygraph
```

## Configuration

Environment variables:
- `DGRAPH_URL` - Dgraph Alpha URL (default: http://localhost:9080)
- `API_PORT` - API server port (default: 3030)
- `REDIS_HOST` - Redis host for queue (default: localhost)
- `REDIS_PORT` - Redis port (default: 6379)
- `JWT_SECRET` - Secret for API authentication
- `CORS_ORIGIN` - Allowed CORS origins (comma-separated)
- `LOG_LEVEL` - Logging level (default: info)

## Monitoring

Access Dgraph Ratel UI at http://localhost:8000 for visual exploration of the data.

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test
```

## Production Deployment

1. Set proper environment variables
2. Use a persistent volume for Dgraph data
3. Configure proper backup strategies
4. Set up monitoring and alerting
5. Use a reverse proxy with SSL termination

## Fork Handling

The system automatically:
1. Detects forks when block hashes don't match
2. Creates new fork branches in the graph
3. Reconciles forks based on consensus
4. Orphans non-consensus forks
5. Allows querying any fork's state

## Troubleshooting

### Filesystem API Returns Empty Directories

If directories show file counts but browsing into them returns no files:

1. **Check the import completed successfully**:
```bash
# Look for "✨ Processed X contracts successfully!" and "Import completed successfully!"
docker logs honeygraph-api | tail -30
```

2. **Verify data exists in database**:
```bash
# Should return a number > 0
curl -s "http://localhost:3030/fs/disregardfiat/" | jq '.contents[] | select(.itemCount > 0) | .itemCount'
```

3. **Try the reset and reimport**:
```bash
echo "" | ./scripts/reset-dgraph.sh
docker exec honeygraph-api node scripts/init-spk-testnet.js
```

### Import Script Fails

If the import script encounters errors:

1. **Check network connectivity**:
```bash
curl -s https://spktest.dlux.io/state | jq '.state.contract | keys | length'
```

2. **Check Dgraph is ready**:
```bash
docker exec honeygraph-alpha curl -s http://localhost:8080/health
```

3. **Check container logs**:
```bash
docker logs honeygraph-api
docker logs honeygraph-alpha
```

## Performance

- Dgraph provides sub-millisecond query times
- Bull queue ensures reliable processing
- Individual contract processing prevents timeout errors
- Automatic pruning keeps database size manageable

## ZFS Checkpoints (Advanced Feature)

Honeygraph supports ZFS snapshots for instant rollback capability:

### Benefits
- **Instant Rollback**: Revert to any checkpoint in seconds
- **Zero-Copy Snapshots**: No performance impact during creation
- **Efficient Storage**: Only changed blocks are stored
- **Fork Testing**: Clone checkpoints to test different scenarios

### Setup

1. **Prepare ZFS**:
```bash
# First, ensure you have a ZFS pool. Options:
# Option 1: Create a pool with a dedicated disk
sudo zpool create tank /dev/sdX  # Replace sdX with your disk

# Option 2: Use an existing pool
export ZFS_POOL=existing_pool_name

# Option 3: Create a test pool (development only)
# The setup script will offer to create a file-based pool

# Then run the setup script
sudo ./scripts/setup-zfs.sh
```

2. **Use ZFS Docker Compose**:
```bash
docker-compose -f docker-compose.zfs.yml up -d
```

3. **Enable in Environment**:
```env
ZFS_CHECKPOINTS_ENABLED=true
ZFS_DATASET=tank/dgraph
ZFS_MAX_SNAPSHOTS=100
```

### API Endpoints

#### Checkpoint Management
- `GET /api/checkpoints/list` - List all ZFS checkpoints
- `POST /api/checkpoints/create` - Create checkpoint manually
- `POST /api/checkpoints/rollback/:blockNum` - Rollback to checkpoint
- `POST /api/checkpoints/clone/:blockNum` - Clone checkpoint for testing
- `GET /api/checkpoints/diff/:block1/:block2` - Compare checkpoints
- `GET /api/checkpoints/by-hash/:ipfsHash` - Find checkpoint by IPFS hash

### Usage Example

```bash
# List checkpoints
curl http://localhost:3030/api/checkpoints/list

# Rollback to block 1000
curl -X POST http://localhost:3030/api/checkpoints/rollback/1000

# Clone checkpoint for testing
curl -X POST http://localhost:3030/api/checkpoints/clone/1000 \
  -H "Content-Type: application/json" \
  -d '{"cloneName": "test_fork"}'
```

### How It Works

1. **Automatic Snapshots**: Created at each Last Irreversible Block
2. **Fork-Aware**: Snapshots include IPFS hash in name for fork identification
3. **Instant Recovery**: ZFS rollback is near-instantaneous
4. **Space Efficient**: Only differences between snapshots are stored

### Requirements

- Host system with ZFS support
- Dedicated ZFS dataset for Dgraph
- Privileged container access (for ZFS commands)
- Sudo permissions for ZFS operations
## Security

- Rate limiting is applied to all endpoints
- CORS is configured for cross-origin requests
- Helmet.js provides security headers
- Input validation using Joi schemas
- Hive-based authentication for honeycomb nodes

### Hive Authentication

Honeygraph supports Hive blockchain-based authentication for honeycomb nodes:

1. **Enable Authentication**: Set `REQUIRE_HIVE_AUTH=true` in your environment
2. **Authorize Specific Nodes**: Set `AUTHORIZED_HONEYCOMB_NODES=account1,account2` (optional)
3. **WebSocket Authentication**: Nodes must sign a challenge with their Hive active key
4. **HTTP Authentication**: Use signed headers for REST API calls

Example WebSocket authentication flow:
```javascript
// Honeycomb node receives auth challenge
{ type: 'auth_required', challenge: { timestamp, nonce, nodeId } }

// Node signs and responds
const message = JSON.stringify({ account, challenge, timestamp });
const signature = privateKey.sign(sha256(message));
ws.send({ type: 'auth_response', account, signature, message });

// On success
{ type: 'auth_success', account, nodeId }
```

Example HTTP authentication:
```javascript
// Sign request with Hive private key
const headers = {
  'X-Hive-Account': 'your-account',
  'X-Hive-Signature': signature,
  'X-Hive-Timestamp': timestamp
};
```
