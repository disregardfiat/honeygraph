# Dgraph Peer Networking in Honeygraph

## Architecture Overview

Honeygraph uses **application-level clustering** instead of Dgraph's native clustering, which provides several advantages for deployment flexibility and network security.

## Network Architecture

```
Internet
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                    Load Balancer                           │
│              (nginx/haproxy/cloudflare)                    │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ Honeygraph  │ │ Honeygraph  │ │ Honeygraph  │
│   Node A    │ │   Node B    │ │   Node C    │
│             │ │             │ │             │
│ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │
│ │ Dgraph  │ │ │ │ Dgraph  │ │ │ │ Dgraph  │ │
│ │ (Local) │ │ │ │ (Local) │ │ │ │ (Local) │ │
│ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │
│             │ │             │ │             │
│ API: 3030   │ │ API: 3030   │ │ API: 3030   │
│ WS:  4000   │ │ WS:  4000   │ │ WS:  4000   │
└─────────────┘ └─────────────┘ └─────────────┘
```

## Port Configuration

### External Ports (Required)

| Port | Service | Purpose | Required |
|------|---------|---------|----------|
| 3030 | HTTP API | Peer communication, sync, queries | ✅ Yes |
| 4000 | WebSocket | Honeycomb connections | ✅ Yes |
| 443/80 | HTTPS/HTTP | Standard web traffic | ✅ Yes |

### Internal Ports (Docker network only)

| Port | Service | Purpose | External Access |
|------|---------|---------|----------------|
| 5080 | Dgraph Zero | Local cluster coordination | ❌ No |
| 6080 | Dgraph Zero | Local HTTP admin | ❌ No |
| 7080 | Dgraph Alpha | Local internal comms | ❌ No |
| 8080 | Dgraph Alpha | Local HTTP queries | ❌ No |
| 9080 | Dgraph Alpha | Local gRPC queries | ❌ No |

## Peer Discovery Methods

### 1. Static Configuration
```bash
# Environment variables
PEERS=https://node1.honeygraph.io,https://node2.honeygraph.io
SYNC_ENABLED=true
SYNC_INTERVAL=30000
```

### 2. DNS Discovery
```bash
# Using DNS SRV records
DIG_DISCOVERY_DOMAIN=_honeygraph._tcp.dlux.io
```

### 3. Honeycomb Network Discovery
```bash
# Discover peers through honeycomb network
HONEYCOMB_DISCOVERY=true
HONEYCOMB_ENDPOINTS=https://spktest.dlux.io,https://duat.dlux.io
```

### 4. Dynamic API Registration
```bash
# POST /api/sync/peers
{
  "url": "https://new-node.honeygraph.io",
  "nodeId": "node-123",
  "version": "1.0.0",
  "capabilities": ["sync", "query", "websocket"]
}
```

## Routing Through Honeycomb Ports

### Option 1: Shared Port with Path Routing

```nginx
# nginx configuration
server {
    listen 443 ssl;
    server_name honeycomb.dlux.io;
    
    # Honeycomb traffic
    location / {
        proxy_pass http://honeycomb:3000;
    }
    
    # Honeygraph API
    location /honeygraph/ {
        proxy_pass http://honeygraph:3030/;
    }
    
    # Honeygraph WebSocket
    location /honeygraph/ws {
        proxy_pass http://honeygraph:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Option 2: Subdomain Routing

```nginx
# Honeycomb main service
server {
    listen 443 ssl;
    server_name honeycomb.dlux.io;
    location / {
        proxy_pass http://honeycomb:3000;
    }
}

# Honeygraph replication service
server {
    listen 443 ssl;
    server_name honeygraph.dlux.io;
    location / {
        proxy_pass http://honeygraph:3030;
    }
}
```

### Option 3: Port Sharing with SNI

```yaml
# Docker compose with shared external port
services:
  traefik:
    image: traefik:v2.9
    ports:
      - "443:443"
    labels:
      - "traefik.http.routers.honeycomb.rule=Host(`honeycomb.dlux.io`)"
      - "traefik.http.routers.honeygraph.rule=Host(`honeygraph.dlux.io`)"
```

## Network Security

### Firewall Configuration
```bash
# Only these ports need to be open externally
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 4000/tcp  # WebSocket (optional, can be proxied)

# All Dgraph ports stay internal
ufw deny 5080/tcp   # Dgraph Zero
ufw deny 8080/tcp   # Dgraph Alpha HTTP
ufw deny 9080/tcp   # Dgraph Alpha gRPC
```

### TLS/SSL Configuration
```yaml
# All external communication should use TLS
tls:
  cert_file: /etc/ssl/certs/honeygraph.crt
  key_file: /etc/ssl/private/honeygraph.key
  min_version: "1.2"
  cipher_suites:
    - "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384"
    - "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305"
```

## Peer Synchronization

### Sync Protocol
```javascript
// 1. Peer Discovery
GET /api/sync/peers
// Returns: [{url, nodeId, lastSeen, health}]

// 2. Health Check
GET /api/health
// Returns: {status: "healthy", block: 12345, hash: "Qm..."}

// 3. Gap Detection
GET /api/sync/status?from=12340&to=12350
// Returns: {missing: [12342, 12345], available: true}

// 4. Block Sync
GET /api/sync/blocks?from=12340&to=12350
// Returns: [{blockNum, hash, operations}, ...]

// 5. Consensus Verification
POST /api/sync/verify
// Body: {blockNum: 12345, expectedHash: "Qm..."}
```

### Sync Configuration
```yaml
# config/sync.yml
sync:
  enabled: true
  interval: 30000        # 30 seconds
  batchSize: 100         # blocks per sync
  maxPeers: 10          # maximum peer connections
  timeout: 10000        # 10 second timeout
  retries: 3            # retry attempts
  consensus:
    required: 2         # minimum peer agreement
    tolerance: 1        # allowed disagreements
```

## Load Balancing

### HAProxy Configuration
```haproxy
# haproxy.cfg
global
    daemon
    maxconn 4096

defaults
    mode http
    timeout connect 5000ms
    timeout client 50000ms
    timeout server 50000ms

# Honeygraph API load balancing
frontend honeygraph_frontend
    bind *:8090
    default_backend honeygraph_backend

backend honeygraph_backend
    balance roundrobin
    option httpchk GET /health
    server node1 honeygraph-1:3030 check
    server node2 honeygraph-2:3030 check
    server node3 honeygraph-3:3030 check

# WebSocket load balancing
frontend websocket_frontend
    bind *:4090
    default_backend websocket_backend

backend websocket_backend
    balance source
    server node1 honeygraph-1:4000 check
    server node2 honeygraph-2:4000 check
    server node3 honeygraph-3:4000 check
```

### Nginx Upstream
```nginx
upstream honeygraph_api {
    least_conn;
    server honeygraph-1:3030 max_fails=3 fail_timeout=30s;
    server honeygraph-2:3030 max_fails=3 fail_timeout=30s;
    server honeygraph-3:3030 max_fails=3 fail_timeout=30s;
}

upstream honeygraph_ws {
    ip_hash;  # Sticky sessions for WebSocket
    server honeygraph-1:4000;
    server honeygraph-2:4000;
    server honeygraph-3:4000;
}
```

## Deployment Examples

### Single Node (Development)
```yaml
version: '3.8'
services:
  honeygraph:
    build: .
    ports:
      - "3030:3030"  # API
      - "4000:4000"  # WebSocket
    environment:
      - SYNC_ENABLED=false
      - DGRAPH_ALPHA_URL=dgraph-alpha:9080
```

### Multi-Node (Production)
```yaml
version: '3.8'
services:
  honeygraph-1:
    build: .
    ports:
      - "3031:3030"
      - "4001:4000"
    environment:
      - PEERS=https://node2.dlux.io,https://node3.dlux.io
      - NODE_ID=node-1
  
  honeygraph-2:
    build: .
    ports:
      - "3032:3030"
      - "4002:4000"
    environment:
      - PEERS=https://node1.dlux.io,https://node3.dlux.io
      - NODE_ID=node-2
```

### Cloud Deployment (Kubernetes)
```yaml
apiVersion: v1
kind: Service
metadata:
  name: honeygraph-service
spec:
  type: LoadBalancer
  ports:
    - name: api
      port: 3030
      targetPort: 3030
    - name: websocket
      port: 4000
      targetPort: 4000
  selector:
    app: honeygraph

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: honeygraph
spec:
  replicas: 3
  selector:
    matchLabels:
      app: honeygraph
  template:
    spec:
      containers:
      - name: honeygraph
        image: honeygraph:latest
        ports:
        - containerPort: 3030
        - containerPort: 4000
        env:
        - name: PEERS
          value: "https://honeygraph-1.dlux.io,https://honeygraph-2.dlux.io"
```

## Monitoring and Observability

### Health Endpoints
```javascript
// Node health
GET /health
{
  "status": "healthy",
  "block": 12345,
  "hash": "QmABC123...",
  "peers": 3,
  "sync": "current"
}

// Peer status
GET /api/sync/peers/status
{
  "peers": [
    {
      "url": "https://node1.dlux.io",
      "status": "healthy",
      "lastSeen": "2025-01-20T10:30:00Z",
      "lag": 0
    }
  ]
}

// Dgraph status
GET /api/dgraph/health
{
  "alpha": "healthy",
  "zero": "healthy",
  "queries": 1250,
  "mutations": 45
}
```

### Metrics Collection
```javascript
// Prometheus metrics
GET /metrics
# HELP honeygraph_blocks_total Total blocks processed
# TYPE honeygraph_blocks_total counter
honeygraph_blocks_total 12345

# HELP honeygraph_peers_connected Currently connected peers
# TYPE honeygraph_peers_connected gauge
honeygraph_peers_connected 3

# HELP honeygraph_sync_lag_seconds Sync lag behind canonical chain
# TYPE honeygraph_sync_lag_seconds gauge
honeygraph_sync_lag_seconds 0
```

## Best Practices

### Security
1. **Use TLS** for all external communication
2. **Whitelist peers** by IP or certificate
3. **Rate limit** API endpoints
4. **Monitor** for unusual sync patterns

### Performance  
1. **Batch operations** for efficient sync
2. **Cache frequently** accessed data
3. **Use compression** for large block transfers
4. **Load balance** across multiple nodes

### Reliability
1. **Health checks** for automatic failover
2. **Consensus verification** for data integrity
3. **Graceful degradation** when peers are unavailable
4. **Automated recovery** from network partitions

This architecture provides a robust, scalable, and secure foundation for distributed honeygraph deployments while maintaining simplicity and compatibility with standard web infrastructure.