# SPK Network DEX Data Paths Documentation

The SPK Network operates 6 decentralized exchange (DEX) markets across 3 tokens and 2 quote currencies.

## DEX Structure

### Trading Pairs
SPK Network has 6 trading pairs:
1. **LARYNX/HBD** - Path: `dex.hbd`
2. **LARYNX/HIVE** - Path: `dex.hive`
3. **SPK/HBD** - Path: `dexs.hbd`
4. **SPK/HIVE** - Path: `dexs.hive`
5. **BROCA/HBD** - Path: `dexb.hbd`
6. **BROCA/HIVE** - Path: `dexb.hive`

### Path Structure
- **First level**: Token type
  - `dex` = LARYNX
  - `dexs` = SPK
  - `dexb` = BROCA
- **Second level**: Quote currency
  - `hbd` = HBD (Hive Backed Dollar)
  - `hive` = HIVE

## Market Object Structure

Each market (e.g., `dex.hbd`) contains:

### Order Books
- **`buyBook`**: CSV string of buy order IDs sorted by price
- **`sellBook`**: CSV string of sell order IDs sorted by price
  - Format: `"price:txid,price:txid,..."`
  - Example: `"100.000000:LARYNXQmTqacA3umiHLuWKbmb6nWhUSwWH6nQbP8p6MM3CnKvWTV"`

### Orders
- **`buyOrders`**: Object containing all buy orders
- **`sellOrders`**: Object containing all sell orders

### OHLC Data
- **`days`**: Object with OHLC data per 28,800 block period (approximately 24 hours)
  - Key: Block bucket number (e.g., `86418505`)
  - Value: OHLC object

### Market Settings
- **`tick`**: Minimum price increment (e.g., `"1.0"`)

## Order Object Structure

Each order (e.g., `dex.hbd.sellOrders["100.000000:LARYNXQmTqacA3umiHLuWKbmb6nWhUSwWH6nQbP8p6MM3CnKvWTV"]`) contains:

```javascript
{
  amount: 1000,              // Amount in milliHBD or milliHIVE
  block: 86352770,          // Block when order was opened
  expire_path: "87216770:QmXHDWuXJMSUjBBnpBYymyfb6uMP6zsGM6gkLJFDJgorum", // Expiration
  fee: 6,                   // Fee in milliToken (milliLARYNX/milliSPK/milliBROCA)
  from: "spkgiles",         // Account that placed the order
  hbd: 0,                   // HBD amount (0 for HIVE orders)
  hive: 100000,            // HIVE amount (0 for HBD orders)
  hive_id: "4504bf77a9eeb38cdd8bbcc65d8209c06e20e9d7", // Hive blockchain txid
  rate: "100.000000",      // Price per token
  txid: "LARYNXQmTqacA3umiHLuWKbmb6nWhUSwWH6nQbP8p6MM3CnKvWTV", // Internal txid
  type: "hive:sell"        // Order type
}
```

### Order ID Format
- Format: `"price:internalTxid"`
- Example: `"100.000000:LARYNXQmTqacA3umiHLuWKbmb6nWhUSwWH6nQbP8p6MM3CnKvWTV"`
- Price uses 6 decimal places

### Order Types
- `"hive:sell"` - Selling token for HIVE
- `"hive:buy"` - Buying token with HIVE
- `"hbd:sell"` - Selling token for HBD
- `"hbd:buy"` - Buying token with HBD

### Order Status and Partial Fills

Orders can have partial fills when matched against multiple counter orders:

1. **Status Values**:
   - `OPEN` - Order has no fills yet
   - `PARTIAL` - Order has been partially filled (filled > 0 but < amount)
   - `FILLED` - Order completely filled (filled >= amount)
   - `EXPIRED` - Order reached expiration block
   - `CANCELLED` - Order was cancelled by user

2. **Fill Tracking**:
   - `filled` - Amount filled so far
   - `remaining` - Amount still to be filled (amount - filled)
   - `lastFillBlock` - Block number of the most recent partial fill
   - `partialFills` - Array of PartialFill records for execution history
   - `matchedOrders` - Array of order IDs this order was matched against

3. **Partial Fill Records**:
   Each partial fill creates a record tracking:
   - Amount filled in that execution
   - Tokens transferred
   - Actual execution price
   - Matched order ID and account
   - Block number and transaction ID
   - Fee charged on that fill

## OHLC Data Structure

Each OHLC entry (e.g., `dex.hbd.days[86418505]`) contains:

```javascript
{
  b: 100,    // Bottom (Low) price
  c: 100,    // Close price
  d: 41,     // Volume in quote currency (HBD/HIVE)
  o: 100,    // Open price
  t: 100,    // Top (High) price
  v: 4100    // Volume in token
}
```

### Block Buckets
- Each bucket represents 28,800 blocks (approximately 24 hours)
- Bucket number is the starting block of the period
- Block time on Hive: ~3 seconds per block

## Data Transformation

### Market Transformation
```javascript
// Input: dex.hbd = { buyBook: "", sellBook: "...", tick: "1.0", days: {...}, ... }
// Output:
{
  id: 'LARYNX:HBD',
  token: 'LARYNX',
  tokenType: 'dex',
  quoteCurrency: 'HBD',
  buyBook: '',
  sellBook: '100.000000:LARYNXQmTqacA3umiHLuWKbmb6nWhUSwWH6nQbP8p6MM3CnKvWTV,...',
  tick: '1.0'
}
```

### Order Transformation
```javascript
// Input: Order object from above
// Output:
{
  id: 'LARYNX:HBD:100.000000:LARYNXQmTqacA3umiHLuWKbmb6nWhUSwWH6nQbP8p6MM3CnKvWTV',
  market: { id: 'LARYNX:HBD' },
  rate: 100.0,
  amount: 1000,
  tokenAmount: 10, // Calculated: amount / rate
  fee: 6,
  from: { username: 'spkgiles' },
  type: 'hive:sell',
  orderType: 'SELL',
  txid: 'LARYNXQmTqacA3umiHLuWKbmb6nWhUSwWH6nQbP8p6MM3CnKvWTV',
  hiveId: '4504bf77a9eeb38cdd8bbcc65d8209c06e20e9d7',
  block: 86352770,
  hive: 100000,
  hbd: 0,
  expireBlock: 87216770,
  expireChronId: 'QmXHDWuXJMSUjBBnpBYymyfb6uMP6zsGM6gkLJFDJgorum',
  status: 'OPEN', // or 'PARTIAL' if filled > 0
  filled: 0,
  remaining: 1000
}
```

### OHLC Transformation
```javascript
// Input: days[86418505] = { b: 100, c: 100, d: 41, o: 100, t: 100, v: 4100 }
// Output:
{
  id: 'LARYNX:HBD:86418505',
  market: { id: 'LARYNX:HBD' },
  blockBucket: 86418505,
  open: 100,
  high: 100,
  low: 100,
  close: 100,
  volumeQuote: 41,
  volumeToken: 4100,
  timestamp: '2024-01-15T00:00:00Z' // Calculated from block number
}
```

## Units and Precision

1. **Token Amounts**: All in milli-units (1/1000)
   - 1000 milliLARYNX = 1 LARYNX
   - 1000 milliSPK = 1 SPK
   - 1000 milliBROCA = 1 BROCA

2. **Quote Currency Amounts**: Also in milli-units
   - 1000 milliHBD = 1 HBD
   - 1000 milliHIVE = 1 HIVE

3. **Prices**: 6 decimal places (e.g., "100.000000")

4. **Fees**: In milli-units of the token being traded

### Partial Fill Example
```javascript
// Order with partial fills
{
  id: 'LARYNX:HBD:100.000000:LARYNXQmTqacA3umiHLuWKbmb6nWhUSwWH6nQbP8p6MM3CnKvWTV',
  amount: 1000,
  filled: 600,     // 600 out of 1000 filled
  remaining: 400,  // 400 still to fill
  status: 'PARTIAL',
  lastFillBlock: 86353000,
  partialFills: [
    {
      id: 'LARYNX:HBD:100.000000:LARYNXQmTqacA3umiHLuWKbmb6nWhUSwWH6nQbP8p6MM3CnKvWTV:86352900:0',
      amountFilled: 400,
      tokensFilled: 4,
      executionPrice: 100.0,
      matchedOrderId: '99.000000:LARYNXQmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      matchedAccount: { username: 'alice' },
      block: 86352900,
      feeCharged: 2
    },
    {
      id: 'LARYNX:HBD:100.000000:LARYNXQmTqacA3umiHLuWKbmb6nWhUSwWH6nQbP8p6MM3CnKvWTV:86353000:1',
      amountFilled: 200,
      tokensFilled: 2,
      executionPrice: 100.0,
      matchedOrderId: '98.500000:LARYNXQmYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
      matchedAccount: { username: 'bob' },
      block: 86353000,
      feeCharged: 1
    }
  ]
}
```

## GraphQL Queries

### Get Market Data
```graphql
query GetMarket($token: String!, $quote: String!) {
  market(func: eq(DexMarket.id, "${token}:${quote}")) {
    id
    token
    quoteCurrency
    sellBook
    buyBook
    tick
    sellOrders {
      rate
      amount
      from {
        username
      }
    }
    ohlcDays(first: 7, orderDesc: blockBucket) {
      blockBucket
      open
      high
      low
      close
      volumeToken
    }
  }
}
```

### Get User Orders
```graphql
query GetUserOrders($username: String!) {
  orders(func: eq(DexOrder.from, $username)) @filter(eq(status, "OPEN")) {
    id
    market {
      token
      quoteCurrency
    }
    orderType
    rate
    amount
    tokenAmount
    fee
    block
    expireBlock
  }
}
```