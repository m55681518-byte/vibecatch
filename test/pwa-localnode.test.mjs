// GUARDIAN TDD ENFORCER — Phase 1 Local Node (freebuff-task-20260823-localnode)
// Part 2: PWA side — src/services/localNode.ts (esbuild-loaded like resolver tests)
// + extractor/Settings integration.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const servicePath = path.join(root, 'src', 'services', 'localNode.ts');

let cachedMod;
async function loadLocalNode() {
  if (!fs.existsSync(servicePath)) throw new Error('src/services/localNode.ts does not exist yet');
  if (cachedMod) return cachedMod;
  const { build } = await import(url.pathToFileURL(path.join(root, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-localnode-test-'));
  const outFile = path.join(tmpDir, 'localNode.test-build.mjs');
  await build({ entryPoints: [servicePath], outfile: outFile, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
  cachedMod = await import(url.pathToFileURL(outFile).href);
  return cachedMod;
}

describe('P1 localNode probe contract', () => {
  test('detects node on a port via stubbed fetch; null when absent; never throws', async () => {
    const mod = await loadLocalNode();
    for (const fn of ['DEFAULT_PORTS', 'probeLocalNode', 'resolveViaLocalNode']) {
      assert.notEqual(mod[fn], undefined, `missing export: ${fn}`);
    }
    assert.ok(Array.isArray(mod.DEFAULT_PORTS) && mod.DEFAULT_PORTS.includes(8794), '8794 must be default port');
    const okFetch = async (u) => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, name: 'vibecatch-local-node', version: '1.0.0' }),
    });
    const hit = await mod.probeLocalNode({ fetchImpl: okFetch });
    assert.ok(hit && typeof hit.port === 'number', 'probe returns port when alive');
    const deadFetch = async () => { throw new TypeError('ECONNREFUSED'); };
    const miss = await mod.probeLocalNode({ fetchImpl: deadFetch });
    assert.equal(miss, null, 'no node -> null');
    assert.doesNotThrow(() => mod.probeLocalNode({ fetchImpl: deadFetch }), 'never throws');
  });

  test('wrong name payload is rejected', async () => {
    const mod = await loadLocalNode();
    const impostor = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, name: 'something-else' }) });
    assert.equal(await mod.probeLocalNode({ fetchImpl: impostor }), null);
  });
});

describe('P2 resolveViaLocalNode mapping', () => {
  test('/resolve JSON -> ResolvedAudio with source=local-node; error -> null', async () => {
    const mod = await loadLocalNode();
    const good = async () => ({
      ok: true, status: 200,
      json: async () => ({ audioUrl: 'https://gv/videoplayback?a=1', title: 'T', artist: 'A', duration: 199 }),
    });
    const out = await mod.resolveViaLocalNode('abc12345678', { fetchImpl: good, port: 8794 });
    assert.ok(out && out.audioUrl === 'https://gv/videoplayback?a=1');
    assert.equal(out.source, 'local-node');
    const bad = async () => ({ ok: true, status: 200, json: async () => ({ error: 'all clients failed' }) });
    assert.equal(await mod.resolveViaLocalNode('abc12345678', { fetchImpl: bad, port: 8794 }), null);
    const dead = async () => { throw new TypeError('down'); };
    assert.equal(await mod.resolveViaLocalNode('abc12345678', { fetchImpl: dead, port: 8794 }), null);
  });
});

describe('P3 extractor integration — local node tried BEFORE public race', () => {
  test('extractor.ts wires localNode first inside extractYouTube3Tier', () => {
    const srcPath = path.join(root, 'src', 'services', 'extractor.ts');
    assert.ok(fs.existsSync(srcPath), 'extractor exists');
    const src = fs.readFileSync(srcPath, 'utf8');
    assert.match(src, /from ['"]\.\/localNode['"]/, 'must import ./localNode');
    const fnStart = src.indexOf('async function extractYouTube3Tier');
    const body = src.slice(fnStart, src.indexOf('\n}', fnStart) + 2);
    assert.ok(body.length > 100, 'function body found');
    const lnPos = body.search(/resolveViaLocalNode|tryLocalNode|localResolve/i);
    const racePos = body.indexOf('raceYouTubeResolvers');
    assert.ok(lnPos >= 0, 'YT extraction must attempt the local node');
    assert.ok(racePos > lnPos, 'public race must come AFTER local-node attempt');
  });
});

describe('P4 Settings UI exposes Local Node panel', () => {
  test('SettingsTab mentions Local Node + download + run instructions', () => {
    const p = path.join(root, 'src', 'components', 'SettingsTab.tsx');
    assert.ok(fs.existsSync(p), 'SettingsTab exists');
    const src = fs.readFileSync(p, 'utf8');
    assert.match(src, /Local Node/i, 'panel title present');
    assert.match(src, /vibecatch-node\.mjs/, 'download link to the script present');
    assert.match(src, /node\s+vibecatch-node\.mjs|node vibecatch-node/i, 'run instructions present');
  });
});

describe('P5 site serves the node script publicly', () => {
  test('public/vibecatch-node.mjs exists and matches root script bytes', () => {
    const pub = path.join(root, 'public', 'vibecatch-node.mjs');
    const rootScript = path.join(root, 'vibecatch-node.mjs');
    assert.ok(fs.existsSync(pub), 'public copy missing');
    assert.equal(
      fs.readFileSync(pub, 'utf8'),
      fs.readFileSync(rootScript, 'utf8'),
      'public copy must be identical to root script',
    );
  });
});
