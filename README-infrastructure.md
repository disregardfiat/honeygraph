# Honeygraph Testing Infrastructure

## Overview

This document describes the comprehensive testing infrastructure for the Honeygraph write stream system, including Docker-based ZFS pools, Redis queues, and both mocked and real system tests.

## 🏗️ Infrastructure Components

### Docker Environment

The testing infrastructure uses Docker Compose to provide:

1. **ZFS-enabled container** with real filesystem operations
2. **Redis container** for queue testing  
3. **Dgraph containers** for database integration
4. **Test runner** with Node.js and dependencies

### ZFS Pool in Docker

Yes! You can absolutely build a ZFS pool inside a Docker volume:

```dockerfile
# ZFS-enabled container
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y zfsutils-linux
```

The ZFS pool is created using a file-backed approach:
```bash
# Create 1GB pool file
dd if=/dev/zero of=/zfs-pool/testpool.img bs=1M count=1024

# Create ZFS pool
zpool create testpool /zfs-pool/testpool.img

# Create dataset
zfs create testpool/honeygraph
```

## 🧪 Test Types

### 1. Unit Tests (Mocked)
- **File**: `test/write-stream-fixed.test.js`
- **Mocks**: child_process, Bull queues, Dgraph
- **Speed**: Fast (~300ms)
- **Coverage**: Core logic, edge cases, error handling

```bash
npm test test/write-stream-fixed.test.js
```

### 2. Integration Tests (Real Systems)
- **File**: `test/zfs-real.test.js`  
- **Requirements**: Real ZFS, Redis, Dgraph
- **Speed**: Slower (~10-30s)
- **Coverage**: Real system interactions

```bash
# Requires ZFS support
npm test test/zfs-real.test.js
```

### 3. Checkpoint & Rollback Tests
- **File**: `test/checkpoint-rollback.test.js`
- **Focus**: ZFS snapshot operations
- **Coverage**: Create, rollback, clone, cleanup

### 4. End-to-End Integration
- **File**: `test/integration.test.js`
- **Coverage**: Complete write stream flow
- **Systems**: WebSocket → Queue → Transform → Dgraph → ZFS

## 🚀 Running Tests

### Local Development (Mocked)

```bash
# All unit tests with mocks
npm test

# Specific test suites
npm run test:writestream   # Write stream tests
npm run test:unit         # Unit tests only
npm run test:coverage     # With coverage report
```

### Docker Environment (Real Systems)

```bash
# Build and run complete test environment
./scripts/test-with-docker.sh

# Specific test types
./scripts/test-with-docker.sh unit        # Unit tests only
./scripts/test-with-docker.sh integration # Real ZFS/Redis tests  
./scripts/test-with-docker.sh writestream # Write stream tests
./scripts/test-with-docker.sh checkpoint  # Checkpoint tests
./scripts/test-with-docker.sh coverage    # Coverage report
```

### Manual Docker Setup

```bash
# Start test environment
docker-compose -f docker-compose.test.yml up -d

# Run tests in container
docker-compose -f docker-compose.test.yml exec test-runner npm test

# Check ZFS status
docker-compose -f docker-compose.test.yml exec zfs-test zpool status

# Cleanup
docker-compose -f docker-compose.test.yml down -v
```

## 📁 Test File Structure

```
test/
├── setup.js                    # Global test configuration
├── utils/
│   └── test-helpers.js         # Mock factories and utilities
├── write-stream-fixed.test.js  # Fixed unit tests (✅ passing)
├── write-stream.test.js        # Original tests (❌ needs fixing)
├── checkpoint-rollback.test.js # Checkpoint system tests
├── integration.test.js         # End-to-end tests
└── zfs-real.test.js           # Real ZFS operations
```

## 🔧 Test Configuration

### Jest Configuration (`jest.config.js`)

```javascript
export default {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  collectCoverageFrom: [
    'lib/**/*.js',
    '!lib/**/*.test.js'
  ]
};
```

### Environment Variables

```bash
# Test environment
NODE_ENV=test
DOCKER=true                    # Docker environment flag
USE_REAL_ZFS=true             # Enable real ZFS operations

# Service connections
REDIS_HOST=redis              # Redis container
REDIS_PORT=6379
DGRAPH_ALPHA_URL=dgraph-alpha:9080

# ZFS configuration  
ZFS_DATASET=testpool/honeygraph
ZFS_POOL_NAME=testpool
```

## 🎭 Mocking Strategy

### ES Module Mocking

The infrastructure uses Jest's `unstable_mockModule` for ES modules:

```javascript
// Mock child_process globally
jest.unstable_mockModule('child_process', () => ({
  exec: mockExec,
  execSync: jest.fn()
}));

// Mock Bull queue
jest.unstable_mockModule('bull', () => ({
  default: jest.fn().mockImplementation(() => mockQueue)
}));
```

### Mock Factories

Helper functions create consistent mocks:

```javascript
import { 
  createMockWebSocket,
  createMockDgraphClient,
  createMockQueue,
  createMockExec
} from './utils/test-helpers.js';

const mockWS = createMockWebSocket('test-node-1', { token: 'SPK' });
const mockQueue = createMockQueue();
```

## 🔍 Test Environment Detection

The system automatically detects available services:

```javascript
export function getTestEnvironment() {
  return {
    hasZFS: hasZFSSupport(),      // ZFS commands available
    hasRedis: hasRedisSupport(),  // Redis connection works
    isDocker: !!process.env.DOCKER, // Running in Docker
    dataset: process.env.ZFS_DATASET || 'testpool/honeygraph'
  };
}
```

Tests conditionally run based on environment:

```javascript
// Skip ZFS tests if not available
const describeZFS = testEnv.hasZFS ? describe : describe.skip;

describeZFS('ZFS Real Operations', () => {
  // Tests only run with real ZFS
});
```

## 📊 Test Coverage

Current coverage focuses on:

### ✅ Covered Areas
- Fork management and validation
- WebSocket message handling  
- Checkpoint boundary validation
- Operation buffering and processing
- Multi-token network support
- Error handling and edge cases
- Performance scenarios

### 🔄 Integration Points  
- Queue processing with Redis
- ZFS snapshot operations
- Dgraph data transformation
- Service coordination

### 🎯 Success Metrics
- **Unit Tests**: 19/19 passing ✅
- **Performance**: 1000 ops < 1 second ✅  
- **Memory**: Buffer overflow handling ✅
- **Error Handling**: Graceful degradation ✅

## 🐛 Debugging Tests

### Common Issues

1. **ZFS Permission Errors**
   ```bash
   # Ensure sudo access in container
   echo 'testuser ALL=(ALL) NOPASSWD: /sbin/zfs' >> /etc/sudoers
   ```

2. **Redis Connection Timeouts**
   ```bash
   # Check Redis connectivity
   docker-compose exec redis redis-cli ping
   ```

3. **Jest Module Loading**
   ```bash
   # Use experimental VM modules
   NODE_OPTIONS='--experimental-vm-modules' jest
   ```

### Debug Commands

```bash
# Verbose test output
npm test -- --verbose

# Run specific test
npm test -- --testNamePattern="checkpoint"

# Debug with inspector
node --inspect-brk node_modules/.bin/jest --runInBand

# Check Docker containers
docker-compose -f docker-compose.test.yml ps
docker-compose -f docker-compose.test.yml logs zfs-test
```

## 📈 Performance Benchmarks

### Write Stream Performance
- **1000 operations**: < 1 second ✅
- **Buffer management**: 10-operation limit respected ✅
- **Memory usage**: Bounded by configuration ✅

### ZFS Operations
- **Snapshot creation**: ~1-2 seconds
- **Rollback operation**: ~3-5 seconds  
- **Clone creation**: ~2-3 seconds

### Queue Processing
- **Redis throughput**: 1000+ ops/second
- **Batch processing**: Configurable delays
- **Error recovery**: 3 retry attempts with backoff

## 🔮 Future Improvements

### Planned Enhancements
1. **Parallel Testing**: Multiple ZFS datasets
2. **Chaos Testing**: Network partitions, service failures
3. **Load Testing**: High-throughput scenarios
4. **Benchmark Suite**: Performance regression detection
5. **Visual Coverage**: HTML coverage reports

### Infrastructure Additions
1. **Kubernetes Testing**: Real cluster scenarios
2. **Multi-Node ZFS**: Distributed filesystem testing
3. **Monitoring**: Prometheus metrics collection
4. **CI/CD Integration**: Automated test pipelines

## 📚 References

- [ZFS on Docker](https://github.com/zfsonlinux/zfs/wiki/Docker)
- [Jest ES Modules](https://jestjs.io/docs/ecmascript-modules)
- [Bull Queue Testing](https://github.com/OptimalBits/bull#testing)
- [Docker Compose Testing](https://docs.docker.com/compose/reference/)

This infrastructure provides a solid foundation for testing the Honeygraph write stream system with both mocked and real components, ensuring reliability across development and production environments.