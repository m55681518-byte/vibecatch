// GUARDIAN TDD ENFORCER — cloud-only download: signer /stream byte relay + cloud-first relay
// (freebuff-task-20260906-cloudstream)
//
// Regression: the download button silently failed unless the LAPTOP node was up. The PWA
// routed byte-downloads through fetchUrlForDownload -> <relayBase>/stream?url=<googlevideo>,
// but (a) the always-on Cloudflare signer had NO /stream route (404), and (b) discoverRelayBase
// preferred the laptop local node / laptop quick-tunnels. Requirement: download works with ZERO
// laptop involvement — everything on the cloud (always-on vibecatch-signer.pages.dev).
//
// Acceptance:
//   CS1: /stream proxies signed googlevideo bytes with Access-Control-Allow-Origin:* + content-type
//   CS2: Range header is forwarded upstream; 206 + content-range + expose-headers on the response
//   CS3: missing url param -> 400
//   CS4: non-http(s) upstream url -> 400
//   CS5: /vibecheck + OPTIONS unchanged (regression), /stream stays GET-only rule-compliant
//   CS6: PWA discoverRelayBase returns the always-on cloud signer base (no laptop dependency);
//        fetchUrlForDownload wraps a direct googlevideo URL into that base /stream?url=...
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const workerPath = path.join(root, 'worker', 'cf-signer-worker.mjs');
const demuxerPath = path.join(root, 'src', 'services', 'demuxer.ts');
const downloadUrlPath = path.join(root, 'src', 'services', 'downloadUrl.ts');

const CLOUD_BASE = 'https://vibecatch-signer.pages.dev';
const SIGNED_GV = 'https://rr4---sn-5pguxa3x-ocvz.googlevideo.com/videoplayback?expire=1787870612&itag=140&ratebypass=yes';

async function loadWorker() {
  assert.ok(fs.existsSync(workerPath), 'worker/cf-signer-worker.mjs must exist');
  return import(url.pathToFileURL(workerPath).href);
}

function makeUpstream({ status = 200, headers = {}, body = null, onFetch } = {}) {
  const bytes = body !== null
    ? body
    : Buffer.alloc(131072, (i) => (i * 7) & 0xff);
  const upstream = async (input, init) => {
    onFetch && onFetch(input, init);
    const h = Object.assign({
      'content-type': 'audio/mp4',
      'content-length': String(bytes.length),
      'accept-ranges': 'bytes',
    }, headers);
    if (h['content-range'] !== undefined && h['content-length'] === undefined) {
      delete h['content-length'];
    }
    return new Response(bytes, { status, headers: h });
  };
  const prev = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const u = String(input);
    if (/googlevideo\.com/.test(u) || /^https?:\/\//.test(u)) return upstream(input, init);
    return prev(input, init);
  };
  return () => { globalThis.fetch = prev; };
}

async function mockFetch(worker, urlToCall, init = {}) {
  const req = new Request(urlToCall, init);
  const handler = worker.default || worker;
  assert.equal(typeof handler.fetch, 'function', 'worker must default-export { fetch }');
  return handler.fetch(req, {});
}

describe('CS1 /stream proxies signed CDN bytes with CORS *', () => {
  test('returns upstream bytes, status, contentType + Access-Control-Allow-Origin:*', async () => {
    const worker = await loadWorker();
    const streams = [];
    const restore = makeUpstream({ onFetch: (input, init) => streams.push({ input: String(input), init }) });
    try {
      const streamUrl = `https://vibecatch-signer.pages.dev/stream?url=${encodeURIComponent(SIGNED_GV)}`;
      const res = await mockFetch(worker, streamUrl);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      assert.match(res.headers.get('content-type') || '', /audio\/mp4/);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.equal(bytes.length, 131072, 'must relay the FULL upstream body, not a windowed slice');
      assert.equal(streams.length, 1, 'exactly one upstream fetch');
      assert.ok(streams[0].input.includes('googlevideo.com'), 'must fetch the signed upstream URL');
    } finally { restore(); }
  });

  test('never buffers into a 1MiB window — full-length relay written to response', async () => {
    const worker = await loadWorker();
    const big = Buffer.alloc(2 * 1024 * 1024 + 777); // >1MiB to prove no window cap
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff;
    const restore = makeUpstream({ body: big });
    try {
      const streamUrl = `${CLOUD_BASE}/stream?url=${encodeURIComponent(SIGNED_GV)}`;
      const res = await mockFetch(worker, streamUrl);
      assert.equal(res.status, 200);
      const got = Buffer.from(await res.arrayBuffer());
      assert.equal(got.length, big.length, 'full file length preserved');
      assert.ok(got.equals(big), 'bytes byte-identical');
    } finally { restore(); }
  });
});

describe('CS2 Range passthrough (seekable/partial)', () => {
  test('forwards the client Range upstream; relays 206 + content-range + expose-headers', async () => {
    const worker = await loadWorker();
    const calls = [];
    const restore = makeUpstream({
      status: 206,
      headers: { 'content-range': 'bytes 10-19/131072' },
      body: Buffer.alloc(10, 7),
      onFetch: (input, init) => calls.push({ input: String(input), init }),
    });
    try {
      const streamUrl = `${CLOUD_BASE}/stream?url=${encodeURIComponent(SIGNED_GV)}`;
      const res = await mockFetch(worker, streamUrl, { headers: { 'Range': 'bytes=10-19' } });
      assert.equal(res.status, 206, 'must preserve partial status');
      assert.equal(res.headers.get('content-range'), 'bytes 10-19/131072', 'must expose content-range to the browser');
      assert.match(res.headers.get('access-control-expose-headers') || '', /content-range/i, 'content-range must be CORS-exposed');
      assert.ok(calls.length >= 1);
      const hdr = calls[0].init && (calls[0].init.headers || {});
      assert.equal(hdr && hdr.Range, 'bytes=10-19', 'Range must be forwarded to upstream');
      const got = Buffer.from(await res.arrayBuffer());
      assert.equal(got.length, 10);
    } finally { restore(); }
  });
});

describe('CS3/CS4 input validation (mirrors node /stream rules)', () => {
  test('missing url param -> 400', async () => {
    const worker = await loadWorker();
    const restore = makeUpstream();
    try {
      const res = await mockFetch(worker, `${CLOUD_BASE}/stream`);
      assert.equal(res.status, 400);
    } finally { restore(); }
  });

  test('non-http(s) upstream (file://) -> 400', async () => {
    const worker = await loadWorker();
    const restore = makeUpstream();
    try {
      const res = await mockFetch(worker, `${CLOUD_BASE}/stream?url=${encodeURIComponent('file:///etc/passwd')}`);
      assert.equal(res.status, 400);
    } finally { restore(); }
  });

  test('upstream 4xx -> 502 JSON (never hangs, hones error)', async () => {
    const worker = await loadWorker();
    const restore = makeUpstream({ status: 403, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>forbidden</html>') });
    try {
      const res = await mockFetch(worker, `${CLOUD_BASE}/stream?url=${encodeURIComponent(SIGNED_GV)}`);
      assert.ok(res.status === 502 || res.status === 403, 'honest non-2xx returned');
      const json = await res.json().catch(() => null);
      assert.ok(!json || json.error, 'API-style error object when JSON');
    } finally { restore(); }
  });
});

describe('CS5 existing signer routes unchanged (regression)', () => {
  test('OPTIONS -> 204 + CORS', async () => {
    const worker = await loadWorker();
    const res = await mockFetch(worker, `${CLOUD_BASE}/stream`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  test('/vibecheck still answers ok:true (name vibecatch-cf-signer)', async () => {
    const worker = await loadWorker();
    const res = await mockFetch(worker, `${CLOUD_BASE}/vibecheck`);
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.ok, true);
    assert.equal(j.name, 'vibecatch-cf-signer');
  });
});

describe('CS6 PWA download path is cloud-only (zero laptop)', () => {
  test('demuxer discoverRelayBase returns the always-on cloud signer base', () => {
    assert.ok(fs.existsSync(demuxerPath), 'demuxer.ts must exist');
    const src = fs.readFileSync(demuxerPath, 'utf8');
    // The discovery function must route byte-downloads through the always-on
    // cloud signer base, NOT the laptop node / laptop quick-tunnels.
    const start = src.indexOf('async function discoverRelayBase');
    assert.ok(start > -1, 'discoverRelayBase must exist');
    const fnBody = src.slice(start, start + 400);
    const constIdx = src.lastIndexOf('CLOUD_SIGNER_BASE =', start);
    assert.ok(constIdx > -1, 'CLOUD_SIGNER_BASE constant must be defined');
    const constLine = src.slice(constIdx, constIdx + 120);
    assert.match(constLine, /vibecatch-signer\.pages\.dev/, 'CLOUD_SIGNER_BASE must point at the always-on cloud signer');
    assert.match(fnBody, /CLOUD_SIGNER_BASE/, 'discoverRelayBase must return the cloud signer base');
    assert.doesNotMatch(fnBody, /127\.0\.0\.1|probeLocalNode\s*\(|probeRelayManifest\s*\(/, 'cloud relay discovery must NOT depend on the laptop node/tunnel');
  });

  test('fetchUrlForDownload wraps a direct googlevideo URL into cloud /stream', async () => {
    const { build } = await import(url.pathToFileURL(path.join(root, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-cs6-'));
    const outFile = path.join(tmpDir, 'downloadUrl.cloud-build.mjs');
    await build({ entryPoints: [downloadUrlPath], outfile: outFile, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
    const mod = await import(url.pathToFileURL(outFile).href);
    assert.equal(typeof mod.fetchUrlForDownload, 'function');
    const out = mod.fetchUrlForDownload({ streamUrl: SIGNED_GV, downloadUrl: undefined }, CLOUD_BASE);
    const u = new URL(out);
    assert.equal(u.origin + u.pathname, CLOUD_BASE + '/stream', 'cloud relay route is /stream');
    assert.equal(u.searchParams.get('url'), SIGNED_GV);
  });
});