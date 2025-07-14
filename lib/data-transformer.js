import { createLogger } from './logger.js';
import { feedParser } from './feed-parser.js';

const logger = createLogger('data-transformer');

export class DataTransformer {
  constructor(dgraphClient, networkManager = null) {
    this.dgraph = dgraphClient;
    this.networkManager = networkManager;
  }

  // Transform a batch of operations into Dgraph mutations
  async transformOperations(operations, blockInfo) {
    const mutations = {
      accounts: new Map(),
      contracts: new Map(),
      files: new Map(),
      transactions: [],
      orders: new Map(),
      dexMarkets: new Map(),
      ohlc: [],
      other: []
    };

    for (const op of operations) {
      try {
        await this.transformOperationInternal(op, blockInfo, mutations);
      } catch (error) {
        logger.error('Failed to transform operation', { 
          error: error.message, 
          op 
        });
      }
    }

    return this.buildMutations(mutations, blockInfo);
  }

  // Transform a single operation from honeycomb (standalone method)
  async transformOperation(op) {
    const mutations = {
      accounts: new Map(),
      contracts: new Map(),
      files: new Map(),
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
        this.transformAuthority(path[1], data, mutations);
        break;
        
      case 'balances':
        this.transformBalance(path[1], data, 'larynxBalance', mutations);
        break;
        
      case 'bpow':
        this.transformBalance(path[1], data, 'brocaPower', mutations);
        break;
        
      case 'broca':
        this.transformBroca(path[1], data, mutations);
        break;
        
      case 'cbalances':
        this.transformBalance(path[1], data, 'claimableLarynx', mutations);
        break;
        
      case 'cbroca':
        this.transformBalance(path[1], data, 'claimableBroca', mutations);
        break;
        
      case 'contract':
        this.transformContract(path, data, mutations);
        break;
        
      case 'contracts':
        this.transformDexContracts(path[1], data, mutations);
        break;
        
      case 'cspk':
        this.transformBalance(path[1], data, 'claimableSpk', mutations);
        break;
        
      case 'feed':
        this.transformFeedEntry(path[1], data, blockInfo, mutations);
        break;
        
      case 'granted':
        this.transformGranted(path, data, mutations);
        break;
        
      case 'granting':
        this.transformGranting(path, data, mutations);
        break;
        
      case 'lbroca':
        this.transformBalance(path[1], data, 'liquidBroca', mutations);
        break;
        
      case 'market':
        if (path[1] === 'node') {
          this.transformNodeMarket(path[2], data, mutations);
        }
        break;
        
      case 'nomention':
        this.transformBalance(path[1], data, 'noMention', mutations);
        break;
        
      case 'pow':
        this.transformBalance(path[1], data, 'power', mutations);
        break;
        
      case 'proffer':
        this.transformProffer(path, data, mutations);
        break;
        
      case 'sbroca':
        this.transformBalance(path[1], data, 'storageBroca', mutations);
        break;
        
      case 'vbroca':
        this.transformBalance(path[1], data, 'validatorBroca', mutations);
        break;
        
      case 'service':
        // service[type][account] - ignore, not needed
        break;
        
      case 'services':
        this.transformServiceObject(path, data, mutations);
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
          this.transformBalance(path[1], data, 'spkBalance', mutations);
        }
        break;
        
      case 'spkVote':
        this.transformSpkVote(path[1], data, mutations);
        break;
        
      case 'spkb':
        this.transformBalance(path[1], data, 'spkBlock', mutations);
        break;
        
      case 'spkp':
        this.transformBalance(path[1], data, 'spkPower', mutations);
        break;
        
      case 'val':
        this.transformValidator(path[1], data, mutations);
        break;
        
      case 'dex':
      case 'dexb':
      case 'dexs':
        this.transformDexMarket(path, data, mutations);
        break;
        
      case 'delegations':
        this.transformDelegation(path, data, mutations);
        break;
        
      default:
        // Store other data as-is
        mutations.other.push({
          path: path.join('.'),
          value: typeof data === 'object' ? JSON.stringify(data) : data
        });
    }
  }

  // Transform balance update
  transformBalance(account, balance, field, mutations) {
    if (!mutations.accounts.has(account)) {
      mutations.accounts.set(account, {
        username: account,
        'dgraph.type': 'Account'
      });
    }
    mutations.accounts.get(account)[field] = balance;
  }

  // Transform BROCA balance (includes block number)
  transformBroca(account, brocaString, mutations) {
    if (!mutations.accounts.has(account)) {
      mutations.accounts.set(account, {
        username: account,
        'dgraph.type': 'Account'
      });
    }
    
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
  transformAuthority(account, publicKey, mutations) {
    if (!mutations.accounts.has(account)) {
      mutations.accounts.set(account, {
        username: account,
        'dgraph.type': 'Account'
      });
    }
    mutations.accounts.get(account).publicKey = publicKey;
  }
  
  // Transform granted power (granted[grantee][grantor] or granted[grantee]['t'])
  transformGranted(path, amount, mutations) {
    const [_, grantee, grantor] = path;
    
    if (!mutations.accounts.has(grantee)) {
      mutations.accounts.set(grantee, {
        username: grantee,
        'dgraph.type': 'Account'
      });
    }
    
    if (grantor === 't') {
      // Total granted to this account
      mutations.accounts.get(grantee).powerGranted = amount;
    } else {
      // Specific grant relationship
      const grantId = `${grantor}:${grantee}`;
      const grant = {
        uid: `_:grant_${grantId.replace(/:/g, '_')}`,
        'dgraph.type': 'PowerGrant',
        id: grantId,
        grantor: { username: grantor },
        grantee: { username: grantee },
        amount: amount,
        createdBlock: 0, // Would need block info
        lastUpdate: Date.now()
      };
      mutations.other.push(grant);
    }
  }
  
  // Transform granting power (granting[grantor][grantee] or granting[grantor]['t'])
  transformGranting(path, amount, mutations) {
    const [_, grantor, grantee] = path;
    
    if (!mutations.accounts.has(grantor)) {
      mutations.accounts.set(grantor, {
        username: grantor,
        'dgraph.type': 'Account'
      });
    }
    
    if (grantee === 't') {
      // Total granting from this account
      mutations.accounts.get(grantor).powerGranting = amount;
    } else {
      // Specific grant relationship (already handled in transformGranted)
      // Skip to avoid duplicates
    }
  }
  
  // Transform DEX contracts (contracts[account])
  transformDexContracts(account, contractList, mutations) {
    if (!mutations.accounts.has(account)) {
      mutations.accounts.set(account, {
        username: account,
        'dgraph.type': 'Account'
      });
    }
    
    // contractList is an array of open DEX orders
    if (Array.isArray(contractList)) {
      contractList.forEach((contractId, index) => {
        const dexContractId = `${account}:${contractId}`;
        const dexContract = {
          uid: `_:dexcontract_${dexContractId.replace(/[:/\-]/g, '_')}`,
          'dgraph.type': 'DexContract',
          id: dexContractId,
          owner: { username: account },
          contractId: contractId,
          createdBlock: 0,
          lastActivity: Date.now()
        };
        mutations.other.push(dexContract);
      });
    }
  }
  
  // Transform proffer (proffer[to][from][type])
  transformProffer(path, contractData, mutations) {
    const [_, to, from, profferType] = path;
    
    const profferId = `${to}:${from}:${profferType || '0'}`;
    const proffer = {
      uid: `_:proffer_${profferId.replace(/[:/\-]/g, '_')}`,
      'dgraph.type': 'Proffer',
      id: profferId,
      from: { username: from },
      to: { username: to },
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
  transformServiceObject(path, serviceData, mutations) {
    const [_, account, serviceType, serviceId] = path;
    
    if (!mutations.accounts.has(account)) {
      mutations.accounts.set(account, {
        username: account,
        'dgraph.type': 'Account'
      });
    }
    
    const fullServiceId = `${account}:${serviceType}:${serviceId}`;
    const service = {
      uid: `_:service_${fullServiceId.replace(/[:/\-]/g, '_')}`,
      'dgraph.type': 'Service',
      id: fullServiceId,
      provider: { username: account },
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
  transformSpkVote(account, voteString, mutations) {
    if (!mutations.accounts.has(account)) {
      mutations.accounts.set(account, {
        username: account,
        'dgraph.type': 'Account'
      });
    }
    
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
  }
  
  // Get validator name from code using validator map
  getValidatorName(valCode, mutations) {
    if (mutations.validatorMap && mutations.validatorMap.has(valCode)) {
      return mutations.validatorMap.get(valCode);
    }
    return valCode; // Return code if name not found
  }
  
  // Transform validator (val[val_code])
  transformValidator(valCode, votingData, mutations) {
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
  transformContract(path, contract, mutations) {
    // Path format: ['contract', 'purchaser:type:block-txid']
    const contractId = path[1];
    
    // Parse contract ID: purchaser:type:block-txid
    const idParts = contractId.split(':');
    const purchaser = idParts[0];
    const contractType = parseInt(idParts[1]) || 0;
    const blockAndTxid = idParts[2] || '';
    const [blockNumber, txid] = blockAndTxid.split('-');
    
    const dgraphContract = {
      uid: `_:contract_${contractId.replace(/[:/\-]/g, '_')}`,
      'dgraph.type': 'StorageContract',
      id: contractId,
      
      // Contract identification
      purchaser: { username: contract.f || purchaser },
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

    // Parse expiration field (e.g., "97938326:QmenexSVsQsaKqoDZdeTY8Us2bVyPaNyha1wc2MCRVQvRm")
    if (contract.e) {
      const [expiresBlock, chronId] = contract.e.split(':');
      dgraphContract.expiresBlock = parseInt(expiresBlock) || 0;
      dgraphContract.expiresChronId = chronId || '';
    }
    
    // Parse metadata field (e.g., "1|NFTs,bz,nft,,0--")
    if (contract.m) {
      dgraphContract.metadata = this.parseMetadata(contract.m, contractId);
    }
    
    // Calculate if understored
    dgraphContract.isUnderstored = dgraphContract.nodeTotal < dgraphContract.power;

    // Process files and calculate totals
    if (contract.df) {
      let fileCount = 0;
      const fileNames = Object.keys(contract.df);
      const folderStructure = dgraphContract.metadata?.folderStructure 
        ? JSON.parse(dgraphContract.metadata.folderStructure)
        : { '1': '/' };
      
      // Parse the full metadata for file details
      const metadataSlots = this.parseFileMetadata(contract.m);
      
      fileNames.forEach((cid, index) => {
        const size = contract.df[cid];
        fileCount++;
        
        // Extract file metadata from slots
        let fileName = cid; // Default to CID
        let fileType = '';
        let filePath = '/';
        
        if (metadataSlots && metadataSlots.length > index * 4) {
          // Each file has 4 slots in metadata
          const nameSlot = metadataSlots[index * 4] || '';
          const typeIndexSlot = metadataSlots[index * 4 + 2] || '';
          
          if (nameSlot) fileName = nameSlot;
          
          // Parse type and folder index
          const [type, folderIndex] = typeIndexSlot.split('.');
          fileType = type || '';
          filePath = folderIndex ? (folderStructure[folderIndex] || '/') : '/';
        }
        
        // Create expanded file entity
        const fileId = `${contractId}:${cid}`;
        if (!mutations.files.has(fileId)) {
          mutations.files.set(fileId, {
            uid: `_:file_${fileId.replace(/[:/\-]/g, '_')}`,
            'dgraph.type': 'ContractFile',
            id: fileId,
            contract: { id: contractId },
            cid,
            size,
            name: fileName,
            mimeType: this.getMimeType(fileType),
            path: filePath,
            uploadedAt: new Date().toISOString()
          });
        }
      });
      
      dgraphContract.fileCount = fileCount;
      // Note: dataSize is tracked as 'utilized' in the contract
    }
    
    // Process extensions if present
    if (contract.ex) {
      dgraphContract.extensions = this.parseExtensions(contract.ex, contractId, mutations);
    }
    
    // Process storage nodes with expanded data
    if (contract.n) {
      dgraphContract.storageNodes = [];
      for (const [nodeNumber, nodeAccount] of Object.entries(contract.n)) {
        const storageNodeId = `${contractId}:${nodeNumber}`;
        
        // Create storage node assignment
        const storageNode = {
          uid: `_:storage_node_${storageNodeId.replace(/[:/\-]/g, '_')}`,
          'dgraph.type': 'StorageNodeAssignment',
          id: storageNodeId,
          contract: { id: contractId },
          storageAccount: { username: nodeAccount },
          nodeNumber,
          assignedBlock: dgraphContract.blockNumber || 0,
          isActive: true
        };
        
        dgraphContract.storageNodes.push(storageNode);
        
        // Also ensure the account exists
        if (!mutations.accounts.has(nodeAccount)) {
          mutations.accounts.set(nodeAccount, {
            username: nodeAccount,
            'dgraph.type': 'Account'
          });
        }
      }
    }
    
    mutations.contracts.set(contractId, dgraphContract);
  }


  // Transform file
  transformFile(cid, fileData, mutations) {
    if (!mutations.files.has(cid)) {
      mutations.files.set(cid, {
        uid: `_:file_${cid}`,
        'dgraph.type': 'File',
        cid,
        owner: { username: fileData.owner },
        size: fileData.size || 0,
        uploadedAt: new Date().toISOString()
      });
    }
    
    if (fileData.contract) {
      mutations.files.get(cid).contract = {
        id: fileData.contract
      };
    }
  }

  // Transform node market data
  transformNodeMarket(account, nodeData, mutations) {
    if (!mutations.accounts.has(account)) {
      mutations.accounts.set(account, {
        username: account,
        'dgraph.type': 'Account'
      });
    }

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
    
    mutations.accounts.get(account).nodeMarketBid = nodeBid;
    
    // Also store validator if it has a val_code
    if (nodeData.val_code) {
      this.transformValidator(nodeData.val_code, nodeData.votes || 0, mutations);
      
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
    
    // Track other deletions for later processing
    mutations.other.push({
      type: 'delete',
      path: path.join('.'),
      blockNum: blockInfo.blockNum
    });
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

  // Build final Dgraph mutations
  buildMutations(mutations, blockInfo) {
    const dgraphMutations = [];
    
    // Add accounts
    for (const account of mutations.accounts.values()) {
      dgraphMutations.push(account);
    }
    
    // Add contracts
    for (const contract of mutations.contracts.values()) {
      dgraphMutations.push(contract);
    }
    
    // Add files
    for (const file of mutations.files.values()) {
      dgraphMutations.push(file);
    }
    
    // Add transactions
    dgraphMutations.push(...mutations.transactions);
    
    // Add DEX markets
    if (mutations.dexMarkets) {
      for (const market of mutations.dexMarkets.values()) {
        dgraphMutations.push(market);
      }
    }
    
    // Add orders
    if (mutations.orders) {
      for (const order of mutations.orders.values()) {
        dgraphMutations.push(order);
      }
    }
    
    // Add OHLC data
    if (mutations.ohlc) {
      dgraphMutations.push(...mutations.ohlc);
    }
    
    // Add other mutations
    dgraphMutations.push(...mutations.other);
    
    return dgraphMutations;
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
    
    // Skip chain operations (internal blockchain state)
    if (path[0] === 'chain') {
      return true;
    }
    
    // Skip other internal consensus paths
    const internalPaths = [
      'chrono',      // Scheduled operations (internal)
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
    if (!folderListStr) return { '1': '/' };
    
    const indexToPath = { '1': '/' };
    const folders = folderListStr.split('|');
    
    folders.forEach((folder, index) => {
      if (folder) {
        const folderIndex = (index + 2).toString();
        indexToPath[folderIndex] = folder;
      }
    });
    
    return indexToPath;
  }
  
  // Convert base64 character to number
  base64ToNumber(char) {
    const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    return base64Chars.indexOf(char);
  }
  
  // Parse file metadata slots from the metadata string
  parseFileMetadata(metadataString) {
    if (!metadataString) return [];
    
    // Remove the contract data part (before first comma)
    const parts = metadataString.split(',');
    if (parts.length < 2) return [];
    
    // Get the file slots part (after first comma)
    const fileData = parts.slice(1).join(',');
    
    // Split into individual slots
    return fileData.split(',').filter(slot => slot !== undefined);
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
    
    // Format: "flags#user1:key1#user2:key2..."
    const parts = encData.split('#').slice(1); // Skip the flags part
    
    parts.forEach((part, index) => {
      if (part.includes(':')) {
        const [username, encryptedKey] = part.split(':');
        if (username && encryptedKey) {
          keys.push({
            uid: `_:enckey_${contractId}_${username}`.replace(/[:/\-]/g, '_'),
            'dgraph.type': 'EncryptionKey',
            sharedWith: { username },
            encryptedKey,
            keyType: 'AES-256', // Default, could be parsed from metadata
            sharedBlock: 0 // Would need to track when shared
          });
        }
      }
    });
    
    return keys;
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
        const extension = {
          uid: `_:extension_${contractId}_${paidBy}_${startBlock}`.replace(/[:/\-]/g, '_'),
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