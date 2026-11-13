# syntax=docker/dockerfile:1
FROM oven/bun:1.3.14 AS builder

WORKDIR /app

# Install Node.js 22 for the Ponder indexer
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs supervisor && \
    rm -rf /var/lib/apt/lists/*

# Copy the workspace configuration
COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY shared ./shared
COPY backend ./backend
COPY indexer ./indexer
COPY sdk ./sdk

# Trim the monorepo workspaces for the backend container (no frontend or contracts)
RUN bun -e "const fs = require('fs'); const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); pkg.workspaces = ['shared', 'backend', 'indexer', 'sdk']; fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));"

# Install dependencies & build
RUN bun install
RUN bun run build:backend

# Expose backend port
EXPOSE 3000

CMD ["/usr/bin/supervisord", "-c", "/app/backend/supervisord.conf"]
