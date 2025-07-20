# Honeygraph Write Stream Architecture

## Overview

The Honeygraph write stream system provides a robust, fork-aware replication layer with instant rollback capabilities for the SPK Network ecosystem. It employs WebSocket streams with checkpoint markers to accurately transform and persist data to Dgraph while maintaining the ability to undo writes and restart from different checkpoints.

## Core Components

### 1. WebSocket Fork Handler (`ws-fork-handler.js`)

The WebSocket Fork Handler manages incoming data streams from Honeycomb nodes and tracks multiple blockchain forks simultaneously.

#### Key Features:
- **Fork-Aware Processing**: Each fork identified by `pendingHash` (deterministically calculated)
- **Multi-Token Support**: Automatically detects SPK, LARYNX, BROCA networks
- **Authentication**: Optional Hive blockchain signature verification
- **Operation Buffering**: Configurable buffer size for recent operations
- **Checkpoint Validation**: Ensures proper write marker boundaries

#### Operation Types:
```javascript
// Supported message types
{
  "put": "Create or update data at path",
  "del": "Delete data at path", 
  "write_marker": "Mark end of operation batch",
  "checkpoint": "Checkpoint notification",
  "sendCheckpoint": "Checkpoint from honeycomb",
  "fork_start": "New fork notification",
  "fork_detected": "Fork switch notification"
}
```

#### Fork Management:
```javascript
// Fork data structure
{
  hash: "QmForkHash...",           // Unique fork identifier
  blockNum: 12345,                // Block number where fork starts
  startTime: 1640995200000,       // Fork creation timestamp
  lastUpdate: 1640995300000,      // Last activity timestamp
  nodes: Set(["node-1", "node-2"]), // Nodes tracking this fork
  operations: [...],              // Buffered operations
  operationCount: 150,            // Total operations processed
  lastWriteMarker: {...},         // Last write marker details
  isConfirmed: false              // Whether fork is confirmed canonical
}
```

### 2. ZFS Checkpoint Manager (`zfs-checkpoint.js`)

Provides instant rollback capability using ZFS snapshots at the filesystem level.

#### Key Features:
- **Instant Rollback**: Block-level rollback using ZFS snapshots
- **Automated Cleanup**: Configurable retention of old snapshots
- **Clone Support**: Create testing clones from checkpoints
- **Service Management**: Handles Dgraph service restart during rollback
- **Consistency Checks**: Validates snapshot integrity

#### Checkpoint Operations:
```javascript
// Create checkpoint
await zfsManager.createCheckpoint(blockNum, ipfsHash);
// Snapshot: rpool/dgraph@checkpoint_12345_QmTest123

// Rollback to checkpoint
await zfsManager.rollbackToCheckpoint(12345);

// Clone for testing
await zfsManager.cloneCheckpoint(12345, 'testing');
// Creates: rpool/dgraph_testing
```

#### Automatic Cleanup:
- Maintains configurable maximum number of snapshots
- Removes oldest snapshots when limit exceeded
- Preserves checkpoints referenced by active forks

### 3. Replication Queue (`replication-queue.js`)

Queue-based processing system using Redis and Bull for reliable operation handling.

#### Queue Jobs:
1. **`process-operation`**: Individual operations from WebSocket
2. **`process-checkpoint`**: Checkpoint notifications
3. **`replicate-block`**: Block-level replication
4. **`update-consensus`**: Fork consensus updates
5. **`create-checkpoint`**: Checkpoint creation

#### Job Processing Flow:
```
WebSocket Operation → Queue Job → Data Transform → Dgraph Write → Event Emit
```

#### Error Handling:
- Exponential backoff retry strategy
- Configurable retry attempts (default: 3)
- Dead letter queue for failed jobs
- Comprehensive logging and metrics

### 4. Data Transformation Pipeline

Transforms raw operations from Honeycomb into Dgraph-compatible format with rich schema.

#### Transformation Process:
1. **Operation Validation**: Verify operation structure and permissions
2. **Path Resolution**: Convert paths to Dgraph predicates
3. **Type Inference**: Apply appropriate Dgraph types
4. **Fork Context**: Add fork and block metadata
5. **Batch Optimization**: Group related operations

## Write Stream Flow

### 1. Initial Connection
```
Honeycomb Node → WebSocket Connect → Authentication (optional) → Network Identification
```

### 2. Fork Management
```
Fork Start → Operation Stream → Write Marker → Checkpoint Notification
```

### 3. Operation Processing
```
Raw Operation → Queue → Transform → Dgraph Write → State Update
```

### 4. Checkpoint Creation
```
LIB Block → ZFS Snapshot → Dgraph Checkpoint → Fork Cleanup
```

## Checkpoint System

### Write Marker Boundaries

Write markers indicate the end of an operation batch and are required for valid checkpoints:

```javascript
// Valid checkpoint boundary
[
  { type: 'put', blockNum: 12344, path: '/state/alice', data: {...} },
  { type: 'del', blockNum: 12344, path: '/state/bob' },
  { type: 'write_marker', blockNum: 12344, index: 10 }
]
// ✅ Checkpoint can be created at block 12345

// Invalid checkpoint boundary  
[
  { type: 'put', blockNum: 12344, path: '/state/alice', data: {...} },
  { type: 'write_marker', blockNum: 12344, index: 10 },
  { type: 'put', blockNum: 12344, path: '/state/charlie', data: {...} }
]
// ❌ Operations after write marker - checkpoint invalid
```

### Checkpoint Validation Rules

1. **Write Marker Required**: Last operation must be a write marker
2. **Block Boundary**: Write marker block must be checkpoint block - 1
3. **No Operations After**: No operations allowed after write marker
4. **Sequential Integrity**: Operations must be in correct order

### Rollback Process

1. **Stop Services**: Halt Dgraph to ensure data consistency
2. **ZFS Rollback**: Revert filesystem to snapshot state
3. **Cleanup Metadata**: Remove newer checkpoints from tracking
4. **Restart Services**: Start Dgraph and wait for readiness
5. **Validate State**: Ensure services are functioning correctly

## Fork Handling

### Fork Detection

Forks are detected when nodes report different hashes for the same block:

```javascript
// Node A reports
{ blockNum: 12345, hash: "QmForkA..." }

// Node B reports  
{ blockNum: 12345, hash: "QmForkB..." }

// Fork detected → Track both until consensus
```

### Fork Resolution

1. **Consensus Tracking**: Monitor which fork has most nodes
2. **LIB Confirmation**: Wait for Last Irreversible Block confirmation
3. **Canonical Selection**: Choose fork with network consensus
4. **Orphan Cleanup**: Remove non-canonical fork data

### Multi-Fork Support

- Track up to configurable maximum forks per block (default: 10)
- Automatic cleanup of low-adoption forks
- Separate operation buffers per fork
- Independent checkpoint creation per fork

## Network Support

### Multi-Token Architecture

Supports multiple SPK Network tokens with isolated data:

- **SPK**: Governance token operations
- **LARYNX**: Mining rewards and operations  
- **BROCA**: Storage credit operations
- **DLUX**: Legacy support

### Token Isolation

- Separate Dgraph namespaces per token
- Independent checkpoint management
- Isolated operation queues
- Token-specific authentication

## Error Handling and Recovery

### WebSocket Resilience

- **Connection Monitoring**: Heartbeat system with pong responses
- **Authentication Timeout**: 30-second auth window
- **Graceful Disconnection**: Proper cleanup on node disconnect
- **Fork Tracking**: Maintain fork state across reconnections

### Queue Reliability

- **Redis Persistence**: Durable job storage
- **Retry Logic**: Exponential backoff with jitter
- **Dead Letter Queue**: Failed job preservation
- **Monitoring**: Comprehensive metrics and alerting

### Checkpoint Recovery

- **Validation**: Pre-rollback consistency checks
- **Service Management**: Graceful service stop/start
- **Timeout Handling**: Service readiness verification
- **Fallback Strategy**: Recovery from older checkpoints if needed

## Performance Optimizations

### Operation Batching

- Buffer operations until write marker
- Batch similar operations together
- Minimize Dgraph transaction overhead
- Configurable batch sizes

### Memory Management

- LRU eviction of old operations
- Configurable buffer sizes
- Automatic cleanup of old forks
- Memory-efficient fork tracking

### ZFS Optimization

- Snapshot naming for quick identification
- Automatic cleanup of old snapshots
- Efficient diff operations
- Clone-on-write benefits

## Monitoring and Metrics

### Queue Metrics

```javascript
{
  waiting: 45,      // Jobs waiting to be processed
  active: 5,        // Currently processing jobs
  completed: 1250,  // Successfully completed jobs
  failed: 3,        // Failed jobs
  delayed: 0,       // Delayed jobs
  paused: 0         // Paused jobs
}
```

### Fork Statistics

```javascript
{
  totalForks: 12,           // Total tracked forks
  activeForks: 8,           // Forks with active nodes
  checkpoints: 156,         // Total checkpoints created
  forksByBlock: {           // Forks grouped by block
    "12345": {
      count: 2,
      confirmed: "QmCanonical...",
      forks: [...]
    }
  }
}
```

### Health Checks

- Dgraph service availability
- ZFS filesystem health
- Redis queue connectivity
- WebSocket connection status
- Fork consensus status

## Security Considerations

### Authentication

- Optional Hive blockchain signature verification
- Configurable authorized node list
- Challenge-response authentication
- Account-based access control

### Data Integrity

- Cryptographic operation hashing
- Fork hash verification
- Checkpoint boundary validation
- Operation ordering enforcement

### Access Control

- Per-token access isolation
- Node-based permissions
- Operation type restrictions
- Path-based access control

## Configuration

### Environment Variables

```bash
# Authentication
REQUIRE_HIVE_AUTH=true
AUTHORIZED_HONEYCOMB_NODES=spknetwork,larynxnetwork,brocatoken

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# ZFS Configuration
ZFS_DATASET=rpool/dgraph
ZFS_MAX_SNAPSHOTS=100

# Performance Tuning
MAX_FORKS_PER_BLOCK=10
OPERATION_BUFFER_SIZE=10000
FORK_RETENTION_TIME=3600000
```

### Runtime Configuration

```javascript
const config = {
  maxForksPerBlock: 10,
  forkRetentionTime: 3600000,  // 1 hour
  operationBufferSize: 10000,
  snapshotPrefix: 'checkpoint',
  maxSnapshots: 100,
  queueRetries: 3,
  batchSize: 100
};
```

## Future Enhancements

### Planned Features

1. **Peer Synchronization**: Automatic catch-up from healthy peers
2. **Consensus Voting**: Multi-node checkpoint validation
3. **Incremental Snapshots**: More efficient storage usage
4. **Cross-Chain Support**: Additional blockchain integration
5. **GraphQL API**: Real-time query capabilities
6. **Distributed Locks**: Coordination across multiple instances

### Performance Improvements

1. **Operation Compression**: Reduce memory usage
2. **Parallel Processing**: Multi-threaded operation handling
3. **Smart Batching**: Dynamic batch size optimization
4. **Caching Layer**: Frequently accessed data caching
5. **Connection Pooling**: Optimized database connections

## Troubleshooting

### Common Issues

1. **Missing Write Markers**: Operations without proper boundaries
2. **Fork Proliferation**: Too many concurrent forks
3. **ZFS Space**: Insufficient storage for snapshots
4. **Service Timeouts**: Dgraph slow to restart
5. **Queue Backlog**: Processing falling behind

### Diagnostic Commands

```bash
# Check ZFS snapshots
zfs list -t snapshot | grep checkpoint

# Monitor queue status
redis-cli monitor

# Check Dgraph health
curl http://localhost:8080/health

# View fork statistics
curl http://localhost:3000/api/forks/stats
```

### Recovery Procedures

1. **Manual Rollback**: Direct ZFS snapshot rollback
2. **Queue Replay**: Reprocess failed operations
3. **Fork Cleanup**: Remove orphaned fork data
4. **Service Restart**: Full system restart sequence
5. **Data Validation**: Verify state consistency

This architecture provides a robust foundation for the SPK Network's data replication needs while maintaining flexibility for future enhancements and scalability requirements.