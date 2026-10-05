'use strict';
/* SPDX-License-Identifier: Apache-2.0 */
/* Apertus demo server — zero-dependency Node.js (>= 18).
 *
 * 1. Serves the swiss-ai.org design-system repository statically
 * 2. Exposes a minimal OpenAI-compatible proxy for the single-page app:
 *
 *      GET  /api/health
 *      POST /api/chat/completions   (streaming SSE and JSON)
 *
 * Configuration (environment variables):
 *
 *   APERTUS_API_KEY    API key forwarded as a Bearer token (falls back to
 *                      OPENAI_API_KEY). Required for chat.
 *   APERTUS_BASE_URL   OpenAI-compatible base URL, e.g. https://api.openai.com/v1,
 *                      https://router.huggingface.co/v1, or a local vLLM/Ollama
 *                      endpoint. Falls back to OPENAI_BASE_URL.
 *   APERTUS_MODEL      Default model injected when the client omits one.
 *   PORT / HOST        Bind address (default 5173 / localhost).
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

if (typeof fetch !== 'function') {
  console.error('Apertus demo requires Node.js 18 or newer (global fetch).');
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 5173;
// Empty binds all interfaces (dual-stack) so both 127.0.0.1 and ::1 work.
const HOST = process.env.HOST || '';

// Web root is the repository root
const WEB_ROOT = path.resolve(__dirname, '.');
const DEMO_ROOT = path.resolve(__dirname);

const BASE_URL = (
  process.env.APERTUS_BASE_URL ||
  process.env.OPENAI_BASE_URL).replace(/\/+$/, '');
const API_KEY = process.env.APERTUS_API_KEY || process.env.OPENAI_API_KEY || '';
const MODEL = process.env.APERTUS_MODEL;

// Attachments travel as base64 data URLs inside the JSON payload.
const MAX_BODY_BYTES = 32 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const error = new Error('Request body too large.');
        error.statusCode = 413;
        req.destroy();
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* --- Proxy ---------------------------------------------------------------- */

async function handleChatCompletions(req, res) {
  if (!API_KEY) {
    sendJson(res, 503, {
      error: {
        message:
          'The Apertus demo proxy is not configured. Set APERTUS_API_KEY (and optionally APERTUS_BASE_URL, APERTUS_MODEL) and restart `npm start`.',
      },
    });
    return;
  }

  let raw;
  try {
    raw = await readBody(req, MAX_BODY_BYTES);
  } catch (error) {
    sendJson(res, error.statusCode || 400, { error: { message: error.message } });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    sendJson(res, 400, { error: { message: 'Request body must be valid JSON.' } });
    return;
  }

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.messages)) {
    sendJson(res, 400, { error: { message: 'Payload must include a "messages" array.' } });
    return;
  }
  if (!payload.model) payload.model = MODEL;

  // Stop the upstream request when the browser disconnects (Stop button).
  const upstream = new AbortController();
  req.on('close', () => {
    if (!res.writableEnded) upstream.abort();
  });

  let upstreamRes;
  try {
    upstreamRes = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: req.headers.accept || 'application/json',
        authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: upstream.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      if (!res.writableEnded) res.end();
      return;
    }
    sendJson(res, 502, {
      error: {
        message: `Upstream request to ${BASE_URL}/chat/completions failed: ${error.message}`,
      },
    });
    return;
  }

  const contentType = upstreamRes.headers.get('content-type') || 'application/json';
  const headers = {
    'content-type': contentType,
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  };
  res.writeHead(upstreamRes.status, headers);

  if (!upstreamRes.body) {
    res.end();
    return;
  }

  const stream = Readable.fromWeb(upstreamRes.body);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function handleHealth(res) {
  sendJson(res, 200, {
    ok: true,
    configured: Boolean(API_KEY),
    baseUrl: BASE_URL,
    model: MODEL,
    node: process.version,
  });
}

/* --- Static files ---------------------------------------------------------- */

async function handleStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendJson(res, 400, { error: { message: 'Malformed path.' } });
    return;
  }

  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = path.normalize(path.join(WEB_ROOT, rel));

  // Guard against path traversal outside the repository root.
  if (resolved !== WEB_ROOT && !resolved.startsWith(WEB_ROOT + path.sep)) {
    sendJson(res, 403, { error: { message: 'Forbidden.' } });
    return;
  }

  let target = resolved;
  const initialStat = await fs.promises.stat(target).catch(() => null);
  if (initialStat && initialStat.isDirectory()) {
    target = path.join(target, 'index.html');
  }

  const stat = await fs.promises.stat(target).catch(() => null);
  if (!stat || !stat.isFile()) {
    sendJson(res, 404, { error: { message: 'Not found.' } });
    return;
  }

  const type = MIME_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': 'no-cache',
  });
  const stream = fs.createReadStream(target);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/* --- Server ----------------------------------------------------------------- */

async function handler(req, res) {
  const pathname = (req.url || '/').split('?')[0];

  try {
    if (pathname.startsWith('/api/')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type, authorization',
          'access-control-max-age': '86400',
        });
        res.end();
        return;
      }
      if (pathname === '/api/health' && req.method === 'GET') {
        handleHealth(res);
        return;
      }
      if (pathname === '/api/chat/completions' && req.method === 'POST') {
        await handleChatCompletions(req, res);
        return;
      }
      sendJson(res, 405, { error: { message: 'Method not allowed.' } });
      return;
    }

    await handleStatic(req, res, pathname);
  } catch (error) {
    sendJson(res, 500, { error: { message: 'Internal server error.' } });
  }
}

const server = http.createServer(handler);

// Exported for the zero-dependency smoke test (test/smoke.js); the server only
// binds a port when this file is run directly.
module.exports = { handler, BASE_URL, MODEL };

if (require.main === module) {
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use — choose another with PORT=….`);
    } else {
      console.error(`Server error: ${error.message}`);
    }
    process.exit(1);
  });

  server.listen(PORT, HOST || undefined, () => {
    const displayHost = HOST || 'localhost';
    const key = API_KEY
      ? `configured (length ${API_KEY.length})`
      : 'NOT configured — set APERTUS_API_KEY to enable chat';
    console.log('Apertus demo server');
    console.log(`  App:     http://${displayHost}:${PORT}/`);
    console.log(`  Proxy:   http://${displayHost}:${PORT}/api/chat/completions`);
    console.log(`  Target:  ${BASE_URL}/chat/completions (model: ${MODEL})`);
    console.log(`  API key: ${key}`);
  });

  process.on('SIGINT', () => server.close(() => process.exit(0)));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
