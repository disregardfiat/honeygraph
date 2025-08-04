# Honeygraph Architecture - Decentralized Read Replication

## Overview

Honeygraph solves the problem of maintaining consistent read replicas in a decentralized blockchain network where nodes can go offline and come back with gaps in their data.

## Key Components

### 1. Peer Synchronization

When a honeycomb node goes offline and returns, honeygraph can:
- **Detect Gaps**: Identify missing blocks in the local database
- **Peer Discovery**: Find other honeygraph nodes in the network
- **Gap Filling**: Fetch missing blocks from healthy peers
- **Consensus Verification**: Verify blocks against multiple peers

### 2. Multi-Source Truth

```
Honeycomb Node 1 → Honeygraph 1 ←─┐
                                   ├─→ Dgraph Cluster
Honeycomb Node 2 → Honeygraph 2 ←─┘    (Shared State)
                                   
Honeycomb Node 3 → Honeygraph 3 ───→ Peer Sync
```

### 3. Dgraph Federation Options

#### Option A: Shared Dgraph Cluster
- Multiple honeygraph instances write to same Dgraph cluster
- Dgraph handles consistency with RAFT consensus
- Pros: Simple, automatic consistency
- Cons: Single point of failure

#### Option B: Independent Dgraph + Peer Sync
- Each honeygraph has its own Dgraph instance
- Peer sync fills gaps when nodes come back online
- Pros: True decentralization, no SPOF
- Cons: More complex, potential for divergence

#### Option C: Hybrid (Recommended)
- Regional Dgraph clusters for redundancy
- Peer sync between regions
- ZFS snapshots for fast recovery

## Gap Synchronization Process

### 1. Gap Detection
```javascript
// Detect missing blocks
const gaps = await peerSync.detectGaps(lastKnownBlock, currentNetworkHead);
// Result: [{start: 1000, end: 1050, size: 50}, ...]
```

### 2. Peer Discovery
```javascript
// Discover peers from honeycomb network
await peerSync.discoverPeers(honeycombNodes);
// Also exchange peer lists with known peers
```

### 3. Block Fetching
- Query multiple peers in parallel
- Verify block consensus
- Import verified blocks
- Update peer reliability scores

### 4. Verification
- Check block hash matches
- Verify IPFS state hash
- Confirm operation ordering
- Validate against known checkpoints

## Handling Edge Cases

### Case 1: Extended Offline Period
When offline for days/weeks:
1. Find nearest checkpoint
2. Optionally rollback to checkpoint using ZFS
3. Sync forward from checkpoint
4. Verify final state matches network

### Case 2: Network Partition
When network splits:
1. Each partition continues independently
2. On rejoin, detect divergence
3. Follow longest/heaviest chain
4. Orphan minority fork

### Case 3: Corrupted Local State
When local data corrupted:
1. Detect via state hash mismatch
2. Rollback to last good checkpoint (ZFS)
3. Re-sync from peers
4. Rebuild state

## API Endpoints for Sync

### Sync Management
- `GET /api/sync/status` - Current sync status
- `POST /api/sync/peers` - Register new peer
- `GET /api/sync/gaps` - Detect missing blocks
- `POST /api/sync/sync-gaps` - Fill specific gaps
- `POST /api/sync/sync-from/:block` - Force sync from block

### Peer Operations
- `GET /api/sync/peers` - List known peers
- `POST /api/sync/discover` - Discover new peers
- `GET /api/sync/consensus/:block` - Check block consensus

### Block Export (for peers)
- `GET /api/query/block/:num/full` - Export complete block
- `GET /api/query/head` - Get blockchain head
- `GET /api/honeygraph-peers` - List known peers

## Configuration

### Environment Variables
```env
# Enable peer sync
SYNC_ENABLED=true
SYNC_INTERVAL=30000

# Initial peers
PEERS=http://peer1:3030,http://peer2:3030

# Node identity
PEER_ID=node1

# Dgraph mode
DGRAPH_MODE=shared|independent|hybrid
```

### Docker Deployment

#### Single Dgraph (Shared)
```bash
docker-compose up -d
```

#### Multi-Node Dgraph (Federated)
```bash
docker-compose -f docker-compose.multi.yml up -d
```

#### With ZFS (Fast Recovery)
```bash
docker-compose -f docker-compose.zfs.yml up -d
```

## Reliability Features

### 1. Peer Scoring
- Track success/failure rates
- Exponential moving average
- Prefer reliable peers
- Blacklist dead peers

### 2. Parallel Fetching
- Query multiple peers simultaneously
- Use first valid response
- Cross-verify important blocks

### 3. Checkpoint Anchoring
- Regular checkpoints at LIB
- ZFS snapshots for instant recovery
- IPFS hash verification

### 4. Graceful Degradation
- Continue if some peers fail
- Work with partial data
- Queue failed syncs for retry

## Performance Optimization

### 1. Batch Operations
- Fetch multiple blocks per request
- Bulk import transactions
- Parallel peer queries

### 2. Caching
- Cache peer responses
- Remember peer reliability
- Store recent block hashes

### 3. Smart Sync
- Prioritize recent blocks
- Skip finalized blocks
- Focus on active forks

## Security Considerations

### 1. Peer Authentication
- Optional API keys
- Peer identity verification
- Rate limiting per peer

### 2. Data Validation
- Verify all block hashes
- Check operation signatures
- Validate state transitions

### 3. Fork Protection
- Track canonical fork
- Verify against consensus
- Limit reorganization depth

## Monitoring

### Metrics to Track
- Sync lag (blocks behind)
- Peer availability
- Sync success rate
- Gap detection frequency
- Network partitions

### Alerts
- Large gaps detected
- All peers offline
- Sync failures
- State hash mismatches
- Fork divergence