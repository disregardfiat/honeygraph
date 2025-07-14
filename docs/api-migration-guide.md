# API Migration Guide: Native to GraphQL

This guide helps you migrate from Honeycomb's native REST API to Honeygraph's GraphQL API.

## Overview

The GraphQL API provides several advantages over the native REST API:
- **Single endpoint**: All queries go through `/api/graphql`
- **Flexible queries**: Request only the data you need
- **Multi-token support**: Query multiple tokens in a single request
- **Type safety**: Strong typing with schema validation
- **Better performance**: Reduced over-fetching and under-fetching

## Endpoint Mapping

### Core Endpoints

| Native API | GraphQL Query |
|------------|---------------|
| `GET /` | `query { token(symbol: "DLUX") { stats { ... } } }` |
| `GET /@{user}` | `query { token(symbol: "DLUX") { user(username: "alice") { ... } } }` |
| `GET /stats` | `query { token(symbol: "DLUX") { stats { ... } } }` |

### DEX/Market Endpoints

| Native API | GraphQL Query |
|------------|---------------|
| `GET /dex` | `query { token(symbol: "DLUX") { dex { ... } } }` |
| `GET /pairs` | Built into token info query |
| `GET /tickers` | `query { token(symbol: "DLUX") { tickers { ... } } }` |
| `GET /orderbook/{pair}` | `query { token(symbol: "DLUX") { orderbook(pair: HIVE) { ... } } }` |
| `GET /chart/{pair}` | `query { token(symbol: "DLUX") { trades(pair: HIVE) { ... } } }` |

### NFT Endpoints

| Native API | GraphQL Query |
|------------|---------------|
| `GET /nfts/{user}` | `query { token(symbol: "DLUX") { nfts(user: "alice") { ... } } }` |
| `GET /sets` | `query { token(symbol: "DLUX") { sets { ... } } }` |
| `GET /set/{name}` | `query { token(symbol: "DLUX") { set(name: "cards") { ... } } }` |
| `GET /set/{set}/{uid}` | `query { token(symbol: "DLUX") { item(set: "cards", uid: "123") { ... } } }` |

### Content Endpoints

| Native API | GraphQL Query |
|------------|---------------|
| `GET /posts` | `query { token(symbol: "DLUX") { posts { ... } } }` |
| `GET /blog/{author}/{permlink}` | `query { token(symbol: "DLUX") { post(author: "alice", permlink: "post") { ... } } }` |
| `GET /promoted` | `query { token(symbol: "DLUX") { promotedPosts(limit: 10) { ... } } }` |
| `GET /trending` | `query { token(symbol: "DLUX") { trendingPosts(limit: 10) { ... } } }` |
| `GET /new` | `query { token(symbol: "DLUX") { newPosts(limit: 10) { ... } } }` |

## Example Migrations

### 1. Get User Balance

**Native API:**
```bash
GET https://token.dlux.io/@alice
```

Response:
```json
{
  "balance": 1000,
  "poweredUp": 500,
  "gov": 250,
  "nfts": 5
}
```

**GraphQL API:**
```graphql
query GetUserBalance {
  token(symbol: "DLUX") {
    user(username: "alice") {
      balance
      poweredUp
      gov {
        weight
      }
      nfts {
        count
      }
    }
  }
}
```

### 2. Get DEX Order Book

**Native API:**
```bash
GET https://token.dlux.io/orderbook/HIVE_DLUX?depth=20
```

**GraphQL API:**
```graphql
query GetOrderBook {
  token(symbol: "DLUX") {
    orderbook(pair: HIVE, depth: 20) {
      tickerId
      timestamp
      asks
      bids
    }
  }
}
```

### 3. Get Multiple Data Points

**Native API** (requires multiple requests):
```bash
GET https://token.dlux.io/@alice
GET https://token.dlux.io/dex
GET https://token.dlux.io/stats
```

**GraphQL API** (single request):
```graphql
query GetMultipleData {
  token(symbol: "DLUX") {
    user(username: "alice") {
      balance
      poweredUp
    }
    dex {
      hive {
        tick
      }
      stats {
        volume24h
      }
    }
    stats {
      nodeQty
      userCount
    }
  }
}
```

### 4. Get NFT Collection

**Native API:**
```bash
GET https://token.dlux.io/nfts/alice
```

**GraphQL API:**
```graphql
query GetUserNFTs {
  token(symbol: "DLUX") {
    nfts(user: "alice") {
      count
      items {
        uid
        set
        attributes
        price
      }
      sets
    }
  }
}
```

### 5. Multi-Token Queries

**Native API** (requires requests to different domains):
```bash
GET https://token.dlux.io/@alice
GET https://spk.dlux.io/@alice
GET https://larynx.dlux.io/@alice
```

**GraphQL API** (single request):
```graphql
query MultiTokenBalances {
  dlux: token(symbol: "DLUX") {
    user(username: "alice") {
      balance
    }
  }
  spk: token(symbol: "SPK") {
    user(username: "alice") {
      balance
    }
  }
  larynx: token(symbol: "LARYNX") {
    user(username: "alice") {
      balance
    }
  }
}
```

## Code Migration Examples

### JavaScript/Node.js

**Native API:**
```javascript
// Multiple requests needed
const userData = await fetch('https://token.dlux.io/@alice').then(r => r.json());
const dexData = await fetch('https://token.dlux.io/dex').then(r => r.json());
const statsData = await fetch('https://token.dlux.io/stats').then(r => r.json());
```

**GraphQL API:**
```javascript
// Single request
const query = `
  query GetAllData {
    token(symbol: "DLUX") {
      user(username: "alice") {
        balance
        poweredUp
      }
      dex {
        hive { tick }
        hbd { tick }
      }
      stats {
        nodeQty
        userCount
      }
    }
  }
`;

const response = await fetch('https://honeygraph.dlux.io/api/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query })
});

const { data } = await response.json();
```

### Python

**Native API:**
```python
import requests

# Multiple requests
user_data = requests.get('https://token.dlux.io/@alice').json()
dex_data = requests.get('https://token.dlux.io/dex').json()
stats_data = requests.get('https://token.dlux.io/stats').json()
```

**GraphQL API:**
```python
import requests

query = """
  query GetAllData {
    token(symbol: "DLUX") {
      user(username: "alice") {
        balance
        poweredUp
      }
      dex {
        hive { tick }
        hbd { tick }
      }
      stats {
        nodeQty
        userCount
      }
    }
  }
"""

response = requests.post(
    'https://honeygraph.dlux.io/api/graphql',
    json={'query': query}
)

data = response.json()['data']
```

## Best Practices

1. **Request Only What You Need**: GraphQL allows you to specify exact fields
   ```graphql
   # Good - only request needed fields
   query { token(symbol: "DLUX") { user(username: "alice") { balance } } }
   
   # Avoid - requesting all fields when not needed
   query { token(symbol: "DLUX") { user(username: "alice") { ...AllUserFields } } }
   ```

2. **Use Variables**: Make queries reusable
   ```graphql
   query GetUser($token: String!, $username: String!) {
     token(symbol: $token) {
       user(username: $username) {
         balance
       }
     }
   }
   ```

3. **Batch Related Queries**: Combine multiple queries in one request
   ```graphql
   query GetUserAcrossTokens($username: String!) {
     dlux: token(symbol: "DLUX") {
       user(username: $username) { balance }
     }
     spk: token(symbol: "SPK") {
       user(username: $username) { balance }
     }
   }
   ```

4. **Handle Errors Properly**: Check for both HTTP and GraphQL errors
   ```javascript
   const response = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ query }) });
   const result = await response.json();
   
   if (result.errors) {
     console.error('GraphQL errors:', result.errors);
   }
   
   if (result.data) {
     // Process data
   }
   ```

## Performance Considerations

1. **Reduced Requests**: GraphQL reduces the number of HTTP requests
2. **Smaller Payloads**: Only requested data is returned
3. **Caching**: GraphQL responses can be cached at the field level
4. **Real-time Updates**: Future WebSocket subscriptions will enable real-time data

## Deprecation Timeline

- Native API endpoints will continue to work alongside GraphQL
- New features will be GraphQL-first
- WebSocket subscriptions will only be available via GraphQL
- Consider migrating to GraphQL for better performance and features