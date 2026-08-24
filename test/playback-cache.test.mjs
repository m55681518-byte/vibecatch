// GUARDIAN TDD ENFORCER — full-song playback cache (freebuff-task-20260824-playback)
// The windowed /stream relay is hard-capped (~1MiB total transfer from keyless
// googlevideo), so PLAYBACK of long songs dies mid-track. Fix: node caches the
// yt-dlp full file per videoId (prefetched on /resolve), serves /download from
// disk instantly with Range support, and PWA playback prefers that endpoint.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');

let cachedMod;
async function loadMod() {
  if (cachedMod) return cachedMod;
  cachedMod = await import(url.pathToFileURL(path.join(root, 'vibecatch-node.mjs').split(path.sep).join('/')).href);
  return cachedMod;
}

let cachedDl;
async function loadDownloadUrl() {
  if (cachedDl) return cachedDl;
  const { build } = await import(url.pathToFileURL(path.join(root, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-playback-test-'));
  const outFile = path.join(tmpDir, 'downloadUrl.test-build.mjs');
  await build({ entryPoints: [path.join(root, 'src', 'services', 'downloadUrl.ts')], outfile: outFile, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
  cachedDl = await import(url.pathToFileURL(outFile).href);
  return cachedDl;
}

let tmpRoot, binDir, echoCmd, counterFile;
const PAYLOAD = () => Buffer.from(JSON.stringify({ kind: 'audio-bytes', n: 4096 }));

before(async () => {
  await loadMod();
  delete process.env.VIBECATCH_YT_COOKIES;
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-playback-'));
  binDir = path.join(tmpRoot, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  counterFile = path.join(tmpRoot, 'spawns.log');
  process.env.VIBECATCH_TEST_COUNTER = counterFile;
  try { fs.rmSync(counterFile, { force: true }); } catch {}
  // fake yt-dlp: counts each spawn, emits a deterministic payload
  fs.writeFileSync(
    path.join(binDir, 'fake-ytdlp.mjs'),
    'import fs from "node:fs";' +
    'fs.appendFileSync(process.env.VIBECATCH_TEST_COUNTER,"1\\n");' +
    'process.stdout.write(Buffer.from(JSON.stringify({kind:"audio-bytes",n:4096})));\n'
  );
  echoCmd = path.join(binDir, 'fake-ytdlp.cmd');
  fs.writeFileSync(echoCmd, '@echo off\r\nnode "%~dp0fake-ytdlp.mjs" %*\r\n');
});

after(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

function makeServer(extraOpts = {}) {
  const stateDir = path.join(tmpRoot, 'state-' + Math.random().toString(36).slice(2));
  const server = cachedMod.startServer(0, { stateDir, ytdlpPath: echoCmd, ...extraOpts });
  return new Promise((resolve) => {
    server.listen ? server.on('listening', () => resolve({ server, port: server.address().port, stateDir }))
                  : resolve({ server, port: server.address().port, stateDir });
    if (server.listening) resolve({ server, port: server.address().port, stateDir });
  });
}
function get(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'GET', headers }, (res) => {
      const c = []; res.on('data', (d) => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(c) }));
    });
    req.on('error', reject); req.end();
  });
}
const spawns = () => (fs.existsSync(counterFile) ? fs.readFileSync(counterFile, 'utf8').trim().split('\n').filter(Boolean).length : 0);

describe('PC1 /download caches per videoId (tee) and re-serves from disk', () => {
  let ctx;
  before(async () => { ctx = await makeServer(); });
  after(() => { try { ctx.server.close(); } catch {} });

  test('cold: pipes payload AND leaves cached file; exactly 1 spawn', { timeout: 30000 }, async () => {
    const r1 = await get(ctx.port, '/download?videoId=coldvid1');
    assert.equal(r1.status, 200);
    assert.deepEqual(r1.buf, PAYLOAD());
    const finalPath = path.join(ctx.stateDir, 'cache', 'coldvid1.m4a');
    assert.equal(fs.existsSync(finalPath), true, 'cache file missing after cold download');
    assert.deepEqual(fs.readFileSync(finalPath), PAYLOAD());
    assert.equal(spawns(), 1, 'expected exactly 1 yt-dlp spawn');
    const r2 = await get(ctx.port, '/download?videoId=coldvid1');
    assert.deepEqual(r2.buf, PAYLOAD(), 'warm serve must return identical bytes');
    assert.equal(spawns(), 1, 'warm serve must NOT re-spawn yt-dlp');
  });
});

describe('PC2 pre-seeded cache serves instantly + Range works', () => {
  let ctx, base;
  before(async () => {
    ctx = await makeServer();
    fs.mkdirSync(path.join(ctx.stateDir, 'cache'), { recursive: true });
    fs.writeFileSync(path.join(ctx.stateDir, 'cache', 'warmvid.m4a'), PAYLOAD());
    base = spawns();
  });
  after(() => { try { ctx.server.close(); } catch {} });

  test('full serve from disk, zero spawns', { timeout: 30000 }, async () => {
    const r = await get(ctx.port, '/download?videoId=warmvid');
    assert.equal(r.status, 200);
    assert.deepEqual(r.buf, PAYLOAD());
    assert.match(r.headers['content-type'] || '', /audio\/mp4/);
    assert.equal(spawns() - base, 0);
  });

  test('Range bytes=10-19 -> 206 slice + Content-Range + Accept-Ranges', async () => {
    const r = await get(ctx.port, '/download?videoId=warmvid', { Range: 'bytes=10-19' });
    assert.equal(r.status, 206);
    assert.equal(r.buf.length, 10);
    assert.deepEqual(r.buf, PAYLOAD().subarray(10, 20));
    assert.match(r.headers['content-range'], /bytes 10-19\//);
    assert.equal(r.headers['accept-ranges'], 'bytes');
  });
});

describe('PC3 /cache-status reports cache state', () => {
  let ctx;
  before(async () => {
    ctx = await makeServer();
    fs.mkdirSync(path.join(ctx.stateDir, 'cache'), { recursive: true });
    fs.writeFileSync(path.join(ctx.stateDir, 'cache', 'stvid.m4a'), PAYLOAD());
  });
  after(() => { try { ctx.server.close(); } catch {} });

  test('cached:true + size for known id; cached:false otherwise', async () => {
    const hit = JSON.parse((await get(ctx.port, '/cache-status?videoId=stvid')).buf.toString());
    assert.equal(hit.ok, true);
    assert.equal(hit.cached, true);
    assert.equal(hit.size, PAYLOAD().length);
    const miss = JSON.parse((await get(ctx.port, '/cache-status?videoId=nope')).buf.toString());
    assert.equal(miss.cached, false);
  });
});

describe('PC4 ensureCached prefills cache without an HTTP download call', () => {
  test('direct call fills cache once, dedupes concurrent calls', { timeout: 30000 }, async () => {
    const stateDir = path.join(tmpRoot, 'state-ec');
    const [p1, p2] = [
      cachedMod.ensureCached('ecvid', { stateDir, ytdlpPath: echoCmd }),
      cachedMod.ensureCached('ecvid', { stateDir, ytdlpPath: echoCmd }),
    ];
    const out1 = await p1, out2 = await p2;
    const finalPath = path.join(stateDir, 'cache', 'ecvid.m4a');
    assert.equal(fs.existsSync(finalPath), true, 'ensureCached must produce cache file');
    assert.deepEqual(fs.readFileSync(finalPath), PAYLOAD());
    assert.equal(spawns() >= 1, true);
    assert.equal(out1, out2, 'concurrent calls share one result path');
  });
});

describe('PW1 PWA playback prefers node /download over capped /stream', () => {
  test('downloadUrl.ts exports playbackSourceFor with blob > downloadUrl > streamUrl', async () => {
    const dl = await loadDownloadUrl();
    assert.equal(typeof dl.playbackSourceFor, 'function', 'missing export playbackSourceFor');
    const t = { streamUrl: 'http://127.0.0.1:1/stream?url=x', downloadUrl: 'http://127.0.0.1:1/download?videoId=v' };
    assert.equal(dl.playbackSourceFor(t, 'blob:xyz'), 'blob:xyz');
    assert.equal(dl.playbackSourceFor(t, null), t.downloadUrl);
    assert.equal(dl.playbackSourceFor({ streamUrl: 's' }, null), 's');
  });

  test('getPlayableAudioUrl routes through playbackSourceFor (no raw streamUrl fallback)', () => {
    const src = fs.readFileSync(path.join(root, 'src', 'services', 'demuxer.ts'), 'utf8');
    assert.match(src, /playbackSourceFor\s*\(/, 'getPlayableAudioUrl must use playbackSourceFor');
    assert.doesNotMatch(src, /return track\.streamUrl\s*;/, 'raw streamUrl playback fallback forbidden');
  });
});
