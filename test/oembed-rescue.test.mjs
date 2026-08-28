// GUARDIAN TDD ENFORCER — Audio-Double Pivot CF-egress rescue (oembed title
// fallback + artist-aware ranking + multi-candidate mint)
// freebuff-task-20260828-oembed-rescue
//
// Live CF-egress diagnosis (diag worker, 2026-08-28):
//   - fetchWatchTitle -> null from Cloudflare egress: the watch HTML is a
//     BotGuard/consent wrapper with no parseable <title>. The pivot never
//     reached the search stage in production -> the "/resolve" 502s persisted.
//   - oembed (youtube.com/oembed?url=...&format=json) is NOT gated: returns
//     {title,author_name} reliably (~150-350ms) even from datacenter IPs.
//   - searchStandardDouble works from CF egress when handed a title.
//   - mintSignedUrl on candidates is flaky (~40% per candidate) -> the pivot
//     must try the ranked candidates in order, not just the first.
//   - Without the oembed artist, ranking can choose a DIFFERENT artist's
//     "same-named" track (observed: NewJeans / The Weeknd - Attention won).
//
// New acceptance surface (worker/cf-signer-core.mjs):
//   OR1: fetchOembedInfo(videoId, opts) -> {title, artist}|null
//        (oembed JSON; strips " - Topic" from author; null on any failure)
//   OR2: extractWithDoublePivot falls back to oembed when the watch <title> is
//        unusable, then searches and mints a ranked candidate.
//   OR3: rankCandidates/pickDoubleCandidate accept an optional artistName and
//        strongly prefer candidates whose channel OR title mentions it.
//   OR4: pivot mints ranked candidates in order until one succeeds (multi-candidate).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const corePath = path.join(root, 'worker', 'cf-signer-core.mjs');
const freshCore = () => import(url.pathToFileURL(corePath).href + '?t=' + Date.now());

const ORIG = 'vxUBYHz_q1I';

function oembedResponse(author) {
  return {
    ok: true, status: 200,
    json: async () => ({ title: 'Attention', author_name: author || 'Charlie Puth - Topic' }),
  };
}

function watchResponseUnusable() {
  return { ok: true, status: 200, text: async () => '<title>Just a moment...</title>' };
}
function watchResponseGood() {
  return { ok: true, status: 200, text: async () => '<title>Attention - Charlie Puth - Topic - YouTube</title>' };
}

const SEARCH = {
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [
            {
              itemSectionRenderer: {
                contents: [
                  { videoRenderer: { videoId: 'NEWJEANS', title: { runs: [{ text: 'NewJeans (뉴진스) - Attention 「Official Audio」' }] }, ownerText: { runs: [{ text: 'K MUSIC' }] }, lengthText: { simpleText: '3:01' } } },
                  { videoRenderer: { videoId: 'WRONGART', title: { runs: [{ text: 'The Weeknd - Attention (Audio)' }] }, ownerText: { runs: [{ text: 'The Weeknd' }] }, lengthText: { simpleText: '3:17' } } },
                  { videoRenderer: { videoId: 'CPACOUST', title: { runs: [{ text: 'Charlie Puth - Attention (Acoustic) [Official Audio]' }] }, ownerText: { runs: [{ text: 'Charlie Puth' }] }, lengthText: { simpleText: '3:27' } } },
                  { videoRenderer: { videoId: 'CPLYRIC', title: { runs: [{ text: 'Charlie Puth - Attention (Lyrics)' }] }, ownerText: { runs: [{ text: 'Lost Panda' }] }, lengthText: { simpleText: '3:33' } } },
                ],
              },
            },
          ],
        },
      },
    },
  },
};

function playerOk(videoId) {
  return {
    ok: true, status: 200,
    json: async () => ({
      playabilityStatus: { status: 'OK' },
      videoDetails: { title: 'Charlie Puth - Attention (Lyrics)', author: 'Lost Panda', lengthSeconds: '213' },
      streamingData: { adaptiveFormats: [{ itag: 251, bitrate: 131072, mimeType: 'audio/webm', url: 'https://gv.example/pivoted?itag=251' }] },
    }),
  };
}

describe('OR1 fetchOembedInfo', () => {
  test('module exports the oembed contract', async () => {
    const mod = await freshCore();
    assert.equal(typeof mod.fetchOembedInfo, 'function', 'missing export: fetchOembedInfo');
  });

  test('parses oembed JSON into {title, artist} and strips " - Topic"', async () => {
    const mod = await freshCore();
    const info = await mod.fetchOembedInfo(ORIG, { fetchImpl: async () => oembedResponse() });
    assert.deepEqual(info, { title: 'Attention', artist: 'Charlie Puth' });
  });

  test('keeps a non-Topic author untouched', async () => {
    const mod = await freshCore();
    const info = await mod.fetchOembedInfo(ORIG, { fetchImpl: async () => oembedResponse('Charlie Puth') });
    assert.deepEqual(info, { title: 'Attention', artist: 'Charlie Puth' });
  });

  test('null on failed / non-ok responses (never throws)', async () => {
    const mod = await freshCore();
    assert.equal(await mod.fetchOembedInfo(ORIG, { fetchImpl: async () => { throw new TypeError('dead'); } }), null);
    assert.equal(await mod.fetchOembedInfo(ORIG, { fetchImpl: async () => ({ ok: false, status: 403 }) }), null);
    assert.equal(await mod.fetchOembedInfo(ORIG, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) }), null);
  });
});

describe('OR2 extractWithDoublePivot oembed fallback', () => {
  test('unusable watch title -> oembed title -> search -> first mintable candidate', async () => {
    const mod = await freshCore();
    const routed = async (u, o) => {
      const s = String(u);
      if (s.includes('/oembed')) return oembedResponse();
      if (s.includes('/watch')) return watchResponseUnusable();
      if (s.includes('/search')) return { ok: true, status: 200, json: async () => SEARCH };
      if (s.includes('/player')) return playerOk('UNUSED');
      throw new TypeError('unexpected ' + s);
    };
    const r = await mod.extractWithDoublePivot(ORIG, { fetchImpl: routed, timeoutMs: 4000, prioritizeDouble: true });
    assert.ok(r, 'pivot payload');
    assert.equal(r.doubled, true);
    assert.ok(r.viaVideoId, 'via a candidate');
    assert.ok(/googlevideo|gv\.example/.test(r.audioUrl), 'audio url minted for the candidate');
  });

  test('good watch title still wins when oembed is unavailable', async () => {
    const mod = await freshCore();
    const routed = async (u, o) => {
      const s = String(u);
      if (s.includes('/oembed')) throw new TypeError('oembed down');
      if (s.includes('/watch')) return watchResponseGood();
      if (s.includes('/search')) return { ok: true, status: 200, json: async () => SEARCH };
      if (s.includes('/player')) return playerOk('UNUSED');
      throw new TypeError('unexpected ' + s);
    };
    const r = await mod.extractWithDoublePivot(ORIG, { fetchImpl: routed, timeoutMs: 4000, prioritizeDouble: true });
    assert.ok(r && r.doubled === true, 'pivoted');
  });
});

describe('OR3 artist-aware ranking', () => {
  test('artistName strongly prefers the matching-artist candidate', async () => {
    const mod = await freshCore();
    const cands = await mod.searchStandardDouble('q', { fetchImpl: async () => ({ ok: true, status: 200, json: async () => SEARCH }) });
    const pick = mod.pickDoubleCandidate(cands, ORIG, 211, 'Charlie Puth');
    assert.ok(pick, 'a candidate picked');
    assert.match(pick.videoId, /^CP/, `picked a Charlie Puth track, got ${pick.videoId}`);
  });

  test('without artistName legacy ranking is unchanged (lyric still top)', async () => {
    const mod = await freshCore();
    const cands = await mod.searchStandardDouble('q', { fetchImpl: async () => ({ ok: true, status: 200, json: async () => SEARCH }) });
    const pick = mod.pickDoubleCandidate(cands, ORIG, 211);
    assert.ok(pick, 'a candidate picked');
  });
});

describe('OR4 multi-candidate mint', () => {
  test('pivot tries candidates until one mints (first candidate fails)', async () => {
    const mod = await freshCore();
    const deadFirst = new Set(['NEWJEANS']);
    const blocked = new Set([ORIG]);
    const routed = async (u, o) => {
      const s = String(u);
      if (s.includes('/oembed')) return oembedResponse();
      if (s.includes('/watch')) return watchResponseGood();
      if (s.includes('/search')) return { ok: true, status: 200, json: async () => SEARCH };
      if (s.includes('/player')) {
        let videoId = 'x';
        try { videoId = JSON.parse(o.body || '{}').videoId || 'x'; } catch {}
        if (deadFirst.has(videoId) || blocked.has(videoId)) {
          return { ok: true, status: 200, json: async () => ({ playabilityStatus: { status: 'LOGIN_REQUIRED' }, videoDetails: {}, streamingData: {} }) };
        }
        return playerOk(videoId);
      }
      throw new TypeError('unexpected ' + s);
    };
    const r = await mod.extractWithDoublePivot(ORIG, { fetchImpl: routed, timeoutMs: 5000 });
    assert.ok(r && r.doubled === true, 'pivoted after first candidate failed');
    assert.ok(r.viaVideoId && r.viaVideoId !== 'NEWJEANS', 'resolved via a later candidate');
  });
});