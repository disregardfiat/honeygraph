#!/usr/bin/env node

import { DgraphClient } from '../lib/dgraph-client.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('query-check');
const dgraphClient = new DgraphClient({
  url: process.env.DGRAPH_URL || 'http://dgraph-alpha:9080',
  namespace: 'spkccT_',
  logger
});

const query = process.argv[2];
if (!query) {
  console.error('Usage: node query-check.js "<query>"');
  process.exit(1);
}

dgraphClient.query(query).then(result => {
  console.log(JSON.stringify(result, null, 2));
}).catch(err => {
  console.error('Query error:', err.message);
});