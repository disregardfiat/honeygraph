#!/bin/bash

# Test runner script for Honeygraph with Docker ZFS support

set -e

echo "🚀 Starting Honeygraph test environment with ZFS support..."

# Build and start test environment
echo "📦 Building Docker containers..."
docker-compose -f docker-compose.test.yml build

echo "🔧 Starting services..."
docker-compose -f docker-compose.test.yml up -d redis dgraph-zero dgraph-alpha zfs-test

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check Redis
echo "🔍 Checking Redis..."
docker-compose -f docker-compose.test.yml exec -T redis redis-cli ping

# Check Dgraph
echo "🔍 Checking Dgraph..."
timeout 30 bash -c 'until curl -f http://localhost:8080/health; do sleep 1; done'

# Check ZFS
echo "🔍 Checking ZFS setup..."
docker-compose -f docker-compose.test.yml exec -T zfs-test zpool status testpool

echo "✅ All services ready!"

# Run tests based on argument
TEST_TYPE=${1:-all}

case $TEST_TYPE in
  "unit")
    echo "🧪 Running unit tests (mocked)..."
    docker-compose -f docker-compose.test.yml run --rm test-runner npm run test:unit
    ;;
  "integration")
    echo "🧪 Running integration tests with real ZFS..."
    docker-compose -f docker-compose.test.yml run --rm test-runner \
      bash -c "
        export DOCKER=true
        export USE_REAL_ZFS=true
        npm run test:integration
      "
    ;;
  "writestream")
    echo "🧪 Running write stream tests..."
    docker-compose -f docker-compose.test.yml run --rm test-runner \
      bash -c "
        export DOCKER=true
        npm test test/write-stream-fixed.test.js
      "
    ;;
  "checkpoint")
    echo "🧪 Running checkpoint tests with real ZFS..."
    docker-compose -f docker-compose.test.yml run --rm test-runner \
      bash -c "
        export DOCKER=true
        export USE_REAL_ZFS=true
        npm run test:checkpoint
      "
    ;;
  "all")
    echo "🧪 Running all tests..."
    
    echo "📋 1. Unit tests (mocked)..."
    docker-compose -f docker-compose.test.yml run --rm test-runner npm run test:unit
    
    echo "📋 2. Write stream tests..."
    docker-compose -f docker-compose.test.yml run --rm test-runner \
      bash -c "export DOCKER=true; npm test test/write-stream-fixed.test.js"
    
    echo "📋 3. Integration tests..."
    docker-compose -f docker-compose.test.yml run --rm test-runner \
      bash -c "
        export DOCKER=true
        export USE_REAL_ZFS=true
        npm run test:integration
      "
    ;;
  "coverage")
    echo "🧪 Running tests with coverage..."
    docker-compose -f docker-compose.test.yml run --rm test-runner \
      bash -c "export DOCKER=true; npm run test:coverage"
    ;;
  *)
    echo "❌ Unknown test type: $TEST_TYPE"
    echo "Usage: $0 [unit|integration|writestream|checkpoint|all|coverage]"
    exit 1
    ;;
esac

TEST_EXIT_CODE=$?

# Cleanup
echo "🧹 Cleaning up..."
docker-compose -f docker-compose.test.yml down -v

if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo "✅ Tests completed successfully!"
else
  echo "❌ Tests failed with exit code $TEST_EXIT_CODE"
fi

exit $TEST_EXIT_CODE