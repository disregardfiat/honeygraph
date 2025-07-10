import { Router } from 'express';
import Joi from 'joi';

export function createQueryRoutes({ dgraphClient, forkManager, schemas, validate }) {
  const router = Router();

  // Query by path
  router.get('/path/:path(*)', validate(schemas.queryOptions), async (req, res) => {
    try {
      const path = req.params.path;
      const options = req.query;
      
      const result = await dgraphClient.queryByPath(path, options);
      
      res.json({
        path,
        fork: options.fork || forkManager.getCanonicalFork(),
        data: result.states && result.states[0] || null
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Query multiple paths
  router.post('/paths', validate(schemas.queryOptions.append({
    paths: Joi.array().items(Joi.string()).min(1).max(100).required()
  })), async (req, res) => {
    try {
      const { paths, ...options } = req.body;
      
      const results = await Promise.all(
        paths.map(path => dgraphClient.queryByPath(path, options))
      );
      
      const data = paths.reduce((acc, path, index) => {
        acc[path] = results[index].states && results[index].states[0] || null;
        return acc;
      }, {});
      
      res.json({
        fork: options.fork || forkManager.getCanonicalFork(),
        data
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get fork information
  router.get('/forks', async (req, res) => {
    try {
      const forks = await forkManager.getActiveForks();
      
      res.json({
        canonical: forkManager.getCanonicalFork(),
        active: forks,
        total: forks.length
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get operations for a block
  router.get('/block/:blockNum/operations', async (req, res) => {
    try {
      const blockNum = parseInt(req.params.blockNum);
      const fork = req.query.fork || forkManager.getCanonicalFork();
      
      const operations = await dgraphClient.getForkOperations(fork, blockNum, blockNum);
      
      res.json({
        blockNum,
        fork,
        operations
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get full block data (for peer sync)
  router.get('/block/:blockNum/full', async (req, res) => {
    try {
      const blockNum = parseInt(req.params.blockNum);
      const fork = req.query.fork || forkManager.getCanonicalFork();
      
      // Query full block data
      const query = `
        query getFullBlock($blockNum: int, $fork: string) {
          block(func: eq(blockNum, $blockNum)) @filter(eq(forkId, $fork)) {
            uid
            blockNum
            blockHash
            previousHash
            timestamp
            forkId
            isFinalized
            operations {
              uid
              index
              type
              path
              data
              previousValue
              timestamp
              reverted
            }
          }
        }
      `;
      
      const vars = { $blockNum: blockNum, $fork: fork };
      const result = await dgraphClient.client.newTxn().queryWithVars(query, vars);
      const blocks = result.getJson().block || [];
      
      if (blocks.length === 0) {
        return res.status(404).json({ 
          error: 'Block not found',
          blockNum,
          fork 
        });
      }
      
      const blockData = blocks[0];
      blockData.peerId = process.env.PEER_ID || 'unknown';
      
      res.json(blockData);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get blockchain head
  router.get('/head', async (req, res) => {
    try {
      const query = `{
        head(func: type(Block)) @normalize {
          maxBlock: max(blockNum)
        }
      }`;
      
      const result = await dgraphClient.client.newTxn().query(query);
      const data = result.getJson();
      const head = data.head?.[0]?.maxBlock || 0;
      
      res.json({ 
        head,
        fork: forkManager.getCanonicalFork()
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get state at specific block
  router.get('/state-at/:blockNum', validate(schemas.queryOptions), async (req, res) => {
    try {
      const blockNum = parseInt(req.params.blockNum);
      const { path, fork } = req.query;
      
      const options = {
        fork: fork || forkManager.getCanonicalFork(),
        beforeBlock: blockNum,
        includeHistory: false
      };
      
      if (path) {
        const result = await dgraphClient.queryByPath(path, options);
        res.json({
          blockNum,
          path,
          fork: options.fork,
          data: result.states && result.states[0] || null
        });
      } else {
        res.status(400).json({ error: 'Path parameter required' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}