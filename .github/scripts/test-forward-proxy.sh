#!/bin/bash
set -e

echo "Testing forward proxy setup for MinIO with Cloudflare Access"
echo "=============================================="

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Check required environment variables
required_vars=(
  "MINIO_ENDPOINT"
  "MINIO_ACCESS_KEY"
  "MINIO_SECRET_KEY"
  "MINIO_BUCKET"
  "CF_ACCESS_CLIENT_ID"
  "CF_ACCESS_CLIENT_SECRET"
)

for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo "Error: $var is not set"
    exit 1
  fi
done

# Start the forward proxy
echo "Starting forward proxy server..."
node .github/scripts/forward-proxy.cjs &
PROXY_PID=$!

# Wait for proxy to be ready
echo "Waiting for proxy to be ready..."
for i in {1..10}; do
  if nc -z localhost 8080 2>/dev/null; then
    echo "✓ Forward proxy server is ready"
    break
  fi
  sleep 1
done

# Set proxy environment variables
export HTTP_PROXY=http://localhost:8080
export HTTPS_PROXY=http://localhost:8080

# Test MinIO connection
echo ""
echo "Testing MinIO connection through proxy..."
echo "MinIO endpoint: $MINIO_ENDPOINT"

# Download mc if not present
if [ ! -f ./mc ]; then
  echo "Downloading MinIO Client..."
  curl -sSL https://dl.min.io/client/mc/release/linux-amd64/mc -o mc
  chmod +x mc
fi

# Configure mc alias
echo ""
echo "Configuring MinIO alias..."
./mc alias set testblog "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"

# Test connection
echo ""
echo "Testing connection..."
./mc ls testblog/ || echo "Connection test failed"

# Clean up
echo ""
echo "Cleaning up..."
kill $PROXY_PID 2>/dev/null || true
unset HTTP_PROXY HTTPS_PROXY

echo ""
echo "Test complete!"