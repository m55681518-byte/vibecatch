// GUARDIAN TDD ENFORCER — local node POT/client-chain port (freebuff-task-localpot)
// The local node (what real users' devices actually run) must carry the same
// SABR-proof recipe proven live on the remote worker (journal 060):
//   --js-runtimes node  +  player_client=mweb,tv_simply  +  bgutil POT base_url
// Env contract identical to the worker: VIBECATCH_POT_URL overrides default
// http://127.0.0.1:4416; empty/whitespace disables BOTH extractor-args.
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

let tmpDir, fakeBin, server, port;

before(async () => {
  if (!mod.startServer) throw new Error('startServer not exported');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-localpot-'));
  fs.writeFileSync(
    path.join(tmpDir, 'fake-ytdlp.mjs'),
    'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n'
  );
  fakeBin = path.join(tmpDir, 'fake-ytdlp.cmd');
  fs.writeFileSync(fakeBin, '@echo off\r\nnode "%~dp0fake-ytdlp.mjs" %*\r\n');
  server = mod.startServer(0, { ytdlpPath: fakeBin, cookiesPath: null, stateDir: path.join(tmpDir, 'state') });
  await new Promise((r) => server.on('listening', r));
  port = server.address().port;
});
after(() => { try { server.close(); } catch {} try { server.closeAllConnections?.(); } catch {} try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

function getBody(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'GET', headers: { connection: 'close' } }, (res) => {
      const c = []; res.on('data', (d) => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }));
    });
    req.on('error', reject); req.end();
  });
}

function lastArgv() {
  // distinct videoIds per test keep disk cache from shadowing; body = echoed argv JSON
  return null;
}

describe('L1 local node solves n-challenges (--js-runtimes node in argv)', () => {
  test('cold /download argv includes --js-runtimes node', { timeout: 30000 }, async () => {
    delete process.env.VIBECATCH_POT_URL;
    const r = await getBody('/download?videoId=l1jsruntime0');
    assert.equal(r.status, 200);
    const argv = JSON.parse(r.body);
    const i = argv.indexOf('--js-runtimes');
    assert.notEqual(i, -1, '--js-runtimes missing from argv: ' + r.body.slice(0, 300));
    assert.equal(argv[i + 1], 'node', 'runtime must be node');
  });
});

describe('L2 SABR-proof client chain in local-node argv', () => {
  test('argv carries youtube:player_client=mweb,tv_simply', { timeout: 30000 }, async () => {
    delete process.env.VIBECATCH_POT_URL;
    const r = await getBody('/download?videoId=l2clientchain0');
    assert.equal(r.status, 200);
    const argv = JSON.parse(r.body);
    const pairs = [];
    for (let k = 0; k < argv.length - 1; k++) if (argv[k] === '--extractor-args') pairs.push(argv[k + 1]);
    const clientArg = pairs.find((s) => /youtube:player_client=/.test(s));
    assert.ok(clientArg, 'no player_client extractor-arg in argv: ' + JSON.stringify(pairs));
    assert.match(clientArg, /player_client=mweb,tv_simply$/, 'wrong client chain: ' + clientArg);
  });
});

describe('L3 VIBECATCH_POT_URL override + disable semantics (worker parity)', () => {
  test('override URL lands in argv', { timeout: 30000 }, async () => {
    process.env.VIBECATCH_POT_URL = 'http://192.0.2.7:9999';
    try {
      const r = await getBody('/download?videoId=l3override00');
      assert.equal(r.status, 200);
      const argv = JSON.parse(r.body);
      assert.ok(argv.includes('youtubepot-bgutilhttp:base_url=http://192.0.2.7:9999'),
        'override not used: ' + r.body.slice(0, 400));
    } finally { delete process.env.VIBECATCH_POT_URL; }
  });
  test('empty string disables BOTH extractor-args', { timeout: 30000 }, async () => {
    process.env.VIBECATCH_POT_URL = '';
    try {
      const r = await getBody('/download?videoId=l3disabled0');
      assert.equal(r.status, 200);
      const argv = JSON.parse(r.body);
      assert.ok(!argv.some((a) => String(a).includes('youtubepot')), 'POT arg present despite disable');
      assert.ok(!argv.some((a) => String(a).includes('player_client=')), 'client chain present despite disable');
    } finally { delete process.env.VIBECATCH_POT_URL; }
  });
});
