import { jest } from '@jest/globals';
import { WSForkHandler } from '../lib/ws-fork-handler.js';
import { ZFSCheckpointManager } from '../lib/zfs-checkpoint.js';
import { 
  createMockWebSocket, 
  createMockLogger, 
  createMockDgraphClient, 
  createMockForkManager,
  createMockQueue,
  getTestEnvironment,
  createTestOperations,
  createTestCheckpoint
} from './utils/test-helpers.js';

describe('Write Stream System Tests (Fixed)', () => {
  let wsForkHandler;
  let zfsCheckpoints;
  let mockLogger;
  let testEnv;

  beforeAll(() => {
    testEnv = getTestEnvironment();
  });

  beforeEach(() => {
    mockLogger = createMockLogger();

    // Initialize handlers
    wsForkHandler = new WSForkHandler({
      maxForksPerBlock: 5,
      forkRetentionTime: 60000,
      operationBufferSize: 1000
    });

    zfsCheckpoints = new ZFSCheckpointManager({
      dataset: testEnv.dataset,
      snapshotPrefix: 'test-checkpoint',
      maxSnapshots: 10
    });
  });

  describe('WebSocket Fork Handler', () => {
    test('should handle fork start notification', () => {
      const mockWebSocket = createMockWebSocket('test-node-1');
      
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
      const mockWebSocket = createMockWebSocket('test-node-1');
      
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
      const mockWebSocket = createMockWebSocket('test-node-1');
      
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
      const mockWebSocket = createMockWebSocket('test-node-1');
      
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

    test('should handle malformed WebSocket messages gracefully', () => {
      const mockWebSocket = createMockWebSocket('test-node-1');

      // Test null message
      expect(() => {
        wsForkHandler.handleMessage(mockWebSocket, null);
      }).not.toThrow();

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('Invalid message format')
      );

      // Test invalid message
      mockWebSocket.send.mockClear();
      expect(() => {
        wsForkHandler.handleMessage(mockWebSocket, 'invalid');
      }).not.toThrow();

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('Invalid message format')
      );
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
    test('should create checkpoint with proper configuration', () => {
      expect(zfsCheckpoints.dataset).toBe(testEnv.dataset);
      expect(zfsCheckpoints.snapshotPrefix).toBe('test-checkpoint');
      expect(zfsCheckpoints.maxSnapshots).toBe(10);
    });

    test('should track checkpoints in memory', () => {
      // Manually add checkpoint to test memory tracking
      zfsCheckpoints.checkpoints.set(12345, {
        snapshot: `${testEnv.dataset}@test-checkpoint_12345_QmTest123`,
        blockNum: 12345,
        ipfsHash: 'QmTest123...',
        createdAt: new Date()
      });

      expect(zfsCheckpoints.checkpoints.has(12345)).toBe(true);
      
      const checkpoint = zfsCheckpoints.checkpoints.get(12345);
      expect(checkpoint.blockNum).toBe(12345);
      expect(checkpoint.ipfsHash).toBe('QmTest123...');
    });

    test('should extract block number from snapshot name', () => {
      const snapshotName = `${testEnv.dataset}@test-checkpoint_12345_QmTest123`;
      const blockNum = zfsCheckpoints.extractBlockNum(snapshotName);
      expect(blockNum).toBe(12345);
    });

    test('should handle invalid snapshot names', () => {
      const invalidName = 'invalid-snapshot-name';
      const blockNum = zfsCheckpoints.extractBlockNum(invalidName);
      expect(blockNum).toBeNull();
    });
  });

  describe('Integration Tests', () => {
    test('should handle complete write stream flow', async () => {
      const mockWebSocket = createMockWebSocket('integration-node-1');

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

      // 2. Send test operations
      const operations = createTestOperations(4, 15000);
      operations.forEach(op => {
        wsForkHandler.handleMessage(mockWebSocket, op);
      });

      // 3. Send checkpoint notification
      const checkpoint = createTestCheckpoint(15000);
      wsForkHandler.handleMessage(mockWebSocket, checkpoint);

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify fork was created with all operations
      const fork = wsForkHandler.forks.get('QmIntegrationFork123...');
      expect(fork).toBeDefined();
      expect(fork.operations).toHaveLength(4);
      expect(fork.lastWriteMarker).toBeDefined();

      // Verify events were emitted
      expect(operationEvents).toHaveLength(4);
      expect(checkpointEvents).toHaveLength(1);

      // Verify checkpoint boundary validation
      const isValidBoundary = wsForkHandler.validateCheckpointBoundary(fork, 15001);
      expect(isValidBoundary).toBe(true);
    });

    test('should handle multiple concurrent nodes on same fork', () => {
      const node1 = createMockWebSocket('node-1');
      const node2 = createMockWebSocket('node-2');
      const node3 = createMockWebSocket('node-3');

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

    test('should handle network switch and multi-token operations', () => {
      const spkNode = createMockWebSocket('spk-node', { token: 'SPK' });
      const larynxNode = createMockWebSocket('larynx-node', { token: 'LARYNX' });

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

    test('should handle checkpoint boundary validation scenarios', () => {
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
          { type: 'put', blockNum: 12344, path: '/after' }
        ]
      };

      expect(wsForkHandler.validateCheckpointBoundary(validFork, 12345)).toBe(true);
      expect(wsForkHandler.validateCheckpointBoundary(invalidFork, 12345)).toBe(false);
    });

    test('should handle node disconnections gracefully', () => {
      const node1 = createMockWebSocket('disconnect-node-1');
      const node2 = createMockWebSocket('disconnect-node-2');

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

  describe('Performance Tests', () => {
    test('should handle high-frequency operations', () => {
      const mockWebSocket = createMockWebSocket('perf-node');

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

      // Performance check: should handle 1000 ops reasonably fast
      expect(processingTime).toBeLessThan(1000); // 1 second max

      const fork = wsForkHandler.forks.get('QmPerfFork...');
      
      // All operations should be buffered (up to buffer limit)
      expect(fork.operations.length).toBeGreaterThan(0);
      expect(fork.operationCount).toBe(operationCount);
    });

    test('should handle buffer overflow correctly', () => {
      const mockWebSocket = createMockWebSocket('buffer-node');

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
});