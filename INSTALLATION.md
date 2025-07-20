# Honeygraph Installation Guide

Honeygraph is a Dgraph-based read replication service for SPK Network that provides GraphQL APIs and filesystem access to blockchain data.

## Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for running import scripts)
- At least 4GB RAM
- 10GB+ disk space for data storage

## Quick Start

### 1. Clone and Setup

```bash
# Clone the repository
git clone <repository-url>
cd honeygraph

# Install dependencies
npm install
```

### 2. Start Services

```bash
# Start all services (Dgraph, Redis, API)
docker-compose up -d

# Check service health
docker-compose ps

# View logs
docker-compose logs -f honeygraph-api
```

Services will be available at:
- **API**: http://localhost:3030 (only external port exposed)
- **Internal services** communicate through Docker network:
  - Dgraph Alpha: internal Docker network only
  - Dgraph Ratel UI: internal Docker network only  
  - Redis: internal Docker network only

### 3. Import Initial State Data

The SPK Network state must be imported to populate the database with real data:

```bash
# Import current state from SPK Network (run inside Docker container)
docker exec honeygraph-api node scripts/import-state.js

# Or import from a custom state endpoint
docker exec honeygraph-api node scripts/import-state.js https://your-spk-node.com/state
```

**Note**: The import may show some parsing errors for certain data types - this is normal and won't affect the core functionality.

### 4. Verify Data Import

Check that data was imported successfully:

```bash
# Test filesystem API
curl http://localhost:3030/fs/disregardfiat/

# Check health endpoint
curl http://localhost:3030/health

# Query GraphQL
curl -X POST http://localhost:3030/api/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ __schema { queryType { name } } }"}'

# Check available networks
curl http://localhost:3030/api/networks

# Check specific network info
curl http://localhost:3030/api/network/spkccT_/info
```

## API Endpoints

### Filesystem API
- `GET /fs/:username/` - List user's root directory
- `GET /fs/:username/path/to/file` - Get file or directory
- `GET /fse/:username/` - Files shared with user (encrypted)
- `GET /fss/:username/` - Files shared by user

### GraphQL API
- `POST /api/graphql` - Main GraphQL endpoint
- `GET /api/graphql` - GraphQL schema introspection

### Multi-Token Network API
- `GET /api/networks` - List all networks
- `GET /api/network/{prefix}/info` - Network information
- `GET /api/token/{symbol}/info` - Token information

### Other APIs
- `GET /health` - Service health check
- `GET /api/v1/accounts/:username` - Account details
- `POST /api/v1/query` - Direct Dgraph queries

## Configuration

### Environment Variables

Create a `.env` file for custom configuration:

```env
# API Configuration
API_PORT=3030
NODE_ENV=production

# Dgraph Configuration
DGRAPH_URL=http://dgraph-alpha:9080

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379

# Authentication
JWT_SECRET=your-secret-key-here

# IPFS Gateway (for file redirects)
IPFS_GATEWAY=https://ipfs.io
```

### Docker Compose Profiles

- **Default**: Basic setup with single token support
- **Multi-token**: `docker-compose -f docker-compose.multi.yml up`
- **Production**: `docker-compose -f docker-compose.production.yml up`

## Troubleshooting

### Common Issues

1. **"No data showing in filesystem API"**
   - Ensure state import completed successfully
   - Check that contracts have status=3 (active)
   - Verify contract metadata parsing

2. **"ZFS dataset errors during import"**
   - These can be safely ignored if not using ZFS
   - Data will still be imported correctly

3. **"Import parsing errors"**
   - Some complex data types may fail to parse
   - Core contract and file data should import correctly
   - Check logs for specific error details

4. **"Duplicate contracts showing"**
   - This can happen with multiple imports
   - Use `scripts/reset-dgraph.sh` to clear and reimport

### Reset and Reimport

If you need to start fresh:

```bash
# Stop services
docker-compose down

# Clear all data
rm -rf data/

# Restart and reimport
docker-compose up -d
node scripts/import-state.js
```

## Development

### Running Locally (without Docker)

```bash
# Start Dgraph separately
dgraph zero --my=localhost:5080
dgraph alpha --my=localhost:7080 --zero=localhost:5080

# Start Redis
redis-server

# Run API server
npm start
```

### Adding Custom Schemas

Place custom token schemas in `schema/custom/`:
- `schema/custom/YOUR_TOKEN.dgraph` - Dgraph schema
- `schema/custom/YOUR_TOKEN.graphql` - GraphQL schema

## Monitoring

### Check Import Status

```bash
# Count total accounts
curl -X POST http://localhost:8180/query -H "Content-Type: application/dql" \
  -d '{ q(func: has(username)) { count(uid) } }' | jq .

# Count contracts
curl -X POST http://localhost:8180/query -H "Content-Type: application/dql" \
  -d '{ q(func: type(StorageContract)) { count(uid) } }' | jq .

# Check specific user
curl http://localhost:3030/api/v1/accounts/disregardfiat | jq .
```

### View Logs

```bash
# API logs
docker logs honeygraph-api -f

# Dgraph logs
docker logs honeygraph-alpha -f

# Import script logs
# Check honeygraph.log file
```

## Next Steps

1. **Set up continuous sync** with SPK Network nodes (WebSocket streaming)
2. **Configure authentication** for write operations if needed
3. **Set up monitoring** and alerting for production
4. **Optimize queries** for your use case
5. **Configure live data streaming** from Honeycomb nodes

## Live Data Streaming from Honeycomb

To connect Honeygraph to a live Honeycomb node for real-time data streaming, configure the Honeycomb node to send data to your Honeygraph instance:

```javascript
// In your Honeycomb node configuration
{
  "honeygraph": {
    "enabled": true,
    "url": "http://your-honeygraph-instance:3030",
    "batchSize": 100,
    "flushInterval": 1000
  }
}
```

This will enable real-time blockchain data streaming from your Honeycomb node to Honeygraph.

For more information, see:
- [Architecture Overview](ARCHITECTURE.md)
- [API Documentation](docs/api-migration-guide.md)
- [Query Examples](QUERY_EXAMPLES.md)