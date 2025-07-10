/**
 * Example WebSocket server for Honeygraph fork tracking
 * 
 * This demonstrates how to set up the WebSocket server that receives
 * fork and operation data from Honeycomb nodes.
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { WSForkHandler } from './lib/ws-fork-handler.js';

// Create Express app
const app = express();
const server = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ 
  server,
  path: '/fork-stream'
});

// Create fork handler
const forkHandler = new WSForkHandler({
  maxForksPerBlock: 10,
  forkRetentionTime: 3600000, // 1 hour
  operationBufferSize: 10000
});

// Start periodic cleanup
forkHandler.startCleanup();

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

// REST API endpoints
app.use(express.json());

// Get fork statistics
app.get('/api/forks/stats', (req, res) => {
  res.json(forkHandler.getStats());
});

// Get specific fork details
app.get('/api/forks/:hash', (req, res) => {
  const details = forkHandler.getForkDetails(req.params.hash);
  
  if (!details) {
    return res.status(404).json({ error: 'Fork not found' });
  }
  
  res.json(details);
});

// Get forks for a specific block
app.get('/api/blocks/:blockNum/forks', (req, res) => {
  const blockNum = parseInt(req.params.blockNum);
  const stats = forkHandler.getStats();
  
  const blockForks = stats.forksByBlock[blockNum];
  if (!blockForks) {
    return res.status(404).json({ error: 'No forks found for block' });
  }
  
  res.json(blockForks);
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    connections: wss.clients.size,
    forks: forkHandler.forks.size,
    uptime: process.uptime()
  });
});

// Event listeners for fork events
forkHandler.on('fork:new', (data) => {
  console.log(`New fork: ${data.forkHash} at block ${data.blockNum}`);
  
  // Could broadcast to monitoring clients
  broadcastToMonitors({
    type: 'fork_new',
    ...data
  });
});

forkHandler.on('fork:confirmed', (data) => {
  console.log(`Fork confirmed: ${data.forkHash} at block ${data.blockNum}`);
  
  broadcastToMonitors({
    type: 'fork_confirmed',
    ...data
  });
});

forkHandler.on('fork:invalid', (data) => {
  console.log(`Fork invalid: ${data.forkHash} at block ${data.blockNum}`);
  
  broadcastToMonitors({
    type: 'fork_invalid',
    ...data
  });
});

forkHandler.on('fork:switch', (data) => {
  console.log(`Node ${data.nodeId} switched forks: ${data.oldForkHash} -> ${data.newForkHash}`);
});

forkHandler.on('operation', (data) => {
  // Log operations if needed (can be verbose)
  if (process.env.LOG_OPERATIONS === 'true') {
    console.log(`Operation on fork ${data.forkHash}: ${data.operation.type} ${data.operation.key}`);
  }
});

// Broadcast to monitoring WebSocket clients (if implemented)
function broadcastToMonitors(data) {
  // This could send to a separate WebSocket endpoint for monitoring dashboards
  // For now, just log
  if (process.env.VERBOSE === 'true') {
    console.log('Broadcast:', data);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  
  clearInterval(heartbeatInterval);
  forkHandler.stopCleanup();
  
  wss.close(() => {
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Honeygraph WebSocket server listening on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/fork-stream`);
  console.log(`API endpoint: http://localhost:${PORT}/api`);
});

// Export for testing
export { app, wss, forkHandler };