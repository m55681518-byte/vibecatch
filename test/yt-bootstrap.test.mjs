// GUARDIAN TDD ENFORCER — cookies bootstrap + honest 502 (freebuff-task-20260823-bootstrap)
// B1: with no cookies anywhere, the node must auto-create a minimal Netscape
//     cookies.txt inside its state dir (opts.stateDir, default tmpdir/vibecatch-ytdlp)
//     and then pass --cookies <that path> to yt-dlp. This is what makes full
//     downloads work out-of-the-box (any cookiejar bypasses the bot-wall).
// B2: /ytdlp-status reports cookiesAvailable:true after bootstrap.
// C2: an EXPLICIT but missing opts.cookiesPath must NOT trigger bootstrap
//     (explicit wins; file never created; no --cookies flag).
// E1: /download returns 502 (not 200) when yt-dlp exits nonzero before
//     emitting any audio byte.
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

let tmpRoot, echoBinDir, echoCmd;
delete process.env.VIBECATCH_YT_COOKIES;

before(async () => {
  if (!mod.startServer) throw new Error('startServer not exported');
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-bootstrap-'));
  // fake yt-dlp that echoes its argv as JSON (argv[2:] of the .mjs)
  echoBinDir = path.join(tmpRoot, 'bin');
  fs.mkdirSync(echoBinDir, { recursive: true });
  fs.writeFileSync(
    path.join(echoBinDir, 'fake-ytdlp.mjs'),
    'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n'
  );
  echoCmd = path.join(echoBinDir, 'fake-ytdlp.cmd');
  fs.writeFileSync(echoCmd, '@echo off\r\nnode "%~dp0fake-ytdlp.mjs" %*\r\n');
});

after(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

function getBody(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'GET' }, (res) => {
      const c = []; res.on('data', (d) => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }));
    });
    req.on('error', reject); req.end();
  });
}

async function up(server) {
  await new Promise((r) => server.on('listening', r));
  return server.address().port;
}

describe('B1 bootstrap creates default cookies.txt + passes --cookies', () => {
  let server, port, stateDir;
  before(async () => {
    stateDir = path.join(tmpRoot, 'state-b1');
    server = mod.startServer(0, { stateDir, ytdlpPath: echoCmd });
    port = await up(server);
  });
  after(() => { try { server.close(); } catch {} });

  test('cookies.txt exists in stateDir after start (no explicit/env cookie)', () => {
    const p = path.join(stateDir, 'cookies.txt');
    assert.equal(fs.existsSync(p), true, 'bootstrap did not create ' + p);
    const txt = fs.readFileSync(p, 'utf8');
    assert.match(txt, /\.youtube\.com/, 'stub must reference .youtube.com domain');
  });

  test('/download argv includes --cookies <stateDir>/cookies.txt', { timeout: 30000 }, async () => {
    const r = await getBody(port, '/download?videoId=4_zr_97R5mw');
    assert.equal(r.status, 200);
    const argv = JSON.parse(r.body);
    const i = argv.indexOf('--cookies');
    assert.notEqual(i, -1, '--cookies missing from argv: ' + r.body.slice(0, 300));
    assert.equal(argv[i + 1], path.join(stateDir, 'cookies.txt'));
  });

  test('B2 /ytdlp-status reports cookiesAvailable:true', async () => {
    const j = JSON.parse((await getBody(port, '/ytdlp-status')).body);
    assert.equal(j.cookiesAvailable, true);
  });
});

describe('C2 explicit-but-missing cookiesPath disables bootstrap', () => {
  let server, port, stateDir;
  before(async () => {
    stateDir = path.join(tmpRoot, 'state-c2');
    server = mod.startServer(0, { stateDir, ytdlpPath: echoCmd, cookiesPath: path.join(stateDir, 'nope.txt') });
    port = await up(server);
  });
  after(() => { try { server.close(); } catch {} });

  test('no file created, no --cookies in argv', { timeout: 30000 }, async () => {
    const r = await getBody(port, '/download?videoId=4_zr_97R5mw');
    assert.equal(r.status, 200);
    const argv = JSON.parse(r.body);
    assert.equal(argv.indexOf('--cookies'), -1, 'must not pass --cookies for explicit missing path');
    assert.equal(fs.existsSync(path.join(stateDir, 'nope.txt')), false, 'bootstrap must not create explicit path');
    assert.equal(fs.existsSync(path.join(stateDir, 'cookies.txt')), false, 'bootstrap must be disabled when cookiesPath is set');
  });
});

describe('E1 /download is a honest 502 when yt-dlp fails pre-audio', () => {
  let server, port;
  before(async () => {
    const failCmd = path.join(tmpRoot, 'fail-ytdlp.cmd');
    fs.writeFileSync(failCmd, '@echo off\r\nexit /b 1\r\n');
    server = mod.startServer(0, { stateDir: path.join(tmpRoot, 'state-e1'), ytdlpPath: failCmd });
    port = await up(server);
  });
  after(() => { try { server.close(); } catch {} });

  test('status 502 with JSON error body', { timeout: 30000 }, async () => {
    const r = await getBody(port, '/download?videoId=4_zr_97R5mw');
    assert.equal(r.status, 502, 'expected 502, got ' + r.status + ' body=' + r.body.slice(0, 200));
    const j = JSON.parse(r.body);
    assert.ok(j.error, 'body must carry error field');
  });
});
