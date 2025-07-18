import { Router } from 'express';

export function createSPKRoutes({ dgraphClient, dataTransformer, schemas, validate }) {
  const router = Router();

  // Get user's complete profile with all related data
  router.get('/user/:username', async (req, res) => {
    try {
      const { username } = req.params;
      const { include = 'all' } = req.query;
      
      let query = `
        query getUser($username: string) {
          user(func: eq(username, $username)) {
            username
            larynxBalance
            spkBalance
            brocaBalance
            liquidBroca
            power
            powerGranted
      `;
      
      if (include === 'all' || include.includes('contracts')) {
        query += `
            contracts @facets {
              id
              price
              duration
              status
              expiresBlock
              files: dataFiles
              storageNodes {
                username
              }
            }
            contractsStoring @facets {
              id
              owner {
                username
              }
              status
              expiresBlock
            }
        `;
      }
      
      if (include === 'all' || include.includes('services')) {
        query += `
            services {
              id
              type
              endpoint
              active
              uptime
            }
            serviceEndpoints {
              url
              healthy
              lastCheck
            }
        `;
      }
      
      if (include === 'all' || include.includes('files')) {
        query += `
            files(first: 100) @facets {
              cid
              name
              size
              path
              tags
              uploadedAt
            }
        `;
      }
      
      if (include === 'all' || include.includes('market')) {
        query += `
            nodeMarket {
              bidRate
              bidAmount
              wins
              attempts
            }
            dexOrders(first: 50) @filter(eq(status, "OPEN")) {
              id
              pair
              type
              rate
              amount
              filled
              status
            }
        `;
      }
      
      if (include === 'all' || include.includes('delegations')) {
        query += `
            delegationsOut {
              to {
                username
              }
              amount
              vestsPerDay
            }
            delegationsIn {
              from {
                username
              }
              amount
              vestsPerDay
            }
        `;
      }
      
      query += `
          }
        }
      `;
      
      const vars = { $username: username };
      const result = await dgraphClient.client.newTxn().queryWithVars(query, vars);
      const data = result.getJson();
      
      if (!data.user || data.user.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      res.json(data.user[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get user's file system
  router.get('/fs/:username/*', async (req, res) => {
    try {
      const { username } = req.params;
      const path = '/' + (req.params[0] || '');
      
      const result = await dataTransformer.getFileSystemView(username, path);
      
      res.json({
        username,
        path,
        entries: result.entries || []
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Search files across the network
  router.get('/files/search', async (req, res) => {
    try {
      const { q, tags, owner, limit = 50 } = req.query;
      
      let filters = [];
      if (q) filters.push(`anyoftext(name, "${q}")`);
      if (tags) filters.push(`anyofterms(tags, "${tags}")`);
      if (owner) filters.push(`eq(owner.username, "${owner}")`);
      
      const query = `
        query searchFiles {
          files(func: type(File), first: ${limit}) 
            ${filters.length ? `@filter(${filters.join(' AND ')})` : ''} {
            cid
            name
            size
            path
            tags
            owner {
              username
            }
            contract {
              expiresBlock
              status
            }
            uploadedAt
          }
        }
      `;
      
      const result = await dgraphClient.client.newTxn().query(query);
      res.json(result.getJson());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get storage network statistics
  router.get('/storage/stats', async (req, res) => {
    try {
      const query = `
        {
          totalFiles: count(func: type(File))
          totalContracts: count(func: type(StorageContract))
          activeContracts: count(func: type(StorageContract)) @filter(eq(status, "ACTIVE"))
          totalNodes: count(func: type(StorageNode))
          
          topNodes(func: type(StorageNode), orderdesc: reliability, first: 10) {
            account {
              username
            }
            reliability
            uptime
            rewardsEarned
          }
          
          recentFiles(func: type(File), orderdesc: uploadedAt, first: 10) {
            cid
            name
            size
            owner {
              username
            }
            uploadedAt
          }
        }
      `;
      
      const result = await dgraphClient.client.newTxn().query(query);
      res.json(result.getJson());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get DEX market data
  router.get('/dex/:pair', async (req, res) => {
    try {
      const { pair } = req.params;
      const { depth = 20 } = req.query;
      
      const query = `
        query getMarket($pair: string) {
          buyOrders: orders(func: type(DexOrder), orderdesc: rate, first: ${depth}) 
            @filter(eq(pair, $pair) AND eq(type, "BUY") AND eq(status, "OPEN")) {
            rate
            amount
            filled
            owner {
              username
            }
          }
          
          sellOrders: orders(func: type(DexOrder), orderasc: rate, first: ${depth}) 
            @filter(eq(pair, $pair) AND eq(type, "SELL") AND eq(status, "OPEN")) {
            rate
            amount
            filled
            owner {
              username
            }
          }
          
          recentTrades: fills(func: type(OrderFill), orderdesc: timestamp, first: 50) 
            @filter(eq(order.pair, $pair)) {
            amount
            rate
            timestamp
            order {
              type
            }
            counterparty {
              username
            }
          }
          
          pool: pool(func: eq(pair, $pair)) {
            token0Reserve
            token1Reserve
            totalShares
            tvl
            volume24h
            apy
          }
        }
      `;
      
      const vars = { $pair: pair };
      const result = await dgraphClient.client.newTxn().queryWithVars(query, vars);
      res.json(result.getJson());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get rich list
  router.get('/richlist/:token', async (req, res) => {
    try {
      const { token } = req.params;
      const { limit = 100 } = req.query;
      
      let field;
      switch (token.toLowerCase()) {
        case 'larynx':
          field = 'larynxBalance';
          break;
        case 'spk':
          field = 'spkBalance';
          break;
        case 'power':
          field = 'power';
          break;
        default:
          return res.status(400).json({ error: 'Invalid token' });
      }
      
      const query = `
        query getRichList {
          richlist(func: type(Account), orderdesc: ${field}, first: ${limit}) {
            username
            ${field}
            ${field === 'power' ? 'powerGranted' : ''}
          }
        }
      `;
      
      const result = await dgraphClient.client.newTxn().query(query);
      res.json(result.getJson());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get governance proposals
  router.get('/governance/proposals', async (req, res) => {
    try {
      const { status = 'PENDING', limit = 50 } = req.query;
      
      const query = `
        query getProposals($status: string) {
          proposals(func: type(Proposal), first: ${limit}) 
            @filter(eq(status, $status)) {
            id
            type
            title
            description
            proposer {
              username
            }
            approvals: count(approvals)
            rejections: count(rejections)
            threshold
            status
            createdAt
            expiresAt
          }
        }
      `;
      
      const vars = { $status: status };
      const result = await dgraphClient.client.newTxn().queryWithVars(query, vars);
      res.json(result.getJson());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get network statistics
  router.get('/network/stats', async (req, res) => {
    try {
      const query = `
        {
          supply: sum(func: type(Account)) {
            totalLarynx: sum(larynxBalance)
            totalSPK: sum(spkBalance)
            totalPower: sum(power)
          }
          
          activeNodes: count(func: type(NodeMarket))
          activeContracts: count(func: type(StorageContract)) @filter(eq(status, "ACTIVE"))
          totalStorage: sum(func: type(File)) {
            total: sum(size)
          }
          
          dexVolume: sum(func: type(OrderFill)) @filter(ge(timestamp, "2024-01-01")) {
            volume: sum(amount)
          }
        }
      `;
      
      const result = await dgraphClient.client.newTxn().query(query);
      const data = result.getJson();
      
      res.json({
        supply: {
          larynx: data.supply?.[0]?.totalLarynx || 0,
          spk: data.supply?.[0]?.totalSPK || 0,
          power: data.supply?.[0]?.totalPower || 0
        },
        network: {
          activeNodes: data.activeNodes?.[0]?.count || 0,
          activeContracts: data.activeContracts?.[0]?.count || 0,
          totalStorage: data.totalStorage?.[0]?.total || 0
        },
        dex: {
          volume24h: data.dexVolume?.[0]?.volume || 0
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get storage providers for a specific file
  router.get('/file/:cid/providers', async (req, res) => {
    try {
      const { cid } = req.params;
      
      const query = `
        query getFileProviders($cid: string) {
          file(func: eq(cid, $cid)) {
            cid
            name
            size
            owner {
              username
            }
            contract {
              id
              status
              storageNodes {
                username
                services @filter(eq(type, "IPFS_GATEWAY") OR eq(type, "IPFS_PINNING")) {
                  type
                  endpoint
                  uptime
                }
                storageNode {
                  reliability
                  uptime
                }
              }
            }
          }
        }
      `;
      
      const vars = { $cid: cid };
      const result = await dgraphClient.client.newTxn().queryWithVars(query, vars);
      res.json(result.getJson());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Find service providers by type
  router.get('/services/:type/providers', async (req, res) => {
    try {
      const { type } = req.params;
      const { minUptime = 0.9, limit = 50 } = req.query;
      
      const query = `
        query getServiceProviders($type: string, $minUptime: float) {
          providers(func: type(Service), first: ${limit}) 
            @filter(eq(type, $type) AND ge(uptime, $minUptime) AND eq(active, true)) {
            provider {
              username
              larynxBalance
              contractsStoring: count(contractsStoring)
            }
            type
            endpoint
            uptime
            reliability
            endpoints {
              url
              region
              healthy
              responseTime
            }
          }
        }
      `;
      
      const vars = { 
        $type: type.toUpperCase(),
        $minUptime: parseFloat(minUptime)
      };
      const result = await dgraphClient.client.newTxn().queryWithVars(query, vars);
      res.json(result.getJson());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get accounts storing files for a specific owner
  router.get('/storage-providers/:owner', async (req, res) => {
    try {
      const { owner } = req.params;
      
      const query = `
        query getStorageProviders($owner: string) {
          user(func: eq(username, $owner)) {
            username
            contracts {
              id
              status
              storageNodes {
                username
                contractsStoring: count(contractsStoring)
                services @filter(eq(active, true)) {
                  type
                  endpoint
                }
                storageNode {
                  reliability
                  uptime
                  rewardsEarned
                }
              }
            }
          }
        }
      `;
      
      const vars = { $owner: owner };
      const result = await dgraphClient.client.newTxn().queryWithVars(query, vars);
      res.json(result.getJson());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Network topology - who stores for whom
  router.get('/network/topology', async (req, res) => {
    try {
      const { limit = 100 } = req.query;
      
      const query = `
        {
          storageRelations(func: type(StorageContract), first: ${limit}) 
            @filter(eq(status, "ACTIVE")) {
            owner {
              username
            }
            storageNodes {
              username
              services {
                type
              }
            }
            totalSize: sum(files) {
              size
            }
          }
          
          serviceMap(func: type(Service)) @groupby(type) {
            count(uid)
          }
        }
      `;
      
      const result = await dgraphClient.client.newTxn().query(query);
      res.json(result.getJson());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}