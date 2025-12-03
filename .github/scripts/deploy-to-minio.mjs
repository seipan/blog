#!/usr/bin/env node

import { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import { HttpRequest } from "@aws-sdk/protocol-http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mime from "mime-types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==== env ====
const {
  MINIO_ENDPOINT,
  MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY,
  MINIO_BUCKET,
  MINIO_PREFIX = "",
  CF_ACCESS_CLIENT_ID,
  CF_ACCESS_CLIENT_SECRET,
} = process.env;

if (!MINIO_ENDPOINT || !MINIO_ACCESS_KEY || !MINIO_SECRET_KEY || !MINIO_BUCKET) {
  console.error("Missing required env: MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET");
  process.exit(1);
}

// ==== S3Client ====
const s3 = new S3Client({
  region: "us-east-1",               // MinIO なら何でもよいが us-east-1 が無難
  endpoint: MINIO_ENDPOINT,          // 例: https://s3.yadon3141.com
  forcePathStyle: true,              // MinIO では基本 true
  credentials: {
    accessKeyId: MINIO_ACCESS_KEY,
    secretAccessKey: MINIO_SECRET_KEY,
  },
});

// Cloudflare Access ヘッダを全リクエストに注入する middleware
s3.middlewareStack.add(
  (next) => async (args) => {
    const { request } = args;
    if (HttpRequest.isInstance(request)) {
      if (CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET) {
        request.headers["CF-Access-Client-Id"] = CF_ACCESS_CLIENT_ID;
        request.headers["CF-Access-Client-Secret"] = CF_ACCESS_CLIENT_SECRET;
      }
    }
    return next(args);
  },
  {
    step: "finalizeRequest",    // 署名計算の後に実行（追加ヘッダは署名対象外でOK）
    name: "cfAccessHeaders",
  }
);

async function ensureBucket(bucket) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`Bucket '${bucket}' already exists`);
  } catch (err) {
    console.log(`Creating bucket '${bucket}'...`);
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`Bucket '${bucket}' created`);
  }
}

function collectFiles(rootDir) {
  const files = [];
  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  walk(rootDir);
  return files;
}

async function uploadDir() {
  const rootDir = path.join(__dirname, "..", "..", "dist");
  console.log("Uploading from:", rootDir);

  await ensureBucket(MINIO_BUCKET);

  const files = collectFiles(rootDir);
  console.log(`Found ${files.length} files`);

  for (const fullPath of files) {
    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
    const key = (MINIO_PREFIX ? `${MINIO_PREFIX.replace(/\/$/, "")}/` : "") + relPath;

    const contentType = mime.lookup(fullPath) || "application/octet-stream";
    const body = fs.createReadStream(fullPath);

    console.log(`Uploading: ${key} (Content-Type: ${contentType})`);

    await s3.send(
      new PutObjectCommand({
        Bucket: MINIO_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
  }

  console.log("All files uploaded.");
}

uploadDir().catch((err) => {
  console.error("Upload failed:", err);
  process.exit(1);
});