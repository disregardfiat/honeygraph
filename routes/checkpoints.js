import { Router } from 'express';

export function createCheckpointRoutes({ zfsCheckpoints, forkManager, dgraphClient, schemas, validate }) {
  const router = Router();

  // List all ZFS checkpoints
  router.get('/list', async (req, res) => {
    if (!zfsCheckpoints) {
      return res.status(501).json({ error: 'ZFS checkpoints not enabled' });
    }

    try {
      const checkpoints = await zfsCheckpoints.listCheckpoints();
      res.json({
        checkpoints,
        total: checkpoints.length
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Rollback to a specific checkpoint
  router.post('/rollback/:blockNum', async (req, res) => {
    if (!zfsCheckpoints) {
      return res.status(501).json({ error: 'ZFS checkpoints not enabled' });
    }

    try {
      const blockNum = parseInt(req.params.blockNum);
      
      // Get checkpoint info
      const checkpoint = zfsCheckpoints.checkpoints.get(blockNum);
      if (!checkpoint) {
        return res.status(404).json({ error: 'Checkpoint not found' });
      }

      // Rollback ZFS
      const result = await zfsCheckpoints.rollbackToCheckpoint(blockNum);
      
      // Update fork manager to match rolled back state
      if (checkpoint.ipfsHash) {
        forkManager.setCanonicalFork(checkpoint.ipfsHash);
        await forkManager.orphanForksAfter(blockNum);
      }

      res.json({
        success: true,
        rolledBackTo: result.rolledBackTo,
        message: `Rolled back to block ${blockNum}`
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create checkpoint manually
  router.post('/create', validate(schemas.blockData), async (req, res) => {
    if (!zfsCheckpoints) {
      return res.status(501).json({ error: 'ZFS checkpoints not enabled' });
    }

    try {
      const { blockNum, ipfsHash } = req.body;
      
      const result = await zfsCheckpoints.createCheckpoint(blockNum, ipfsHash);
      
      res.json({
        success: true,
        checkpoint: result
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Clone a checkpoint for testing
  router.post('/clone/:blockNum', async (req, res) => {
    if (!zfsCheckpoints) {
      return res.status(501).json({ error: 'ZFS checkpoints not enabled' });
    }

    try {
      const blockNum = parseInt(req.params.blockNum);
      const { cloneName } = req.body;
      
      if (!cloneName || !cloneName.match(/^[a-zA-Z0-9_-]+$/)) {
        return res.status(400).json({ error: 'Invalid clone name' });
      }

      const result = await zfsCheckpoints.cloneCheckpoint(blockNum, cloneName);
      
      res.json({
        success: true,
        clone: result
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Compare two checkpoints
  router.get('/diff/:blockNum1/:blockNum2', async (req, res) => {
    if (!zfsCheckpoints) {
      return res.status(501).json({ error: 'ZFS checkpoints not enabled' });
    }

    try {
      const blockNum1 = parseInt(req.params.blockNum1);
      const blockNum2 = parseInt(req.params.blockNum2);
      
      const diff = await zfsCheckpoints.diffCheckpoints(blockNum1, blockNum2);
      
      res.json({
        from: blockNum1,
        to: blockNum2,
        differences: diff.differences
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Find checkpoint by IPFS hash
  router.get('/by-hash/:ipfsHash', async (req, res) => {
    if (!zfsCheckpoints) {
      return res.status(501).json({ error: 'ZFS checkpoints not enabled' });
    }

    try {
      const { ipfsHash } = req.params;
      
      const checkpoint = await zfsCheckpoints.getCheckpointByHash(ipfsHash);
      
      if (!checkpoint) {
        return res.status(404).json({ error: 'Checkpoint not found' });
      }

      res.json(checkpoint);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Enable auto snapshots
  router.post('/auto-snapshots', async (req, res) => {
    if (!zfsCheckpoints) {
      return res.status(501).json({ error: 'ZFS checkpoints not enabled' });
    }

    try {
      const { intervalBlocks = 1000 } = req.body;
      
      const result = await zfsCheckpoints.enableAutoSnapshots(intervalBlocks);
      
      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}