// GUARDIAN TDD ENFORCER — zero-setup remote-relay fallback (freebuff-task-relay)
// The PWA is hardwired to localhost:8794 (Termux/desktop node). A phone user who
// hasn't installed anything must still be able to download. When NO local node is
// alive, the app must discover a REMOTE relay (listed in public/workers.json,
// e.g. a Cloudflare quick tunnel to our node) and resolve + download through it.
// RF1: buildRelayDownloadUrl builds a /download URL on the GIVEN base (https),
//      never hardcoding 127.0.0.1.
// RF2: probeRelayManifest fetches workers.json, probes each /vibecheck entry and
//      returns { baseUrl, version } for a healthy relay (or null).
// RF3: resolveViaRelay resolves a video against a relay base and returns a
//      ResolvedAudio carrying baseUrl + source 'relay'.
// RF4: extractor.ts wires the relay fallback (probe -> resolve -> relay URLs).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');

async function esbuildLoad(entry, name) {
  const { build } = await import(url.pathToFileURL(path.join(root, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-relay-test-'));
  const outFile = path.join(tmpDir, name + '.test-build.mjs');
  await build({ entryPoints: [entry], outfile: outFile, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
  return import(url.pathToFileURL(outFile).href);
}

const downloadUrlPath = path.join(root, 'src', 'services', 'downloadUrl.ts');
const localNodePath = path.join(root, 'src', 'services', 'localNode.ts');
const extractorPath = path.join(root, 'src', 'services', 'extractor.ts');

function fakeRelayServer() {
  const probeHits = [];
  const fetcher = async (input) => {
    const u = String(input);
    if (u === 'https://app.example/workers.json' || u.endsWith('/workers.json')) {
      return {
        ok: true,
        json: async () => ["https://relay.trycloudflare.com/vibecheck"],
      };
    }
    if (u === 'https://relay.trycloudflare.com/vibecheck') {
      probeHits.push(u);
      return { ok: true, json: async () => ({ ok: true, name: 'vibecatch-local-node', version: '9.9.9' }) };
    }
    if (u === 'https://relay.trycloudflare.com/resolve?videoId=vid_2') {
      return { ok: true, json: async () => ({ audioUrl: 'https://googlevideo.example/audio.m4a', title: 'Relay Song', artist: 'Relay Artist', duration: 222 }) };
    }
    throw new Error('unexpected fetch: ' + u);
  };
  return { fetcher, probeHits };
}

describe('RF1 buildRelayDownloadUrl uses the relay base (https)', () => {
  test('builds /download on the given base with encoded params', async () => {
    const mod = await esbuildLoad(downloadUrlPath, 'downloadUrl');
    assert.equal(typeof mod.buildRelayDownloadUrl, 'function', 'missing export buildRelayDownloadUrl');
    const u = new URL(mod.buildRelayDownloadUrl('https://relay.trycloudflare.com', '4_zr_97R5mw', 'Am erican+Dream', 'MKTO'));
    assert.equal(u.origin, 'https://relay.trycloudflare.com', 'must use relay base, not 127.0.0.1');
    assert.equal(u.pathname, '/download');
    assert.equal(u.searchParams.get('videoId'), '4_zr_97R5mw');
    assert.equal(u.searchParams.get('title'), 'Am erican+Dream');
    assert.equal(u.searchParams.get('artist'), 'MKTO');
  });
});

describe('RF2 probeRelayManifest discovers a healthy relay', () => {
  test('returns { baseUrl } for a healthy /vibecheck entry', async () => {
    const mod = await esbuildLoad(localNodePath, 'localNode');
    assert.equal(typeof mod.probeRelayManifest, 'function', 'missing export probeRelayManifest');
    const { fetcher, probeHits } = fakeRelayServer();
    const relay = await mod.probeRelayManifest({
      manifestUrl: 'https://app.example/workers.json',
      fetchImpl: fetcher,
    });
    assert.equal(probeHits.length, 1, 'must probe the relay vibecheck exactly once');
    assert.ok(relay, 'expected a relay to be discovered');
    assert.equal(relay.baseUrl, 'https://relay.trycloudflare.com');
    assert.equal(relay.version, '9.9.9');
  });
});

describe('RF3 resolveViaRelay resolves against a relay base', () => {
  test('returns ResolvedAudio with baseUrl + source relay', async () => {
    const mod = await esbuildLoad(localNodePath, 'localNode');
    assert.equal(typeof mod.resolveViaRelay, 'function', 'missing export resolveViaRelay');
    const { fetcher } = fakeRelayServer();
    const r = await mod.resolveViaRelay('vid_2', 'https://relay.trycloudflare.com', { fetchImpl: fetcher });
    assert.ok(r, 'expected resolution');
    assert.equal(r.source, 'relay');
    assert.equal(r.baseUrl, 'https://relay.trycloudflare.com');
    assert.equal(r.title, 'Relay Song');
    assert.equal(r.audioUrl, 'https://googlevideo.example/audio.m4a');
  });
});

describe('RF4 extractor wires the relay fallback', () => {
  test('extractor.ts imports + uses relay probe/resolve and relay URL builders', () => {
    const src = fs.readFileSync(extractorPath, 'utf8');
    assert.match(src, /probeRelayManifest\s*\(/, 'must probe the relay manifest when no local node');
    assert.match(src, /resolveViaRelay\s*\(/, 'must resolve via the relay when no local node');
    assert.match(src, /buildRelayDownloadUrl\s*\(/, 'must build relay download URLs');
  });
});