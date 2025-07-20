import { jest } from '@jest/globals';
import { execSync } from 'child_process';

// Mock factory for child_process
export function createMockExec() {
  const mockExec = jest.fn();
  
  // Default implementations for common ZFS commands
  mockExec.mockImplementation((cmd, callback) => {
    if (typeof callback !== 'function') {
      throw new Error('Callback required for mocked exec');
    }
    
    // Simulate different ZFS commands
    if (cmd.includes('zfs snapshot')) {
      callback(null, { stdout: '', stderr: '' });
    } else if (cmd.includes('zfs rollback')) {
      callback(null, { stdout: '', stderr: '' });
    } else if (cmd.includes('zfs clone')) {
      callback(null, { stdout: '', stderr: '' });
    } else if (cmd.includes('zfs list')) {
      const mockOutput = `NAME                                CREATION     USED  REFER
testpool/honeygraph@checkpoint_12345_QmTest123  2025-01-01T00:00:00  100M   1G`;
      callback(null, { stdout: mockOutput, stderr: '' });
    } else if (cmd.includes('zfs destroy')) {
      callback(null, { stdout: '', stderr: '' });
    } else if (cmd.includes('zfs diff')) {
      callback(null, { stdout: 'M /data/test.json\n+ /data/new.json', stderr: '' });
    } else if (cmd.includes('docker-compose stop')) {
      callback(null, { stdout: 'Stopping services...', stderr: '' });
    } else if (cmd.includes('docker-compose start')) {
      callback(null, { stdout: 'Starting services...', stderr: '' });
    } else if (cmd.includes('curl') && cmd.includes('health')) {
      callback(null, { stdout: '{"status":"OK"}', stderr: '' });
    } else {
      // Default success for unknown commands
      callback(null, { stdout: '', stderr: '' });
    }
  });
  
  return mockExec;
}

// Mock Bull queue for testing
export function createMockQueue() {
  const mockQueue = {
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
  };
  
  return mockQueue;
}

// Mock WebSocket for testing
export function createMockWebSocket(nodeId = 'test-node', options = {}) {
  return {
    nodeId,
    send: jest.fn(),
    close: jest.fn(),
    on: jest.fn(),
    authenticated: options.authenticated ?? true,
    token: options.token ?? 'SPK',
    readyState: 1, // WebSocket.OPEN
    ...options
  };
}

// Mock request for WebSocket connection
export function createMockRequest(ip = '192.168.1.100', headers = {}) {
  return {
    headers: {
      'x-forwarded-for': ip,
      ...headers
    },
    connection: {
      remoteAddress: ip
    }
  };
}

// Mock logger
export function createMockLogger() {
  return {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  };
}

// Mock Dgraph client
export function createMockDgraphClient() {
  return {
    writeBatch: jest.fn().mockResolvedValue({ success: true }),
    writeOperation: jest.fn().mockResolvedValue({ success: true }),
    createCheckpoint: jest.fn().mockResolvedValue({ success: true }),
    query: jest.fn().mockResolvedValue({ data: {} })
  };
}

// Mock fork manager
export function createMockForkManager() {
  return {
    detectFork: jest.fn().mockResolvedValue('test-fork-hash'),
    getCanonicalFork: jest.fn().mockReturnValue('canonical-fork'),
    updateForkStatus: jest.fn().mockResolvedValue(true),
    reconcileForks: jest.fn().mockResolvedValue({ 
      canonical: 'test-fork', 
      orphaned: [] 
    }),
    pruneForks: jest.fn().mockResolvedValue(5)
  };
}

// Check if running in Docker with ZFS support
export function hasZFSSupport() {
  try {
    execSync('which zfs', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

// Check if Redis is available
export function hasRedisSupport() {
  try {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = process.env.REDIS_PORT || '6379';
    execSync(`timeout 2 bash -c "</dev/tcp/${host}/${port}"`, { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

// Test environment detection
export function getTestEnvironment() {
  return {
    hasZFS: hasZFSSupport(),
    hasRedis: hasRedisSupport(),
    isDocker: process.env.DOCKER === 'true' || !!process.env.ZFS_DATASET,
    dataset: process.env.ZFS_DATASET || 'testpool/honeygraph'
  };
}

// Wait for service to be ready
export async function waitForService(checkFn, timeout = 30000, interval = 1000) {
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    try {
      if (await checkFn()) {
        return true;
      }
    } catch (error) {
      // Ignore errors during startup
    }
    
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  throw new Error(`Service not ready after ${timeout}ms`);
}

// Create test data helpers
export function createTestOperations(count = 5, blockNum = 12345) {
  return Array.from({ length: count }, (_, i) => ({
    type: i === count - 1 ? 'write_marker' : 'put',
    forkHash: 'QmTestFork123...',
    blockNum,
    index: i + 1,
    path: i === count - 1 ? undefined : `/test/data/${i}`,
    data: i === count - 1 ? undefined : { value: i, timestamp: Date.now() },
    timestamp: Date.now()
  }));
}

export function createTestCheckpoint(blockNum = 12345) {
  return {
    type: 'sendCheckpoint',
    blockNum: blockNum + 1,
    hash: `QmCheckpoint${blockNum}...`,
    prevHash: `QmPrev${blockNum}...`,
    timestamp: Date.now()
  };
}

// Cleanup helpers
export async function cleanupZFSSnapshots(dataset) {
  if (!hasZFSSupport()) return;
  
  try {
    execSync(`sudo zfs list -t snapshot -o name -H | grep "${dataset}@" | xargs -r sudo zfs destroy`, 
             { stdio: 'ignore' });
  } catch (error) {
    // Ignore cleanup errors
  }
}

export async function cleanupRedisQueues() {
  if (!hasRedisSupport()) return;
  
  try {
    const Redis = (await import('ioredis')).default;
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      maxRetriesPerRequest: 1
    });
    
    await redis.flushdb();
    await redis.quit();
  } catch (error) {
    // Ignore cleanup errors
  }
}