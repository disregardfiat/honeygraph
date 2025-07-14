import { Router } from 'express';
import { createQueryRoutes } from './query.js';
import { createSPKRoutes } from './spk.js';
import { createDataTransformer } from '../lib/data-transformer.js';

/**
 * Create network-based routes
 * Routes are accessible at /api/network/{prefix}/... and /api/token/{token}/...
 */
export function createMultiTokenRoutes({ networkManager, schemas, validate }) {
  const router = Router();
  
  // Network-based routes - /api/network/{prefix}/...
  router.use('/network/:prefix/*', async (req, res, next) => {
    const prefix = req.params.prefix;
    
    try {
      // Ensure prefix ends with underscore
      const normalizedPrefix = prefix.endsWith('_') ? prefix : `${prefix}_`;
      
      // Check if network is registered
      const network = networkManager.getNetwork(normalizedPrefix);
      if (!network) {
        return res.status(404).json({
          error: `Network ${normalizedPrefix} not found`,
          registeredNetworks: networkManager.getAllNetworks().map(n => n.prefix)
        });
      }
      
      // Get network-specific DgraphClient
      const dgraphClient = network.dgraphClient;
      
      // Attach to request for use in routes
      req.network = network;
      req.networkPrefix = normalizedPrefix;
      req.dgraphClient = dgraphClient;
      
      next();
    } catch (error) {
      res.status(500).json({
        error: 'Failed to initialize network context',
        message: error.message
      });
    }
  });
  
  // Token-based routes - /api/token/{token}/...
  router.use('/token/:token/*', async (req, res, next) => {
    const token = req.params.token.toUpperCase();
    
    try {
      // Find network containing this token
      const result = networkManager.getNetworkForToken(token);
      if (!result) {
        return res.status(404).json({
          error: `Token ${token} not found in any network`,
          availableNetworks: networkManager.getAllNetworks()
        });
      }
      
      const { prefix, network } = result;
      
      // Get network-specific DgraphClient
      const dgraphClient = network.dgraphClient;
      
      // Attach to request for use in routes
      req.token = token;
      req.network = network;
      req.networkPrefix = prefix;
      req.dgraphClient = dgraphClient;
      req.tokenInfo = network.getToken(token);
      
      next();
    } catch (error) {
      res.status(500).json({
        error: 'Failed to initialize token context',
        message: error.message
      });
    }
  });
  
  // Token-specific query routes
  router.use('/:token/query', (req, res, next) => {
    const { dgraphClient } = req;
    const queryRouter = createQueryRoutes({
      dgraphClient,
      forkManager: null, // Token-specific fork manager could be added
      schemas,
      validate
    });
    queryRouter(req, res, next);
  });
  
  // Token-specific SPK routes (if applicable)
  router.use('/:token/spk', (req, res, next) => {
    const { dgraphClient } = req;
    const spkRouter = createSPKRoutes({
      dgraphClient,
      schemas,
      validate
    });
    spkRouter(req, res, next);
  });
  
  // Network info endpoint
  router.get('/network/:prefix/info', async (req, res) => {
    try {
      const { network, networkPrefix } = req;
      
      res.json({
        prefix: networkPrefix,
        config: network.getConfig(),
        tokens: network.tokens,
        initialized: true
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get network info',
        message: error.message
      });
    }
  });
  
  // Token info endpoint
  router.get('/token/:token/info', async (req, res) => {
    try {
      const { token, network, networkPrefix, tokenInfo } = req;
      
      res.json({
        token,
        network: networkPrefix,
        tokenInfo,
        networkConfig: network.getConfig(),
        initialized: true
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get token info',
        message: error.message
      });
    }
  });
  
  // Network stats endpoint
  router.get('/network/:prefix/stats', async (req, res) => {
    try {
      const { networkPrefix, dgraphClient } = req;
      
      const query = `
        query {
          blocks: count(func: type(Block))
          operations: count(func: type(Operation))
          states: count(func: type(State))
          checkpoints: count(func: type(Checkpoint))
          accounts: count(func: type(Account))
        }
      `;
      
      const result = await dgraphClient.query(query);
      
      res.json({
        network: networkPrefix,
        stats: {
          blocks: result.blocks?.[0] || 0,
          operations: result.operations?.[0] || 0,
          states: result.states?.[0] || 0,
          checkpoints: result.checkpoints?.[0] || 0,
          accounts: result.accounts?.[0] || 0
        }
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get network stats',
        message: error.message
      });
    }
  });
  
  // List all registered networks
  router.get('/networks', (req, res) => {
    const networks = networkManager.getAllNetworks();
    
    res.json({
      networks,
      count: networks.length
    });
  });
  
  // List all tokens across all networks
  router.get('/tokens', (req, res) => {
    const networks = networkManager.getAllNetworks();
    const allTokens = [];
    
    for (const network of networks) {
      for (const token of network.tokens) {
        allTokens.push({
          symbol: token.symbol,
          name: token.name,
          network: network.prefix,
          networkName: network.name,
          precision: token.precision,
          features: token.features
        });
      }
    }
    
    res.json({
      tokens: allTokens,
      count: allTokens.length
    });
  });
  
  // Register a new network
  const networkRegistrationHandler = async (req, res) => {
    try {
      const { prefix, name, description, tokens, ...additionalConfig } = req.body;
      
      if (!prefix || !name || !tokens || tokens.length === 0) {
        return res.status(400).json({
          error: 'Missing required fields: prefix, name, tokens'
        });
      }
      
      const network = await networkManager.registerNetwork(prefix, {
        name,
        description: description || `${name} network`,
        tokens,
        ...additionalConfig
      });
      
      res.status(201).json({
        message: `Network ${prefix} registered successfully`,
        network: {
          prefix,
          config: network.getConfig()
        }
      });
    } catch (error) {
      res.status(400).json({
        error: 'Failed to register network',
        message: error.message
      });
    }
  };
  
  // Apply validation if schema exists, otherwise use handler directly
  if (schemas && schemas.networkRegistration) {
    router.post('/networks', validate(schemas.networkRegistration), networkRegistrationHandler);
  } else {
    router.post('/networks', networkRegistrationHandler);
  }
  
  // Global stats across all networks
  router.get('/stats', async (req, res) => {
    try {
      const networks = networkManager.getAllNetworks();
      const globalStats = {
        totalNetworks: networks.length,
        totalTokens: 0,
        networks: {}
      };
      
      // Aggregate stats per network
      for (const network of networks) {
        globalStats.totalTokens += network.tokens.length;
        globalStats.networks[network.prefix] = {
          name: network.name,
          tokenCount: network.tokens.length,
          tokens: network.tokens.map(t => t.symbol)
        };
      }
      
      res.json(globalStats);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get global stats',
        message: error.message
      });
    }
  });
  
  return router;
}