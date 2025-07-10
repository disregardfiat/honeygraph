import { Router } from 'express';

export function createSyncRoutes({ peerSync, dgraphClient, forkManager, schemas, validate }) {
  const router = Router();

  // Get sync status
  router.get('/status', (req, res) => {
    if (!peerSync) {
      return res.status(501).json({ error: 'Sync not enabled' });
    }

    res.json({
      isSyncing: peerSync.isSyncing,
      lastSyncBlock: peerSync.lastSyncBlock,
      peers: Array.from(peerSync.peers.values()).map(peer => ({
        id: peer.id,
        url: peer.url,
        isAlive: peer.isAlive,
        reliability: peer.reliability,
        lastSeen: peer.lastSeen
      }))
    });
  });

  // Register a new peer
  router.post('/peers', (req, res) => {
    if (!peerSync) {
      return res.status(501).json({ error: 'Sync not enabled' });
    }

    const { peerId, url } = req.body;
    
    if (!peerId || !url) {
      return res.status(400).json({ error: 'peerId and url required' });
    }

    peerSync.registerPeer(peerId, url);
    res.json({ success: true, peerId });
  });

  // Discover peers from network
  router.post('/discover', async (req, res) => {
    if (!peerSync) {
      return res.status(501).json({ error: 'Sync not enabled' });
    }

    const { nodes } = req.body;
    
    if (!Array.isArray(nodes)) {
      return res.status(400).json({ error: 'nodes array required' });
    }

    try {
      await peerSync.discoverPeers(nodes);
      res.json({ 
        success: true, 
        totalPeers: peerSync.peers.size 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Detect gaps in blockchain
  router.get('/gaps', async (req, res) => {
    if (!peerSync) {
      return res.status(501).json({ error: 'Sync not enabled' });
    }

    try {
      const fromBlock = parseInt(req.query.from) || 0;
      const toBlock = parseInt(req.query.to) || await peerSync.getLocalHead();
      
      const gaps = await peerSync.detectGaps(fromBlock, toBlock);
      
      res.json({
        fromBlock,
        toBlock,
        gaps,
        totalMissing: gaps.reduce((sum, gap) => sum + gap.size, 0)
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Sync specific gaps
  router.post('/sync-gaps', async (req, res) => {
    if (!peerSync) {
      return res.status(501).json({ error: 'Sync not enabled' });
    }

    const { gaps, targetFork } = req.body;
    
    if (!Array.isArray(gaps)) {
      return res.status(400).json({ error: 'gaps array required' });
    }

    try {
      const result = await peerSync.syncGaps(gaps, targetFork);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Force sync from a specific block
  router.post('/sync-from/:blockNum', async (req, res) => {
    if (!peerSync) {
      return res.status(501).json({ error: 'Sync not enabled' });
    }

    try {
      const fromBlock = parseInt(req.params.blockNum);
      const toBlock = await peerSync.getNetworkHead();
      
      const gaps = await peerSync.detectGaps(fromBlock, toBlock);
      
      if (gaps.length === 0) {
        return res.json({ 
          success: true, 
          message: 'No gaps detected' 
        });
      }

      const result = await peerSync.syncGaps(gaps);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get consensus for a block
  router.get('/consensus/:blockNum', async (req, res) => {
    if (!peerSync) {
      return res.status(501).json({ error: 'Sync not enabled' });
    }

    try {
      const blockNum = parseInt(req.params.blockNum);
      const consensus = await peerSync.checkBlockConsensus(blockNum);
      
      if (!consensus) {
        return res.status(404).json({ 
          error: 'No consensus found',
          blockNum 
        });
      }

      res.json({
        blockNum,
        consensus
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Export list of known peers (for peer discovery)
  router.get('/peers', (req, res) => {
    const peers = peerSync ? 
      Array.from(peerSync.peers.values())
        .filter(p => p.isAlive)
        .map(p => ({ id: p.id, url: p.url })) : 
      [];
    
    res.json(peers);
  });

  return router;
}