# Honeygraph Scripts

This directory contains utility scripts for managing Honeygraph and Dgraph.

## Scripts

### 🔄 reset-dgraph.sh
**Complete reset of Dgraph data and schema**

```bash
./scripts/reset-dgraph.sh
```

This script will:
- Stop all containers
- Delete all Dgraph volumes and data
- Start fresh Dgraph instances
- Load the new schema
- Start all services

⚠️ **WARNING**: This deletes ALL data! Use when:
- First time setup
- Major schema changes that break compatibility
- Development/testing environment reset

### 📝 update-schema.sh
**Update schema without losing data**

```bash
./scripts/update-schema.sh
```

This script will:
- Check Dgraph is running
- Create a backup of current schema
- Apply the new schema
- Verify the update

✅ **Safe to use**: Existing data is preserved. Use when:
- Adding new types or fields
- Modifying indexes
- Minor schema updates

### 🔍 check-status.sh
**Check system status**

```bash
./scripts/check-status.sh
```

This script will show:
- Docker container status
- Dgraph health
- Schema information
- Data directory sizes
- Volume information
- Service URLs

### 📥 import-state.sh
**Import complete SPK Network state**

```bash
# Import from default SPK testnet
./scripts/import-state.sh

# Import from custom URL
./scripts/import-state.sh https://spktest.dlux.io/state
```

This script will:
- Download the current state from an SPK node
- Convert state to operations
- Transform using data transformer
- Batch import into Dgraph
- Show progress and statistics

⏱️ **Time**: Takes 2-5 minutes depending on state size

### 🧪 quick-import-sample.sh
**Import sample data for testing**

```bash
./scripts/quick-import-sample.sh
```

This script will create:
- 3 sample accounts with balances
- 2 storage contracts
- 2 transactions
- 1 DEX market with order

✅ **Fast**: Takes just a few seconds

## Schema Location

The scripts look for schema files in this order:
1. `./schema/spk-schema-cleaned.graphql` (preferred)
2. `./schema/schema.graphql`
3. `./dgraph-schema.graphql`

## Common Workflows

### Fresh Development Setup
```bash
# 1. Reset everything
./scripts/reset-dgraph.sh

# 2. Check status
./scripts/check-status.sh

# 3. Import current state (optional)
./scripts/import-state.sh

# 4. Start syncing for new blocks
npm run sync
```

### Quick Testing Setup
```bash
# 1. Reset Dgraph
./scripts/reset-dgraph.sh

# 2. Import sample data
./scripts/quick-import-sample.sh

# 3. Test queries in Ratel
open http://localhost:8000
```

### Production-like Setup
```bash
# 1. Reset and prepare
./scripts/reset-dgraph.sh

# 2. Import full state
./scripts/import-state.sh https://spktest.dlux.io/state

# 3. Start continuous sync
npm run sync
```

### Apply Schema Changes
```bash
# 1. Edit your schema file
vim schema/spk-schema-cleaned.graphql

# 2. Update schema (keeps data)
./scripts/update-schema.sh

# OR

# 2. Reset everything (deletes data)
./scripts/reset-dgraph.sh
```

### Troubleshooting
```bash
# Check what's running
./scripts/check-status.sh

# If Dgraph isn't running
docker-compose up -d dgraph-zero dgraph-alpha dgraph-ratel

# View logs
docker-compose logs -f dgraph-alpha
```

## Docker Volumes

Honeygraph uses Docker volumes for persistence:
- `honeygraph_dgraph_data` - Dgraph Alpha data
- `honeygraph_dgraph_zero` - Dgraph Zero data

The `reset-dgraph.sh` script removes these volumes for a clean start.

## Notes

- Dgraph Ratel UI: http://localhost:8000
- Dgraph Alpha: http://localhost:8080  
- Dgraph Zero: http://localhost:6080
- Honeygraph API: http://localhost:4000

Always backup important data before running reset scripts!