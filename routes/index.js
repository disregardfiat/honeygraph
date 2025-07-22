import { Router } from 'express';
import Joi from 'joi';
import { createReplicationRoutes } from './replication.js';
import { createQueryRoutes } from './query.js';
import { createAdminRoutes } from './admin.js';
import { createCheckpointRoutes } from './checkpoints.js';
import { createSyncRoutes } from './sync.js';
import { createSPKRoutes } from './spk.js';
import { createFileSystemRoutes } from './filesystem.js';
import { createMultiTokenRoutes } from './multi-token.js';
import { createGraphQLRoutes } from './graphql.js';
import { createDataTransformer } from '../lib/data-transformer.js';
import { createAuthRoutes } from './auth.js';
import { authenticateHiveNode } from '../middleware/hive-auth.js';

// Validation schemas
const schemas = {
  blockData: Joi.object({
    blockNum: Joi.number().integer().min(0).required(),
    blockHash: Joi.string().required(),
    previousHash: Joi.string().allow(null),
    expectedHash: Joi.string(),
    lib: Joi.number().integer().min(0).required(),
    isLib: Joi.boolean()
  }),
  
  operation: Joi.object({
    type: Joi.string().valid('put', 'del', 'batch', 'checkpoint').required(),
    path: Joi.array().items(Joi.string()).required(),
    data: Joi.any(),
    previousValue: Joi.any()
  }),
  
  consensusData: Joi.object({
    blockNum: Joi.number().integer().min(0).required(),
    consensusHash: Joi.string().required(),
    agreedNodes: Joi.array().items(Joi.string()).required()
  }),
  
  queryOptions: Joi.object({
    fork: Joi.string().allow(null),
    beforeBlock: Joi.number().integer().min(0).allow(null),
    includeHistory: Joi.boolean().default(false)
  })
};

// Validation middleware
export function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        error: 'Validation error', 
        details: error.details.map(d => d.message) 
      });
    }
    req.body = value;
    next();
  };
}

export function createRouter({ dgraphClient, forkManager, replicationQueue, zfsCheckpoints, peerSync, networkManager }) {
  const router = Router();
  const dataTransformer = createDataTransformer(dgraphClient, networkManager);

  // Authentication routes (no auth required for these)
  router.use('/auth', createAuthRoutes({ dgraphClient }));
  
  // Apply Hive authentication middleware to protected routes if enabled
  const hiveAuth = authenticateHiveNode({ 
    requireAuthorization: process.env.REQUIRE_HIVE_AUTH === 'true' 
  });

  // NOTE: HTTP replication endpoints removed - data streaming happens via WebSocket at /fork-stream
  // router.use('/replicate', hiveAuth, createReplicationRoutes({ 
  //   dgraphClient, 
  //   forkManager, 
  //   replicationQueue,
  //   schemas,
  //   validate 
  // }));
  
  router.use('/query', createQueryRoutes({ 
    dgraphClient, 
    forkManager,
    schemas,
    validate 
  }));
  
  router.use('/admin', createAdminRoutes({ 
    dgraphClient, 
    forkManager, 
    replicationQueue,
    schemas,
    validate 
  }));
  
  router.use('/checkpoints', createCheckpointRoutes({ 
    zfsCheckpoints,
    forkManager,
    dgraphClient,
    schemas,
    validate 
  }));
  
  router.use('/sync', createSyncRoutes({ 
    peerSync,
    dgraphClient,
    forkManager,
    schemas,
    validate 
  }));
  
  router.use('/spk', createSPKRoutes({ 
    dgraphClient,
    dataTransformer,
    schemas,
    validate 
  }));
  
  // Network-based multi-token routes (if manager is provided)
  if (networkManager) {
    const multiTokenRouter = createMultiTokenRoutes({
      networkManager,
      schemas,
      validate
    });
    
    // Mount both /token and /network routes
    router.use('/', multiTokenRouter);
    
    // GraphQL endpoint
    router.use('/graphql', createGraphQLRoutes({
      networkManager
    }));
  }

  // Root endpoint
  router.get('/', (req, res) => {
    res.json({
      service: 'honeygraph',
      version: '1.0.0',
      endpoints: {
        replication: '/api/replicate',
        query: '/api/query',
        admin: '/api/admin',
        health: '/health',
        networks: networkManager ? '/api/networks' : undefined,
        tokens: networkManager ? '/api/tokens' : undefined,
        networkInfo: networkManager ? '/api/network/{prefix}/info' : undefined,
        tokenInfo: networkManager ? '/api/token/{token}/info' : undefined,
        networkQuery: networkManager ? '/api/network/{prefix}/query' : undefined,
        tokenQuery: networkManager ? '/api/token/{token}/query' : undefined,
        graphql: networkManager ? '/api/graphql' : undefined
      }
    });
  });

  return router;
}