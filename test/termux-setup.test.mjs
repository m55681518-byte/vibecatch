// GUARDIAN TDD ENFORCER — Termux bootstrap (freebuff-task-20260824-termux, Turn A)
// Most users are on phones. Android users must be able to turn THEIR phone into
// the local node via Termux with one copy-paste command. The installer ships as a
// static asset (public/termux-setup.sh) served by CF Pages at $0 — zero central
// compute, golden rule preserved: every device does its own extraction work.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(root, 'public', 'termux-setup.sh');

describe('T1 termux-setup.sh exists as static asset', () => {
  test('public/termux-setup.sh exists and is non-trivial', () => {
    assert.ok(fs.existsSync(scriptPath), 'public/termux-setup.sh missing');
    const size = fs.statSync(scriptPath).size;
    assert.ok(size > 500, `script too small (${size} bytes) to be a real installer`);
  });
});

describe('T2 script installs the right Termux-native stack', () => {
  const src = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
  test('installs nodejs LTS + ffmpeg via pkg (no sudo/apt)', () => {
    assert.match(src, /pkg\s+install[^|;]*nodejs-lts/, 'must pkg install nodejs-lts');
    assert.match(src, /pkg\s+install[^|;]*ffmpeg/, 'must pkg install ffmpeg');
    assert.doesNotMatch(src, /\bsudo\b/, 'Termux has no sudo');
    assert.doesNotMatch(src, /\bapt-get\b/, 'Termux has no apt-get');
  });
  test('installs yt-dlp via pip (ARM-safe), not an x86 binary download', () => {
    assert.match(src, /pip3?\s+install[^|;&]*yt-dlp/, 'must pip install yt-dlp');
    assert.doesNotMatch(src, /yt-dlp_linux(?!_)/, 'x86_64 binary will not run on ARM Android');
  });
  test('acquires wake-lock so Android doze does not kill downloads', () => {
    assert.match(src, /termux-wake-lock/, 'must acquire termux-wake-lock');
  });
});

describe('T3 script fetches and launches the real node', () => {
  const src = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
  test('downloads vibecatch-node.mjs from the Pages origin', () => {
    assert.match(
      src,
      /https:\/\/vibecatch\.pages\.dev\/vibecatch-node\.mjs/,
      'single source of truth: node script must come from the live site',
    );
  });
  test('launches detached (nohup/background) on default port 8794', () => {
    assert.match(src, /nohup\s+node[^\n]*&/, 'must launch in background so the shell returns');
    assert.match(src, /8794/, 'must use the port the PWA probes (DEFAULT_PORTS[0])');
  });
  test('verifies the running node via /vibecheck identity', () => {
    assert.match(src, /vibecheck/, 'must health-check after start');
  });
});

describe('T4 idempotent + re-runnable', () => {
  const src = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
  test('skips already-installed pieces (command -v / existence guards)', () => {
    assert.match(src, /command -v/, 'idempotency guard required');
    assert.match(src, /set -(e|euo pipefail)/, 'fail-fast mode required');
  });
  test('ships a start-node.sh so users can relaunch after reboot', () => {
    assert.match(src, /start-node\.sh/, 'reboot-relaunch helper required');
  });
});
