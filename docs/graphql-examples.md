# Honeygraph GraphQL API Examples

The Honeygraph GraphQL API provides a unified interface to query data across all registered tokens. The API is available at `/api/graphql` and includes a GraphQL Playground at `/api/graphql/playground` in development mode.

## Basic Token Queries

### Get Token Info
```graphql
query GetTokenInfo {
  token(symbol: "DLUX") {
    info {
      symbol
      name
      precision
      currentSupply
      maxSupply
      description
    }
    stats {
      lastBlock
      tokenSupply
      nodeQty
      userCount
      volume24h
      marketCap
    }
  }
}
```

### Get All Registered Tokens
```graphql
query GetAllTokens {
  allTokens {
    symbol
  }
}
```

## User Queries

### Get User Balance and Info
```graphql
query GetUser {
  token(symbol: "SPK") {
    user(username: "alice") {
      username
      balance
      poweredUp
      poweringDown
      delegatedTo
      delegatedFrom
      gov {
        weight
        votes {
          proposal
          weight
          timestamp
        }
      }
    }
  }
}
```

### Get Multiple Users
```graphql
query GetUsers {
  token(symbol: "LARYNX") {
    users(limit: 10, offset: 0) {
      username
      balance
      poweredUp
    }
  }
}
```

## DEX/Market Queries

### Get DEX Overview
```graphql
query GetDEX {
  token(symbol: "DLUX") {
    dex {
      hive {
        tick
        sellOrders {
          id
          user
          rate
          amount
          total
        }
        buyOrders {
          id
          user
          rate
          amount
          total
        }
      }
      hbd {
        tick
        sellOrders {
          id
          user
          rate
          amount
        }
      }
      stats {
        volume24h
        trades24h
        uniqueTraders24h
      }
    }
  }
}
```

### Get Order Book
```graphql
query GetOrderBook {
  token(symbol: "SPK") {
    orderbook(pair: HIVE, depth: 20) {
      tickerId
      timestamp
      asks
      bids
    }
  }
}
```

### Get Recent Trades
```graphql
query GetRecentTrades {
  token(symbol: "LARYNX") {
    trades(pair: HBD, limit: 50, type: BUY) {
      tradeId
      price
      baseVolume
      targetVolume
      timestamp
      type
    }
  }
}
```

## NFT Queries

### Get User's NFTs
```graphql
query GetUserNFTs {
  token(symbol: "DLUX") {
    nfts(user: "bob") {
      user
      count
      items {
        uid
        set
        owner
        attributes
        locked
        price
      }
      sets
    }
  }
}
```

### Get NFT Sets
```graphql
query GetNFTSets {
  token(symbol: "SPK") {
    sets {
      name
      creator
      description
      totalSupply
      minted
      royalty
      items {
        uid
        owner
      }
    }
  }
}
```

### Get Specific NFT
```graphql
query GetNFTItem {
  token(symbol: "DLUX") {
    item(set: "splinterlands", uid: "card-123") {
      uid
      set
      owner
      attributes
      locked
      delegated
      price
    }
  }
}
```

## Content Queries

### Get Posts Overview
```graphql
query GetPostsInfo {
  token(symbol: "DLUX") {
    posts {
      count
      promoted
      trending
      lastUpdate
    }
  }
}
```

### Get Specific Post
```graphql
query GetPost {
  token(symbol: "SPK") {
    post(author: "alice", permlink: "my-first-post") {
      author
      permlink
      title
      body
      tags
      created
      promoted
      votes
      comments
      payout
    }
  }
}
```

### Get Trending Posts
```graphql
query GetTrendingPosts {
  token(symbol: "LARYNX") {
    trendingPosts(limit: 5) {
      author
      permlink
      title
      created
      votes
      payout
    }
  }
}
```

## Network/Node Queries

### Get Network Markets Info
```graphql
query GetMarkets {
  token(symbol: "DLUX") {
    markets {
      nodes {
        account
        domain
        bidRate
        attempts
        successes
        lastGood
        report {
          block
          hash
          signature
        }
      }
      consensus {
        round
        hash
        agreeing
        disagreeing
      }
    }
  }
}
```

### Get Runners
```graphql
query GetRunners {
  token(symbol: "SPK") {
    runners {
      account
      contracts
      type
      lastRun
    }
  }
}
```

## Transaction Queries

### Check Transaction Status
```graphql
query CheckTxStatus {
  token(symbol: "DLUX") {
    txStatus(txid: "abc123def456") {
      txid
      status
      block
      error
      result
    }
  }
}
```

### Get Pending Transactions
```graphql
query GetPending {
  token(symbol: "LARYNX") {
    pending {
      count
      transactions {
        txid
        type
        from
        memo
        timestamp
      }
    }
  }
}
```

## Complex Queries

### Get Complete User Profile
```graphql
query GetUserProfile {
  token(symbol: "DLUX") {
    user(username: "alice") {
      username
      balance
      poweredUp
      nfts {
        count
        items {
          uid
          set
        }
      }
      posts {
        author
        permlink
        title
        created
      }
      rewards {
        pending
        claimed
        lastClaim
      }
    }
  }
}
```

### Multi-Token Query
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

### Market Analysis Query
```graphql
query MarketAnalysis {
  token(symbol: "SPK") {
    dex {
      hive {
        tick
      }
      hbd {
        tick
      }
      stats {
        volume24h
        trades24h
      }
    }
    tickers {
      tickerId
      lastPrice
      baseVolume
      bid
      ask
      high
      low
    }
  }
}
```

## Query Variables

You can use variables to make queries reusable:

```graphql
query GetTokenUser($token: String!, $user: String!) {
  token(symbol: $token) {
    user(username: $user) {
      username
      balance
      poweredUp
    }
  }
}
```

Variables:
```json
{
  "token": "DLUX",
  "user": "alice"
}
```

## Pagination

Many queries support pagination:

```graphql
query GetUsersPaginated($limit: Int!, $offset: Int!) {
  token(symbol: "SPK") {
    users(limit: $limit, offset: $offset) {
      username
      balance
    }
  }
}
```

Variables:
```json
{
  "limit": 20,
  "offset": 40
}
```

## Error Handling

GraphQL errors are returned in a standard format:

```json
{
  "errors": [
    {
      "message": "Token INVALID not found",
      "locations": [{"line": 2, "column": 3}],
      "path": ["token"],
      "extensions": {
        "code": "TOKEN_NOT_FOUND"
      }
    }
  ]
}
```

## Rate Limiting

The GraphQL API follows the same rate limiting rules as the REST API:
- 100 requests per minute for read operations
- 10 requests per minute for write operations (when implemented)

## WebSocket Subscriptions (Future)

In the future, real-time subscriptions will be available for:
- New blocks
- Price updates
- Order book changes
- New transactions
- State changes