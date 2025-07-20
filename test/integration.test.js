import { jest } from '@jest/globals';
import WebSocket from 'ws';
import { WSForkHandler } from '../lib/ws-fork-handler.js';
import { ZFSCheckpointManager } from '../lib/zfs-checkpoint.js';
import { ReplicationQueue } from '../lib/replication-queue.js';

describe('Honeygraph Integration Tests', () => {
  let server;
  let wsForkHandler;
  let zfsCheckpoints;
  let replicationQueue;
  let mockDgraphClient;
  let mockLogger;

  beforeAll(async () => {
    // Setup mock dependencies
    mockDgraphClient = {
      writeBatch: jest.fn().mockResolvedValue({ success: true }),
      writeOperation: jest.fn().mockResolvedValue({ success: true }),
      createCheckpoint: jest.fn().mockResolvedValue({ success: true })
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };

    // Initialize system components
    wsForkHandler = new WSForkHandler({
      maxForksPerBlock: 5,
      forkRetentionTime: 60000,
      operationBufferSize: 1000
    });

    zfsCheckpoints = new ZFSCheckpointManager({
      dataset: 'test/integration',
      snapshotPrefix: 'test-cp',
      maxSnapshots: 10
    });

    replicationQueue = new ReplicationQueue({
      dgraphClient: mockDgraphClient,
      forkManager: {
        detectFork: jest.fn().mockResolvedValue('test-fork'),
        updateForkStatus: jest.fn().mockResolvedValue(true),
        reconcileForks: jest.fn().mockResolvedValue({ canonical: 'test-fork', orphaned: [] }),
        pruneForks: jest.fn().mockResolvedValue(2)
      },
      zfsCheckpoints,
      logger: mockLogger
    });

    // Connect components
    wsForkHandler.on('operation', async (event) => {
      await replicationQueue.addOperation(event.operation);
    });

    wsForkHandler.on('checkpoint', async (event) => {
      await replicationQueue.processCheckpoint(event);
    });
  });

  afterAll(async () => {
    if (server) {
      server.close();
    }
    await replicationQueue.close();
  });

  describe('End-to-End Write Stream Flow', () => {
    test('should process complete block with operations and checkpoint', async () => {
      const mockWebSocket = {
        nodeId: 'integration-node-1',
        send: jest.fn(),
        authenticated: true,
        token: 'SPK'
      };

      // Track events
      const operationEvents = [];
      const checkpointEvents = [];

      wsForkHandler.on('operation', (event) => operationEvents.push(event));
      wsForkHandler.on('checkpoint', (event) => checkpointEvents.push(event));

      // 1. Start fork
      const forkStart = {
        type: 'fork_start',
        forkHash: 'QmIntegrationFork123...',
        blockNum: 15000,
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(mockWebSocket, forkStart);

      // 2. Send operations
      const operations = [
        {
          type: 'put',
          forkHash: 'QmIntegrationFork123...',
          blockNum: 15000,
          index: 1,
          path: '/users/alice',
          data: { balance: 1000, stake: 500 },
          timestamp: Date.now()
        },
        {
          type: 'put',
          forkHash: 'QmIntegrationFork123...',
          blockNum: 15000,
          index: 2,
          path: '/users/bob',
          data: { balance: 750, stake: 250 },
          timestamp: Date.now()
        },
        {
          type: 'del',
          forkHash: 'QmIntegrationFork123...',
          blockNum: 15000,
          index: 3,
          path: '/users/charlie',
          timestamp: Date.now()
        }
      ];

      for (const op of operations) {
        wsForkHandler.handleMessage(mockWebSocket, op);
      }

      // 3. Send write marker
      const writeMarker = {
        type: 'write_marker',
        forkHash: 'QmIntegrationFork123...',
        blockNum: 15000,
        index: 10,
        timestamp: Date.now(),
        prevCheckpointHash: 'QmPrevCheckpoint...'
      };
      wsForkHandler.handleMessage(mockWebSocket, writeMarker);

      // 4. Send checkpoint notification
      const checkpoint = {
        type: 'sendCheckpoint',
        blockNum: 15001,
        hash: 'QmNewCheckpoint...',
        prevHash: 'QmIntegrationFork123...',
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(mockWebSocket, checkpoint);

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify fork was created with all operations
      const fork = wsForkHandler.forks.get('QmIntegrationFork123...');
      expect(fork).toBeDefined();
      expect(fork.operations).toHaveLength(4); // 3 ops + 1 write marker
      expect(fork.lastWriteMarker).toBeDefined();
      expect(fork.lastWriteMarker.index).toBe(10);

      // Verify events were emitted
      expect(operationEvents).toHaveLength(4);
      expect(checkpointEvents).toHaveLength(1);

      // Verify checkpoint boundary validation
      const isValidBoundary = wsForkHandler.validateCheckpointBoundary(fork, 15001);
      expect(isValidBoundary).toBe(true);
    });

    test('should handle multiple concurrent nodes on same fork', async () => {
      const node1 = { nodeId: 'node-1', send: jest.fn(), authenticated: true, token: 'SPK' };
      const node2 = { nodeId: 'node-2', send: jest.fn(), authenticated: true, token: 'SPK' };
      const node3 = { nodeId: 'node-3', send: jest.fn(), authenticated: true, token: 'SPK' };

      const forkHash = 'QmSharedFork456...';
      const blockNum = 15005;

      // All nodes start same fork
      const forkMessage = {
        type: 'fork_start',
        forkHash,
        blockNum,
        timestamp: Date.now()
      };

      [node1, node2, node3].forEach(node => {
        wsForkHandler.handleMessage(node, forkMessage);
      });

      // Verify fork has all nodes
      const fork = wsForkHandler.forks.get(forkHash);
      expect(fork.nodes.size).toBe(3);
      expect(fork.nodes.has('node-1')).toBe(true);
      expect(fork.nodes.has('node-2')).toBe(true);
      expect(fork.nodes.has('node-3')).toBe(true);

      // Simulate node 2 switching forks
      const forkSwitch = {
        type: 'fork_detected',
        oldForkHash: forkHash,
        newForkHash: 'QmNewFork789...',
        blockNum
      };
      wsForkHandler.handleMessage(node2, forkSwitch);

      // Verify node removed from original fork
      expect(fork.nodes.size).toBe(2);
      expect(fork.nodes.has('node-2')).toBe(false);
    });

    test('should handle network switch and multi-token operations', async () => {
      const spkNode = { nodeId: 'spk-node', send: jest.fn(), authenticated: true, token: 'SPK' };
      const larynxNode = { nodeId: 'larynx-node', send: jest.fn(), authenticated: true, token: 'LARYNX' };

      // SPK network operation
      const spkFork = {
        type: 'fork_start',
        forkHash: 'QmSPKFork...',
        blockNum: 20000,
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(spkNode, spkFork);

      const spkOp = {
        type: 'put',
        forkHash: 'QmSPKFork...',
        blockNum: 20000,
        index: 1,
        path: '/governance/proposal/1',
        data: { title: 'Increase rewards', votes: 150 },
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(spkNode, spkOp);

      // LARYNX network operation
      const larynxFork = {
        type: 'fork_start',
        forkHash: 'QmLARYNXFork...',
        blockNum: 20000,
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(larynxNode, larynxFork);

      const larynxOp = {
        type: 'put',
        forkHash: 'QmLARYNXFork...',
        blockNum: 20000,
        index: 1,
        path: '/mining/rewards/alice',
        data: { amount: 25.5, timestamp: Date.now() },
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(larynxNode, larynxOp);

      // Verify separate forks for different tokens
      const spkForkData = wsForkHandler.forks.get('QmSPKFork...');
      const larynxForkData = wsForkHandler.forks.get('QmLARYNXFork...');

      expect(spkForkData).toBeDefined();
      expect(larynxForkData).toBeDefined();
      expect(spkForkData.operations[0].token).toBe('SPK');
      expect(larynxForkData.operations[0].token).toBe('LARYNX');
    });
  });

  describe('Checkpoint and Rollback Integration', () => {
    beforeEach(() => {
      // Mock ZFS commands
      jest.doMock('child_process', () => ({
        exec: jest.fn()
      }));
    });

    test('should create and rollback checkpoint in full flow', async () => {
      const { exec } = await import('child_process');
      let snapshotCreated = false;
      let rollbackExecuted = false;

      exec.mockImplementation((cmd, callback) => {
        if (cmd.includes('zfs snapshot')) {
          snapshotCreated = true;
          callback(null, { stdout: '', stderr: '' });
        } else if (cmd.includes('zfs rollback')) {
          rollbackExecuted = true;
          callback(null, { stdout: '', stderr: '' });
        } else if (cmd.includes('docker-compose')) {
          callback(null, { stdout: 'Service operation completed', stderr: '' });
        } else if (cmd.includes('curl') && cmd.includes('health')) {
          callback(null, { stdout: '{"status":"OK"}', stderr: '' });
        }
      });

      // 1. Create initial checkpoint
      const blockData1 = {
        blockNum: 16000,
        blockHash: 'QmBlock16000...',
        forkId: 'QmFork16000...',
        isLib: true
      };
      await replicationQueue.createCheckpoint(blockData1);
      expect(snapshotCreated).toBe(true);

      // 2. Create second checkpoint
      snapshotCreated = false;
      const blockData2 = {
        blockNum: 16005,
        blockHash: 'QmBlock16005...',
        forkId: 'QmFork16005...',
        isLib: true
      };
      await replicationQueue.createCheckpoint(blockData2);
      expect(snapshotCreated).toBe(true);

      // 3. Rollback to first checkpoint
      const rollbackResult = await zfsCheckpoints.rollbackToCheckpoint(16000);
      expect(rollbackExecuted).toBe(true);
      expect(rollbackResult.success).toBe(true);

      // Verify newer checkpoint was removed
      expect(zfsCheckpoints.checkpoints.has(16000)).toBe(true);
      expect(zfsCheckpoints.checkpoints.has(16005)).toBe(false);
    });

    test('should handle checkpoint validation failures', async () => {
      const mockWebSocket = {
        nodeId: 'validation-node',
        send: jest.fn(),
        authenticated: true,
        token: 'SPK'
      };

      // Create fork with invalid checkpoint boundary
      const forkStart = {
        type: 'fork_start',
        forkHash: 'QmInvalidFork...',
        blockNum: 17000,
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(mockWebSocket, forkStart);

      // Add operation
      const operation = {
        type: 'put',
        forkHash: 'QmInvalidFork...',
        blockNum: 17000,
        index: 1,
        path: '/test/data',
        data: { value: 'test' },
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(mockWebSocket, operation);

      // Add write marker
      const writeMarker = {
        type: 'write_marker',
        forkHash: 'QmInvalidFork...',
        blockNum: 17000,
        index: 5,
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(mockWebSocket, writeMarker);

      // Add another operation AFTER write marker (invalid)
      const invalidOperation = {
        type: 'put',
        forkHash: 'QmInvalidFork...',
        blockNum: 17000,
        index: 6,
        path: '/test/invalid',
        data: { value: 'invalid' },
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(mockWebSocket, invalidOperation);

      // Try to send checkpoint - should be invalid
      const invalidCheckpoint = {
        type: 'sendCheckpoint',
        blockNum: 17001,
        hash: 'QmInvalidCheckpoint...',
        prevHash: 'QmInvalidFork...',
        timestamp: Date.now()
      };

      const invalidEventSpy = jest.fn();
      wsForkHandler.on('checkpoint:invalid', invalidEventSpy);

      wsForkHandler.handleMessage(mockWebSocket, invalidCheckpoint);

      // Verify validation caught the error
      expect(invalidEventSpy).toHaveBeenCalledWith({
        reason: 'missing_write_marker',
        forkHash: 'QmInvalidFork...',
        blockNum: 17001,
        nodeId: 'validation-node'
      });
    });
  });

  describe('Queue Integration and Error Recovery', () => {
    test('should handle queue processing with retries', async () => {
      let attemptCount = 0;
      
      // Mock Dgraph to fail first two attempts
      mockDgraphClient.writeOperation.mockImplementation(() => {
        attemptCount++;
        if (attemptCount <= 2) {
          return Promise.reject(new Error('Temporary Dgraph failure'));
        }
        return Promise.resolve({ success: true });
      });

      const operation = {
        type: 'put',
        blockNum: 18000,
        index: 1,
        path: '/test/retry',
        data: { value: 'retry-test' },
        token: 'SPK'
      };

      // Add operation to queue
      const jobId = await replicationQueue.addOperation(operation);
      expect(jobId).toBeDefined();

      // Wait for processing (with retries)
      await new Promise(resolve => setTimeout(resolve, 500));

      // Should eventually succeed after retries
      expect(attemptCount).toBe(3);
    });

    test('should handle mixed operation types in sequence', async () => {
      const mockWebSocket = {
        nodeId: 'sequence-node',
        send: jest.fn(),
        authenticated: true,
        token: 'BROCA'
      };

      const operationEvents = [];
      wsForkHandler.on('operation', (event) => operationEvents.push(event));

      // Start fork
      const forkStart = {
        type: 'fork_start',
        forkHash: 'QmSequenceFork...',
        blockNum: 19000,
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(mockWebSocket, forkStart);

      // Mixed operations sequence
      const operations = [
        {
          type: 'put',
          forkHash: 'QmSequenceFork...',
          blockNum: 19000,
          index: 1,
          path: '/storage/contracts/alice',
          data: { bytes: 1048576, duration: 30 },
          timestamp: Date.now()
        },
        {
          type: 'put',
          forkHash: 'QmSequenceFork...',
          blockNum: 19000,
          index: 2,
          path: '/storage/usage/alice',
          data: { used: 524288, remaining: 524288 },
          timestamp: Date.now()
        },
        {
          type: 'del',
          forkHash: 'QmSequenceFork...',
          blockNum: 19000,
          index: 3,
          path: '/storage/expired/bob',
          timestamp: Date.now()
        },
        {
          type: 'put',
          forkHash: 'QmSequenceFork...',
          blockNum: 19000,
          index: 4,
          path: '/payments/broca/alice',
          data: { amount: 100, recipient: 'storage-provider' },
          timestamp: Date.now()
        }
      ];

      // Send operations with delays to simulate real timing
      for (const [index, op] of operations.entries()) {
        wsForkHandler.handleMessage(mockWebSocket, op);
        if (index < operations.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      // Send write marker
      const writeMarker = {
        type: 'write_marker',
        forkHash: 'QmSequenceFork...',
        blockNum: 19000,
        index: 10,
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(mockWebSocket, writeMarker);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify all operations were processed in order
      const fork = wsForkHandler.forks.get('QmSequenceFork...');
      expect(fork.operations).toHaveLength(5); // 4 ops + 1 write marker
      expect(operationEvents).toHaveLength(5);

      // Verify operation sequence
      const opTypes = fork.operations.map(op => op.type);
      expect(opTypes).toEqual(['put', 'put', 'del', 'put', 'write_marker']);

      // Verify all operations have correct token
      fork.operations.forEach(op => {
        expect(op.token).toBe('BROCA');
      });
    });
  });

  describe('Fork Management Integration', () => {
    test('should handle fork consensus and cleanup', async () => {
      const node1 = { nodeId: 'consensus-node-1', send: jest.fn(), authenticated: true, token: 'SPK' };
      const node2 = { nodeId: 'consensus-node-2', send: jest.fn(), authenticated: true, token: 'SPK' };
      const node3 = { nodeId: 'consensus-node-3', send: jest.fn(), authenticated: true, token: 'SPK' };

      const blockNum = 20000;

      // Create competing forks
      const forkA = {
        type: 'fork_start',
        forkHash: 'QmForkA...',
        blockNum,
        timestamp: Date.now()
      };

      const forkB = {
        type: 'fork_start',
        forkHash: 'QmForkB...',
        blockNum,
        timestamp: Date.now()
      };

      // Node 1 and 2 on Fork A
      wsForkHandler.handleMessage(node1, forkA);
      wsForkHandler.handleMessage(node2, forkA);

      // Node 3 on Fork B
      wsForkHandler.handleMessage(node3, forkB);

      // Verify both forks exist
      expect(wsForkHandler.forks.has('QmForkA...')).toBe(true);
      expect(wsForkHandler.forks.has('QmForkB...')).toBe(true);

      const forkAData = wsForkHandler.forks.get('QmForkA...');
      const forkBData = wsForkHandler.forks.get('QmForkB...');

      expect(forkAData.nodes.size).toBe(2);
      expect(forkBData.nodes.size).toBe(1);

      // Simulate consensus: Fork A wins
      const consensusCheckpoint = {
        type: 'checkpoint',
        forkHash: 'QmForkA...',
        confirmedHash: 'QmForkA...',
        blockNum,
        matches: true
      };
      wsForkHandler.handleMessage(node1, consensusCheckpoint);

      // Verify Fork A is confirmed
      expect(forkAData.isConfirmed).toBe(true);

      // Simulate cleanup of losing fork
      wsForkHandler.cleanupForksForBlock(blockNum, 'QmForkA...');

      // Fork B should be removed
      expect(wsForkHandler.forks.has('QmForkB...')).toBe(false);
      expect(wsForkHandler.forks.has('QmForkA...')).toBe(true);
    });

    test('should handle node disconnections gracefully', () => {
      const node1 = { nodeId: 'disconnect-node-1', send: jest.fn(), authenticated: true, token: 'SPK' };
      const node2 = { nodeId: 'disconnect-node-2', send: jest.fn(), authenticated: true, token: 'SPK' };

      // Both nodes join same fork
      const forkMessage = {
        type: 'fork_start',
        forkHash: 'QmDisconnectFork...',
        blockNum: 21000,
        timestamp: Date.now()
      };

      wsForkHandler.handleMessage(node1, forkMessage);
      wsForkHandler.handleMessage(node2, forkMessage);

      const fork = wsForkHandler.forks.get('QmDisconnectFork...');
      expect(fork.nodes.size).toBe(2);

      // Simulate node 1 disconnect
      wsForkHandler.handleDisconnect(node1);

      // Node should be removed from fork
      expect(fork.nodes.size).toBe(1);
      expect(fork.nodes.has('disconnect-node-1')).toBe(false);
      expect(fork.nodes.has('disconnect-node-2')).toBe(true);

      // Simulate node 2 disconnect (last node)
      wsForkHandler.handleDisconnect(node2);

      // Fork should have no nodes but still exist (for cleanup)
      expect(fork.nodes.size).toBe(0);
    });
  });

  describe('Performance and Load Testing', () => {
    test('should handle high-frequency operations', async () => {
      const mockWebSocket = {
        nodeId: 'perf-node',
        send: jest.fn(),
        authenticated: true,
        token: 'SPK'
      };

      // Start fork
      const forkStart = {
        type: 'fork_start',
        forkHash: 'QmPerfFork...',
        blockNum: 22000,
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(mockWebSocket, forkStart);

      // Send many operations rapidly
      const operationCount = 1000;
      const startTime = Date.now();

      for (let i = 0; i < operationCount; i++) {
        const operation = {
          type: 'put',
          forkHash: 'QmPerfFork...',
          blockNum: 22000,
          index: i + 1,
          path: `/test/perf/${i}`,
          data: { value: i, timestamp: Date.now() },
          timestamp: Date.now()
        };
        wsForkHandler.handleMessage(mockWebSocket, operation);
      }

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Performance check: should handle 1000 ops in reasonable time
      expect(processingTime).toBeLessThan(5000); // 5 seconds max

      const fork = wsForkHandler.forks.get('QmPerfFork...');
      
      // All operations should be buffered (up to buffer limit)
      expect(fork.operations.length).toBeGreaterThan(0);
      expect(fork.operationCount).toBe(operationCount);
    });

    test('should handle buffer overflow correctly', async () => {
      const mockWebSocket = {
        nodeId: 'buffer-node',
        send: jest.fn(),
        authenticated: true,
        token: 'SPK'
      };

      // Create handler with small buffer for testing
      const smallBufferHandler = new WSForkHandler({
        operationBufferSize: 10
      });

      // Start fork
      const forkStart = {
        type: 'fork_start',
        forkHash: 'QmBufferFork...',
        blockNum: 23000,
        timestamp: Date.now()
      };
      smallBufferHandler.handleMessage(mockWebSocket, forkStart);

      // Send more operations than buffer size
      for (let i = 0; i < 20; i++) {
        const operation = {
          type: 'put',
          forkHash: 'QmBufferFork...',
          blockNum: 23000,
          index: i + 1,
          path: `/test/buffer/${i}`,
          data: { value: i },
          timestamp: Date.now()
        };
        smallBufferHandler.handleMessage(mockWebSocket, operation);
      }

      const fork = smallBufferHandler.forks.get('QmBufferFork...');
      
      // Buffer should be limited to configured size
      expect(fork.operations.length).toBe(10);
      expect(fork.operationCount).toBe(20); // Total count preserved
      
      // Should contain most recent operations
      const lastOp = fork.operations[fork.operations.length - 1];
      expect(lastOp.index).toBe(20);
    });
  });

  describe('Authentication Integration', () => {
    test('should handle authenticated vs unauthenticated flows', () => {
      // Mock environment for auth requirement
      const originalEnv = process.env.REQUIRE_HIVE_AUTH;
      process.env.REQUIRE_HIVE_AUTH = 'true';

      const authHandler = new WSForkHandler();
      
      const mockRequest = {
        headers: { 'x-forwarded-for': '192.168.1.100' },
        connection: { remoteAddress: '192.168.1.100' }
      };

      const mockWebSocket = {
        send: jest.fn(),
        on: jest.fn(),
        close: jest.fn()
      };

      // Handle connection - should require auth
      authHandler.handleConnection(mockWebSocket, mockRequest);

      expect(mockWebSocket.authenticated).toBe(false);
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('auth_required')
      );

      // Restore environment
      process.env.REQUIRE_HIVE_AUTH = originalEnv;
    });
  });
});