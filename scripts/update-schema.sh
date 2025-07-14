#!/bin/bash

# Update Dgraph Schema for Honeygraph
# This script updates the schema without deleting data

set -e  # Exit on error

echo "📝 Honeygraph Schema Update Script"
echo "=================================="
echo ""

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "📁 Project root: $PROJECT_ROOT"

cd "$PROJECT_ROOT"

echo ""
echo "1️⃣  Checking Dgraph status..."
if ! curl -s http://localhost:8180/health > /dev/null; then
    echo "❌ Error: Dgraph is not running!"
    echo "Start it with: docker-compose up -d dgraph-zero dgraph-alpha"
    exit 1
fi
echo "✅ Dgraph is running"

echo ""
echo "2️⃣  Locating schema file..."
SCHEMA_FILE="$PROJECT_ROOT/schema/spk-schema-cleaned.graphql"
if [ ! -f "$SCHEMA_FILE" ]; then
    echo "   ⚠️  Schema file not found: $SCHEMA_FILE"
    echo "   Looking for alternative schema files..."
    
    if [ -f "$PROJECT_ROOT/schema/schema.graphql" ]; then
        SCHEMA_FILE="$PROJECT_ROOT/schema/schema.graphql"
    elif [ -f "$PROJECT_ROOT/dgraph-schema.graphql" ]; then
        SCHEMA_FILE="$PROJECT_ROOT/dgraph-schema.graphql"
    else
        echo "   ❌ No schema file found!"
        exit 1
    fi
fi

echo "   Using schema file: $SCHEMA_FILE"

echo ""
echo "3️⃣  Creating schema backup..."
BACKUP_FILE="$PROJECT_ROOT/schema/schema-backup-$(date +%Y%m%d-%H%M%S).graphql"
curl -s http://localhost:8180/admin/schema > "$BACKUP_FILE"
echo "   Backup saved to: $BACKUP_FILE"

echo ""
echo "4️⃣  Updating schema..."
echo "   Note: This may show warnings for existing types - that's normal"
echo ""

# Update the schema
RESPONSE=$(curl -sX POST localhost:8180/admin/schema --data-binary "@$SCHEMA_FILE" 2>&1)

if [ $? -eq 0 ]; then
    echo "✅ Schema update completed!"
    echo ""
    echo "Response:"
    echo "$RESPONSE" | head -20
    if [ $(echo "$RESPONSE" | wc -l) -gt 20 ]; then
        echo "   ... (truncated)"
    fi
else
    echo "❌ Failed to update schema"
    echo "$RESPONSE"
    exit 1
fi

echo ""
echo "5️⃣  Verifying schema..."
# Get current schema and check if our types exist
CURRENT_SCHEMA=$(curl -s http://localhost:8180/admin/schema)
if echo "$CURRENT_SCHEMA" | grep -q "type Account"; then
    echo "✅ Schema verification passed - Account type found"
else
    echo "⚠️  Warning: Could not verify schema update"
fi

echo ""
echo "✨ Schema update complete!"
echo ""
echo "📊 Check the schema in Ratel UI: http://localhost:8000"
echo "   Go to: Schema → Types & Fields"
echo ""
echo "💡 Tips:"
echo "   - Existing data is preserved"
echo "   - New fields will be null for existing records"
echo "   - Indexes may take time to build for large datasets"
echo ""