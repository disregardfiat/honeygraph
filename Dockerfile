FROM node:18-slim

# Install build dependencies
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm config set registry https://registry.npmmirror.com && \
    npm install --production --legacy-peer-deps

# Copy application code
COPY . .

# Create logs directory
RUN mkdir -p /app/logs

# Run as non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -s /bin/bash -m nodejs
USER nodejs

EXPOSE 3030

CMD ["node", "server.js"]