#!/usr/bin/env node

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { spawn } = require('child_process');

// 環境変数から設定を取得
const PROXY_PORT = process.env.PROXY_PORT || 8080;
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'https://minio.example.com';
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID;
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET;

// MinIOのエンドポイントをパース
const targetUrl = new URL(MINIO_ENDPOINT);
const isHttps = targetUrl.protocol === 'https:';

console.log('Starting MinIO proxy server with Cloudflare Access headers...');
console.log(`Proxy port: ${PROXY_PORT}`);
console.log(`Target MinIO: ${MINIO_ENDPOINT}`);

const proxy = http.createServer((req, res) => {
  console.log(`Received request: ${req.method} ${req.url}`);
  console.log(`Headers: ${JSON.stringify(req.headers)}`);

  // Cloudflare Accessヘッダーを追加
  // Authorization ヘッダーを保持し、hostヘッダーを正しく設定
  const headers = {
    ...req.headers,
    'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
    'host': targetUrl.hostname,
    'x-forwarded-host': req.headers.host,
    'x-forwarded-proto': isHttps ? 'https' : 'http'
  };
  
  // 不要なヘッダーを削除
  delete headers['accept-encoding']; // 圧縮の問題を避ける

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: req.url,
    method: req.method,
    headers: headers,
    rejectUnauthorized: false
  };

  console.log(`Proxying to: ${options.hostname}:${options.port}${options.path}`);

  const protocol = isHttps ? https : http;
  const proxyReq = protocol.request(options, (proxyRes) => {
    console.log(`Response status: ${proxyRes.statusCode}`);
    console.log(`Response headers: ${JSON.stringify(proxyRes.headers)}`);
    
    // レスポンスヘッダーの調整
    const responseHeaders = { ...proxyRes.headers };
    
    // Set-Cookieヘッダーの処理（CF_Authorizationクッキーなど）
    if (responseHeaders['set-cookie']) {
      console.log('Set-Cookie headers detected:', responseHeaders['set-cookie']);
    }
    
    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res, { end: true });
  });

  req.pipe(proxyReq, { end: true });

  proxyReq.on('error', (err) => {
    console.error('Proxy request error:', err);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway');
  });
});

proxy.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`Proxy server is running on http://0.0.0.0:${PROXY_PORT}`);
  console.log('');
  console.log('Usage with mc:');
  console.log(`  mc alias set blog http://localhost:${PROXY_PORT} <ACCESS_KEY> <SECRET_KEY>`);
  console.log('');

  // コマンドライン引数でmcコマンドが渡された場合は実行
  const args = process.argv.slice(2);
  if (args.length > 0 && args[0] === '--exec') {
    const mcCommand = args.slice(1).join(' ');
    console.log(`Executing: ${mcCommand}`);
    console.log('');

    // 新しいエイリアスを設定してmcを実行
    const env = {
      ...process.env,
      MC_HOST_blogproxy: `http://localhost:${PROXY_PORT}`
    };

    const child = spawn('sh', ['-c', mcCommand.replace(/blog\//g, 'blogproxy/')], {
      env: env,
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      console.log(`\nCommand exited with code ${code}`);
      proxy.close();
      process.exit(code);
    });

    child.on('error', (err) => {
      console.error('Failed to execute command:', err);
      proxy.close();
      process.exit(1);
    });
  }
});

proxy.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PROXY_PORT} is already in use`);
  } else {
    console.error('Proxy server error:', err);
  }
  process.exit(1);
});

// グレースフルシャットダウン
process.on('SIGINT', () => {
  console.log('\nShutting down proxy server...');
  proxy.close(() => {
    process.exit(0);
  });
});