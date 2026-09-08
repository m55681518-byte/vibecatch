// GUARDIAN TDD ENFORCER — relay pool failover (feat/relay-pool-task)
// Root cause observed in production: the strict track D9_ECmovL0g resolves via a
// residential trycloudflare tunnel (works), but the app picked a CF worker relay
// from the pool whose /vibecheck is healthy yet whose /resolve always 502s, and
// each relay attempt has a tight 1200ms timeout. Result: APK card.
// RG1: pool fails over from a vibe-healthy-but-resolve-dead relay to the next
//      healthy relay (instead of returning null).
// RG2: pool tolerates a relay whose /resolve takes longer than 1200ms (the old
//      per-attempt timeout aborted slow residential tunnels).
// RG3: pool uses the FIRST healthy relay that actually resolves (ordering kept).
// RG4: extractor.ts wires the pool and builds BOTH streamUrl and downloadUrl via
//      buildRelayStreamUrl for relay-minted tracks (never raw googlevideo, never
//      the /download endpoint that 502s on the local node).
// RG5: downloadUrl.ts fetchUrlForDownload passes a trycloudflare relay /stream
//      URL through unchanged (browser downloads straight from the relay).
// RG6: pool returns null (never throws) when every relay resolve fails.
// RG7: pool still discovers a relay whose /vibecheck itself is slow (>1200ms).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');

async function esbuildLoad(entry, name) {
  const { build } = await import(url.pathToFileURL(path.join(root, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-pool-test-'));
  const outFile = path.join(tmpDir, name + '.test-build.mjs');
  await build({ entryPoints: [entry], outfile: outFile, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
  return import(url.pathToFileURL(outFile).href);
}

const localNodePath = path.join(root, 'src', 'services', 'localNode.ts');
const extractorPath = path.join(root, 'src', 'services', 'extractor.ts');
const downloadUrlPath = path.join(root, 'src', 'services', 'downloadUrl.ts');

const MANIFEST = 'https://app.example/workers.json';
const RELAY_A = 'https://relay-a.trycloudflare.com';
const RELAY_B = 'https://relay-b.trycloudflare.com';

function ok(body) {
  return { ok: true, json: async () => body };
}
function dead() {
  return { ok: false, status: 502 };
}
function vibe(name = 'vibecatch-local-node', version = '1.0.0') {
  return ok({ ok: true, name, version });
}
function audio(audioUrl) {
  return ok({ audioUrl, title: 'Song', artist: 'Artist', duration: 200 });
}

// Slow relay: /vibecheck or /resolve takes `delayMs` before answering. Ignores
// AbortSignal on purpose so a tight timeout manifests as an abort (null) rather
// than an implicit pass.
function slowFetcher({ vibeDelayMs = 0, resolveDelayMs = 0 } = {}) {
  const seen = [];
  const fetcher = async (input) => {
    const u = String(input);
    if (u === MANIFEST) return ok(['https://relay-a.trycloudflare.com/vibecheck']);
    if (u.endsWith('/vibecheck')) {
      seen.push(u);
      if (vibeDelayMs > 0) await new Promise((r) => setTimeout(r, vibeDelayMs));
      return vibe();
    }
    if (u.includes('/resolve?videoId=')) {
      seen.push(u);
      if (resolveDelayMs > 0) await new Promise((r) => setTimeout(r, resolveDelayMs));
      return audio('https://googlevideo.example/slow.m4a');
    }
    throw new Error('unexpected fetch: ' + u);
  };
  return { fetcher, seen };
}

describe('RG1 pool fails over from a resolve-dead relay to the next healthy one', () => {
  test('first vibe-healthy relay 502s on /resolve; pool resolves via the second', async () => {
    const mod = await esbuildLoad(localNodePath, 'localNode');
    assert.equal(typeof mod.resolveViaRelayPool, 'function', 'missing export resolveViaRelayPool');
    const fetcher = async (input) => {
      const u = String(input);
      if (u === MANIFEST) {
        return ok(['https://relay-a.trycloudflare.com/vibecheck', 'https://relay-b.trycloudflare.com/vibecheck']);
      }
      if (u === 'https://relay-a.trycloudflare.com/vibecheck') return vibe();
      if (u === 'https://relay-b.trycloudflare.com/vibecheck') return vibe();
      if (u === 'https://relay-a.trycloudflare.com/resolve?videoId=vid_1') return dead();
      if (u === 'https://relay-b.trycloudflare.com/resolve?videoId=vid_1') {
        return audio('https://googlevideo.example/b.m4a');
      }
      throw new Error('unexpected fetch: ' + u);
    };
    const r = await mod.resolveViaRelayPool('vid_1', { manifestUrl: MANIFEST, fetchImpl: fetcher });
    assert.ok(r, 'pool must resolve despite the first relay 502ing');
    assert.equal(r.baseUrl, RELAY_B, 'must fail over to the relay that actually resolves');
    assert.equal(r.audioUrl, 'https://googlevideo.example/b.m4a');
    assert.equal(r.source, 'relay');
  });
});

describe('RG2 pool tolerates a slow relay resolve (>1200ms)', () => {
  test('relay whose /resolve answers in 1600ms still resolves (old timeout would abort)', async () => {
    const mod = await esbuildLoad(localNodePath, 'localNode');
    const { fetcher, seen } = slowFetcher({ resolveDelayMs: 1600 });
    const t0 = Date.now();
    const r = await mod.resolveViaRelayPool('vid_2', { manifestUrl: MANIFEST, fetchImpl: fetcher });
    const elapsed = Date.now() - t0;
    assert.ok(r, 'slow relay must still resolve');
    assert.ok(elapsed >= 1500, `pool bailed before the slow relay finished (${elapsed}ms)`);
    assert.ok(seen.some((u) => u.includes('/resolve?videoId=')), 'resolve endpoint must be hit');
  });
});

describe('RG3 pool keeps manifest ordering: first healthy resolver wins', () => {
  test('when both relays resolve, the first is used', async () => {
    const mod = await esbuildLoad(localNodePath, 'localNode');
    const fetcher = async (input) => {
      const u = String(input);
      if (u === MANIFEST) {
        return ok(['https://relay-a.trycloudflare.com/vibecheck', 'https://relay-b.trycloudflare.com/vibecheck']);
      }
      if (u === 'https://relay-a.trycloudflare.com/vibecheck') return vibe();
      if (u === 'https://relay-b.trycloudflare.com/vibecheck') return vibe();
      if (u === 'https://relay-a.trycloudflare.com/resolve?videoId=vid_3') return audio('https://googlevideo.example/a.m4a');
      if (u === 'https://relay-b.trycloudflare.com/resolve?videoId=vid_3') return audio('https://googlevideo.example/b.m4a');
      throw new Error('unexpected fetch: ' + u);
    };
    const r = await mod.resolveViaRelayPool('vid_3', { manifestUrl: MANIFEST, fetchImpl: fetcher });
    assert.ok(r);
    assert.equal(r.baseUrl, RELAY_A);
    assert.equal(r.audioUrl, 'https://googlevideo.example/a.m4a');
  });
});

describe('RG4 extractor wires the pool + buildRelayStreamUrl for relay tracks', () => {
  test('uses resolveViaRelayPool and sets streamUrl/downloadUrl to the relay /stream proxy', () => {
    const src = fs.readFileSync(extractorPath, 'utf8');
    assert.match(src, /resolveViaRelayPool\s*\(/, 'extractor must resolve via the relay POOL (failover), not a single relay');
    assert.match(src, /streamUrl:\s*buildRelayStreamUrl\s*\(/, 'relay track streamUrl must be the CORS-safe /stream proxy URL');
    assert.match(src, /downloadUrl:\s*buildRelayStreamUrl\s*\(/, 'relay track downloadUrl must be the /stream proxy URL, NOT /download (502)');
    assert.doesNotMatch(src, /streamUrl:\s*relayHit\.audioUrl/, 'must not hand the raw IP-locked googlevideo URL to the browser');
    assert.doesNotMatch(src, /buildRelayDownloadUrl\s*\(/, 'must not build /download relay URLs (endpoint 502s on the local node)');
  });
});

describe('RG5 downloadUrl passthrough for relay /stream URLs', () => {
  test('fetchUrlForDownload returns the trycloudflare /stream URL unchanged', async () => {
    const mod = await esbuildLoad(downloadUrlPath, 'downloadUrl');
    assert.equal(typeof mod.fetchUrlForDownload, 'function', 'missing export fetchUrlForDownload');
    const relayStream = `${RELAY_A}/stream?url=${encodeURIComponent('https://googlevideo.example/a.m4a')}`;
    const url = mod.fetchUrlForDownload({ streamUrl: relayStream, downloadUrl: relayStream }, '/relay-base-placeholder');
    assert.equal(url, relayStream, 'relay /stream URL must pass through (browser fetches the relay directly)');
  });
});

describe('RG6 pool returns null when every relay resolve fails (never throws)', () => {
  test('all vibe-healthy relays 502 -> null', async () => {
    const mod = await esbuildLoad(localNodePath, 'localNode');
    const fetcher = async (input) => {
      const u = String(input);
      if (u === MANIFEST) return ok(['https://relay-a.trycloudflare.com/vibecheck', 'https://relay-b.trycloudflare.com/vibecheck']);
      if (u.endsWith('/vibecheck')) return vibe();
      if (u.includes('/resolve?videoId=')) return dead();
      throw new Error('unexpected fetch: ' + u);
    };
    const r = await mod.resolveViaRelayPool('vid_4', { manifestUrl: MANIFEST, fetchImpl: fetcher });
    assert.equal(r, null, 'all-failed pool must resolve to null');
  });
});

describe('RG7 pool discovers a relay whose /vibecheck is slow (>1200ms)', () => {
  test('vibecheck answering in 1600ms is still treated as healthy', async () => {
    const mod = await esbuildLoad(localNodePath, 'localNode');
    const { fetcher } = slowFetcher({ vibeDelayMs: 1600 });
    const r = await mod.resolveViaRelayPool('vid_5', { manifestUrl: MANIFEST, fetchImpl: fetcher });
    assert.ok(r, 'slow-but-healthy relay must still be discovered');
    assert.equal(r.baseUrl, RELAY_A);
    assert.equal(r.audioUrl, 'https://googlevideo.example/slow.m4a');
  });
});