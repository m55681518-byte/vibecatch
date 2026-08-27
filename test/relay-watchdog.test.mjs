// GUARDIAN TDD ENFORCER — relay watchdog (freebuff-task-20260827-182100)
// The PWA's relay pool is fed by two local quick tunnels (node :8794 + worker :8795)
// whose trycloudflare.com URLs rotate/die without notice. This watchdog is the
// auto-healing controller: it polls /vibecheck on each relay (remote + local),
// respawns the tunnel (or the local service) when one goes a-symmetric, rewrites
// public/workers.json, commits on main, rebuilds dist and refreshes gh-pages.
// All decision logic must be pure and unit-testable WITHOUT tunnels/git/network.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const wdPath = path.join(root, 'tools', 'relay-watchdog.mjs');

before(() => {
  if (!fs.existsSync(wdPath)) throw new Error('tools/relay-watchdog.mjs does not exist yet');
});

describe('W1 tunnel log URL extraction (pure)', () => {
  test('parses the cloudflared banner URL line', async () => {
    const mod = await import(url.pathToFileURL(wdPath).href);
    const line = '2026-08-27T14:41:58Z INF |  https://common-encoding-wax-languages.trycloudflare.com                                   |';
    assert.equal(mod.extractTunnelUrl(line), 'https://common-encoding-wax-languages.trycloudflare.com');
  });
  test('returns null when no URL is present yet (tunnel still registering)', async () => {
    const mod = await import(url.pathToFileURL(wdPath).href);
    assert.equal(mod.extractTunnelUrl('2026-08-27T14:41:51Z INF Requesting new quick Tunnel on trycloudflare.com...'), null);
  });
});

describe('W2 probe classification (pure)', () => {
  test('healthy remap: 200 + ok:true + name matching vibecatch', async () => {
    const mod = await import(url.pathToFileURL(wdPath).href);
    assert.equal(mod.probeHealthy({ status: 200, name: 'vibecatch-remote-worker', ok: true }), true);
    assert.equal(mod.probeHealthy({ status: 200, name: 'vibecatch-local-node', ok: true }), true);
  });
  test('unhealthy: non-200, ok:false, or name mismatch', async () => {
    const mod = await import(url.pathToFileURL(wdPath).href);
    assert.equal(mod.probeHealthy({ status: 502, name: 'vibecatch-remote-worker', ok: false }), false);
    assert.equal(mod.probeHealthy({ status: 200, name: 'vibecatch-remote-worker', ok: false }), false);
    assert.equal(mod.probeHealthy({ status: 200, name: 'something-else', ok: true }), false);
    assert.equal(mod.probeHealthy(null), false);
    assert.equal(mod.probeHealthy({ status: 404 }), false);
  });
});

describe('W3 pool assembly + unchanged detection (pure)', () => {
  test('builds the /vibecheck pool entries with https prefix', async () => {
    const mod = await import(url.pathToFileURL(wdPath).href);
    const pool = mod.buildPool([
      { role: 'node', url: 'https://relay-a.trycloudflare.com' },
      { role: 'worker', url: 'https://relay-b.trycloudflare.com' },
    ]);
    assert.deepEqual(pool, [
      'https://relay-a.trycloudflare.com/vibecheck',
      'https://relay-b.trycloudflare.com/vibecheck',
    ]);
  });
  test('pool unchanged helper compares arrays by value', async () => {
    const mod = await import(url.pathToFileURL(wdPath).href);
    const a = ['https://x.trycloudflare.com/vibecheck'];
    const b = ['https://x.trycloudflare.com/vibecheck'];
    const c = ['https://y.trycloudflare.com/vibecheck'];
    assert.equal(mod.poolUnchanged(a, b), true);
    assert.equal(mod.poolUnchanged(a, c), false);
    assert.equal(mod.poolUnchanged(a, [...a, 'https://z.trycloudflare.com/vibecheck']), false);
  });
});

describe('W4 relay role model (who should respawn)', () => {
  test('healthy remote+local => role stays healthy', async () => {
    const mod = await import(url.pathToFileURL(wdPath).href);
    const role = mod.classifyRole({
      url: 'https://relay-a.trycloudflare.com',
      localOk: true, remoteOk: true, failures: 0,
    });
    if (typeof role === 'object') assert.equal(role.action, 'none');
    else assert.equal(role, 'none');
  });
  test('remote dead but local alive => tunnel needs respawn (once threshold reached)', async () => {
    const mod = await import(url.pathToFileURL(wdPath).href);
    const before = mod.classifyRole({ url: 'https://relay-a.trycloudflare.com', localOk: true, remoteOk: false, failures: 1 });
    const after = mod.classifyRole({ url: 'https://relay-a.trycloudflare.com', localOk: true, remoteOk: false, failures: 2 });
    const resolution = (r) => (r && typeof r === 'object' ? r.action : r);
    assert.equal(resolution(before), 'none', 'below threshold: keep current tunnel');
    assert.equal(resolution(after), 'respawn-tunnel', 'threshold reached: respawn tunnel, keep service');
  });
  test('local dead (both fail) => respawn the local service first', async () => {
    const mod = await import(url.pathToFileURL(wdPath).href);
    const r = mod.classifyRole({ url: 'https://relay-a.trycloudflare.com', localOk: false, remoteOk: false, failures: 2 });
    const resolution = (x) => (x && typeof x === 'object' ? x.action : x);
    assert.equal(resolution(r), 'respawn-service');
  });
  test('missing url entirely => needs tunnel respawn immediately', async () => {
    const mod = await import(url.pathToFileURL(wdPath).href);
    assert.equal(mod.classifyRole({ url: null, localOk: true, remoteOk: false, failures: 0 }), 'respawn-tunnel');
  });
});

describe('W5 state persistence (survives daemon restart)', () => {
  test('round-trips role state through JSON on disk', async () => {
    const mod = await import(url.pathToFileURL(wdPath).href);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-state-'));
    const file = path.join(dir, 'state.json');
    const snap = { roles: { node: { url: 'https://a.trycloudflare.com', failures: 1 } } };
    mod.saveState(file, snap);
    assert.deepEqual(mod.loadState(file), snap);
    assert.deepEqual(mod.loadState(path.join(dir, 'missing.json')), null);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('W6 hostname/URL validators (avoid corrupting pool)', () => {
  test('acceptances: cloudflared + custom relay hostnames', async () => {
    const mod = await import(url.pathToFileURL(wdPath).href);
    assert.equal(mod.validRelayUrl('https://victor-chrome-airports-pins.trycloudflare.com'), true);
    assert.equal(mod.validRelayUrl('https://relay.mydomain.com'), true);
    assert.equal(mod.validRelayUrl('https://relay.example.co.uk'), true);
  });
  test('rejections: http, non-https scheme, empty, garbage', async () => {
    const mod = await import(url.pathToFileURL(wdPath).href);
    assert.equal(mod.validRelayUrl('http://relay.mydomain.com'), false);
    assert.equal(mod.validRelayUrl('ftp://relay.mydomain.com'), false);
    assert.equal(mod.validRelayUrl(''), false);
    assert.equal(mod.validRelayUrl('not a url'), false);
    assert.equal(mod.validRelayUrl('https://'), false);
  });
});

describe('W7 git invocations always carry alliance identity (fresh clones have no config)', () => {
  test('gitCommand prefixes -c user.name/email on commit paths', async () => {
    const mod = await import(url.pathToFileURL(wdPath).href);
    const args = mod.gitCommand('C:\\repo', ['commit', '-m', 'watchdog: pool update']);
    assert.ok(args.includes('-c'), 'must pass identity via -c flags');
    const i = args.indexOf('user.name=alliance');
    assert.notEqual(i, -1, 'user.name=alliance missing: ' + JSON.stringify(args));
    assert.ok(args.includes('user.email=alliance@users.noreply.github.com'));
    assert.ok(args.includes('commit'));
  });
  test('every gitCommand positional keeps repoDir as -C target', async () => {
    const mod = await import(url.pathToFileURL(wdPath).href);
    const args = mod.gitCommand('C:\\deploy-clone', ['add', '-A']);
    assert.equal(args[0], '-C');
    assert.equal(args[1], 'C:\\deploy-clone');
  });
});