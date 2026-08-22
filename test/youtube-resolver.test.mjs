// GUARDIAN TDD ENFORCER — YouTube resolver repair (freebuff-task-20260823-ytresolver)
// Acceptance definition. MUST FAIL before Freebuff's turn (features absent), ALL PASS after.
// Pure logic only — fetch stubbed, zero network. resolvers.ts is loaded via the project's
// own esbuild (vite dep) so real TypeScript is exercised end-to-end.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const resolversPath = path.join(root, 'src', 'services', 'resolvers.ts');

let cachedMod;
async function loadResolvers() {
  if (!fs.existsSync(resolversPath)) throw new Error('src/services/resolvers.ts does not exist yet');
  if (cachedMod) return cachedMod;
  const { build } = await import(url.pathToFileURL(path.join(root, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-resolver-test-'));
  const outFile = path.join(tmpDir, 'resolvers.test-build.mjs');
  await build({
    entryPoints: [resolversPath],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    logLevel: 'silent',
  });
  cachedMod = await import(url.pathToFileURL(outFile).href);
  return cachedMod;
}

describe('A1 resolvers module exists with required exports', () => {
  test('src/services/resolvers.ts exports the contract', async () => {
    const mod = await loadResolvers();
    for (const symbol of [
      'PROVIDERS_YT',
      'raceYouTubeResolvers',
      'normalizeCobaltAudio',
      'normalizePipedStreams',
      'normalizeInvidiousAdaptive',
      'ResolutionCache',
    ]) {
      assert.notEqual(mod[symbol], undefined, `missing export: ${symbol}`);
    }
    assert.ok(Array.isArray(mod.PROVIDERS_YT) && mod.PROVIDERS_YT.length >= 4,
      'PROVIDERS_YT must contain at least 4 provider entries across kinds');
  });
});

describe('A2 provider race semantics', () => {
  const providersFor = (mod) =>
    mod.PROVIDERS_YT.map((p) => ({
      ...p,
      endpoint: p.endpoint.includes('{id}') ? p.endpoint.replace('{id}', '0GhacoePr0U') : p.endpoint,
    }));

  test('returns first successful provider result', async () => {
    const mod = await loadResolvers();
    const fakeFetch = async (u) => {
      if (String(u).includes('piped')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            title: 'Real Song', uploader: 'Real Artist', duration: 212,
            audioStreams: [{ url: 'https://gv.example/videoplayback?piped=1', bitrate: 129000, mimeType: 'audio/mp4' }],
          }),
        };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    };
    const out = await mod.raceYouTubeResolvers('0GhacoePr0U', { providers: providersFor(mod), timeoutMs: 800, fetchImpl: fakeFetch });
    assert.ok(out && out.audioUrl, 'expected a resolved audioUrl');
    assert.match(out.audioUrl, /videoplayback/);
    assert.equal(out.title, 'Real Song');
    assert.ok(out.source, 'result must carry its provider source label');
  });

  test('all providers failing yields explicit failure (never a fabricated track)', async () => {
    const mod = await loadResolvers();
    const fakeFetch = async () => { throw new TypeError('network dead'); };
    const out = await mod.raceYouTubeResolvers('deadID12345', { providers: providersFor(mod), timeoutMs: 300, fetchImpl: fakeFetch });
    assert.ok(out === null || out === undefined || out.audioUrl === undefined || out.audioUrl === null,
      'must not fabricate an audioUrl when every provider failed');
  });

  test('slow provider skipped via per-provider timeout bound', async () => {
    const mod = await loadResolvers();
    const slow = () => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000));
    const fast = async () => ({ ok: true, status: 200, json: async () => ({ status: 'tunnel', url: 'https://tunnel.example/audio' }) });
    const providers = [
      { name: 'slow-cobalt', kind: 'cobalt', method: 'POST', endpoint: 'https://slow.example/' },
      { name: 'fast-piped', kind: 'piped', method: 'GET', endpoint: 'https://fast.example/{id}' },
    ];
    const fakeFetch = (u) => (String(u).includes('slow') ? slow() : fast());
    const t0 = Date.now();
    const out = await mod.raceYouTubeResolvers('abc12345678', { providers, timeoutMs: 700, fetchImpl: fakeFetch });
    assert.ok(Date.now() - t0 < 4000, 'per-provider timeout must actually bound the wait');
    assert.ok(out && /tunnel\.example/.test(out.audioUrl));
  });
});

describe('A3 normalizers', () => {
  test('cobalt tunnel response normalized', async () => {
    const mod = await loadResolvers();
    const out = mod.normalizeCobaltAudio({ status: 'tunnel', url: 'https://tunnel/x.mp3' });
    assert.equal(out.audioUrl, 'https://tunnel/x.mp3');
    assert.equal(mod.normalizeCobaltAudio({ status: 'error', error: 'nope' }), null, 'error response -> null');
  });

  test('piped audioStreams picks highest-bitrate AUDIO only', async () => {
    const mod = await loadResolvers();
    const out = mod.normalizePipedStreams({
      title: 'T', uploader: 'U', duration: 199,
      audioStreams: [
        { url: 'https://a', bitrate: 48000, mimeType: 'audio/mp4' },
        { url: 'https://b', bitrate: 160000, mimeType: 'audio/mp4; codecs="mp4a.40.2"' },
        { url: 'https://video', bitrate: 900000, mimeType: 'video/mp4' },
      ],
    });
    assert.equal(out.audioUrl, 'https://b', 'must pick highest AUDIO bitrate and ignore video streams');
    assert.equal(out.title, 'T');
  });

  test('invidious adaptiveFormats picks best audio', async () => {
    const mod = await loadResolvers();
    const out = mod.normalizeInvidiousAdaptive({
      title: 'IT', author: 'IA', lengthSeconds: 180,
      adaptiveFormats: [
        { url: 'https://lo', bitrate: 60000, type: 'audio/mp4' },
        { url: 'https://hi', bitrate: 130000, type: 'audio/mp4; codecs="mp4a"' },
      ],
    });
    assert.equal(out.audioUrl, 'https://hi');
    assert.equal(out.title, 'IT');
    assert.equal(out.artist, 'IA');
  });
});

describe('A4 resolution cache (pure core, injectable KV, TTL, never throws)', () => {
  test('roundtrip + expiry + hostile KV swallowed', async () => {
    const mod = await loadResolvers();
    const store = new Map();
    const kv = { get: (k) => store.get(k), set: (k, v) => store.set(k, v) };
    const cache = new mod.ResolutionCache(kv, { ttlMs: 1000, now: () => 1000 });
    cache.put('yt_x', { audioUrl: 'https://ok' });
    assert.equal(cache.get('yt_x').audioUrl, 'https://ok');
    const later = new mod.ResolutionCache(kv, { ttlMs: 1000, now: () => 5000 });
    assert.equal(later.get('yt_x'), null, 'expired entry dropped');
    const broken = new mod.ResolutionCache(
      { get: () => { throw new Error('boom'); }, set: () => { throw new Error('boom'); } }, {}
    );
    assert.equal(broken.get('anything'), null, 'get errors swallowed');
    assert.doesNotThrow(() => broken.put('k', { a: 1 }), 'put never throws');
  });
});

describe('A5 extractor integration — honest behavior replaces pixabay masquerade', () => {
  test('extractor.ts wires raceYouTubeResolvers and drops the fake fallback', () => {
    const srcPath = path.join(root, 'src', 'services', 'extractor.ts');
    assert.ok(fs.existsSync(srcPath));
    const src = fs.readFileSync(srcPath, 'utf8');
    assert.match(src, /from ['"]\.\/resolvers['"]/, 'extractor must import ./resolvers');
    assert.ok(src.includes('raceYouTubeResolvers'), 'YT extraction must go through the provider race');
    assert.ok(!/Guaranteed fallback/i.test(src), '"Guaranteed fallback" pixabay block must be removed');
    assert.ok(!/CURATED_TRACKS\[1\]\.streamUrl/.test(src.replace(/CURATED_TRACKS\[1\]\.streamUrl/g, (m, off) =>
      src.indexOf('extractYouTube3Tier') > -1 && off > src.indexOf('function extractYouTube3Tier') ? m : '\u0000')), '');
    // precise check: no assignment of CURATED_TRACKS[1].streamUrl inside the YT extractor
    const ytStart = src.indexOf('async function extractYouTube3Tier');
    const ytBody = ytStart >= 0 ? src.slice(ytStart, src.indexOf('\n}', ytStart) + 2) : '';
    assert.ok(ytBody.length > 100, 'extractYouTube3Tier body found');
    assert.ok(!ytBody.includes('CURATED_TRACKS[1].streamUrl'), 'fake stream assignment gone from YT path');
    assert.ok(/success:\s*false/.test(ytBody), 'total resolver failure must surface as success:false (honest)');
  });
});
