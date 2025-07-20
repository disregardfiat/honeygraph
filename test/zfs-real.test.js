import { jest } from '@jest/globals';
import { ZFSCheckpointManager } from '../lib/zfs-checkpoint.js';
import { getTestEnvironment } from './utils/test-helpers.js';

// Only run these tests if ZFS is available
const testEnv = getTestEnvironment();
const describeZFS = testEnv.hasZFS ? describe : describe.skip;

describeZFS('ZFS Real Operations', () => {
  let zfsManager;
  let testDataset;

  beforeAll(async () => {
    if (!testEnv.hasZFS) {
      console.log('Skipping ZFS tests - ZFS not available');
      return;
    }

    testDataset = testEnv.dataset;
    console.log(`Using ZFS dataset: ${testDataset}`);

    zfsManager = new ZFSCheckpointManager({
      dataset: testDataset,
      snapshotPrefix: 'real-test',
      maxSnapshots: 5
    });

    // Load existing checkpoints
    await zfsManager.loadExistingCheckpoints();
  });

  afterEach(async () => {
    if (!testEnv.hasZFS) return;

    // Cleanup test snapshots
    try {
      const { execSync } = await import('child_process');
      execSync(`sudo zfs list -t snapshot -o name -H | grep "${testDataset}@real-test" | xargs -r sudo zfs destroy`, 
               { stdio: 'ignore' });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should create real ZFS checkpoint', async () => {
    if (!testEnv.hasZFS) return;

    const blockNum = 99001;
    const ipfsHash = 'QmRealTest123456789abcdef';

    const result = await zfsManager.createCheckpoint(blockNum, ipfsHash);

    expect(result.success).toBe(true);
    expect(result.blockNum).toBe(blockNum);
    expect(result.snapshot).toContain('real-test_99001');

    // Verify snapshot exists in ZFS
    const { execSync } = await import('child_process');
    const snapshots = execSync(`sudo zfs list -t snapshot -o name -H | grep "${testDataset}@real-test_99001"`, 
                               { encoding: 'utf8' });
    expect(snapshots.trim()).toBeTruthy();
  });

  test('should perform real ZFS rollback', async () => {
    if (!testEnv.hasZFS) return;

    // Create two checkpoints
    const blockNum1 = 99002;
    const blockNum2 = 99003;

    await zfsManager.createCheckpoint(blockNum1, 'QmRealTest1...');
    await zfsManager.createCheckpoint(blockNum2, 'QmRealTest2...');

    expect(zfsManager.checkpoints.size).toBeGreaterThanOrEqual(2);

    // Rollback to first checkpoint
    const result = await zfsManager.rollbackToCheckpoint(blockNum1);

    expect(result.success).toBe(true);
    expect(result.rolledBackTo.blockNum).toBe(blockNum1);

    // Verify newer checkpoint was removed from tracking
    expect(zfsManager.checkpoints.has(blockNum2)).toBe(false);
    expect(zfsManager.checkpoints.has(blockNum1)).toBe(true);
  });

  test('should create and verify ZFS clone', async () => {
    if (!testEnv.hasZFS) return;

    const blockNum = 99004;
    await zfsManager.createCheckpoint(blockNum, 'QmRealTest3...');

    const cloneName = 'test-clone';
    const result = await zfsManager.cloneCheckpoint(blockNum, cloneName);

    expect(result.success).toBe(true);
    expect(result.cloneDataset).toBe(`${testDataset}_${cloneName}`);

    // Verify clone exists
    const { execSync } = await import('child_process');
    const datasets = execSync(`sudo zfs list -o name -H | grep "${testDataset}_${cloneName}"`, 
                              { encoding: 'utf8' });
    expect(datasets.trim()).toBeTruthy();

    // Cleanup clone
    try {
      execSync(`sudo zfs destroy ${testDataset}_${cloneName}`, { stdio: 'ignore' });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should list existing checkpoints', async () => {
    if (!testEnv.hasZFS) return;

    // Create a checkpoint
    await zfsManager.createCheckpoint(99005, 'QmRealTest4...');

    const checkpoints = await zfsManager.listCheckpoints();

    expect(Array.isArray(checkpoints)).toBe(true);
    expect(checkpoints.length).toBeGreaterThan(0);

    const ourCheckpoint = checkpoints.find(cp => cp.name.includes('real-test_99005'));
    expect(ourCheckpoint).toBeDefined();
  });

  test('should handle ZFS diff between checkpoints', async () => {
    if (!testEnv.hasZFS) return;

    // Create two checkpoints
    const blockNum1 = 99006;
    const blockNum2 = 99007;

    await zfsManager.createCheckpoint(blockNum1, 'QmRealTest5...');
    
    // Small delay to ensure different creation times
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await zfsManager.createCheckpoint(blockNum2, 'QmRealTest6...');

    const diff = await zfsManager.diffCheckpoints(blockNum1, blockNum2);

    expect(diff.from.blockNum).toBe(blockNum1);
    expect(diff.to.blockNum).toBe(blockNum2);
    expect(Array.isArray(diff.differences)).toBe(true);
  });

  test('should handle rollback failure gracefully', async () => {
    if (!testEnv.hasZFS) return;

    // Try to rollback to non-existent checkpoint
    await expect(zfsManager.rollbackToCheckpoint(99999))
      .rejects.toThrow('No checkpoint found for block 99999');
  });

  test('should get checkpoint by IPFS hash', async () => {
    if (!testEnv.hasZFS) return;

    const blockNum = 99008;
    const ipfsHash = 'QmUniqueHash123...';

    await zfsManager.createCheckpoint(blockNum, ipfsHash);

    const found = await zfsManager.getCheckpointByHash(ipfsHash);

    expect(found).toBeDefined();
    expect(found.blockNum).toBe(blockNum);
    expect(found.ipfsHash).toContain(ipfsHash.substring(0, 8));
  });

  test('should handle cleanup of old snapshots', async () => {
    if (!testEnv.hasZFS) return;

    // Create more snapshots than the limit
    const maxSnapshots = zfsManager.maxSnapshots;
    
    for (let i = 0; i < maxSnapshots + 2; i++) {
      await zfsManager.createCheckpoint(99100 + i, `QmCleanup${i}...`);
      // Small delay between snapshots
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Trigger cleanup
    await zfsManager.cleanupOldSnapshots();

    // Should have cleaned up to max limit
    const checkpoints = await zfsManager.listCheckpoints();
    const ourCheckpoints = checkpoints.filter(cp => cp.name.includes('real-test_991'));
    
    expect(ourCheckpoints.length).toBeLessThanOrEqual(maxSnapshots);
  });

  test('should load existing checkpoints on initialization', async () => {
    if (!testEnv.hasZFS) return;

    // Create a checkpoint
    await zfsManager.createCheckpoint(99200, 'QmLoad123...');

    // Create new manager instance
    const newManager = new ZFSCheckpointManager({
      dataset: testDataset,
      snapshotPrefix: 'real-test',
      maxSnapshots: 5
    });

    // Load existing checkpoints
    await newManager.loadExistingCheckpoints();

    // Should have loaded our checkpoint
    expect(newManager.checkpoints.size).toBeGreaterThan(0);
    expect(newManager.checkpoints.has(99200)).toBe(true);
  });
});

// Test environment information
test('should detect test environment correctly', () => {
  const env = getTestEnvironment();
  
  expect(env).toHaveProperty('hasZFS');
  expect(env).toHaveProperty('hasRedis');
  expect(env).toHaveProperty('isDocker');
  expect(env).toHaveProperty('dataset');
  
  console.log('Test environment detected:', {
    hasZFS: env.hasZFS,
    hasRedis: env.hasRedis,
    isDocker: env.isDocker,
    dataset: env.dataset
  });
});