#!/bin/bash
set -euo pipefail

[ -f .env ] && export $(grep -v '^#' .env | xargs)

required_vars=("MINIO_ENDPOINT" "MINIO_ACCESS_KEY" "MINIO_SECRET_KEY" "CF_ACCESS_CLIENT_ID" "CF_ACCESS_CLIENT_SECRET")
for var in "${required_vars[@]}"; do
  [ -z "${!var}" ] && { echo "Error: $var is not set"; exit 1; }
done

# Start proxy
node .github/scripts/forward-proxy.cjs &
PROXY_PID=$!
trap "kill $PROXY_PID 2>/dev/null || true" EXIT

# Wait for proxy
timeout 10s bash -c 'until nc -z localhost 8080 2>/dev/null; do sleep 0.5; done'

# Download mc if needed
[ ! -f ./mc ] && curl -sSL https://dl.min.io/client/mc/release/linux-amd64/mc -o mc && chmod +x mc

# Test connection
export HTTP_PROXY=http://localhost:8080
export HTTPS_PROXY=http://localhost:8080
./mc alias set test "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"
./mc ls test/ || echo "Connection test failed"