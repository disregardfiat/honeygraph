/**
 * GraphQL Resolvers for Honeycomb API
 * Maps GraphQL queries to Dgraph queries for token-specific data
 */

import { GraphQLScalarType, Kind } from 'graphql';

// Custom JSON scalar type
const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'JSON custom scalar type',
  parseValue: (value) => value,
  serialize: (value) => value,
  parseLiteral: (ast) => {
    if (ast.kind === Kind.OBJECT) {
      return parseObject(ast);
    }
    return null;
  }
});

function parseObject(ast) {
  const value = Object.create(null);
  ast.fields.forEach((field) => {
    value[field.name.value] = parseLiteral(field.value);
  });
  return value;
}

function parseLiteral(ast) {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
    case Kind.FLOAT:
      return parseFloat(ast.value);
    case Kind.OBJECT:
      return parseObject(ast);
    case Kind.LIST:
      return ast.values.map(parseLiteral);
    default:
      return null;
  }
}

export function createGraphQLResolvers(multiTokenManager) {
  return {
    JSON: JSONScalar,
    
    Query: {
      token: async (parent, { symbol }) => {
        // Validate token exists
        if (!multiTokenManager.getTokenSymbols().includes(symbol.toUpperCase())) {
          throw new Error(`Token ${symbol} not found`);
        }
        return { symbol: symbol.toUpperCase() };
      },
      
      allTokens: async () => {
        const tokens = multiTokenManager.getTokenSymbols();
        return tokens.map(symbol => ({ symbol }));
      }
    },
    
    TokenQuery: {
      info: async ({ symbol }) => {
        const dgraphClient = multiTokenManager.getDgraphClient(symbol);
        const token = multiTokenManager.getToken(symbol);
        const config = token.getConfig();
        
        // Query token info from state
        const query = `
          query {
            info(func: eq(State.path, "@${symbol.toLowerCase()}:info")) {
              State.value
            }
            supply(func: eq(State.path, "@${symbol.toLowerCase()}:supply")) {
              State.value
            }
          }
        `;
        
        const result = await dgraphClient.query(query);
        
        return {
          symbol,
          name: config.name || `${symbol} Token`,
          precision: 3,
          maxSupply: result.info?.[0]?.['State.value']?.maxSupply || "0",
          currentSupply: result.supply?.[0]?.['State.value'] || "0",
          icon: config.icon,
          description: config.description
        };
      },
      
      stats: async ({ symbol }) => {
        const dgraphClient = multiTokenManager.getDgraphClient(symbol);
        
        const query = `
          query {
            stats(func: eq(State.path, "@${symbol.toLowerCase()}:stats")) {
              State.value
            }
            lastBlock(func: type(Block)) @filter(eq(namespace, "${symbol.toLowerCase()}")) {
              Block.number
              Block.hash
            } (orderdesc: Block.number, first: 1)
          }
        `;
        
        const result = await dgraphClient.query(query);
        const stats = result.stats?.[0]?.['State.value'] || {};
        const lastBlock = result.lastBlock?.[0] || {};
        
        return {
          hashLastIBlock: lastBlock['Block.hash'] || "",
          lastIBlock: lastBlock['Block.number'] || 0,
          lastBlock: lastBlock['Block.number'] || 0,
          tokenSupply: stats.supply || "0",
          interestRate: stats.interestRate || 0,
          nodeQty: stats.nodes || 0,
          userCount: stats.users || 0,
          marketCap: stats.marketCap,
          volume24h: stats.volume24h,
          behind: 0,
          realtime: true
        };
      },
      
      user: async ({ symbol }, { username }) => {
        const dgraphClient = multiTokenManager.getDgraphClient(symbol);
        
        const query = `
          query {
            balance(func: eq(State.path, "@${symbol.toLowerCase()}:${username}")) {
              State.value
            }
            power(func: eq(State.path, "@${symbol.toLowerCase()}:power:${username}")) {
              State.value
            }
            gov(func: eq(State.path, "@${symbol.toLowerCase()}:gov:${username}")) {
              State.value
            }
          }
        `;
        
        const result = await dgraphClient.query(query);
        
        if (!result.balance?.[0]) return null;
        
        return {
          username,
          balance: result.balance[0]['State.value'] || "0",
          poweredUp: result.power?.[0]?.['State.value']?.amount || "0",
          poweringDown: result.power?.[0]?.['State.value']?.down || "0",
          delegatedTo: result.power?.[0]?.['State.value']?.delegatedTo || "0",
          delegatedFrom: result.power?.[0]?.['State.value']?.delegatedFrom || "0",
          gov: result.gov?.[0]?.['State.value']
        };
      },
      
      dex: async ({ symbol }) => {
        const dgraphClient = multiTokenManager.getDgraphClient(symbol);
        
        const query = `
          query {
            dex(func: eq(State.path, "@${symbol.toLowerCase()}:dex")) {
              State.value
            }
          }
        `;
        
        const result = await dgraphClient.query(query);
        const dex = result.dex?.[0]?.['State.value'] || {};
        
        return {
          hive: dex.hive || { tick: "0", sellOrders: [], buyOrders: [], history: [] },
          hbd: dex.hbd || { tick: "0", sellOrders: [], buyOrders: [], history: [] },
          stats: {
            volume24h: dex.stats?.volume24h || "0",
            trades24h: dex.stats?.trades24h || 0,
            uniqueTraders24h: dex.stats?.uniqueTraders24h || 0
          }
        };
      },
      
      orderbook: async ({ symbol }, { pair, depth = 50 }) => {
        const dgraphClient = multiTokenManager.getDgraphClient(symbol);
        
        const query = `
          query {
            dex(func: eq(State.path, "@${symbol.toLowerCase()}:dex")) {
              State.value
            }
          }
        `;
        
        const result = await dgraphClient.query(query);
        const dex = result.dex?.[0]?.['State.value'] || {};
        const marketPair = pair.toLowerCase();
        const market = dex[marketPair] || {};
        
        // Format orderbook
        const asks = Object.values(market.sellOrders || {})
          .sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate))
          .slice(0, depth)
          .map(order => [order.rate, (parseFloat(order.amount) / 1000).toFixed(3)]);
          
        const bids = Object.values(market.buyOrders || {})
          .sort((a, b) => parseFloat(b.rate) - parseFloat(a.rate))
          .slice(0, depth)
          .map(order => [order.rate, (parseFloat(order.amount) / 1000).toFixed(3)]);
        
        return {
          tickerId: `${pair}_${symbol}`,
          timestamp: new Date(),
          asks,
          bids
        };
      },
      
      posts: async ({ symbol }) => {
        const dgraphClient = multiTokenManager.getDgraphClient(symbol);
        
        const query = `
          query {
            posts(func: eq(State.path, "@${symbol.toLowerCase()}:posts")) {
              State.value
            }
          }
        `;
        
        const result = await dgraphClient.query(query);
        const posts = result.posts?.[0]?.['State.value'] || {};
        
        return {
          count: Object.keys(posts).length,
          promoted: Object.values(posts).filter(p => p.promoted).length,
          trending: Object.values(posts).filter(p => p.trending).length,
          lastUpdate: new Date()
        };
      },
      
      post: async ({ symbol }, { author, permlink }) => {
        const dgraphClient = multiTokenManager.getDgraphClient(symbol);
        
        const query = `
          query {
            post(func: eq(State.path, "@${symbol.toLowerCase()}:posts:${author}:${permlink}")) {
              State.value
            }
          }
        `;
        
        const result = await dgraphClient.query(query);
        const post = result.post?.[0]?.['State.value'];
        
        if (!post) return null;
        
        return {
          author,
          permlink,
          title: post.title,
          body: post.body,
          tags: post.tags || [],
          created: new Date(post.created),
          promoted: post.promoted || "0",
          votes: post.votes || 0,
          comments: post.comments || 0,
          payout: post.payout || "0"
        };
      },
      
      nfts: async ({ symbol }, { user }) => {
        const dgraphClient = multiTokenManager.getDgraphClient(symbol);
        
        const query = `
          query {
            nfts(func: eq(State.path, "@${symbol.toLowerCase()}:nfts${user ? ':' + user : ''}")) {
              State.value
            }
          }
        `;
        
        const result = await dgraphClient.query(query);
        const nfts = result.nfts?.[0]?.['State.value'] || {};
        
        if (user) {
          return {
            user,
            count: Object.keys(nfts).length,
            items: Object.entries(nfts).map(([uid, item]) => ({
              uid,
              ...item
            })),
            sets: [...new Set(Object.values(nfts).map(item => item.set))]
          };
        }
        
        return nfts;
      },
      
      sets: async ({ symbol }) => {
        const dgraphClient = multiTokenManager.getDgraphClient(symbol);
        
        const query = `
          query {
            sets(func: eq(State.path, "@${symbol.toLowerCase()}:sets")) {
              State.value
            }
          }
        `;
        
        const result = await dgraphClient.query(query);
        const sets = result.sets?.[0]?.['State.value'] || {};
        
        return Object.entries(sets).map(([name, set]) => ({
          name,
          ...set
        }));
      },
      
      markets: async ({ symbol }) => {
        const dgraphClient = multiTokenManager.getDgraphClient(symbol);
        
        const query = `
          query {
            nodes(func: eq(State.path, "@${symbol.toLowerCase()}:markets:node")) {
              State.value
            }
            consensus(func: eq(State.path, "@${symbol.toLowerCase()}:consensus")) {
              State.value
            }
          }
        `;
        
        const result = await dgraphClient.query(query);
        const nodes = result.nodes?.[0]?.['State.value'] || {};
        const consensus = result.consensus?.[0]?.['State.value'] || {};
        
        return {
          nodes: Object.entries(nodes).map(([account, node]) => ({
            account,
            ...node
          })),
          consensus: {
            round: consensus.round || 0,
            hash: consensus.hash || "",
            agreeing: consensus.agreeing || [],
            disagreeing: consensus.disagreeing || []
          }
        };
      },
      
      txStatus: async ({ symbol }, { txid }) => {
        const dgraphClient = multiTokenManager.getDgraphClient(symbol);
        
        const query = `
          query {
            tx(func: eq(Transaction.id, "${txid}")) @filter(eq(namespace, "${symbol.toLowerCase()}")) {
              Transaction.status
              Transaction.block
              Transaction.error
              Transaction.result
            }
          }
        `;
        
        const result = await dgraphClient.query(query);
        const tx = result.tx?.[0];
        
        if (!tx) {
          return {
            txid,
            status: 'PENDING',
            block: null,
            error: null,
            result: null
          };
        }
        
        return {
          txid,
          status: tx['Transaction.status'],
          block: tx['Transaction.block'],
          error: tx['Transaction.error'],
          result: tx['Transaction.result']
        };
      }
    },
    
    // Nested resolvers for complex types
    User: {
      nfts: async (user, args, { symbol }) => {
        // Resolve user's NFTs
        const dgraphClient = multiTokenManager.getDgraphClient(symbol);
        const query = `
          query {
            nfts(func: eq(State.path, "@${symbol.toLowerCase()}:nfts:${user.username}")) {
              State.value
            }
          }
        `;
        const result = await dgraphClient.query(query);
        const nfts = result.nfts?.[0]?.['State.value'] || {};
        
        return {
          user: user.username,
          count: Object.keys(nfts).length,
          items: Object.entries(nfts).map(([uid, item]) => ({
            uid,
            ...item
          })),
          sets: [...new Set(Object.values(nfts).map(item => item.set))]
        };
      },
      
      posts: async (user, args, { symbol }) => {
        // Resolve user's posts
        const dgraphClient = multiTokenManager.getDgraphClient(symbol);
        const query = `
          query {
            posts(func: eq(State.path, "@${symbol.toLowerCase()}:posts")) {
              State.value
            }
          }
        `;
        const result = await dgraphClient.query(query);
        const allPosts = result.posts?.[0]?.['State.value'] || {};
        
        return Object.values(allPosts)
          .filter(post => post.author === user.username)
          .map(post => ({
            author: user.username,
            ...post
          }));
      }
    }
  };
}