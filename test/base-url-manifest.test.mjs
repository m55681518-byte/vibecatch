// GUARDIAN TDD ENFORCER — base-relative relay manifest + Capacitor scaffold (freebuff-task-20260827-130500)
// GitHub Pages serves this SPA at a SUBPATH (https://m55681518-byte.github.io/vibecatch/) and Capacitor
// serves from a custom scheme — both break an absolute '/workers.json'. The manifest URL must be
// resolvable relative to import.meta.env.BASE_URL.
// BL1: with BASE_URL '/' the helper keeps producing origin + /workers.json (legacy behavior preserved).
// BL2: with BASE_URL './' under https://host/vibecatch/ the helper yields https://host/vibecatch/workers.json.
// BL3: with no browser globals the helper falls back to RELAY_MANIFEST_PATH ('/workers.json') so node
//      tests/probes keep working.
// BL4: probeRelayManifest still uses the resolved URL and returns the healthy relay (regression).
// CP1: capacitor.config (webDir=dist) exists; android/ project scaffold exists.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');

async function esbuildLoad(entry, name) {
  const { build } = await import(url.pathToFileURL(path.join(root, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-base-test-'));
  const outFile = path.join(tmpDir, name + '.test-build.mjs');
  await build({ entryPoints: [entry], outfile: outFile, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
  return import(url.pathToFileURL(outFile).href);
}

const localNodePath = path.join(root, 'src', 'services', 'localNode.ts');

describe('BL base-relative relay manifest URL', () => {
  test('BL1 BASE_URL "/" keeps origin-absolute manifest URL', async () => {
    const mod = await esbuildLoad(localNodePath, 'localNode');
    const actual = mod.resolveRelayManifestUrl({
      envBase: '/',
      location: { origin: 'https://host', href: 'https://host/vibecatch/' },
    });
    assert.equal(actual, 'https://host/workers.json');
  });

  test('BL2 BASE_URL "./" resolves manifest under the GH Pages subpath', async () => {
    const mod = await esbuildLoad(localNodePath, 'localNode');
    const actual = mod.resolveRelayManifestUrl({
      envBase: './',
      location: { origin: 'https://host', href: 'https://host/vibecatch/' },
    });
    assert.equal(actual, 'https://host/vibecatch/workers.json');
  });

  test('BL3 no browser globals -> RELAY_MANIFEST_PATH fallback', async () => {
    const mod = await esbuildLoad(localNodePath, 'localNode');
    const actual = mod.resolveRelayManifestUrl();
    assert.equal(actual, '/workers.json');
  });

  test('BL4 probeRelayManifest uses resolved URL and returns healthy relay', async () => {
    const mod = await esbuildLoad(localNodePath, 'localNode');
    const calls = [];
    const fetcher = async (input) => {
      calls.push(String(input));
      const u = String(input);
      if (u.endsWith('/workers.json')) {
        return { ok: true, json: async () => ['https://relay.trycloudflare.com/vibecheck'] };
      }
      if (u === 'https://relay.trycloudflare.com/vibecheck') {
        return { ok: true, json: async () => ({ ok: true, name: 'vibecatch-local-node', version: '1.0.0' }) };
      }
      throw new Error('unexpected fetch: ' + input);
    };
    const relay = await mod.probeRelayManifest({
      manifestUrl: 'https://host/vibecatch/workers.json',
      fetchImpl: fetcher,
    });
    assert.equal(calls[0], 'https://host/vibecatch/workers.json', 'first fetch must be the manifest');
    assert.ok(relay, 'expected a healthy relay');
    assert.equal(relay.baseUrl, 'https://relay.trycloudflare.com');
  });
});

describe('CP Capacitor scaffold', () => {
  test('CP1 capacitor config targets dist and android platform is scaffolded', () => {
    const hasConfig = fs.existsSync(path.join(root, 'capacitor.config.ts')) || fs.existsSync(path.join(root, 'capacitor.config.json'));
    assert.equal(hasConfig, true, 'missing capacitor.config');
    const androidGradle = path.join(root, 'android', 'build.gradle');
    assert.equal(fs.existsSync(androidGradle), true, 'missing android/build.gradle');
    const cfg = fs.readFileSync(hasConfig ? path.join(root, 'capacitor.config.ts') : path.join(root, 'capacitor.config.json'), 'utf8');
    assert.match(cfg, /webDir/, 'config must set webDir');
    assert.match(cfg, /dist/, 'webDir must point at the built app (dist)');
  });
});