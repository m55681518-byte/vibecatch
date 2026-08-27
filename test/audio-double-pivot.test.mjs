// GUARDIAN TDD ENFORCER — Audio-Double Pivot (strict YT-Music ID rescue)
// freebuff-task-20260828-004457
//
// Problem: YT-Music auto-generated ("- Topic") IDs are BotGuard-fenced from
// datacenter IPs — the Cloudflare signer returns 502 for them ("all youtube
// clients failed"). The fix is a silent fallback loop in cf-signer-core.mjs:
//   primary InnerTube mint fails -> scrape <title> from the standard watch
//   HTML (never blocked) -> InnerTube WEB search for "<song> official audio" /
//   "lyric" -> pick a STANDARD (non-Topic) video -> mint THAT id normally.
//   The user gets the exact same song from the unblocked standard upload.
//
// Acceptance surface (all new exports in worker/cf-signer-core.mjs):
//   DP1: fetchWatchTitle(videoId, opts)      -> string|null
//        (strips trailing " - YouTube" and " - Topic"; null on unusable)
//   DP2: searchStandardDouble(query, opts)   -> ranked candidate array
//   DP3: pickDoubleCandidate(cands, originalId, originalDur) -> candidate|null
//        (pure ranking: lyric/official/audio keywords, non-Topic channel,
//         duration closeness, excludes the original id)
//   DP4: extractWithDoublePivot(videoId, opts) -> payload|null
//        (primary mint; on failure -> title -> search -> mint each candidate;
//         success tagged { doubled:true, originalVideoId, viaVideoId };
//         opts.prioritizeDouble:true skips the primary mint — test hook)
//   DP5: worker /resolve returns the pivoted payload (global-fetch stub)
//   DP6: LIVE — strict music id resolves through the pivot on the real network
//
// CF-compat constraints apply (no node: imports, no CJS — DP0 repurposes the
// existing CF4 purity gate; run the full test/ suite afterwards).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const corePath = path.join(root, 'worker', 'cf-signer-core.mjs');
const workerPath = path.join(root, 'worker', 'cf-signer-worker.mjs');
const freshCore = () => import(url.pathToFileURL(corePath).href + '?t=' + Date.now());
const freshWorker = () => import(url.pathToFileURL(workerPath).href + '?t=' + Date.now());

const ORIG = 'vxUBYHz_q1I';
const CAND = 'CCC';

const SEARCH_FIXTURE = {
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [
            {
              itemSectionRenderer: {
                contents: [
                  {
                    videoRenderer: {
                      videoId: 'AAA',
                      title: { runs: [{ text: 'Attention (Official Video)' }] },
                      ownerText: { runs: [{ text: 'Charlie Puth' }] },
                      lengthText: { simpleText: '3:31' },
                    },
                  },
                  {
                    videoRenderer: {
                      videoId: 'BBB',
                      title: { runs: [{ text: 'Attention' }] },
                      ownerText: { runs: [{ text: 'Charlie Puth - Topic' }] },
                      lengthText: { simpleText: '3:31' },
                    },
                  },
                  {
                    videoRenderer: {
                      videoId: CAND,
                      title: { runs: [{ text: 'Attention (Lyric Video)' }] },
                      ownerText: { runs: [{ text: 'Charlie Puth' }] },
                      lengthText: { simpleText: '3:28' },
                    },
                  },
                  {
                    videoRenderer: {
                      videoId: 'DDD',
                      title: { runs: [{ text: 'Something Totally Different' }] },
                      ownerText: { runs: [{ text: 'RandomChannel' }] },
                      lengthText: { simpleText: '10:00' },
                    },
                  },
                  {
                    videoRenderer: {
                      videoId: ORIG,
                      title: { runs: [{ text: 'Attention' }] },
                      ownerText: { runs: [{ text: 'Charlie Puth - Topic' }] },
                      lengthText: { simpleText: '3:31' },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    },
  },
};

function searchResponse() {
  return { ok: true, status: 200, text: async () => JSON.stringify(SEARCH_FIXTURE), json: async () => SEARCH_FIXTURE };
}

function playerResponse(videoId) {
  if (videoId === ORIG) {
    return {
      ok: true, status: 200,
      json: async () => ({
        playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Please sign in' },
        videoDetails: {}, streamingData: {},
      }),
    };
  }
  return {
    ok: true, status: 200,
    json: async () => ({
      playabilityStatus: { status: 'OK' },
      videoDetails: { title: 'Attention (Lyric Video)', author: 'Charlie Puth', lengthSeconds: '208' },
      streamingData: { adaptiveFormats: [{ itag: 251, bitrate: 131072, mimeType: 'audio/webm', url: 'https://gv.example/double?itag=251' }] },
    }),
  };
}

function watchHtmlResponse() {
  return {
    ok: true, status: 200,
    text: async () => '<title>Attention - Charlie Puth - Topic - YouTube</title>',
  };
}

// Routed fetch: /player by videoId, /watch -> html, /search -> fixture.
function routedFetch(urlStr, options = {}) {
  const asString = String(urlStr);
  if (asString.includes('/player')) {
    const body = JSON.parse(options.body || '{}');
    return Promise.resolve(playerResponse(body.videoId || ''));
  }
  if (asString.includes('/watch')) return Promise.resolve(watchHtmlResponse());
  if (asString.includes('/search')) return Promise.resolve(searchResponse());
  return Promise.reject(new TypeError('unexpected fetch: ' + asString));
}

describe('DP0 source purity (CF-compat) is kept', () => {
  test('worker files stay free of Node builtins / CJS artifacts', async () => {
    const fs = await import('node:fs');
    for (const p of [corePath, workerPath]) {
      const src = fs.readFileSync(p, 'utf8');
      assert.doesNotMatch(src, /from\s+['"]node:/, `${path.basename(p)}: node: import`);
      assert.doesNotMatch(src, /\brequire\s*\(/, `${path.basename(p)}: CommonJS require`);
      assert.doesNotMatch(src, /\bprocess\s*\./, `${path.basename(p)}: process global`);
      assert.doesNotMatch(src, /\b__dirname\b|\bmodule\s*\.\s*exports\b/, `${path.basename(p)}: CJS globals`);
    }
  });
});

describe('DP1 fetchWatchTitle', () => {
  test('module exports the pivot contract', async () => {
    const mod = await freshCore();
    for (const k of ['fetchWatchTitle', 'searchStandardDouble', 'pickDoubleCandidate', 'extractWithDoublePivot']) {
      assert.equal(typeof mod[k], 'function', `missing export: ${k}`);
    }
  });

  test('strips " - YouTube" and " - Topic" from the watch <title>', async () => {
    const mod = await freshCore();
    const out = await mod.fetchWatchTitle(ORIG, { fetchImpl: async () => watchHtmlResponse() });
    assert.equal(out, 'Attention - Charlie Puth');
  });

  test('handles a bare song title', async () => {
    const mod = await freshCore();
    const out = await mod.fetchWatchTitle(ORIG, { fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<title>Attention - YouTube</title>' }) });
    assert.equal(out, 'Attention');
  });

  test('returns null when nothing usable remains', async () => {
    const mod = await freshCore();
    const out = await mod.fetchWatchTitle(ORIG, { fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<title>YouTube</title>' }) });
    assert.equal(out, null);
  });

  test('returns null on fetch failure (never throws)', async () => {
    const mod = await freshCore();
    const out = await mod.fetchWatchTitle(ORIG, { fetchImpl: async () => { throw new TypeError('blocked'); } });
    assert.equal(out, null);
  });
});

describe('DP2 searchStandardDouble', () => {
  test('parses WEB search JSON into a ranked candidate list', async () => {
    const mod = await freshCore();
    const out = await mod.searchStandardDouble('Attention - Charlie Puth', { fetchImpl: async () => searchResponse() });
    assert.ok(Array.isArray(out) && out.length >= 3, 'three+ usable candidates');
    const ids = out.map((c) => c.videoId);
    assert.ok(!ids.includes(ORIG), 'original music id excluded');
    assert.ok(!ids.includes('BBB'), 'Topic-channel candidate excluded');
    assert.ok(ids.includes(CAND), 'lyric video candidate present');
    assert.equal(out[0].videoId, CAND, 'highest-scored = lyric video');
    assert.ok(out[0].channel && out[0].title, 'candidate carries title+channel');
  });

  test('never throws; empty array on failure', async () => {
    const mod = await freshCore();
    const out = await mod.searchStandardDouble('x', { fetchImpl: async () => { throw new TypeError('dead'); } });
    assert.deepEqual(out, []);
    const bad = await mod.searchStandardDouble('x', { fetchImpl: async () => ({ ok: false, status: 403 }) });
    assert.deepEqual(bad, []);
  });
});

describe('DP3 pickDoubleCandidate', () => {
  test('favours lyric/official near-original-duration non-Topic over noise', async () => {
    const mod = await freshCore();
    const cands = (await mod.searchStandardDouble('q', { fetchImpl: async () => searchResponse() }));
    const pick = mod.pickDoubleCandidate(cands, ORIG, 211);
    assert.ok(pick, 'a candidate is picked');
    assert.equal(pick.videoId, CAND);
    assert.notEqual(pick.videoId, ORIG);
  });

  test('null on empty input', async () => {
    const mod = await freshCore();
    assert.equal(mod.pickDoubleCandidate([], ORIG, 200), null);
    assert.equal(mod.pickDoubleCandidate(null, ORIG, 200), null);
  });
});

describe('DP4 extractWithDoublePivot (mocked network)', () => {
  test('primary mint wins when it works (no double, no extra fetch)', async () => {
    const mod = await freshCore();
    const onlyPlayer = async (u, o) => {
      const body = JSON.parse(o.body || '{}');
      return playerResponse(body.videoId || 'cand');
    };
    const r = await mod.extractWithDoublePivot('someOther', { fetchImpl: onlyPlayer, timeoutMs: 3000 });
    assert.ok(r, 'payload');
    assert.equal(r.doubled, undefined, 'not tagged as double');
    assert.equal(r.audioUrl, 'https://gv.example/double?itag=251');
  });

  test('blocked primary -> watch title -> search -> candidate mint (doubled)', async () => {
    const mod = await freshCore();
    const r = await mod.extractWithDoublePivot(ORIG, { fetchImpl: routedFetch, timeoutMs: 3000 });
    assert.ok(r, 'pivot payload');
    assert.equal(r.doubled, true);
    assert.equal(r.originalVideoId, ORIG);
    assert.equal(r.viaVideoId, CAND);
    assert.equal(r.audioUrl, 'https://gv.example/double?itag=251');
    assert.equal(r.title, 'Attention (Lyric Video)');
    assert.equal(r.artist, 'Charlie Puth');
    assert.equal(r.duration, 208);
  });

  test('prioritizeDouble skips the primary mint entirely (live probe hook)', async () => {
    const mod = await freshCore();
    const seen = [];
    const tracingFetch = async (u, o) => {
      seen.push(String(u));
      const body = JSON.parse(o.body || '{}');
      if (String(u).includes('/player')) return playerResponse(body.videoId || 'x');
      if (String(u).includes('/watch')) return watchHtmlResponse();
      if (String(u).includes('/search')) return searchResponse();
      throw new TypeError('unexpected ' + u);
    };
    const r = await mod.extractWithDoublePivot(ORIG, { fetchImpl: tracingFetch, prioritizeDouble: true, timeoutMs: 3000 });
    assert.ok(r && r.doubled === true, 'doubled payload');
    assert.equal(r.viaVideoId, CAND);
    assert.ok(seen.filter((u) => u.includes('/player')).length >= 2, 'candidate player(s) fetched');
  });

  test('null when pivot also fails (never throws)', async () => {
    const mod = await freshCore();
    const allDead = async () => { throw new TypeError('dead'); };
    const r = await mod.extractWithDoublePivot(ORIG, { fetchImpl: allDead, timeoutMs: 300 });
    assert.equal(r, null);
  });
});

describe('DP5 worker wiring', () => {
  test('/resolve returns pivoted payload with doubled marker when primary blocked', async () => {
    const mod = await freshWorker();
    const realFetch = globalThis.fetch;
    globalThis.fetch = routedFetch;
    try {
      const res = await mod.default.fetch(new Request('https://v.example/resolve?videoId=' + ORIG), {});
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.doubled, true);
      assert.equal(body.viaVideoId, CAND);
      assert.equal(body.originalVideoId, ORIG);
      assert.equal(body.audioUrl, 'https://gv.example/double?itag=251');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('/resolve happy path stays doubled:false (no marker)', async () => {
    const mod = await freshWorker();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (u, o) => {
      const body = JSON.parse(o.body || '{}');
      return Promise.resolve(playerResponse(body.videoId || 'cand'));
    };
    try {
      const res = await mod.default.fetch(new Request('https://v.example/resolve?videoId=dQw4w9WgXcQ'), {});
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.doubled, undefined);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('DP6 LIVE — strict music id resolved via the pivot on the real network', () => {
  test('vxUBYHz_q1I -> real watch title -> real search -> real signed googlevideo URL', { timeout: 60000 }, async () => {
    const mod = await freshCore();
    const r = await mod.extractWithDoublePivot(ORIG, { prioritizeDouble: true, timeoutMs: 15000 });
    assert.ok(r, 'pivot returned a payload for a BotGuard-fenced music id');
    assert.equal(r.doubled, true, 'came through the double (primary skipped)');
    assert.ok(r.audioUrl && /googlevideo\.com/.test(r.audioUrl), 'real signed googlevideo URL');
    assert.ok(/attention/i.test(r.title), 'title names the song');
    assert.ok(/charlie/ig.test(r.artist || ''), 'artist present');
  });
});