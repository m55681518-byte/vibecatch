// GUARDIAN TDD ENFORCER — Phase 1 Local Node (freebuff-task-20260823-localnode)
// Part 1: vibecatch-node.mjs (dependency-free localhost resolver).
// Plain .mjs — imported directly. Importing MUST NOT start the server (main guard).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const nodeScriptPath = path.join(root, 'vibecatch-node.mjs');

const mod = fs.existsSync(nodeScriptPath) ? await import('file://' + nodeScriptPath.split(path.sep).join('/')) : {};

describe('N1 node script exists + contract exports', () => {
  test('vibecatch-node.mjs exists and exports pure helpers', () => {
    if (!fs.existsSync(nodeScriptPath)) throw new Error('vibecatch-node.mjs does not exist yet');
    for (const fn of ['PICK_CLIENTS', 'pickBestAudioFormat', 'normalizeClientResponse', 'corsHeaders']) {
      assert.notEqual(mod[fn], undefined, `missing export: ${fn}`);
    }
    assert.ok(Array.isArray(mod.PICK_CLIENTS) && mod.PICK_CLIENTS.length >= 3,
      'must race at least 3 InnerTube clients');
    // importing must not have started a listener
    assert.equal(typeof mod.startServer, 'function', 'startServer should be exported and main-guarded');
  });
});

describe('N2 audio format selection', () => {
  test('picks highest-bitrate AUDIO-only stream, ignores video + ciphered', () => {
    if (!mod.pickBestAudioFormat) throw new Error('pickBestAudioFormat not implemented yet');
    const out = mod.pickBestAudioFormat([
      { mimeType: 'video/mp4; codecs="avc1"', bitrate: 900000, url: 'https://v' },
      { mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 48000, url: 'https://lo' },
      { mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 160000, url: 'https://hi' },
      { mimeType: 'audio/webm; codecs="opus"', bitrate: 130000, url: 'https://mid' },
      { mimeType: 'audio/mp4', bitrate: 200000, signatureCipher: 's=obfuscated' },
    ]);
    assert.equal(out.url, 'https://hi', 'best READY audio url wins');
  });
  test('empty/unusable list -> null', () => {
    assert.equal(mod.pickBestAudioFormat([]), null);
    assert.equal(mod.pickBestAudioFormat(undefined), null);
    assert.equal(mod.pickBestAudioFormat([{ mimeType: 'video/mp4', bitrate: 1, url: 'x' }]), null);
  });
});

describe('N3 InnerTube response normalization', () => {
  test('OK status + adaptiveFormats -> resolved payload', () => {
    if (!mod.normalizeClientResponse) throw new Error('normalizeClientResponse not implemented yet');
    const out = mod.normalizeClientResponse({
      playabilityStatus: { status: 'OK' },
      videoDetails: { title: 'My Song', author: 'My Artist', lengthSeconds: '212' },
      streamingData: {
        adaptiveFormats: [
          { mimeType: 'audio/mp4', bitrate: 129000, url: 'https://gv/videoplayback?x=1' },
        ],
      },
    }, 'IOS');
    assert.ok(out && out.audioUrl === 'https://gv/videoplayback?x=1');
    assert.equal(out.title, 'My Song');
    assert.equal(out.artist, 'My Artist');
    assert.equal(out.duration, 212);
  });
  test('non-OK playability -> null with reason surfaced', () => {
    const out = mod.normalizeClientResponse({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in' } }, 'IOS');
    assert.equal(out, null);
  });
  test('signatureCipher-only (no plain urls) -> null (honest v1 limit)', () => {
    const out = mod.normalizeClientResponse({
      playabilityStatus: { status: 'OK' },
      streamingData: { adaptiveFormats: [{ mimeType: 'audio/mp4', bitrate: 1, signatureCipher: 's=x' }] },
    }, 'ANDROID');
    assert.equal(out, null);
  });
});

describe('N4 CORS + private network headers (browser PWA can call localhost)', () => {
  test('headers include ACAO:* and ACAPN:true', () => {
    if (!mod.corsHeaders) throw new Error('corsHeaders not implemented yet');
    const h = mod.corsHeaders();
    assert.match(h['Access-Control-Allow-Origin'], /\*/);
    assert.match(String(h['Access-Control-Allow-Private-Network']), /true/i);
    assert.ok(h['Content-Type'] || h['content-type']);
  });
});
