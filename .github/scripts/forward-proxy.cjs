#!/usr/bin/env node

const http = require('http');
const https = require('https');
const net = require('net');
const { URL } = require('url');

// 環境変数から設定を取得
const PROXY_PORT = process.env.PROXY_PORT || 8080;
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID;
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET;

console.log('Starting HTTP forward proxy with Cloudflare Access support...');
console.log(`Proxy port: ${PROXY_PORT}`);

const proxy = http.createServer();

// HTTPSのCONNECTメソッドを処理
proxy.on('connect', (req, clientSocket, head) => {
  console.log(`CONNECT ${req.url}`);
  
  const [hostname, port] = req.url.split(':');
  const targetPort = port || 443;

  const serverSocket = net.connect(targetPort, hostname, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    
    // 双方向にデータを流す
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on('error', (err) => {
    console.error('Server socket error:', err);
    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });

  clientSocket.on('error', (err) => {
    console.error('Client socket error:', err);
    serverSocket.destroy();
  });
});

// 通常のHTTPリクエストを処理
proxy.on('request', (req, res) => {
  console.log(`${req.method} ${req.url}`);
  
  const targetUrl = new URL(req.url);
  const isHttps = targetUrl.protocol === 'https:';
  
  // Cloudflare Accessヘッダーを追加
  const headers = {
    ...req.headers,
    'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET
  };
  
  // プロキシヘッダーは削除（ホストヘッダーは変更しない）
  delete headers['proxy-connection'];
  delete headers['proxy-authorization'];

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: headers
  };

  console.log(`Forwarding to: ${options.hostname}:${options.port}${options.path}`);

  const protocol = isHttps ? https : http;
  const proxyReq = protocol.request(options, (proxyRes) => {
    console.log(`Response status: ${proxyRes.statusCode}`);
    
    // ホップバイホップヘッダーを削除
    const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade'];
    Object.keys(proxyRes.headers).forEach(header => {
      if (hopHeaders.includes(header.toLowerCase())) {
        delete proxyRes.headers[header];
      }
    });
    
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
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
  console.log(`Forward proxy server is running on http://0.0.0.0:${PROXY_PORT}`);
  console.log('');
  console.log('Usage:');
  console.log('  export HTTP_PROXY=http://localhost:' + PROXY_PORT);
  console.log('  export HTTPS_PROXY=http://localhost:' + PROXY_PORT);
  console.log('  mc alias set blog <ACTUAL_MINIO_URL> <ACCESS_KEY> <SECRET_KEY>');
  console.log('');
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