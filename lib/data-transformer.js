import { createLogger } from './logger.js';
import { feedParser } from './feed-parser.js';
import { pathAccumulator } from './path-accumulator.js';

const logger = createLogger('data-transformer');

export class DataTransformer {
  constructor(dgraphClient, networkManager = null) {
    this.dgraph = dgraphClient;
    this.networkManager = networkManager;
    // Track paths for each user to build directory tree
    this.userPaths = new Map();
    // Cache for existing accounts to avoid duplicate queries
    this.accountCache = new Map();
  }

  // Convert username to deterministic UID
  usernameToUid(username) {
    // Accounts are global - use a fixed prefix for all accounts
    // This ensures the same username always gets the same UID across all networks
    const prefix = "_:account_";
    
    // Username format: a-z, 0-9, dash (-), and dot (.)
    // Replace characters that aren't allowed in blank node IDs
    const sanitized = username
      .replace(/\./g, 'P')
      .replace(/-/g, 'D');
    
    return `${prefix}${sanitized}`;
  }

  // Transform a batch of operations into Dgraph mutations
  async transformOperations(operations, blockInfo) {
    console.log('TRANSFORM OPERATIONS CALLED:', operations.length, operations[0]?.path);
    const mutations = {
      accounts: new Map(),
      contracts: new Map(),
      files: new Map(),
      paths: new Map(),
      transactions: [],
      orders: new Map(),
      dexMarkets: new Map(),
      ohlc: [],
      other: []
    };

    for (const op of operations) {
      try {
        if (op.path && op.path[0] === 'contract') {
          logger.info('Processing contract in batch', { 
            path: op.path,
            dataKeys: op.data ? Object.keys(op.data).slice(0, 5) : []
          });
        }
        await this.transformOperationInternal(op, blockInfo, mutations);
      } catch (error) {
        logger.error('Failed to transform operation', { 
          error: error.message, 
          op 
        });
      }
    }

    return await this.buildMutations(mutations, blockInfo);
  }

  // Transform a single operation from honeycomb (standalone method)
  async transformOperation(op) {
    const mutations = {
      accounts: new Map(),
      contracts: new Map(),
      files: new Map(),
      paths: new Map(),
      transactions: [],
      orders: new Map(),
      dexMarkets: new Map(),
      ohlc: [],
      other: []
    };
    
    const blockInfo = {
      blockNum: op.blockNum || 0,
      blockHash: op.forkHash || '',
      timestamp: op.timestamp || Date.now()
    };
    
    await this.transformOperationInternal(op, blockInfo, mutations);
    
    // Build and return the mutation for this single operation
    const dgraphMutations = this.buildMutations(mutations, blockInfo);
    return dgraphMutations;
  }

  // Internal method for transforming operations (used by batch and single)
  async transformOperationInternal(op, blockInfo, mutations) {
    const { type, path, data } = op;
    
    // Skip operations that should not be replicated
    if (this.shouldSkipOperation(path)) {
      logger.debug('Skipping filtered operation', { path: path.join('.') });
      return;
    }
    
    if (type === 'del') {
      // Special handling for feed deletions - we want to keep transaction history
      if (path[0] === 'feed') {
        logger.debug('Ignoring feed deletion to preserve transaction history', { path: path.join('.') });
        return;
      }
      
      // Handle other deletions (like DEX order cancellations)
      this.handleDeletion(path, mutations, blockInfo);
      return;
    }

    // Handle puts based on path
    switch (path[0]) {
      // Account data paths
      case 'authorities':
        await this.transformAuthority(path[1], data, mutations);
        break;
        
      case 'balances':
        await this.transformBalance(path[1], data, 'larynxBalance', mutations);
        break;
        
      case 'bpow':
        await this.transformBalance(path[1], data, 'brocaPower', mutations);
        break;
        
      case 'broca':
        await this.transformBroca(path[1], data, mutations);
        break;
        
      case 'cbalances':
        await this.transformBalance(path[1], data, 'claimableLarynx', mutations);
        break;
        
      case 'cbroca':
        await this.transformBalance(path[1], data, 'claimableBroca', mutations);
        break;
        
      case 'contract':
        logger.info('Processing contract operation', { path, dataKeys: Object.keys(data).slice(0, 5) });
        await this.transformContract(path, data, mutations);
        break;
        
      case 'contracts':
        await this.transformDexContracts(path[1], data, mutations);
        break;
        
      case 'cspk':
        await this.transformBalance(path[1], data, 'claimableSpk', mutations);
        break;
        
      case 'feed':
        this.transformFeedEntry(path[1], data, blockInfo, mutations);
        break;
        
      case 'granted':
        await this.transformGranted(path, data, mutations);
        break;
        
      case 'granting':
        await this.transformGranting(path, data, mutations);
        break;
        
      case 'lbroca':
        await this.transformBalance(path[1], data, 'liquidBroca', mutations);
        break;
        
      case 'market':
        if (path[1] === 'node') {
          await this.transformNodeMarket(path[2], data, mutations);
        }
        break;
        
      case 'nomention':
        await this.transformBalance(path[1], data, 'noMention', mutations);
        break;
        
      case 'pow':
        // Handle both simple power values and complex POW report data
        if (typeof data === 'object' && data !== null) {
          // Complex POW data - store as structured data in 'other' mutations
          mutations.other.push({
            uid: `_:pow_${path[1].replace(/[\.\-]/g, '_')}_${blockInfo.blockNum}`,
            'dgraph.type': 'POWReport',
            account: { username: path[1] },
            reportData: JSON.stringify(data),
            blockNumber: blockInfo.blockNum,
            timestamp: new Date().toISOString()
          });
        } else if (typeof data === 'string' && (data.includes('{') || data.includes('['))) {
          // String that looks like JSON - also store as POW report
          mutations.other.push({
            uid: `_:pow_${path[1].replace(/[\.\-]/g, '_')}_${blockInfo.blockNum}`,
            'dgraph.type': 'POWReport',
            account: { username: path[1] },
            reportData: data,
            blockNumber: blockInfo.blockNum,
            timestamp: new Date().toISOString()
          });
        } else {
          // Simple power value
          await this.transformBalance(path[1], data, 'power', mutations);
        }
        break;
        
      case 'proffer':
        await this.transformProffer(path, data, mutations);
        break;
        
      case 'sbroca':
        await this.transformBalance(path[1], data, 'storageBroca', mutations);
        break;
        
      case 'vbroca':
        await this.transformBalance(path[1], data, 'validatorBroca', mutations);
        break;
        
      case 'service':
        // service[type][account] - ignore, not needed
        break;
        
      case 'services':
        await this.transformServiceObject(path, data, mutations);
        break;
        
      case 'list':
        this.transformServiceList(path, data, mutations);
        break;
        
      case 'spk':
        if (path[1] === 'ra' || path[1] === 'ri') {
          // Reserve amounts
          mutations.other.push({
            path: path.join('.'),
            value: data
          });
        } else {
          await this.transformBalance(path[1], data, 'spkBalance', mutations);
        }
        break;
        
      case 'spkVote':
        await this.transformSpkVote(path[1], data, mutations);
        break;
        
      case 'spkb':
        await this.transformBalance(path[1], data, 'spkBlock', mutations);
        break;
        
      case 'spkp':
        await this.transformBalance(path[1], data, 'spkPower', mutations);
        break;
        
      case 'val':
        await this.transformValidator(path[1], data, mutations);
        break;
        
      case 'dex':
      case 'dexb':
      case 'dexs':
        this.transformDexMarket(path, data, mutations);
        break;
        
      case 'delegations':
        this.transformDelegation(path, data, mutations);
        break;
        
      case 'priceFeeds':
        this.transformPriceFeed(path, data, mutations);
        break;
        
      case 'runners':
        await this.transformRunner(path[1], data, mutations);
        break;
        
      case 'spow':
        await this.transformSpow(path[1], data, mutations);
        break;
        
      case 'ubroca':
        await this.transformUbroca(path[1], data, mutations);
        break;
        
      case 'chain':
        this.transformChainState(path, data, mutations);
        break;
        
      case 'chrono':
        this.transformChrono(path, data, mutations);
        break;
        
      case 'stats':
        this.transformStats(path, data, blockInfo, mutations);
        break;
        
      default:
        // Store other data as-is
        mutations.other.push({
          path: path.join('.'),
          value: typeof data === 'object' ? JSON.stringify(data) : data
        });
    }
  }

  // Get or create file by CID
  async ensureFile(cid, fileData, mutations) {
    // Check mutations map first
    if (mutations.files.has(cid)) {
      return mutations.files.get(cid);
    }
    
    // Query for existing file
    const query = `
      query getFile($cid: string) {
        file(func: eq(ContractFile.cid, $cid)) {
          uid
          id
          cid
          name
          extension
          size
          path
          contract {
            uid
            blockNumber
          }
        }
      }
    `;
    
    try {
      const result = await this.dgraphClient.query(query, { $cid: cid });
      if (result.file && result.file.length > 0) {
        const existingFile = result.file[0];
        logger.debug('Found existing file', { cid, uid: existingFile.uid });
        
        // Add to mutations map for consistency
        existingFile.isExisting = true;
        mutations.files.set(cid, existingFile);
        return existingFile;
      }
    } catch (error) {
      logger.warn('Error querying for existing file', { cid, error: error.message });
    }
    
    // Create new file
    const newFile = {
      uid: `_:file_${cid.replace(/[:/\-]/g, '_')}`,
      'dgraph.type': 'ContractFile',
      id: cid,
      cid: cid,
      ...fileData
    };
    
    mutations.files.set(cid, newFile);
    return newFile;
  }

  // Ensure account exists with proper UID
  async ensureAccount(username, mutations) {
    // First check the mutations object for this batch
    if (mutations.accounts.has(username)) {
      return mutations.accounts.get(username).uid;
    }
    
    // Then check the persistent account cache across all batches
    let existingUid = this.accountCache.get(username);
    
    if (!existingUid || existingUid.startsWith('_:')) {
      // Don't trust blank node UIDs from cache - always query
      try {
        // Query database for existing account
        const query = `{ 
          account(func: eq(username, "${username}")) @filter(type(Account)) { 
            uid 
          } 
        }`;
        
        logger.info('Querying for existing account', { 
          username,
          hasQueryGlobal: !!this.dgraph.queryGlobal
        });
        
        // Use global query for accounts - they exist across all networks
        const result = await (this.dgraph.queryGlobal ? 
          this.dgraph.queryGlobal(query) : 
          this.dgraph.query(query));
        
        logger.info('Account query result', {
          username,
          found: result.account ? result.account.length : 0,
          uids: result.account ? result.account.map(a => a.uid) : []
        });
        
        if (result.account && result.account.length > 0) {
          // Use existing account UID (first one found)
          existingUid = result.account[0].uid;
          this.accountCache.set(username, existingUid);
          logger.info('Found existing account', { username, uid: existingUid });
        }
      } catch (error) {
        // If database query fails, just proceed to create new account
        logger.warn('Database query failed for account lookup', { 
          username, 
          error: error.message 
        });
      }
    } else {
      logger.info('Using cached account UID', { username, uid: existingUid });
    }
    
    if (existingUid) {
      // Use existing account UID - add reference to mutations but don't create new entity
      mutations.accounts.set(username, {
        uid: existingUid,
        username: username,
        'dgraph.type': 'Account',
        isExisting: true,  // Mark as existing to avoid creating duplicate mutation
        hasUpdates: false  // Track if this existing account has been updated in this batch
      });
      return existingUid;
    } else {
      // Create new account with deterministic temporary UID
      const tempUid = this.usernameToUid(username);
      mutations.accounts.set(username, {
        uid: tempUid,
        username: username,
        'dgraph.type': 'Account',
        isExisting: false  // Mark as new account
      });
      
      // Cache the deterministic UID so it can be reused in subsequent batches
      // This ensures the same username always gets the same temp UID
      this.accountCache.set(username, tempUid);
      
      return tempUid;
    }
  }
  
  // Transform balance update
  async transformBalance(account, balance, field, mutations) {
    await this.ensureAccount(account, mutations);
    
    // Handle different data types properly
    let processedBalance = balance;
    
    if (typeof balance === 'string') {
      // Handle comma-separated format for liquid broca (e.g., "80975487,5qUoh")
      if (field === 'liquidBroca' && balance.includes(',')) {
        const parts = balance.split(',');
        processedBalance = parseInt(parts[0]) || 0;
        
        // Also store the block update if present
        if (parts.length >= 2) {
          const accountData = mutations.accounts.get(account);
          accountData.brocaLastUpdate = this.decodeBase64BlockNumber(parts[1]);
        }
      } else {
        // Try to parse as number for numeric fields
        const numericValue = parseFloat(balance);
        if (!isNaN(numericValue)) {
          // For integer fields, use parseInt; for others use parseFloat
          const integerFields = ['larynxBalance', 'spkBalance', 'broca', 'brocaAmount', 'liquidBroca', 
                                'claimableLarynx', 'claimableBroca', 'claimableSpk', 'power', 'brocaPower',
                                'storageBroca', 'validatorBroca', 'spkBlock', 'spkPower'];
          
          if (integerFields.includes(field)) {
            processedBalance = parseInt(balance) || 0;
          } else {
            processedBalance = numericValue;
          }
        }
        // If not numeric, keep as string
      }
    } else if (typeof balance === 'object' && balance !== null) {
      // Handle object/JSON data - don't try to parse as number
      processedBalance = JSON.stringify(balance);
    }
    
    const accountData = mutations.accounts.get(account);
    accountData[field] = processedBalance;
    
    // Mark existing accounts as having updates so they get included in mutations
    if (accountData.isExisting) {
      accountData.hasUpdates = true;
    }
  }

  // Transform BROCA balance (includes block number)
  async transformBroca(account, brocaString, mutations) {
    await this.ensureAccount(account, mutations);
    
    const accountData = mutations.accounts.get(account);
    accountData.broca = brocaString;
    
    // Parse "milliBRC,Base64BlockNumber" format
    if (brocaString && typeof brocaString === 'string') {
      const parts = brocaString.split(',');
      if (parts.length >= 2) {
        accountData.brocaAmount = parseInt(parts[0]) || 0;
        // Decode base64 block number
        const base64Block = parts[1];
        if (base64Block) {
          accountData.brocaLastUpdate = this.decodeBase64BlockNumber(base64Block);
        }
      }
    }
    
    // Mark existing accounts as having updates so they get included in mutations
    if (accountData.isExisting) {
      accountData.hasUpdates = true;
    }
  }
  
  // Decode base64 encoded block number
  decodeBase64BlockNumber(base64Str) {
    try {
      // Custom base64 decoding for block numbers
      let blockNum = 0;
      const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      
      for (let i = 0; i < base64Str.length; i++) {
        const charIndex = base64Chars.indexOf(base64Str[i]);
        if (charIndex >= 0) {
          blockNum = blockNum * 64 + charIndex;
        }
      }
      
      return blockNum;
    } catch (e) {
      logger.warn('Failed to decode base64 block number', { base64Str, error: e.message });
      return 0;
    }
  }

  // Transform authority (public key)
  async transformAuthority(account, authorityData, mutations) {
    await this.ensureAccount(account, mutations);
    
    const accountData = mutations.accounts.get(account);
    
    // Handle different authority data formats
    if (typeof authorityData === 'string') {
      // Simple public key
      accountData.publicKey = authorityData;
    } else if (typeof authorityData === 'object' && authorityData !== null) {
      // Complex authority object - store as JSON string
      accountData.authorityData = JSON.stringify(authorityData);
    } else {
      // Fallback - convert to string
      accountData.publicKey = String(authorityData || '');
    }
    
    // Mark existing accounts as having updates so they get included in mutations
    if (accountData.isExisting) {
      accountData.hasUpdates = true;
    }
  }
  
  // Transform granted power (granted[grantee][grantor] or granted[grantee]['t'])
  async transformGranted(path, amount, mutations) {
    const [_, grantee, grantor] = path;
    
    await this.ensureAccount(grantee, mutations);
    
    if (grantor === 't') {
      // Total granted to this account
      const granteeData = mutations.accounts.get(grantee);
      granteeData.powerGranted = amount;
      
      // Mark existing accounts as having updates so they get included in mutations
      if (granteeData.isExisting) {
        granteeData.hasUpdates = true;
      }
    } else {
      // Specific grant relationship
      const grantorUid = await this.ensureAccount(grantor, mutations);
      const granteeUid = await this.ensureAccount(grantee, mutations);
      
      const grantId = `${grantor}:${grantee}`;
      const grant = {
        uid: `_:grant_${grantId.replace(/:/g, '_')}`,
        'dgraph.type': 'PowerGrant',
        id: grantId,
        grantor: { uid: grantorUid },
        grantee: { uid: granteeUid },
        amount: amount,
        createdBlock: 0, // Would need block info
        lastUpdate: Date.now()
      };
      mutations.other.push(grant);
    }
  }
  
  // Transform granting power (granting[grantor][grantee] or granting[grantor]['t'])
  async transformGranting(path, amount, mutations) {
    const [_, grantor, grantee] = path;
    
    await this.ensureAccount(grantor, mutations);
    
    if (grantee === 't') {
      // Total granting from this account
      const grantorData = mutations.accounts.get(grantor);
      grantorData.powerGranting = amount;
      
      // Mark existing accounts as having updates so they get included in mutations
      if (grantorData.isExisting) {
        grantorData.hasUpdates = true;
      }
    } else {
      // Specific grant relationship (already handled in transformGranted)
      // Skip to avoid duplicates
    }
  }
  
  // Transform DEX contracts (contracts[account])
  async transformDexContracts(account, contractList, mutations) {
    const accountUid = await this.ensureAccount(account, mutations);
    
    // contractList is an array of open DEX orders
    if (Array.isArray(contractList)) {
      contractList.forEach((contractId, index) => {
        const dexContractId = `${account}:${contractId}`;
        const dexContract = {
          uid: `_:dexcontract_${dexContractId.replace(/[:/\-]/g, '_')}`,
          'dgraph.type': 'DexContract',
          id: dexContractId,
          owner: { uid: accountUid },
          contractId: contractId,
          createdBlock: 0,
          lastActivity: Date.now()
        };
        mutations.other.push(dexContract);
      });
    }
  }
  
  // Transform proffer (proffer[to][from][type])
  async transformProffer(path, contractData, mutations) {
    const [_, to, from, profferType] = path;
    
    const fromUid = await this.ensureAccount(from, mutations);
    const toUid = await this.ensureAccount(to, mutations);
    
    const profferId = `${to}:${from}:${profferType || '0'}`;
    const proffer = {
      uid: `_:proffer_${profferId.replace(/[:/\-]/g, '_')}`,
      'dgraph.type': 'Proffer',
      id: profferId,
      from: { uid: fromUid },
      to: { uid: toUid },
      profferType: parseInt(profferType) || 0,
      createdBlock: 0,
      status: 'PENDING'
    };
    
    // Link to contract if it's a contract reference
    if (typeof contractData === 'string' && contractData.includes(':')) {
      proffer.contract = { id: contractData };
    }
    
    mutations.other.push(proffer);
  }
  
  // Transform service object (services[account][type][serviceID])
  async transformServiceObject(path, serviceData, mutations) {
    const [_, account, serviceType, serviceId] = path;
    
    const accountUid = await this.ensureAccount(account, mutations);
    
    const fullServiceId = `${account}:${serviceType}:${serviceId}`;
    const service = {
      uid: `_:service_${fullServiceId.replace(/[:/\-]/g, '_')}`,
      'dgraph.type': 'Service',
      id: fullServiceId,
      provider: { uid: accountUid },
      serviceType: serviceType,
      serviceId: serviceId,
      createdBlock: 0
    };
    
    // Parse service data object
    if (typeof serviceData === 'object' && serviceData !== null) {
      // Map the service fields
      service.api = serviceData.a; // API endpoint URL
      service.by = serviceData.b; // registered by
      service.cost = serviceData.c || 0; // cost in milliLARYNX
      service.d = serviceData.d || 0;
      service.enabled = serviceData.e || 0; // enabled flag
      service.f = serviceData.f || 0;
      service.ipfsId = serviceData.i; // IPFS peer ID or identifier
      service.memo = serviceData.m || ''; // memo/description
      service.s = serviceData.s || 0;
      service.w = serviceData.w || 0;
      
      // Set active based on enabled flag
      service.active = serviceData.e === 1;
      
      // Also support direct fields if present
      if (serviceData.api) service.api = serviceData.api;
      if (serviceData.endpoint) service.api = serviceData.endpoint;
      if (serviceData.url) service.api = serviceData.url;
    }
    
    mutations.other.push(service);
  }
  
  // Transform service list (list[serviceType])
  transformServiceList(path, providerList, mutations) {
    const [_, serviceType] = path;
    
    const listId = serviceType;
    const serviceList = {
      uid: `_:servicelist_${listId.replace(/[:/\-]/g, '_')}`,
      'dgraph.type': 'ServiceList',
      id: listId,
      serviceType: serviceType,
      providers: [],
      count: 0,
      lastUpdate: Date.now()
    };
    
    // providerList could be an array or object of account names
    if (Array.isArray(providerList)) {
      serviceList.providers = providerList.map(account => ({ username: account }));
      serviceList.count = providerList.length;
    } else if (typeof providerList === 'object') {
      // If it's an object, keys are accounts
      const accounts = Object.keys(providerList);
      serviceList.providers = accounts.map(account => ({ username: account }));
      serviceList.count = accounts.length;
    } else if (typeof providerList === 'string') {
      // Single provider
      serviceList.providers = [{ username: providerList }];
      serviceList.count = 1;
    }
    
    mutations.other.push(serviceList);
  }
  
  // Transform SPK vote (spkVote[account])
  async transformSpkVote(account, voteString, mutations) {
    await this.ensureAccount(account, mutations);
    
    const accountData = mutations.accounts.get(account);
    accountData.spkVote = voteString;
    
    // Parse "lastBlock,validatorRankedChoice" format
    if (voteString && voteString.includes(',')) {
      const parts = voteString.split(',');
      const lastBlock = parseInt(parts[0]) || 0;
      const rankedChoiceStr = parts[1] || '';
      
      accountData.spkVoteLastBlock = lastBlock;
      
      // Parse ranked choices - every 2 chars is a validator code
      if (rankedChoiceStr && rankedChoiceStr.length >= 2) {
        const choices = [];
        for (let i = 0; i < rankedChoiceStr.length; i += 2) {
          const valCode = rankedChoiceStr.substr(i, 2);
          if (valCode && valCode.length === 2) {
            choices.push({
              rank: Math.floor(i / 2) + 1,
              validatorCode: valCode,
              validatorName: this.getValidatorName(valCode, mutations)
            });
          }
        }
        accountData.spkVoteChoices = choices;
      }
    }
    
    // Mark existing accounts as having updates so they get included in mutations
    if (accountData.isExisting) {
      accountData.hasUpdates = true;
    }
  }
  
  // Get validator name from code using validator map
  getValidatorName(valCode, mutations) {
    if (mutations.validatorMap && mutations.validatorMap.has(valCode)) {
      return mutations.validatorMap.get(valCode);
    }
    return valCode; // Return code if name not found
  }
  
  // Transform validator (val[val_code])
  async transformValidator(valCode, votingData, mutations) {
    const validator = {
      uid: `_:validator_${valCode.replace(/[:/\-]/g, '_')}`,
      'dgraph.type': 'Validator',
      id: valCode,
      validationCode: valCode,
      votingPower: typeof votingData === 'number' ? votingData : 0,
      lastActivity: Date.now()
    };
    
    mutations.other.push(validator);
  }

  // Transform storage contract
  async transformContract(path, contract, mutations) {
    console.log('TRANSFORM CONTRACT CALLED:', path, Object.keys(contract));
    logger.info('Transforming contract', { 
      path, 
      contractKeys: Object.keys(contract).slice(0, 10),
      hasN: contract.hasOwnProperty('n'),
      nValue: contract.n,
      sampleData: {
        c: contract.c,
        p: contract.p,
        nt: contract.nt,
        f: contract.f,
        t: contract.t
      }
    });
    
    try {
    let contractId;
    let purchaser;
    let contractType = 0;
    let blockAndTxid = '';
    let blockNumber = '';
    let txid = '';
    
    // Handle both path formats:
    // New format from state import: ['contract', 'username', 'contractId']
    // Old format: ['contract', 'contractId'] 
    if (path.length === 3) {
      // State import format with username
      purchaser = path[1];  // username is purchaser
      
      // Check if path[2] is already a full contract ID
      if (path[2].includes(':')) {
        // It's already a full contract ID like "username:0:block-txid"
        contractId = path[2];
        const idParts = contractId.split(':');
        contractType = parseInt(idParts[1]) || 0;
        blockAndTxid = idParts[2] || '';
      } else {
        // It's just the block-txid part
        blockAndTxid = path[2];
        contractId = `${purchaser}:${contractType}:${blockAndTxid}`;
      }
      [blockNumber, txid] = blockAndTxid.split('-');
    } else {
      // Direct contract format - parse full ID
      contractId = path[1];
      const idParts = contractId.split(':');
      purchaser = idParts[0];
      contractType = parseInt(idParts[1]) || 0;
      blockAndTxid = idParts[2] || '';
      [blockNumber, txid] = blockAndTxid.split('-');
    }
    
    // Check if this is an update to an existing contract and if files are being removed
    const existingContractFiles = await this.getExistingContractFiles(contractId);
    const newFileCids = contract.df ? Object.keys(contract.df) : [];
    
    // Find files that were removed (exist in old contract but not in new)
    const removedFiles = existingContractFiles.filter(file => !newFileCids.includes(file.cid));
    
    // Ensure accounts exist for purchaser and owner
    const purchaserUsername = contract.f || purchaser;
    const ownerUsername = contract.t || path[1] || purchaser;
    
    // If files were removed, handle the removal
    if (removedFiles.length > 0) {
      logger.info('Contract update removed files', {
        contractId,
        removedCount: removedFiles.length,
        removedCids: removedFiles.map(f => f.cid)
      });
      await this.removeFilesFromPaths(removedFiles, ownerUsername, mutations);
    }
    
    await this.ensureAccount(purchaserUsername, mutations);
    await this.ensureAccount(ownerUsername, mutations);
    
    const dgraphContract = {
      uid: `_:contract_${contractId.replace(/[:/\-]/g, '_')}`,
      'dgraph.type': 'StorageContract',
      id: contractId,
      
      // Contract identification
      purchaser: { uid: mutations.accounts.get(purchaserUsername).uid },
      owner: { uid: mutations.accounts.get(ownerUsername).uid }, // owner from .t field or path
      contractType,
      blockNumber: parseInt(blockNumber) || 0,
      txid: txid || '',
      
      // Contract details
      authorized: contract.a || 0,
      broker: contract.b || '',
      status: contract.c || 0,
      power: contract.p || 0,
      refunded: contract.r || 0,
      utilized: contract.u || 0,
      verified: contract.v || 0,
      
      // Tracking
      lastValidated: contract.lastValidated || 0,
      nodeTotal: parseInt(contract.nt) || 0,
      
      // Computed fields
      fileCount: 0,
      isUnderstored: false,
      statusText: this.getContractStatusText(contract.c)
    };

    // Parse expiration field (e.g., "97938326:QmenexSVsQsaKqoDZdeTY8Us2bVyPaNyha1wc2MCRVQvRm" or timestamp)
    if (contract.e) {
      if (typeof contract.e === 'string' && contract.e.includes(':')) {
        const [expiresBlock, chronId] = contract.e.split(':');
        dgraphContract.expiresBlock = parseInt(expiresBlock) || 0;
        dgraphContract.expiresChronId = chronId || '';
      } else if (typeof contract.e === 'number') {
        // Handle timestamp format (convert to block number estimate)
        // Assuming ~3 second blocks and using a reference point
        const msPerBlock = 3000;
        const referenceTimestamp = 1721145000000; // July 2024
        const referenceBlock = 96585668;
        const blockDiff = Math.floor((contract.e - referenceTimestamp) / msPerBlock);
        dgraphContract.expiresBlock = referenceBlock + blockDiff;
      } else if (typeof contract.e === 'string') {
        // Try to parse as block number
        dgraphContract.expiresBlock = parseInt(contract.e) || 0;
      }
    }
    
    // Parse metadata field (e.g., "1|NFTs,bz,nft,,0--")
    if (contract.m) {
      const parsedMeta = this.parseMetadata(contract.m, contractId);
      // Store metadata as a JSON string
      dgraphContract.metadata = JSON.stringify({
        autoRenew: parsedMeta.autoRenew,
        encrypted: parsedMeta.encrypted,
        encData: parsedMeta.encData,
        folderStructure: parsedMeta.folderStructure,
        rawMetadata: parsedMeta.rawMetadata
      });
      // Store encryption keys separately if they exist
      if (parsedMeta.encryptionKeys && parsedMeta.encryptionKeys.length > 0) {
        dgraphContract.encryptionKeys = parsedMeta.encryptionKeys;
      }
      // Store encryption data if encrypted
      if (parsedMeta.encrypted && parsedMeta.encData) {
        dgraphContract.encryptionData = parsedMeta.encData;
      }
    }
    
    // Calculate if understored
    dgraphContract.isUnderstored = dgraphContract.nodeTotal < dgraphContract.power;

    // Process files and calculate totals
    if (contract.df) {
      let fileCount = 0;
      const fileNames = Object.keys(contract.df);
      // Metadata is now stored as a JSON string, so parse it first
      const metadataObj = dgraphContract.metadata ? JSON.parse(dgraphContract.metadata) : {};
      const folderStructure = metadataObj.folderStructure 
        ? JSON.parse(metadataObj.folderStructure)
        : {}; // Don't create default folder structure
      
      // Parse the full metadata for file details using the correct format
      const parsedMetadata = this.parseMetadataString(contract.m, fileNames);
      
      // Debug log the parsed metadata structure
      logger.debug('Parsed metadata structure', {
        contractId,
        hasCustomFolders: parsedMetadata.hasCustomFolders,
        folderCount: parsedMetadata.folders.length,
        folderMapSize: parsedMetadata.folderMap.size,
        folderIndices: Array.from(parsedMetadata.folderMap.keys()),
        sampleFolders: Array.from(parsedMetadata.folderMap.entries()).slice(0, 5).map(([k,v]) => ({index: k, name: v.name, path: v.fullPath}))
      });
      
      for (const [index, cid] of fileNames.entries()) {
        const size = contract.df[cid];
        fileCount++;
        
        // Extract file metadata from parsed data
        let fileName = cid; // Default to CID
        let fileType = '';
        // Default to first custom folder if it exists, otherwise root
        let filePath = '/';
        if (parsedMetadata.folderMap.has('1')) {
          const folder = parsedMetadata.folderMap.get('1');
          filePath = folder.fullPath.startsWith('/') ? folder.fullPath : '/' + folder.fullPath;
        }
        let fileFlags = 0;
        
        if (parsedMetadata.files.has(cid)) {
          const fileMetadata = parsedMetadata.files.get(cid);
          fileName = fileMetadata.name || cid;
          fileType = fileMetadata.ext || '';
          fileFlags = parseInt(fileMetadata.flags) || 0;
          
          // Get folder path from folder map
          if (fileMetadata.pathIndex && parsedMetadata.folderMap.has(fileMetadata.pathIndex)) {
            const folder = parsedMetadata.folderMap.get(fileMetadata.pathIndex);
            // Ensure proper path formatting - fullPath should already include leading /
            filePath = folder.fullPath || '/';
            // Add debug logging
            logger.debug(`File ${cid} (${fileName}) mapped to path: ${filePath}`, {
              pathIndex: fileMetadata.pathIndex,
              folderFullPath: folder.fullPath,
              folderName: folder.name
            });
          } else if (fileMetadata.pathIndex === '0') {
            filePath = '/';
          } else if (fileMetadata.pathIndex === '1' && !parsedMetadata.folderMap.has('1')) {
            // Path index 1 but no custom folder with index 1 defined
            // Use the contract's block number as folder name
            const blockPart = contractId.split(':')[2];
            if (blockPart) {
              const blockNumber = blockPart.split('-')[0];
              filePath = '/' + blockNumber;
              logger.debug(`File ${cid} (${fileName}) mapped to contract block folder: ${filePath}`, {
                pathIndex: fileMetadata.pathIndex,
                contractId,
                blockNumber
              });
            } else {
              // Fallback to root if can't parse block number
              filePath = '/';
              logger.warn(`Could not extract block number from contractId ${contractId} for pathIndex 1`);
            }
          } else if (fileMetadata.pathIndex) {
            // Handle preset folders that might not be in the folderMap
            const presetFolders = {
              '2': 'Documents',
              '3': 'Images',
              '4': 'Videos',
              '5': 'Music',
              '6': 'Archives',
              '7': 'Code',
              '8': 'Trash',
              '9': 'Misc'
            };
            
            if (presetFolders[fileMetadata.pathIndex]) {
              filePath = '/' + presetFolders[fileMetadata.pathIndex];
              logger.debug(`File ${cid} (${fileName}) mapped to preset folder: ${filePath}`, {
                pathIndex: fileMetadata.pathIndex
              });
            } else {
              // Fallback to root if unknown path index
              filePath = '/';
              logger.warn(`Unknown path index ${fileMetadata.pathIndex} for file ${cid}, using root`);
            }
          }
        }
        
        // Create or get existing file entity
        const fileId = cid;
        // Get file metadata if available
        const fileMetadata = parsedMetadata.files.get(cid) || {};
        
        const fileData = {
          size,
          name: fileName,
          extension: fileMetadata.ext || fileType,
          mimeType: this.getMimeType(fileType),
          path: filePath,
          flags: fileFlags,
          license: fileMetadata.license || '',
          labels: fileMetadata.labels || '',
          thumbnail: fileMetadata.thumb || '',
          uploadedAt: new Date().toISOString(),
          contract: { uid: dgraphContract.uid } // Primary contract for this file
        };
        
        // Use ensureFile to handle deduplication
        const file = await this.ensureFile(fileId, fileData, mutations);
        
        // Update contract reference if this contract is newer
        if (file.isExisting && (!file.contract || dgraphContract.blockNumber > (file.contract.blockNumber || 0))) {
          file.contract = { uid: dgraphContract.uid };
          file.hasUpdates = true;
        }
        
        // Create path entities and update with file reference (for both new and existing files)
        const fileOwner = contract.t || path[1] || purchaser;
        
        // Always ensure the directory path exists
        const dirPath = filePath === '/' ? '/' : filePath;
        
        logger.debug(`Creating/getting directory path for file`, {
          fileId,
          fileName,
          filePath,
          dirPath,
          fileOwner,
          isHidden: (fileFlags || 0) & 2
        });
        
        // Get or create the directory path
        const directoryPath = await this.getOrCreatePath(fileOwner, dirPath, 'directory', mutations);
        logger.debug(`Got path`, {
          pathUid: directoryPath.uid,
          pathFullPath: directoryPath.fullPath,
          existingFiles: directoryPath.files ? directoryPath.files.length : 0
        });
        
        // Add file reference to the directory (skip only for hidden files)
        if (!((fileFlags || 0) & 2)) {
          if (file) {
            // Set the file's parent directory
            file.parentPath = { uid: directoryPath.uid };
            
            // Add file to the path's files array
            if (!directoryPath.files) {
              directoryPath.files = [];
            }
            
            // Check if file is already in the array to avoid duplicates
            const fileExists = directoryPath.files.some(f => f.uid === file.uid);
            if (!fileExists) {
              directoryPath.files.push({ uid: file.uid });
              
              // CRITICAL: Also add to path accumulator for cross-batch accumulation
              if (pathAccumulator.batchMode) {
                pathAccumulator.addFileToPath(fileOwner, dirPath, file.uid);
              }
              
              logger.debug(`Added file to path`, {
                pathUid: directoryPath.uid,
                pathFullPath: directoryPath.fullPath,
                fileUid: file.uid,
                totalFiles: directoryPath.files.length
              });
            }
            
            logger.debug(`Added file to directory`, {
              directory: directoryPath.fullPath,
              fileUid: file.uid,
              fileName: file.name,
              totalFiles: directoryPath.files.length,
              isExistingPath: directoryPath.uid && directoryPath.uid.startsWith('0x'),
              pathUid: directoryPath.uid
            });
          }
        } else {
          logger.debug(`Skipped adding hidden file to directory`, {
            directory: directoryPath.fullPath,
            fileName,
            fileFlags
          });
        }
      }
      
      dgraphContract.fileCount = fileCount;
      // Note: dataSize is tracked as 'utilized' in the contract
    }
    
    // Process extensions if present
    if (contract.ex) {
      dgraphContract.extensions = this.parseExtensions(contract.ex, contractId, mutations);
    }
    
    // Process storage nodes - create references to Account nodes
    logger.info('Processing storage nodes', { 
      contractId, 
      hasN: !!contract.n, 
      nValue: contract.n,
      nType: typeof contract.n,
      contractKeys: Object.keys(contract).sort()
    });
    
    if (contract.n) {
      dgraphContract.storageNodes = [];
      for (const [nodeNumber, nodeAccount] of Object.entries(contract.n)) {
        // Ensure the storage account exists
        await this.ensureAccount(nodeAccount, mutations);
        
        // Add reference to the account as a storage node
        dgraphContract.storageNodes.push({
          uid: mutations.accounts.get(nodeAccount).uid
        });
        
        // Also track that this account is storing this contract
        const accountData = mutations.accounts.get(nodeAccount);
        if (!accountData.contractsStoring) {
          accountData.contractsStoring = [];
        }
        accountData.contractsStoring.push({
          uid: dgraphContract.uid
        });
      }
    }
    
    logger.info('Setting contract mutation', { contractId, hasContract: !!dgraphContract, mutationsBefore: mutations.contracts.size });
    mutations.contracts.set(contractId, dgraphContract);
    logger.info('Contract mutation set', { contractId, mutationsAfter: mutations.contracts.size, hasSetCorrectly: mutations.contracts.has(contractId) });
    } catch (error) {
      logger.error('Failed to transform contract', { 
        path, 
        error: error.message,
        stack: error.stack 
      });
      throw error;
    }
  }


  // Transform file
  async transformFile(cid, fileData, mutations) {
    if (!mutations.files.has(cid)) {
      // Ensure account exists
      await this.ensureAccount(fileData.owner, mutations);
      
      mutations.files.set(cid, {
        uid: `_:file_${cid}`,
        'dgraph.type': 'File',
        cid,
        owner: { uid: `_:account_${fileData.owner.replace(/[\.\-]/g, '_')}` },
        size: fileData.size || 0,
        uploadedAt: new Date().toISOString()
      });
    }
    
    if (fileData.contract) {
      // Find the contract UID from mutations
      const contractEntity = mutations.contracts.get(fileData.contract);
      if (contractEntity) {
        mutations.files.get(cid).contract = {
          uid: contractEntity.uid
        };
      }
    }
  }

  // Transform node market data
  async transformNodeMarket(account, nodeData, mutations) {
    await this.ensureAccount(account, mutations);

    const nodeBid = {
      uid: `_:node_${account}`,
      'dgraph.type': 'NodeMarketBid',
      account: { username: account },
      
      // Credits and attempts
      ccr: nodeData.CCR || 0,
      attempts: nodeData.attempts || 0,
      
      // Registration and limits
      bidRate: nodeData.bidRate || 0,
      burned: nodeData.burned || 0,
      contracts: nodeData.contracts || 0,
      dm: nodeData.dm || 0,
      ds: nodeData.ds || 0,
      dv: nodeData.dv || 0,
      escrows: nodeData.escrows || 0,
      moved: nodeData.moved || 0,
      strikes: nodeData.strikes || 0,
      
      // Node info
      domain: nodeData.domain || '',
      self: nodeData.self || account,
      validationCode: nodeData.val_code || '',
      
      // Health and status
      lastGood: nodeData.lastGood || 0,
      
      // Performance metrics
      wins: nodeData.wins || 0,
      yays: nodeData.yays || 0,
      todayWins: nodeData.tw || 0,
      todayYays: nodeData.ty || 0,
      
      // Voting
      votes: nodeData.votes || 0,
      
      // Verification
      verifiedSignatures: nodeData.vS || 0,
      
      // Report data will be parsed separately
      // report field will be set below
    };
    
    // Calculate computed fields
    if (nodeData.attempts > 0) {
      nodeBid.consensusRate = (nodeData.wins || 0) / nodeData.attempts;
    }
    
    // Check health based on lastGood distance from current block
    // This would need actual block height to calculate properly
    nodeBid.isHealthy = true; // Placeholder
    
    // Parse and store report if present
    if (nodeData.report && typeof nodeData.report === 'object') {
      const reportId = `${account}:${nodeData.report.block_num || Date.now()}`;
      const report = {
        uid: `_:report_${reportId.replace(/[:/\-]/g, '_')}`,
        'dgraph.type': 'NodeReport',
        id: reportId,
        node: nodeBid,
        
        // Block information
        block: nodeData.report.block || 0,
        blockNum: nodeData.report.block_num || 0,
        
        // Consensus data
        hash: nodeData.report.hash || '',
        transactionId: nodeData.report.transaction_id || '',
        
        // Signature data
        signature: nodeData.report.sig || '',
        sigBlock: nodeData.report.sig_block || 0,
        
        // Version info
        version: nodeData.report.version || '',
        
        // Unused fields
        witness: nodeData.report.witness || '',
        prand: nodeData.report.prand || '',
        hbdCheck: nodeData.report.hbd_check || 0,
        hbdOffset: nodeData.report.hbd_offset || 0,
        hiveCheck: nodeData.report.hive_check || 0,
        hiveOffset: nodeData.report.hive_offset || 0,
        
        // Metadata
        reportedAt: new Date().toISOString()
      };
      
      nodeBid.report = report;
      mutations.other.push(report);
    }
    
    const accountData = mutations.accounts.get(account);
    accountData.nodeMarketBid = nodeBid;
    
    // Mark existing accounts as having updates so they get included in mutations
    if (accountData.isExisting) {
      accountData.hasUpdates = true;
    }
    
    // Also store validator if it has a val_code
    if (nodeData.val_code) {
      await this.transformValidator(nodeData.val_code, nodeData.votes || 0, mutations);
      
      // Store mapping for val_code to account name
      if (!mutations.validatorMap) {
        mutations.validatorMap = new Map();
      }
      mutations.validatorMap.set(nodeData.val_code, account);
    }
  }

  // Transform DEX market and orders
  transformDexMarket(path, data, mutations) {
    // Path: [dex/dexb/dexs, hbd/hive, ...]
    const [dexType, quoteCurrency] = path;
    
    // Determine token type from dex variant
    let token;
    switch (dexType) {
      case 'dex': token = 'LARYNX'; break;
      case 'dexs': token = 'SPK'; break;
      case 'dexb': token = 'BROCA'; break;
      default: return;
    }
    
    // Handle market-level data
    if (path.length === 2 && quoteCurrency && (quoteCurrency === 'hbd' || quoteCurrency === 'hive')) {
      const marketId = `${token}:${quoteCurrency.toUpperCase()}`;
      
      if (!mutations.dexMarkets) {
        mutations.dexMarkets = new Map();
      }
      
      const market = {
        uid: `_:dexmarket_${marketId.replace(/:/g, '_')}`,
        'dgraph.type': 'DexMarket',
        id: marketId,
        token,
        tokenType: dexType,
        quoteCurrency: quoteCurrency.toUpperCase(),
        buyBook: data.buyBook || '',
        sellBook: data.sellBook || '',
        tick: data.tick || '1.0'
      };
      
      mutations.dexMarkets.set(marketId, market);
      
      // Process OHLC days
      if (data.days) {
        this.transformOHLCDays(marketId, data.days, mutations);
      }
      
      // Process orders
      if (data.sellOrders) {
        this.transformDexOrders(marketId, data.sellOrders, 'SELL', mutations);
      }
      if (data.buyOrders) {
        this.transformDexOrders(marketId, data.buyOrders, 'BUY', mutations);
      }
    }
  }
  
  // Transform DEX orders
  transformDexOrders(marketId, orders, orderType, mutations) {
    if (!orders || typeof orders !== 'object') return;
    
    Object.entries(orders).forEach(([orderId, orderData]) => {
      const fullOrderId = `${marketId}:${orderId}`;
      
      const order = {
        uid: `_:dexorder_${fullOrderId.replace(/[:/\-]/g, '_')}`,
        'dgraph.type': 'DexOrder',
        id: fullOrderId,
        market: { id: marketId },
        
        // Parse rate from order ID (format: "100.000000:TXID")
        rate: parseFloat(orderId.split(':')[0]) || 0,
        amount: orderData.amount || 0,
        fee: orderData.fee || 0,
        
        // Account and type
        from: { username: orderData.from },
        type: orderData.type || '',
        orderType: orderType,
        
        // Transaction info
        txid: orderData.txid || orderId.split(':')[1] || '',
        hiveId: orderData.hive_id || '',
        block: orderData.block || 0,
        
        // Currency amounts
        hbd: orderData.hbd || 0,
        hive: orderData.hive || 0,
        
        // Status and fills
        status: 'OPEN',
        filled: orderData.filled || 0,
        remaining: orderData.amount || 0,
        partialFills: [],
        matchedOrders: [],
        
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      // Check if order has partial fills
      if (orderData.filled && orderData.filled > 0) {
        order.status = orderData.filled >= orderData.amount ? 'FILLED' : 'PARTIAL';
        order.remaining = orderData.amount - orderData.filled;
        order.lastFillBlock = orderData.lastFillBlock || orderData.block;
      }
      
      // Parse expiration
      if (orderData.expire_path) {
        const [expireBlock, chronId] = orderData.expire_path.split(':');
        order.expirePath = orderData.expire_path;
        order.expireBlock = parseInt(expireBlock) || 0;
        order.expireChronId = chronId || '';
      }
      
      // Calculate token amount based on rate
      if (order.rate > 0) {
        order.tokenAmount = Math.floor(order.amount / order.rate);
      }
      
      if (!mutations.orders) {
        mutations.orders = new Map();
      }
      mutations.orders.set(fullOrderId, order);
    });
  }
  
  // Transform OHLC data
  transformOHLCDays(marketId, days, mutations) {
    if (!days || typeof days !== 'object') return;
    
    Object.entries(days).forEach(([blockBucket, ohlcData]) => {
      const ohlcId = `${marketId}:${blockBucket}`;
      
      const ohlc = {
        uid: `_:ohlc_${ohlcId.replace(/[:/\-]/g, '_')}`,
        'dgraph.type': 'OHLCData',
        id: ohlcId,
        market: { id: marketId },
        
        blockBucket: parseInt(blockBucket) || 0,
        
        // Price data
        open: ohlcData.o || 0,
        high: ohlcData.t || 0, // t = top
        low: ohlcData.b || 0,  // b = bottom
        close: ohlcData.c || 0,
        
        // Volume data
        volumeQuote: ohlcData.d || 0, // d = volume in HBD/HIVE
        volumeToken: ohlcData.v || 0, // v = volume in token
        
        // Calculate timestamp from block (approximately)
        timestamp: new Date(Date.now() - ((Date.now() / 1000 / 3) - parseInt(blockBucket)) * 3 * 1000).toISOString()
      };
      
      if (!mutations.ohlc) {
        mutations.ohlc = [];
      }
      mutations.ohlc.push(ohlc);
    });
  }

  // Transform feed entry to transaction
  transformFeedEntry(feedId, message, blockInfo, mutations) {
    try {
      // Use the feed parser to extract structured data
      const parsed = feedParser.parseFeedEntry(feedId, message);
      
      if (!parsed) {
        logger.warn('Could not parse feed entry', { feedId, message });
        return;
      }
      
      // Build transaction object
      const transaction = {
        uid: `_:tx_${feedId.replace(/[:/\-]/g, '_')}`,
        'dgraph.type': 'Transaction',
        id: feedId,
        blockNum: parsed.blockNum || blockInfo.blockNum,
        txId: parsed.txId,
        isVirtualOp: parsed.isVirtualOp || false,
        
        // Operation details
        operationType: parsed.operationType,
        category: parsed.category || 'UNKNOWN',
        
        // Common fields
        memo: parsed.memo || parsed.rawMessage || message,
        timestamp: blockInfo.timestamp ? new Date(blockInfo.timestamp).toISOString() : new Date().toISOString()
      };
      
      // Add category-specific fields
      switch (parsed.category) {
        case 'TOKEN_TRANSFER':
          transaction.from = { username: parsed.from };
          transaction.to = { username: parsed.to };
          transaction.amount = parsed.amount;
          transaction.token = parsed.token;
          break;
          
        case 'DEX_ORDER':
        case 'DEX_TRADE':
          transaction.from = { username: parsed.account };
          transaction.dexDetails = {
            orderType: parsed.orderType,
            tradeType: parsed.tradeType,
            token: parsed.token,
            tokenAmount: parsed.tokenAmount || parsed.amount,
            quoteCurrency: parsed.quoteCurrency,
            quoteAmount: parsed.quoteAmount
          };
          break;
          
        case 'NFT_TRANSFER':
        case 'NFT_MINT':
        case 'NFT_SALE':
          transaction.nftDetails = {
            nftId: parsed.nftId,
            from: parsed.from,
            to: parsed.to || parsed.recipient || parsed.buyer,
            amount: parsed.amount,
            token: parsed.token,
            setName: parsed.setName
          };
          if (parsed.from) transaction.from = { username: parsed.from };
          if (parsed.to || parsed.recipient) transaction.to = { username: parsed.to || parsed.recipient };
          break;
          
        case 'POWER_UP':
        case 'POWER_DOWN':
          transaction.from = { username: parsed.account };
          transaction.powerDetails = {
            action: parsed.category,
            amount: parsed.amount,
            token: parsed.token
          };
          break;
          
        case 'STORAGE_UPLOAD':
        case 'STORAGE_CANCEL':
          transaction.storageDetails = {
            contractId: parsed.contractId,
            action: parsed.category,
            uploadType: parsed.uploadType,
            cancelledBy: parsed.cancelledBy
          };
          break;
          
        default:
          // For other categories, include all parsed fields
          Object.keys(parsed).forEach(key => {
            if (!['feedId', 'blockNum', 'txId', 'isVirtualOp', 'operationType', 'category', 'memo', 'rawMessage'].includes(key)) {
              transaction[key] = parsed[key];
            }
          });
      }
      
      mutations.transactions.push(transaction);
      
    } catch (error) {
      logger.error('Failed to transform feed entry', { 
        error: error.message, 
        feedId, 
        message 
      });
    }
  }

  // Note: Removed duplicate transformPower and transformGrant as they're now handled 
  // by transformBalance and transformGranted/transformGranting

  // Transform delegation
  transformDelegation(path, data, mutations) {
    const [_, from, to] = path;
    
    const delegation = {
      uid: `_:delegation_${from}_${to}`,
      'dgraph.type': 'Delegation',
      from: { username: from },
      to: { username: to },
      amount: data.vests || data,
      vestsPerDay: data.rate || 0,
      startBlock: data.startBlock || 0,
      createdAt: new Date().toISOString()
    };
    
    mutations.other.push(delegation);
  }

  
  // Note: transformService removed as it's replaced by transformServiceEndpoint and transformServiceObject
  
  // Note: Removed mapServiceType as we now store raw service types

  // Handle deletion
  handleDeletion(path, mutations, blockInfo) {
    // Special handling for specific deletion types
    if (path[0] === 'dex' && path.length >= 4) {
      // DEX order cancellation
      const [_, quoteCurrency, orderBook, orderId] = path;
      if ((orderBook === 'buyOrders' || orderBook === 'sellOrders') && orderId) {
        this.handleDexOrderCancellation(path, blockInfo, mutations);
        return;
      }
    }
    
    // Handle contract deletion
    if (path[0] === 'contract' && path.length === 3) {
      const [_, username, contractId] = path;
      this.handleContractDeletion(username, contractId, mutations, blockInfo);
      return;
    }
    
    // Track other deletions for later processing
    mutations.other.push({
      type: 'delete',
      path: path.join('.'),
      blockNum: blockInfo.blockNum
    });
  }
  
  // Get existing contract files from database
  async getExistingContractFiles(contractId) {
    try {
      const query = `
        query getContractFiles($contractId: string) {
          contract(func: eq(id, $contractId)) @filter(type(StorageContract)) {
            uid
            id
            files: ~contract {
              uid
              cid
              path
              name
              extension
              flags
            }
          }
        }
      `;
      
      const result = await this.dgraph.query(query, { $contractId: contractId });
      
      if (result.contract && result.contract.length > 0) {
        const contract = result.contract[0];
        return contract.files || [];
      }
      
      return [];
    } catch (error) {
      logger.warn('Failed to get existing contract files', { contractId, error: error.message });
      return [];
    }
  }
  
  // Remove files from their paths when contract is updated with fewer files
  async removeFilesFromPaths(filesToRemove, ownerUsername, mutations) {
    logger.info('Removing files from paths', { 
      fileCount: filesToRemove.length,
      owner: ownerUsername 
    });
    
    // Group files by path
    const filesByPath = new Map();
    for (const file of filesToRemove) {
      const filePath = file.path || '/';
      if (!filesByPath.has(filePath)) {
        filesByPath.set(filePath, []);
      }
      filesByPath.get(filePath).push(file);
    }
    
    // For each path, get current files and remove the ones being deleted
    for (const [filePath, files] of filesByPath) {
      try {
        // Query for the path to get its UID and current files
        const pathQuery = `
          query getPath($username: string, $fullPath: string) {
            path(func: type(Path)) @filter(eq(fullPath, $fullPath) AND eq(owner.username, $username)) {
              uid
              files {
                uid
                cid
              }
            }
          }
        `;
        
        const result = await this.dgraph.query(pathQuery, { 
          $username: ownerUsername,
          $fullPath: filePath 
        });
        
        if (result.path && result.path.length > 0) {
          const path = result.path[0];
          const pathUid = path.uid;
          
          // Get UIDs of files to remove
          const fileUidsToRemove = new Set(files.map(f => f.uid));
          
          // Filter out removed files from the path's files array
          let currentFiles = path.files || [];
          if (!Array.isArray(currentFiles)) {
            currentFiles = [currentFiles];
          }
          
          const remainingFiles = currentFiles.filter(f => !fileUidsToRemove.has(f.uid));
          
          // Update the path with the remaining files
          mutations.other.push({
            uid: pathUid,
            'dgraph.type': 'Path',
            files: remainingFiles.length > 0 ? remainingFiles : []
          });
          
          logger.info('Updated path files', {
            path: filePath,
            removedCount: files.length,
            remainingCount: remainingFiles.length
          });
        }
      } catch (error) {
        logger.warn('Failed to update path files', { 
          path: filePath, 
          error: error.message 
        });
      }
    }
    
    // Mark files as deleted in Dgraph
    for (const file of filesToRemove) {
      mutations.other.push({
        uid: file.uid,
        'dgraph.type': 'ContractFile',
        // Mark file as deleted by adding deletedAt timestamp
        deletedAt: new Date().toISOString(),
        isDeleted: true
      });
    }
  }
  
  // Merge path files properly - handles existing files from DB
  async mergePathFiles(mutations) {
    // For each path in mutations, ensure we have all files from the database
    // This is critical when processing multiple contracts that add files to the same directory
    if (!mutations.paths || mutations.paths.size === 0) return;
    
    for (const [key, path] of mutations.paths.entries()) {
      // Skip if this path already has a UID (it's from the database)
      if (path.uid && path.uid.startsWith('0x')) {
        // This is an existing path from the database
        // We need to ensure we have ALL files for this path
        try {
          // Query for all files associated with this path
          const filesQuery = `
            query getPathFiles($pathUid: string) {
              path(func: uid($pathUid)) {
                uid
                files {
                  uid
                  cid
                  name
                }
                # Also get files via reverse relationship as backup
                reverseFiles: ~parentPath @filter(type(ContractFile)) {
                  uid
                  cid
                  name
                  flags
                }
              }
            }
          `;
          
          const result = await this.dgraph.query(filesQuery, { $pathUid: path.uid });
          
          if (result.path && result.path.length > 0) {
            const pathData = result.path[0];
            
            // Build a map of all existing files
            const existingFileMap = new Map();
            
            // Add files from forward relationship
            if (pathData.files) {
              const forwardFiles = Array.isArray(pathData.files) ? pathData.files : [pathData.files];
              forwardFiles.forEach(f => existingFileMap.set(f.uid, f));
            }
            
            // Add files from reverse relationship (excluding hidden files)
            if (pathData.reverseFiles) {
              const reverseFiles = Array.isArray(pathData.reverseFiles) ? pathData.reverseFiles : [pathData.reverseFiles];
              reverseFiles.forEach(f => {
                if (!((f.flags || 0) & 2)) { // Exclude hidden files
                  existingFileMap.set(f.uid, { uid: f.uid, cid: f.cid, name: f.name });
                }
              });
            }
            
            // Now merge with files in the current mutation
            // Create a combined file array that includes both existing and new files
            const currentFiles = path.files || [];
            const currentFileUids = new Set(currentFiles.map(f => f.uid));
            
            // Add existing files that aren't already in the current files array
            for (const [uid, file] of existingFileMap) {
              if (!currentFileUids.has(uid)) {
                currentFiles.push(file);
              }
            }
            
            // Update the path's files array with the complete list
            path.files = currentFiles;
            
            logger.debug('Merged files for path', {
              pathUid: path.uid,
              fullPath: path.fullPath,
              existingFileCount: existingFileMap.size,
              newFileCount: currentFileUids.size,
              totalFileCount: currentFiles.length
            });
          }
        } catch (error) {
          logger.error('Failed to merge path files', {
            error: error.message,
            pathUid: path.uid,
            fullPath: path.fullPath
          });
        }
      }
    }
  }
  
  // Handle contract deletion
  async handleContractDeletion(username, contractId, mutations, blockInfo) {
    logger.info('Handling contract deletion', { username, contractId, blockNum: blockInfo.blockNum });
    
    // Ensure contractId is in full format
    let fullContractId = contractId;
    if (!contractId.includes(':')) {
      // If it's just the block-txid part, construct full ID
      fullContractId = `${username}:0:${contractId}`;
    }
    
    // Get all files from this contract
    const existingFiles = await this.getExistingContractFiles(fullContractId);
    
    if (existingFiles.length > 0) {
      // Remove all files from their paths
      await this.removeFilesFromPaths(existingFiles, username, mutations);
    }
    
    // Create a deletion record to track in the database
    mutations.other.push({
      uid: `_:contract_deletion_${username}_${contractId}_${blockInfo.blockNum}`,
      'dgraph.type': 'ContractDeletion',
      contractId: fullContractId,
      deletedAt: blockInfo.blockNum,
      timestamp: new Date().toISOString()
    });
    
    // Get contract UID from query and mark as cancelled
    try {
      const contractQuery = `
        query getContract($contractId: string) {
          contract(func: eq(id, $contractId)) @filter(type(StorageContract)) {
            uid
          }
        }
      `;
      
      const contractResult = await this.dgraph.query(contractQuery, { $contractId: fullContractId });
      
      if (contractResult.contract && contractResult.contract.length > 0) {
        const contractUid = contractResult.contract[0].uid;
        
        // Mark the contract as cancelled using its actual UID
        mutations.other.push({
          uid: contractUid,
          'dgraph.type': 'StorageContract',
          status: 2, // CANCELLED status
          statusText: 'CANCELLED',
          cancelledAt: blockInfo.blockNum
        });
      }
    } catch (error) {
      logger.warn('Failed to get contract UID for cancellation', { contractId: fullContractId, error: error.message });
    }
  }
  
  // Handle DEX order cancellation
  handleDexOrderCancellation(path, blockInfo, mutations) {
    const [dexType, quoteCurrency, orderBook, orderId] = path;
    
    // Determine token type
    let token;
    switch (dexType) {
      case 'dex': token = 'LARYNX'; break;
      case 'dexs': token = 'SPK'; break;
      case 'dexb': token = 'BROCA'; break;
      default: return;
    }
    
    const marketId = `${token}:${quoteCurrency.toUpperCase()}`;
    const fullOrderId = `${marketId}:${orderId}`;
    
    // Create cancellation record
    const cancellation = {
      uid: `_:cancel_${fullOrderId.replace(/[:/\-]/g, '_')}_${blockInfo.blockNum}`,
      'dgraph.type': 'OrderCancellation',
      orderId: fullOrderId,
      market: { id: marketId },
      orderType: orderBook === 'buyOrders' ? 'BUY' : 'SELL',
      cancelledAt: blockInfo.blockNum,
      timestamp: new Date().toISOString()
    };
    
    mutations.other.push(cancellation);
    
    // Also update the order status if we have it
    if (mutations.orders && mutations.orders.has(fullOrderId)) {
      const order = mutations.orders.get(fullOrderId);
      order.status = 'CANCELLED';
      order.cancelledAt = blockInfo.blockNum;
    }
  }

  // Transform price feed data
  transformPriceFeed(path, data, mutations) {
    // Path: ['priceFeeds', 'baseCurrency', 'quoteCurrency']
    if (path.length < 3) return;
    
    const [_, baseCurrency, quoteCurrency] = path;
    const feedId = `${baseCurrency}_${quoteCurrency}`;
    
    const priceFeed = {
      uid: `_:pricefeed_${feedId}`,
      'dgraph.type': 'PriceFeed',
      id: feedId,
      baseCurrency,
      quoteCurrency,
      timestamp: new Date().toISOString()
    };
    
    if (typeof data === 'number') {
      // Simple price value
      priceFeed.price = data;
    } else if (typeof data === 'object' && data !== null) {
      // Complex price data
      priceFeed.price = data.price || 0;
      priceFeed.volume = data.volume || 0;
      priceFeed.source = data.source || '';
      if (data.timestamp) {
        priceFeed.timestamp = new Date(data.timestamp * 1000).toISOString();
      }
    }
    
    mutations.other.push(priceFeed);
  }
  
  // Transform runner node data
  async transformRunner(account, data, mutations) {
    await this.ensureAccount(account, mutations);
    
    const accountData = mutations.accounts.get(account);
    
    if (typeof data === 'string') {
      // Simple API endpoint
      accountData.runnerNode = {
        api: data,
        active: true
      };
    } else if (typeof data === 'object' && data !== null) {
      // Complex runner data
      accountData.runnerNode = {
        api: data.api || '',
        location: data.location || '',
        version: data.version || '',
        lastSeen: data.lastSeen || 0,
        services: data.services || [],
        active: true
      };
      
      // Performance metrics
      if (data.performance) {
        accountData.runnerNode.uptime = data.performance.uptime || 0;
        accountData.runnerNode.latency = data.performance.latency || 0;
        accountData.runnerNode.successRate = data.performance.successRate || 0;
      }
    }
    
    // Mark existing accounts as having updates
    if (accountData.isExisting) {
      accountData.hasUpdates = true;
    }
  }
  
  // Transform SPK power data
  async transformSpow(account, data, mutations) {
    await this.ensureAccount(account, mutations);
    
    const accountData = mutations.accounts.get(account);
    
    if (typeof data === 'number') {
      // Simple power value
      accountData.spkPower = data;
    } else if (typeof data === 'object' && data !== null) {
      // Complex power data with delegation info
      accountData.spkPower = data.total || 0;
      accountData.spkPowerSelf = data.self || 0;
      accountData.spkPowerDelegated = data.delegated || 0;
      
      // Store delegator list if present
      if (data.delegators && Array.isArray(data.delegators)) {
        accountData.spkDelegators = data.delegators;
      }
    }
    
    // Mark existing accounts as having updates
    if (accountData.isExisting) {
      accountData.hasUpdates = true;
    }
  }
  
  // Transform unclaimed BROCA data
  async transformUbroca(account, data, mutations) {
    await this.ensureAccount(account, mutations);
    
    const accountData = mutations.accounts.get(account);
    
    if (typeof data === 'number') {
      // Simple unclaimed amount
      accountData.unclaimedBroca = data;
    } else if (typeof data === 'object' && data !== null) {
      // Complex unclaimed data
      accountData.unclaimedBroca = data.amount || 0;
      accountData.unclaimedBrocaExpires = data.expiresBlock || 0;
      accountData.unclaimedBrocaSource = data.source || '';
    }
    
    // Mark existing accounts as having updates
    if (accountData.isExisting) {
      accountData.hasUpdates = true;
    }
  }
  
  // Transform chain state data
  transformChainState(path, data, mutations) {
    const [_, key, ...subKeys] = path;
    
    const chainState = {
      uid: `_:chain_${key}_${subKeys.join('_')}`.replace(/[\.\-]/g, '_'),
      'dgraph.type': 'ChainState',
      key: key,
      timestamp: new Date().toISOString()
    };
    
    if (subKeys.length > 0) {
      chainState.subKey = subKeys.join('.');
    }
    
    // Store value based on type
    if (typeof data === 'object' && data !== null) {
      chainState.value = JSON.stringify(data);
    } else {
      chainState.value = data;
    }
    
    mutations.other.push(chainState);
  }
  
  // Transform scheduled operations (chrono)
  transformChrono(path, data, mutations) {
    // Path: ['chrono', 'blockNumber', 'operationId']
    if (path.length < 3) return;
    
    const [_, blockNumber, operationId] = path;
    
    const scheduledOp = {
      uid: `_:chrono_${blockNumber}_${operationId.replace(/[\.\-]/g, '_')}`,
      'dgraph.type': 'ScheduledOperation',
      scheduledBlock: parseInt(blockNumber) || 0,
      operationId: operationId,
      timestamp: new Date().toISOString()
    };
    
    if (typeof data === 'string') {
      // Simple target data
      scheduledOp.targetData = data;
      
      // Try to parse operation type from operationId
      if (operationId.includes('expire_contract')) {
        scheduledOp.operationType = 'expire_contract';
        scheduledOp.target = data;
      } else if (operationId.includes('process_auction')) {
        scheduledOp.operationType = 'process_auction';
        scheduledOp.target = data;
      } else {
        scheduledOp.operationType = operationId.split('_')[0] || 'unknown';
      }
    } else if (typeof data === 'object' && data !== null) {
      // Complex operation data
      scheduledOp.operationType = data.operation || operationId.split('_')[0] || 'unknown';
      scheduledOp.target = data.target || '';
      scheduledOp.scheduled_block = data.scheduled_block || parseInt(blockNumber) || 0;
      
      // Store full data
      scheduledOp.operationData = JSON.stringify(data);
    }
    
    mutations.other.push(scheduledOp);
  }
  
  // Transform enhanced stats data
  transformStats(path, data, blockInfo, mutations) {
    const [_, ...keyParts] = path;
    
    const stats = {
      uid: `_:stats_${keyParts.join('_').replace(/[\.\-]/g, '_')}_${blockInfo.blockNum}`,
      'dgraph.type': 'NetworkStats',
      statKey: keyParts.join('.'),
      blockNumber: blockInfo.blockNum,
      timestamp: new Date().toISOString()
    };
    
    // Add category if nested path
    if (keyParts.length > 1) {
      stats.statCategory = keyParts[0];
    }
    
    // Store value based on type - always as string for Dgraph compatibility
    if (typeof data === 'object' && data !== null) {
      stats.statValue = JSON.stringify(data);
    } else {
      // Convert to string to match Dgraph schema
      stats.statValue = String(data);
    }
    
    mutations.other.push(stats);
  }

  // Build final Dgraph mutations
  async buildMutations(mutations, blockInfo) {
    const dgraphMutations = [];
    
    // Separate path mutations to handle file accumulation properly
    const pathMutations = new Map();
    
    // Handle paths with existing files - we need to merge them properly
    if (mutations.paths && mutations.paths.size > 0) {
      logger.info('Found paths in mutations', { 
        pathCount: mutations.paths.size,
        samplePaths: Array.from(mutations.paths.keys()).slice(0, 3)
      });
      
      await this.mergePathFiles(mutations);
      
      // Move paths to separate collection for special handling
      for (const [key, path] of mutations.paths) {
        pathMutations.set(key, path);
      }
      // Clear paths from main mutations to handle them separately
      mutations.paths.clear();
    } else {
      logger.warn('No paths found in mutations');
    }
    
    // Add accounts (new ones and existing ones with updates)
    // Also track which existing accounts are referenced
    const referencedAccounts = new Set();
    
    // First pass: find all referenced accounts from paths and contracts
    // Use pathMutations instead of mutations.paths since we moved them
    for (const path of pathMutations.values()) {
      if (path.owner && path.owner.uid && path.owner.uid.startsWith('0x')) {
        referencedAccounts.add(path.owner.uid);
      }
    }
    for (const contract of mutations.contracts.values()) {
      if (contract.owner && contract.owner.uid && contract.owner.uid.startsWith('0x')) {
        referencedAccounts.add(contract.owner.uid);
      }
    }
    
    // Add accounts
    for (const account of mutations.accounts.values()) {
      // Always add new accounts
      if (!account.isExisting) {
        const cleanAccount = { ...account };
        delete cleanAccount.isExisting;
        delete cleanAccount.hasUpdates;
        dgraphMutations.push(this.validateFieldTypes(cleanAccount));
      } 
      // Add existing accounts if they have updates OR are referenced
      else if (account.hasUpdates || referencedAccounts.has(account.uid)) {
        // For referenced accounts, we need to include at least the uid and type
        const cleanAccount = { 
          uid: account.uid,
          username: account.username,
          'dgraph.type': 'Account'
        };
        // Include other fields if account has updates
        if (account.hasUpdates) {
          Object.assign(cleanAccount, account);
          delete cleanAccount.isExisting;
          delete cleanAccount.hasUpdates;
        }
        dgraphMutations.push(this.validateFieldTypes(cleanAccount));
      }
    }
    
    // Add contracts and extract nested entities
    logger.info('Adding contracts to mutations', { count: mutations.contracts.size });
    for (const contract of mutations.contracts.values()) {
      // Extract encryption keys as separate mutations
      if (contract.encryptionKeys && Array.isArray(contract.encryptionKeys)) {
        for (const encKey of contract.encryptionKeys) {
          dgraphMutations.push(encKey);
        }
        // Remove from contract to avoid nested mutation issues
        delete contract.encryptionKeys;
      }
      
      // Storage nodes are now just references to Account UIDs
      // No need to extract them as separate mutations
      
      // Debug logging for storage nodes
      if (contract.storageNodes) {
        console.log('Contract has storage nodes:', {
          contractId: contract.id,
          storageNodeCount: contract.storageNodes.length,
          storageNodes: contract.storageNodes
        });
      } else {
        console.log('Contract has NO storage nodes:', {
          contractId: contract.id,
          nodeTotal: contract.nodeTotal
        });
      }
      
      dgraphMutations.push(this.validateFieldTypes(contract));
    }
    
    // Add files
    for (const file of mutations.files.values()) {
      // Only add new files or existing files with updates
      if (!file.isExisting || file.hasUpdates) {
        const cleanFile = { ...file };
        delete cleanFile.isExisting;
        delete cleanFile.hasUpdates;
        dgraphMutations.push(this.validateFieldTypes(cleanFile));
      }
    }
    
    // No longer process paths here - they're handled separately
    
    // Add transactions
    dgraphMutations.push(...mutations.transactions.map(t => this.validateFieldTypes(t)));
    
    // Add DEX markets
    if (mutations.dexMarkets) {
      for (const market of mutations.dexMarkets.values()) {
        dgraphMutations.push(this.validateFieldTypes(market));
      }
    }
    
    // Add orders
    if (mutations.orders) {
      for (const order of mutations.orders.values()) {
        dgraphMutations.push(this.validateFieldTypes(order));
      }
    }
    
    // Add OHLC data
    if (mutations.ohlc) {
      dgraphMutations.push(...mutations.ohlc.map(o => this.validateFieldTypes(o)));
    }
    
    // Add other mutations
    dgraphMutations.push(...mutations.other.map(o => this.validateFieldTypes(o)));
    
    // Handle path mutations with file accumulation
    // Add paths back but with special handling for file arrays
    if (pathMutations.size > 0) {
      logger.info('Processing path mutations with accumulated files', {
        pathCount: pathMutations.size
      });
      
      // Calculate counts for paths
      const pathsForCounting = { paths: pathMutations };
      this.calculatePathCounts(pathsForCounting);
      
      for (const [key, path] of pathMutations) {
        if (path.files && path.files.length > 0) {
          logger.info('Path has accumulated files', {
            fullPath: path.fullPath,
            fileCount: path.files.length,
            isExistingPath: path.uid && path.uid.startsWith('0x')
          });
        }
        
        // For existing paths with files, we need special handling
        if (path.uid && path.uid.startsWith('0x') && path.files && path.files.length > 0) {
          // Create a mutation that updates only the files array
          const pathUpdate = {
            uid: path.uid,
            'dgraph.type': 'Path',
            files: path.files,
            itemCount: path.itemCount || path.files.length
          };
          dgraphMutations.push(pathUpdate);
        } else {
          // For new paths, add the complete path
          dgraphMutations.push(this.validateFieldTypes(path));
        }
      }
    }
    
    logger.info('Built dgraph mutations', { 
      total: dgraphMutations.length,
      accounts: mutations.accounts.size,
      contracts: mutations.contracts.size,
      files: mutations.files.size,
      paths: pathMutations.size,
      transactions: mutations.transactions.length,
      other: mutations.other.length
    });
    
    return dgraphMutations;
  }

  // Validate and fix field types for Dgraph compatibility
  validateFieldTypes(mutation) {
    if (!mutation || typeof mutation !== 'object') {
      return mutation;
    }

    // Clone the mutation to avoid modifying the original
    const validated = { ...mutation };

    // Define integer fields from schema
    const integerFields = [
      'larynxBalance', 'spkBalance', 'broca', 'brocaAmount', 'liquidBroca',
      'claimableLarynx', 'claimableBroca', 'claimableSpk', 'power', 'brocaPower',
      'storageBroca', 'validatorBroca', 'spkBlock', 'spkPower', 'powerGranted',
      'contractType', 'blockNumber', 'authorized', 'status', 'refunded',
      'utilized', 'verified', 'expiresBlock', 'fileCount', 'nodeTotal',
      'size', 'flags', 'itemCount', 'newestBlockNumber', 'profferType',
      'createdBlock', 'paidAmount', 'blocksPaid', 'startBlock', 'endBlock',
      'blockBucket', 'rate', 'amount', 'amountFilled', 'expireBlock',
      'votes', 'rank', 'lastBlock', 'totalMined', 'baseAmount', 'lastUpdate',
      'maxBroca', 'bidRate', 'lastGood', 'attempts', 'successes', 'strikes',
      'duration', 'members', 'totalBlocks', 'missedBlocks', 'totalSize',
      'open', 'high', 'low', 'close', 'volumeQuote', 'volumeToken',
      'unclaimedBroca', 'unclaimedBrocaExpires', 'spkPowerSelf', 'spkPowerDelegated',
      'lastSeen', 'scheduledBlock', 'statBlockNumber'
    ];

    // Validate and fix integer fields
    for (const field of integerFields) {
      if (validated.hasOwnProperty(field)) {
        const value = validated[field];
        
        if (typeof value === 'string') {
          // Handle comma-separated values (e.g., "80975487,5qUoh")
          if (value.includes(',')) {
            const parts = value.split(',');
            const numericPart = parseInt(parts[0]);
            validated[field] = isNaN(numericPart) ? 0 : numericPart;
          } else {
            // Try to parse as integer
            const parsed = parseInt(value);
            validated[field] = isNaN(parsed) ? 0 : parsed;
          }
        } else if (typeof value === 'object' && value !== null) {
          // Convert objects to 0 (invalid for integer fields)
          validated[field] = 0;
        } else if (typeof value === 'number') {
          // Ensure it's an integer
          validated[field] = Math.floor(value);
        } else if (value === null || value === undefined) {
          validated[field] = 0;
        }
      }
    }

    // Define UID reference fields from schema
    const uidFields = [
      'owner', 'purchaser', 'contract', 'from', 'to', 'grantor', 'grantee',
      'account', 'parent', 'currentFile', 'market', 'storageAccount', 'parentPath'
    ];

    // Handle UID fields - ensure they have proper structure
    for (const field of uidFields) {
      if (validated.hasOwnProperty(field)) {
        const value = validated[field];
        if (typeof value === 'object' && value !== null && value.uid) {
          // Already correct format
          continue;
        } else if (typeof value === 'string') {
          // Convert string to UID reference
          validated[field] = { uid: value };
        } else if (typeof value === 'object' && value !== null) {
          // If it's an object without uid, try to extract or remove
          if (value.username) {
            // Convert username reference to proper UID
            const accountUid = `_:account_${value.username.replace(/[\.\-]/g, '_')}`;
            validated[field] = { uid: accountUid };
          } else {
            // Remove invalid UID reference
            delete validated[field];
          }
        }
      }
    }

    // Handle any remaining object values that might be sent to string fields
    for (const [key, value] of Object.entries(validated)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value) && 
          key !== 'uid' && !key.startsWith('dgraph.') && !integerFields.includes(key) && !uidFields.includes(key)) {
        // Convert objects to JSON strings for non-integer, non-UID fields
        validated[key] = JSON.stringify(value);
      }
    }

    // Debug logging for storageNodes
    if (mutation.storageNodes !== undefined) {
      console.log('validateFieldTypes - storageNodes:', {
        before: mutation.storageNodes,
        after: validated.storageNodes,
        isArray: Array.isArray(validated.storageNodes)
      });
    }

    return validated;
  }

  // Check if operation should be skipped
  shouldSkipOperation(path) {
    // Skip witness operations (internal price tracking)
    if (path[0] === 'witness') {
      return true;
    }
    
    // Skip rand operations (internal randomness)
    if (path[0] === 'rand') {
      return true;
    }
    
    // Skip IPFS operations (cid-reversed -> internal lottery and contract pointer)
    if (path[0] === 'IPFS') {
      return true;
    }
    
    // Skip cPointers operations (contractID -> contract pointers)
    if (path[0] === 'cPointers') {
      return true;
    }
    
    // Skip daily report entries (internal directory content)
    if (path[0] === 'escrow') {
      return true;
    }
    
    // Skip other internal consensus paths
    const internalPaths = [
      'forks',       // Fork management (internal)
      'temp',        // Temporary data
      'validation',  // Validation state (internal)
    ];
    
    if (internalPaths.includes(path[0])) {
      return true;
    }
    
    return false;
  }
  
  // Get human-readable contract status
  getContractStatusText(statusCode) {
    const statusMap = {
      0: 'PENDING',
      1: 'UPLOADING',
      2: 'PROCESSING',
      3: 'ACTIVE',
      4: 'EXPIRED',
      5: 'CANCELLED'
    };
    return statusMap[statusCode] || 'UNKNOWN';
  }
  
  // Parse metadata string based on actual format
  parseMetadata(metadataString, contractId) {
    if (!metadataString) return null;
    
    // First check if this is encryption-only format (starts with # and no pipe)
    if (metadataString.startsWith('#') && !metadataString.includes('|')) {
      // This is the simple encryption format like "#key@user,filedata"
      // The encryption data ends at the first comma after the @ symbol
      // But the username itself might be "dbuzz" not "dbuzz,unnamed,png,,1,"
      
      // Find where the actual encryption data ends
      // Look for @ followed by username (no commas in username)
      const match = metadataString.match(/#.*?@([^,;]+)/);
      let encData = metadataString;
      
      if (match) {
        // Extract up to and including the username
        const endIndex = metadataString.indexOf(match[1]) + match[1].length;
        encData = metadataString.substring(0, endIndex);
      }
      
      // Parse encryption and auto-renew flags
      const autoRenew = false; // No autorenew flag in this format
      const encrypted = true;
      
      // Parse encryption keys
      logger.debug('Parsing simple encryption format', { contractId, encData, fullMetadata: metadataString });
      const encryptionKeys = this.parseEncryptionKeys(encData, contractId);
      
      return {
        uid: `_:metadata_${contractId.replace(/[:/\-]/g, '_')}`,
        'dgraph.type': 'ContractMetadata',
        autoRenew,
        encrypted,
        encData,
        folderStructure: JSON.stringify({ '0': '/' }), // Default root folder
        rawMetadata: metadataString,
        encryptionKeys
      };
    }
    
    // Original parsing logic for standard format
    // Split by comma first to get contract data
    const metaParts = metadataString.split(',');
    const contractData = metaParts[0] || '';
    
    // Handle pipe-separated format
    const parts = contractData.split('|');
    let encData = parts[0] || '';
    let folderListStr = parts.length > 1 ? parts.slice(1).join('|') : '';
    
    // Fallback for non-pipe-separated metadata
    if (parts.length === 1 && metadataString.includes(',')) {
      const temp = metadataString.split(';');
      encData = temp[0] || '';
      folderListStr = ''; // No folder data in this format
    }
    
    // Parse encryption and auto-renew flags
    const autoRenew = (this.base64ToNumber(encData[0] || '0') & 1) ? true : false;
    const encrypted = encData.includes('#');
    
    // Parse encryption keys if present
    let encryptionKeys = [];
    if (encrypted && encData.includes('#')) {
      encryptionKeys = this.parseEncryptionKeys(encData, contractId);
    }
    
    // Parse folder structure
    const folderStructure = this.parseFolderList(folderListStr);
    
    return {
      uid: `_:metadata_${contractId.replace(/[:/\-]/g, '_')}`,
      'dgraph.type': 'ContractMetadata',
      autoRenew,
      encrypted,
      encData,
      folderStructure: JSON.stringify(folderStructure), // Store as JSON string
      rawMetadata: metadataString,
      encryptionKeys
    };
  }
  
  // Parse folder list from metadata
  parseFolderList(folderListStr) {
    if (!folderListStr) return {};
    
    const indexToPath = {};
    const folders = folderListStr.split('|');
    
    // Custom indices for folders following base58 pattern
    const customIndices = ['1', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
    let customFolderCount = 0;
    
    folders.forEach((folder) => {
      if (folder && folder !== '/') {
        if (customFolderCount < customIndices.length) {
          const folderIndex = customIndices[customFolderCount];
          
          // Handle subfolder format like "1/Resources"
          if (folder.includes('/')) {
            const slashIndex = folder.indexOf('/');
            const parentIndex = folder.substring(0, slashIndex);
            const folderName = folder.substring(slashIndex + 1);
            
            // Build full path based on parent
            const parentPath = indexToPath[parentIndex] || '';
            const fullPath = parentPath ? `${parentPath}/${folderName}` : folderName;
            indexToPath[folderIndex] = fullPath;
          } else {
            // Regular top-level folder
            indexToPath[folderIndex] = folder;
          }
          
          customFolderCount++;
        }
      }
    });
    
    return indexToPath;
  }
  
  // Convert base64 character to number
  base64ToNumber(char) {
    const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    return base64Chars.indexOf(char);
  }
  
  // Parse metadata string based on SPK Network format
  parseMetadataString(metadataString, cids) {
    if (!metadataString) {
      return {
        version: '1',
        encryptionKeys: '',
        folders: [],
        folderMap: new Map(),
        files: new Map()
      };
    }

    // Remove quotes if present
    let cleanMetadata = metadataString.replace(/^"/, '').replace(/"$/, '');
    
    // First split by comma to separate all parts
    const parts = cleanMetadata.split(',');
    
    // First part is the contract header: "contractflags#encryptiondata|folder|tree"
    const contractHeader = parts[0] || '';
    
    // Split header to get flags/encryption and folders
    const pipeIndex = contractHeader.indexOf('|');
    let contractFlagsAndEnc = contractHeader;
    let folderString = '';
    
    if (pipeIndex !== -1) {
      contractFlagsAndEnc = contractHeader.substring(0, pipeIndex);
      folderString = contractHeader.substring(pipeIndex + 1);
    }
    
    // Parse contract flags and encryption data
    const [contractFlags = '1', encryptionKeys = ''] = contractFlagsAndEnc.split('#');
    const version = contractFlags.charAt(0) || '1';

    // Parse folders
    const folders = [];
    const folderMap = new Map();
    
    // Add root folder - '0' represents root, '1' will be first custom folder or root
    folderMap.set('0', { index: '0', name: '', parent: '', fullPath: '' });
    
    // Add preset folders
    const presetFolders = {
      '2': 'Documents',
      '3': 'Images', 
      '4': 'Videos',
      '5': 'Music',
      '6': 'Archives',
      '7': 'Code',
      '8': 'Trash',
      '9': 'Misc'
    };
    
    for (const [index, name] of Object.entries(presetFolders)) {
      folderMap.set(index, {
        index,
        name,
        parent: '',
        fullPath: name
      });
    }
    
    // Parse custom folders from the folder string
    if (folderString) {
      const folderDefs = folderString.split('|');
      const customIndices = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      let customIndex = 0;
      
      let topLevelCustomCount = 0;
      let totalCustomCount = 0;
      
      for (const folderDef of folderDefs) {
        if (!folderDef) continue;
        
        let folderIndex, folderName, parentIndex;
        
        if (folderDef.includes('/')) {
          // Subfolder format: parentIndex/folderName
          const slashIndex = folderDef.indexOf('/');
          parentIndex = folderDef.substring(0, slashIndex);
          folderName = folderDef.substring(slashIndex + 1);
          // All custom folders after the first use base58 indices
          folderIndex = customIndices[totalCustomCount - 1];
        } else {
          // Top-level custom folder
          folderName = folderDef;
          parentIndex = '0';
          // First custom folder gets index '1', rest get base58 starting at A
          if (topLevelCustomCount === 0) {
            folderIndex = '1';
          } else {
            folderIndex = customIndices[totalCustomCount - 1];
          }
          topLevelCustomCount++;
        }
        
        const folderInfo = {
          index: folderIndex,
          name: folderName,
          parent: parentIndex,
          fullPath: this.buildFolderPath(parentIndex, folderName, folderMap)
        };
        
        folders.push(folderInfo);
        folderMap.set(folderIndex, folderInfo);
        totalCustomCount++;
      }
    }

    // Parse files - format changes based on whether we have folder structure
    const files = new Map();
    const sortedCids = [...cids].sort();
    
    // For simple format without folders (e.g., "NFTs,bz,nft,,0--")
    // The first part might be a folder name OR the start of file data
    // We should NOT automatically create a folder with index '1'
    // Files will use their pathIndex from the extension (e.g., png.3 means Images folder)
    
    // Original parsing for complex format with explicit folder structure
    const partsPerFile = 4;
    for (let i = 0; i < sortedCids.length; i++) {
      const cid = sortedCids[i];
      const baseIndex = i * partsPerFile + 1; // +1 to skip contract header
      
      if (baseIndex + 3 < parts.length) {
        const name = parts[baseIndex] || '';
        const extAndPath = parts[baseIndex + 1] || '';
        const thumb = parts[baseIndex + 2] || '';
        const flagsData = parts[baseIndex + 3] || '0--';
        
        // Parse extension and folder index from "ext.folderindex"
        let ext = extAndPath;
        let pathIndex = '1'; // Default to first folder when no index specified
        
        const lastDotIndex = extAndPath.lastIndexOf('.');
        if (lastDotIndex !== -1) {
          ext = extAndPath.substring(0, lastDotIndex);
          pathIndex = extAndPath.substring(lastDotIndex + 1) || '1';
        }
        
        // Parse flags-license-labels
        const [flags = '0', license = '', labels = ''] = flagsData.split('-');
        
        const metadata = {
          name,
          ext,
          pathIndex,
          thumb,
          flags,
          license,
          labels,
          folder: folderMap.has(pathIndex) ? folderMap.get(pathIndex).fullPath : '',
          fullPath: folderMap.has(pathIndex) && folderMap.get(pathIndex).fullPath 
            ? `${folderMap.get(pathIndex).fullPath}/${name}${ext ? '.' + ext : ''}`
            : `${name}${ext ? '.' + ext : ''}`
        };
        
        files.set(cid, metadata);
      }
    }
    
    return {
      version,
      encryptionKeys,
      folders,
      folderMap,
      files,
      hasCustomFolders: folderString !== '' // Track if custom folders were defined
    };
  }
  
  // Helper method to build folder path
  buildFolderPath(parentIndex, folderName, folderMap) {
    if (!parentIndex || parentIndex === '0') {
      // Root-level folders should have leading /
      return `/${folderName}`;
    }
    
    const parent = folderMap.get(parentIndex);
    if (parent && parent.fullPath) {
      return `${parent.fullPath}/${folderName}`;
    }
    
    // Default case - ensure leading /
    return `/${folderName}`;
  }
  
  // Get MIME type from file type code
  getMimeType(typeCode) {
    const typeMap = {
      'img': 'image/jpeg',
      'jpg': 'image/jpeg', 
      'png': 'image/png',
      'gif': 'image/gif',
      'vid': 'video/mp4',
      'mp4': 'video/mp4',
      'avi': 'video/avi',
      'doc': 'application/msword',
      'pdf': 'application/pdf',
      'zip': 'application/zip',
      'txt': 'text/plain',
      'json': 'application/json',
      'nft': 'application/nft',
      'bz': 'application/x-bzip2'
    };
    
    return typeMap[typeCode?.toLowerCase()] || 'application/octet-stream';
  }
  
  // Parse encryption keys from encData
  parseEncryptionKeys(encData, contractId) {
    const keys = [];
    
    // Format: "version#key1@user1;#key2@user2..."
    // First split by semicolon to get each key entry
    const entries = encData.split(';');
    
    entries.forEach((entry) => {
      // Each entry is like "#encryptedKey@username" or "version#encryptedKey@username"
      if (entry.includes('#') && entry.includes('@')) {
        // Find the last @ to split key and username (key might contain @)
        const lastAtIndex = entry.lastIndexOf('@');
        if (lastAtIndex > 0) {
          const encryptedKey = entry.substring(entry.indexOf('#') + 1, lastAtIndex);
          const username = entry.substring(lastAtIndex + 1);
          
          if (username && encryptedKey) {
            keys.push({
              uid: `_:enckey${Math.random().toString(36).substring(2, 9)}`,
              'dgraph.type': 'EncryptionKey',
              sharedWith: { username },
              encryptedKey,
              keyType: 'AES-256', // Default, could be parsed from metadata
              keyContract: { id: contractId }
            });
          }
        }
      }
    });
    
    return keys;
  }

  // Create or update path entities for a user
  async getOrCreatePath(username, fullPath, type = 'directory', mutations) {
    const userKey = username;
    if (!this.userPaths.has(userKey)) {
      this.userPaths.set(userKey, new Map());
    }
    
    const userPathMap = this.userPaths.get(userKey);
    const mutationKey = `${username}:${fullPath}`;
    
    // CRITICAL: Always check mutations map first to ensure consistency within transaction
    if (mutations.paths && mutations.paths.has(mutationKey)) {
      logger.debug('Found path in current mutations', { username, fullPath, mutationKey });
      return mutations.paths.get(mutationKey);
    }
    
    // Check path accumulator for paths from previous batches
    if (pathAccumulator.batchMode && pathAccumulator.hasPath(username, fullPath)) {
      logger.debug('Path has files in accumulator from previous batch', { 
        username, 
        fullPath,
        accumulatorFiles: pathAccumulator.getPathFiles(username, fullPath).length 
      });
    }
    
    // Then check memory cache
    if (userPathMap.has(fullPath)) {
      logger.debug('Found path in memory cache', { username, fullPath });
      const cachedPath = userPathMap.get(fullPath);
      
      // CRITICAL: Add the cached path to mutations so it gets included in the batch
      if (!mutations.paths) {
        mutations.paths = new Map();
      }
      mutations.paths.set(mutationKey, cachedPath);
      
      return cachedPath;
    }
    
    // Check if path already exists in database
    // Use cascade to properly filter by owner.username
    const existingPathQuery = `
      query getExistingPath($username: string, $fullPath: string) {
        path(func: type(Path)) @filter(eq(fullPath, $fullPath) AND has(owner)) @cascade {
          uid
          fullPath
          pathName
          pathType
          owner @filter(eq(username, $username)) {
            uid
            username
          }
          files {
            uid
            cid
            name
          }
          itemCount
          newestBlockNumber
          currentFile {
            uid
          }
          children {
            uid
          }
          parent {
            uid
          }
        }
      }
    `;
    
    try {
      const result = await this.dgraph.query(existingPathQuery, { 
        $username: username,
        $fullPath: fullPath 
      });
      
      if (result.path && result.path.length > 0) {
        // If multiple paths exist, use the one with the most files
        let existingPath = result.path[0];
        if (result.path.length > 1) {
          logger.warn('Multiple paths found for same owner+fullPath', {
            username,
            fullPath,
            count: result.path.length,
            paths: result.path.map(p => ({ uid: p.uid, fileCount: p.files?.length || 0 }))
          });
          
          // Pick the one with the most files
          existingPath = result.path.reduce((best, current) => {
            const bestFileCount = best.files ? (Array.isArray(best.files) ? best.files.length : 1) : 0;
            const currentFileCount = current.files ? (Array.isArray(current.files) ? current.files.length : 1) : 0;
            return currentFileCount > bestFileCount ? current : best;
          });
        }
        
        logger.debug('Found existing path in database', { 
          username,
          fullPath,
          uid: existingPath.uid,
          fileCount: existingPath.files ? (Array.isArray(existingPath.files) ? existingPath.files.length : 1) : 0
        });
        
        // Create a mutable version of the existing path for mutations
        // Check if we already have a mutable version in mutations
        if (mutations.paths && mutations.paths.has(mutationKey)) {
          // Return the existing mutable version to preserve file additions
          return mutations.paths.get(mutationKey);
        }
        
        // IMPORTANT: Query for ALL files via reverse relationship to ensure we get them all
        // The forward relationship (files) might be incomplete due to previous bugs
        let allFiles = [];
        try {
          const filesQuery = `
            query getPathFiles($pathUid: string) {
              path(func: uid($pathUid)) {
                files {
                  uid
                  cid
                  name
                }
                # Also get files via reverse relationship as backup
                reverseFiles: ~parentPath @filter(type(ContractFile)) {
                  uid
                  cid
                  name
                  flags
                }
              }
            }
          `;
          
          const filesResult = await this.dgraph.query(filesQuery, { $pathUid: existingPath.uid });
          
          if (filesResult.path && filesResult.path.length > 0) {
            const pathData = filesResult.path[0];
            
            // Combine files from both forward and reverse relationships
            const fileMap = new Map();
            
            // Add files from forward relationship
            if (pathData.files) {
              const forwardFiles = Array.isArray(pathData.files) ? pathData.files : [pathData.files];
              forwardFiles.forEach(f => fileMap.set(f.uid, f));
            }
            
            // Add files from reverse relationship (excluding hidden files)
            if (pathData.reverseFiles) {
              const reverseFiles = Array.isArray(pathData.reverseFiles) ? pathData.reverseFiles : [pathData.reverseFiles];
              reverseFiles.forEach(f => {
                if (!((f.flags || 0) & 2)) { // Exclude hidden files
                  fileMap.set(f.uid, { uid: f.uid, cid: f.cid, name: f.name });
                }
              });
            }
            
            allFiles = Array.from(fileMap.values());
            
            logger.debug('Queried all files for path', {
              pathUid: existingPath.uid,
              forwardFiles: pathData.files ? (Array.isArray(pathData.files) ? pathData.files.length : 1) : 0,
              reverseFiles: pathData.reverseFiles ? (Array.isArray(pathData.reverseFiles) ? pathData.reverseFiles.length : 1) : 0,
              totalFiles: allFiles.length
            });
          }
        } catch (error) {
          logger.warn('Failed to query path files', { error: error.message, pathUid: existingPath.uid });
          // Fall back to files from original query
          allFiles = existingPath.files ? 
            (Array.isArray(existingPath.files) ? [...existingPath.files] : [existingPath.files]) : 
            [];
        }
        
        // Check if we already have files added to this path in the current batch
        let currentBatchFiles = [];
        const pathMutationKey = `${username}:${fullPath}`;
        if (mutations.paths && mutations.paths.has(pathMutationKey)) {
          const existingMutation = mutations.paths.get(pathMutationKey);
          currentBatchFiles = existingMutation.files || [];
          logger.debug('Path already exists in current batch', {
            fullPath,
            existingFiles: currentBatchFiles.length
          });
        }
        
        // Combine files from database with files from current batch AND accumulator
        const combinedFileMap = new Map();
        
        // Add files from database
        allFiles.forEach(f => combinedFileMap.set(f.uid, f));
        
        // Add files from current batch (these take precedence)
        currentBatchFiles.forEach(f => combinedFileMap.set(f.uid, f));
        
        // CRITICAL: Add files from path accumulator (cross-batch accumulation)
        if (pathAccumulator.batchMode) {
          const accumulatedFiles = pathAccumulator.getPathFiles(username, fullPath);
          accumulatedFiles.forEach(f => {
            if (!combinedFileMap.has(f.uid)) {
              combinedFileMap.set(f.uid, f);
            }
          });
          logger.debug('Added files from accumulator', {
            fullPath,
            accumulatedCount: accumulatedFiles.length,
            totalCombined: combinedFileMap.size
          });
        }
        
        const mutablePath = {
          uid: existingPath.uid,
          'dgraph.type': 'Path',
          fullPath: existingPath.fullPath,
          pathName: existingPath.pathName,
          pathType: existingPath.pathType || 'directory',
          owner: existingPath.owner,
          itemCount: existingPath.itemCount || 0,
          // Use the combined files array
          files: Array.from(combinedFileMap.values()),
          // Keep other existing properties
          newestBlockNumber: existingPath.newestBlockNumber,
          parent: existingPath.parent,
          children: existingPath.children || []
        };
        
        logger.debug('Created mutable path with combined files', {
          fullPath,
          dbFiles: allFiles.length,
          batchFiles: currentBatchFiles.length,
          totalFiles: mutablePath.files.length
        });
        
        // Store in mutations map first
        if (!mutations.paths) {
          mutations.paths = new Map();
        }
        mutations.paths.set(pathMutationKey, mutablePath);
        
        // Store the same reference in memory cache
        userPathMap.set(fullPath, mutablePath);
        
        // Register existing path in accumulator
        if (pathAccumulator.batchMode) {
          pathAccumulator.registerPath(username, fullPath, mutablePath.uid);
        }
        
        return mutablePath;
      }
    } catch (error) {
      logger.warn('Failed to query existing path', { 
        error: error.message,
        username,
        fullPath
      });
    }
    
    // Ensure account exists and get the UID
    const accountUid = await this.ensureAccount(username, mutations);
    
    // Create new path entity with deterministic UID
    // Use a deterministic UID based on owner and path to prevent duplicates
    const pathId = `path_${username}_${fullPath}`.replace(/[^a-zA-Z0-9]/g, '_');
    const pathEntity = {
      uid: `_:${pathId}`,
      'dgraph.type': 'Path',
      fullPath,
      pathName: fullPath === '/' ? 'Root' : fullPath.split('/').filter(p => p).pop(),
      pathType: 'directory', // Always directory - files are not paths
      owner: { uid: accountUid },
      itemCount: 0,
      children: [],
      files: [] // Array to hold file references
    };
    
    // Debug logging
    logger.debug(`Creating new path ${fullPath} for ${username} with owner UID: ${accountUid}`);
    
    // Find parent path
    if (fullPath !== '/') {
      const parentPath = fullPath.substring(0, fullPath.lastIndexOf('/')) || '/';
      const parent = await this.getOrCreatePath(username, parentPath, 'directory', mutations);
      pathEntity.parent = { uid: parent.uid };
      
      // Add to parent's children
      if (!parent.children) parent.children = [];
      parent.children.push({ uid: pathEntity.uid });
    }
    
    userPathMap.set(fullPath, pathEntity);
    if (!mutations.paths) {
      mutations.paths = new Map();
    }
    mutations.paths.set(`${username}:${fullPath}`, pathEntity);
    
    // Register path in accumulator for cross-batch tracking
    if (pathAccumulator.batchMode) {
      pathAccumulator.registerPath(username, fullPath, pathEntity.uid);
    }
    
    return pathEntity;
  }

  // DEPRECATED - Files are now added directly to directory paths
  async updatePathWithFile(username, filePath, file, contract, mutations) {
    // This function is no longer used
    logger.warn('updatePathWithFile called but is deprecated');
  }

  // Calculate item counts for all paths
  calculatePathCounts(mutations) {
    // Build a map of uid to path for easier lookup
    const uidToPath = new Map();
    for (const [key, path] of mutations.paths.entries()) {
      uidToPath.set(path.uid, path);
    }
    
    // Sort paths by depth (deepest first) to calculate counts bottom-up
    const sortedPaths = Array.from(mutations.paths.values())
      .sort((a, b) => b.fullPath.split('/').length - a.fullPath.split('/').length);
    
    // Calculate counts for each directory
    for (const path of sortedPaths) {
      if (path.pathType === 'directory') {
        let fileCount = 0;
        let directoryCount = 0;
        
        // Count files in this directory
        if (path.files && path.files.length > 0) {
          // Count visible files (excluding those with bitflag 2)
          fileCount = path.files.length;
          logger.debug('Counting files in path', {
            fullPath: path.fullPath,
            totalFiles: path.files.length,
            fileCount
          });
        }
        
        // Count subdirectories
        if (path.children && path.children.length > 0) {
          for (const childRef of path.children) {
            const childPath = uidToPath.get(childRef.uid);
            if (childPath && childPath.pathType === 'directory') {
              directoryCount++;
            }
          }
        }
        
        // Item count is the total of files and subdirectories
        path.itemCount = fileCount + directoryCount;
      }
    }
  }
  
  // Parse extension string into structured data (e.g., "disregardfiat:498:97072588-97938326")
  parseExtensions(extensionString, contractId, mutations) {
    if (!extensionString) return [];
    
    const extensions = [];
    const parts = extensionString.split(',');
    
    for (const part of parts) {
      // Format: "paidBy:amount:blockRange"
      const [paidBy, amount, blockRange] = part.split(':');
      if (paidBy && amount && blockRange) {
        const [startBlock, endBlock] = blockRange.split('-');
        const extensionId = `${contractId}_${paidBy}_${startBlock}`.replace(/[:/\-]/g, '_');
        const extension = {
          uid: `_:extension_${extensionId}`,
          'dgraph.type': 'ContractExtension',
          contract: { id: contractId },
          paidBy: { username: paidBy },
          paidAmount: parseInt(amount) || 0,
          blocksPaid: blockRange,
          startBlock: parseInt(startBlock) || 0,
          endBlock: parseInt(endBlock) || 0
        };
        extensions.push(extension);
      }
    }
    
    return extensions;
  }
  
  // Helper methods
  getContractStatus(contract) {
    const currentBlock = Date.now(); // Should use actual block number
    if (contract.e && contract.e < currentBlock) {
      return 'EXPIRED';
    }
    return 'ACTIVE';
  }

  // Note: extractOperation removed as feed parser handles operation type extraction

  // Query builders for complex lookups
  async getUserFiles(username, includeShared = false) {
    const query = `
      query getUserFiles($username: string) {
        user(func: eq(username, $username)) {
          username
          files {
            cid
            name
            size
            path
            uploadedAt
            contract {
              id
              expiresBlock
            }
          }
          contracts {
            id
            dataFiles
            status
          }
        }
      }
    `;
    
    const vars = { $username: username };
    const result = await this.dgraph.client.newTxn().queryWithVars(query, vars);
    return result.getJson();
  }

  async getFileSystemView(username, path = '/') {
    const query = `
      query getFS($username: string, $path: string) {
        entries(func: eq(owner.username, $username)) @filter(eq(path, $path)) {
          path
          name
          type
          cid
          children {
            path
            name
            type
          }
        }
      }
    `;
    
    const vars = { $username: username, $path: path };
    const result = await this.dgraph.client.newTxn().queryWithVars(query, vars);
    return result.getJson();
  }
}

// Factory function
export function createDataTransformer(dgraphClient, networkManager = null) {
  return new DataTransformer(dgraphClient, networkManager);
}