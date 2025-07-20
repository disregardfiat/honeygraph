import { Router } from 'express';
import Joi from 'joi';

export function createReplicationRoutes({ dgraphClient, forkManager, replicationQueue, schemas, validate }) {
  const router = Router();

  // Replicate block with operations
  router.post('/block', validate(schemas.blockData.append({
    operations: Joi.array().items(schemas.operation).min(1).required()
  })), async (req, res) => {
    try {
      const { operations, ...blockData } = req.body;
      
      // Add to replication queue
      const jobId = await replicationQueue.addBlockReplication(blockData, operations);
      
      res.json({ 
        success: true, 
        jobId,
        blockNum: blockData.blockNum,
        operationCount: operations.length 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update consensus
  router.post('/consensus', validate(schemas.consensusData), async (req, res) => {
    try {
      const consensusData = req.body;
      
      // Add to replication queue with high priority
      const jobId = await replicationQueue.addConsensusUpdate(consensusData);
      
      res.json({ 
        success: true, 
        jobId,
        blockNum: consensusData.blockNum 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create checkpoint
  router.post('/checkpoint', validate(schemas.blockData), async (req, res) => {
    try {
      const { checkpointData } = req.body;
      
      // Add to replication queue
      const jobId = await replicationQueue.addCheckpointCreation(checkpointData);
      
      res.json({ 
        success: true, 
        jobId,
        blockNum: checkpointData.blockNum 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get replication status
  router.get('/status', async (req, res) => {
    try {
      const metrics = await replicationQueue.getMetrics();
      
      res.json({
        queue: metrics,
        activeForks: await forkManager.getActiveForks(),
        canonicalFork: forkManager.getCanonicalFork()
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}