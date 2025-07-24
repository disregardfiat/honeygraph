#!/bin/bash

# Reset Dgraph for Honeygraph
# This script clears all Dgraph data and starts fresh containers
# Schema loading should be done by init scripts (e.g., init-spk-testnet.js)

set -e  # Exit on error

echo "🔄 Honeygraph Dgraph Reset Script"
echo "================================="
echo ""
echo "⚠️  WARNING: This will DELETE all Dgraph data!"
echo "Press Ctrl+C to cancel, or Enter to continue..."
read

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "📁 Project root: $PROJECT_ROOT"

# Check if docker-compose.yml exists
if [ ! -f "$PROJECT_ROOT/docker-compose.yml" ]; then
    echo "❌ Error: docker-compose.yml not found in $PROJECT_ROOT"
    exit 1
fi

cd "$PROJECT_ROOT"

echo ""
echo "1️⃣  Stopping Dgraph containers..."
docker compose down -v  # -v removes volumes

echo ""
echo "2️⃣  Removing Dgraph volumes..."
# Remove named volumes if they exist
docker volume rm honeygraph_dgraph_data 2>/dev/null || true
docker volume rm honeygraph_dgraph_zero 2>/dev/null || true

# Remove any local data directories
echo ""
echo "3️⃣  Cleaning local data directories..."
rm -rf ./dgraph 2>/dev/null || true
rm -rf ./data 2>/dev/null || true
rm -rf ./p 2>/dev/null || true
rm -rf ./w 2>/dev/null || true
rm -rf ./zw 2>/dev/null || true

echo ""
echo "4️⃣  Starting fresh Dgraph containers..."
docker compose up -d dgraph-zero dgraph-alpha dgraph-ratel

echo ""
echo "5️⃣  Waiting for Dgraph to be ready..."
# Wait for Dgraph to be ready
MAX_ATTEMPTS=30
ATTEMPT=1
while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    if docker exec honeygraph-alpha curl -s http://localhost:8080/health > /dev/null 2>&1; then
        echo "✅ Dgraph is ready!"
        break
    fi
    echo "   Attempt $ATTEMPT/$MAX_ATTEMPTS - Dgraph not ready yet, waiting..."
    sleep 2
    ATTEMPT=$((ATTEMPT + 1))
done

if [ $ATTEMPT -gt $MAX_ATTEMPTS ]; then
    echo "❌ Error: Dgraph failed to start within 60 seconds"
    exit 1
fi

echo ""
echo "6️⃣  Starting Honeygraph application..."
docker compose up -d

echo ""
echo "✨ Dgraph has been reset successfully!"
echo ""
echo "📊 Dgraph Ratel UI: http://localhost:8000 (not exposed externally)"
echo "🔍 Dgraph Alpha: http://localhost:8080 (not exposed externally)"
echo "🌐 Honeygraph API: http://localhost:3030"
echo ""
echo "Next steps:"
echo "1. Initialize the SPK testnet schema and data:"
echo "   docker exec honeygraph-api node scripts/init-spk-testnet.js"
echo "2. Or import from a specific state file:"
echo "   docker exec honeygraph-api node scripts/import-state.js"
echo "3. Verify the schema in Ratel UI"
echo ""