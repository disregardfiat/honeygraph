#!/bin/bash

# Import SPK Network State into Dgraph

set -e

echo "📥 SPK Network State Import"
echo "=========================="
echo ""

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

cd "$PROJECT_ROOT"

# Default state URL
DEFAULT_URL="https://spktest.dlux.io/state"
STATE_URL="${1:-$DEFAULT_URL}"

echo "State URL: $STATE_URL"
echo ""

# Check if Dgraph is running
echo "🔍 Checking Dgraph status..."
if ! curl -s http://dgraph-alpha:8080/health > /dev/null 2>&1; then
    echo "❌ Error: Dgraph is not running!"
    echo ""
    echo "Start Dgraph with:"
    echo "  docker-compose up -d dgraph-zero dgraph-alpha dgraph-ratel"
    echo ""
    echo "Or for a fresh start:"
    echo "  ./scripts/reset-dgraph.sh"
    exit 1
fi
echo "✅ Dgraph is running"
echo ""

# Check if schema is loaded
echo "📋 Checking schema..."
SCHEMA_CHECK=$(curl -sX POST http://dgraph-alpha:8080/query -H "Content-Type: application/dql" -d 'schema {}' | grep -c '"name":"Account"' || true)
if [ "$SCHEMA_CHECK" -eq 0 ]; then
    echo "⚠️  Warning: Schema not loaded or Account type not found"
    echo "Run ./scripts/update-schema.sh or ./scripts/reset-dgraph.sh first"
    exit 1
fi
echo "✅ Schema is loaded"
echo ""

# Check if npm packages are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Run the import
echo "🚀 Starting import..."
echo "This may take a few minutes depending on the state size..."
echo ""

node scripts/import-state.js "$STATE_URL"

echo ""
echo "✨ Import complete!"
echo ""
echo "📊 View your data:"
echo "  - Ratel UI: http://localhost:8000"
echo "  - GraphQL: http://localhost:4000/graphql"
echo ""
echo "🔍 Example queries to try in Ratel:"
echo ""
echo "# Get top accounts by LARYNX balance:"
echo "{"
echo "  accounts(func: gt(larynxBalance, 0), orderDesc: larynxBalance, first: 10) {"
echo "    username"
echo "    larynxBalance"
echo "  }"
echo "}"
echo ""
echo "# Get active storage contracts:"
echo "{"
echo "  contracts(func: eq(status, 3), first: 10) {"
echo "    id"
echo "    purchaser { username }"
echo "    fileCount"
echo "    utilized"
echo "  }"
echo "}"
echo ""