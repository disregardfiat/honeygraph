#!/bin/bash

# Check Honeygraph and Dgraph Status

echo "🔍 Honeygraph Status Check"
echo "========================="
echo ""

# Check Docker containers
echo "📦 Docker Containers:"
docker-compose ps
echo ""

# Check Dgraph health
echo "🏥 Dgraph Health:"
if curl -s http://localhost:8080/health > /dev/null 2>&1; then
    echo "✅ Dgraph Alpha is healthy (http://localhost:8080)"
else
    echo "❌ Dgraph Alpha is not responding"
fi

if curl -s http://localhost:6080/health > /dev/null 2>&1; then
    echo "✅ Dgraph Zero is healthy (http://localhost:6080)"
else
    echo "❌ Dgraph Zero is not responding"
fi
echo ""

# Check schema
echo "📋 Schema Status:"
SCHEMA_RESPONSE=$(curl -s http://localhost:8080/admin/schema 2>/dev/null)
if [ -n "$SCHEMA_RESPONSE" ]; then
    # Count types
    TYPE_COUNT=$(echo "$SCHEMA_RESPONSE" | grep -c "^type " || true)
    echo "✅ Schema loaded with $TYPE_COUNT types"
    
    # Check for our key types
    echo "   Key types:"
    for TYPE in "Account" "StorageContract" "Transaction" "DexOrder" "NodeMarketBid"; do
        if echo "$SCHEMA_RESPONSE" | grep -q "type $TYPE"; then
            echo "   ✅ $TYPE"
        else
            echo "   ❌ $TYPE (missing)"
        fi
    done
else
    echo "❌ Could not retrieve schema"
fi
echo ""

# Check data directories
echo "💾 Data Directories:"
for DIR in dgraph data p w zw; do
    if [ -d "./$DIR" ]; then
        SIZE=$(du -sh ./$DIR 2>/dev/null | cut -f1)
        echo "   📁 ./$DIR ($SIZE)"
    fi
done
echo ""

# Check volumes
echo "🗄️  Docker Volumes:"
docker volume ls | grep honeygraph || echo "   No honeygraph volumes found"
echo ""

# Check if Honeygraph app is running
echo "🌐 Honeygraph API:"
if curl -s http://localhost:4000/health > /dev/null 2>&1; then
    echo "✅ Honeygraph API is running (http://localhost:4000)"
else
    echo "❌ Honeygraph API is not responding"
fi
echo ""

echo "📊 Quick Links:"
echo "   Dgraph Ratel UI: http://localhost:8000"
echo "   Dgraph Alpha: http://localhost:8080"
echo "   Dgraph Zero: http://localhost:6080" 
echo "   Honeygraph API: http://localhost:4000"
echo ""