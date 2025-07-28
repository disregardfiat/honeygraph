#!/bin/bash

# Honeygraph Multi-Tenant Startup Script
# This script initializes and starts the Honeygraph multi-tenant system

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
MULTI_TENANT="${MULTI_TENANT:-false}"
INIT_DATA="${INIT_DATA:-true}"
DROP_DATA="${DROP_DATA:-false}"
NETWORKS="${NETWORKS:-spkccT_,spkcc_,dlux_}"

echo -e "${GREEN}Honeygraph Multi-Tenant System Startup${NC}"
echo "========================================"

# Function to check if service is healthy
check_service_health() {
    local service=$1
    local max_attempts=30
    local attempt=1
    
    echo -n "Checking $service health..."
    
    while [ $attempt -le $max_attempts ]; do
        if docker-compose -f $COMPOSE_FILE ps | grep $service | grep -q "healthy"; then
            echo -e " ${GREEN}OK${NC}"
            return 0
        fi
        
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    echo -e " ${RED}FAILED${NC}"
    return 1
}

# Function to initialize schema
init_schema() {
    echo -e "${YELLOW}Initializing DGraph schema...${NC}"
    
    # Wait for DGraph to be ready
    sleep 10
    
    # Run schema initialization
    docker-compose -f $COMPOSE_FILE exec honeygraph-api1 node scripts/init-schema.js
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Schema initialized successfully${NC}"
    else
        echo -e "${RED}Schema initialization failed${NC}"
        return 1
    fi
}

# Function to import initial data
import_data() {
    echo -e "${YELLOW}Importing blockchain data...${NC}"
    
    docker-compose -f $COMPOSE_FILE exec honeygraph-api1 node scripts/import-blockchain-data.js
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Data import completed${NC}"
    else
        echo -e "${RED}Data import failed${NC}"
        return 1
    fi
}

# Check Docker and Docker Compose
echo "Checking prerequisites..."
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker is not installed${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Docker Compose is not installed${NC}"
    exit 1
fi

# Select compose file based on mode
if [ "$MULTI_TENANT" == "true" ]; then
    COMPOSE_FILE="docker-compose.multi-tenant.yml"
    echo -e "${YELLOW}Using multi-tenant configuration${NC}"
else
    echo -e "${YELLOW}Using single-node configuration${NC}"
fi

# Create necessary directories
echo "Creating directories..."
mkdir -p data/{zero,alpha,alpha1,alpha2,alpha3,redis,honeygraph}
mkdir -p logs/{api1,api2}
mkdir -p config
mkdir -p schema

# Check if config files exist
if [ ! -f "config/haproxy.cfg" ] && [ "$MULTI_TENANT" == "true" ]; then
    echo -e "${YELLOW}HAProxy config not found, using default${NC}"
fi

if [ ! -f "config/nginx.conf" ] && [ "$MULTI_TENANT" == "true" ]; then
    echo -e "${YELLOW}Nginx config not found, using default${NC}"
fi

# Stop existing containers
echo "Stopping existing containers..."
docker-compose -f $COMPOSE_FILE down

# Clean data if requested
if [ "$DROP_DATA" == "true" ]; then
    echo -e "${YELLOW}Cleaning existing data...${NC}"
    rm -rf data/zero/* data/alpha/* data/alpha1/* data/alpha2/* data/alpha3/* data/redis/*
fi

# Start services
echo -e "${YELLOW}Starting services...${NC}"
docker-compose -f $COMPOSE_FILE up -d

# Wait for services to be healthy
echo "Waiting for services to be ready..."

if [ "$MULTI_TENANT" == "true" ]; then
    check_service_health "dgraph-zero" || exit 1
    check_service_health "dgraph-alpha1" || exit 1
    check_service_health "dgraph-alpha2" || exit 1
    check_service_health "dgraph-alpha3" || exit 1
else
    check_service_health "dgraph-alpha" || exit 1
fi

check_service_health "honeygraph-api" || check_service_health "honeygraph-api1" || exit 1

# Initialize schema if needed
if [ "$INIT_DATA" == "true" ]; then
    init_schema || exit 1
fi

# Import data if requested
if [ "$INIT_DATA" == "true" ] && [ "$IMPORT_DATA" == "true" ]; then
    import_data || exit 1
fi

# Show service status
echo ""
echo -e "${GREEN}Services started successfully!${NC}"
echo ""
docker-compose -f $COMPOSE_FILE ps

# Show access information
echo ""
echo "Access Information:"
echo "==================="
if [ "$MULTI_TENANT" == "true" ]; then
    echo "API Endpoint: http://localhost (via Nginx)"
    echo "API Direct: http://localhost:3030 (api1), http://localhost:3031 (api2)"
    echo "DGraph HTTP: http://localhost:8090 (via HAProxy)"
    echo "DGraph Direct: http://localhost:8080 (alpha1), :8081 (alpha2), :8082 (alpha3)"
    echo "HAProxy Stats: http://localhost:8404/stats"
else
    echo "API Endpoint: http://localhost:3030"
    echo "DGraph HTTP: http://localhost:8080"
    echo "DGraph gRPC: localhost:9080"
fi
echo "DGraph Ratel UI: http://localhost:8000"
echo ""

# Show logs
echo "To view logs:"
echo "  docker-compose -f $COMPOSE_FILE logs -f [service_name]"
echo ""
echo "To stop services:"
echo "  docker-compose -f $COMPOSE_FILE down"
echo ""

# Optional: tail logs
if [ "$TAIL_LOGS" == "true" ]; then
    echo "Tailing logs (Ctrl+C to stop)..."
    docker-compose -f $COMPOSE_FILE logs -f
fi