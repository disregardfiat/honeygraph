# SPK Network Account Data Paths Documentation

This document details all account-related data paths in the SPK Network honeycomb structure and how they map to the GraphQL schema.

## Account Balance Paths

### Token Balances
- **`balances[account]`**: LARYNX balance in milliLARYNX
  - Maps to: `Account.larynxBalance`
  - Type: Integer
  
- **`spk[account]`**: SPK balance in milliSPK
  - Maps to: `Account.spkBalance`
  - Type: Integer

### BROCA (Storage Credits)
- **`broca[account]`**: BROCA balance with last calculation block
  - Format: `"milliBRC,Base64EncodedBlockNumber"`
  - Maps to: 
    - `Account.broca` (raw string)
    - `Account.brocaAmount` (parsed milliBRC)
    - `Account.brocaLastUpdate` (decoded block number)
  
- **`bpow[account]`**: BROCA Power in milliBROCA
  - Maps to: `Account.brocaPower`
  - Type: Integer
  
- **`lbroca[account]`**: Liquid BROCA in milliBroca
  - Maps to: `Account.liquidBroca`
  - Type: Integer

### Claimable Balances
- **`cbalances[account]`**: Claimable LARYNX in milliLarynx
  - Maps to: `Account.claimableLarynx`
  - Type: Integer
  
- **`cbroca[account]`**: Claimable BROCA in milliBroca
  - Maps to: `Account.claimableBroca`
  - Type: Integer
  
- **`cspk[account]`**: Claimable SPK in milliSPK
  - Maps to: `Account.claimableSpk`
  - Type: Integer

## Power and Governance

### Power
- **`pow[account]`**: LARYNX Power in milliLARYNX
  - Maps to: `Account.power`
  - Type: Integer
  
- **`spkp[account]`**: SPK Power in milliSPK
  - Maps to: `Account.spkPower`
  - Type: Integer

### Granting System
- **`granted[grantee][grantor]`**: Power granted TO an account FROM grantor
  - Maps to: `PowerGrant` entities
  - Special key `'t'` holds total granted to account
  
- **`granting[grantor][grantee]`**: Power granted FROM an account TO grantee
  - Maps to: `PowerGrant` entities
  - Special key `'t'` holds total granted from account

### Voting
- **`spkVote[account]`**: SPK voting data
  - Format: `"lastBlockVoted,validatorRankedChoice"`
  - Maps to: 
    - `Account.spkVote` (raw string)
    - `Account.spkVoteLastBlock` (parsed block number)
    - `Account.spkVoteChoices` (parsed validator choices)
  - Ranked choice format: Every 2 characters = validator code
  - Example: `"97522300,030402"` means:
    - Last voted at block 97522300
    - 1st choice: validator "03" (spk-test)
    - 2nd choice: validator "04" (dlux-io)
    - 3rd choice: validator "02" (spk-test2)
  
- **`spkb[account]`**: SPK block reference
  - Maps to: `Account.spkBlock`
  - Type: Integer

### Node Report Object

The report object contains consensus voting information:
- **`block`**: The block number being reported on
- **`block_num`**: The block number when the report was sent
- **`hash`**: Consensus vote hash (IPFS CID)
- **`transaction_id`**: Transaction ID of the report
- **`sig`**: Signature for multiSig wallet operations
- **`sig_block`**: Block number of the multiSig transaction
- **`version`**: Honeycomb version running on the node
- **`witness`**: Hive witness of the block (not used)
- **`prand`**: Pseudo-random value (not used)
- **`hbd_check`, `hbd_offset`, `hive_check`, `hive_offset`**: Legacy fields (not used)

## Node Operations

### Market Participation
- **`market.node[account]`**: Node market data and validator information
  - Maps to: `NodeMarketBid` entity
  - Node object fields:
    - `CCR`: Credits for Consensus Reports
    - `attempts`: Total consensus report attempts
    - `bidRate`: Not currently used
    - `burned`: Registration cost in milliLARYNX
    - `contracts`: Not used
    - `dm`: DEX max (not used)
    - `ds`: DEX slope (not used)
    - `dv`: Field dv
    - `domain`: API endpoint domain (e.g., "spktest.dlux.io")
    - `escrows`: Not used
    - `lastGood`: Last accepted consensus block (health indicator)
    - `moved`: Not used
    - `report`: Report object with consensus data (see below)
    - `self`: Node account name
    - `strikes`: Not used
    - `tw`: Today's wins (consensus while holding keys)
    - `ty`: Today's yays (consensus participation)
    - `val_code`: Registered validator code (e.g., "03")
    - `votes`: Ranked choice validator votes received
    - `wins`: Total wins
    - `yays`: Total yays
    - `vS`: Verified signatures total
  
- **`sbroca[account]`**: Storage node reward points
  - Maps to: `Account.storageBroca`
  - Type: Integer
  
- **`vbroca[account]`**: Validator node reward points
  - Maps to: `Account.validatorBroca`
  - Type: Integer

### Validators
- **`val[val_code]`**: Validator information
  - Maps to: `Validator` entity
  - Contains: ranked choice DPoS voting amount

## Contracts and Services

### Storage Contracts
- **`contract[account]`**: List of file storage contracts
  - Maps to: `Account.contracts` → `StorageContract` entities
  - Contract ID format: `purchaser:type:block-txid`

### DEX Contracts
- **`contracts[account]`**: List of open DEX orders
  - Maps to: `Account.dexContracts` → `DexContract` entities
  - Type: Array of contract IDs

### Proffers (Upload Offers)
- **`proffer[to][from][type]`**: Contract offers for uploading
  - Maps to: `Proffer` entities
  - Type: 0 or 1 (indicating offer type)

### Services
- **`services[account][type][serviceID]`**: Service details
  - Maps to: `Service` entities
  - Service object fields:
    - `a`: API endpoint URL
    - `b`: Registered by (account)
    - `c`: Cost in milliLARYNX
    - `d`: Field d (purpose unclear)
    - `e`: Enabled flag (1 = enabled, 0 = disabled)
    - `f`: Field f (purpose unclear)
    - `i`: IPFS peer ID or service identifier
    - `m`: Memo/description
    - `s`: Field s (purpose unclear)
    - `t`: Service type (redundant with path)
    - `w`: Field w (purpose unclear)

- **`list[serviceType]`**: List of accounts providing a service type
  - Maps to: `ServiceList` entities
  - Value: Object/array of account names providing this service
  - Example service types: IPFS, MARKET, API, POA, etc.

- **`service[type][account]`**: (Deprecated/not important)
  - Legacy service registration
  - Not transformed in honeygraph

## Account Settings

### Public Keys
- **`authorities[account]`**: Account public key
  - Maps to: `Account.publicKey`
  - Type: String (public key)

### Preferences
- **`nomention[account]`**: Notification preference
  - Maps to: `Account.noMention`
  - Type: Boolean (true = decline notifications)

## Data Processing Notes

1. **Base64 Block Number Encoding**: The BROCA field uses custom base64 encoding for block numbers. Each character represents 6 bits of the block number.

2. **Special Account 't'**: In granting/granted paths, 't' is used as a special key to store totals.

3. **Compound Keys**: Many paths use compound keys (e.g., `contract[purchaser:type:block-txid]`) that need to be parsed to extract individual components.

4. **Milli-Units**: All token amounts are stored in milli-units (1/1000th of a token):
   - 1 LARYNX = 1000 milliLARYNX
   - 1 SPK = 1000 milliSPK
   - 1 BROCA = 1000 milliBROCA

## Excluded Paths

The following paths are excluded from honeygraph replication:
- `witness[0-99]`: Internal price tracking
- `rand[0-199]`: Deterministic randomness
- `IPFS[cid-reversed]`: Internal lottery and contract pointers
- `cPointers[contractID]`: Contract pointers
- `chain`: Internal blockchain state

### Node Market Data
```javascript
// Input: market.node['spk-test'] = {
//   CCR: 405,
//   attempts: 95095,
//   burned: 2000,
//   domain: "spktest.dlux.io",
//   lastGood: 97522300,
//   tw: 129,
//   ty: 2418,
//   val_code: "03",
//   votes: 3138180,
//   wins: 94966,
//   yays: 94966,
//   vS: 1,
//   report: {
//     block: 97523502,
//     block_num: 97523552,
//     hash: "QmWtvwLWsZ4DZPb64bCnSM2Y1PCFk4VzRQNAeDyk9QRBT7",
//     sig: "205a8caa3c00cc5953caf942f713f6c5e99f09c783d1cead425d9a90d8cc9c064469ccfd4e7e8ce5e9a040404e1a11df76bbeabb4c6862d42ce76f88927f854c7c",
//     sig_block: 96690350,
//     transaction_id: "95f07c3a80f179e62d21caefedeb248a5c081339",
//     version: "v1.5.0-t3",
//     witness: "roelandp",
//     prand: "2026d51ef553755f0e64599c23f1e3a5490c1f2fb0925aa44573ac09d19d61798b6151a359fba7e779a1dcc00c38d302645b8eaa8cc985031fe04932f6d2db963a",
//     hbd_check: 0,
//     hbd_offset: 0,
//     hive_check: 13,
//     hive_offset: 97000
//   }
// }
// Output:
{
  account: { username: 'spk-test' },
  ccr: 405,
  attempts: 95095,
  burned: 2000,
  domain: 'spktest.dlux.io',
  lastGood: 97522300,
  todayWins: 129,
  todayYays: 2418,
  validationCode: '03',
  votes: 3138180,
  wins: 94966,
  yays: 94966,
  verifiedSignatures: 1,
  consensusRate: 0.9988, // calculated: wins/attempts
  report: {
    id: 'spk-test:97523552',
    block: 97523502,
    blockNum: 97523552,
    hash: 'QmWtvwLWsZ4DZPb64bCnSM2Y1PCFk4VzRQNAeDyk9QRBT7',
    transactionId: '95f07c3a80f179e62d21caefedeb248a5c081339',
    signature: '205a8caa3c00cc5953caf942f713f6c5e99f09c783d1cead425d9a90d8cc9c064469ccfd4e7e8ce5e9a040404e1a11df76bbeabb4c6862d42ce76f88927f854c7c',
    sigBlock: 96690350,
    version: 'v1.5.0-t3',
    // Unused fields omitted for brevity
  }
}
```

### SPK Vote Parsing
```javascript
// Input: spkVote['alice'] = "97522300,030402"
// Output:
{
  spkVote: '97522300,030402',
  spkVoteLastBlock: 97522300,
  spkVoteChoices: [
    { rank: 1, validatorCode: '03', validatorName: 'spk-test' },
    { rank: 2, validatorCode: '04', validatorName: 'dlux-io' },
    { rank: 3, validatorCode: '02', validatorName: 'spk-test2' }
  ]
}
```

## Example Transformations

### BROCA Balance
```javascript
// Input: broca['alice'] = "5000,BCa"
// Output:
{
  username: 'alice',
  broca: '5000,BCa',
  brocaAmount: 5000,
  brocaLastUpdate: 4202 // Decoded from 'BCa'
}
```

### Power Grant
```javascript
// Input: granted['bob']['alice'] = 10000
// Output:
{
  id: 'alice:bob',
  grantor: { username: 'alice' },
  grantee: { username: 'bob' },
  amount: 10000
}
```

### Service Registration
```javascript
// Input: services['dlux-io']['IPFS']['12D3KooWQkAf2TpK6vBcpgoZShpQEFUo6AiPR4Lm2HgoNXRydrap'] = {
//   a: "https://ipfs.dlux.io",
//   b: "dlux-io",
//   c: 2000,
//   d: 0,
//   e: 1,
//   f: 1,
//   i: "12D3KooWSCxzjUP7DhYzzEHYjZq3hM3vR4aY7Uk3ktHmwm6HQSfB",
//   m: "",
//   s: 0,
//   t: "IPFS",
//   w: 0
// }
// Output:
{
  id: 'dlux-io:IPFS:12D3KooWQkAf2TpK6vBcpgoZShpQEFUo6AiPR4Lm2HgoNXRydrap',
  provider: { username: 'dlux-io' },
  serviceType: 'IPFS',
  serviceId: '12D3KooWQkAf2TpK6vBcpgoZShpQEFUo6AiPR4Lm2HgoNXRydrap',
  api: 'https://ipfs.dlux.io',
  by: 'dlux-io',
  cost: 2000,
  enabled: 1,
  ipfsId: '12D3KooWSCxzjUP7DhYzzEHYjZq3hM3vR4aY7Uk3ktHmwm6HQSfB',
  memo: '',
  active: true
}
```

### Service List
```javascript
// Input: list['IPFS'] = ['dlux-io', 'alice', 'bob']
// Output:
{
  id: 'IPFS',
  serviceType: 'IPFS',
  providers: [
    { username: 'dlux-io' },
    { username: 'alice' },
    { username: 'bob' }
  ],
  count: 3
}
```