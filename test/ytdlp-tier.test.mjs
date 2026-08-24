// GUARDIAN TDD ENFORCER — yt-dlp full-download tier (freebuff-task-20260823-ytdlptier)
// Live-proven blocker: keyless googlevideo URLs serve only ~1MiB preview (403 beyond),
// so /stream cannot deliver a full song. The node gains a /download route backed by
// the official standalone yt-dlp binary (auto-installed once), plus a status endpoint.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const nodeScriptPath = path.join(root, 'vibecatch-node.mjs');
const mod = fs.existsSync(nodeScriptPath)
  ? await import('file://' + nodeScriptPath.split(path.sep).join('/'))
  : {};

// Fake "yt-dlp" binary: a .cmd that emits deterministic bytes to stdout.
const FAKE_OUT = Buffer.alloc(700000); // 700KB of pseudo-bytes
for (let i = 0; i < FAKE_OUT.length; i++) FAKE_OUT[i] = (i * 17 + 3) & 0xff;
let tmpDir, fakeBin, server, port;

before(async () => {
  if (!mod.startServer) throw new Error('startServer not exported');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-ytdlp-'));
  fakeBin = process.platform === 'win32' ? path.join(tmpDir, 'fake-ytdlp.cmd') : path.join(tmpDir, 'fake-ytdlp.sh');
  if (process.platform === 'win32') {
    fs.writeFileSync(fakeBin, '@echo off\r\nmore +0\r\n');
    // emit exact bytes via certutil-free trick: use a tiny node one-liner inside cmd
    fs.writeFileSync(
      fakeBin,
      '@echo off\r\nnode -e "process.stdout.write(Buffer.from(require(\'fs\').readFileSync(process.argv[1])))" "' +
        path.join(tmpDir, 'payload.bin') + '"\r\n'
    );
  } else {
    fs.writeFileSync(fakeBin, '#!/bin/sh\ncat "' + path.join(tmpDir, 'payload.bin') + '"\n');
    fs.chmodSync(fakeBin, 0o755);
  }
  fs.writeFileSync(path.join(tmpDir, 'payload.bin'), FAKE_OUT);

  server = mod.startServer(0, { ytdlpPath: fakeBin, stateDir: path.join(tmpDir, 'state') });
  await new Promise((r) => server.on('listening', r));
  port = server.address().port;
});
after(() => { try { server.close(); } catch {} try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Y1 status endpoint reports binary state', () => {
  test('/ytdlp-status -> {available:true,path} when override provided', async () => {
    const r = await get('/ytdlp-status');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body.toString());
    assert.equal(j.ok, true);
    assert.equal(j.available, true, 'override binary must be detected');
    assert.equal(typeof j.path, 'string');
  });

  test('startServer accepts opts.ytdlpPath (contract)', () => {
    // implicit in before(); explicit assertion keeps contract pinned
    assert.equal(typeof mod.startServer, 'function');
  });
});

describe('Y2 /download streams FULL audio via yt-dlp', () => {
  test('pipes binary stdout with audio headers + disposition', { timeout: 60000 }, async () => {
    const r = await get('/download?videoId=4_zr_97R5mw&title=' + encodeURIComponent('American Dream') + '&artist=' + encodeURIComponent('MKTO'));
    assert.equal(r.status, 200, '/download must succeed with working binary');
    assert.equal(r.body.length, FAKE_OUT.length, 'must stream the ENTIRE stdout');
    assert.ok(r.body.equals(FAKE_OUT), 'bytes must match tool output');
    assert.match(String(r.headers['content-type'] || ''), /audio|octet-stream/);
    assert.match(String(r.headers['content-disposition'] || ''), /attachment/i);
    assert.match(String(r.headers['content-disposition'] || ''), /\.m4a/i, 'filename should carry .m4a');
    assert.match(String(r.headers['access-control-allow-origin'] || ''), /\*/);
  });

  test('missing videoId -> 400', async () => {
    const r = await get('/download');
    assert.equal(r.status, 400);
  });
});

describe('Y3 honest failure when no binary available', () => {
  let srv2, port2;
  before(async () => {
    srv2 = mod.startServer(0, { ytdlpPath: path.join(tmpDir, 'definitely-missing.exe'), stateDir: path.join(tmpDir, 'state2') });
    await new Promise((r) => srv2.on('listening', r));
    port2 = srv2.address().port;
  });
  after(() => { try { srv2.close(); } catch {} });

  test('/download without usable binary -> 502 JSON error (never hangs)', { timeout: 30000 }, async () => {
    const r = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: port2, path: '/download?videoId=abc', method: 'GET' }, (res) => {
        const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c) }));
      });
      req.on('error', reject); req.end();
    });
    assert.equal(r.status, 502);
    const j = JSON.parse(r.body.toString());
    assert.ok(j.error, 'must carry honest error message');
  });

  test('/ytdlp-status reports unavailable on second server too', async () => {
    const r = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: port2, path: '/ytdlp-status', method: 'GET' }, (res) => {
        const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c) }));
      });
      req.on('error', reject); req.end();
    });
    const j = JSON.parse(r.body.toString());
    assert.equal(j.available, false);
  });
});
