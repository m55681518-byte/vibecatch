// GUARDIAN TDD ENFORCER — yt-dlp cookies support (freebuff-task-20260823-ytcookies)
// The node must pass --cookies <path> to yt-dlp when a Netscape cookies.txt is
// discoverable at: opts.cookiesPath -> env VIBECATCH_YT_COOKIES -> %TEMP%/vibecatch-ytdlp/cookies.txt
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

let tmpDir, fakeBin, payload, server, port;

before(async () => {
  if (!mod.startServer) throw new Error('startServer not exported');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-ytcookies-'));
  // fake binary that echoes its argv as JSON lines to stdout
  // (%* forwarding is required: without it the inner node sees an empty argv)
  fs.writeFileSync(
    path.join(tmpDir, 'fake-ytdlp.mjs'),
    'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n'
  );
  fakeBin = path.join(tmpDir, 'fake-ytdlp.cmd');
  fs.writeFileSync(
    fakeBin,
    '@echo off\r\nnode "%~dp0fake-ytdlp.mjs" %*\r\n'
  );
  server = mod.startServer(0, { ytdlpPath: fakeBin, cookiesPath: path.join(tmpDir, 'cookies.txt') });
  await new Promise((r) => server.on('listening', r));
  port = server.address().port;
});
after(() => { try { server.close(); } catch {} try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

function getBody(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'GET' }, (res) => {
      const c = []; res.on('data', (d) => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }));
    });
    req.on('error', reject); req.end();
  });
}

describe('C1 /download passes --cookies when file exists', () => {
  test('argv includes --cookies <resolved path>', { timeout: 30000 }, async () => {
    fs.writeFileSync(path.join(tmpDir, 'cookies.txt'), '# Netscape HTTP Cookie File\n');
    const r = await getBody('/download?videoId=4_zr_97R5mw');
    assert.equal(r.status, 200);
    const argv = JSON.parse(r.body);
    const i = argv.indexOf('--cookies');
    assert.notEqual(i, -1, '--cookies flag missing from yt-dlp argv: ' + r.body.slice(0, 300));
    assert.equal(argv[i + 1], path.join(tmpDir, 'cookies.txt'));
  });

  test('status endpoint reports cookie state', async () => {
    const r = await getBody('/ytdlp-status');
    const j = JSON.parse(r.body);
    assert.equal(j.ok, true);
    assert.equal(j.cookiesAvailable, true);
  });
});

describe('C2 no cookies file -> argv unchanged (no --cookies)', () => {
  test('missing file is skipped silently', async () => {
    // point at a path we never create
    fs.rmSync(path.join(tmpDir, 'cookies.txt'), { force: true });
    const r = await getBody('/download?videoId=4_zr_97R5mw');
    assert.equal(r.status, 200);
    const argv = JSON.parse(r.body);
    assert.equal(argv.indexOf('--cookies'), -1, 'must not pass --cookies for absent file');
  });
});
