// Jest setup file for Honeygraph tests

import { jest } from '@jest/globals';
import { createMockExec, getTestEnvironment, cleanupZFSSnapshots, cleanupRedisQueues } from './utils/test-helpers.js';

// Global test timeout
jest.setTimeout(30000);

// Mock console methods to reduce noise during tests
const originalConsole = global.console;
global.console = {
  ...console,
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: originalConsole.error, // Keep error for debugging
  debug: jest.fn()
};

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT || '6379';
process.env.DGRAPH_ALPHA_URL = process.env.DGRAPH_ALPHA_URL || 'localhost:9080';
process.env.ZFS_DATASET = process.env.ZFS_DATASET || 'testpool/honeygraph';

// Detect test environment
const testEnv = getTestEnvironment();
console.log('Test environment:', testEnv);

// Global mock for child_process.exec
const mockExec = createMockExec();

// Mock child_process module globally
jest.unstable_mockModule('child_process', () => ({
  exec: mockExec,
  execSync: jest.fn().mockReturnValue(''),
  spawn: jest.fn(),
  fork: jest.fn()
}));

// Mock Bull queue to avoid Redis connections in unit tests
jest.unstable_mockModule('bull', () => ({
  default: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
    process: jest.fn(),
    on: jest.fn(),
    getWaitingCount: jest.fn().mockResolvedValue(0),
    getActiveCount: jest.fn().mockResolvedValue(0),
    getCompletedCount: jest.fn().mockResolvedValue(10),
    getFailedCount: jest.fn().mockResolvedValue(0),
    getDelayedCount: jest.fn().mockResolvedValue(0),
    getPausedCount: jest.fn().mockResolvedValue(0),
    close: jest.fn().mockResolvedValue(undefined),
    clean: jest.fn().mockResolvedValue(undefined)
  }))
}));

// Clean up after each test
afterEach(async () => {
  jest.clearAllMocks();
  
  // Reset mock implementations
  mockExec.mockClear();
  
  // Clean up test data if in real environment
  if (testEnv.hasZFS) {
    await cleanupZFSSnapshots(testEnv.dataset);
  }
  
  if (testEnv.hasRedis) {
    await cleanupRedisQueues();
  }
});

// Global cleanup after all tests
afterAll(async () => {
  // Final cleanup
  if (testEnv.hasZFS) {
    await cleanupZFSSnapshots(testEnv.dataset);
  }
  
  if (testEnv.hasRedis) {
    await cleanupRedisQueues();
  }
});

// Global error handler for unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  originalConsole.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Make test helpers available globally
global.testHelpers = {
  createMockExec,
  getTestEnvironment,
  testEnv
};