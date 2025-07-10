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

## Quick Start

1. **Start the services**:
```bash
docker-compose up -d
```

2. **Initialize the schema**:
```bash
docker-compose exec honeygraph-api npm run init-schema
```

3. **Check health**:
```bash
curl http://localhost:3030/health
```

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

## Performance

- Dgraph provides sub-millisecond query times
- Bull queue ensures reliable processing
- Batch operations reduce overhead
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