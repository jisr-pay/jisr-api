# Runtime image for the Jisr Testnet internal API.
# Matches the engines range in package.json (>=24.15.0 <25); CI runs Node 24 too.
FROM node:24-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATABASE_PATH=/data/transfers.sqlite

WORKDIR /app

COPY package.json package-lock.json openapi.json ./
COPY vendor ./vendor
COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts

# Install production dependencies, then run the same syntax/OpenAPI check as CI.
RUN npm ci --omit=dev --no-audit --no-fund && node scripts/check.js

# SQLite journal volume (see [mounts] in fly.toml). Fresh Fly volumes are root-owned,
# so the server intentionally runs as root to initialize it on first boot.
VOLUME /data

EXPOSE 8080
CMD ["node", "--env-file-if-exists=.env", "src/main.js"]
