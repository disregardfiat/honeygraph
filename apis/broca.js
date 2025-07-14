/**
 * BROCA Token API Routes
 */

module.exports = function(router, tokenManager) {
  const token = tokenManager.getToken('BROCA');
  const namespace = token.getPathwiseNamespace();
  
  // Balance endpoint
  router.get('/broca/balance/:account', async (req, res) => {
    try {
      const balance = await namespace.getBalance(req.params.account);
      res.json(balance);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Transfers endpoint
  router.get('/broca/transfers', async (req, res) => {
    try {
      const { account, limit = 100, offset = 0 } = req.query;
      const transfers = await namespace.getTransfers({ account, limit, offset });
      res.json(transfers);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Rich list endpoint
  router.get('/broca/richlist', async (req, res) => {
    try {
      const { limit = 100 } = req.query;
      const richlist = await namespace.getRichList(limit);
      res.json(richlist);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};