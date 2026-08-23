// GUARDIAN TDD ENFORCER — /stream frontend wiring (freebuff-task-20260823-streamwire)
// The local node now relays googlevideo bytes via GET /stream?url=... (no ACAO upstream),
// but the PWA still hands the browser the RAW googlevideo audioUrl -> CORS-dead.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const localNodeTs = path.join(root, 'src', 'services', 'localNode.ts');
const extractorTs = path.join(root, 'src', 'services', 'extractor.ts');

async function esbuildBundle(entryPoint, extraFiles = {}) {
  const { build } = await import(url.pathToFileURL(path.join(root, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-streamwire-'));
  for (const [name, content] of Object.entries(extraFiles)) {
    fs.writeFileSync(path.join(tmpDir, name), content);
  }
  const stubPlugin = {
    name: 'stub-resolvers',
    setup(b) {
      b.onResolve({ filter: /^\.\/resolvers$/ }, () => ({
        path: path.join(tmpDir, 'resolvers-stub.mjs'),
      }));
    },
  };
  const outFile = path.join(tmpDir, path.basename(entryPoint).replace(/\.ts$/, '.test-build.mjs'));
  await build({
    entryPoints: [entryPoint],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    logLevel: 'silent',
    plugins: entryPoint.endsWith('extractor.ts') ? [stubPlugin] : [],
  });
  return import(url.pathToFileURL(outFile).href);
}

async function loadLocalNode() {
  if (!fs.existsSync(localNodeTs)) throw new Error('src/services/localNode.ts does not exist yet');
  return esbuildBundle(localNodeTs);
}

describe('W1 pure stream-url builder', () => {
  test('buildLocalStreamUrl wraps upstream url in localhost /stream relay', async () => {
    const mod = await loadLocalNode();
    if (typeof mod.buildLocalStreamUrl !== 'function') {
      throw new Error('export buildLocalStreamUrl(port, upstreamUrl) not implemented yet');
    }
    const gv = 'https://rr1---sn-a5mekned.googlevideo.com/videoplayback?expire=1&ip=1.2.3.4&sig=abc';
    const got = mod.buildLocalStreamUrl(8794, gv);
    assert.equal(got, 'http://127.0.0.1:8794/stream?url=' + encodeURIComponent(gv));
    const other = mod.buildLocalStreamUrl(8795, gv);
    assert.ok(other.startsWith('http://127.0.0.1:8795/stream?url='), 'port must be honored');
  });
});

describe('W2 resolveViaLocalNode is port-aware', () => {
  test('probes DEFAULT_PORTS and returns which port answered; explicit port still honored', async () => {
    const mod = await loadLocalNode();
    const realFetch = globalThis.fetch;
    try {
      // 8794 dead, 8795 alive with resolve payload
      globalThis.fetch = async (u) => {
        const s = String(u);
        if (s.includes(':8794/')) throw new TypeError('ECONNREFUSED');
        if (s.includes(':8795/vibecheck')) {
          return { ok: true, json: async () => ({ ok: true, name: 'vibecatch-local-node', version: '1.0.0' }) };
        }
        if (s.includes(':8795/resolve?videoId=')) {
          return { ok: true, json: async () => ({ audioUrl: 'https://gv/videoplayback?x=1', title: 'T', artist: 'A', duration: 9 }) };
        }
        throw new TypeError('unexpected ' + s);
      };
      const hit = await mod.resolveViaLocalNode('abc12345678');
      assert.ok(hit, 'must resolve via 8795');
      assert.equal(hit.port, 8795, 'result must carry the answering port');

      // explicit port opt bypasses probing
      let probed = false;
      globalThis.fetch = async (u) => {
        const s = String(u);
        if (s.includes('/vibecheck')) { probed = true; throw new TypeError('should not probe'); }
        if (s.includes(':8794/resolve?videoId=')) {
          return { ok: true, json: async () => ({ audioUrl: 'https://gv/x', title: '', artist: '', duration: 0 }) };
        }
        throw new TypeError('unexpected ' + s);
      };
      const hit2 = await mod.resolveViaLocalNode('abc12345678', { port: 8794 });
      assert.ok(hit2 && hit2.port === 8794, 'explicit port honored');
      assert.equal(probed, false, 'explicit port must skip probe');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('W3 extractor routes local-node audio through /stream relay', () => {
  test('track.streamUrl is the localhost /stream url, never raw googlevideo', async () => {
    if (!fs.existsSync(extractorTs)) throw new Error('src/services/extractor.ts missing');
    const resolversStub = `
      export async function raceYouTubeResolvers() {
        return { audioUrl: 'https://piped-fallback.example/x', title: 'FB', artist: 'P', duration: 5, source: 'piped-test' };
      }
    `;
    const mod = await esbuildBundle(extractorTs, { 'resolvers-stub.mjs': resolversStub });
    const realFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (u) => {
        const s = String(u);
        if (s.includes(':8794/resolve?videoId=')) {
          return {
            ok: true,
            json: async () => ({
              audioUrl: 'https://rr1---gv.googlevideo.com/videoplayback?id=o-X&itag=140',
              title: 'Real Song',
              artist: 'Real Artist - Topic',
              duration: 212,
            }),
          };
        }
        throw new TypeError('unexpected fetch ' + s);
      };
      const res = await mod.extractMedia('https://music.youtube.com/watch?v=4_zr_97R5mw');
      assert.ok(res.success, 'extraction must succeed via local node');
      assert.equal(res.track.id, 'yt_4_zr_97R5mw');
      assert.match(String(res.track.streamUrl), /^http:\/\/127\.0\.0\.1:8794\/stream\?url=/, 'audio must route through the local node /stream relay');
      assert.ok(
        String(res.track.streamUrl).includes(encodeURIComponent('https://rr1---gv.googlevideo.com/videoplayback')),
        'relay must carry the encoded upstream url'
      );

      // local node absent -> public race fallback keeps its own raw url
      globalThis.fetch = async () => { throw new TypeError('ECONNREFUSED'); };
      const res2 = await mod.extractMedia('https://music.youtube.com/watch?v=4_zr_97R5mw');
      assert.ok(res2.success, 'fallback race must still succeed');
      assert.equal(res2.track.streamUrl, 'https://piped-fallback.example/x', 'non-local path unchanged (no fake relay)');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
