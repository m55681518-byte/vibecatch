// GUARDIAN TDD ENFORCER — thin signer + direct-to-device playback
// (freebuff-task-20260827-thinsigner)
//
// Direction (user-chosen): a "thin signer" relay only MINTS the signed
// googlevideo URL (tiny JSON, cacheable). The audio BYTES stream directly
// from googlevideo to the user's device via a plain <audio> element — no
// CORS needed for media playback — instead of being tunneled through the
// relay /stream (/download) like a residential single-relay bottleneck.
//
// TS1: isDirectStreamUrl classifies a URL as direct (googlevideo CDN) vs
//      relay-wrapped (localhost / trycloudflare tunnel).
// TS2: playbackSourceFor prefers a DIRECT streamUrl over relay downloadUrl
//      (while keeping the legacy relay-wrapped ordering download > stream).
// TS3: playbackChain yields the ordered, deduped fallback list for a track.
// TS4: extractor relay path sets streamUrl = RAW minted audioUrl (no /stream
//      wrap); downloadUrl remains the relay fallback.
// TS5: audioEngine does not force crossOrigin on direct URLs (googlevideo
//      sends no ACAO headers) and owns a one-shot relay fallback on error.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');

async function esbuildLoad(entry, name) {
  const { build } = await import(url.pathToFileURL(path.join(root, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-thinsign-'));
  const outFile = path.join(tmpDir, name + '.test-build.mjs');
  await build({ entryPoints: [entry], outfile: outFile, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
  return import(url.pathToFileURL(outFile).href);
}

const downloadUrlPath = path.join(root, 'src', 'services', 'downloadUrl.ts');
const extractorPath = path.join(root, 'src', 'services', 'extractor.ts');
const audioEnginePath = path.join(root, 'src', 'services', 'audioEngine.ts');
const localNodePath = path.join(root, 'src', 'services', 'localNode.ts');

const DIRECT_URL = 'https://rr4---sn-5pguxa3x-ocvz.googlevideo.com/videoplayback?expire=1787870612&itag=251';
const RELAY_STREAM_URL = 'https://relay.trycloudflare.com/stream?url=' + encodeURIComponent(DIRECT_URL);
const LOCAL_STREAM_URL = 'http://127.0.0.1:8794/stream?url=' + encodeURIComponent(DIRECT_URL);
const RELAY_DOWNLOAD = 'https://relay.trycloudflare.com/download?videoId=dQw4w9WgXcQ';

describe('TS1 isDirectStreamUrl', () => {
  test('googlevideo.com host is DIRECT', async () => {
    const mod = await esbuildLoad(downloadUrlPath, 'downloadUrl');
    assert.equal(typeof mod.isDirectStreamUrl, 'function', 'missing export isDirectStreamUrl');
    assert.equal(mod.isDirectStreamUrl(DIRECT_URL), true);
  });

  test('relay tunnel host is NOT direct', async () => {
    const mod = await esbuildLoad(downloadUrlPath, 'downloadUrl');
    assert.equal(mod.isDirectStreamUrl(RELAY_STREAM_URL), false);
    assert.equal(mod.isDirectStreamUrl('https://toolbar-schemes-realized-brake.trycloudflare.com/vibecheck'), false);
  });

  test('localhost relay is NOT direct', async () => {
    const mod = await esbuildLoad(downloadUrlPath, 'downloadUrl');
    assert.equal(mod.isDirectStreamUrl(LOCAL_STREAM_URL), false);
    assert.equal(mod.isDirectStreamUrl('http://127.0.0.1:8794/download?videoId=x'), false);
  });
});

describe('TS2 playbackSourceFor prefers direct stream over relay download', () => {
  test('direct streamUrl beats relay downloadUrl (thin signer ordering)', async () => {
    const mod = await esbuildLoad(downloadUrlPath, 'downloadUrl');
    assert.equal(typeof mod.playbackSourceFor, 'function');
    const t = { streamUrl: DIRECT_URL, downloadUrl: RELAY_DOWNLOAD };
    assert.equal(mod.playbackSourceFor(t, null), DIRECT_URL, 'direct googlevideo must win over relay download');
  });

  test('relay-wrapped streamUrl keeps legacy download > stream ordering (PW1 compat)', async () => {
    const mod = await esbuildLoad(downloadUrlPath, 'downloadUrl');
    const t = { streamUrl: RELAY_STREAM_URL, downloadUrl: RELAY_DOWNLOAD };
    assert.equal(mod.playbackSourceFor(t, null), RELAY_DOWNLOAD, 'legacy relay ordering preserved');
  });

  test('blob still wins over everything', async () => {
    const mod = await esbuildLoad(downloadUrlPath, 'downloadUrl');
    const t = { streamUrl: DIRECT_URL, downloadUrl: RELAY_DOWNLOAD };
    assert.equal(mod.playbackSourceFor(t, 'blob:xyz'), 'blob:xyz');
  });

  test('no downloadUrl -> falls back to streamUrl', async () => {
    const mod = await esbuildLoad(downloadUrlPath, 'downloadUrl');
    assert.equal(mod.playbackSourceFor({ streamUrl: DIRECT_URL }, null), DIRECT_URL);
  });
});

describe('TS3 playbackChain ordered + deduped', () => {
  test('direct track chains blob > direct > relay download', async () => {
    const mod = await esbuildLoad(downloadUrlPath, 'downloadUrl');
    assert.equal(typeof mod.playbackChain, 'function', 'missing export playbackChain');
    const t = { streamUrl: DIRECT_URL, downloadUrl: RELAY_DOWNLOAD };
    assert.deepEqual(mod.playbackChain(t, 'blob:x'), ['blob:x', DIRECT_URL, RELAY_DOWNLOAD]);
    assert.deepEqual(mod.playbackChain(t, null), [DIRECT_URL, RELAY_DOWNLOAD]);
  });

  test('relay-wrapped chain orders download before stream', async () => {
    const mod = await esbuildLoad(downloadUrlPath, 'downloadUrl');
    const t = { streamUrl: RELAY_STREAM_URL, downloadUrl: RELAY_DOWNLOAD };
    assert.deepEqual(mod.playbackChain(t, null), [RELAY_DOWNLOAD, RELAY_STREAM_URL]);
  });

  test('dedupes identical URLs in the chain', async () => {
    const mod = await esbuildLoad(downloadUrlPath, 'downloadUrl');
    const t = { streamUrl: RELAY_STREAM_URL, downloadUrl: RELAY_STREAM_URL };
    assert.deepEqual(mod.playbackChain(t, null).length, 1);
  });
});

describe('TS4 extractor relay path emits raw minted audioUrl as streamUrl', () => {
  test('relay branch sets streamUrl = audioUrl raw (no /stream wrap), keeps relay downloadUrl', () => {
    const src = fs.readFileSync(extractorPath, 'utf8');
    const relayBranch = src.slice(src.indexOf('resolveViaRelay'), src.indexOf('// Fall back to public provider race'));
    assert.match(relayBranch, /streamUrl:\s*relayHit\.audioUrl\s*,/,
      'relay streamUrl must be the RAW minted googlevideo URL (direct-to-device)');
    assert.doesNotMatch(relayBranch, /buildRelayStreamUrl\s*\(\s*relay\.baseUrl\s*,\s*relayHit\.audioUrl\s*\)/,
      'must NOT wrap the minted URL through relay /stream');
  });

  test('downloadUrl stays a relay /download (fallback + full-file saves)', () => {
    const src = fs.readFileSync(extractorPath, 'utf8');
    const relayBranch = src.slice(src.indexOf('resolveViaRelay'), src.indexOf('// Fall back to public provider race'));
    assert.match(relayBranch, /downloadUrl:\s*buildRelayDownloadUrl\s*\(/,
      'relay downloadUrl fallback must remain');
  });
});

describe('TS5 audioEngine direct-playback hygiene', () => {
  test('does NOT hardcode crossOrigin anonymous on direct URLs (googlevideo has no ACAO)', () => {
    const src = fs.readFileSync(audioEnginePath, 'utf8');
    assert.match(src, /isDirectStreamUrl|isDirectMediaUrl|crossOrigin\s*=\s*(null|undefined)/,
      'audioEngine must clear crossOrigin for direct media playback');
  });

  test('owns a one-shot error fallback to the relay URL', () => {
    const src = fs.readFileSync(audioEnginePath, 'utf8');
    assert.match(src, /fallback|retry|nextSourceOnError|playbackChain|onFallback|advanceToFallback/,
      'audioEngine must implement a single retry to the next playback source on error');
  });
});

describe('TS6 resolveViaRelay keeps returning raw audioUrl (signer contract)', () => {
  test('localNode.ts resolveViaRelay returns the minted audioUrl untouched', async () => {
    const mod = await esbuildLoad(localNodePath, 'localNode');
    const fetcher = async () => ({
      ok: true,
      json: async () => ({ audioUrl: DIRECT_URL, title: 'Never Gonna Give You Up', artist: 'Rick Astley', duration: 213 }),
    });
    const r = await mod.resolveViaRelay('dQw4w9WgXcQ', 'https://relay.trycloudflare.com', { fetchImpl: fetcher, timeoutMs: 500 });
    assert.ok(r);
    assert.equal(r.audioUrl, DIRECT_URL, 'signer must hand back the raw signed URL');
    assert.equal(r.source, 'relay');
  });
});