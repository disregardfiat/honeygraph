#!/bin/bash

# Quick sample data import for testing
# This imports a small subset of data directly using curl

set -e

echo "🧪 Quick Sample Data Import"
echo "=========================="
echo ""

# Check Dgraph
if ! curl -s http://localhost:8080/health > /dev/null 2>&1; then
    echo "❌ Dgraph is not running!"
    exit 1
fi

echo "Creating sample accounts..."

# Create some sample data
curl -s -X POST http://localhost:8080/mutate?commitNow=true \
  -H "Content-Type: application/json" \
  -d '{
    "set": [
      {
        "dgraph.type": "Account",
        "username": "alice",
        "larynxBalance": 50000,
        "spkBalance": 10000,
        "power": 25000,
        "liquidBroca": 1000000
      },
      {
        "dgraph.type": "Account", 
        "username": "bob",
        "larynxBalance": 30000,
        "spkBalance": 5000,
        "power": 15000,
        "liquidBroca": 500000
      },
      {
        "dgraph.type": "Account",
        "username": "charlie",
        "larynxBalance": 10000,
        "spkBalance": 2000,
        "power": 5000,
        "liquidBroca": 100000
      }
    ]
  }' > /dev/null

echo "✅ Created 3 accounts"

echo "Creating sample storage contracts..."

curl -s -X POST http://localhost:8080/mutate?commitNow=true \
  -H "Content-Type: application/json" \
  -d '{
    "set": [
      {
        "dgraph.type": "StorageContract",
        "id": "alice:0:97500000-abc123",
        "purchaser": {"username": "alice"},
        "contractType": 0,
        "blockNumber": 97500000,
        "txid": "abc123",
        "authorized": 10485760,
        "utilized": 5242880,
        "status": 3,
        "statusText": "ACTIVE",
        "power": 3,
        "nodeTotal": 3,
        "fileCount": 2,
        "isUnderstored": false,
        "expiresBlock": 98000000
      },
      {
        "dgraph.type": "StorageContract",
        "id": "bob:0:97500100-def456",
        "purchaser": {"username": "bob"},
        "contractType": 0,
        "blockNumber": 97500100,
        "txid": "def456",
        "authorized": 5242880,
        "utilized": 2621440,
        "status": 3,
        "statusText": "ACTIVE",
        "power": 5,
        "nodeTotal": 2,
        "fileCount": 1,
        "isUnderstored": true,
        "expiresBlock": 98000000
      }
    ]
  }' > /dev/null

echo "✅ Created 2 storage contracts"

echo "Creating sample transactions..."

curl -s -X POST http://localhost:8080/mutate?commitNow=true \
  -H "Content-Type: application/json" \
  -d '{
    "set": [
      {
        "dgraph.type": "Transaction",
        "id": "97500000:tx001",
        "blockNum": 97500000,
        "txId": "tx001",
        "category": "TOKEN_TRANSFER",
        "operationType": "send",
        "from": {"username": "alice"},
        "to": {"username": "bob"},
        "amount": 1000,
        "token": "LARYNX",
        "memo": "@alice| Sent @bob 1,000 LARYNX",
        "timestamp": "2024-01-01T12:00:00Z"
      },
      {
        "dgraph.type": "Transaction",
        "id": "97500001:tx002",
        "blockNum": 97500001,
        "txId": "tx002",
        "category": "POWER_UP",
        "operationType": "powerUp",
        "from": {"username": "charlie"},
        "amount": 5000,
        "token": "LARYNX",
        "memo": "@charlie| Powered up 5,000 LARYNX",
        "timestamp": "2024-01-01T12:01:00Z"
      }
    ]
  }' > /dev/null

echo "✅ Created 2 transactions"

echo "Creating sample DEX market..."

curl -s -X POST http://localhost:8080/mutate?commitNow=true \
  -H "Content-Type: application/json" \
  -d '{
    "set": [
      {
        "dgraph.type": "DexMarket",
        "id": "LARYNX:HBD",
        "token": "LARYNX",
        "tokenType": "dex",
        "quoteCurrency": "HBD",
        "tick": "1.0"
      },
      {
        "dgraph.type": "DexOrder",
        "id": "LARYNX:HBD:100.000000:order001",
        "market": {"id": "LARYNX:HBD"},
        "from": {"username": "alice"},
        "rate": 100.0,
        "amount": 1000,
        "tokenAmount": 10,
        "fee": 5,
        "orderType": "SELL",
        "status": "OPEN",
        "block": 97500000,
        "remaining": 1000,
        "timestamp": "2024-01-01T12:00:00Z"
      }
    ]
  }' > /dev/null

echo "✅ Created DEX market and order"

echo ""
echo "✨ Sample data imported successfully!"
echo ""
echo "📊 Test your data in Ratel UI: http://localhost:8000"
echo ""
echo "Try this query:"
echo "{"
echo "  accounts(func: has(username)) {"
echo "    username"
echo "    larynxBalance"
echo "    contracts {"
echo "      id"
echo "      fileCount"
echo "    }"
echo "  }"
echo "}"
echo ""