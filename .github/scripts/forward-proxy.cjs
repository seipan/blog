#!/usr/bin/env node

const http = require('http');
const https = require('https');
const net = require('net');
const { URL } = require('url');

const PROXY_PORT = process.env.PROXY_PORT || 8080;
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID;
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET;

const proxy = http.createServer();

// HTTPS CONNECT tunnel
proxy.on('connect', (req, clientSocket, head) => {
  const [hostname, port] = req.url.split(':');
  const serverSocket = net.connect(port || 443, hostname, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    serverSocket.write(head);
    serverSocket.pipe(clientSocket).pipe(serverSocket);
  });

  const handleError = () => {
    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    serverSocket.destroy();
  };
  
  serverSocket.on('error', handleError);
  clientSocket.on('error', handleError);
});

// HTTP requests
proxy.on('request', (req, res) => {
  const targetUrl = new URL(req.url);
  const protocol = targetUrl.protocol === 'https:' ? https : http;
  
  const headers = {
    ...req.headers,
    'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET
  };
  
  delete headers['proxy-connection'];
  delete headers['proxy-authorization'];

  const proxyReq = protocol.request({
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers
  }, proxyRes => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => res.end('Bad Gateway'));
  req.pipe(proxyReq);
});

proxy.listen(PROXY_PORT, '0.0.0.0').on('error', err => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PROXY_PORT} is already in use` : err);
  process.exit(1);
});

process.on('SIGINT', () => proxy.close(() => process.exit(0)));