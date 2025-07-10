# Honeygraph Multi-Token Architecture

## Overview

The multi-token architecture for Honeygraph enables support for multiple honeycomb ecosystems (SPK, DLUX, LARYNX, BROCA, etc.) with complete namespace isolation and dynamic token management.

## Architecture

### Core Components

1. **MultiTokenManager** (`lib/multi-token-manager.js`)
   - Central manager for all token namespaces
   - Handles token registration/unregistration
   - Creates ZFS datasets per token
   - Manages schema and API loading

2. **TokenRegistry** (`lib/token-registry.js`)
   - Persistent storage of token configurations
   - Schema and API management
   - Token metadata and features

3. **PathwiseMulti** (`honeycomb-spkcc/pathwise-multi.js`)
   - Extended pathwise with namespace support
   - Isolated data storage per token
   - Cross-namespace operations

4. **Multi-Token Server** (`server-multi.js`)
   - Dynamic GraphQL endpoint generation
   - Per-token API routes
   - Unified health monitoring

## Features

### Namespace Isolation
- Each token has its own namespace prefix (e.g., `spk:`, `dlux:`)
- Separate ZFS datasets for data isolation
- Independent schemas and resolvers
- No data leakage between tokens

### Dynamic Token Management
- Add new tokens without server restart
- Hot-reload schemas and APIs
- Automatic ZFS dataset creation
- Token-specific configurations

### Flexible Schema System
- BYO (Bring Your Own) GraphQL schema per token
- Default schema templates provided
- Custom resolvers and types
- Schema versioning support

### ZFS Integration
- Automatic dataset creation per token
- Compression and performance optimization
- Snapshot support for backups
- Easy data migration

## Quick Start

### 1. Start the Multi-Token Server

```bash
cd /home/jr/dlux/honeygraph
docker-compose -f docker-compose.multi.yml up -d
```

### 2. Register a New Token

```bash
# Register SPK token
curl -X POST http://localhost:4000/registry/tokens \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "SPK",
    "name": "SPK Network",
    "description": "Decentralized Web3 Video Network",
    "contractAddress": "@spknetwork",
    "decimals": 3,
    "features": {
      "transfers": true,
      "balances": true,
      "staking": true,
      "rewards": true
    }
  }'
```

### 3. Access Token-Specific Endpoints

```bash
# GraphQL endpoint
http://localhost:4000/spk/graphql

# REST API
http://localhost:4000/spk/state
http://localhost:4000/spk/balance/alice
http://localhost:4000/spk/transfers
```

## API Reference

### Registry Endpoints

#### List All Tokens
```
GET /registry/tokens
```

#### Get Token Info
```
GET /registry/tokens/:symbol
```

#### Register Token
```
POST /registry/tokens
Body: {
  "symbol": "TOKEN",
  "name": "Token Name",
  "description": "Token Description",
  "contractAddress": "@contract",
  "decimals": 3,
  "features": {}
}
```

#### Update Token Config
```
PUT /registry/tokens/:symbol
Body: { ...updates }
```

#### Upload Custom Schema
```
POST /registry/tokens/:symbol/schema
Body: { "schema": "GraphQL schema string" }
```

#### Upload Custom API
```
POST /registry/tokens/:symbol/api
Body: { "api": "module.exports = function(router, tokenManager) { ... }" }
```

### Token-Specific Endpoints

Each registered token automatically gets:

#### GraphQL
```
POST /:token/graphql
```

#### REST API (customizable)
```
GET /:token/state
GET /:token/balance/:account
GET /:token/transfers
GET /:token/richlist
```

### Namespace Management

#### List Namespaces
```
GET /namespaces
```

#### Get Namespace Stats
```
GET /namespaces/:namespace/stats
```

#### Export Namespace Data
```
GET /namespaces/:namespace/export?format=json|csv
```

## Custom Schema Example

```graphql
# MYTOKEN Custom Schema
type MYTOKENState {
  supply: String!
  holders: Int!
  customField: String
}

type MYTOKENHolder {
  account: String!
  balance: String!
  stakedAmount: String
  rewards: String
}

type Query {
  mytokenState: MYTOKENState
  mytokenHolder(account: String!): MYTOKENHolder
  mytokenTopHolders(limit: Int = 100): [MYTOKENHolder!]!
}

type Mutation {
  mytokenClaim(account: String!): Boolean
}
```

## Custom API Example

```javascript
module.exports = function(router, tokenManager) {
  const token = tokenManager.getToken('MYTOKEN');
  const namespace = token.getPathwiseNamespace();

  // Custom endpoints
  router.get('/mytoken/stats', async (req, res) => {
    const stats = await namespace.get('stats');
    res.json(stats);
  });

  router.post('/mytoken/claim', async (req, res) => {
    const { account } = req.body;
    // Custom claim logic
    res.json({ success: true, amount: '100' });
  });

  return router;
};
```

## Production Deployment

### Environment Variables
```bash
NODE_ENV=production
PORT=4000
DATA_PATH=/data/honeygraph
POSTGRES_PASSWORD=secure_password
GRAFANA_PASSWORD=secure_password
```

### ZFS Pool Setup
```bash
# Create ZFS pool (adjust device as needed)
zpool create honeygraph /dev/nvme0n1p4

# Set properties
zfs set compression=lz4 honeygraph
zfs set atime=off honeygraph
```

### Monitoring

Access monitoring dashboards:
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000

### Backup Strategy

```bash
# Snapshot all token datasets
for token in SPK DLUX LARYNX BROCA; do
  zfs snapshot honeygraph/${token,,}@$(date +%Y%m%d)
done

# Send to backup location
zfs send honeygraph/spk@20240708 | ssh backup@server zfs recv backup/honeygraph/spk
```

## Security Considerations

1. **API Authentication**: Implement JWT or API key authentication
2. **Rate Limiting**: Add rate limiting per token/endpoint
3. **Input Validation**: Validate all schema and API uploads
4. **Network Isolation**: Use Docker networks for service isolation
5. **TLS/SSL**: Enable HTTPS in production

## Troubleshooting

### Token Registration Fails
- Check symbol format (3-10 uppercase alphanumeric)
- Verify contract address format (@username)
- Ensure unique symbol

### GraphQL Schema Errors
- Validate schema syntax
- Check for naming conflicts
- Ensure Query type exists

### ZFS Dataset Issues
- Verify ZFS is installed and pool exists
- Check permissions on /data/honeygraph
- Falls back to regular filesystem if ZFS unavailable

### Performance Issues
- Monitor with Grafana dashboards
- Check Redis connection
- Verify PostgreSQL indexes

## Future Enhancements

1. **Federation Support**: Connect multiple Honeygraph instances
2. **Schema Versioning**: Track and rollback schema changes
3. **Plugin System**: Allow third-party extensions
4. **WebSocket Support**: Real-time data subscriptions
5. **Cross-Token Queries**: Query multiple tokens in single request