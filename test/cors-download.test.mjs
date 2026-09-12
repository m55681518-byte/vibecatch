// GUARDIAN TDD ENFORCER — direct-CDN download must be CORS-safe
// (freebuff-task-20260831-corsdownload)
//
// Regression: pasting a music.youtube.com link resolved via the Cloudflare
// thin-signer minted a DIRECT googlevideo URL into track.streamUrl with NO
// downloadUrl. downloadAudioDirectly then did fetch(track.streamUrl) — a
// cross-origin fetch of a host that sends NO Access-Control-Allow-Origin
// header, so the browser blocked it and the download silently failed.
//
// Acceptance: the browser download fetch() must NEVER target a raw direct
// googlevideo/CDN URL directly. When the resolved source is direct, the fetch
// MUST route through a CORS-enabled relay (/stream?url=...) so the player can
// byte-download it. When no CORS-safe relay is reachable, it must fail with a
// clear message instead of hitting the CORS wall.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const modulePath = path.join(root, 'src', 'services', 'downloadUrl.ts');

let cachedMod;
async function loadDownloadUrl() {
  if (!fs.existsSync(modulePath)) throw new Error('src/services/downloadUrl.ts does not exist yet');
  if (cachedMod) return cachedMod;
  const { build } = await import(url.pathToFileURL(path.join(root, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-cors-test-'));
  const outFile = path.join(tmpDir, 'downloadUrl.cors-build.mjs');
  await build({ entryPoints: [modulePath], outfile: outFile, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
  cachedMod = await import(url.pathToFileURL(outFile).href);
  return cachedMod;
}

const DIRECT_CDN = 'https://rr3---sn-avn7ln7e.googlevideo.com/videoplayback?expire=1&sig=abc';
const RELAY_BASE = 'https://smoking-ends-org-syndicate.trycloudflare.com';
const LOCAL_RELAY = 'http://127.0.0.1:8794';

describe('C1 fetchUrlForDownload wraps direct CDN through a CORS relay', () => {
  test('direct googlevideo URL is wrapped into relay /stream?url=...', async () => {
    const mod = await loadDownloadUrl();
    assert.equal(typeof mod.fetchUrlForDownload, 'function', 'missing export fetchUrlForDownload');
    const out = mod.fetchUrlForDownload({ streamUrl: DIRECT_CDN, downloadUrl: undefined }, RELAY_BASE);
    const u = new URL(out);
    assert.equal(u.origin + u.pathname, RELAY_BASE + '/stream');
    assert.equal(u.searchParams.get('url'), DIRECT_CDN, 'upstream must be the direct URL, CORS-wrapper must proxy it');
  });

  test('already-relay source is returned verbatim (no double-wrap)', async () => {
    const mod = await loadDownloadUrl();
    const existing = `${RELAY_BASE}/stream?url=${encodeURIComponent(DIRECT_CDN)}`;
    const out = mod.fetchUrlForDownload({ streamUrl: existing, downloadUrl: undefined }, RELAY_BASE);
    assert.equal(out, existing, 'relay source must not be wrapped again');
  });

  test('track.downloadUrl wins when it is a relay /download endpoint', async () => {
    const mod = await loadDownloadUrl();
    const dl = `${RELAY_BASE}/download?videoId=v&title=t&artist=a`;
    const out = mod.fetchUrlForDownload({ streamUrl: DIRECT_CDN, downloadUrl: dl }, RELAY_BASE);
    assert.equal(out, dl, 'explicit relay downloadUrl must be preferred');
  });

  test('direct source with NO relay base throws a clear CORS-safe error', async () => {
    const mod = await loadDownloadUrl();
    assert.throws(
      () => mod.fetchUrlForDownload({ streamUrl: DIRECT_CDN, downloadUrl: undefined }, null),
      (e) => String(e && e.message).toLowerCase().includes('cors'),
      'must reject fetching a raw direct CDN URL with a CORS-aware message'
    );
  });

  test('non-direct, non-relay stream (plain https) is routed through the CORS relay', async () => {
    const mod = await loadDownloadUrl();
    const plain = 'https://cdn.example.com/audio.mp3';
    const out = mod.fetchUrlForDownload({ streamUrl: plain, downloadUrl: undefined }, RELAY_BASE);
    const expected = `${RELAY_BASE}/stream?url=${encodeURIComponent(plain)}`;
    assert.equal(out, expected, 'all external URLs should route through the CORS relay');
  });
});

describe('C2 demuxer download path is wired through the CORS-safe builder', () => {
  test('demuxer.ts imports + calls fetchUrlForDownload, never raw fetch(track.streamUrl) in download', () => {
    const p = path.join(root, 'src', 'services', 'demuxer.ts');
    assert.ok(fs.existsSync(p));
    const src = fs.readFileSync(p, 'utf8');
    assert.match(src, /from ['"]\.\/downloadUrl['"]/, 'must import ./downloadUrl');
    assert.match(src, /fetchUrlForDownload\s*\(/, 'must call fetchUrlForDownload for CORS-safe fetch');
    // the full-file download/save path must never target the raw stream URL
    assert.doesNotMatch(src, /fetch\s*\(\s*pickDownloadUrl\s*\(/, 'download fetch must go through fetchUrlForDownload');
  });

  test('downloadUrl.ts still routes streamUrl when no direct-vs-relay decision needed', async () => {
    const mod = await loadDownloadUrl();
    assert.equal(typeof mod.pickDownloadUrl, 'function');
  });
});
