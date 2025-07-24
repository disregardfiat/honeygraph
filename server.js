import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './lib/logger.js';
import { DgraphClient } from './lib/dgraph-client.js';
import { createRouter } from './routes/index.js';
import { ReplicationQueue } from './lib/replication-queue.js';
import { ForkManager } from './lib/fork-manager.js';
import { createZFSCheckpointManager } from './lib/zfs-checkpoint.js';
import { createPeerSyncManager } from './lib/peer-sync.js';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { WSForkHandler } from './lib/ws-fork-handler.js';
import { NetworkManager, DEFAULT_NETWORKS } from './lib/network-manager.js';

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger('server');
const app = express();
const PORT = process.env.API_PORT || 3030;
const PEER_ID = process.env.PEER_ID || `node_${Date.now()}`;

// Initialize Network Manager
const networkManager = new NetworkManager({
  dgraphUrl: process.env.DGRAPH_URL || 'http://localhost:9080',
  schemaPath: path.join(__dirname, 'schema'),
  baseDataPath: process.env.DATA_PATH || './data/honeygraph'
});

// Initialize the manager
await networkManager.initialize();

// Register default networks
for (const [prefix, config] of Object.entries(DEFAULT_NETWORKS)) {
  try {
    await networkManager.registerNetwork(prefix, config);
    logger.info(`Registered network: ${prefix} - ${config.name}`);
  } catch (error) {
    if (error.message.includes('already registered')) {
      logger.debug(`Network ${prefix} already registered`);
    } else {
      logger.error(`Failed to register network ${prefix}:`, error);
    }
  }
}

// Default DgraphClient for backward compatibility
const dgraphClient = new DgraphClient({
  url: process.env.DGRAPH_URL || 'http://localhost:9080',
  logger
});

// Initialize fork manager
const forkManager = new ForkManager(dgraphClient, logger);

// Initialize ZFS checkpoint manager if enabled
const zfsCheckpoints = process.env.ZFS_CHECKPOINTS_ENABLED === 'true' ? 
  createZFSCheckpointManager({
    dataset: process.env.ZFS_DATASET || 'rpool/dgraph',
    dgraphDataPath: process.env.DGRAPH_DATA_PATH || './data',
    maxSnapshots: parseInt(process.env.ZFS_MAX_SNAPSHOTS) || 100
  }) : null;

if (zfsCheckpoints) {
  // Load existing checkpoints on startup
  zfsCheckpoints.loadExistingCheckpoints()
    .then(() => logger.info('ZFS checkpoints loaded'))
    .catch(err => logger.error('Failed to load ZFS checkpoints', { error: err.message }));
}

// Initialize peer sync manager
const peerSync = process.env.SYNC_ENABLED === 'true' ?
  createPeerSyncManager({
    dgraphClient,
    forkManager,
    zfsCheckpoints
  }) : null;

if (peerSync) {
  // Register initial peers from environment
  const initialPeers = process.env.PEERS?.split(',') || [];
  initialPeers.forEach((peerUrl, index) => {
    peerSync.registerPeer(`peer_${index}`, peerUrl.trim());
  });
  
  // Start continuous sync
  const syncInterval = parseInt(process.env.SYNC_INTERVAL) || 60000;
  peerSync.startContinuousSync(syncInterval);
  
  // Periodic health checks
  setInterval(() => peerSync.healthCheckPeers(), 300000); // 5 minutes
}

// Initialize replication queue
const replicationQueue = new ReplicationQueue({
  dgraphClient,
  forkManager,
  zfsCheckpoints,
  logger,
  networkManager
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
  credentials: true
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10, // limit write operations
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/read', limiter);
app.use('/api/write', strictLimiter);
app.use('/api/replicate', strictLimiter);

// Import filesystem and docs routes separately for root-level mounting
import { createFileSystemRoutes } from './routes/filesystem.js';
import { createDocsRoutes } from './routes/docs.js';

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Mount docs routes
app.use('/api/docs', createDocsRoutes());

// Mount filesystem routes at root for clean URLs
app.use('/', createFileSystemRoutes({ dgraphClient, networkManager }));

// API routes
app.use('/api', createRouter({ dgraphClient, forkManager, replicationQueue, zfsCheckpoints, peerSync, networkManager }));

// Peer discovery endpoint (for other honeygraph nodes)
app.get('/api/honeygraph-peers', (req, res) => {
  const peers = peerSync ? 
    Array.from(peerSync.peers.values())
      .filter(p => p.isAlive)
      .map(p => ({ id: p.id, url: p.url })) : 
    [];
  res.json(peers);
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await dgraphClient.health();
    
    // Get authorized accounts
    const authorizedAccounts = (process.env.AUTHORIZED_HONEYCOMB_NODES || '')
      .split(',')
      .filter(a => a.trim())
      .map(a => a.trim().toLowerCase());
    
    // Get WebSocket stats from fork handler
    const wsStats = forkHandler.getStats ? forkHandler.getStats() : {};
    
    // Get connected nodes from fork handler
    const connectedNodes = forkHandler.getConnectedNodes ? forkHandler.getConnectedNodes() : [];
    
    res.json({ 
      status: 'healthy',
      service: 'honeygraph',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      websocket: wsStats,
      authorization: {
        enabled: process.env.REQUIRE_HIVE_AUTH === 'true',
        mode: authorizedAccounts.length > 0 ? 'whitelist' : 'any-authenticated',
        authorizedNodes: authorizedAccounts.length > 0 ? authorizedAccounts : ['any authenticated Hive account'],
        connectedNodes: connectedNodes
      }
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy',
      error: error.message 
    });
  }
});

// Error handling
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown`);
  
  // Stop heartbeat
  clearInterval(heartbeatInterval);
  forkHandler.stopCleanup();
  
  // Close WebSocket server
  wss.close(() => {
    logger.info('WebSocket server closed');
  });
  
  // Stop accepting new requests
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  // Close replication queue
  await replicationQueue.close();
  
  // Close Dgraph connection
  await dgraphClient.close();
  
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Create HTTP server
const server = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ 
  server,
  path: '/fork-stream'
});

// Create fork handler for WebSocket
const forkHandler = new WSForkHandler({
  maxForksPerBlock: 10,
  forkRetentionTime: 3600000 * 72, // 1 hour
  operationBufferSize: 10000
});

// Set the WebSocket server reference after it's created
forkHandler.wss = wss;

// Start periodic cleanup
forkHandler.startCleanup();

// Handle network/token identification
forkHandler.on('network:identified', async (data) => {
  try {
    const { prefix, tokens, nodeId } = data;
    logger.info(`Network identified: ${prefix} with tokens ${tokens.join(', ')} from node ${nodeId}`);
    
    // Check if network already registered
    if (!networkManager.getNetwork(prefix)) {
      // Auto-register network with identified tokens
      const networkConfig = {
        name: `${prefix.slice(0, -1).toUpperCase()} Network`,
        description: `Auto-discovered network: ${prefix}`,
        tokens: tokens.map(symbol => ({
          symbol: symbol,
          name: `${symbol} Token`,
          description: `${symbol} token on ${prefix} network`,
          precision: 3,
          features: {
            transfers: true
          }
        })),
        autoCreated: true
      };
      
      await networkManager.registerNetwork(prefix, networkConfig);
      logger.info(`Auto-registered new network: ${prefix}`);
    }
  } catch (error) {
    logger.error('Failed to handle network identification', { error: error.message });
  }
});

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  forkHandler.handleConnection(ws, req);
});

// Heartbeat to detect disconnected clients
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Handle fork events to forward to Dgraph
forkHandler.on('operation', async (data) => {
  try {
    // Forward raw operation data to replication queue
    const operation = data.operation;
    
    // Group operations by their checkpoint hash for batching
    await replicationQueue.addOperation({
      ...operation,
      receivedAt: Date.now(),
      nodeId: data.nodeId
    });
  } catch (error) {
    logger.error('Failed to queue operation', { error: error.message });
  }
});

// Handle checkpoint notifications
forkHandler.on('checkpoint', async (data) => {
  try {
    logger.info('Checkpoint received', {
      blockNum: data.blockNum,
      hash: data.hash,
      prevHash: data.prevHash
    });
    
    // Process all operations for this checkpoint
    await replicationQueue.processCheckpoint(data);
  } catch (error) {
    logger.error('Failed to process checkpoint', { error: error.message });
  }
});

// Start server
server.listen(PORT, () => {
  logger.info(`Honeygraph API server listening on port ${PORT}`);
  logger.info(`WebSocket endpoint: ws://localhost:${PORT}/fork-stream`);
});

// Initialize schema on startup
dgraphClient.initializeSchema()
  .then(() => logger.info('Dgraph schema initialized'))
  .catch(err => logger.error('Failed to initialize schema', { error: err.message }));

export { app, server };