/**
 * Network Manager for Honeygraph
 * Manages multiple tokens under a single network/contract prefix
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { DgraphClient } from './dgraph-client.js';
import { createLogger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Factory function for convenience
export function createNetworkManager(options = {}) {
  return new NetworkManager(options);
}

export class NetworkManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.networks = new Map();
    this.logger = createLogger('network-manager');
    this.config = {
      baseDataPath: config.baseDataPath || '/data/honeygraph',
      dgraphUrl: config.dgraphUrl || process.env.DGRAPH_URL || 'http://localhost:9080',
      zfsPoolPrefix: config.zfsPoolPrefix || 'honeygraph',
      schemaPath: config.schemaPath || path.join(__dirname, '../schema'),
      ...config
    };
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    // Create base directories
    await this.ensureDirectories();
    
    // Load existing networks from registry
    await this.loadNetworkRegistry();
    
    this.initialized = true;
    this.emit('initialized');
  }

  async ensureDirectories() {
    const dirs = [
      this.config.baseDataPath,
      path.join(this.config.baseDataPath, 'networks'),
      path.join(this.config.baseDataPath, 'checkpoints')
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  async loadNetworkRegistry() {
    const registryPath = path.join(this.config.baseDataPath, 'network-registry.json');
    try {
      const data = await fs.readFile(registryPath, 'utf8');
      const registry = JSON.parse(data);
      
      for (const [prefix, networkConfig] of Object.entries(registry)) {
        await this.registerNetwork(prefix, networkConfig, false);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.logger.error('Error loading network registry:', err);
      }
    }
  }

  async saveNetworkRegistry() {
    const registryPath = path.join(this.config.baseDataPath, 'network-registry.json');
    const registry = {};
    
    for (const [prefix, network] of this.networks) {
      registry[prefix] = network.getConfig();
    }
    
    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));
  }

  async registerNetwork(prefix, config, save = true) {
    if (this.networks.has(prefix)) {
      throw new Error(`Network ${prefix} already registered`);
    }

    // Validate config
    this.validateNetworkConfig(prefix, config);

    // Create network instance
    const network = new NetworkNamespace(prefix, {
      ...config,
      baseDataPath: this.config.baseDataPath,
      dgraphUrl: this.config.dgraphUrl,
      zfsPoolPrefix: this.config.zfsPoolPrefix,
      schemaPath: this.config.schemaPath
    });

    // Initialize network
    await network.initialize();

    // Create Dgraph client for this network
    const dgraphClient = new DgraphClient({
      url: this.config.dgraphUrl,
      logger: createLogger(`dgraph-${prefix}`),
      namespace: prefix
    });

    // Apply network schema
    await this.applyNetworkSchema(prefix, dgraphClient);

    // Store network and client
    network.dgraphClient = dgraphClient;
    this.networks.set(prefix, network);

    if (save) {
      await this.saveNetworkRegistry();
    }

    this.emit('network:registered', { prefix, network });
    return network;
  }

  validateNetworkConfig(prefix, config) {
    // Prefix validation
    if (!/^[a-zA-Z0-9_-]+_$/.test(prefix)) {
      throw new Error('Network prefix must end with _ and contain only alphanumeric, dash, or underscore');
    }

    // Required fields
    const required = ['name', 'description', 'tokens'];
    for (const field of required) {
      if (!config[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Tokens validation
    if (!Array.isArray(config.tokens) || config.tokens.length === 0) {
      throw new Error('Network must include at least one token');
    }

    // Validate each token config
    for (const token of config.tokens) {
      if (!token.symbol || !token.name) {
        throw new Error('Each token must have symbol and name');
      }
      if (!/^[A-Z0-9]{2,10}$/.test(token.symbol)) {
        throw new Error(`Invalid token symbol: ${token.symbol}`);
      }
    }
  }

  async applyNetworkSchema(prefix, dgraphClient) {
    try {
      // Load base schema
      const baseSchemaPath = path.join(this.config.schemaPath, 'schema.dgraph');
      const baseSchema = await fs.readFile(baseSchemaPath, 'utf8');
      
      // Check for network-specific schema
      const networkSchemaPath = path.join(this.config.schemaPath, 'networks', `${prefix.slice(0, -1)}.dgraph`);
      let networkSchema = '';
      
      try {
        networkSchema = await fs.readFile(networkSchemaPath, 'utf8');
        this.logger.info(`Loaded custom schema for network: ${prefix}`);
      } catch (err) {
        // No custom schema for this network
        this.logger.debug(`No custom schema found for network: ${prefix}, using base schema only`);
      }
      
      // Combine schemas
      const combinedSchema = baseSchema + '\n\n' + networkSchema;
      
      // Debug: Save combined schema for inspection
      const debugPath = path.join(this.config.schemaPath, `debug-combined-${prefix}.dgraph`);
      await fs.writeFile(debugPath, combinedSchema);
      this.logger.info(`Saved combined schema for debugging: ${debugPath}`);
      
      // Check for "nodes" in combined schema
      if (combinedSchema.includes('nodes:')) {
        this.logger.warn(`Combined schema contains 'nodes:' predicate for network ${prefix}`);
        const lines = combinedSchema.split('\n');
        lines.forEach((line, index) => {
          if (line.includes('nodes:')) {
            this.logger.warn(`  Line ${index + 1}: ${line.trim()}`);
          }
        });
      }
      
      // Apply schema
      await dgraphClient.setSchema(combinedSchema);
      this.logger.info(`Schema applied for network: ${prefix}`);
      
    } catch (error) {
      this.logger.error(`Failed to apply schema for network ${prefix}:`, error);
      throw error;
    }
  }

  getNetwork(prefix) {
    return this.networks.get(prefix);
  }

  getAllNetworks() {
    return Array.from(this.networks.entries()).map(([prefix, network]) => ({
      prefix,
      ...network.getConfig()
    }));
  }

  getNetworkForToken(tokenSymbol) {
    for (const [prefix, network] of this.networks) {
      if (network.hasToken(tokenSymbol)) {
        return { prefix, network };
      }
    }
    return null;
  }

  async createCheckpoint(prefix, blockNum, stateHash) {
    const network = this.networks.get(prefix);
    if (!network) {
      throw new Error(`Network ${prefix} not found`);
    }

    const checkpoint = {
      network: prefix,
      blockNum,
      stateHash,
      timestamp: new Date().toISOString(),
      tokens: {}
    };

    // Gather token stats
    for (const token of network.tokens) {
      checkpoint.tokens[token.symbol] = await this.getTokenStats(prefix, token.symbol);
    }

    // Store checkpoint
    const checkpointPath = path.join(
      this.config.baseDataPath, 
      'checkpoints', 
      prefix,
      `${blockNum}.json`
    );
    
    await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
    await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));

    return checkpoint;
  }

  async getTokenStats(prefix, tokenSymbol) {
    // This would query Dgraph for token statistics
    // For now, return mock data
    return {
      supply: '0',
      holders: 0,
      transactions: 0
    };
  }
}

class NetworkNamespace {
  constructor(prefix, config) {
    this.prefix = prefix;
    this.config = config;
    this.tokens = config.tokens || [];
    this.zfsDataset = `${config.zfsPoolPrefix}/${prefix.slice(0, -1)}`;
    this.dataPath = path.join(config.baseDataPath, 'networks', prefix.slice(0, -1));
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    // Create ZFS dataset
    await this.createZFSDataset();

    // Create network data directory
    await fs.mkdir(this.dataPath, { recursive: true });

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

  getConfig() {
    return {
      name: this.config.name,
      description: this.config.description,
      tokens: this.tokens,
      features: this.config.features || {},
      createdAt: this.config.createdAt,
      updatedAt: this.config.updatedAt || new Date().toISOString()
    };
  }

  hasToken(symbol) {
    return this.tokens.some(token => token.symbol === symbol);
  }

  getToken(symbol) {
    return this.tokens.find(token => token.symbol === symbol);
  }

  async addToken(tokenConfig) {
    if (this.hasToken(tokenConfig.symbol)) {
      throw new Error(`Token ${tokenConfig.symbol} already exists in network ${this.prefix}`);
    }

    this.tokens.push(tokenConfig);
    this.config.updatedAt = new Date().toISOString();
  }

  async removeToken(symbol) {
    const index = this.tokens.findIndex(token => token.symbol === symbol);
    if (index === -1) {
      throw new Error(`Token ${symbol} not found in network ${this.prefix}`);
    }

    this.tokens.splice(index, 1);
    this.config.updatedAt = new Date().toISOString();
  }
}

// Default network configurations
export const DEFAULT_NETWORKS = {
  'spkccT_': {
    name: 'SPK Test Network',
    description: 'SPK Network test environment',
    tokens: [
      {
        symbol: 'LARYNX',
        name: 'Larynx',
        description: 'SPK Network Mining Token',
        precision: 3,
        features: {
          transfers: true,
          staking: true,
          mining: true
        }
      },
      {
        symbol: 'SPK',
        name: 'SPK Network',
        description: 'Decentralized Web3 Video Network',
        precision: 3,
        features: {
          transfers: true,
          staking: true,
          governance: true
        }
      },
      {
        symbol: 'BROCA',
        name: 'Broca',
        description: 'SPK Network Resource Credits',
        precision: 0,
        features: {
          transfers: false,
          regeneration: true,
          consumption: true
        }
      }
    ],
    features: {
      contracts: true,
      services: true,
      validators: true,
      dex: true
    }
  },
  'spkcc_': {
    name: 'SPK Main Network',
    description: 'SPK Network mainnet',
    tokens: [
      {
        symbol: 'LARYNX',
        name: 'Larynx',
        description: 'SPK Network Mining Token',
        precision: 3,
        features: {
          transfers: true,
          staking: true,
          mining: true
        }
      },
      {
        symbol: 'SPK',
        name: 'SPK Network',
        description: 'Decentralized Web3 Video Network',
        precision: 3,
        features: {
          transfers: true,
          staking: true,
          governance: true
        }
      },
      {
        symbol: 'BROCA',
        name: 'Broca',
        description: 'SPK Network Resource Credits',
        precision: 0,
        features: {
          transfers: false,
          regeneration: true,
          consumption: true
        }
      }
    ],
    features: {
      contracts: true,
      services: true,
      validators: true,
      dex: true
    }
  },
  'dlux_': {
    name: 'DLUX Network',
    description: 'Decentralized Limitless User eXperience',
    tokens: [
      {
        symbol: 'DLUX',
        name: 'DLUX',
        description: 'DLUX Token',
        precision: 3,
        features: {
          transfers: true,
          nft: true,
          dex: true
        }
      }
    ],
    features: {
      nft: true,
      dex: true,
      posts: true
    }
  }
};