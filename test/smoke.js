'use strict';
/* SPDX-License-Identifier: Apache-2.0 */
/* Zero-dependency smoke test for the Apertus demo server.
 *
 * Exercises the request handler directly with mock req/res objects — no
 * sockets, no network. Run with:
 *
 *     npm test          (or: node test/smoke.js)
 *
 * Spawns a second, key-less child process to cover the "proxy not configured"
 * branch, since the key is read from the environment at load time.
 */

const { spawn } = require('node:child_process');
const { Writable } = require('node:stream');
const { EventEmitter } = require('node:events');

const NO_KEY = process.argv.includes('--no-key');

if (NO_KEY) {
  delete process.env.APERTUS_API_KEY;
  delete process.env.OPENAI_API_KEY;
} else {
  // Unreachable upstream: connections to the discard port fail immediately.
  process.env.APERTUS_API_KEY = 'test-key';
  process.env.APERTUS_BASE_URL = 'http://127.0.0.1:9/v1';
  delete process.env.OPENAI_BASE_URL;
}

const { handler, MODEL } = require('../server.js');

/* --- Mocks ------------------------------------------------------------------- */

class MockRes extends Writable {
  constructor() {
    super();
    this.statusCode = null;
    this.headers = null;
    this.body = [];
  }

  writeHead(status, headers) {
    this.statusCode = status;
    this.headers = headers || {};
  }

  _write(chunk, encoding, callback) {
    this.body.push(Buffer.from(chunk));
    callback();
  }

  end(body) {
    if (body) this.body.push(Buffer.from(body));
    return super.end();
  }

  text() {
    return Buffer.concat(this.body).toString('utf8');
  }

  wait() {
    return new Promise((resolve) => {
      if (this.writableEnded) return resolve();
      this.on('finish', resolve);
    });
  }
}

function mockRequest(method, url, headers) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers || {};
  req.destroy = function () {};
  return req;
}

/* --- Assertions ---------------------------------------------------------------- */

let failures = 0;
const checks = [];

function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail });
  if (!condition) failures += 1;
}

async function get(url, headers) {
  const res = new MockRes();
  await handler(mockRequest('GET', url, headers), res);
  await res.wait();
  return res;
}

async function post(url, body, headers) {
  const res = new MockRes();
  const req = mockRequest('POST', url, headers);
  const pending = handler(req, res);
  req.emit('data', Buffer.from(body || ''));
  req.emit('end');
  await pending;
  await res.wait();
  return res;
}

/* --- Scenarios ------------------------------------------------------------------ */

async function run() {
  if (NO_KEY) {
    const health = await get('/api/health');
    check(
      '[no-key] health reports configured:false',
      health.statusCode === 200 && JSON.parse(health.text()).configured === false
    );

    const chat = await post('/api/chat/completions', '{"messages":[]}');
    check('[no-key] chat without key returns 503', chat.statusCode === 503, chat.text());
    return;
  }

  // Static files
  const demo = await get('/');
  check('demo page 200', demo.statusCode === 200);
  check('demo page is HTML', String(demo.headers['content-type'] || '').includes('text/html'));
  check('demo page contains the app heading', demo.text().includes('id="demo-title"'));
  check('demo page links the design-system bundle', demo.text().includes('assets/swiss-ai.css'));

  const root = await get('/');
  check('repo index 200', root.statusCode === 200);

  const designSystem = await get('/assets/swiss-ai.css');
  check('design-system bundle served', designSystem.statusCode === 200 && designSystem.text().includes('--color-sky-blue-1-5'));

  const appCss = await get('/assets/app.css');
  check('demo app.css served', appCss.statusCode === 200);

  const appJs = await get('/assets/app.js');
  check('demo app.js served', appJs.statusCode === 200);

  // Widget surfaces
  const widgetJs = await get('/assets/widget.js');
  check('widget.js served', widgetJs.statusCode === 200);
  check('widget.js is JavaScript', String(widgetJs.headers['content-type'] || '').includes('text/javascript'));
  check('widget.js opens the chat pop-up', widgetJs.text().includes('popup.html') && widgetJs.text().includes('window.open'));

  const popup = await get('/popup.html');
  check('popup page 200', popup.statusCode === 200);
  check('popup page is HTML', String(popup.headers['content-type'] || '').includes('text/html'));
  check('popup page contains the chat log and composer', popup.text().includes('id="chat-log"') && popup.text().includes('id="composer"'));
  check('popup page loads the chat client', popup.text().includes('assets/app.js'));

  const popupCss = await get('/assets/popup.css');
  check('popup.css served', popupCss.statusCode === 200);

  const widgetDemo = await get('/demo.html');
  check('widget demo page 200', widgetDemo.statusCode === 200);

  const missing = await get('/definitely-not-here');
  check('unknown path 404', missing.statusCode === 404);

  const traversal = await get('/../../../etc/passwd');
  check('path traversal blocked', traversal.statusCode === 403);

  // API
  const health = await get('/api/health');
  const healthBody = JSON.parse(health.text());
  check('health 200 + configured', health.statusCode === 200 && healthBody.configured === true);
  check('health reports default model', healthBody.model === MODEL);
  check('health never returns the API key', !health.text().includes('test-key'));

  const wrongMethod = new MockRes();
  const wrongReq = {
    method: 'DELETE',
    url: '/api/chat/completions',
    headers: {},
    on() {},
    destroy() {},
  };
  await handler(wrongReq, wrongMethod);
  check('unknown API method 405', wrongMethod.statusCode === 405);

  const badJson = await post('/api/chat/completions', 'not-json');
  check('invalid JSON 400', badJson.statusCode === 400);

  const noMessages = await post('/api/chat/completions', '{"model":"m"}');
  check('payload without messages 400', noMessages.statusCode === 400);

  const upstreamFail = await post(
    '/api/chat/completions',
    JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })
  );
  check('unreachable upstream 502', upstreamFail.statusCode === 502, upstreamFail.text());
  check('502 includes a message', Boolean((JSON.parse(upstreamFail.text()).error || {}).message));
}

run()
  .then(async () => {
    if (!NO_KEY) {
      const child = spawn(process.execPath, [__filename, '--no-key'], { stdio: 'inherit' });
      const code = await new Promise((resolve) => child.on('exit', resolve));
      if (code !== 0) failures += 1;
    }

    for (const result of checks) {
      console.log(
        (result.ok ? '  \u2713 ' : '  \u2717 ') +
          result.name +
          (result.ok ? '' : ' \u2014 ' + (result.detail || ''))
      );
    }
    console.log(
      failures === 0
        ? 'smoke test: all checks passed'
        : `smoke test: ${failures} check(s) failed`
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error('smoke test crashed:', error);
    process.exit(1);
  });
