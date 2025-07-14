import { Router } from 'express';
import crypto from 'crypto';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('auth');

export function createAuthRoutes({ dgraphClient }) {
  const router = Router();
  
  // Generate API token for Hive account
  router.post('/token/generate', async (req, res) => {
    try {
      const { account, signature, message } = req.body;
      
      if (!account || !signature || !message) {
        return res.status(400).json({
          error: 'Missing required fields: account, signature, message'
        });
      }
      
      // Verify Hive signature using dhive
      const dhive = await import('@hiveio/dhive');
      
      try {
        // Parse the message to verify it's recent
        const messageData = JSON.parse(message);
        const messageAge = Date.now() - messageData.timestamp;
        
        // Reject if message is older than 5 minutes
        if (messageAge > 5 * 60 * 1000) {
          return res.status(400).json({ error: 'Message timestamp too old' });
        }
        
        // Get account's public key from Hive
        const hiveNode = new dhive.Client([
          'https://api.hive.blog',
          'https://api.deathwing.me',
          'https://hive-api.arcange.eu'
        ]);
        
        const accounts = await hiveNode.database.getAccounts([account]);
        if (!accounts || accounts.length === 0) {
          return res.status(404).json({ error: 'Account not found on Hive' });
        }
        
        // Get the active public key
        const publicKey = accounts[0].active.key_auths[0][0];
        
        // Verify signature
        const messageHash = dhive.cryptoUtils.sha256(message);
        const sig = dhive.Signature.from(signature);
        const pubKey = dhive.PublicKey.from(publicKey);
        const isValid = pubKey.verify(messageHash, sig);
        
        if (!isValid) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
        
        logger.info(`Authenticated Hive account: ${account}`);
      } catch (verifyError) {
        logger.error('Signature verification failed', { error: verifyError.message });
        return res.status(401).json({ error: 'Signature verification failed' });
      }
      
      const tokenPayload = {
        account,
        timestamp: Date.now(),
        nonce: crypto.randomBytes(16).toString('hex')
      };
      
      const apiToken = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');
      
      // Store token in Dgraph
      const mutation = {
        set: [{
          'dgraph.type': 'ApiToken',
          account,
          token: apiToken,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
          active: true
        }]
      };
      
      await dgraphClient.mutate(mutation);
      
      res.json({
        apiToken,
        expiresAt: mutation.set[0].expiresAt
      });
      
    } catch (error) {
      logger.error('Failed to generate token', { error: error.message });
      res.status(500).json({ error: 'Failed to generate token' });
    }
  });
  
  // Verify API token
  router.post('/token/verify', async (req, res) => {
    try {
      const { apiToken } = req.body;
      
      if (!apiToken) {
        return res.status(400).json({ error: 'Missing apiToken' });
      }
      
      // Query token from Dgraph
      const query = `
        query verifyToken($token: string) {
          token(func: eq(token, $token)) @filter(eq(active, true)) {
            uid
            account
            expiresAt
            active
          }
        }
      `;
      
      const vars = { $token: apiToken };
      const result = await dgraphClient.query(query, vars);
      
      if (!result.token || result.token.length === 0) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      
      const tokenData = result.token[0];
      const expiresAt = new Date(tokenData.expiresAt);
      
      if (expiresAt < new Date()) {
        return res.status(401).json({ error: 'Token expired' });
      }
      
      res.json({
        valid: true,
        account: tokenData.account,
        expiresAt: tokenData.expiresAt
      });
      
    } catch (error) {
      logger.error('Failed to verify token', { error: error.message });
      res.status(500).json({ error: 'Failed to verify token' });
    }
  });
  
  // Revoke API token
  router.post('/token/revoke', async (req, res) => {
    try {
      const { apiToken } = req.body;
      
      if (!apiToken) {
        return res.status(400).json({ error: 'Missing apiToken' });
      }
      
      // Find and deactivate token
      const query = `
        query findToken($token: string) {
          token(func: eq(token, $token)) @filter(eq(active, true)) {
            uid
          }
        }
      `;
      
      const vars = { $token: apiToken };
      const result = await dgraphClient.query(query, vars);
      
      if (!result.token || result.token.length === 0) {
        return res.status(404).json({ error: 'Token not found' });
      }
      
      // Update token to inactive
      const mutation = {
        set: [{
          uid: result.token[0].uid,
          active: false,
          revokedAt: new Date().toISOString()
        }]
      };
      
      await dgraphClient.mutate(mutation);
      
      res.json({ message: 'Token revoked successfully' });
      
    } catch (error) {
      logger.error('Failed to revoke token', { error: error.message });
      res.status(500).json({ error: 'Failed to revoke token' });
    }
  });
  
  return router;
}

// Middleware to verify API token on requests
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  // TODO: Implement actual token verification
  // For now, pass through
  req.apiToken = token;
  next();
}