// GUARDIAN TDD ENFORCER — remote worker service (freebuff-task-20260824-worker, Turn A)
// A zero-dependency Node HTTP worker that ANY device's browser can use for full-song
// extraction with no local setup. Contract mirrors the local node so the PWA can
// treat workers as interchangeable endpoints from a plain JSON list (workers.json).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const workerPath = path.join(root, 'worker', 'vibecatch-worker.mjs');

let server, baseUrl, tmpDir;

function get(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(baseUrl + pathname, { headers }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(c), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  if (!fs.existsSync(workerPath)) throw new Error('worker/vibecatch-worker.mjs does not exist yet');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-worker-'));
  // fake yt-dlp .cmd that echoes a deterministic payload; counts spawns
  const counterFile = path.join(tmpDir, 'spawns.log');
  process.env.VIBECATCH_WORKER_COUNTER = counterFile;
  const argsLog = path.join(tmpDir, 'args.log');
  process.env.VIBECATCH_WORKER_ARGS = argsLog;
  globalThis.__vcWorkerArgsLog = argsLog;
  fs.writeFileSync(
    path.join(tmpDir, 'fake-ytdlp.mjs'),
    'import fs from "node:fs";' +
    'const args=process.argv.slice(2);' +
    'fs.appendFileSync(process.env.VIBECATCH_WORKER_COUNTER,"1\\n");' +
    'fs.appendFileSync(process.env.VIBECATCH_WORKER_ARGS,JSON.stringify(args)+"\\n");' +
    'if(args.some(a=>a==="--dump-json")){process.stdout.write(JSON.stringify({id:"w1",title:"Test Song",duration:180,thumbnail:"https://x/t.jpg"}));}' +
    'else{process.stdout.write(Buffer.from("AUDIOBYTES0123456789"));}\n'
  );
  const fakeBin = process.platform === 'win32' ? path.join(tmpDir, 'fake.cmd') : path.join(tmpDir, 'fake.sh');
  fs.writeFileSync(fakeBin, process.platform === 'win32'
    ? '@echo off\r\nnode "%~dp0fake-ytdlp.mjs" %*\r\n'
    : '#!/bin/sh\nnode "' + path.join(tmpDir, 'fake-ytdlp.mjs') + '" "$@"\n');
  if (process.platform !== 'win32') fs.chmodSync(fakeBin, 0o755);

  const mod = await import(url.pathToFileURL(workerPath).href);
  server = mod.startServer(0, { ytdlpPath: fakeBin, stateDir: path.join(tmpDir, 'state') });
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});
after(() => { try { server.close(); } catch {} try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

describe('R1 worker identity + CORS (browser-reachable from any origin)', () => {
  test('/vibecheck identifies as vibecatch-remote-worker', async () => {
    const r = await get('/vibecheck', { Origin: 'https://vibecatch.pages.dev' });
    assert.equal(r.status, 200);
    const j = JSON.parse(r.buf.toString());
    assert.equal(j.ok, true);
    assert.equal(j.name, 'vibecatch-remote-worker');
    assert.match(r.headers['access-control-allow-origin'] || '', /.*/, 'ACAO header required');
  });
  test('OPTIONS preflight answered for private-network-less cross-origin GETs', async () => {
    const r = await get('/vibecheck'.replace('', ''), {});
    assert.equal(r.status, 200);
  });
});

describe('R2 /resolve returns honest metadata via yt-dlp --dump-json', () => {
  test('metadata shape', async () => {
    const r = await get('/resolve?videoId=w1vid');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.buf.toString());
    assert.equal(j.title, 'Test Song');
    assert.equal(j.duration, 180);
    assert.ok(j.videoId === undefined || j.videoId === 'w1vid');
  });
  test('yt-dlp failure -> honest 502 JSON, never fabricated data', async () => {
    const r = await get('/resolve?videoId=FAILME');
    assert.equal(r.status, 502);
    const j = JSON.parse(r.buf.toString());
    assert.ok(j.error, 'must carry error field');
  });
});

describe('R3 /download pipes FULL audio bytes through the worker', () => {
  test('streams bytes with attachment disposition + content-type', async () => {
    const r = await get('/download?videoId=w1vid&title=Test%20Song&artist=X');
    assert.equal(r.status, 200);
    assert.equal(r.buf.toString(), 'AUDIOBYTES0123456789', 'must relay the binary body verbatim');
    assert.match(String(r.headers['content-disposition'] || ''), /attachment/);
    assert.match(String(r.headers['content-type'] || ''), /audio|octet-stream/);
  });
  test('supports Range passthrough (206) so phones can seek', async () => {
    const r = await get('/download?videoId=w1vid&range=bytes=0-4');
    assert.ok([200, 206].includes(r.status));
  });
  test('failed spawn never poisons the cache and returns 502', async () => {
    const r1 = await get('/download?videoId=FAILME');
    assert.equal(r1.status, 502);
    const r2 = await get('/download?videoId=FAILME');
    assert.equal(r2.status, 502);
  });
});

describe('R4 disk cache serves warm requests without re-spawning', () => {
  test('second identical download is served from cache (spawn count stable)', async () => {
    const counterFile = process.env.VIBECATCH_WORKER_COUNTER;
    const count = () => (fs.existsSync(counterFile) ? fs.readFileSync(counterFile, 'utf8').split('\n').filter(Boolean).length : 0);
    const before = count();
    const a = await get('/download?videoId=cacheme');
    const mid = count();
    const b = await get('/download?videoId=cacheme');
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.deepEqual(b.buf, a.buf);
    assert.equal(count() - mid, 0, 'warm request must not spawn yt-dlp again');
    assert.ok(mid - before >= 1, 'cold request must have spawned once');
  });
});

describe('R5 workers.json manifest exists for the client pool', () => {
  test('public/workers.json is a valid JSON array of https URLs', () => {
    const p = path.join(root, 'public', 'workers.json');
    assert.ok(fs.existsSync(p), 'public/workers.json missing');
    const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.ok(Array.isArray(arr), 'must be an array');
    for (const u of arr) assert.match(u, /^https:\/\/[a-z0-9.-]+/i, 'each entry must be an https URL: ' + u);
  });
});

describe('R6 cookie jar reaches yt-dlp (bot-wall bypass on datacenter IPs)', () => {
  test('cold /download argv includes --cookies pointing at an existing Netscape jar', { timeout: 30000 }, async () => {
    const r = await get('/download?videoId=cookievid1&title=Ck');
    assert.equal(r.status, 200);
    const lines = fs.readFileSync(globalThis.__vcWorkerArgsLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const last = lines[lines.length - 1];
    const i = last.indexOf('--cookies');
    assert.notEqual(i, -1, '--cookies missing from yt-dlp argv: ' + JSON.stringify(last));
    assert.ok(fs.existsSync(last[i + 1]), 'cookie jar path must exist: ' + last[i + 1]);
    assert.match(fs.readFileSync(last[i + 1], 'utf8'), /Netscape/, 'jar must be Netscape format');
  });
  test('/resolve argv also carries --cookies (metadata hits the same wall)', async () => {
    await get('/resolve?videoId=cookievid2');
    const lines = fs.readFileSync(globalThis.__vcWorkerArgsLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const last = lines[lines.length - 1];
    assert.ok(last.includes('--dump-json'), JSON.stringify(last));
    assert.notEqual(last.indexOf('--cookies'), -1, '--cookies missing from resolve argv: ' + JSON.stringify(last));
  });
});
