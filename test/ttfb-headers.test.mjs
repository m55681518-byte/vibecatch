// GUARDIAN TDD ENFORCER — proxy-latency-first-byte deadline (freebuff-task-ttfb)
// DT1: through a tunnel/proxy (Cloudflare quick tunnel), a request whose origin
//      takes 30-145s to produce its FIRST byte gets killed by the edge's TTFB
//      cap (measured 502 ~20s). The node must therefore emit response headers
//      (200, chunked) at a SHORT deadline (~2s) even if yt-dlp hasn't produced
//      audio yet, then stream bytes whenever they arrive.
// DT2: fail-fast semantics preserved — if yt-dlp exits nonzero BEFORE any byte
//      AND before the header deadline, the client still gets an honest JSON 502.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const nodeScriptPath = path.join(root, 'vibecatch-node.mjs');
const mod = await import('file://' + nodeScriptPath.split(path.sep).join('/'));

let tmpRoot;
delete process.env.VIBECATCH_YT_COOKIES;

before(async () => {
  if (!mod.startServer) throw new Error('startServer not exported');
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-ttfb-'));
});

after(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

function makeStub(name, mjsBody) {
  const binDir = path.join(tmpRoot, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, name + '.mjs'), mjsBody);
  const cmd = path.join(binDir, name + '.cmd');
  fs.writeFileSync(cmd, '@echo off\r\nnode "%~dp0' + name + '.mjs" %*\r\n');
  return cmd;
}

// slow stub: sleeps 3000ms then emits 4096 bytes of audio-ish data
const slowCmd = makeStub(
  'slow-ytdlp',
  'setTimeout(() => { process.stdout.write(Buffer.alloc(4096, 65)); }, 3000);\n'
);

async function up(server) {
  await new Promise((r) => server.on('listening', r));
  return server.address().port;
}

function headersDelta(port, pathname, deadlineMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'GET' }, (res) => {
      resolve({ deltaMs: Date.now() - t0, status: res.statusCode, res });
    });
    req.on('error', reject);
    req.setTimeout(deadlineMs + 4000, () => { req.destroy(new Error('client timeout')); });
    req.end();
  });
}

describe('DT1 /download emits headers at the ~2s deadline (slow first byte)', () => {
  let server, port;
  before(async () => {
    server = mod.startServer(0, { stateDir: path.join(tmpRoot, 'state-dt1'), ytdlpPath: slowCmd });
    port = await up(server);
  });
  after(async () => {
    try {
      if (typeof server._inflightCache === 'object') for (const key of server._inflightCache.keys()) {
        const p = server._inflightCache.get(key);
        await p.catch(() => {});
      }
    } catch {}
    try { server.close(); } catch {}
  });

  test('headers arrive before 2600ms while stub sleeps 3000ms', { timeout: 30000 }, async () => {
    const r = await headersDelta(port, '/download?videoId=ttfb1', 12000);
    assert.ok(r.deltaMs < 2600, 'first response bytes took ' + r.deltaMs + 'ms (wanted < 2600ms)');
    assert.equal(r.status, 200, 'expected 200 from deadline path, got ' + r.status);
    const body = await new Promise((resolve, reject) => {
      const c = [];
      r.res.on('data', (d) => c.push(d));
      r.res.on('end', () => resolve(Buffer.concat(c)));
      r.res.on('error', reject);
    });
    assert.equal(body.length, 4096, 'expected the stubbed audio bytes to stream through');
  });
});

describe('DT2 fail-fast before deadline still yields honest JSON 502', () => {
  let server, port;
  before(async () => {
    const failCmd = path.join(tmpRoot, 'fail-ytdlp.cmd');
    fs.writeFileSync(failCmd, '@echo off\r\nexit /b 1\r\n');
    server = mod.startServer(0, { stateDir: path.join(tmpRoot, 'state-dt2'), ytdlpPath: failCmd });
    port = await up(server);
  });
  after(() => { try { server.close(); } catch {} });

  test('502 JSON error body (headers not pre-empted by deadline on fail-fast)', { timeout: 30000 }, async () => {
    const r = await headersDelta(port, '/download?videoId=ttfb2', 12000);
    assert.equal(r.status, 502, 'expected 502, got ' + r.status);
    const body = await new Promise((resolve, reject) => {
      const c = [];
      r.res.on('data', (d) => c.push(d));
      r.res.on('end', () => resolve(Buffer.concat(c).toString('utf8')));
      r.res.on('error', reject);
    });
    assert.ok(/error/.test(body), 'body must carry error field: ' + body.slice(0, 200));
  });
});