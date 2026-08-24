// GUARDIAN TDD ENFORCER — UI download wiring to node /download (freebuff-task-20260824-uiwire)
// The PWA Save-MP3 path fetched track.streamUrl (the /stream relay), which is
// window-capped at ~1MiB — truncated files for any real song. Downloads must go
// through the local node's yt-dlp /download endpoint (full file, cookies bypass).
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-uiwire-test-'));
  const outFile = path.join(tmpDir, 'downloadUrl.test-build.mjs');
  await build({ entryPoints: [modulePath], outfile: outFile, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
  cachedMod = await import(url.pathToFileURL(outFile).href);
  return cachedMod;
}

describe('W1 downloadUrl pure helpers', () => {
  test('buildLocalDownloadUrl targets node /download with encoded params', async () => {
    const mod = await loadDownloadUrl();
    assert.equal(typeof mod.buildLocalDownloadUrl, 'function', 'missing export buildLocalDownloadUrl');
    const u = new URL(mod.buildLocalDownloadUrl(8794, '4_zr_97R5mw', 'American Dream', 'MKTO'));
    assert.equal(u.protocol + '//' + u.host, 'http://127.0.0.1:8794');
    assert.equal(u.pathname, '/download');
    assert.equal(u.searchParams.get('videoId'), '4_zr_97R5mw');
    assert.equal(u.searchParams.get('title'), 'American Dream');
    assert.equal(u.searchParams.get('artist'), 'MKTO');
  });

  test('pickDownloadUrl prefers downloadUrl over streamUrl', async () => {
    const mod = await loadDownloadUrl();
    assert.equal(typeof mod.pickDownloadUrl, 'function', 'missing export pickDownloadUrl');
    const withDl = { streamUrl: 'http://127.0.0.1:1/stream?url=x', downloadUrl: 'http://127.0.0.1:1/download?videoId=v' };
    assert.equal(mod.pickDownloadUrl(withDl), withDl.downloadUrl);
    const noDl = { streamUrl: 'https://cdn/audio.m4a' };
    assert.equal(mod.pickDownloadUrl(noDl), noDl.streamUrl);
  });
});

describe('W2 extractor sets downloadUrl on local-node tracks', () => {
  test('extractor.ts imports builder and assigns downloadUrl in local-node branch', () => {
    const p = path.join(root, 'src', 'services', 'extractor.ts');
    assert.ok(fs.existsSync(p));
    const src = fs.readFileSync(p, 'utf8');
    assert.match(src, /from ['"]\.\/downloadUrl['"]/, 'must import ./downloadUrl');
    assert.match(src, /buildLocalDownloadUrl\s*\(/, 'must call buildLocalDownloadUrl');
    const branchStart = src.indexOf('if (localHit && localHit.audioUrl)');
    const branchEnd = src.indexOf('return { success: true, track }', branchStart);
    const lit = src.slice(branchStart, branchEnd);
    assert.ok(lit.length > 50, 'local-node branch found');
    assert.match(lit, /buildLocalDownloadUrl\s*\(/, 'must call buildLocalDownloadUrl');
    assert.match(lit, /downloadUrl\s*:/, 'local-node track must carry downloadUrl');
  });
});

describe('W3 demuxer fetches pickDownloadUrl for save + offline cache', () => {
  test('demuxer.ts uses pickDownloadUrl in downloadAudioDirectly AND cacheTrackOffline', () => {
    const p = path.join(root, 'src', 'services', 'demuxer.ts');
    assert.ok(fs.existsSync(p));
    const src = fs.readFileSync(p, 'utf8');
    assert.match(src, /from ['"]\.\/downloadUrl['"]/, 'must import ./downloadUrl');
    const uses = src.match(/pickDownloadUrl\s*\(/g) || [];
    assert.ok(uses.length >= 2, `expected >=2 pickDownloadUrl call sites, got ${uses.length}`);
    assert.doesNotMatch(src, /fetch\(track\.streamUrl/, 'raw streamUrl fetches are forbidden (1MiB cap)');
  });

  test('saved file extension + blob mime derive from track.audioFormat', () => {
    const src = fs.readFileSync(path.join(root, 'src', 'services', 'demuxer.ts'), 'utf8');
    assert.match(src, /audioFormat/, 'audioFormat must drive mime/ext');
    assert.doesNotMatch(src, /\.mp3`/, 'hardcoded .mp3 filename forbidden');
  });
});

describe('W4 Track type carries optional downloadUrl', () => {
  test('types/index.ts declares downloadUrl?: string', () => {
    const src = fs.readFileSync(path.join(root, 'src', 'types', 'index.ts'), 'utf8');
    assert.match(src, /downloadUrl\?\s*:\s*string/, 'Track.downloadUrl missing');
  });
});
