// GUARDIAN TDD ENFORCER — strict-track fallback to native app (freebuff-task-20260830-apk-fallback)
// When the Cloudflare signer returns HTTP 502 { error: "all youtube clients failed for this video" }
// (a high-security / client-gated track), the web extractor must NOT show the generic
// "all free audio resolvers are busy" dead end. It must surface a silent, specific signal
// to the UI: ExtractionResult.requiresNativeApp === true + copy pointing at the native
// Android app APK (hosted on the same GitHub Pages repo).
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `vc-strict-${tag}-`));
  const outFile = path.join(tmpDir, `${tag}.mjs`);
  await build({ entryPoints: [entry], outfile: outFile, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
  return await import(url.pathToFileURL(outFile).href);
}

const HARD_ID = 'ABcDeFgHiJk';

function providersFor(mod) {
  return mod.PROVIDERS_YT.map((p) => ({
    ...p,
    endpoint: p.endpoint.includes('{id}') ? p.endpoint.replace('{id}', HARD_ID) : p.endpoint,
  }));
}

const markerBody = { error: 'all youtube clients failed for this video' };

describe('S1 resolver race strict-track signal', () => {
  test('signer 502 + marker body -> strictTrackSignal true, resolved null', async () => {
    const mod = await loadBundled('src/services/resolvers.ts', 'resolvers');
    assert.equal(typeof mod.raceYouTubeResolversWithSignal, 'function', 'missing export raceYouTubeResolversWithSignal');
    const fakeFetch = async (u) => {
      if (String(u).includes('vibecatch-signer.pages.dev')) {
        return { ok: false, status: 502, json: async () => markerBody };
      }
      throw new TypeError('provider down');
    };
    const out = await mod.raceYouTubeResolversWithSignal(HARD_ID, {
      providers: providersFor(mod), timeoutMs: 400, fetchImpl: fakeFetch,
    });
    assert.equal(out.resolved, null, 'must not fabricate a stream');
    assert.equal(out.strictTrackSignal, true, 'must flag the strict-track 502');
  });

  test('signer 502 with a DIFFERENT body -> no false positive', async () => {
    const mod = await loadBundled('src/services/resolvers.ts', 'resolvers');
    const fakeFetch = async (u) => {
      if (String(u).includes('vibecatch-signer.pages.dev')) {
        return { ok: false, status: 502, json: async () => ({ error: 'internal server error' }) };
      }
      throw new TypeError('provider down');
    };
    const out = await mod.raceYouTubeResolversWithSignal(HARD_ID, {
      providers: providersFor(mod), timeoutMs: 400, fetchImpl: fakeFetch,
    });
    assert.equal(out.strictTrackSignal, false, 'only the exact marker body must signal');
    assert.equal(out.resolved, null);
  });

  test('strict marker on non-502 status -> signal stays false', async () => {
    const mod = await loadBundled('src/services/resolvers.ts', 'resolvers');
    const fakeFetch = async (u) => {
      if (String(u).includes('vibecatch-signer.pages.dev')) {
        return { ok: false, status: 503, json: async () => markerBody };
      }
      throw new TypeError('provider down');
    };
    const out = await mod.raceYouTubeResolversWithSignal(HARD_ID, {
      providers: providersFor(mod), timeoutMs: 400, fetchImpl: fakeFetch,
    });
    assert.equal(out.strictTrackSignal, false, 'signal requires HTTP 502');
  });

  test('still resolves normally when a later provider succeeds', async () => {
    const mod = await loadBundled('src/services/resolvers.ts', 'resolvers');
    const fakeFetch = async (u) => {
      if (String(u).includes('vibecatch-signer.pages.dev')) {
        return { ok: false, status: 502, json: async () => markerBody };
      }
      if (String(u).includes('cobalt')) {
        return { ok: true, status: 200, json: async () => ({ status: 'tunnel', url: 'https://tunnel.example/audio.m4a' }) };
      }
      throw new TypeError('provider down');
    };
    const out = await mod.raceYouTubeResolversWithSignal(HARD_ID, {
      providers: providersFor(mod), timeoutMs: 500, fetchImpl: fakeFetch,
    });
    assert.ok(out.resolved && out.resolved.audioUrl.includes('tunnel.example'), 'success path unchanged');
  });

  test('legacy raceYouTubeResolvers contract untouched', async () => {
    const mod = await loadBundled('src/services/resolvers.ts', 'resolvers');
    const fakeFetch = async () => { throw new TypeError('network dead'); };
    const out = await mod.raceYouTubeResolvers(HARD_ID, { providers: providersFor(mod), timeoutMs: 300, fetchImpl: fakeFetch });
    assert.equal(out, null, 'legacy API still returns bare ResolvedAudio|null');
  });
});

describe('S2 extractor failure result carries the strict-track flag', () => {
  test('buildAllProvidersFailedResult(true) -> requiresNativeApp + native-app copy', async () => {
    const ex = await loadBundled('src/services/extractor.ts', 'extractor');
    assert.equal(typeof ex.buildAllProvidersFailedResult, 'function', 'missing export buildAllProvidersFailedResult');
    const res = ex.buildAllProvidersFailedResult(true);
    assert.equal(res.success, false);
    assert.equal(res.requiresNativeApp, true, 'must flag requiresNativeApp on strict track');
    assert.match(res.error, /native Android app/, 'error must mention the native Android app');
    assert.match(res.error, /Download the APK here/i, 'error must contain the download callout');
  });

  test('buildAllProvidersFailedResult(false) -> generic busy message, no flag', async () => {
    const ex = await loadBundled('src/services/extractor.ts', 'extractor');
    const res = ex.buildAllProvidersFailedResult(false);
    assert.equal(res.success, false);
    assert.equal(res.requiresNativeApp, undefined, 'generic outage must NOT set the flag');
    assert.match(res.error, /busy or offline/i, 'keeps the existing honest busy message');
  });

  test('wiring: extractor.ts uses the signal API + types carry requiresNativeApp', async () => {
    const src = fs.readFileSync(path.join(root, 'src', 'services', 'extractor.ts'), 'utf8');
    assert.match(src, /raceYouTubeResolversWithSignal/, 'npm resolver failure path must ask the race for its signal');
    assert.match(src, /buildAllProvidersFailedResult/, 'failure branch must route through buildAllProvidersFailedResult');
    const types = fs.readFileSync(path.join(root, 'src', 'types', 'index.ts'), 'utf8');
    assert.match(types, /requiresNativeApp\??:\s*boolean/, 'ExtractionResult must type the requiresNativeApp flag');
  });
});

describe('S3 native-app card copy + APK URL', () => {
  test('androidSetup exports APK_DOWNLOAD_URL + buildStrictTrackError with exact copy', async () => {
    const a = await loadBundled('src/services/androidSetup.ts', 'apksetup');
    assert.equal(typeof a.APK_DOWNLOAD_URL, 'string', 'missing export APK_DOWNLOAD_URL');
    assert.match(a.APK_DOWNLOAD_URL, /^https:\/\/m55681518-byte\.github\.io\/vibecatch\/vibecatch\.apk$/, 'APK hosted on the same GitHub Pages repo');
    assert.equal(typeof a.buildStrictTrackError, 'function', 'missing export buildStrictTrackError');
    const msg = a.buildStrictTrackError();
    assert.match(msg, /This high-security track requires our native Android app to extract/, 'exact user-facing sentence');
    assert.match(msg, /Download the APK here/i, 'callout present');
    assert.ok(msg.includes(a.APK_DOWNLOAD_URL), 'message must embed the APK URL');
  });

  test('DiscoverTab renders the native-app card when the flag is set', async () => {
    const disc = fs.readFileSync(path.join(root, 'src', 'components', 'DiscoverTab.tsx'), 'utf8');
    assert.match(disc, /requiresNativeApp/, 'DiscoverTab must branch on the extraction flag');
    assert.match(disc, /buildStrictTrackError/, 'DiscoverTab must use the shared APK copy helper');
    assert.match(disc, /This high-security track requires our native Android app to extract/, 'sentence present in the component');
    assert.match(disc, /APK_DOWNLOAD_URL/, 'DiscoverTab must reference the APK download URL');
  });
});