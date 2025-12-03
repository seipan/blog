#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

// Configuration
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT;
const ACCESS_KEY = process.env.MINIO_ACCESS_KEY;
const SECRET_KEY = process.env.MINIO_SECRET_KEY;
const BUCKET = process.env.MINIO_BUCKET;
const PREFIX = process.env.MINIO_PREFIX || '';
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID;
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET;

const DIST_DIR = path.join(__dirname, '../../dist');

// S3 V4 signature helpers
function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const kDate = crypto.createHmac('sha256', 'AWS4' + key).update(dateStamp).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
  return crypto.createHmac('sha256', kService).update('aws4_request').digest();
}

function signRequest(method, url, headers, payload = '') {
  const endpoint = new URL(url);
  const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = datetime.slice(0, 8);
  const region = 'us-east-1';
  const service = 's3';
  
  const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');
  headers['x-amz-content-sha256'] = payloadHash;
  headers['x-amz-date'] = datetime;
  headers['host'] = endpoint.host;
  
  // Add Cloudflare Access headers
  headers['CF-Access-Client-Id'] = CF_ACCESS_CLIENT_ID;
  headers['CF-Access-Client-Secret'] = CF_ACCESS_CLIENT_SECRET;
  
  // Create canonical request
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map(k => `${k.toLowerCase()}:${headers[k].trim()}`)
    .join('\n');
  
  const signedHeaders = Object.keys(headers).sort().map(k => k.toLowerCase()).join(';');
  
  const canonicalRequest = [
    method,
    endpoint.pathname,
    endpoint.search.slice(1),
    canonicalHeaders + '\n',
    signedHeaders,
    payloadHash
  ].join('\n');
  
  // Create string to sign
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    datetime,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');
  
  // Calculate signature
  const signingKey = getSignatureKey(SECRET_KEY, date, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  
  // Add authorization header
  headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  
  return headers;
}

// HTTP request helper
function request(method, url, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: signRequest(method, url, headers, body || ''),
      rejectUnauthorized: false
    };
    
    const req = https.request(url, options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// List all files in directory
function* walkDir(dir, baseDir = dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filepath = path.join(dir, file);
    const stat = fs.statSync(filepath);
    if (stat.isDirectory()) {
      yield* walkDir(filepath, baseDir);
    } else if (!file.endsWith('.map')) {
      yield {
        path: filepath,
        key: path.relative(baseDir, filepath).replace(/\\/g, '/')
      };
    }
  }
}

// Get content type
function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const types = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf'
  };
  return types[ext] || 'application/octet-stream';
}

// Main deploy function
async function deploy() {
  console.log('Starting deployment to MinIO...');
  console.log(`Endpoint: ${MINIO_ENDPOINT}`);
  console.log(`Bucket: ${BUCKET}`);
  console.log(`Prefix: ${PREFIX}`);
  
  // Check bucket exists
  try {
    await request('HEAD', `${MINIO_ENDPOINT}/${BUCKET}`);
    console.log('Bucket exists');
  } catch (error) {
    if (error.message.includes('404')) {
      console.log('Creating bucket...');
      await request('PUT', `${MINIO_ENDPOINT}/${BUCKET}`);
    } else {
      throw error;
    }
  }
  
  // Upload files
  const files = Array.from(walkDir(DIST_DIR));
  console.log(`Found ${files.length} files to upload`);
  
  for (const file of files) {
    const key = PREFIX ? `${PREFIX}/${file.key}` : file.key;
    const content = fs.readFileSync(file.path);
    const contentType = getContentType(file.path);
    
    console.log(`Uploading ${key}...`);
    await request('PUT', `${MINIO_ENDPOINT}/${BUCKET}/${key}`, {
      'Content-Type': contentType,
      'Content-Length': content.length
    }, content);
  }
  
  console.log('Deployment complete!');
}

// Run
deploy().catch(error => {
  console.error('Deployment failed:', error);
  process.exit(1);
});