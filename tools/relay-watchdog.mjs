// relay-watchdog.mjs — auto-healing relay pool controller for the vibecatch PWA.
//
// Context: the PWA's relay pool (public/workers.json → gh-pages) is served by two
// local quick tunnels (cloudflared trycloudflare.com) in front of a node relay
// (:8794) and a worker relay (:8795). Quick-tunnel URLs rotate/die without notice,
// so a stale pool silently breaks every phone download.
//
// This daemon closes the loop:
//   1. probe each relay's REMOTE /vibecheck (the URL the pool advertises) AND its
//      LOCAL /vibecheck (the service on 127.0.0.1:<port>) every poll interval.
//   2. classify per role: healthy / respawn-tunnel (remote dead, local alive) /
//      respawn-service (local+remote dead) — decisions are pure + unit-tested.
//   3. act: kill+recreate the dead quick tunnel (or restart the local service),
//      await the fresh URL from the tunnel log.
//   4. when any URL changes: rewrite public/workers.json, keep dist/workers.json
//      in sync, commit on main, then snapshot dist/ into the gh-pages deploy
//      clone and force the redeploy so the PWA sees the new pool.
//
// Pure, testable logic is exported; daemon side-effects only run when executed
// directly (guarded). Zero dependencies (node built-ins only).
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { spawnSync } from 'node:child_process';

export const CONFIG = {
  repoRoot: 'C:\\Users\\Mike-\\Documents\\new-vibemusic',
  toolsDir: 'C:\\Users\\Mike-\\Documents\\vibecatch-tools',
  pagesDir: 'C:\\Users\\Mike-\\Documents\\vibecatch-pages',
  roles: {
    node: {
      port: 8794,
      tunnelLog: 'tunnel.out.log',
      tunnelStart: 'tunnel-start.cmd',
      serviceStart: 'lnode-start.cmd',
    },
    worker: {
      port: 8795,
      tunnelLog: 'tunnel-worker.out.log',
      tunnelStart: 'tunnel-worker-start.cmd',
      serviceStart: 'worker-start.cmd',
    },
  },
  probeTimeoutMs: 12000,
  pollIntervalMs: 105000,
  failureThreshold: 2,
  tunnelAwaitMs: 45000,
  logFile: 'C:\\Users\\Mike-\\Documents\\vibecatch-tools\\relay-watchdog.log',
  pidFile: 'C:\\Users\\Mike-\\Documents\\vibecatch-tools\\relay-watchdog.pid',
};

// ---------------------------------------------------------------- pure logic

export function extractTunnelUrl(line) {
  if (typeof line !== 'string') return null;
  const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  return m ? m[0] : null;
}

export function probeHealthy(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.status !== 200) return false;
  if (payload.ok !== true) return false;
  if (typeof payload.name !== 'string' || !/vibecatch/.test(payload.name)) return false;
  return true;
}

export function buildPool(relays) {
  return relays.map((r) => `${r.url}/vibecheck`);
}

export function poolUnchanged(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export function classifyRole({ url, localOk, remoteOk, failures }) {
  if (!url) return 'respawn-tunnel';
  if (remoteOk && localOk) return 'none';
  if (!localOk && !remoteOk) return 'respawn-service';
  if (remoteOk && !localOk) return 'respawn-service';
  if (!remoteOk && localOk) return failures >= CONFIG.failureThreshold ? 'respawn-tunnel' : 'none';
  return 'none';
}

export function saveState(file, snap) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(snap, null, 2));
}

export function loadState(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function validRelayUrl(u) {
  if (typeof u !== 'string') return false;
  if (!/^https:\/\//.test(u)) return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' && parsed.hostname.length > 0 && parsed.hostname.includes('.');
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ files/platform

function log(msg) {
  try {
    const line = `${new Date().toISOString()} ${msg}`;
    fs.appendFileSync(CONFIG.logFile, line + '\n');
    process.stdout.write(line + '\n');
  } catch {
    /* never let logging kill the loop */
  }
}

function readLastTunnelUrl(toolsDir, logName) {
  const p = path.join(toolsDir, logName);
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, 'utf8');
  const lines = text.split('\n').reverse();
  for (const line of lines) {
    const u = extractTunnelUrl(line);
    if (u) return u;
  }
  return null;
}

function readPoolFile(repoRoot) {
  const p = path.join(repoRoot, 'public', 'workers.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writePoolFile(repoRoot, pool) {
  fs.writeFileSync(path.join(repoRoot, 'public', 'workers.json'), JSON.stringify(pool, null, 2) + '\n');
  const distDir = path.join(repoRoot, 'dist');
  if (fs.existsSync(distDir)) {
    fs.writeFileSync(path.join(distDir, 'workers.json'), JSON.stringify(pool, null, 2) + '\n');
  }
}

async function probe(urlPath, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(urlPath, { signal: ctl.signal, cache: 'no-store' });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* body is not JSON */
    }
    return { ok: probeHealthy({ status: res.status, ...(body || {}) }), status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(t);
  }
}

function cloudflaredPidsForPort(port) {
  try {
    const ps = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.CommandLine -like '*127.0.0.1:${port}*' } | ForEach-Object { $_.ProcessId }`,
      ],
      { encoding: 'utf8', timeout: 20000 }
    );
    return String(ps.stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
      .map(Number);
  } catch {
    return [];
  }
}

function killPids(pids) {
  for (const pid of pids) {
    try {
      spawnSync('taskkill', ['/F', '/PID', String(pid)], { timeout: 10000 });
      log(`taskkill cloudflared PID ${pid}`);
    } catch {
      /* ignore */
    }
  }
}

function startHiddenCmd(dir, script) {
  try {
    spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Start-Process -WindowStyle Hidden cmd.exe -ArgumentList '/c','call','${script.replace(/'/g, "''")}' -WorkingDirectory '${dir.replace(/'/g, "''")}'`,
      ],
      { timeout: 15000, windowsHide: true }
    );
    log(`started hidden: ${script}`);
  } catch (e) {
    log(`failed to start ${script}: ${e.message}`);
  }
}

async function awaitTunnelUrl(toolsDir, logName, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const u = readLastTunnelUrl(toolsDir, logName);
    if (u) return u;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

// --------------------------------------------------------------------- steps

async function respawnTunnel(roleKey) {
  const cfg = CONFIG.roles[roleKey];
  log(`[${roleKey}] respawn-tunnel: killing cloudflared for :${cfg.port}`);
  const pids = cloudflaredPidsForPort(cfg.port);
  killPids(pids);
  const logPath = path.join(CONFIG.toolsDir, cfg.tunnelLog);
  if (fs.existsSync(logPath)) fs.rmSync(logPath, { force: true });
  startHiddenCmd(CONFIG.toolsDir, path.join(CONFIG.toolsDir, cfg.tunnelStart));
  const url = await awaitTunnelUrl(CONFIG.toolsDir, cfg.tunnelLog, CONFIG.tunnelAwaitMs);
  if (url) log(`[${roleKey}] new tunnel URL: ${url}`);
  else log(`[${roleKey}] no new URL within ${CONFIG.tunnelAwaitMs}ms`);
  return url;
}

function respawnService(roleKey) {
  const cfg = CONFIG.roles[roleKey];
  log(`[${roleKey}] respawn-service: restarting local :${cfg.port}`);
  startHiddenCmd(CONFIG.toolsDir, path.join(CONFIG.toolsDir, cfg.serviceStart));
}

export function gitCommand(repoDir, args) {
  // Fresh deploy clones have NO user.name/email configured (empty global on this box) —
  // every invocation must carry alliance identity via -c flags to commit/push reliably.
  return ['-C', repoDir, '-c', 'user.name=alliance', '-c', 'user.email=alliance@users.noreply.github.com', ...args];
}

function runGit(repoDir, args) {
  try {
    const r = spawnSync('git', gitCommand(repoDir, args), { encoding: 'utf8', timeout: 120000 });
    if (r.status !== 0) {
      log(`git ${args.join(' ')} exited ${r.status}: ${String(r.stderr || '').slice(0, 400)}`);
      return false;
    }
    return true;
  } catch (e) {
    log(`git ${args.join(' ')} failed: ${e.message}`);
    return false;
  }
}

function ensurePagesClone() {
  if (fs.existsSync(path.join(CONFIG.pagesDir, '.git'))) return true;
  log(`no deploy clone at ${CONFIG.pagesDir}; cloning gh-pages…`);
  const ok = runGit(CONFIG.repoRoot, ['clone', '-b', 'gh-pages', 'https://github.com/m55681518-byte/vibecatch.git', CONFIG.pagesDir]);
  return ok;
}

function syncDeploy(pool) {
  if (!ensurePagesClone()) {
    log('deploy clone unavailable — skipping gh-pages sync');
    return false;
  }
  const distDir = path.join(CONFIG.repoRoot, 'dist');
  if (!fs.existsSync(distDir)) {
    log('dist/ missing — running npm run build');
    const b = spawnSync('npm', ['run', 'build'], { cwd: CONFIG.repoRoot, encoding: 'utf8', timeout: 300000 });
    if (b.status !== 0) {
      log(`npm run build failed: ${String(b.stderr || '').slice(0, 400)}`);
      return false;
    }
  }
  // wipe deploy clone working tree, copy dist/ contents → repo root of clone
  const clear = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Get-ChildItem -Path '${CONFIG.pagesDir}' -Force | Where-Object { $_.Name -ne '.git' } | Remove-Item -Recurse -Force`,
    ],
    { timeout: 60000 }
  );
  if (clear.status !== 0) {
    log('failed to clear deploy clone');
    return false;
  }
  const copy = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Copy-Item -Path '${distDir}\\*' -Destination '${CONFIG.pagesDir}' -Recurse -Force`,
    ],
    { timeout: 120000 }
  );
  if (copy.status !== 0) {
    log('failed to copy dist into deploy clone');
    return false;
  }
  if (!runGit(CONFIG.pagesDir, ['add', '-A'])) return false;
  if (!runGit(CONFIG.pagesDir, ['commit', '-m', `deploy: pool -> ${pool.map((u) => new URL(u).host).join(' + ')}`])) return false;
  if (!runGit(CONFIG.pagesDir, ['push', 'origin', 'gh-pages'])) return false;
  log(`gh-pages deployed: ${JSON.stringify(pool)}`);
  return true;
}

function commitPoolMain(pool) {
  if (!runGit(CONFIG.repoRoot, ['add', 'public/workers.json'])) return false;
  if (!runGit(CONFIG.repoRoot, ['commit', '-m', `watchdog: pool -> ${pool.map((u) => new URL(u).host).join(' + ')}`])) return false;
  return runGit(CONFIG.repoRoot, ['push', 'origin', 'main']);
}

// ------------------------------------------------------------- daemon loop

export async function runWatchdogLoop(opts = {}) {
  const cfg = { ...CONFIG, ...opts };
  const stateFile = path.join(cfg.toolsDir, 'relay-watchdog-state.json');
  const roleState = loadState(stateFile) || { roles: {} };

  const pool = buildPool(
    ['node', 'worker'].map((k) => ({ role: k, url: readLastTunnelUrl(cfg.toolsDir, cfg.roles[k].tunnelLog) }))
  );
  const current = [];
  const changes = [];

  for (const key of ['node', 'worker']) {
    const c = cfg.roles[key];
    const url = readLastTunnelUrl(cfg.toolsDir, c.tunnelLog);
    const st = roleState.roles[key] || { failures: 0 };
    const local = await probe(`http://127.0.0.1:${c.port}/vibecheck`, cfg.probeTimeoutMs);
    const remote = url ? await probe(`${url}/vibecheck`, cfg.probeTimeoutMs) : { ok: false };
    const action = classifyRole({ url, localOk: local.ok, remoteOk: remote.ok, failures: st.failures });
    log(
      `[${key}] url=${url || 'none'} local=${local.status ? `${local.status}/${local.ok}` : 'down'} ` +
        `remote=${remote.status ? `${remote.status}/${remote.ok}` : 'down'} -> ${action}`
    );

    if (action === 'respawn-tunnel' || (action === 'none' && !url)) {
      const fresh = await respawnTunnel(key);
      st.failures = 0;
      st.url = fresh;
      if (!url || fresh !== url) changes.push(key);
    } else if (action === 'respawn-service') {
      respawnService(key);
      st.failures = 0;
    } else {
      st.failures = url && !remote.ok ? st.failures + 1 : 0;
      st.url = url;
    }
    roleState.roles[key] = st;
    if (url) current.push({ role: key, url });
  }

  saveState(stateFile, roleState);

  const newPool = buildPool(current.filter((r) => r.url));
  if (changes.length > 0 || !poolUnchanged(newPool, readPoolFile(cfg.repoRoot))) {
    if (newPool.length >= 2) {
      writePoolFile(cfg.repoRoot, newPool);
      commitPoolMain(newPool);
      syncDeploy(newPool);
    } else {
      log(`pool under-qualified (${newPool.length}) — waiting for second relay before deploying`);
    }
  } else {
    log('pool unchanged — no deploy');
  }
  return { pool: newPool, changes };
}

export async function main() {
  log('=== relay-watchdog daemon start ===');
  try {
    fs.writeFileSync(CONFIG.pidFile, String(process.pid));
  } catch {
    /* ignore */
  }
  const run = async () => {
    try {
      await runWatchdogLoop();
    } catch (e) {
      log(`loop error: ${e && e.stack ? e.stack : String(e)}`);
    }
    setTimeout(run, CONFIG.pollIntervalMs);
  };
  await run();
}

// execute-only-when-directly-run guard (matches vibecatch-node.mjs convention)
if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  main();
}