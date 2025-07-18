FROM node:18-slim

# Install build dependencies and curl for health checks
RUN apt-get update && apt-get install -y python3 make g++ curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm config set strict-ssl false && npm install --omit=dev

# Copy application code (updated 2025-07-17T13:23 - added folder counts)
COPY . .

# Create necessary directories
RUN mkdir -p /app/logs /app/data/honeygraph

# Run as non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -s /bin/bash -m nodejs && \
    chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3030

CMD ["node", "server.js"]