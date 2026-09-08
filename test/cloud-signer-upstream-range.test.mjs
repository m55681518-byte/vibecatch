// GUARDIAN GATE — freebuff-task-20260908-upstream-range
// Regression: the PWA byte-download path fetches <signer>/stream?url=<googlevideo>
// with NO Range header. Real googlevideo fetches from a datacenter egress WITHOUT a
// Range header are throttled/streamed extremely slowly (measured ~113s for 3.4MB vs
// ~3s with `Range: bytes=0-`). Requirement: the worker MUST default the UPSTREAM
// request to `Range: bytes=0-` when the client sends none, so full-file byte-downloads
// via the cloud relay transfer at full speed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const workerPath = path.join(root, 'worker', 'cf-signer-worker.mjs');
const CLOUD_BASE = 'https://vibecatch-signer.pages.dev';
const SIGNED_GV = 'https://rr4---sn-5pguxa3x-ocvz.googlevideo.com/videoplayback?expire=1787870612&itag=251&ratebypass=yes';

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
      'content-type': 'audio/webm',
      'content-length': String(bytes.length),
      'accept-ranges': 'bytes',
    }, headers);
    if (h['content-length'] === undefined) delete h['content-length'];
    return new Response(bytes, { status, headers: h });
  };
  const prev = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const u = String(input);
    if (/googlevideo\.com/.test(u)) return upstream(input, init);
    return prev(input, init);
  };
  return () => { globalThis.fetch = prev; };
}

describe('UR1 default upstream Range for full-file download', () => {
  test('client sends NO Range -> worker forwards Range: bytes=0- upstream', async () => {
    const worker = await loadWorker();
    const calls = [];
    const restore = makeUpstream({ onFetch: (input, init) => calls.push({ input: String(input), init }) });
    try {
      const streamUrl = `${CLOUD_BASE}/stream?url=${encodeURIComponent(SIGNED_GV)}`;
      const res = await mockFetch(worker, streamUrl);
      assert.equal(res.status, 200);
      assert.ok(calls.length >= 1, 'exactly the upstream must be fetched');
      const hdr = calls[0].init && (calls[0].init.headers || {});
      assert.equal(hdr && hdr.Range, 'bytes=0-', 'must send a default full-range request upstream');
      await res.arrayBuffer();
    } finally { restore(); }
  });

  test('client DOES send Range -> that exact Range forwarded (no default override)', async () => {
    const worker = await loadWorker();
    const calls = [];
    const restore = makeUpstream({
      status: 206,
      headers: { 'content-range': 'bytes 100-199/131072' },
      body: Buffer.alloc(100, 3),
      onFetch: (input, init) => calls.push({ input: String(input), init }),
    });
    try {
      const streamUrl = `${CLOUD_BASE}/stream?url=${encodeURIComponent(SIGNED_GV)}`;
      const res = await mockFetch(worker, streamUrl, { headers: { 'Range': 'bytes=100-199' } });
      assert.equal(res.status, 206);
      const hdr = calls[0].init && (calls[0].init.headers || {});
      assert.equal(hdr && hdr.Range, 'bytes=100-199', 'explicit client Range must win');
      await res.arrayBuffer();
    } finally { restore(); }
  });

  test('relayed 206 (from default full-range) exposes content-range to the browser', async () => {
    const worker = await loadWorker();
    const restore = makeUpstream({
      status: 206,
      headers: { 'content-range': 'bytes 0-3433754/3433755' },
      body: Buffer.alloc(3433755, 9),
    });
    try {
      const streamUrl = `${CLOUD_BASE}/stream?url=${encodeURIComponent(SIGNED_GV)}`;
      const res = await mockFetch(worker, streamUrl);
      assert.equal(res.status, 206);
      assert.equal(res.headers.get('content-range'), 'bytes 0-3433754/3433755');
      assert.match(res.headers.get('access-control-expose-headers') || '', /content-range/i);
      const got = Buffer.from(await res.arrayBuffer());
      assert.equal(got.length, 3433755, 'full file relayed');
    } finally { restore(); }
  });
});

async function mockFetch(worker, urlToCall, init = {}) {
  const req = new Request(urlToCall, init);
  const handler = worker.default || worker;
  return handler.fetch(req, {});
}