import { createLogger } from '../lib/logger.js';

const logger = createLogger('hive-auth');

// Cache for account public keys to avoid repeated blockchain queries
const accountKeyCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Middleware to authenticate Honeycomb nodes using Hive signatures
 * Expected headers:
 * - X-Hive-Account: The Hive account name
 * - X-Hive-Signature: Signature of the request
 * - X-Hive-Timestamp: Timestamp of the request
 */
export function authenticateHiveNode(options = {}) {
  // Load authorized accounts from environment
  const authorizedAccounts = (process.env.AUTHORIZED_HONEYCOMB_NODES || '')
    .split(',')
    .filter(a => a.trim())
    .map(a => a.trim().toLowerCase());
  
  const requireAuthorization = options.requireAuthorization !== false;
  
  return async (req, res, next) => {
    const account = req.headers['x-hive-account'];
    const signature = req.headers['x-hive-signature'];
    const timestamp = req.headers['x-hive-timestamp'];
    
    // Skip authentication if not required and no credentials provided
    if (!requireAuthorization && !account && !signature) {
      return next();
    }
    
    // Validate required headers
    if (!account || !signature || !timestamp) {
      return res.status(401).json({
        error: 'Missing authentication headers',
        required: ['X-Hive-Account', 'X-Hive-Signature', 'X-Hive-Timestamp']
      });
    }
    
    // Check timestamp is recent (within 5 minutes)
    const requestAge = Date.now() - parseInt(timestamp);
    if (isNaN(requestAge) || requestAge > 5 * 60 * 1000) {
      return res.status(401).json({ error: 'Request timestamp too old' });
    }
    
    // Check if account is authorized (if list is configured)
    if (authorizedAccounts.length > 0 && !authorizedAccounts.includes(account.toLowerCase())) {
      return res.status(403).json({ 
        error: 'Account not authorized',
        account 
      });
    }
    
    try {
      // Create the message that was signed
      // Include method, path, timestamp, and body if present
      const message = JSON.stringify({
        method: req.method,
        path: req.path,
        timestamp: parseInt(timestamp),
        body: req.body || {},
        account
      });
      
      // Get public key from cache or blockchain
      let publicKey = null;
      const cacheKey = `${account}:${Date.now() - (Date.now() % CACHE_TTL)}`;
      
      if (accountKeyCache.has(cacheKey)) {
        publicKey = accountKeyCache.get(cacheKey);
      } else {
        // Clear old cache entries
        for (const [key] of accountKeyCache) {
          if (!key.startsWith(`${account}:`)) {
            accountKeyCache.delete(key);
          }
        }
        
        // Fetch from Hive blockchain
        const dhive = await import('@hiveio/dhive');
        const hiveNode = new dhive.Client([
          'https://api.hive.blog',
          'https://api.deathwing.me',
          'https://hive-api.arcange.eu'
        ]);
        
        const accounts = await hiveNode.database.getAccounts([account]);
        if (!accounts || accounts.length === 0) {
          return res.status(404).json({ error: 'Account not found on Hive' });
        }
        
        publicKey = accounts[0].active.key_auths[0][0];
        accountKeyCache.set(cacheKey, publicKey);
      }
      
      // Verify signature
      const dhive = await import('@hiveio/dhive');
      
      const messageHash = dhive.cryptoUtils.sha256(message);
      const sig = dhive.Signature.from(signature);
      const pubKey = dhive.PublicKey.from(publicKey);
      const isValid = pubKey.verify(messageHash, sig);
      
      if (!isValid) {
        logger.warn(`Invalid signature from account: ${account}`);
        return res.status(401).json({ error: 'Invalid signature' });
      }
      
      // Authentication successful
      req.hiveAuth = {
        account,
        timestamp: parseInt(timestamp),
        authenticated: true
      };
      
      logger.debug(`Authenticated Honeycomb node: ${account}`);
      next();
      
    } catch (error) {
      logger.error('Hive authentication failed', { 
        error: error.message,
        account 
      });
      return res.status(500).json({ error: 'Authentication failed' });
    }
  };
}

/**
 * Helper function to sign a request for testing or client implementation
 */
export async function signHiveRequest(privateKey, account, method, path, body = {}) {
  const dhive = await import('@hiveio/dhive');
  
  const timestamp = Date.now();
  const message = JSON.stringify({
    method,
    path,
    timestamp,
    body,
    account
  });
  
  const messageHash = dhive.cryptoUtils.sha256(message);
  const privateKeyObj = dhive.PrivateKey.from(privateKey);
  const signature = privateKeyObj.sign(messageHash).toString();
  
  return {
    headers: {
      'X-Hive-Account': account,
      'X-Hive-Signature': signature,
      'X-Hive-Timestamp': timestamp.toString()
    }
  };
}