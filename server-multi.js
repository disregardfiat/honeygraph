/**
 * Multi-Token Honeygraph Server
 * Supports multiple token ecosystems with dynamic routing
 */

const express = require('express');
const { ApolloServer } = require('apollo-server-express');
const { makeExecutableSchema, mergeSchemas } = require('@graphql-tools/schema');
const { MultiTokenManager } = require('./lib/multi-token-manager');
const TokenRegistry = require('./lib/token-registry');
const { PathwiseMulti, namespaceMiddleware } = require('../honeycomb-spkcc/pathwise-multi');
const HoneygraphWSHandler = require('./lib/ws-handler');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');

class MultiTokenHoneygraphServer {
  constructor(config = {}) {
    this.config = {
      port: process.env.PORT || 4000,
      host: process.env.HOST || '0.0.0.0',
      baseDataPath: process.env.DATA_PATH || '/data/honeygraph',
      enablePlayground: process.env.NODE_ENV !== 'production',
      ...config
    };

    this.app = express();
    this.tokenManager = new MultiTokenManager(this.config);
    this.tokenRegistry = new TokenRegistry(path.join(this.config.baseDataPath, 'registry'));
    this.pathwiseMulti = new PathwiseMulti(this.config);
    this.apolloServers = new Map();
    this.wsHandler = new HoneygraphWSHandler(this.config);
    this.httpServer = null;
  }

  async initialize() {
    // Initialize components
    await this.tokenRegistry.initialize();
    await this.tokenManager.initialize();
    await this.pathwiseMulti.initialize();

    // Setup middleware
    this.setupMiddleware();

    // Setup routes
    await this.setupRoutes();

    // Initialize GraphQL servers for each token
    await this.initializeGraphQLServers();

    // Initialize WebSocket handlers
    await this.initializeWebSocketHandlers();

    // Start server
    await this.start();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // CORS
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Namespace');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });

    // Request logging
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
      next();
    });

    // Namespace middleware
    this.app.use('/:namespace/*', namespaceMiddleware(this.pathwiseMulti));
  }

  async setupRoutes() {
    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Honeygraph Multi-Token Server',
        version: '1.0.0',
        tokens: this.tokenManager.getTokenSymbols(),
        endpoints: {
          graphql: '/:token/graphql',
          api: '/:token/api/*',
          registry: '/registry',
          health: '/health'
        }
      });
    });

    // Health check
    this.app.get('/health', async (req, res) => {
      const health = {
        status: 'ok',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        tokens: {},
        websocket: this.wsHandler.getStats()
      };

      for (const symbol of this.tokenManager.getTokenSymbols()) {
        const namespace = await this.pathwiseMulti.ensureNamespace(symbol.toLowerCase());
        health.tokens[symbol] = await namespace.getStats();
      }

      res.json(health);
    });

    // Registry endpoints
    this.setupRegistryRoutes();

    // Token management endpoints
    this.setupTokenManagementRoutes();

    // Dynamic API routes for each token
    await this.setupDynamicAPIRoutes();
  }

  setupRegistryRoutes() {
    // List all tokens
    this.app.get('/registry/tokens', (req, res) => {
      res.json(this.tokenRegistry.getAllTokens());
    });

    // Get token info
    this.app.get('/registry/tokens/:symbol', (req, res) => {
      const token = this.tokenRegistry.getToken(req.params.symbol.toUpperCase());
      if (!token) {
        return res.status(404).json({ error: 'Token not found' });
      }
      res.json(token);
    });

    // Register new token
    this.app.post('/registry/tokens', async (req, res) => {
      try {
        const { symbol, ...config } = req.body;
        const registered = await this.tokenRegistry.registerToken(symbol.toUpperCase(), config);
        await this.tokenManager.registerToken(symbol.toUpperCase(), registered);
        await this.reinitializeToken(symbol.toUpperCase());
        res.json({ success: true, token: registered });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    // Update token config
    this.app.put('/registry/tokens/:symbol', async (req, res) => {
      try {
        const symbol = req.params.symbol.toUpperCase();
        const updated = await this.tokenRegistry.updateTokenConfig(symbol, req.body);
        res.json({ success: true, token: updated });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    // Upload schema
    this.app.post('/registry/tokens/:symbol/schema', async (req, res) => {
      try {
        const symbol = req.params.symbol.toUpperCase();
        await this.tokenRegistry.saveSchema(symbol, req.body.schema);
        await this.reinitializeToken(symbol);
        res.json({ success: true });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    // Upload API
    this.app.post('/registry/tokens/:symbol/api', async (req, res) => {
      try {
        const symbol = req.params.symbol.toUpperCase();
        await this.tokenRegistry.saveAPI(symbol, req.body.api);
        await this.setupDynamicAPIRoutes();
        res.json({ success: true });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });
  }

  setupTokenManagementRoutes() {
    // Get token namespaces
    this.app.get('/namespaces', async (req, res) => {
      const namespaces = Array.from(this.pathwiseMulti.namespaces.keys());
      res.json(namespaces);
    });

    // Get namespace stats
    this.app.get('/namespaces/:namespace/stats', async (req, res) => {
      try {
        const namespace = this.pathwiseMulti.getNamespace(req.params.namespace);
        if (!namespace) {
          return res.status(404).json({ error: 'Namespace not found' });
        }
        const stats = await namespace.getStats();
        res.json(stats);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Export namespace data
    this.app.get('/namespaces/:namespace/export', async (req, res) => {
      try {
        const namespace = this.pathwiseMulti.getNamespace(req.params.namespace);
        if (!namespace) {
          return res.status(404).json({ error: 'Namespace not found' });
        }
        const format = req.query.format || 'json';
        const data = await namespace.exportNamespace(format);
        
        if (format === 'csv') {
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="${req.params.namespace}.csv"`);
        }
        
        res.send(data);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  async setupDynamicAPIRoutes() {
    // Remove existing token routes
    this.app._router.stack = this.app._router.stack.filter(r => {
      return !r.route || !r.route.path || !r.route.path.match(/^\/[A-Z]+\//i);
    });

    // Setup routes for each token
    for (const symbol of this.tokenManager.getTokenSymbols()) {
      const token = this.tokenManager.getToken(symbol);
      
      try {
        // Load and apply API routes
        const apiRoutes = await token.getAPIRoutes();
        const router = express.Router();
        apiRoutes(router, this.tokenManager);
        
        // Mount router under token namespace
        this.app.use(`/${symbol.toLowerCase()}`, router);
        
        console.log(`Loaded API routes for ${symbol}`);
      } catch (err) {
        console.error(`Failed to load API routes for ${symbol}:`, err.message);
      }
    }
  }

  async initializeGraphQLServers() {
    for (const symbol of this.tokenManager.getTokenSymbols()) {
      await this.initializeTokenGraphQL(symbol);
    }
  }

  async initializeTokenGraphQL(symbol) {
    try {
      const token = this.tokenManager.getToken(symbol);
      const schemaString = await token.getGraphQLSchema();
      const namespace = await this.pathwiseMulti.ensureNamespace(symbol.toLowerCase());

      // Create resolvers
      const resolvers = this.createTokenResolvers(symbol, namespace);

      // Create executable schema
      const schema = makeExecutableSchema({
        typeDefs: schemaString,
        resolvers
      });

      // Create Apollo Server
      const server = new ApolloServer({
        schema,
        context: ({ req }) => ({
          namespace,
          token: symbol,
          headers: req.headers
        }),
        playground: this.config.enablePlayground,
        introspection: true
      });

      // Apply middleware
      await server.start();
      server.applyMiddleware({
        app: this.app,
        path: `/${symbol.toLowerCase()}/graphql`
      });

      this.apolloServers.set(symbol, server);
      console.log(`GraphQL server initialized for ${symbol} at /${symbol.toLowerCase()}/graphql`);
    } catch (err) {
      console.error(`Failed to initialize GraphQL for ${symbol}:`, err);
    }
  }

  createTokenResolvers(symbol, namespace) {
    // Create default resolvers based on token symbol
    const lowerSymbol = symbol.toLowerCase();
    
    return {
      Query: {
        [`${lowerSymbol}State`]: async () => {
          const state = await namespace.get('state');
          return state || {
            supply: '0',
            transfers: 0,
            holders: 0,
            lastBlock: 0
          };
        },
        
        [`${lowerSymbol}Balance`]: async (_, { account }) => {
          const balance = await namespace.get(`balances:${account}`);
          return balance || {
            account,
            balance: '0',
            updatedAt: new Date().toISOString()
          };
        },
        
        [`${lowerSymbol}Balances`]: async (_, { limit = 100, offset = 0 }) => {
          const balances = await namespace.query({
            path: { $regex: '^balances:' },
            limit,
            offset
          });
          
          return balances.map(b => ({
            account: b.path.replace('balances:', ''),
            balance: b.value.balance || '0',
            updatedAt: b.value.updatedAt || new Date().toISOString()
          }));
        },
        
        [`${lowerSymbol}Transfers`]: async (_, { account, limit = 100, offset = 0 }) => {
          const query = account
            ? { path: { $regex: `^transfers:.*:${account}` } }
            : { path: { $regex: '^transfers:' } };
          
          query.limit = limit;
          query.offset = offset;
          
          const transfers = await namespace.query(query);
          
          return transfers.map(t => ({
            from: t.value.from,
            to: t.value.to,
            amount: t.value.amount,
            memo: t.value.memo || null,
            blockNum: t.value.blockNum,
            timestamp: t.value.timestamp,
            txId: t.value.txId
          }));
        }
      }
    };
  }

  async reinitializeToken(symbol) {
    // Stop existing Apollo server
    const existingServer = this.apolloServers.get(symbol);
    if (existingServer) {
      await existingServer.stop();
      this.apolloServers.delete(symbol);
    }

    // Reinitialize
    await this.initializeTokenGraphQL(symbol);
    await this.setupDynamicAPIRoutes();
  }

  async initializeWebSocketHandlers() {
    // Register operation handlers for each token
    for (const symbol of this.tokenManager.getTokenSymbols()) {
      const namespace = await this.pathwiseMulti.ensureNamespace(symbol.toLowerCase());
      
      // Create operation handler
      this.wsHandler.registerOperationHandler(symbol, async (operation) => {
        try {
          // Store operation in pathwise
          const path = operation.path;
          const data = operation.data;
          
          // Ensure the operation has all required metadata
          const enrichedData = {
            ...data,
            _meta: {
              index: operation.index,
              blockNum: operation.blockNum,
              checkpointHash: operation.checkpointHash,
              timestamp: operation.timestamp || Date.now(),
              type: operation.type
            }
          };
          
          // Store in pathwise namespace
          await namespace.set(path, enrichedData);
          
          console.log(`[WS] Processed operation ${operation.index} for ${symbol}: ${operation.type} ${path}`);
        } catch (error) {
          console.error(`[WS] Error processing operation for ${symbol}:`, error);
          throw error;
        }
      });
    }
    
    // Setup WebSocket event handlers
    this.wsHandler.on('client_connected', ({ clientId, token }) => {
      console.log(`[WS] Client ${clientId} connected for token ${token}`);
    });
    
    this.wsHandler.on('client_disconnected', ({ clientId, token, code, reason }) => {
      console.log(`[WS] Client ${clientId} disconnected from ${token} - Code: ${code}`);
    });
    
    this.wsHandler.on('checkpoint', async ({ token, blockNum, hash, timestamp }) => {
      console.log(`[WS] Checkpoint received for ${token} - Block: ${blockNum}, Hash: ${hash}`);
      // Could store checkpoint information if needed
    });
    
    this.wsHandler.on('operation_processed', ({ token, operation }) => {
      // Could emit events or trigger other actions
    });
    
    this.wsHandler.on('batch_processed', ({ token, count }) => {
      console.log(`[WS] Processed batch of ${count} operations for ${token}`);
    });
  }

  async start() {
    return new Promise((resolve) => {
      // Create HTTP server
      this.httpServer = http.createServer(this.app);
      
      // Initialize WebSocket server
      this.wsHandler.initialize(this.httpServer, '/ws');
      
      // Start listening
      this.httpServer.listen(this.config.port, this.config.host, () => {
        console.log(`Multi-Token Honeygraph Server running at http://${this.config.host}:${this.config.port}`);
        console.log(`WebSocket endpoint: ws://${this.config.host}:${this.config.port}/ws/:token`);
        console.log(`Active tokens: ${this.tokenManager.getTokenSymbols().join(', ')}`);
        resolve();
      });
    });
  }

  async stop() {
    // Stop Apollo servers
    for (const [symbol, server] of this.apolloServers) {
      await server.stop();
    }

    // Close WebSocket handler
    if (this.wsHandler) {
      this.wsHandler.close();
    }

    // Stop HTTP server
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
    }

    // Close pathwise connections
    await this.pathwiseMulti.close();
  }
}

// Start server if run directly
if (require.main === module) {
  const server = new MultiTokenHoneygraphServer();
  
  server.initialize().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    await server.stop();
    process.exit(0);
  });
}

module.exports = MultiTokenHoneygraphServer;