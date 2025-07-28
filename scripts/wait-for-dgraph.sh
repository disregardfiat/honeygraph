#!/bin/bash

# Wait for Dgraph to be ready
echo "Waiting for Dgraph to be ready..."

MAX_ATTEMPTS=30
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if curl -s http://dgraph-alpha:8080/health > /dev/null 2>&1; then
        echo "Dgraph is ready!"
        exit 0
    fi
    
    ATTEMPT=$((ATTEMPT + 1))
    echo "Attempt $ATTEMPT/$MAX_ATTEMPTS - Dgraph not ready yet, waiting..."
    sleep 2
done

echo "ERROR: Dgraph failed to become ready after $MAX_ATTEMPTS attempts"
exit 1