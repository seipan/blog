const http = require('http');
const https = require('https');
const { URL } = require('url');

const target = process.env.MINIO_ENDPOINT;
const clientId = process.env.CF_ACCESS_CLIENT_ID;
const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
const port = process.env.PROXY_PORT || 19000;

if (!target || !clientId || !clientSecret) {
  console.error('Error: Missing required environment variables:');
  if (!target) console.error('  - MINIO_ENDPOINT');
  if (!clientId) console.error('  - CF_ACCESS_CLIENT_ID');
  if (!clientSecret) console.error('  - CF_ACCESS_CLIENT_SECRET');
  process.exit(1);
}

console.log(`Proxy configuration:
  Target: ${target}
  Port: ${port}
  Client ID: ${clientId.substring(0, 8)}...
`);

const server = http.createServer((clientReq, clientRes) => {
  const startTime = Date.now();
  const reqInfo = `${clientReq.method} ${clientReq.url}`;
  
  try {
    const url = new URL(clientReq.url, target);
    
    const headers = {
      ...clientReq.headers,
      'CF-Access-Client-Id': clientId,
      'CF-Access-Client-Secret': clientSecret,
      host: url.host,
    };
    delete headers['host'];
    
    const options = {
      method: clientReq.method,
      headers,
      timeout: 30000,
    };
    
    console.log(`[PROXY] ${reqInfo} -> ${url.href}`);
    
    const proxyReq = https.request(url, options, (proxyRes) => {
      const duration = Date.now() - startTime;
      console.log(`[PROXY] ${reqInfo} - ${proxyRes.statusCode} (${duration}ms)`);
      
      clientRes.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(clientRes);
    });
    
    proxyReq.on('error', (err) => {
      const duration = Date.now() - startTime;
      console.error(`[PROXY ERROR] ${reqInfo} - ${err.message} (${duration}ms)`);
      
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
      }
      clientRes.end(`Proxy Error: ${err.message}`);
    });
    
    proxyReq.on('timeout', () => {
      console.error(`[PROXY TIMEOUT] ${reqInfo}`);
      proxyReq.destroy();
    });
    
    clientReq.pipe(proxyReq);
    
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`[PROXY HANDLER ERROR] ${reqInfo} - ${err.message} (${duration}ms)`);
    
    if (!clientRes.headersSent) {
      clientRes.writeHead(500, { 'Content-Type': 'text/plain' });
    }
    clientRes.end(`Internal Proxy Error: ${err.message}`);
  }
});

server.on('error', (err) => {
  console.error(`[SERVER ERROR] ${err.message}`);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n[PROXY] Shutting down gracefully...');
  server.close(() => {
    console.log('[PROXY] Server closed');
    process.exit(0);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[PROXY] CloudFlare Access proxy running on http://0.0.0.0:${port}`);
  console.log('[PROXY] Ready to forward requests with CF Access headers');
});