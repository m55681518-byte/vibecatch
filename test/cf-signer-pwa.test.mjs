// GUARDIAN TDD ENFORCER — CF signer wired into the PWA resolver
// (freebuff-task-20260827-cfsignerpwa)
//
// Direction: the Cloudflare thin signer (https://vibecatch-signer.pages.dev,
// Turn B) mints raw signed googlevideo URLs as tiny JSON. This gate makes it a
// first-class provider in the PWA's resolver race (kind 'signer') so playback
// uses direct-to-device CDN streams (Turn A) instead of a relay bottleneck.
//
// C1: resolvers exports normalizeSignerResponse + registers a 'signer' provider
//     pointing at the live Pages endpoint.
// C2: normalizeSignerResponse parses the worker /resolve contract, errors -> null.
// C3: the race treats the signer like any provider (wins when healthy, loses
//     when dead, never special-cased).
// C4: extractor maps a 'signer' source to direct-to-device tier metadata and
//     sets streamUrl to the raw minted audioUrl (no /stream relay wrap).
// C5: contract parity — the resolver normalizer parses the exact shape the
//     worker core's normalizeClientResponse produces.
//
// Pure logic + source checks only — fetch stubbed, zero network.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');

let cachedMod;
async function loadResolvers() {
  const resolversPath = path.join(root, 'src', 'services', 'resolvers.ts');
  assert.ok(fs.existsSync(resolversPath), 'src/services/resolvers.ts must exist');
  if (cachedMod) return cachedMod;
  const { build } = await import(url.pathToFileURL(path.join(root, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-cfspwa-'));
  const outFile = path.join(tmpDir, 'resolvers.test-build.mjs');
  await build({
    entryPoints: [resolversPath],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    logLevel: 'silent',
    external: [],
  });
  cachedMod = await import(url.pathToFileURL(outFile).href);
  return cachedMod;
}

async function loadWorkerCore() {
  const corePath = path.join(root, 'worker', 'cf-signer-core.mjs');
  assert.ok(fs.existsSync(corePath), 'worker/cf-signer-core.mjs must exist');
  return import(url.pathToFileURL(corePath).href);
}

const SIGNER_OK = {
  ok: true,
  videoId: 'dQw4w9WgXcQ',
  audioUrl: 'https://rr2---sn-abc.googlevideo.com/videoplayback?expire=1787870612&itag=251&igdv=1',
  title: 'Never Gonna Give You Up',
  artist: 'Rick Astley',
  duration: 213.061,
};

describe('C1 signer provider registered', () => {
  test('normalizeSignerResponse is exported', async () => {
    const mod = await loadResolvers();
    assert.equal(typeof mod.normalizeSignerResponse, 'function', 'export normalizeSignerResponse');
  });

  test('PROVIDERS_YT contains a signer-kind entry on the live Pages endpoint', async () => {
    const mod = await loadResolvers();
    const signers = mod.PROVIDERS_YT.filter((p) => p.kind === 'signer');
    assert.ok(signers.length >= 1, 'expected at least one kind:signer provider');
    const s = signers[0];
    assert.equal(s.method, 'GET', 'signer provider uses GET');
    assert.ok(s.endpoint.includes('vibecatch-signer.pages.dev'), 'endpoint must point at the live signer');
    assert.ok(s.endpoint.includes('{id}'), 'endpoint must carry the {id} placeholder');
  });
});

describe('C2 signer normalizer', () => {
  test('parses the worker /resolve contract keys', async () => {
    const mod = await loadResolvers();
    const out = mod.normalizeSignerResponse(SIGNER_OK);
    assert.equal(out.audioUrl, SIGNER_OK.audioUrl);
    assert.equal(out.title, SIGNER_OK.title);
    assert.equal(out.artist, SIGNER_OK.artist);
    assert.equal(out.duration, SIGNER_OK.duration);
    assert.equal(out.source, 'signer');
  });

  test('error payloads and missing audioUrl normalize to null', async () => {
    const mod = await loadResolvers();
    assert.equal(mod.normalizeSignerResponse({ ok: false, error: 'all youtube clients failed' }), null, 'ok:false -> null');
    assert.equal(mod.normalizeSignerResponse({ ok: true, videoId: 'x' }), null, 'no audioUrl -> null');
    assert.equal(mod.normalizeSignerResponse(null), null, 'null body -> null');
    assert.equal(mod.normalizeSignerResponse({}), null, 'empty body -> null');
  });
});

describe('C3 signer races like any provider', () => {
  test('signer wins when healthy', async () => {
    const mod = await loadResolvers();
    const fetcher = async (u) => {
      if (String(u).includes('vibecatch-signer.pages.dev')) {
        return { ok: true, status: 200, json: async () => SIGNER_OK };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    };
    const providers = [
      mod.PROVIDERS_YT.find((p) => p.kind === 'signer'),
      { name: 'piped-stub', kind: 'piped', method: 'GET', endpoint: 'https://piped.example/{id}' },
    ];
    const out = await mod.raceYouTubeResolvers('dQw4w9WgXcQ', { providers, timeoutMs: 800, fetchImpl: fetcher });
    assert.ok(out && /googlevideo\.com/.test(out.audioUrl), 'signed URL must win the race');
    assert.ok(out.source.startsWith('signer'), 'source must be the signer provider');
    assert.equal(out.title, SIGNER_OK.title);
  });

  test('signer down falls through to the next provider (no special-casing)', async () => {
    const mod = await loadResolvers();
    const fetcher = async (u) => {
      if (String(u).includes('vibecatch-signer.pages.dev')) throw new TypeError('signer network dead');
      return {
        ok: true, status: 200,
        json: async () => ({ title: 'Piped Song', uploader: 'Piped Artist', duration: 55, audioStreams: [{ url: 'https://gv.example/videoplayback?piped=1', bitrate: 129000, mimeType: 'audio/mp4' }] }),
      };
    };
    const providers = [
      mod.PROVIDERS_YT.find((p) => p.kind === 'signer'),
      { name: 'piped-stub', kind: 'piped', method: 'GET', endpoint: 'https://piped.example/{id}' },
    ];
    const out = await mod.raceYouTubeResolvers('deadSignerID', { providers, timeoutMs: 500, fetchImpl: fetcher });
    assert.ok(out && /piped=1/.test(out.audioUrl), 'other provider result must win');
  });

  test('all providers failing (signer included) yields null', async () => {
    const mod = await loadResolvers();
    const fetcher = async () => { throw new TypeError('network dead'); };
    const out = await mod.raceYouTubeResolvers('deadSignerID', { providers: [mod.PROVIDERS_YT.find((p) => p.kind === 'signer')], timeoutMs: 200, fetchImpl: fetcher });
    assert.equal(out, null, 'must not fabricate on total failure');
  });
});

describe('C4 extractor direct-to-device wiring', () => {
  test('signer source maps to cloudflare signer tier metadata + raw streamUrl', () => {
    const srcPath = path.join(root, 'src', 'services', 'extractor.ts');
    assert.ok(fs.existsSync(srcPath));
    const src = fs.readFileSync(srcPath, 'utf8');
    const ytStart = src.indexOf('async function extractYouTube3Tier');
    assert.ok(ytStart > -1, 'extractYouTube3Tier body found');
    const ytBody = src.slice(ytStart);
    assert.match(ytBody, /startsWith\('signer'\)|startsWith\("signer"\)/, 'extractor must classify a signer source');
    assert.match(ytBody, /Cloudflare|Signer/i, 'signer tier must carry a Cloudflare/Signer label');
    assert.match(ytBody, /streamUrl:\s*resolved\.audioUrl/, 'signer result must set streamUrl to the raw minted URL');
    assert.ok(!/\/stream\?url=/.test(ytBody.split('streamUrl: resolved.audioUrl')[0].slice(-2000)), 'signer path must NOT wrap the URL in the relay /stream proxy');
  });
});

describe('C5 contract parity — resolver normalizer reads worker output shape', () => {
  test('normalizeSignerResponse parses exactly what worker core normalizeClientResponse emits', async () => {
    const core = await loadWorkerCore();
    const mod = await loadResolvers();
    assert.equal(typeof core.normalizeClientResponse, 'function', 'worker core must export normalizeClientResponse');
    const innerTube = core.normalizeClientResponse({
      playabilityStatus: { status: 'OK', reason: null },
      videoDetails: { title: 'Never Gonna Give You Up', author: 'Rick Astley', lengthSeconds: '213' },
      streamingData: {
        adaptiveFormats: [
          { itag: 251, bitrate: 131072, mimeType: 'audio/webm; codecs="opus"', url: 'https://gv.example/videoplayback?itag=251' },
          { itag: 140, bitrate: 128000, mimeType: 'audio/mp4; codecs="mp4a.40.2"', url: 'https://gv.example/videoplayback?itag=140' },
        ],
      },
    });
    assert.ok(core.normalizeClientResponse, 'sanity: core exported');
    // worker response shape: { videoId, ...result } where result = core payload
    const workerResponse = { ok: true, videoId: 'dQw4w9WgXcQ', ...innerTube };
    const out = mod.normalizeSignerResponse(workerResponse);
    assert.equal(out.audioUrl, 'https://gv.example/videoplayback?itag=251', 'audioUrl key must align (itag=251 picked by core)');
    assert.equal(out.title, 'Never Gonna Give You Up');
    assert.equal(out.artist, 'Rick Astley');
    assert.equal(out.duration, 213);
  });
});