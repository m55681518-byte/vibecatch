// GUARDIAN TDD ENFORCER — Android setup card (freebuff-task-20260824-termux, Turn B)
// When an Android user without a running node hits the dead keyless resolvers,
// the app must show a concrete 2-minute fix (Termux one-liner) instead of a dead
// end. Pure helpers live in src/services/androidSetup.ts; wiring lands in the
// extractor failure path + DiscoverTab.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const modulePath = path.join(root, 'src', 'services', 'androidSetup.ts');

let cachedMod;
async function loadAndroidSetup() {
  if (!fs.existsSync(modulePath)) throw new Error('src/services/androidSetup.ts does not exist yet');
  if (cachedMod) return cachedMod;
  const { build } = await import(url.pathToFileURL(path.join(root, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-android-test-'));
  const outFile = path.join(tmpDir, 'androidSetup.test-build.mjs');
  await build({ entryPoints: [modulePath], outfile: outFile, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
  cachedMod = await import(url.pathToFileURL(outFile).href);
  return cachedMod;
}

describe('A1 androidSetup pure helpers', () => {
  test('isAndroidDevice detects Android UAs only', async () => {
    const m = await loadAndroidSetup();
    assert.equal(typeof m.isAndroidDevice, 'function', 'missing export isAndroidDevice');
    assert.equal(m.isAndroidDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126'), true, 'Pixel UA');
    assert.equal(m.isAndroidDevice('Mozilla/5.0 (Linux; Android 10; SM-G975F) Mobile Safari'), true, 'Samsung UA');
    assert.equal(m.isAndroidDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), false, 'iPhone is not Android');
    assert.equal(m.isAndroidDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), false, 'desktop');
    assert.equal(m.isAndroidDevice(''), false, 'empty UA');
  });

  test('buildSetupCommand returns the copy-paste one-liner pointing at Pages', async () => {
    const m = await loadAndroidSetup();
    assert.equal(typeof m.buildSetupCommand, 'function', 'missing export buildSetupCommand');
    const cmd = m.buildSetupCommand();
    assert.match(cmd, /curl/, 'must use curl');
    assert.match(cmd, /https:\/\/vibecatch\.pages\.dev\/termux-setup\.sh/, 'must point at the static installer');
    assert.match(cmd, /bash/, 'must execute via bash');
    assert.equal(m.buildSetupCommand(), cmd, 'stable output (no randomness)');
  });

  test('shouldShowSetupCard truth table', async () => {
    const m = await loadAndroidSetup();
    assert.equal(typeof m.shouldShowSetupCard, 'function', 'missing export shouldShowSetupCard');
    assert.equal(m.shouldShowSetupCard({ android: true, nodeReachable: false }), true, 'android, no node -> show');
    assert.equal(m.shouldShowSetupCard({ android: true, nodeReachable: true }), false, 'android, node live -> hide');
    assert.equal(m.shouldShowSetupCard({ android: false, nodeReachable: false }), false, 'desktop, no node -> hide');
    assert.equal(m.shouldShowSetupCard({ android: false, nodeReachable: true }), false, 'desktop, node live -> hide');
  });
});

describe('A2 failure-path wiring shows the card instead of a dead end', () => {
  test('extractor failure message stays honest and DiscoverTab renders setup card on android', () => {
    const exPath = path.join(root, 'src', 'services', 'extractor.ts');
    const discPath = path.join(root, 'src', 'components', 'DiscoverTab.tsx');
    for (const p of [exPath, discPath]) assert.ok(fs.existsSync(p), `${p} missing`);
    const disc = fs.readFileSync(discPath, 'utf8');
    assert.match(disc, /androidSetup|shouldShowSetupCard|TermuxNodeCard|SetupCard/i,
      'DiscoverTab must reference the android setup card module/component');
    assert.match(disc, /probeLocalNode/,
      'DiscoverTab must probe the local node before deciding to show the card');
  });
});
