/**
 * Multi-Token Manager for Honeygraph
 * Manages multiple token ecosystems with isolated namespaces
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const EventEmitter = require('events');

class MultiTokenManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.tokens = new Map();
    this.config = {
      baseDataPath: config.baseDataPath || '/data/honeygraph',
      zfsPoolPrefix: config.zfsPoolPrefix || 'honeygraph',
      schemaPath: config.schemaPath || './schemas',
      apiPath: config.apiPath || './apis',
      ...config
    };
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    // Create base directories
    await this.ensureDirectories();
    
    // Load existing tokens from registry
    await this.loadTokenRegistry();
    
    this.initialized = true;
    this.emit('initialized');
  }

  async ensureDirectories() {
    const dirs = [
      this.config.baseDataPath,
      this.config.schemaPath,
      this.config.apiPath,
      path.join(this.config.baseDataPath, 'tokens')
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  async loadTokenRegistry() {
    const registryPath = path.join(this.config.baseDataPath, 'token-registry.json');
    try {
      const data = await fs.readFile(registryPath, 'utf8');
      const registry = JSON.parse(data);
      
      for (const [tokenSymbol, tokenConfig] of Object.entries(registry)) {
        await this.registerToken(tokenSymbol, tokenConfig, false);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('Error loading token registry:', err);
      }
    }
  }

  async saveTokenRegistry() {
    const registryPath = path.join(this.config.baseDataPath, 'token-registry.json');
    const registry = {};
    
    for (const [symbol, token] of this.tokens) {
      registry[symbol] = token.getConfig();
    }
    
    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));
  }

  async registerToken(symbol, config, save = true) {
    if (this.tokens.has(symbol)) {
      throw new Error(`Token ${symbol} already registered`);
    }

    // Validate config
    this.validateTokenConfig(symbol, config);

    // Create token instance
    const token = new TokenNamespace(symbol, {
      ...config,
      baseDataPath: this.config.baseDataPath,
      zfsPoolPrefix: this.config.zfsPoolPrefix,
      schemaPath: this.config.schemaPath,
      apiPath: this.config.apiPath
    });

    // Initialize token namespace
    await token.initialize();

    // Register token
    this.tokens.set(symbol, token);

    // Save registry
    if (save) {
      await this.saveTokenRegistry();
    }

    this.emit('token:registered', { symbol, config });
    return token;
  }

  validateTokenConfig(symbol, config) {
    const required = ['name', 'description', 'contractAddress'];
    for (const field of required) {
      if (!config[field]) {
        throw new Error(`Missing required field: ${field} for token ${symbol}`);
      }
    }

    // Validate symbol format
    if (!/^[A-Z0-9]{3,10}$/.test(symbol)) {
      throw new Error('Token symbol must be 3-10 uppercase alphanumeric characters');
    }
  }

  async unregisterToken(symbol) {
    const token = this.tokens.get(symbol);
    if (!token) {
      throw new Error(`Token ${symbol} not found`);
    }

    // Cleanup token resources
    await token.cleanup();

    // Remove from registry
    this.tokens.delete(symbol);
    await this.saveTokenRegistry();

    this.emit('token:unregistered', { symbol });
  }

  getToken(symbol) {
    return this.tokens.get(symbol);
  }

  getAllTokens() {
    return Array.from(this.tokens.values());
  }

  getTokenSymbols() {
    return Array.from(this.tokens.keys());
  }

  // Get pathwise namespace for a token
  getPathwiseNamespace(symbol) {
    const token = this.tokens.get(symbol);
    if (!token) {
      throw new Error(`Token ${symbol} not found`);
    }
    return token.getPathwiseNamespace();
  }

  // Get GraphQL schema for a token
  async getGraphQLSchema(symbol) {
    const token = this.tokens.get(symbol);
    if (!token) {
      throw new Error(`Token ${symbol} not found`);
    }
    return token.getGraphQLSchema();
  }

  // Get API routes for a token
  async getAPIRoutes(symbol) {
    const token = this.tokens.get(symbol);
    if (!token) {
      throw new Error(`Token ${symbol} not found`);
    }
    return token.getAPIRoutes();
  }
}

class TokenNamespace {
  constructor(symbol, config) {
    this.symbol = symbol;
    this.config = config;
    this.zfsDataset = `${config.zfsPoolPrefix}/${symbol.toLowerCase()}`;
    this.dataPath = path.join(config.baseDataPath, 'tokens', symbol.toLowerCase());
    this.schemaPath = path.join(config.schemaPath, `${symbol.toLowerCase()}.graphql`);
    this.apiPath = path.join(config.apiPath, `${symbol.toLowerCase()}.js`);
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    // Create ZFS dataset
    await this.createZFSDataset();

    // Create token data directory
    await fs.mkdir(this.dataPath, { recursive: true });

    // Initialize default schema if not exists
    if (!await this.fileExists(this.schemaPath)) {
      await this.createDefaultSchema();
    }

    // Initialize default API if not exists
    if (!await this.fileExists(this.apiPath)) {
      await this.createDefaultAPI();
    }

    this.initialized = true;
  }

  async createZFSDataset() {
    try {
      // Check if dataset exists
      execSync(`zfs list ${this.zfsDataset}`, { stdio: 'ignore' });
    } catch (err) {
      // Dataset doesn't exist, create it
      try {
        execSync(`zfs create -o mountpoint=${this.dataPath} ${this.zfsDataset}`);
        console.log(`Created ZFS dataset: ${this.zfsDataset}`);
        
        // Set properties for better performance
        execSync(`zfs set compression=lz4 ${this.zfsDataset}`);
        execSync(`zfs set atime=off ${this.zfsDataset}`);
        execSync(`zfs set recordsize=128K ${this.zfsDataset}`);
      } catch (createErr) {
        console.warn(`Could not create ZFS dataset ${this.zfsDataset}:`, createErr.message);
        // Continue without ZFS - use regular filesystem
      }
    }
  }

  async createDefaultSchema() {
    const defaultSchema = `
# ${this.symbol} Token GraphQL Schema

type ${this.symbol}State {
  supply: String!
  transfers: Int!
  holders: Int!
  lastBlock: Int!
}

type ${this.symbol}Balance {
  account: String!
  balance: String!
  updatedAt: String!
}

type ${this.symbol}Transfer {
  from: String!
  to: String!
  amount: String!
  memo: String
  blockNum: Int!
  timestamp: String!
  txId: String!
}

type Query {
  ${this.symbol.toLowerCase()}State: ${this.symbol}State
  ${this.symbol.toLowerCase()}Balance(account: String!): ${this.symbol}Balance
  ${this.symbol.toLowerCase()}Balances(limit: Int = 100, offset: Int = 0): [${this.symbol}Balance!]!
  ${this.symbol.toLowerCase()}Transfers(
    account: String
    limit: Int = 100
    offset: Int = 0
  ): [${this.symbol}Transfer!]!
}
`;

    await fs.writeFile(this.schemaPath, defaultSchema.trim());
  }

  async createDefaultAPI() {
    const defaultAPI = `
/**
 * ${this.symbol} Token API Routes
 */

module.exports = function(router, tokenManager) {
  const token = tokenManager.getToken('${this.symbol}');
  const namespace = token.getPathwiseNamespace();

  // Token state endpoint
  router.get('/${this.symbol.toLowerCase()}/state', async (req, res) => {
    try {
      const state = await namespace.getState();
      res.json(state);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Balance endpoint
  router.get('/${this.symbol.toLowerCase()}/balance/:account', async (req, res) => {
    try {
      const balance = await namespace.getBalance(req.params.account);
      res.json(balance);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Transfers endpoint
  router.get('/${this.symbol.toLowerCase()}/transfers', async (req, res) => {
    try {
      const { account, limit = 100, offset = 0 } = req.query;
      const transfers = await namespace.getTransfers({ account, limit, offset });
      res.json(transfers);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Rich list endpoint
  router.get('/${this.symbol.toLowerCase()}/richlist', async (req, res) => {
    try {
      const { limit = 100 } = req.query;
      const richlist = await namespace.getRichList(limit);
      res.json(richlist);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
`;

    await fs.writeFile(this.apiPath, defaultAPI.trim());
  }

  async fileExists(filepath) {
    try {
      await fs.access(filepath);
      return true;
    } catch {
      return false;
    }
  }

  async cleanup() {
    // Note: We don't destroy ZFS datasets automatically for safety
    // Admin must manually destroy with: zfs destroy <dataset>
    console.log(`Token ${this.symbol} unregistered. ZFS dataset ${this.zfsDataset} preserved.`);
  }

  getConfig() {
    return {
      name: this.config.name,
      description: this.config.description,
      contractAddress: this.config.contractAddress,
      decimals: this.config.decimals || 3,
      ...this.config
    };
  }

  getPathwiseNamespace() {
    return {
      symbol: this.symbol,
      dataPath: this.dataPath,
      zfsDataset: this.zfsDataset,
      prefix: `${this.symbol.toLowerCase()}:`
    };
  }

  async getGraphQLSchema() {
    try {
      return await fs.readFile(this.schemaPath, 'utf8');
    } catch (err) {
      throw new Error(`Schema not found for token ${this.symbol}`);
    }
  }

  async getAPIRoutes() {
    try {
      delete require.cache[require.resolve(this.apiPath)];
      return require(this.apiPath);
    } catch (err) {
      throw new Error(`API routes not found for token ${this.symbol}`);
    }
  }
}

module.exports = { MultiTokenManager, TokenNamespace };