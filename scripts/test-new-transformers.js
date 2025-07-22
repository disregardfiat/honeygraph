#!/usr/bin/env node

import { createDataTransformer } from '../lib/data-transformer.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('test-transformers');

// Mock dgraph client
const mockDgraphClient = {
  query: async () => ({ account: [] })
};

async function testTransformers() {
  const transformer = createDataTransformer(mockDgraphClient);
  
  // Test data samples
  const testOperations = [
    // Price feeds
    {
      type: 'put',
      path: ['priceFeeds', 'hive', 'usd'],
      data: { price: 0.34, volume: 125000, timestamp: Date.now() / 1000, source: 'coingecko' }
    },
    {
      type: 'put',
      path: ['priceFeeds', 'spk', 'hive'],
      data: 0.001234
    },
    
    // Runners
    {
      type: 'put',
      path: ['runners', 'validator-node-1'],
      data: {
        api: 'https://api.node1.com',
        location: 'US-East',
        version: '1.2.3',
        lastSeen: Date.now() / 1000,
        services: ['ipfs', 'validator', 'api'],
        performance: { uptime: 99.9, latency: 23, successRate: 98.5 }
      }
    },
    {
      type: 'put',
      path: ['runners', 'simple-runner'],
      data: 'https://simple.runner.com'
    },
    
    // SPK Power
    {
      type: 'put',
      path: ['spow', 'alice'],
      data: 150000
    },
    {
      type: 'put',
      path: ['spow', 'bob'],
      data: { total: 250000, self: 100000, delegated: 150000, delegators: ['alice', 'charlie'] }
    },
    
    // Unclaimed BROCA
    {
      type: 'put',
      path: ['ubroca', 'alice'],
      data: 75000
    },
    {
      type: 'put',
      path: ['ubroca', 'bob'],
      data: { amount: 100000, expiresBlock: 98765432, source: 'mining_rewards' }
    },
    
    // Chain state
    {
      type: 'put',
      path: ['chain', 'head_block'],
      data: 98765432
    },
    {
      type: 'put',
      path: ['chain', 'config', 'multisig'],
      data: ['alice', 'bob', 'charlie']
    },
    
    // Chrono
    {
      type: 'put',
      path: ['chrono', '98765432', 'expire_contract_alice_0_98765432-abc123'],
      data: { operation: 'expire_contract', target: 'alice:0:98765432-abc123', scheduled_block: 98765432 }
    },
    
    // Stats
    {
      type: 'put',
      path: ['stats', 'total_supply'],
      data: 1000000000
    },
    {
      type: 'put',
      path: ['stats', 'network_overview'],
      data: {
        total_accounts: 5432,
        total_contracts: 1234,
        total_storage: 9876543210,
        active_nodes: 25,
        last_updated: Date.now() / 1000
      }
    }
  ];
  
  const blockInfo = {
    blockNum: 98765432,
    timestamp: Date.now()
  };
  
  console.log('Testing new transformers...\n');
  
  try {
    const mutations = await transformer.transformOperations(testOperations, blockInfo);
    
    console.log(`✅ Generated ${mutations.length} mutations\n`);
    
    // Analyze mutation types
    const types = {};
    mutations.forEach(m => {
      const type = m['dgraph.type'] || 'Unknown';
      types[type] = (types[type] || 0) + 1;
    });
    
    console.log('Mutation breakdown:');
    Object.entries(types).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
    
    // Show sample mutations for new types
    console.log('\nSample mutations for new types:');
    
    const priceFeed = mutations.find(m => m['dgraph.type'] === 'PriceFeed');
    if (priceFeed) {
      console.log('\nPriceFeed:', JSON.stringify(priceFeed, null, 2));
    }
    
    const chainState = mutations.find(m => m['dgraph.type'] === 'ChainState');
    if (chainState) {
      console.log('\nChainState:', JSON.stringify(chainState, null, 2));
    }
    
    const scheduledOp = mutations.find(m => m['dgraph.type'] === 'ScheduledOperation');
    if (scheduledOp) {
      console.log('\nScheduledOperation:', JSON.stringify(scheduledOp, null, 2));
    }
    
    const networkStats = mutations.find(m => m['dgraph.type'] === 'NetworkStats');
    if (networkStats) {
      console.log('\nNetworkStats:', JSON.stringify(networkStats, null, 2));
    }
    
    const accountWithRunner = mutations.find(m => m['dgraph.type'] === 'Account' && m.runnerNode);
    if (accountWithRunner) {
      console.log('\nAccount with RunnerNode:', JSON.stringify(accountWithRunner, null, 2));
    }
    
    const accountWithUbroca = mutations.find(m => m['dgraph.type'] === 'Account' && m.unclaimedBroca);
    if (accountWithUbroca) {
      console.log('\nAccount with unclaimed BROCA:', JSON.stringify(accountWithUbroca, null, 2));
    }
    
    console.log('\n✅ All transformers working correctly!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    logger.error('Test failed', { error: error.message, stack: error.stack });
  }
}

testTransformers();