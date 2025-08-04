# Honeygraph Multi-Tenant DGraph Deployment Guide

## Overview

Honeygraph is a multi-tenant DGraph database system designed for blockchain data management. It supports multiple blockchain networks (EVM clones), sharded account storage, and optional ZFS integration for fork management.

## Architecture

### Components

1. **DGraph Cluster**
   - Zero: Coordinator node
   - Alpha nodes: Data storage nodes (3 replicas by default)
   - Ratel: Web UI for DGraph management

2. **Honeygraph API**
   - Express.js API server
   - WebSocket support for real-time data
   - Multi-instance support with load balancing

3. **Supporting Services**
   - Redis: Queue management and caching
   - HAProxy: DGraph load balancing
   - Nginx: API load balancing

4. **Optional Components**
   - ZFS: Snapshot-based fork management

## Quick Start

### Prerequisites

- Docker and Docker Compose
- 8GB+ RAM recommended
- 50GB+ disk space
- (Optional) ZFS filesystem

### Single Node Deployment

```bash
# Clone the repository
git clone <repository-url>
cd honeygraph

# Start services
chmod +x scripts/startup.sh
./scripts/startup.sh

# View logs
docker-compose logs -f
```

### Multi-Tenant Deployment

```bash
# Set environment variables
export MULTI_TENANT=true
export NETWORKS="spkccT_,spkcc_,dlux_"

# Start services
./scripts/startup.sh

# Import initial data
docker-compose exec honeygraph-api1 node scripts/import-blockchain-data.js
```

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# DGraph Configuration
DGRAPH_URL=http://localhost:9080
DROP_ALL=false

# API Configuration
API_PORT=3030
JWT_SECRET=your-secret-key-here
CORS_ORIGIN=*

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379

# Authentication
REQUIRE_HIVE_AUTH=true
AUTHORIZED_HONEYCOMB_NODES=testnode1,spknode,honeycomb-test

# Multi-Tenant Configuration
NETWORKS=spkccT_,spkcc_,dlux_
BATCH_SIZE=1000

# ZFS Configuration (optional)
ZFS_CHECKPOINTS_ENABLED=false
ZFS_DATASET=honeygraph/data
ZFS_MAX_SNAPSHOTS=100

# Data Import
HONEYCOMB_URL=http://spktest.dlux.io
START_BLOCK=0
END_BLOCK=0
```

### Network Configuration

Networks are configured in `lib/network-manager.js`. Default networks:

- `spkccT_`: SPK Test Network
- `spkcc_`: SPK Main Network  
- `dlux_`: DLUX Network

To add a new network:

```javascript
const newNetwork = {
  prefix: 'mynet_',
  name: 'My Network',
  description: 'Custom blockchain network',
  tokens: [
    {
      symbol: 'TOKEN',
      name: 'My Token',
      precision: 3
    }
  ]
};
```

## Data Management

### Schema

The multi-tenant schema is defined in `schema/base-schema.dgraph`:

- **Network**: Blockchain network definitions
- **Account**: Shared account data across networks
- **NetworkAccount**: Network-specific account data
- **Balance**: Token balances per network
- **Operation**: Blockchain operations/transactions
- **Fork**: Fork management
- **Checkpoint**: State checkpoints

### Data Import

Import blockchain data using the import script:

```bash
# Import from Honeycomb nodes
docker-compose exec honeygraph-api1 node scripts/import-blockchain-data.js

# Import from file
export DATA_SOURCE=file
export DATA_FILE=/path/to/data.json
docker-compose exec honeygraph-api1 node scripts/import-blockchain-data.js
```

### Account Sharding

Accounts are automatically sharded across 3 shards using consistent hashing:

```javascript
// Shard determination
const shard = sha256(accountName) % 3

// Sharded predicates
balance_s0.amount  // Shard 0
balance_s1.amount  // Shard 1
balance_s2.amount  // Shard 2
```

## Operations

### Health Checks

```bash
# API health
curl http://localhost:3030/health

# DGraph health
curl http://localhost:8080/health

# HAProxy stats (multi-tenant mode)
curl http://localhost:8404/stats
```

### Monitoring

Monitor key metrics:

```bash
# Check replication queue
curl http://localhost:3030/api/queue/metrics

# Check network statistics
curl http://localhost:3030/api/networks/stats

# WebSocket connections
curl http://localhost:3030/health | jq .websocket
```

### Backup and Recovery

#### DGraph Backup

```bash
# Create backup
docker-compose exec dgraph-alpha1 dgraph backup \
  --location /dgraph/backups \
  --zero dgraph-zero:5080

# Restore backup
docker-compose exec dgraph-alpha1 dgraph restore \
  --location /dgraph/backups \
  --zero dgraph-zero:5080
```

#### ZFS Snapshots (if enabled)

```bash
# List snapshots
zfs list -t snapshot honeygraph/data

# Create manual snapshot
zfs snapshot honeygraph/data@manual_$(date +%Y%m%d_%H%M%S)

# Rollback to snapshot
zfs rollback honeygraph/data@checkpoint_12345_abcd1234
```

### Scaling

#### Horizontal Scaling

1. Add more API instances:
```yaml
honeygraph-api3:
  extends: honeygraph-api1
  container_name: honeygraph-api3
  ports:
    - "3032:3030"
```

2. Update Nginx configuration to include new instances

3. Add more DGraph Alpha nodes:
```yaml
dgraph-alpha4:
  extends: dgraph-alpha1
  container_name: honeygraph-alpha4
  ports:
    - "8083:8080"
    - "9083:9080"
```

#### Vertical Scaling

Adjust resource limits in docker-compose:

```yaml
services:
  dgraph-alpha1:
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 8G
```

## Troubleshooting

### Common Issues

1. **DGraph connection failed**
   ```bash
   # Check DGraph logs
   docker-compose logs dgraph-alpha1
   
   # Verify network connectivity
   docker-compose exec honeygraph-api1 curl http://dgraph-alpha1:8080/health
   ```

2. **Schema initialization failed**
   ```bash
   # Re-run schema initialization
   docker-compose exec honeygraph-api1 node scripts/init-schema.js
   
   # Check for schema conflicts
   docker-compose exec dgraph-alpha1 dgraph schema -l
   ```

3. **Data import errors**
   ```bash
   # Check Redis queue
   docker-compose exec redis redis-cli
   > LLEN bull:replication:wait
   
   # Clear failed jobs
   docker-compose exec honeygraph-api1 node scripts/clear-queue.js
   ```

### Debug Mode

Enable debug logging:

```bash
export DEBUG=honeygraph:*
docker-compose up
```

### Performance Tuning

1. **DGraph optimization**
   - Adjust cache sizes in alpha nodes
   - Enable compression: `--compression zstd:3`
   - Tune badger options

2. **Redis optimization**
   - Set appropriate maxmemory policy
   - Enable persistence for critical data

3. **Network optimization**
   - Use dedicated network for DGraph cluster
   - Enable compression in HAProxy

## Security

### Authentication

1. Enable Hive authentication:
   ```env
   REQUIRE_HIVE_AUTH=true
   AUTHORIZED_HONEYCOMB_NODES=node1,node2
   ```

2. Set strong JWT secret:
   ```env
   JWT_SECRET=$(openssl rand -base64 32)
   ```

### Network Security

1. Use firewall rules to restrict access
2. Enable TLS for external connections
3. Use Docker networks for service isolation

### Data Security

1. Enable encryption at rest
2. Regular backups
3. Access control via DGraph ACL

## Maintenance

### Regular Tasks

1. **Daily**
   - Check health endpoints
   - Monitor disk usage
   - Review error logs

2. **Weekly**
   - Prune old snapshots
   - Clean Redis cache
   - Update blockchain data

3. **Monthly**
   - Full backup
   - Performance review
   - Security audit

### Upgrades

1. **DGraph upgrade**
   ```bash
   # Backup data first!
   docker-compose exec dgraph-alpha1 dgraph backup ...
   
   # Update image version
   # Edit docker-compose.yml
   
   # Restart services
   docker-compose down
   docker-compose up -d
   ```

2. **API upgrade**
   ```bash
   # Build new image
   docker-compose build honeygraph-api1
   
   # Rolling restart
   docker-compose up -d honeygraph-api1
   # Wait for health
   docker-compose up -d honeygraph-api2
   ```

## Support

For issues and questions:

1. Check logs: `docker-compose logs [service]`
2. Review documentation
3. Check health endpoints
4. Contact support team

## License

[License information here]