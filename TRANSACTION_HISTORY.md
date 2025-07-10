# Transaction History System

## Overview

The SPK Network uses a `feed` system to record human-readable transaction messages. However, these feed entries are automatically deleted or consolidated after 1-2 days to save space. This document describes how Honeygraph preserves this transaction history permanently.

## Feed Entry Format

Feed entries in honeycomb follow this structure:
```javascript
{
  path: ["feed", "{blockNumber}:{transactionId}"],
  data: "message string"
}
```

- Regular operations: `97523602:abc123def456`
- Virtual operations: `97523602:vop_unique_id`

## Preservation Strategy

1. **Ignore Feed Deletions**: When honeycomb deletes old feed entries, Honeygraph ignores these deletions to preserve transaction history
2. **Parse on Write**: Feed entries are parsed into structured `Transaction` objects when first written
3. **Categorization**: Each transaction is categorized for easy querying and filtering

## Transaction Categories

### Token Operations
- `TOKEN_TRANSFER`: Direct token transfers between accounts
- `TOKEN_CLAIM`: Claiming rewards (half to power, half to governance)
- `PROMOTION`: Content promotion payments

### DEX Operations
- `DEX_ORDER`: Limit order placement
- `DEX_TRADE`: Market order execution
- `DEX_CANCEL`: Order cancellation

### NFT Operations
- `NFT_MINT`: New NFT creation
- `NFT_TRANSFER`: NFT ownership transfer
- `NFT_SALE`: Direct NFT sale
- `NFT_AUCTION_END`: Auction completion

### Power & Governance
- `POWER_UP`: Converting liquid tokens to power
- `POWER_DOWN`: Converting power back to liquid
- `GOV_LOCK`: Locking tokens in governance
- `GOV_EXTEND`: Extending governance lock period
- `GOV_UNLOCK`: Unlocking from governance
- `GOV_WITHDRAW`: Withdrawing unlocked governance tokens

### Storage Operations
- `STORAGE_UPLOAD`: File upload completion
- `STORAGE_CANCEL`: Contract cancellation
- `STORAGE_META_UPDATE`: Metadata changes
- `STORAGE_FILE_DELETE`: File removal

### Other Operations
- `DELEGATION_ADD/REMOVE`: Power delegations
- `CERTIFICATE_SIGN`: Content certification
- `PROPOSAL_CREATE/VOTE/DELETE/APPROVE`: Governance proposals
- `VOTE`: Content voting
- `ERROR`: Failed operations
- `OTHER/UNKNOWN`: Unrecognized patterns

## Feed Message Patterns

The feed parser recognizes dozens of specific message patterns. Here are some examples:

### Token Transfer
```
@alice| Sent @bob 1,000 LARYNX
```
Parsed as:
```javascript
{
  category: "TOKEN_TRANSFER",
  from: "alice",
  to: "bob", 
  amount: 1000,
  token: "LARYNX"
}
```

### DEX Market Buy
```
@alice| Bought 500 SPK for 100 HIVE
```
Parsed as:
```javascript
{
  category: "DEX_TRADE",
  account: "alice",
  tradeType: "BUY",
  tokenAmount: 500,
  token: "SPK",
  quoteAmount: 100,
  quoteCurrency: "HIVE"
}
```

### NFT Transfer
```
@alice| sent DLUX:ART:123 to bob
```
Parsed as:
```javascript
{
  category: "NFT_TRANSFER",
  from: "alice",
  to: "bob",
  nftId: "DLUX:ART:123"
}
```

## GraphQL Queries

### Recent Transactions
```graphql
query RecentActivity {
  transactions(func: gt(blockNum, 97500000), orderDesc: timestamp, first: 100) {
    id
    category
    from { username }
    to { username }
    amount
    token
    memo
    timestamp
  }
}
```

### User Transaction History
```graphql
query UserHistory($username: String!) {
  transactions(func: eq(from.username, $username)) @cascade {
    id
    category
    operationType
    to { username }
    amount
    token
    dexDetails {
      orderType
      tokenAmount
      quoteCurrency
      quoteAmount
    }
    timestamp
  }
}
```

### Filter by Category
```graphql
query TokenTransfers {
  transactions(func: eq(category, "TOKEN_TRANSFER")) @filter(gt(amount, 1000)) {
    from { username }
    to { username }
    amount
    token
    timestamp
  }
}
```

### NFT Activity
```graphql
query NFTActivity {
  transactions(func: anyofterms(category, "NFT_MINT NFT_TRANSFER NFT_SALE")) {
    category
    nftDetails {
      nftId
      from
      to
      amount
      token
    }
    timestamp
  }
}
```

## Special Handling

### Order Cancellations
When a DEX order is deleted, we create an `OrderCancellation` record:
```javascript
{
  orderId: "LARYNX:HBD:100.000000:txid",
  market: { id: "LARYNX:HBD" },
  orderType: "SELL",
  cancelledAt: 97523700
}
```

### Virtual Operations
Operations with `txId` starting with `vop_` are system-generated (like auction endings, expiration events).

### Error Handling
Unparseable feed entries are stored with:
- `operationType: "UNKNOWN"`
- `category: "UNKNOWN"`
- `rawMessage: <original message>`

## Implementation Details

### Feed Parser
Located in `/lib/feed-parser.js`, the parser:
1. Uses regex patterns to match known message formats
2. Extracts structured data from matched patterns
3. Returns parsed transaction objects
4. Handles amount parsing (removes commas, converts to numbers)

### Data Transformer
The transformer (`/lib/data-transformer.js`):
1. Ignores `del` operations for feed paths
2. Calls the feed parser for each feed entry
3. Creates structured Transaction objects
4. Preserves deletion records for other paths (like DEX orders)

### Schema Design
The `Transaction` type includes:
- Core fields (id, blockNum, txId, category)
- Optional relationship fields (from, to)
- Category-specific detail objects
- Full-text searchable memo field

## Benefits

1. **Permanent History**: Transactions are never deleted from Honeygraph
2. **Structured Data**: Easy to query by category, user, token, etc.
3. **Rich Context**: Preserves original messages plus parsed details
4. **Performance**: Indexed fields enable fast queries
5. **Analytics**: Enables historical analysis and reporting

## Future Enhancements

1. **Block Time Integration**: Replace estimated timestamps with actual block times
2. **Amount Normalization**: Convert all amounts to decimal representation
3. **Cross-Reference Links**: Link transactions to related entities (orders, contracts, NFTs)
4. **Statistical Aggregations**: Pre-computed daily/weekly summaries
5. **WebSocket Subscriptions**: Real-time transaction notifications