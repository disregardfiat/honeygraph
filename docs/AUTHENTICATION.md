# Honeygraph Authentication Guide

This guide explains how to configure and use Hive-based authentication for honeycomb nodes connecting to Honeygraph.

## Overview

Honeygraph uses Hive blockchain signatures for authenticating honeycomb nodes. This eliminates the need for API keys or pre-shared secrets, leveraging the existing Hive account system for secure authentication.

## How It Works

1. **Challenge-Response**: When a honeycomb node connects, Honeygraph sends a challenge with a timestamp and nonce
2. **Signature**: The honeycomb node signs the challenge with its Hive active key
3. **Verification**: Honeygraph verifies the signature against the account's public key from the Hive blockchain
4. **Authorization**: Optionally, only whitelisted accounts are allowed to connect

## Configuration

### Honeygraph Server Setup

1. **Enable authentication** in your `.env` file:
```bash
# Enable Hive authentication
REQUIRE_HIVE_AUTH=true

# Optional: Whitelist specific accounts (comma-separated)
AUTHORIZED_HONEYCOMB_NODES=spk-test,dlux-io,your-node-account
```

2. **Restart the service**:
```bash
docker-compose restart honeygraph-api
# or
systemctl restart honeygraph
```

### Honeycomb Node Configuration

The honeycomb node needs to be configured with:
- Hive account name
- Hive active private key (already required for blockchain operations)
- Honeygraph WebSocket URL

Example honeycomb `.env`:
```bash
# Existing honeycomb configuration
account=your-node-account
active=5Kxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Honeygraph configuration
HONEYGRAPH_URL=wss://graph.spk.network/fork-stream
HONEYGRAPH_AUTH_ENABLED=true
```

## Authentication Flow

### WebSocket Authentication

1. **Connection**: Honeycomb connects to `wss://honeygraph.example.com/fork-stream`

2. **Challenge**: Honeygraph sends:
```json
{
  "type": "auth_required",
  "challenge": {
    "timestamp": 1699123456789,
    "nonce": "abc123",
    "nodeId": "node_12345"
  }
}
```

3. **Response**: Honeycomb signs and responds:
```javascript
const message = JSON.stringify({
  account: 'your-node-account',
  challenge: receivedChallenge,
  timestamp: Date.now()
});

const signature = privateKey.sign(sha256(message));

ws.send(JSON.stringify({
  type: 'auth_response',
  account: 'your-node-account',
  signature: signature.toString(),
  message: message
}));
```

4. **Success**: On successful authentication:
```json
{
  "type": "auth_success",
  "account": "your-node-account",
  "nodeId": "node_12345"
}
```

### HTTP API Authentication

For REST API calls, include these headers:

```javascript
const message = JSON.stringify({
  method: 'POST',
  path: '/api/replicate/block',
  timestamp: Date.now(),
  body: requestBody,
  account: 'your-node-account'
});

const signature = privateKey.sign(sha256(message));

headers: {
  'X-Hive-Account': 'your-node-account',
  'X-Hive-Signature': signature.toString(),
  'X-Hive-Timestamp': timestamp.toString(),
  'Content-Type': 'application/json'
}
```

## Security Considerations

1. **Timestamp Validation**: Requests older than 5 minutes are rejected
2. **Nonce**: Prevents replay attacks for WebSocket authentication
3. **Active Key**: Uses Hive active key (not posting key) for higher security
4. **Public Key Caching**: Reduces blockchain queries while maintaining security

## Troubleshooting

### Authentication Fails

1. **Check account exists** on Hive:
```bash
curl -s https://api.hive.blog -d '{"jsonrpc":"2.0","method":"condenser_api.get_accounts","params":[["your-account"]],"id":1}'
```

2. **Verify active key** matches the account

3. **Check whitelist** if `AUTHORIZED_HONEYCOMB_NODES` is set

4. **Time sync**: Ensure server time is synchronized (within 5 minutes)

### Connection Timeout

- Authentication must complete within 30 seconds
- Check network connectivity
- Verify WebSocket URL is correct

### Invalid Signature

- Ensure you're signing with the active key (not posting key)
- Verify the message format matches exactly
- Check that you're using the correct hashing algorithm (SHA256)

## Integration with Trole Installer

The Trole installation script (`install.sh`) now automatically configures Honeygraph authentication:

1. During installation, it prompts for Honeygraph URL when installing SPK node
2. Configures the honeycomb node to authenticate using its Hive account
3. No additional configuration needed - it works automatically

## Example Implementation

See `/home/jr/dlux/honeygraph/test-hive-auth.js` for a complete example of implementing both WebSocket and HTTP authentication from a client.

## Benefits

- **No API Keys**: Eliminates key management overhead
- **Blockchain-Based**: Leverages existing Hive account infrastructure
- **Cryptographically Secure**: Uses proven signature algorithms
- **Decentralized**: No central authority for authentication
- **Automatic**: Nodes authenticate themselves without manual configuration