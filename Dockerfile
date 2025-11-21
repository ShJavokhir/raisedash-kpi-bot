# syntax=docker/dockerfile:1.7

#############################################
# Stage 1: Build the Next.js dashboard
#############################################
FROM node:20-bookworm-slim AS frontend-builder

WORKDIR /app/frontend

# Install build prerequisites for optional native modules (better-sqlite3)
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 build-essential pkg-config \
    && rm -rf /var/lib/apt/lists/*

ENV NEXT_TELEMETRY_DISABLED=1

COPY frontend/package*.json ./
RUN npm ci

# Force rebuild native modules for target platform
RUN npm rebuild better-sqlite3 --build-from-source

COPY frontend/ ./
RUN npm run build \
    && npm prune --omit=dev

#############################################
# Stage 2: Runtime image with bot + dashboard
#############################################
FROM node:20-bookworm-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PORT=3000 \
    DATABASE_PATH=/app/incidents.db

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        python3-pip \
        python3-dev \
        build-essential \
        pkg-config \
        tini \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv

ENV VIRTUAL_ENV=/opt/venv
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy Python bot sources and assets
COPY bot.py \
     config.py \
     database.py \
     handlers.py \
     logging_config.py \
     message_builder.py \
     notification_service.py \
     reminders.py \
     reporting.py \
     sentry_config.py \
     time_utils.py \
     ./

COPY assets ./assets

RUN mkdir -p /app/data
COPY incidents.db /app/data/incidents.db

# Copy production-ready Next.js build from the builder stage
RUN mkdir -p frontend
COPY --from=frontend-builder /app/frontend/.next ./frontend/.next
COPY --from=frontend-builder /app/frontend/node_modules ./frontend/node_modules
COPY --from=frontend-builder /app/frontend/package.json ./frontend/
COPY --from=frontend-builder /app/frontend/package-lock.json ./frontend/
COPY --from=frontend-builder /app/frontend/next.config.ts ./frontend/
COPY --from=frontend-builder /app/frontend/postcss.config.mjs ./frontend/
COPY --from=frontend-builder /app/frontend/tsconfig.json ./frontend/
COPY --from=frontend-builder /app/frontend/next-env.d.ts ./frontend/
COPY --from=frontend-builder /app/frontend/public ./frontend/public

# Rebuild better-sqlite3 in the runtime stage to match the final architecture
WORKDIR /app/frontend
RUN npm rebuild better-sqlite3 --build-from-source
WORKDIR /app

# Simple supervisor to run both services in one container
RUN cat <<'EOF' >/usr/local/bin/start-services.sh
#!/bin/bash
set -euo pipefail

NEXT_PORT_VALUE="${NEXT_PORT:-3000}"
DB_PATH="${DATABASE_PATH:-/app/incidents.db}"
DB_DIR="$(dirname "$DB_PATH")"

mkdir -p "$DB_DIR"

if [ ! -f "$DB_PATH" ]; then
  echo "Initializing SQLite database at ${DB_PATH}..."
  DB_INIT_PATH="$DB_PATH" python - <<'PY'
import os
from database import Database

db_path = os.environ["DB_INIT_PATH"]
Database(db_path)
PY
fi

echo "Starting Telegram bot..."
python /app/bot.py &
BOT_PID=$!

echo "Starting Next.js dashboard on port ${NEXT_PORT_VALUE}..."
npm --prefix /app/frontend run start -- --hostname 0.0.0.0 --port "${NEXT_PORT_VALUE}" &
FRONT_PID=$!

terminate() {
  echo "Stopping services..."
  kill -TERM "$FRONT_PID" "$BOT_PID" 2>/dev/null || true
}

trap terminate SIGINT SIGTERM

wait -n "$FRONT_PID" "$BOT_PID"
STATUS=$?

terminate
wait || true

exit "$STATUS"
EOF

RUN chmod +x /usr/local/bin/start-services.sh

RUN chown -R node:node /app

USER node

EXPOSE 3000

ENTRYPOINT ["tini", "--"]
CMD ["start-services.sh"]

