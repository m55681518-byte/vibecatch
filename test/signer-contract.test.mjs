// GUARDIAN TDD ENFORCER — signer contract (freebuff-task-20260908-signer-contract)
// RED-first gate for two production bugs found when a user pasted a live
// music.youtube.com link (D9_ECmovL0g, "Sem Tempo (Ultra Slowed)"):
//
//  Bug A (happy path totally broken): the CF worker /resolve returns
//    { videoId, audioUrl, title, artist, duration } — there is NO `ok: true`
//    field. But src/services/resolvers.ts `normalizeSignerResponse` requires
//    `json.ok === true`, so the app ALWAYS rejects the signer's own successful
//    resolution -> falls to dead fallback providers -> generic red banner on
//    every track (not just strict ones).
//
//  Bug B (strict-track card never shown): the worker burns up to its 15s
//    budget minting a strict video, then returns 502 {error:"all youtube
//    clients failed"} at ~16s. The app race default timeout is 6s, so the
//    signer fetch is aborted before the marker body is read -> strictTrackSignal
//    stays false -> generic red banner instead of the native-APK card.
//
// Pure logic only — fetch stubbed, zero network.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const esbuildUri = url.pathToFileURL(path.join(root, 'node_modules', 'esbuild', 'lib', 'main.js')).href;

async function loadBundled(entryRel, tag) {
  const entry = path.join(root, entryRel);
  if (!fs.existsSync(entry)) throw new Error(`${entryRel} does not exist yet`);
  const { build } = await import(esbuildUri);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `vc-sigcontract-${tag}-`));
  const outFile = path.join(tmpDir, `${tag}.mjs`);
  await build({ entryPoints: [entry], outfile: outFile, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
  return await import(url.pathToFileURL(outFile).href);
}

const HARD_ID = 'ABcDeFgHiJk';
const markerBody = { error: 'all youtube clients failed for this video' };
// EXACT live worker success payload (observed from vibecatch-signer.pages.dev)
const workerOkBody = {
  videoId: HARD_ID,
  audioUrl: 'https://rr3---sn-5hne6nzy.googlevideo.com/videoplayback?expire=0&googlevideo.com',
  title: 'Sem Tempo (Ultra Slowed)',
  artist: 'SCARIONIX',
  duration: 133,
};

function providersFor(mod) {
  return mod.PROVIDERS_YT.map((p) => ({
    ...p,
    endpoint: p.endpoint.includes('{id}') ? p.endpoint.replace('{id}', HARD_ID) : p.endpoint,
  }));
}

describe('SIG1 normalizeSignerResponse accepts the LIVE worker shape (Bug A)', () => {
  test('payload WITHOUT ok:true (real worker response) must normalize', async () => {
    const mod = await loadBundled('src/services/resolvers.ts', 'resolvers');
    assert.equal(typeof mod.normalizeSignerResponse, 'function', 'missing export normalizeSignerResponse');
    const out = mod.normalizeSignerResponse(workerOkBody);
    assert.ok(out, 'worker-shaped {videoId,audioUrl,...} must NOT be rejected');
    assert.equal(out.audioUrl, workerOkBody.audioUrl, 'audioUrl preserved');
    assert.equal(out.source, 'signer', 'source tagged signer');
  });

  test('race resolves a 200 signer response WITHOUT ok:true (real happy path)', async () => {
    const mod = await loadBundled('src/services/resolvers.ts', 'resolvers');
    const fakeFetch = async (u) => {
      if (String(u).includes('vibecatch-signer.pages.dev')) {
        return { ok: true, status: 200, json: async () => workerOkBody };
      }
      throw new TypeError('other providers down');
    };
    const out = await mod.raceYouTubeResolversWithSignal(HARD_ID, {
      providers: providersFor(mod), timeoutMs: 500, fetchImpl: fakeFetch,
    });
    assert.ok(out.resolved, 'signer success path must resolve (Bug A fixed)');
    assert.equal(out.strictTrackSignal, false, 'no strict flag on success');
  });

  test('documents: worker payload must not include a garbage `ok:false`', async () => {
    const mod = await loadBundled('src/services/resolvers.ts', 'resolvers');
    const out = mod.normalizeSignerResponse({ ...workerOkBody, ok: false });
    assert.ok(out, 'ok:false on an otherwise valid payload is a legacy quirk — still accept');
  });
});

describe('SIG2 strict 502 marker read even beyond the base race timeout (Bug B)', () => {
  test('signer 502 marker arrives AFTER base timeout but within extended signer window -> strictTrackSignal true', async () => {
    const mod = await loadBundled('src/services/resolvers.ts', 'resolvers');
    let signerCalls = 0;
    const fakeFetch = async (u) => {
      if (String(u).includes('vibecatch-signer.pages.dev')) {
        signerCalls++;
        await new Promise((r) => setTimeout(r, 180)); // slower than base timeoutMs=80
        return { ok: false, status: 502, json: async () => markerBody };
      }
      throw new TypeError('provider down');
    };
    const out = await mod.raceYouTubeResolversWithSignal(HARD_ID, {
      providers: providersFor(mod), timeoutMs: 80, fetchImpl: fakeFetch,
    });
    assert.equal(out.resolved, null);
    assert.equal(out.strictTrackSignal, true, 'slow strict-502 must still be read as strict (Bug B fixed)');
    assert.equal(signerCalls, 1, 'signer queried exactly once');
  });

  test('fast strict-502 still signals (no regression)', async () => {
    const mod = await loadBundled('src/services/resolvers.ts', 'resolvers');
    const fakeFetch = async (u) => {
      if (String(u).includes('vibecatch-signer.pages.dev')) {
        return { ok: false, status: 502, json: async () => markerBody };
      }
      throw new TypeError('provider down');
    };
    const out = await mod.raceYouTubeResolversWithSignal(HARD_ID, {
      providers: providersFor(mod), timeoutMs: 400, fetchImpl: fakeFetch,
    });
    assert.equal(out.strictTrackSignal, true);
    assert.equal(out.resolved, null);
  });

  test('signer unreachable -> no false strict flag, still resolves cable provider', async () => {
    const mod = await loadBundled('src/services/resolvers.ts', 'resolvers');
    const fakeFetch = async (u) => {
      if (String(u).includes('cobalt')) {
        return { ok: true, status: 200, json: async () => ({ status: 'tunnel', url: 'https://tunnel.example/audio.m4a' }) };
      }
      throw new TypeError('signer + others down');
    };
    const out = await mod.raceYouTubeResolversWithSignal(HARD_ID, {
      providers: providersFor(mod), timeoutMs: 500, fetchImpl: fakeFetch,
    });
    assert.ok(out.resolved, 'cobalt rescue path intact');
    assert.equal(out.strictTrackSignal, false);
  });
});