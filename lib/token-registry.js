/**
 * Token Registry for Honeygraph
 * Manages token configurations and metadata
 */

const fs = require('fs').promises;
const path = require('path');

class TokenRegistry {
  constructor(registryPath = '/data/honeygraph/registry') {
    this.registryPath = registryPath;
    this.tokensFile = path.join(registryPath, 'tokens.json');
    this.schemasDir = path.join(registryPath, 'schemas');
    this.apisDir = path.join(registryPath, 'apis');
    this.tokens = new Map();
  }

  async initialize() {
    // Create registry directories
    await fs.mkdir(this.registryPath, { recursive: true });
    await fs.mkdir(this.schemasDir, { recursive: true });
    await fs.mkdir(this.apisDir, { recursive: true });

    // Load existing tokens
    await this.loadTokens();
  }

  async loadTokens() {
    try {
      const data = await fs.readFile(this.tokensFile, 'utf8');
      const tokens = JSON.parse(data);
      
      for (const [symbol, config] of Object.entries(tokens)) {
        this.tokens.set(symbol, config);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('Error loading token registry:', err);
      }
    }
  }

  async saveTokens() {
    const tokens = {};
    for (const [symbol, config] of this.tokens) {
      tokens[symbol] = config;
    }
    
    await fs.writeFile(this.tokensFile, JSON.stringify(tokens, null, 2));
  }

  async registerToken(symbol, config) {
    // Validate token config
    this.validateConfig(symbol, config);

    // Add default values
    const fullConfig = {
      symbol,
      decimals: 3,
      createdAt: new Date().toISOString(),
      ...config,
      // Paths
      schemaFile: `${symbol.toLowerCase()}.graphql`,
      apiFile: `${symbol.toLowerCase()}.js`,
      // Features
      features: {
        transfers: true,
        balances: true,
        richlist: true,
        history: true,
        ...config.features
      },
      // Indexing
      indexing: {
        startBlock: 0,
        batchSize: 1000,
        ...config.indexing
      }
    };

    // Save token config
    this.tokens.set(symbol, fullConfig);
    await this.saveTokens();

    // Save schema if provided
    if (config.schema) {
      await this.saveSchema(symbol, config.schema);
    }

    // Save API if provided
    if (config.api) {
      await this.saveAPI(symbol, config.api);
    }

    return fullConfig;
  }

  validateConfig(symbol, config) {
    // Symbol validation
    if (!/^[A-Z0-9]{3,10}$/.test(symbol)) {
      throw new Error('Token symbol must be 3-10 uppercase alphanumeric characters');
    }

    // Required fields
    const required = ['name', 'description', 'contractAddress'];
    for (const field of required) {
      if (!config[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Contract address validation
    if (!/^@[a-z0-9.-]{3,16}$/.test(config.contractAddress)) {
      throw new Error('Invalid contract address format');
    }

    // Decimals validation
    if (config.decimals !== undefined) {
      if (!Number.isInteger(config.decimals) || config.decimals < 0 || config.decimals > 8) {
        throw new Error('Decimals must be an integer between 0 and 8');
      }
    }
  }

  async unregisterToken(symbol) {
    if (!this.tokens.has(symbol)) {
      throw new Error(`Token ${symbol} not found`);
    }

    // Remove token
    this.tokens.delete(symbol);
    await this.saveTokens();

    // Note: We keep schema and API files for potential re-registration
    return true;
  }

  async saveSchema(symbol, schema) {
    const schemaPath = path.join(this.schemasDir, `${symbol.toLowerCase()}.graphql`);
    await fs.writeFile(schemaPath, schema);
  }

  async loadSchema(symbol) {
    const schemaPath = path.join(this.schemasDir, `${symbol.toLowerCase()}.graphql`);
    try {
      return await fs.readFile(schemaPath, 'utf8');
    } catch (err) {
      return null;
    }
  }

  async saveAPI(symbol, api) {
    const apiPath = path.join(this.apisDir, `${symbol.toLowerCase()}.js`);
    await fs.writeFile(apiPath, api);
  }

  async loadAPI(symbol) {
    const apiPath = path.join(this.apisDir, `${symbol.toLowerCase()}.js`);
    try {
      return await fs.readFile(apiPath, 'utf8');
    } catch (err) {
      return null;
    }
  }

  getToken(symbol) {
    return this.tokens.get(symbol);
  }

  getAllTokens() {
    return Array.from(this.tokens.entries()).map(([symbol, config]) => ({
      symbol,
      ...config
    }));
  }

  getActiveTokens() {
    return this.getAllTokens().filter(token => token.active !== false);
  }

  async updateTokenConfig(symbol, updates) {
    const token = this.tokens.get(symbol);
    if (!token) {
      throw new Error(`Token ${symbol} not found`);
    }

    // Merge updates
    const updatedConfig = {
      ...token,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    // Validate updated config
    this.validateConfig(symbol, updatedConfig);

    // Save updates
    this.tokens.set(symbol, updatedConfig);
    await this.saveTokens();

    return updatedConfig;
  }

  // Generate default configurations for common tokens
  static getDefaultConfigs() {
    return {
      SPK: {
        name: 'SPK Network',
        description: 'Decentralized Web3 Video Network',
        contractAddress: '@spknetwork',
        decimals: 3,
        features: {
          transfers: true,
          balances: true,
          richlist: true,
          history: true,
          staking: true,
          rewards: true
        }
      },
      DLUX: {
        name: 'DLUX',
        description: 'Decentralized Limitless User eXperience',
        contractAddress: '@dlux-io',
        decimals: 3,
        features: {
          transfers: true,
          balances: true,
          richlist: true,
          history: true,
          dex: true,
          nft: true
        }
      },
      LARYNX: {
        name: 'Larynx',
        description: 'SPK Network Mining Token',
        contractAddress: '@spknetwork',
        decimals: 3,
        features: {
          transfers: true,
          balances: true,
          richlist: true,
          history: true,
          mining: true,
          lockup: true
        }
      },
      BROCA: {
        name: 'Broca',
        description: 'SPK Network Resource Credits',
        contractAddress: '@spknetwork',
        decimals: 3,
        features: {
          transfers: false, // Non-transferable
          balances: true,
          regeneration: true,
          consumption: true
        }
      }
    };
  }
}

module.exports = TokenRegistry;