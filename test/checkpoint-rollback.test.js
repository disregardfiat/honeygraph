import { jest } from '@jest/globals';
import { ZFSCheckpointManager } from '../lib/zfs-checkpoint.js';
import { WSForkHandler } from '../lib/ws-fork-handler.js';
import { ReplicationQueue } from '../lib/replication-queue.js';

describe('Checkpoint and Rollback System Tests', () => {
  let zfsManager;
  let wsForkHandler;
  let replicationQueue;
  let mockExec;
  let mockLogger;

  beforeEach(() => {
    // Mock child_process.exec
    mockExec = jest.fn();
    jest.doMock('child_process', () => ({
      exec: mockExec
    }));

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };

    zfsManager = new ZFSCheckpointManager({
      dataset: 'test/honeygraph',
      snapshotPrefix: 'test-cp',
      maxSnapshots: 5,
      dgraphDataPath: '/test/dgraph'
    });

    wsForkHandler = new WSForkHandler();

    replicationQueue = new ReplicationQueue({
      dgraphClient: { 
        writeBatch: jest.fn().mockResolvedValue({ success: true }),
        createCheckpoint: jest.fn().mockResolvedValue({ success: true })
      },
      forkManager: { 
        detectFork: jest.fn().mockResolvedValue('test-fork'),
        updateForkStatus: jest.fn().mockResolvedValue(true)
      },
      zfsCheckpoints: zfsManager,
      logger: mockLogger
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('ZFS Checkpoint Creation', () => {
    test('should create checkpoint with proper naming', async () => {
      const { exec } = await import('child_process');
      exec.mockImplementation((cmd, callback) => {
        if (cmd.includes('zfs snapshot')) {
          expect(cmd).toContain('test/honeygraph@test-cp_12345_QmTest123');
          callback(null, { stdout: '', stderr: '' });
        }
      });

      const result = await zfsManager.createCheckpoint(12345, 'QmTest123abcdef...');

      expect(result.success).toBe(true);
      expect(result.blockNum).toBe(12345);
      expect(result.snapshot).toContain('test-cp_12345_QmTest123');
      expect(zfsManager.checkpoints.has(12345)).toBe(true);
    });

    test('should handle checkpoint creation failure', async () => {
      const { exec } = await import('child_process');
      exec.mockImplementation((cmd, callback) => {
        callback(new Error('ZFS snapshot failed: insufficient space'));
      });

      await expect(zfsManager.createCheckpoint(12345, 'QmTest123...'))
        .rejects.toThrow('ZFS snapshot failed: insufficient space');
    });

    test('should cleanup old snapshots when max exceeded', async () => {
      const { exec } = await import('child_process');
      
      // Setup existing checkpoints
      for (let i = 1; i <= 6; i++) {
        zfsManager.checkpoints.set(12340 + i, {
          snapshot: `test/honeygraph@test-cp_${12340 + i}_QmTest${i}`,
          blockNum: 12340 + i,
          ipfsHash: `QmTest${i}...`,
          createdAt: new Date(Date.now() - (6 - i) * 1000) // Staggered times
        });
      }

      exec.mockImplementation((cmd, callback) => {
        if (cmd.includes('zfs list')) {
          const snapshots = Array.from({length: 6}, (_, i) => 
            `test/honeygraph@test-cp_${12341 + i}_QmTest${i + 1} ${new Date(Date.now() - (5 - i) * 1000).toISOString()} 1M 10M`
          ).join('\n');
          callback(null, { stdout: snapshots, stderr: '' });
        } else if (cmd.includes('zfs destroy')) {
          callback(null, { stdout: '', stderr: '' });
        } else if (cmd.includes('zfs snapshot')) {
          callback(null, { stdout: '', stderr: '' });
        }
      });

      await zfsManager.createCheckpoint(12347, 'QmTest7...');

      // Should have called destroy for oldest snapshots
      const destroyCalls = exec.mock.calls.filter(call => call[0].includes('zfs destroy'));
      expect(destroyCalls.length).toBeGreaterThan(0);
    });
  });

  describe('ZFS Rollback Operations', () => {
    beforeEach(() => {
      // Setup test checkpoints
      zfsManager.checkpoints.set(12340, {
        snapshot: 'test/honeygraph@test-cp_12340_QmOld123',
        blockNum: 12340,
        ipfsHash: 'QmOld123...',
        createdAt: new Date(Date.now() - 60000)
      });

      zfsManager.checkpoints.set(12345, {
        snapshot: 'test/honeygraph@test-cp_12345_QmTarget',
        blockNum: 12345,
        ipfsHash: 'QmTarget...',
        createdAt: new Date(Date.now() - 30000)
      });

      zfsManager.checkpoints.set(12350, {
        snapshot: 'test/honeygraph@test-cp_12350_QmNew123',
        blockNum: 12350,
        ipfsHash: 'QmNew123...',
        createdAt: new Date()
      });
    });

    test('should successfully rollback to target checkpoint', async () => {
      const { exec } = await import('child_process');
      exec.mockImplementation((cmd, callback) => {
        if (cmd.includes('docker-compose stop')) {
          callback(null, { stdout: 'Stopping dgraph services...', stderr: '' });
        } else if (cmd.includes('zfs rollback')) {
          expect(cmd).toContain('test/honeygraph@test-cp_12345_QmTarget');
          callback(null, { stdout: '', stderr: '' });
        } else if (cmd.includes('docker-compose start')) {
          callback(null, { stdout: 'Starting dgraph services...', stderr: '' });
        } else if (cmd.includes('curl') && cmd.includes('health')) {
          callback(null, { stdout: '{"status":"OK"}', stderr: '' });
        }
      });

      const result = await zfsManager.rollbackToCheckpoint(12345);

      expect(result.success).toBe(true);
      expect(result.rolledBackTo.blockNum).toBe(12345);
      
      // Should remove newer checkpoints
      expect(zfsManager.checkpoints.has(12350)).toBe(false);
      expect(zfsManager.checkpoints.has(12345)).toBe(true);
      expect(zfsManager.checkpoints.has(12340)).toBe(true);
    });

    test('should handle rollback to non-existent checkpoint', async () => {
      await expect(zfsManager.rollbackToCheckpoint(99999))
        .rejects.toThrow('No checkpoint found for block 99999');
    });

    test('should handle Dgraph service failures during rollback', async () => {
      const { exec } = await import('child_process');
      exec.mockImplementation((cmd, callback) => {
        if (cmd.includes('docker-compose stop')) {
          callback(new Error('Failed to stop Dgraph'));
        }
      });

      await expect(zfsManager.rollbackToCheckpoint(12345))
        .rejects.toThrow('Failed to stop Dgraph');
    });

    test('should handle ZFS rollback command failure', async () => {
      const { exec } = await import('child_process');
      exec.mockImplementation((cmd, callback) => {
        if (cmd.includes('docker-compose stop')) {
          callback(null, { stdout: '', stderr: '' });
        } else if (cmd.includes('zfs rollback')) {
          callback(new Error('ZFS rollback failed: snapshot in use'));
        }
      });

      await expect(zfsManager.rollbackToCheckpoint(12345))
        .rejects.toThrow('ZFS rollback failed: snapshot in use');
    });

    test('should wait for Dgraph to be ready after restart', async () => {
      const { exec } = await import('child_process');
      let healthCheckAttempts = 0;
      
      exec.mockImplementation((cmd, callback) => {
        if (cmd.includes('docker-compose stop')) {
          callback(null, { stdout: '', stderr: '' });
        } else if (cmd.includes('zfs rollback')) {
          callback(null, { stdout: '', stderr: '' });
        } else if (cmd.includes('docker-compose start')) {
          callback(null, { stdout: '', stderr: '' });
        } else if (cmd.includes('curl') && cmd.includes('health')) {
          healthCheckAttempts++;
          if (healthCheckAttempts < 3) {
            callback(new Error('Connection refused'));
          } else {
            callback(null, { stdout: '{"status":"OK"}', stderr: '' });
          }
        }
      });

      const result = await zfsManager.rollbackToCheckpoint(12345);
      expect(result.success).toBe(true);
      expect(healthCheckAttempts).toBe(3);
    });
  });

  describe('Checkpoint Cloning', () => {
    beforeEach(() => {
      zfsManager.checkpoints.set(12345, {
        snapshot: 'test/honeygraph@test-cp_12345_QmTarget',
        blockNum: 12345,
        ipfsHash: 'QmTarget...',
        createdAt: new Date()
      });
    });

    test('should create clone for testing', async () => {
      const { exec } = await import('child_process');
      exec.mockImplementation((cmd, callback) => {
        if (cmd.includes('zfs clone')) {
          expect(cmd).toContain('test/honeygraph@test-cp_12345_QmTarget');
          expect(cmd).toContain('test/honeygraph_testing');
          callback(null, { stdout: '', stderr: '' });
        }
      });

      const result = await zfsManager.cloneCheckpoint(12345, 'testing');

      expect(result.success).toBe(true);
      expect(result.cloneDataset).toBe('test/honeygraph_testing');
      expect(result.sourceCheckpoint.blockNum).toBe(12345);
    });

    test('should handle clone failure', async () => {
      const { exec } = await import('child_process');
      exec.mockImplementation((cmd, callback) => {
        if (cmd.includes('zfs clone')) {
          callback(new Error('Clone failed: dataset already exists'));
        }
      });

      await expect(zfsManager.cloneCheckpoint(12345, 'testing'))
        .rejects.toThrow('Clone failed: dataset already exists');
    });
  });

  describe('Write Stream Checkpoint Integration', () => {
    test('should validate write marker boundaries for checkpoint', () => {
      const validFork = {
        operations: [
          { type: 'put', blockNum: 12344, path: '/state/alice', data: { balance: 100 } },
          { type: 'del', blockNum: 12344, path: '/state/bob' },
          { type: 'write_marker', blockNum: 12344, index: 10 }
        ]
      };

      const isValid = wsForkHandler.validateCheckpointBoundary(validFork, 12345);
      expect(isValid).toBe(true);
    });

    test('should reject checkpoint with operations after write marker', () => {
      const invalidFork = {
        operations: [
          { type: 'put', blockNum: 12344, path: '/state/alice', data: { balance: 100 } },
          { type: 'write_marker', blockNum: 12344, index: 10 },
          { type: 'put', blockNum: 12344, path: '/state/charlie', data: { balance: 50 } }
        ]
      };

      const isValid = wsForkHandler.validateCheckpointBoundary(invalidFork, 12345);
      expect(isValid).toBe(false);
    });

    test('should reject checkpoint with no write marker', () => {
      const invalidFork = {
        operations: [
          { type: 'put', blockNum: 12344, path: '/state/alice', data: { balance: 100 } },
          { type: 'del', blockNum: 12344, path: '/state/bob' }
        ]
      };

      const isValid = wsForkHandler.validateCheckpointBoundary(invalidFork, 12345);
      expect(isValid).toBe(false);
    });

    test('should reject checkpoint with wrong block number in write marker', () => {
      const invalidFork = {
        operations: [
          { type: 'put', blockNum: 12344, path: '/state/alice', data: { balance: 100 } },
          { type: 'write_marker', blockNum: 12343, index: 10 } // Wrong block number
        ]
      };

      const isValid = wsForkHandler.validateCheckpointBoundary(invalidFork, 12345);
      expect(isValid).toBe(false);
    });
  });

  describe('End-to-End Checkpoint Scenarios', () => {
    test('should handle complete checkpoint creation flow', async () => {
      const { exec } = await import('child_process');
      exec.mockImplementation((cmd, callback) => {
        if (cmd.includes('zfs snapshot')) {
          callback(null, { stdout: '', stderr: '' });
        }
      });

      // 1. Create operations leading to checkpoint
      const blockData = {
        blockNum: 12345,
        blockHash: 'QmBlock123...',
        forkId: 'QmFork123...',
        isLib: true
      };

      // 2. Process through replication queue
      await replicationQueue.createCheckpoint(blockData);

      // 3. Verify ZFS checkpoint was created
      expect(zfsManager.checkpoints.has(12345)).toBe(true);
      
      const checkpoint = zfsManager.checkpoints.get(12345);
      expect(checkpoint.blockNum).toBe(12345);
      expect(checkpoint.snapshot).toContain('test-cp_12345');
    });

    test('should handle checkpoint rollback recovery scenario', async () => {
      const { exec } = await import('child_process');
      
      // Setup: Create checkpoints at blocks 12340, 12345, 12350
      const checkpoints = [
        { blockNum: 12340, hash: 'QmCheckpoint1...' },
        { blockNum: 12345, hash: 'QmCheckpoint2...' },
        { blockNum: 12350, hash: 'QmCheckpoint3...' }
      ];

      for (const cp of checkpoints) {
        exec.mockImplementation((cmd, callback) => {
          if (cmd.includes('zfs snapshot')) {
            callback(null, { stdout: '', stderr: '' });
          }
        });
        await zfsManager.createCheckpoint(cp.blockNum, cp.hash);
      }

      expect(zfsManager.checkpoints.size).toBe(3);

      // Scenario: Rollback to block 12345 due to fork issue
      exec.mockImplementation((cmd, callback) => {
        if (cmd.includes('docker-compose stop')) {
          callback(null, { stdout: '', stderr: '' });
        } else if (cmd.includes('zfs rollback')) {
          callback(null, { stdout: '', stderr: '' });
        } else if (cmd.includes('docker-compose start')) {
          callback(null, { stdout: '', stderr: '' });
        } else if (cmd.includes('curl') && cmd.includes('health')) {
          callback(null, { stdout: '{"status":"OK"}', stderr: '' });
        }
      });

      const result = await zfsManager.rollbackToCheckpoint(12345);

      expect(result.success).toBe(true);
      expect(zfsManager.checkpoints.size).toBe(2); // 12340 and 12345 remain
      expect(zfsManager.checkpoints.has(12350)).toBe(false);
    });

    test('should handle concurrent checkpoint operations', async () => {
      const { exec } = await import('child_process');
      exec.mockImplementation((cmd, callback) => {
        // Simulate delay for concurrent operations
        setTimeout(() => {
          if (cmd.includes('zfs snapshot')) {
            callback(null, { stdout: '', stderr: '' });
          }
        }, Math.random() * 100);
      });

      // Create multiple checkpoints concurrently
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(zfsManager.createCheckpoint(12340 + i, `QmTest${i}...`));
      }

      const results = await Promise.allSettled(promises);
      
      // All should succeed
      results.forEach(result => {
        expect(result.status).toBe('fulfilled');
        expect(result.value.success).toBe(true);
      });

      expect(zfsManager.checkpoints.size).toBe(5);
    });
  });

  describe('Checkpoint Validation and Recovery', () => {
    test('should validate checkpoint consistency', async () => {
      const { exec } = await import('child_process');
      
      // Setup two checkpoints for comparison
      zfsManager.checkpoints.set(12340, {
        snapshot: 'test/honeygraph@test-cp_12340_QmOld',
        blockNum: 12340,
        ipfsHash: 'QmOld...',
        createdAt: new Date(Date.now() - 60000)
      });

      zfsManager.checkpoints.set(12345, {
        snapshot: 'test/honeygraph@test-cp_12345_QmNew',
        blockNum: 12345,
        ipfsHash: 'QmNew...',
        createdAt: new Date()
      });

      exec.mockImplementation((cmd, callback) => {
        if (cmd.includes('zfs diff')) {
          const diffOutput = [
            'M /dgraph/data/state.json',
            '+ /dgraph/data/new_file.json',
            '- /dgraph/data/old_file.json'
          ].join('\n');
          callback(null, { stdout: diffOutput, stderr: '' });
        }
      });

      const diff = await zfsManager.diffCheckpoints(12340, 12345);

      expect(diff.from.blockNum).toBe(12340);
      expect(diff.to.blockNum).toBe(12345);
      expect(diff.differences).toHaveLength(3);
      expect(diff.differences[0]).toContain('state.json');
    });

    test('should recover from corrupted checkpoint', async () => {
      const { exec } = await import('child_process');
      
      // Setup scenario where rollback fails due to corruption
      zfsManager.checkpoints.set(12345, {
        snapshot: 'test/honeygraph@test-cp_12345_QmCorrupted',
        blockNum: 12345,
        ipfsHash: 'QmCorrupted...',
        createdAt: new Date()
      });

      exec.mockImplementation((cmd, callback) => {
        if (cmd.includes('docker-compose stop')) {
          callback(null, { stdout: '', stderr: '' });
        } else if (cmd.includes('zfs rollback')) {
          callback(new Error('Rollback failed: snapshot corrupted'));
        }
      });

      await expect(zfsManager.rollbackToCheckpoint(12345))
        .rejects.toThrow('Rollback failed: snapshot corrupted');

      // In a real scenario, this would trigger recovery from peer nodes
      // or fallback to an earlier checkpoint
    });

    test('should handle missing write marker validation', () => {
      const mockWebSocket = {
        nodeId: 'test-node-1',
        send: jest.fn(),
        authenticated: true
      };

      // Setup fork with missing write marker
      const forkMessage = {
        type: 'fork_start',
        forkHash: 'QmForkNoMarker...',
        blockNum: 12345,
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(mockWebSocket, forkMessage);

      // Add some operations without write marker
      const operation = {
        type: 'put',
        forkHash: 'QmForkNoMarker...',
        blockNum: 12345,
        index: 1,
        path: '/state/test',
        data: { value: 'test' },
        timestamp: Date.now()
      };
      wsForkHandler.handleMessage(mockWebSocket, operation);

      // Try to send checkpoint without proper write marker
      const checkpointMessage = {
        type: 'sendCheckpoint',
        blockNum: 12346,
        hash: 'QmCheckpointInvalid...',
        prevHash: 'QmForkNoMarker...',
        timestamp: Date.now()
      };

      const eventSpy = jest.fn();
      wsForkHandler.on('checkpoint:invalid', eventSpy);

      wsForkHandler.handleMessage(mockWebSocket, checkpointMessage);

      expect(eventSpy).toHaveBeenCalledWith({
        reason: 'missing_write_marker',
        forkHash: 'QmForkNoMarker...',
        blockNum: 12346,
        nodeId: 'test-node-1'
      });
    });
  });
});