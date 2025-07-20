# Honeygraph Testing Guide

## Overview

This guide covers testing the Honeygraph write stream system with checkpoint markers and rollback functionality. The test suite ensures the system correctly handles WebSocket streams, validates checkpoint boundaries, and performs ZFS-based rollbacks.

## Test Structure

### Test Files

- **`test/write-stream.test.js`**: Core write stream functionality tests
- **`test/checkpoint-rollback.test.js`**: Checkpoint creation and rollback tests  
- **`test/integration.test.js`**: End-to-end integration tests

### Test Categories

1. **Unit Tests**: Individual component testing
2. **Integration Tests**: Component interaction testing
3. **Performance Tests**: Load and stress testing
4. **Error Handling Tests**: Failure scenario validation

## Running Tests

### All Tests
```bash
npm test
```

### Specific Test Suites
```bash
# Write stream tests only
npm run test:writestream

# Checkpoint and rollback tests only  
npm run test:checkpoint

# Integration tests only
npm run test:integration

# Unit tests only (excludes integration)
npm run test:unit
```

### Coverage Reports
```bash
npm run test:coverage
```

### Watch Mode
```bash
npm run test:watch
```

## Test Configuration

### Environment Variables
```bash
# Test environment
NODE_ENV=test

# Redis for queue testing
REDIS_HOST=localhost
REDIS_PORT=6379

# Dgraph for integration testing
DGRAPH_ALPHA_URL=localhost:9080

# ZFS testing (requires sudo access)
ZFS_DATASET=test/honeygraph
```

### Mock Dependencies

Tests use comprehensive mocking for:
- **child_process.exec**: ZFS command mocking
- **Dgraph clients**: Database operation mocking
- **Redis/Bull queues**: Queue operation mocking  
- **WebSocket connections**: Connection state mocking

## Key Test Scenarios

### Write Stream Tests

#### Fork Management
```javascript
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
});
```

#### Operation Processing
```javascript
test('should handle put operation', () => {
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
});
```

#### Checkpoint Boundary Validation
```javascript
test('should validate checkpoint boundaries', () => {
  const fork = {
    operations: [
      { type: 'put', blockNum: 12344 },
      { type: 'write_marker', blockNum: 12344 }
    ]
  };

  const isValid = wsForkHandler.validateCheckpointBoundary(fork, 12345);
  expect(isValid).toBe(true);
});
```

### Checkpoint and Rollback Tests

#### ZFS Snapshot Creation
```javascript
test('should create checkpoint with proper naming', async () => {
  mockExec.mockImplementation((cmd, callback) => {
    if (cmd.includes('zfs snapshot')) {
      expect(cmd).toContain('test/honeygraph@test-cp_12345_QmTest123');
      callback(null, { stdout: '', stderr: '' });
    }
  });

  const result = await zfsManager.createCheckpoint(12345, 'QmTest123...');
  expect(result.success).toBe(true);
});
```

#### Rollback Process
```javascript
test('should successfully rollback to target checkpoint', async () => {
  mockExec.mockImplementation((cmd, callback) => {
    if (cmd.includes('zfs rollback')) {
      expect(cmd).toContain('test/honeygraph@test-cp_12345');
      callback(null, { stdout: '', stderr: '' });
    }
  });

  const result = await zfsManager.rollbackToCheckpoint(12345);
  expect(result.success).toBe(true);
});
```

### Integration Tests

#### Complete Flow
```javascript
test('should process complete block with operations and checkpoint', async () => {
  // 1. Start fork
  wsForkHandler.handleMessage(mockWebSocket, forkStart);
  
  // 2. Send operations
  operations.forEach(op => {
    wsForkHandler.handleMessage(mockWebSocket, op);
  });
  
  // 3. Send write marker
  wsForkHandler.handleMessage(mockWebSocket, writeMarker);
  
  // 4. Send checkpoint
  wsForkHandler.handleMessage(mockWebSocket, checkpoint);
  
  // Verify complete processing
  expect(fork.operations).toHaveLength(4);
  expect(fork.lastWriteMarker).toBeDefined();
});
```

## Error Handling Tests

### Invalid Checkpoint Boundaries
```javascript
test('should reject checkpoint with operations after write marker', () => {
  const invalidFork = {
    operations: [
      { type: 'put', blockNum: 12344 },
      { type: 'write_marker', blockNum: 12344 },
      { type: 'put', blockNum: 12344 } // Invalid: after write marker
    ]
  };

  const isValid = wsForkHandler.validateCheckpointBoundary(invalidFork, 12345);
  expect(isValid).toBe(false);
});
```

### ZFS Command Failures
```javascript
test('should handle ZFS command failures', async () => {
  mockExec.mockImplementation((cmd, callback) => {
    callback(new Error('ZFS command failed'));
  });

  await expect(zfsManager.createCheckpoint(12345, 'QmTest123...'))
    .rejects.toThrow('ZFS command failed');
});
```

### Queue Processing Errors
```javascript
test('should handle queue processing with retries', async () => {
  let attemptCount = 0;
  
  mockDgraphClient.writeOperation.mockImplementation(() => {
    attemptCount++;
    if (attemptCount <= 2) {
      return Promise.reject(new Error('Temporary failure'));
    }
    return Promise.resolve({ success: true });
  });

  // Should eventually succeed after retries
  const jobId = await replicationQueue.addOperation(operation);
  expect(jobId).toBeDefined();
});
```

## Performance Tests

### High-Frequency Operations
```javascript
test('should handle high-frequency operations', async () => {
  const operationCount = 1000;
  const startTime = Date.now();

  for (let i = 0; i < operationCount; i++) {
    wsForkHandler.handleMessage(mockWebSocket, operation);
  }

  const processingTime = Date.now() - startTime;
  expect(processingTime).toBeLessThan(5000); // 5 seconds max
});
```

### Buffer Management
```javascript
test('should handle buffer overflow correctly', async () => {
  const smallBufferHandler = new WSForkHandler({
    operationBufferSize: 10
  });

  // Send more operations than buffer size
  for (let i = 0; i < 20; i++) {
    smallBufferHandler.handleMessage(mockWebSocket, operation);
  }

  const fork = smallBufferHandler.forks.get('QmBufferFork...');
  expect(fork.operations.length).toBe(10); // Limited to buffer size
  expect(fork.operationCount).toBe(20); // Total count preserved
});
```

## Multi-Token Testing

### Network Isolation
```javascript
test('should handle network switch and multi-token operations', async () => {
  const spkNode = { token: 'SPK' };
  const larynxNode = { token: 'LARYNX' };

  // Create separate forks for different tokens
  wsForkHandler.handleMessage(spkNode, spkFork);
  wsForkHandler.handleMessage(larynxNode, larynxFork);

  // Verify token isolation
  expect(spkForkData.operations[0].token).toBe('SPK');
  expect(larynxForkData.operations[0].token).toBe('LARYNX');
});
```

## Fork Management Testing

### Consensus Handling
```javascript
test('should handle fork consensus and cleanup', async () => {
  // Create competing forks
  wsForkHandler.handleMessage(node1, forkA);
  wsForkHandler.handleMessage(node2, forkA);  
  wsForkHandler.handleMessage(node3, forkB);

  // Simulate consensus for Fork A
  wsForkHandler.handleMessage(node1, consensusCheckpoint);

  // Verify Fork A confirmed, Fork B removed
  expect(forkAData.isConfirmed).toBe(true);
  expect(wsForkHandler.forks.has('QmForkB...')).toBe(false);
});
```

### Node Disconnections
```javascript
test('should handle node disconnections gracefully', () => {
  wsForkHandler.handleMessage(node1, forkMessage);
  wsForkHandler.handleMessage(node2, forkMessage);

  expect(fork.nodes.size).toBe(2);

  wsForkHandler.handleDisconnect(node1);

  expect(fork.nodes.size).toBe(1);
  expect(fork.nodes.has('node-1')).toBe(false);
});
```

## Testing Best Practices

### Setup and Teardown
- Use `beforeEach()` for clean test state
- Mock external dependencies comprehensively
- Clean up resources in `afterEach()`

### Assertion Patterns
- Test both success and failure scenarios
- Verify side effects (events, state changes)
- Use specific matchers (`toHaveBeenCalledWith`)

### Async Testing
- Use `async/await` for promise-based operations
- Add appropriate timeouts for long-running tests
- Handle race conditions with proper synchronization

### Mock Management
- Reset mocks between tests
- Use implementation-specific mocks
- Verify mock call counts and arguments

## Debugging Tests

### Common Issues
1. **Async race conditions**: Add proper `await` statements
2. **Mock leakage**: Ensure `jest.clearAllMocks()` in teardown
3. **Timeout failures**: Increase timeout for slow operations
4. **Module import errors**: Check ES module configuration

### Debug Commands
```bash
# Run specific test with verbose output
npm test -- --testNamePattern="checkpoint" --verbose

# Run with debugging
node --inspect-brk node_modules/.bin/jest --runInBand

# Run single test file
npm test test/write-stream.test.js
```

### Test Coverage Analysis
```bash
# Generate coverage report
npm run test:coverage

# View coverage in browser
open coverage/lcov-report/index.html
```

## Continuous Integration

### GitHub Actions
```yaml
name: Test Suite
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
      - run: npm run test:coverage
```

### Test Environment Setup
- Redis container for queue testing
- Mock ZFS commands (no actual filesystem changes)
- Isolated test databases for integration tests

This comprehensive test suite ensures the Honeygraph write stream system functions correctly under all conditions and maintains data integrity through checkpoint and rollback operations.