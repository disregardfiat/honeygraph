FROM node:18-slim

# Install build dependencies and curl for health checks
RUN rm -rf /var/lib/apt/lists/* && apt-get clean && apt-get update && apt-get install -y python3 make g++ curl && rm -rf /var/lib/apt/lists/*

# Create non-root user early in the build
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -s /bin/bash -m nodejs

WORKDIR /app

# Create necessary directories with proper ownership
RUN mkdir -p /app/logs /app/data/honeygraph && \
    chown -R nodejs:nodejs /app

# Copy package files with correct ownership
COPY --chown=nodejs:nodejs package*.json ./

# Install dependencies as nodejs user
USER nodejs
RUN npm config set strict-ssl false && \
    npm config set registry http://registry.npmjs.org/ && \
    npm install --omit=dev --legacy-peer-deps

# Copy application code (updated 2025-07-17T13:23 - added folder counts)
COPY --chown=nodejs:nodejs . .

EXPOSE 3030

CMD ["node", "server.js"]