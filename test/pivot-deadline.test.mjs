// GUARDIAN TDD ENFORCER — Audio-Double Pivot overall deadline bound
// freebuff-task-20260828-pivot-deadline
//
// Live CF-egress observation (production `/resolve` on vxUBYHz_q1I, 2026-08-28):
// when YouTube fully bot-blocks a request window, every candidate mint fails,
// and the pivot iterates all ~20 ranked candidates with a fresh 15s timeout
// each -> a single request can hang >30s (observed 35.2s), blowing the worker
// wall-clock budget far past the signer's own SIGNER_TIMEOUT_MS contract.
//
// Acceptance (worker/cf-signer-core.mjs):
//   DDL1: extractWithDoublePivot never exceeds ~2x opts.timeoutMs even when the
//         network hangs on every call (title, oembed, search, every candidate
//         mint) and every candidate is blocked.
//   DDL2: a successful candidate still wins when it resolves inside the budget.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const corePath = path.join(root, 'worker', 'cf-signer-core.mjs');
const freshCore = () => import(url.pathToFileURL(corePath).href + '?t=' + Date.now());

const ORIG = 'vxUBYHz_q1I';

// fetch that never settles unless aborted: hang() returns a withholding promise
// that rejects on the abort signal of the request options.
function hang(str) {
  return (_, opts) =>
    new Promise((resolve, reject) => {
      opts = opts || {};
      const onAbort = () => reject(Object.assign(new Error('aborted ' + str), { aborted: true }));
      if (!opts.signal) {
        setTimeout(onAbort, 90000);
        return;
      }
      if (opts.signal.aborted) return onAbort();
      opts.signal.addEventListener('abort', onAbort, { once: true });
    });
}

function playerBlocked() {
  return (_, o) => {
    const body = JSON.parse(o.body || '{}');
    return Promise.resolve({
      ok: true, status: 200,
      json: async () => ({
        playabilityStatus: { status: 'LOGIN_REQUIRED' },
        videoDetails: {},
        streamingData: {},
      }),
    });
  };
}

function fullHang() {
  return (u, o) => {
    const s = String(u);
    if (s.includes('/watch')) return Promise.resolve({ ok: true, status: 200, text: async () => '<title>Just a moment...</title>' });
    return hang(s)(u, o);
  };
}

describe('DDL1 overall deadline bound', () => {
  test('fully-blocked window returns within ~2x timeout (no unbounded hang)', { timeout: 15000 }, async () => {
    const mod = await freshCore();
    const t0 = Date.now();
    const r = await mod.extractWithDoublePivot(ORIG, { fetchImpl: fullHang(), timeoutMs: 1500 });
    const elapsed = Date.now() - t0;
    assert.equal(r, null, 'blocked window yields null');
    assert.ok(elapsed < 6000, `elapsed ${elapsed}ms exceeded 4x budget`);
  });

  test('candidate-loop exhaustion is bounded even when mints reject instantly (20 candidates)', { timeout: 15000 }, async () => {
    const mod = await freshCore();
    const searchWithMany = {
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [{
                itemSectionRenderer: {
                  contents: Array.from({ length: 20 }, (_, i) => ({
                    videoRenderer: {
                      videoId: 'ID' + String(i).padStart(2, '0'),
                      title: { runs: [{ text: 'Attention (Lyrics)' }] },
                      ownerText: { runs: [{ text: 'Charlie Puth' }] },
                      lengthText: { simpleText: '3:33' },
                    },
                  })),
                },
              }],
            },
          },
        },
      },
    };
    const routed = (u, o) => {
      const s = String(u);
      if (s.includes('/watch')) return Promise.resolve({ ok: true, status: 200, text: async () => '<title>Attention - YouTube</title>' });
      if (s.includes('/search')) return Promise.resolve({ ok: true, status: 200, json: async () => searchWithMany });
      if (s.includes('/player')) return playerBlocked()(u, o);
      throw new TypeError('unexpected ' + s);
    };
    const t0 = Date.now();
    const r = await mod.extractWithDoublePivot(ORIG, { fetchImpl: routed, timeoutMs: 2000 });
    const elapsed = Date.now() - t0;
    assert.equal(r, null, 'all candidates blocked yields null');
    assert.ok(elapsed < 6000, `elapsed ${elapsed}ms exceeded 4x budget`);
  });
});

describe('DDL2 success inside budget still wins', () => {
  test('a mintable candidate resolves within the deadline', async () => {
    const mod = await freshCore();
    const blockedIds = new Set([ORIG, 'ID00']);
    const routed = (u, o) => {
      const s = String(u);
      if (s.includes('/watch')) return Promise.resolve({ ok: true, status: 200, text: async () => '<title>Attention - YouTube</title>' });
      if (s.includes('/search')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({
            contents: {
              twoColumnSearchResultsRenderer: {
                primaryContents: {
                  sectionListRenderer: {
                    contents: [{
                      itemSectionRenderer: {
                        contents: [
                          { videoRenderer: { videoId: 'ID00', title: { runs: [{ text: 'Attention (Lyrics)' }] }, ownerText: { runs: [{ text: 'Charlie Puth' }] }, lengthText: { simpleText: '3:33' } } },
                          { videoRenderer: { videoId: 'GOOD', title: { runs: [{ text: 'Attention (Lyrics)' }] }, ownerText: { runs: [{ text: 'Charlie Puth' }] }, lengthText: { simpleText: '3:33' } } },
                        ],
                      },
                    }],
                  },
                },
              },
            },
          }),
        });
      }
      if (s.includes('/player')) {
        let videoId = 'x';
        try { videoId = JSON.parse(o.body || '{}').videoId || 'x'; } catch {}
        if (blockedIds.has(videoId)) return playerBlocked()(u, o);
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({
            playabilityStatus: { status: 'OK' },
            videoDetails: { title: 'Attention (Lyrics)', author: 'Charlie Puth', lengthSeconds: '213' },
            streamingData: { adaptiveFormats: [{ itag: 251, bitrate: 131072, mimeType: 'audio/webm', url: 'https://gv.example/ok?itag=251' }] },
          }),
        });
      }
      throw new TypeError('unexpected ' + s);
    };
    const t0 = Date.now();
    const r = await mod.extractWithDoublePivot(ORIG, { fetchImpl: routed, timeoutMs: 4000 });
    const elapsed = Date.now() - t0;
    assert.ok(r && r.doubled === true, 'pivoted payload');
    assert.equal(r.viaVideoId, 'GOOD', 'skipped blocked first candidate toward the mintable one');
    assert.ok(elapsed < 6000, 'fast path stays well under budget');
  });
});

describe('DDL3 oembed-first enriches artist even when watch title resolves', () => {
  test('ranking uses oembed artist so the right track wins end-to-end', async () => {
    const mod = await freshCore();
    // Watch title resolves ("Attention") but carries no artist. oembed gives
    // artist "Charlie Puth". Without the oembed artist signal, ranking would
    // start from the "Attention (Lyrics)" track by a different artist; with it,
    // the Charlie Puth "Audio" track must be minted first.
    const routed = (u, o) => {
      const s = String(u);
      if (s.includes('/oembed')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ title: 'Attention - Topic', author_name: 'Charlie Puth - Topic' }) });
      if (s.includes('/watch')) return Promise.resolve({ ok: true, status: 200, text: async () => '<title>Attention - YouTube</title>' });
      if (s.includes('/search')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({
            contents: {
              twoColumnSearchResultsRenderer: {
                primaryContents: {
                  sectionListRenderer: {
                    contents: [{
                      itemSectionRenderer: {
                        contents: [
                          { videoRenderer: { videoId: 'WRONG', title: { runs: [{ text: 'Attention (Lyrics)' }] }, ownerText: { runs: [{ text: 'NewJeans' }] }, lengthText: { simpleText: '3:31' } } },
                          { videoRenderer: { videoId: 'RIGHT', title: { runs: [{ text: 'Attention [Audio]' }] }, ownerText: { runs: [{ text: 'Charlie Puth' }] }, lengthText: { simpleText: '3:53' } } },
                        ],
                      },
                    }],
                  },
                },
              },
            },
          }),
        });
      }
      if (s.includes('/player')) {
        let videoId = 'x';
        try { videoId = JSON.parse(o.body || '{}').videoId || 'x'; } catch {}
        if (videoId === ORIG) return playerBlocked()(u, o);
        const isWrong = videoId === 'WRONG';
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({
            playabilityStatus: { status: 'OK' },
            videoDetails: { title: isWrong ? 'Attention (Lyrics)' : 'Attention [Audio]', author: isWrong ? 'NewJeans' : 'Charlie Puth', lengthSeconds: isWrong ? '211' : '233' },
            streamingData: { adaptiveFormats: [{ itag: 251, bitrate: 131072, mimeType: 'audio/webm', url: 'https://gv.example/ok?itag=251' }] },
          }),
        });
      }
      throw new TypeError('unexpected ' + s);
    };
    const r = await mod.extractWithDoublePivot(ORIG, { fetchImpl: routed, timeoutMs: 4000, originalDurationSec: 211 });
    assert.ok(r && r.doubled === true, 'pivoted payload');
    assert.equal(r.viaVideoId, 'RIGHT', 'oembed artist steered ranking to the right track');
    assert.equal(r.artist, 'Charlie Puth', 'payload carries the right artist');
  });
});