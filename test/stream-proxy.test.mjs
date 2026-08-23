// GUARDIAN TDD ENFORCER — Local Node /stream byte-proxy (freebuff-task-20260823-streamre)
// Plain .mjs, imported directly. Tests the /stream route that relays googlevideo
// bytes to the browser (googlevideo sends no ACAO so the PWA cannot fetch CORS).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const nodeScriptPath = path.join(root, 'vibecatch-node.mjs');
const mod = fs.existsSync(nodeScriptPath)
  ? await import('file://' + nodeScriptPath.split(path.sep).join('/'))
  : {};

// --- mock upstream "googlevideo" server -------------------------------------
let upstreamServer;
let upstreamPort;
const UPSTREAM_BODY = Buffer.from('ID3fakeaudio-bytes-1234567890');

function startUpstream() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      if (req.url.startsWith('/fail')) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('upstream boom');
        return;
      }
      const range = req.headers['range'];
      if (range) {
        const m = /bytes=(\d+)-(\d*)/.exec(range);
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : UPSTREAM_BODY.length - 1;
        res.writeHead(206, {
          'Content-Type': 'audio/mp4',
          'Content-Range': `bytes ${start}-${end}/${UPSTREAM_BODY.length}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
        });
        res.end(UPSTREAM_BODY.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'audio/mp4',
        'Content-Length': String(UPSTREAM_BODY.length),
      });
      res.end(UPSTREAM_BODY);
    });
    s.listen(0, '127.0.0.1', () => {
      upstreamPort = s.address().port;
      resolve(s);
    });
  });
}

// --- local node under test ------------------------------------------------
let nodeServer;
let nodePort;

before(async () => {
  if (!mod.startServer) throw new Error('startServer not exported yet');
  upstreamServer = await startUpstream();
  nodeServer = mod.startServer(0);
  await new Promise((r) => nodeServer.on('listening', r));
  nodePort = nodeServer.address().port;
});

after(() => {
  nodeServer && nodeServer.close();
  upstreamServer && upstreamServer.close();
});

function getNode(pathname, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: nodePort, path: pathname, method: 'GET', headers: headers || {} },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('S1 /stream relays googlevideo bytes to the browser', () => {
  test('proxies body + sets Content-Disposition + CORS, no buffering', async () => {
    const upstreamUrl = `http://127.0.0.1:${upstreamPort}/videoplayback?expire=1`;
    const r = await getNode('/stream?url=' + encodeURIComponent(upstreamUrl));
    assert.equal(r.status, 200, 'should proxy 200');
    assert.ok(r.body.equals(UPSTREAM_BODY), 'body must equal upstream bytes');
    assert.match(String(r.headers['content-disposition'] || ''), /attachment/i, 'needs Content-Disposition attachment');
    assert.match(String(r.headers['access-control-allow-origin'] || ''), /\*/);
    assert.match(String(r.headers['access-control-allow-private-network'] || ''), /true/i);
    assert.match(String(r.headers['content-type'] || ''), /audio\/mp4/);
  });

  test('passes through Range -> 206 + Content-Range', async () => {
    const upstreamUrl = `http://127.0.0.1:${upstreamPort}/videoplayback`;
    const r = await getNode('/stream?url=' + encodeURIComponent(upstreamUrl), { range: 'bytes=0-9' });
    assert.equal(r.status, 206, 'should relay 206');
    assert.match(String(r.headers['content-range'] || ''), /bytes 0-9\//);
    assert.ok(r.body.equals(UPSTREAM_BODY.subarray(0, 10)), 'returned sliced bytes');
  });

  test('upstream failure -> 502 honest error (never hangs)', async () => {
    const upstreamUrl = `http://127.0.0.1:${upstreamPort}/fail`;
    const r = await getNode('/stream?url=' + encodeURIComponent(upstreamUrl));
    assert.equal(r.status, 502, 'should surface upstream failure');
  });

  test('missing url param -> 400', async () => {
    const r = await getNode('/stream');
    assert.equal(r.status, 400);
  });

  test('rejects non-http(s) url (SSRF guard)', async () => {
    const r = await getNode('/stream?url=' + encodeURIComponent('file:///etc/passwd'));
    assert.equal(r.status, 400);
  });
});
