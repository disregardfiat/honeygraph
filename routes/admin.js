import { Router } from 'express';
import Joi from 'joi';

export function createAdminRoutes({ dgraphClient, forkManager, replicationQueue, schemas, validate }) {
  const router = Router();

  // Get system metrics
  router.get('/metrics', async (req, res) => {
    try {
      const [queueMetrics, forks, health] = await Promise.all([
        replicationQueue.getMetrics(),
        forkManager.getActiveForks(),
        dgraphClient.health()
      ]);

      res.json({
        timestamp: new Date().toISOString(),
        queue: queueMetrics,
        forks: {
          canonical: forkManager.getCanonicalFork(),
          active: forks.length,
          list: forks
        },
        dgraph: health,
        memory: process.memoryUsage(),
        uptime: process.uptime()
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Force fork reconciliation
  router.post('/reconcile-forks', validate(schemas.consensusData), async (req, res) => {
    try {
      const { consensusData } = req.body;
      
      const result = await forkManager.reconcileForks(consensusData);
      
      res.json({
        success: true,
        canonical: result.canonical,
        orphaned: result.orphaned
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Prune old data
  router.post('/prune', validate(Joi.object({
    beforeBlock: Joi.number().integer().min(0).required()
  })), async (req, res) => {
    try {
      const { beforeBlock } = req.body;
      
      const prunedForks = await forkManager.pruneForks(beforeBlock);
      
      res.json({
        success: true,
        prunedForks,
        beforeBlock
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Clear replication queue
  router.post('/clear-queue', async (req, res) => {
    try {
      await replicationQueue.cleanup(0); // Remove all completed/failed jobs
      
      const metrics = await replicationQueue.getMetrics();
      
      res.json({
        success: true,
        remaining: metrics
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Reinitialize schema
  router.post('/reinit-schema', async (req, res) => {
    try {
      await dgraphClient.initializeSchema();
      
      res.json({
        success: true,
        message: 'Schema reinitialized'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Export state snapshot
  router.get('/export/:blockNum', async (req, res) => {
    try {
      const blockNum = parseInt(req.params.blockNum);
      const fork = req.query.fork || forkManager.getCanonicalFork();
      
      // This would export the full state at a given block
      // Implementation depends on specific requirements
      
      res.json({
        blockNum,
        fork,
        message: 'Export functionality to be implemented'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}