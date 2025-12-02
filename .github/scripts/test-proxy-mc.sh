#!/bin/bash

# MinIO proxy server test script

# 環境変数の確認
if [ -z "$MINIO_ENDPOINT" ] || [ -z "$CF_ACCESS_CLIENT_ID" ] || [ -z "$CF_ACCESS_CLIENT_SECRET" ]; then
    echo "Error: Required environment variables are not set"
    echo "Please set: MINIO_ENDPOINT, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET"
    exit 1
fi

if [ -z "$MINIO_ACCESS_KEY" ] || [ -z "$MINIO_SECRET_KEY" ]; then
    echo "Error: MinIO credentials are not set"
    echo "Please set: MINIO_ACCESS_KEY, MINIO_SECRET_KEY"
    exit 1
fi

echo "Starting MinIO proxy server test..."
echo "Target: $MINIO_ENDPOINT"
echo ""

# プロキシサーバーの起動
echo "Starting proxy server..."
node .github/scripts/proxy-server.js &
PROXY_PID=$!

# プロキシサーバーの起動を待つ
sleep 2

# 終了時にプロキシサーバーを停止
trap "echo 'Stopping proxy server...'; kill $PROXY_PID 2>/dev/null" EXIT

# mcのダウンロード（なければ）
if [ ! -f "./mc" ]; then
    echo "Downloading MinIO Client..."
    curl -sSL https://dl.min.io/client/mc/release/linux-amd64/mc -o mc
    chmod +x mc
fi

# エイリアスの設定
echo ""
echo "Configuring mc alias..."
./mc alias set blogtest http://localhost:8080 "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"

# 接続テスト
echo ""
echo "Testing connection..."
./mc ls blogtest/

echo ""
echo "Test complete. Press Ctrl+C to exit."
wait $PROXY_PID