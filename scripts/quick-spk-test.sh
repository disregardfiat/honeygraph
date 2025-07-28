#!/bin/bash

# Quick test script for SPK VFS functionality

echo "🚀 Testing SPK VFS Import and Query"
echo "===================================="

# Set environment variables
export DGRAPH_URL=${DGRAPH_URL:-"http://localhost:9080"}
export TARGET_USER="disregardfiat"

echo "1. Checking DGraph status..."
curl -s http://localhost:8080/health | jq . || echo "⚠️  DGraph may not be running"

echo -e "\n2. Initializing schema..."
node scripts/init-schema.js

echo -e "\n3. Importing contracts for user: $TARGET_USER"
node scripts/import-spk-contracts.js

echo -e "\n4. Testing VFS endpoint..."
echo "Querying: http://localhost:3030/fs/$TARGET_USER/NFTs"
curl -s "http://localhost:3030/fs/$TARGET_USER/NFTs" | jq .

echo -e "\n✅ Test complete!"
echo "Expected output format:"
cat << 'EOF'
{
  "path": "/NFTs",
  "username": "disregardfiat",
  "type": "directory",
  "contents": [
    {
      "name": "Resources",
      "type": "directory",
      "path": "/NFTs/Resources",
      "itemCount": 8
    },
    {
      "name": "bz",
      "type": "file",
      "cid": "QmUM2sBkUtuzUUj2kUJzSTD7Wz2S4hCqVoeBKzSBDjTb3L",
      ...
    }
  ]
}
EOF