// GUARDIAN TDD ENFORCER — local-node /resolve hang timeout (feat/freebuff-task-20260909-resolvetimeout)
// Root cause observed in production: pasting a YouTube URL into the deployed PWA
// leaves the app stuck on "Resolving 3-Tier Media Stream..." forever. The network
// tab shows a pending fetch to http://127.0.0.1:8794/resolve?videoId=... that never
// settles (in-browser loopback fetch from an HTTPS origin hangs rather than failing
// fast). resolveViaLocalNode() awaits tryResolveOnPort() with NO AbortController
// timeout, so the hang blocks the whole 3-tier chain: the cloud signer relay and the
// strict-track APK fallback never get a chance to run.
// RT1: tryResolveOnPort aborts a /resolve call that never answers (hung port) within
//      a bounded budget (~2500ms) and returns null instead of hanging forever.
// RT2: a /resolve call that answers normally inside the budget still resolves.
// RT3: resolveViaLocalNode returns null (never throws) when every DEFAULT_PORT /resolve
//      hangs, so extractor.ts falls through to relay pool / cloud signer.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');

async function esbuildLoad(entry, name) {
  const { build } = await import(url.pathToFileURL(path.join(root, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-rt-test-'));
  const outFile = path.join(tmpDir, name + '.test-build.mjs');
  await build({ entryPoints: [entry], outfile: outFile, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
  return import(url.pathToFileURL(outFile).href);
}

const localNodePath = path.join(root, 'src', 'services', 'localNode.ts');

function ok(body) {
  return { ok: true, json: async () => body };
}

// Bounded wrapper: fails the test (clean error) if the promise does not settle in
// time. Without the fix, resolveViaLocalNode hangs forever — a green dispatch must
// not turn into a hung gate.
async function settledWithin(promiseFactory, ms, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`HANG: ${label} did not settle within ${ms}ms (timeout fix missing?)`)), ms);
  });
  try {
    return await Promise.race([promiseFactory(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// A fetcher whose /resolve IGNORES the AbortSignal and never answers — simulates a
// hung in-browser loopback fetch. Anything else throws.
function hangFetcher() {
  const seen = [];
  const fetcher = async (input, init) => {
    const u = String(input);
    if (u.startsWith('http://127.0.0.1:') && u.includes('/resolve?videoId=')) {
      seen.push(u);
      // Hang forever: ignore init.signal entirely (no timeout of our own).
      await new Promise(() => {});
    }
    throw new Error('unexpected fetch: ' + u);
  };
  return { fetcher, seen };
}

describe('RT1 tryResolveOnPort times out a hanging /resolve', () => {
  test('hung /resolve returns null within ~4s (does not hang forever)', async () => {
    const mod = await esbuildLoad(localNodePath, 'localNode');
    const { fetcher, seen } = hangFetcher();
    const t0 = Date.now();
    const r = await settledWithin(
      () => mod.resolveViaLocalNode('vid_hang_1', { fetchImpl: fetcher }),
      20000,
      'resolveViaLocalNode (hung /resolve)',
    );
    const elapsed = Date.now() - t0;
    assert.equal(r, null, 'hung resolve must yield null so the chain falls through');
    assert.ok(seen.length >= 1, 'hanging /resolve must actually be attempted');
    assert.ok(elapsed < 20000, `resolveViaLocalNode took ${elapsed}ms — it hung instead of timing out`);
  });
});

describe('RT2 fast /resolve still resolves inside the budget', () => {
  test('a port whose /resolve answers in 300ms returns its audio', async () => {
    const mod = await esbuildLoad(localNodePath, 'localNode');
    const fetcher = async (input) => {
      const u = String(input);
      if (u.startsWith('http://127.0.0.1:') && u.endsWith('/vibecheck')) {
        return ok({ ok: true, name: 'vibecatch-local-node', version: '1.0.0' });
      }
      if (u.startsWith('http://127.0.0.1:') && u.includes('/resolve?videoId=')) {
        return ok({ audioUrl: 'https://googlevideo.example/x.m4a', title: 'Song', artist: 'Artist', duration: 200 });
      }
      throw new Error('unexpected fetch: ' + u);
    };
    const r = await mod.resolveViaLocalNode('vid_fast_2', { fetchImpl: fetcher });
    assert.ok(r, 'fast-answering local node must resolve');
    assert.equal(r.audioUrl, 'https://googlevideo.example/x.m4a');
    assert.equal(r.source, 'local-node');
  });
});

describe('RT3 all ports hang -> null (extractor falls through)', () => {
  test('resolveViaLocalNode returns null when every DEFAULT_PORT /resolve hangs', async () => {
    const mod = await esbuildLoad(localNodePath, 'localNode');
    const { fetcher } = hangFetcher();
    const t0 = Date.now();
    const r = await settledWithin(
      () => mod.resolveViaLocalNode('vid_hang_3', { fetchImpl: fetcher }),
      25000,
      'resolveViaLocalNode (all ports hung)',
    );
    const elapsed = Date.now() - t0;
    assert.equal(r, null, 'all-hung local node must resolve to null');
    assert.ok(elapsed < 25000, `fell through in ${elapsed}ms`);
  });
});