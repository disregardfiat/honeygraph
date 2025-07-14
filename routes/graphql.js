import { Router } from 'express';
import { createHandler } from 'graphql-http/lib/use/express';
import expressPlayground from 'graphql-playground-middleware-express';
import { buildSchema } from 'graphql';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createGraphQLResolvers } from '../lib/graphql-resolvers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Create GraphQL routes for honeygraph
 * Provides a unified GraphQL API for all token data
 */
export function createGraphQLRoutes({ multiTokenManager }) {
  const router = Router();
  
  // Load GraphQL schema
  let schema;
  let schemaLoaded = false;
  
  async function loadSchema() {
    if (!schemaLoaded) {
      try {
        const schemaPath = path.join(__dirname, '../schema/honeycomb-api.graphql');
        const schemaString = await fs.readFile(schemaPath, 'utf8');
        schema = buildSchema(schemaString);
        schemaLoaded = true;
      } catch (error) {
        console.error('Failed to load GraphQL schema:', error);
        throw error;
      }
    }
    return schema;
  }
  
  // Create resolvers
  const rootResolver = createGraphQLResolvers(multiTokenManager);
  
  // Initialize GraphQL handler
  let graphqlHandler;
  
  async function initializeHandler() {
    if (!graphqlHandler) {
      await loadSchema();
      graphqlHandler = createHandler({
        schema,
        rootValue: rootResolver,
        context: async (req) => ({
          multiTokenManager,
          req
        }),
        formatError: (error) => {
          console.error('GraphQL Error:', error);
          return {
            message: error.message,
            locations: error.locations,
            path: error.path,
            extensions: {
              code: error.originalError?.extensions?.code || 'INTERNAL_ERROR',
              exception: process.env.NODE_ENV !== 'production' ? {
                stacktrace: error.stack?.split('\n')
              } : undefined
            }
          };
        }
      });
    }
    return graphqlHandler;
  }
  
  // GraphQL endpoint
  router.all('/', async (req, res, next) => {
    try {
      const handler = await initializeHandler();
      handler(req, res, next);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to initialize GraphQL endpoint',
        message: error.message
      });
    }
  });
  
  // GraphQL Playground endpoint (development only)
  if (process.env.NODE_ENV !== 'production') {
    router.get('/playground', expressPlayground.default({ endpoint: '/api/graphql' }));
  }
  
  // GraphQL schema introspection endpoint (useful for development)
  router.get('/schema', async (req, res) => {
    try {
      const schemaPath = path.join(__dirname, '../schema/honeycomb-api.graphql');
      const schemaString = await fs.readFile(schemaPath, 'utf8');
      res.type('text/plain').send(schemaString);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to read schema',
        message: error.message
      });
    }
  });
  
  return router;
}

/**
 * Create token-specific GraphQL endpoint
 * Each token can have its own GraphQL endpoint with custom schema
 */
export function createTokenGraphQLRoutes({ token, dgraphClient }) {
  const router = Router();
  
  // Token-specific GraphQL endpoint
  router.use('/', async (req, res, next) => {
    try {
      // Load token-specific schema if available
      const baseSchemaPath = path.join(__dirname, '../schema/honeycomb-api.graphql');
      const customSchemaPath = path.join(__dirname, '../schema/custom', `${token.toLowerCase()}-api.graphql`);
      
      let schemaString = await fs.readFile(baseSchemaPath, 'utf8');
      
      // Try to load custom schema
      try {
        const customSchema = await fs.readFile(customSchemaPath, 'utf8');
        schemaString += '\n\n' + customSchema;
      } catch (err) {
        // No custom schema, use base only
      }
      
      const schema = buildSchema(schemaString);
      
      // Create token-specific resolvers
      const rootResolver = {
        Query: {
          info: async () => {
            const query = `
              query {
                info(func: eq(State.path, "@${token.toLowerCase()}:info")) {
                  State.value
                }
              }
            `;
            const result = await dgraphClient.query(query);
            return result.info?.[0]?.['State.value'] || {};
          },
          
          user: async (args) => {
            const { username } = args;
            const query = `
              query {
                balance(func: eq(State.path, "@${token.toLowerCase()}:${username}")) {
                  State.value
                }
              }
            `;
            const result = await dgraphClient.query(query);
            
            if (!result.balance?.[0]) return null;
            
            return {
              username,
              balance: result.balance[0]['State.value'] || "0"
            };
          },
          
          dex: async () => {
            const query = `
              query {
                dex(func: eq(State.path, "@${token.toLowerCase()}:dex")) {
                  State.value
                }
              }
            `;
            const result = await dgraphClient.query(query);
            return result.dex?.[0]?.['State.value'] || {};
          }
        }
      };
      
      const handler = createHandler({
        schema,
        rootValue: rootResolver
      });
      
      handler(req, res, next);
      
    } catch (error) {
      res.status(500).json({
        error: 'Failed to initialize token GraphQL endpoint',
        message: error.message
      });
    }
  });
  
  return router;
}