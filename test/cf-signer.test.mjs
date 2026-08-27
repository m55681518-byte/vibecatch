// GUARDIAN TDD ENFORCER — Cloudflare Worker thin signer regression gate
// (freebuff-task-20260827-cfsigner, RESTORED in freebuff-task-20260827-cfsignerpwa:
//  journal 067 gate was lost — only worker files were committed in 4ba6d29.)
//
// CF1: modules exist with the documented exports.
// CF2: pickBestAudioFormat — audio-only + plain url, highest bitrate, null on none.
// CF3: normalizeClientResponse — OK payload mapped; non-OK / incomplete null (honest).
// CF4: Cloudflare-compatible source — no Node builtins / CJS artifacts in worker files.
// CF5: worker routing — OPTIONS/CORS, /vibecheck, /resolve validation + happy path
//      (global fetch stubbed — hermetic), 404/405.
// CF6: LIVE smoke — the deployed signer answers /vibecheck + /resolve + CORS.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');

const corePath = path.join(root, 'worker', 'cf-signer-core.mjs');
const workerPath = path.join(root, 'worker', 'cf-signer-worker.mjs');

const loadCore = () => import(url.pathToFileURL(corePath).href);
const loadWorker = () => import(url.pathToFileURL(workerPath).href);

const KEYLIST = [
  'PICK_CLIENTS',
  'pickBestAudioFormat',
  'normalizeClientResponse',
  'mintSignedUrl',
];

describe('CF1 module surface', () => {
  test('core exports the mint contract', async () => {
    const mod = await loadCore();
    for (const k of KEYLIST) assert.notEqual(mod[k], undefined, `missing core export: ${k}`);
    assert.ok(Array.isArray(mod.PICK_CLIENTS) && mod.PICK_CLIENTS.length >= 3, '>=3 client descriptors');
    for (const c of mod.PICK_CLIENTS) {
      assert.ok(c.name && c.key && c.endpoint && c.context && c.headers, 'client descriptor complete');
    }
  });

  test('worker exports the fetch contract + validVideoId', async () => {
    const mod = await loadWorker();
    assert.equal(typeof mod.validVideoId, 'function');
    assert.ok(mod.default && typeof mod.default.fetch === 'function', 'export default { fetch }');
  });
});

describe('CF2 pickBestAudioFormat', () => {
  test('picks highest-bitrate AUDIO stream that has a plain url', async () => {
    const mod = await loadCore();
    const out = mod.pickBestAudioFormat([
      { itag: 251, bitrate: 131072, mimeType: 'audio/webm; codecs="opus"', url: 'https://gv/x' },
      { itag: 140, bitrate: 128000, mimeType: 'audio/mp4', url: 'https://gv/y' },
      { itag: 137, bitrate: 3000000, mimeType: 'video/mp4', url: 'https://gv/z' },
    ]);
    assert.equal(out.itag, 251, 'audio-only + highest bitrate wins over video stream');
  });

  test('ignores url-less / signature-ciphered streams then null', async () => {
    const mod = await loadCore();
    const out = mod.pickBestAudioFormat([
      { itag: 140, bitrate: 128000, mimeType: 'audio/mp4', signatureCipher: 'sp=abc' },
      { itag: 139, bitrate: 48000, mimeType: 'audio/mp4' },
      { itag: 251, bitrate: 131072, mimeType: 'audio/webm', url: '' },
    ]);
    assert.equal(out, null, 'no stream with a real url -> null');
  });

  test('null on empty / non-array input', async () => {
    const mod = await loadCore();
    assert.equal(mod.pickBestAudioFormat([]), null);
    assert.equal(mod.pickBestAudioFormat(null), null);
    assert.equal(mod.pickBestAudioFormat(undefined), null);
    assert.equal(mod.pickBestAudioFormat({}), null);
  });
});

describe('CF3 normalizeClientResponse', () => {
  test('OK + details + stream parses into the signer payload', async () => {
    const mod = await loadCore();
    const out = mod.normalizeClientResponse({
      playabilityStatus: { status: 'OK' },
      videoDetails: { title: 'Never Gonna Give You Up', author: 'Rick Astley', lengthSeconds: '213' },
      streamingData: { adaptiveFormats: [{ itag: 251, bitrate: 131072, mimeType: 'audio/webm', url: 'https://gv/v' }] },
    });
    assert.deepEqual(out, {
      audioUrl: 'https://gv/v',
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      duration: 213,
    });
  });

  test('non-OK / LOGIN_REQUIRED / missing details -> null', async () => {
    const mod = await loadCore();
    assert.equal(mod.normalizeClientResponse({ playabilityStatus: { status: 'LOGIN_REQUIRED' }, videoDetails: {}, streamingData: {} }), null);
    assert.equal(mod.normalizeClientResponse({ playabilityStatus: { status: 'ERROR' } }), null);
    assert.equal(mod.normalizeClientResponse(null), null);
  });

  test('ciphered-only streams (no plain url) -> null, honest no-decrypt', async () => {
    const mod = await loadCore();
    const out = mod.normalizeClientResponse({
      playabilityStatus: { status: 'OK' },
      videoDetails: { title: 'T', author: 'A', lengthSeconds: '10' },
      streamingData: { adaptiveFormats: [{ itag: 140, mimeType: 'audio/mp4', signatureCipher: 'sp=aaa&sig=b' }] },
    });
    assert.equal(out, null, 'must not guess a url when only ciphers exist');
  });
});

describe('CF4 Cloudflare-compatible source (purity)', () => {
  test('worker files contain no Node builtin imports / CJS artifacts', async () => {
    for (const p of [corePath, workerPath]) {
      const src = fs.readFileSync(p, 'utf8');
      assert.doesNotMatch(src, /from\s+['"]node:/, `${path.basename(p)}: node: import`);
      assert.doesNotMatch(src, /\brequire\s*\(/, `${path.basename(p)}: CommonJS require call`);
      assert.doesNotMatch(src, /\bcreateRequire\b/, `${path.basename(p)}: createRequire`);
      assert.doesNotMatch(src, /\bprocess\s*\./, `${path.basename(p)}: process global`);
      assert.doesNotMatch(src, /\bchild_process\b/, `${path.basename(p)}: child process module`);
      assert.doesNotMatch(src, /\b__dirname\b|\bmodule\s*\.\s*exports\b/, `${path.basename(p)}: CJS globals`);
    }
  });

  test('both worker files import clean as WebStandards ESM (load aborts on any Node dep)', async () => {
    const core = await loadCore();
    const worker = await loadWorker();
    assert.equal(typeof core.mintSignedUrl, 'function');
    assert.equal(typeof worker.default.fetch, 'function');
  });

  test('mintSignedUrl races injected clients/fetch — first usable wins, all-fail null', async () => {
    const mod = await loadCore();
    const goodFetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ playabilityStatus: { status: 'OK' }, videoDetails: { title: 'T', author: 'A', lengthSeconds: '90' }, streamingData: { adaptiveFormats: [{ itag: 251, mimeType: 'audio/webm', url: 'https://gv/ok' }] } }),
    });
    const deadFetch = async () => { throw new TypeError('network dead'); };
    const clients = [{ name: 'SLOW', key: 'k', endpoint: 'https://y.example/player', context: {}, headers: {} }];
    const fast = { name: 'FAST', key: 'k', endpoint: 'https://y.example/player', context: {}, headers: {} };
    const out = await mod.mintSignedUrl('dQw4w9WgXcQ', { clients: [fast, clients[0]], timeoutMs: 3000, fetchImpl: goodFetch });
    assert.equal(out.audioUrl, 'https://gv/ok');
    assert.equal(out.duration, 90);
    const none = await mod.mintSignedUrl('x', { clients, timeoutMs: 300, fetchImpl: deadFetch });
    assert.equal(none, null, 'all clients failed -> null, not a throw');
  });
});

describe('CF5 worker routing', () => {
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': '*' };

  test('validVideoId accepts video ids, rejects junk', async () => {
    const mod = await loadWorker();
    assert.equal(mod.validVideoId('dQw4w9WgXcQ'), true);
    assert.equal(mod.validVideoId('jNQXAC9IVRw'), true);
    assert.equal(mod.validVideoId('AAAA'), false, 'all-caps is a list/like id, not a video');
    assert.equal(mod.validVideoId(''), false);
    assert.equal(mod.validVideoId(null), false);
    assert.equal(mod.validVideoId(123), false);
  });

  test('OPTIONS 204 + CORS, /vibecheck 200, bad method/path 405/404', async () => {
    const mod = await loadWorker();
    const wf = mod.default.fetch;
    const pre = await wf(new Request('https://v.example/resolve', { method: 'OPTIONS' }), {});
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('Access-Control-Allow-Origin'), '*');
    const vb = await wf(new Request('https://v.example/vibecheck'), {});
    assert.equal(vb.status, 200);
    assert.deepEqual(await vb.json(), { ok: true, name: 'vibecatch-cf-signer', version: '1.0.0' });
    const method = await wf(new Request('https://v.example/resolve', { method: 'POST' }), {});
    assert.equal(method.status, 405);
    const nope = await wf(new Request('https://v.example/nope'), {});
    assert.equal(nope.status, 404);
    assert.ok(pre.headers.get('Access-Control-Allow-Origin'), 'CORS on all responses');
  });

  test('/resolve validation + happy path (global fetch stubbed)', async () => {
    const mod = await loadWorker();
    const realFetch = globalThis.fetch;
    const innerTubeOk = {
      playabilityStatus: { status: 'OK' },
      videoDetails: { title: 'Never Gonna Give You Up', author: 'Rick Astley', lengthSeconds: '213' },
      streamingData: { adaptiveFormats: [{ itag: 251, bitrate: 131072, mimeType: 'audio/webm', url: 'https://gv.example/videoplayback?itag=251' }] },
    };
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => innerTubeOk });
    try {
      const wf = mod.default.fetch;
      const bad = await wf(new Request('https://v.example/resolve'), {});
      assert.equal(bad.status, 400, 'missing videoId -> 400');
      const badCaps = await wf(new Request('https://v.example/resolve?videoId=AAAA'), {});
      assert.equal(badCaps.status, 400, 'all-caps invalid id -> 400');
      const ok = await wf(new Request('https://v.example/resolve?videoId=dQw4w9WgXcQ'), {});
      assert.equal(ok.status, 200);
      const body = await ok.json();
      assert.equal(body.videoId, 'dQw4w9WgXcQ');
      assert.equal(body.audioUrl, 'https://gv.example/videoplayback?itag=251');
      assert.equal(body.duration, 213);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('CF6 live smoke — deployed signer', () => {
  test('https://vibecatch-signer.pages.dev answers vibecheck + resolve + CORS', { timeout: 30000 }, async () => {
    const base = 'https://vibecatch-signer.pages.dev';
    const vb = await fetch(base + '/vibecheck');
    assert.equal(vb.status, 200);
    const vbj = await vb.json();
    assert.equal(vbj.ok, true);
    assert.equal(vbj.name, 'vibecatch-cf-signer');
    const pre = await fetch(base + '/resolve', { method: 'OPTIONS' });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');
    const res = await fetch(base + '/resolve?videoId=dQw4w9WgXcQ');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const body = await res.json();
    assert.ok(body.audioUrl && /googlevideo\.com/.test(body.audioUrl), 'mints a real signed googlevideo URL');
    assert.ok(body.title && body.duration > 0, 'metadata present');
    const bad = await fetch(base + '/resolve?videoId=AAAA');
    assert.equal(bad.status, 400, 'invalid id -> 400');
  });
});