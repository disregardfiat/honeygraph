import { jest } from '@jest/globals';
import { WSForkHandler } from '../lib/ws-fork-handler.js';
import { ZFSCheckpointManager } from '../lib/zfs-checkpoint.js';
import { ReplicationQueue } from '../lib/replication-queue.js';
import WebSocket from 'ws';

describe('Write Stream System Tests', () => {
  let wsForkHandler;
  let zfsCheckpoints;
  let replicationQueue;
  let mockDgraphClient;
  let mockForkManager;
  let mockLogger;

  beforeEach(() => {
    // Mock dependencies
    mockDgraphClient = {
      writeBatch: jest.fn().mockResolvedValue({ success: true }),
      writeOperation: jest.fn().mockResolvedValue({ success: true }),
      createCheckpoint: jest.fn().mockResolvedValue({ success: true })
    };

    mockForkManager = {
      detectFork: jest.fn().mockResolvedValue('test-fork-hash'),
      getCanonicalFork: jest.fn().mockReturnValue('canonical-fork'),
      updateForkStatus: jest.fn().mockResolvedValue(true),
      reconcileForks: jest.fn().mockResolvedValue({ canonical: 'test-fork', orphaned: [] }),
      pruneForks: jest.fn().mockResolvedValue(5)
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };

    // Initialize handlers
    wsForkHandler = new WSForkHandler({
      maxForksPerBlock: 5,
      forkRetentionTime: 60000,
      operationBufferSize: 1000
    });

    zfsCheckpoints = new ZFSCheckpointManager({
      dataset: 'test/dgraph',
      snapshotPrefix: 'test-checkpoint',
      maxSnapshots: 10
    });

    replicationQueue = new ReplicationQueue({
      dgraphClient: mockDgraphClient,
      forkManager: mockForkManager,
      zfsCheckpoints,
      logger: mockLogger
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('WebSocket Fork Handler', () => {
    let mockWebSocket;

    beforeEach(() => {
      mockWebSocket = {
        nodeId: 'test-node-1',
        send: jest.fn(),
        close: jest.fn(),
        authenticated: true,
        token: 'SPK'
      };
    });

    test('should handle fork start notification', () => {
      const forkMessage = {
        type: 'fork_start',
        forkHash: 'QmTest123...',
        blockNum: 12345,
        timestamp: Date.now()
      };

      wsForkHandler.handleMessage(mockWebSocket, forkMessage);

      const fork = wsForkHandler.forks.get('QmTest123...');
      expect(fork).toBeDefined();
      expect(fork.blockNum).toBe(12345);
      expect(fork.nodes.has('test-node-1')).toBe(true);
    });

    test('should handle put operation', () => {
      // First establish a fork
      const forkMessage = {
        type: 'fork_start',
        forkHash: 'QmTest123...',
        blockNum: 12345,
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(mockWebSocket, forkMessage);

      // Then send a put operation
      const putMessage = {
        type: 'put',
        forkHash: 'QmTest123...',
        blockNum: 12345,
        index: 1,
        path: '/users/alice',
        data: { balance: 100 },
        timestamp: Date.now()
      };

      wsForkHandler.handleMessage(mockWebSocket, putMessage);

      const fork = wsForkHandler.forks.get('QmTest123...');
      expect(fork.operations).toHaveLength(1);
      expect(fork.operations[0].type).toBe('put');
      expect(fork.operations[0].path).toBe('/users/alice');
    });

    test('should handle write marker correctly', () => {
      const forkMessage = {
        type: 'fork_start',
        forkHash: 'QmTest123...',
        blockNum: 12345,
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(mockWebSocket, forkMessage);

      const writeMarkerMessage = {
        type: 'write_marker',
        forkHash: 'QmTest123...',
        blockNum: 12345,
        index: 10,
        timestamp: Date.now(),
        prevCheckpointHash: 'QmPrev123...'
      };

      wsForkHandler.handleMessage(mockWebSocket, writeMarkerMessage);

      const fork = wsForkHandler.forks.get('QmTest123...');
      expect(fork.lastWriteMarker).toBeDefined();
      expect(fork.lastWriteMarker.index).toBe(10);
      expect(fork.lastWriteMarker.blockNum).toBe(12345);
    });

    test('should validate checkpoint boundaries', () => {
      const fork = {
        operations: [
          { type: 'put', blockNum: 12344 },
          { type: 'del', blockNum: 12344 },
          { type: 'write_marker', blockNum: 12344 }
        ]
      };

      const isValid = wsForkHandler.validateCheckpointBoundary(fork, 12345);
      expect(isValid).toBe(true);
    });

    test('should reject invalid checkpoint boundaries', () => {
      const fork = {
        operations: [
          { type: 'put', blockNum: 12344 },
          { type: 'write_marker', blockNum: 12344 },
          { type: 'del', blockNum: 12344 } // Operation after write marker
        ]
      };

      const isValid = wsForkHandler.validateCheckpointBoundary(fork, 12345);
      expect(isValid).toBe(false);
    });

    test('should handle checkpoint notifications', () => {
      const checkpointMessage = {
        type: 'sendCheckpoint',
        blockNum: 12345,
        hash: 'QmCheckpoint123...',
        prevHash: 'QmPrev123...',
        timestamp: Date.now()
      };

      const eventSpy = jest.fn();
      wsForkHandler.on('checkpoint', eventSpy);

      wsForkHandler.handleMessage(mockWebSocket, checkpointMessage);

      expect(eventSpy).toHaveBeenCalledWith({
        blockNum: 12345,
        hash: 'QmCheckpoint123...',
        prevHash: 'QmPrev123...',
        timestamp: expect.any(Number),
        nodeId: 'test-node-1'
      });
    });

    test('should handle fork switches', () => {
      const forkSwitchMessage = {
        type: 'fork_detected',
        oldForkHash: 'QmOld123...',
        newForkHash: 'QmNew123...',
        blockNum: 12345
      };

      const eventSpy = jest.fn();
      wsForkHandler.on('fork:switch', eventSpy);

      wsForkHandler.handleMessage(mockWebSocket, forkSwitchMessage);

      expect(eventSpy).toHaveBeenCalledWith({
        nodeId: 'test-node-1',
        oldForkHash: 'QmOld123...',
        newForkHash: 'QmNew123...',
        blockNum: 12345
      });
    });

    test('should cleanup old forks', () => {
      // Create old fork
      const oldFork = {
        hash: 'QmOld123...',
        blockNum: 12340,
        startTime: Date.now() - 7200000, // 2 hours ago
        lastUpdate: Date.now() - 7200000,
        nodes: new Set(),
        operations: []
      };

      wsForkHandler.forks.set('QmOld123...', oldFork);

      wsForkHandler.cleanupOldForks();

      expect(wsForkHandler.forks.has('QmOld123...')).toBe(false);
    });
  });

  describe('ZFS Checkpoint Manager', () => {
    beforeEach(() => {
      // Mock child_process.exec
      jest.doMock('child_process', () => ({
        exec: jest.fn()
      }));
    });

    test('should create checkpoint snapshot', async () => {
      const { exec } = await import('child_process');
      exec.mockImplementation((cmd, callback) => {
        if (cmd.includes('zfs snapshot')) {
          callback(null, { stdout: '', stderr: '' });
        }
      });

      const result = await zfsCheckpoints.createCheckpoint(12345, 'QmTest123...');

      expect(result.success).toBe(true);
      expect(result.blockNum).toBe(12345);
      expect(zfsCheckpoints.checkpoints.has(12345)).toBe(true);
    });

    test('should rollback to checkpoint', async () => {
      // Setup checkpoint
      zfsCheckpoints.checkpoints.set(12340, {
        snapshot: 'test/dgraph@test-checkpoint_12340_QmTest123',
        blockNum: 12340,
        ipfsHash: 'QmTest123...',
        createdAt: new Date()
      });

      const { exec } = await import('child_process');
      exec.mockImplementation((cmd, callback) => {
        callback(null, { stdout: '', stderr: '' });
      });

      const result = await zfsCheckpoints.rollbackToCheckpoint(12340);

      expect(result.success).toBe(true);
      expect(result.rolledBackTo.blockNum).toBe(12340);
    });

    test('should handle rollback failure', async () => {
      zfsCheckpoints.checkpoints.set(12340, {
        snapshot: 'test/dgraph@test-checkpoint_12340_QmTest123',
        blockNum: 12340,
        ipfsHash: 'QmTest123...',
        createdAt: new Date()
      });

      const { exec } = await import('child_process');
      exec.mockImplementation((cmd, callback) => {
        callback(new Error('ZFS rollback failed'));
      });

      await expect(zfsCheckpoints.rollbackToCheckpoint(12340))
        .rejects.toThrow('ZFS rollback failed');
    });

    test('should clone checkpoint for testing', async () => {
      zfsCheckpoints.checkpoints.set(12340, {
        snapshot: 'test/dgraph@test-checkpoint_12340_QmTest123',
        blockNum: 12340,
        ipfsHash: 'QmTest123...',
        createdAt: new Date()
      });

      const { exec } = await import('child_process');
      exec.mockImplementation((cmd, callback) => {
        if (cmd.includes('zfs clone')) {
          callback(null, { stdout: '', stderr: '' });
        }
      });

      const result = await zfsCheckpoints.cloneCheckpoint(12340, 'testing');

      expect(result.success).toBe(true);
      expect(result.cloneDataset).toBe('test/dgraph_testing');
    });
  });

  describe('Replication Queue', () => {
    test('should process block replication job', async () => {
      const blockData = {
        blockNum: 12345,
        blockHash: 'QmBlock123...',
        forkId: 'QmFork123...',
        isLib: true
      };

      const operations = [
        { type: 'put', path: '/users/alice', data: { balance: 100 } },
        { type: 'del', path: '/users/bob' }
      ];

      const jobId = await replicationQueue.addBlockReplication(blockData, operations);
      expect(jobId).toBeDefined();
    });

    test('should process checkpoint creation', async () => {
      const checkpointData = {
        blockNum: 12345,
        blockHash: 'QmBlock123...',
        forkId: 'QmFork123...'
      };

      const jobId = await replicationQueue.addCheckpointCreation(checkpointData);
      expect(jobId).toBeDefined();
    });

    test('should process individual operations', async () => {
      const operation = {
        type: 'put',
        blockNum: 12345,
        index: 1,
        path: '/users/alice',
        data: { balance: 100 },
        token: 'SPK'
      };

      const jobId = await replicationQueue.addOperation(operation);
      expect(jobId).toBeDefined();
    });

    test('should handle write markers', async () => {
      const writeMarker = {
        type: 'write_marker',
        blockNum: 12345,
        index: 10,
        prevCheckpointHash: 'QmPrev123...'
      };

      const result = await replicationQueue.addOperation(writeMarker);
      expect(result).toBeUndefined(); // Write markers don't create jobs
    });

    test('should process checkpoint notifications', async () => {
      const checkpointData = {
        blockNum: 12345,
        hash: 'QmCheckpoint123...',
        prevHash: 'QmPrev123...',
        timestamp: Date.now(),
        nodeId: 'test-node-1'
      };

      const jobId = await replicationQueue.processCheckpoint(checkpointData);
      expect(jobId).toBeDefined();
    });

    test('should get queue metrics', async () => {
      const metrics = await replicationQueue.getMetrics();
      
      expect(metrics).toHaveProperty('waiting');
      expect(metrics).toHaveProperty('active');
      expect(metrics).toHaveProperty('completed');
      expect(metrics).toHaveProperty('failed');
    });
  });

  describe('Integration Tests', () => {
    test('should handle complete write stream flow', async () => {
      const mockWebSocket = {
        nodeId: 'test-node-1',
        send: jest.fn(),
        authenticated: true,
        token: 'SPK'
      };

      // Setup event handlers
      const operationHandler = jest.fn();
      const checkpointHandler = jest.fn();
      
      wsForkHandler.on('operation', operationHandler);
      wsForkHandler.on('checkpoint', checkpointHandler);

      // 1. Start a new fork
      const forkMessage = {
        type: 'fork_start',
        forkHash: 'QmTest123...',
        blockNum: 12345,
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(mockWebSocket, forkMessage);

      // 2. Send some operations
      const operations = [
        {
          type: 'put',
          forkHash: 'QmTest123...',
          blockNum: 12345,
          index: 1,
          path: '/users/alice',
          data: { balance: 100 },
          timestamp: Date.now()
        },
        {
          type: 'put',
          forkHash: 'QmTest123...',
          blockNum: 12345,
          index: 2,
          path: '/users/bob',
          data: { balance: 50 },
          timestamp: Date.now()
        }
      ];

      operations.forEach(op => {
        wsForkHandler.handleMessage(mockWebSocket, op);
      });

      // 3. Send write marker
      const writeMarker = {
        type: 'write_marker',
        forkHash: 'QmTest123...',
        blockNum: 12345,
        index: 10,
        timestamp: Date.now(),
        prevCheckpointHash: 'QmPrev123...'
      };
      wsForkHandler.handleMessage(mockWebSocket, writeMarker);

      // 4. Send checkpoint notification
      const checkpoint = {
        type: 'sendCheckpoint',
        blockNum: 12346,
        hash: 'QmCheckpoint123...',
        prevHash: 'QmTest123...',
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(mockWebSocket, checkpoint);

      // Verify fork was created and operations recorded
      const fork = wsForkHandler.forks.get('QmTest123...');
      expect(fork).toBeDefined();
      expect(fork.operations).toHaveLength(3); // 2 puts + 1 write marker
      expect(fork.lastWriteMarker).toBeDefined();

      // Verify events were emitted
      expect(operationHandler).toHaveBeenCalledTimes(3);
      expect(checkpointHandler).toHaveBeenCalledTimes(1);
    });

    test('should handle fork rollback scenario', async () => {
      // Setup initial checkpoint
      zfsCheckpoints.checkpoints.set(12340, {
        snapshot: 'test/dgraph@test-checkpoint_12340_QmCheckpoint',
        blockNum: 12340,
        ipfsHash: 'QmCheckpoint123...',
        createdAt: new Date()
      });

      // Mock successful rollback
      const { exec } = await import('child_process');
      exec.mockImplementation((cmd, callback) => {
        callback(null, { stdout: '', stderr: '' });
      });

      // Simulate rollback scenario
      const result = await zfsCheckpoints.rollbackToCheckpoint(12340);

      expect(result.success).toBe(true);
      expect(result.rolledBackTo.blockNum).toBe(12340);

      // Verify newer checkpoints are removed
      expect(zfsCheckpoints.checkpoints.size).toBe(1);
    });

    test('should handle concurrent operations from multiple nodes', () => {
      const node1 = { nodeId: 'node-1', send: jest.fn(), authenticated: true, token: 'SPK' };
      const node2 = { nodeId: 'node-2', send: jest.fn(), authenticated: true, token: 'SPK' };

      // Both nodes start the same fork
      const forkMessage = {
        type: 'fork_start',
        forkHash: 'QmSharedFork...',
        blockNum: 12345,
        timestamp: Date.now()
      };

      wsForkHandler.handleMessage(node1, forkMessage);
      wsForkHandler.handleMessage(node2, forkMessage);

      const fork = wsForkHandler.forks.get('QmSharedFork...');
      expect(fork.nodes.size).toBe(2);
      expect(fork.nodes.has('node-1')).toBe(true);
      expect(fork.nodes.has('node-2')).toBe(true);
    });

    test('should handle checkpoint boundary validation', () => {
      const validFork = {
        operations: [
          { type: 'put', blockNum: 12344, path: '/test' },
          { type: 'write_marker', blockNum: 12344, index: 5 }
        ]
      };

      const invalidFork = {
        operations: [
          { type: 'put', blockNum: 12344, path: '/test' },
          { type: 'write_marker', blockNum: 12344, index: 5 },
          { type: 'put', blockNum: 12344, path: '/after' } // Invalid: operation after write marker
        ]
      };

      expect(wsForkHandler.validateCheckpointBoundary(validFork, 12345)).toBe(true);
      expect(wsForkHandler.validateCheckpointBoundary(invalidFork, 12345)).toBe(false);
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed WebSocket messages', () => {
      const mockWebSocket = {
        nodeId: 'test-node-1',
        send: jest.fn(),
        authenticated: true
      };

      // Malformed JSON should not crash
      expect(() => {
        wsForkHandler.handleMessage(mockWebSocket, null);
      }).not.toThrow();

      // Missing required fields should be handled gracefully
      const incompleteMessage = { type: 'put' }; // Missing required fields
      expect(() => {
        wsForkHandler.handleMessage(mockWebSocket, incompleteMessage);
      }).not.toThrow();
    });

    test('should handle ZFS command failures', async () => {
      const { exec } = await import('child_process');
      exec.mockImplementation((cmd, callback) => {
        callback(new Error('ZFS command failed'));
      });

      await expect(zfsCheckpoints.createCheckpoint(12345, 'QmTest123...'))
        .rejects.toThrow('ZFS command failed');
    });

    test('should handle queue processing errors', async () => {
      // Mock Dgraph failure
      mockDgraphClient.writeOperation.mockRejectedValueOnce(new Error('Dgraph write failed'));

      const operation = {
        type: 'put',
        blockNum: 12345,
        index: 1,
        path: '/users/alice',
        data: { balance: 100 }
      };

      // Should not throw, but should log error
      const jobId = await replicationQueue.addOperation(operation);
      expect(jobId).toBeDefined();
    });
  });
});