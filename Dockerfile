# Multi-stage Dockerfile for RaiseDash KPI Bot
# Combines Python Telegram bot and Next.js frontend in single efficient image

# ================================
# Stage 1: Build Next.js Frontend
# ================================
FROM node:20-alpine AS frontend-builder

# Install Python for native module compilation (needed for better-sqlite3)
RUN apk add --no-cache python3 py3-pip

WORKDIR /app/frontend

# Copy package files
COPY frontend/package*.json ./

# Install dependencies (including dev dependencies for build, then clean up)
RUN npm ci

# Copy source code
COPY frontend/ ./

# Build the application
RUN npm run build

# ================================
# Stage 2: Python Bot Environment
# ================================
FROM python:3.11-slim AS bot-builder

# Install system dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    build-essential \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy Python requirements
COPY requirements.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# ================================
# Final Stage: Combine Everything
# ================================
FROM python:3.11-slim

# Install Node.js 20 runtime for Next.js (lighter than full Node.js)
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy Python environment and dependencies
COPY --from=bot-builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=bot-builder /usr/local/bin /usr/local/bin

# Copy Python source code
COPY bot.py handlers.py database.py config.py sentry_config.py \
     message_builder.py notification_service.py reminders.py \
     time_utils.py logging_config.py ./

# Copy Next.js built application
COPY --from=frontend-builder /app/frontend/.next /app/frontend/.next
COPY --from=frontend-builder /app/frontend/public /app/frontend/public
COPY --from=frontend-builder /app/frontend/package*.json /app/frontend/
COPY frontend/next.config.ts frontend/tsconfig.json /app/frontend/

# Install production dependencies for Next.js
RUN cd frontend && npm ci --only=production

# Copy assets and configuration templates
COPY assets/ /app/assets/
COPY .env.example /app/

# Create data directory for SQLite database
RUN mkdir -p /app/data

# Create startup script
COPY docker-start.sh /app/
RUN chmod +x /app/docker-start.sh

# Environment variables
ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/incidents.db

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python3 -c "import sqlite3; sqlite3.connect('${DATABASE_PATH}').execute('SELECT 1').fetchone()" || exit 1

# Expose Next.js port
EXPOSE 3000

# Start both services
CMD ["/app/docker-start.sh"]
