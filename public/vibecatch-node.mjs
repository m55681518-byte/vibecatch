#!/usr/bin/env node
// VibeCatch Local Node — Phase 1: dependency-free localhost YouTube resolver
// Node >=18, zero npm dependencies (builtins only).
// Importing MUST NOT start the server; server starts only when executed directly.

import http from 'node:http';
import { URL } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { access, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// PICK_CLIENTS — InnerTube client descriptors to race
// ---------------------------------------------------------------------------

export const PICK_CLIENTS = [
  {
    name: 'IOS',
    key: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc',
    endpoint: 'https://www.youtube.com/youtubei/v1/player',
    context: {
      client: {
        clientName: 'IOS',
        clientVersion: '20.10.4',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iPhone',
        osVersion: '18.3.2.22D82',
        hl: 'en',
        timeZone: 'UTC',
        utcOffsetMinutes: 0,
      },
    },
    headers: {
      'User-Agent': 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)',
      'X-Youtube-Client-Name': '5',
      'X-Youtube-Client-Version': '20.10.4',
      'Content-Type': 'application/json',
    },
  },
  {
    name: 'ANDROID',
    key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
    endpoint: 'https://www.youtube.com/youtubei/v1/player',
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '19.44.38',
        androidSdkVersion: 30,
        osName: 'Android',
        osVersion: '11',
        hl: 'en',
      },
    },
    headers: {
      'User-Agent': 'com.google.android.youtube/19.44.38 (Linux; U; Android 11) gzip',
      'X-Youtube-Client-Name': '3',
      'X-Youtube-Client-Version': '19.44.38',
      'Content-Type': 'application/json',
    },
  },
  {
    name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    endpoint: 'https://www.youtube.com/youtubei/v1/player',
    context: {
      client: {
        clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
        clientVersion: '2.0',
        hl: 'en',
      },
      thirdParty: {
        embedUrl: 'https://www.youtube.com/',
      },
    },
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Content-Type': 'application/json',
    },
  },
];

// ---------------------------------------------------------------------------
// pickBestAudioFormat — filter audio streams with plain url, highest bitrate
// ---------------------------------------------------------------------------

export function pickBestAudioFormat(streams) {
  if (!streams || !Array.isArray(streams) || streams.length === 0) return null;

  const audioWithUrl = streams.filter(
    (s) =>
      typeof s.mimeType === 'string' &&
      s.mimeType.startsWith('audio/') &&
      typeof s.url === 'string' &&
      s.url.length > 0,
  );

  if (audioWithUrl.length === 0) return null;

  audioWithUrl.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  return audioWithUrl[0];
}

// ---------------------------------------------------------------------------
// normalizeClientResponse — map InnerTube JSON to a resolved payload
// ---------------------------------------------------------------------------

export function normalizeClientResponse(json, clientName) {
  if (!json) return null;
  const ps = json.playabilityStatus;
  if (!ps || ps.status !== 'OK') return null;

  const vd = json.videoDetails;
  if (!vd) return null;

  const sd = json.streamingData;
  const formats = sd ? (sd.adaptiveFormats || sd.formats || []) : [];
  const best = pickBestAudioFormat(formats);
  if (!best) return null;

  return {
    audioUrl: best.url,
    title: vd.title || '',
    artist: vd.author || '',
    duration: Number(vd.lengthSeconds) || 0,
  };
}

// ---------------------------------------------------------------------------
// corsHeaders — CORS + Private Network headers for browser PWA access
// ---------------------------------------------------------------------------

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Private-Network': 'true',
    'Content-Type': 'application/json',
  };
}

// ---------------------------------------------------------------------------
// parseRangeHeader — parse Range header value
// ---------------------------------------------------------------------------

export function parseRangeHeader(h) {
  if (typeof h !== 'string') return null;
  const m = /^bytes=(\d+)-(\d*)$/.exec(h);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] === '' ? undefined : Number(m[2]);
  return { start, end };
}

// ---------------------------------------------------------------------------
// resolveCookiesPath — find Netscape cookies.txt (opts > env > tmp)
// ---------------------------------------------------------------------------

export function resolveCookiesPath(opts = {}) {
  // 1. Explicit override via opts.cookiesPath — verify file exists
  if (opts.cookiesPath) {
    try { fs.accessSync(opts.cookiesPath); return opts.cookiesPath; } catch {}
  }
  // 2. Environment variable
  if (process.env.VIBECATCH_YT_COOKIES) {
    try { fs.accessSync(process.env.VIBECATCH_YT_COOKIES); return process.env.VIBECATCH_YT_COOKIES; } catch {}
  }
  // 3. Tmp directory (standard location)
  const tmpPath = path.join(os.tmpdir(), 'vibecatch-ytdlp', 'cookies.txt');
  try { fs.accessSync(tmpPath); return tmpPath; } catch {}
  return null;
}

// ---------------------------------------------------------------------------
// resolveYtDlpPath — find yt-dlp binary (opts > env > vendor > tmp)
// ---------------------------------------------------------------------------

export function resolveYtDlpPath(opts = {}) {
  // 1. Explicit override via opts.ytdlpPath — verify file exists
  if (opts.ytdlpPath) {
    try { fs.accessSync(opts.ytdlpPath); return opts.ytdlpPath; } catch { return null; }
  }
  // 2. Environment variable (cache — stable per process)
  if (process.env.VIBECATCH_YTDLP_PATH) {
    if (resolveYtDlpPath._cached !== undefined) return resolveYtDlpPath._cached;
    resolveYtDlpPath._cached = process.env.VIBECATCH_YTDLP_PATH;
    return resolveYtDlpPath._cached;
  }
  // 3. Vendor directory in repo root
  try {
    const root = new URL('../', import.meta.url).pathname;
    const vendorName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    const vendorPath = path.join(root, 'vendor', vendorName);
    fs.accessSync(vendorPath);
    resolveYtDlpPath._cached = vendorPath;
    return vendorPath;
  } catch {}
  // 4. Tmp directory (pre-installed or auto-installed)
  const tmpDir = path.join(os.tmpdir(), 'vibecatch-ytdlp');
  const tmpName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const tmpPath = path.join(tmpDir, tmpName);
  try {
    fs.accessSync(tmpPath);
    resolveYtDlpPath._cached = tmpPath;
    return tmpPath;
  } catch {}
  return null;
}
resolveYtDlpPath._cached = undefined;
resolveYtDlpPath._installPromise = null;

// ---------------------------------------------------------------------------
// autoInstallYtDlp — one-time download into tmpdir
// ---------------------------------------------------------------------------

export function autoInstallYtDlp() {
  if (resolveYtDlpPath._installPromise) return resolveYtDlpPath._installPromise;
  resolveYtDlpPath._installPromise = (async () => {
    try {
      const tmpDir = path.join(os.tmpdir(), 'vibecatch-ytdlp');
      const isWin = process.platform === 'win32';
      const binName = isWin ? 'yt-dlp.exe' : 'yt-dlp';
      const finalPath = path.join(tmpDir, binName);
      // Check if already installed
      try { await access(finalPath); return finalPath; } catch {}
      const url = isWin
        ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
        : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
      const resp = await fetch(url, { redirect: 'follow' });
      if (!resp.ok) throw new Error('download failed: ' + resp.status);
      const buf = Buffer.from(await resp.arrayBuffer());
      try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
      const partPath = finalPath + '.part';
      await writeFile(partPath, buf);
      await rename(partPath, finalPath);
      return finalPath;
    } catch (e) {
      console.error('[vibecatch] yt-dlp auto-install failed:', e.message);
      return null;
    }
  })();
  return resolveYtDlpPath._installPromise;
}

// ---------------------------------------------------------------------------
// sanitizeFilename — strip illegal chars for Content-Disposition
// ---------------------------------------------------------------------------

export function sanitizeFilename(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '_').substring(0, 200);
}

// ---------------------------------------------------------------------------
// planWindows — contiguous bounded windows covering [start..endInclusive]
// ---------------------------------------------------------------------------

export function planWindows(start, endInclusive, limit = 1048576) {
  const windows = [];
  let s = start;
  while (s <= endInclusive) {
    const e = Math.min(s + limit - 1, endInclusive);
    windows.push([s, e]);
    s = e + 1;
  }
  return windows;
}

// ---------------------------------------------------------------------------
// startServer — HTTP server on 127.0.0.1 only
// ---------------------------------------------------------------------------

export function startServer(port, opts = {}) {
  let _ytdlpStatusCache = null;
  const gvHosts = opts.gvHosts || ['.googlevideo.com'];
  const GV_UA = 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)';
  const PRIME_WINDOW = 1024;
  const gvTotalCache = new Map();

  function isGvHost(hostname) {
    return gvHosts.some((h) => hostname === h || hostname.endsWith(h));
  }

  function cacheTotal(url, total) {
    if (gvTotalCache.size >= 50) {
      const firstKey = gvTotalCache.keys().next().value;
      gvTotalCache.delete(firstKey);
    }
    gvTotalCache.set(url, { total });
  }

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const pathname = urlObj.pathname;

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    // GET /vibecheck
    if (req.method === 'GET' && pathname === '/vibecheck') {
      res.writeHead(200, corsHeaders());
      res.end(JSON.stringify({ ok: true, name: 'vibecatch-local-node', version: '1.0.0', platform: process.platform }));
      return;
    }

    // GET /resolve?videoId=<id>
    if (req.method === 'GET' && pathname === '/resolve') {
      const videoId = urlObj.searchParams.get('videoId');
      if (!videoId) {
        res.writeHead(400, corsHeaders());
        res.end(JSON.stringify({ error: 'missing videoId parameter' }));
        return;
      }

      // Race all clients concurrently with Promise.any semantics
      const clientPromises = PICK_CLIENTS.map((client) => {
        return new Promise((resolve, reject) => {
          const controller = new AbortController();
          const timer = setTimeout(() => {
            controller.abort();
            reject(new Error(`${client.name} timed out`));
          }, 15000);

          const body = JSON.stringify({
            context: client.context,
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          });

          const endpointUrl = `${client.endpoint}?key=${client.key}&prettyPrint=false`;

          fetch(endpointUrl, {
            method: 'POST',
            headers: client.headers,
            body,
            signal: controller.signal,
          })
            .then(async (response) => {
              clearTimeout(timer);
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              const json = await response.json();
              const normalized = normalizeClientResponse(json, client.name);
              if (normalized) {
                resolve(normalized);
              } else {
                reject(new Error(`${client.name} returned unusable data`));
              }
            })
            .catch((err) => {
              clearTimeout(timer);
              reject(err);
            });
        });
      });

      try {
        const result = await Promise.any(clientPromises);
        res.writeHead(200, corsHeaders());
        res.end(JSON.stringify(result));
      } catch {
        res.writeHead(502, corsHeaders());
        res.end(JSON.stringify({ error: 'all youtube clients failed for this video' }));
      }
      return;
    }

    // GET /stream?url=<upstream-url> — byte-proxy
    if (req.method === 'GET' && pathname === '/stream') {
      const rawUrl = urlObj.searchParams.get('url');
      if (!rawUrl) {
        res.writeHead(400, corsHeaders());
        res.end(JSON.stringify({ error: 'missing url parameter' }));
        return;
      }
      let upstream;
      try {
        upstream = new URL(rawUrl);
      } catch {
        res.writeHead(400, corsHeaders());
        res.end(JSON.stringify({ error: 'invalid url' }));
        return;
      }
      if (upstream.protocol !== 'http:' && upstream.protocol !== 'https:') {
        res.writeHead(400, corsHeaders());
        res.end(JSON.stringify({ error: 'only http/https URLs allowed' }));
        return;
      }

      const gated = isGvHost(upstream.hostname);

      if (!gated) {
        // Simple passthrough for non-gated hosts
        const fwdHeaders = {};
        if (req.headers.range) fwdHeaders['Range'] = req.headers.range;
        try {
          const upstreamResp = await fetch(upstream.href, { headers: fwdHeaders });
          if (upstreamResp.status >= 400) {
            res.writeHead(502, corsHeaders());
            res.end(JSON.stringify({ error: 'upstream failed: ' + upstreamResp.status }));
            return;
          }
          const respHeaders = {
            'Content-Type': upstreamResp.headers.get('content-type') || 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="vibecatch-audio"',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Private-Network': 'true',
            'Access-Control-Allow-Methods': 'GET,OPTIONS',
            'Access-Control-Allow-Headers': '*',
          };
          const cl = upstreamResp.headers.get('content-length');
          if (cl) respHeaders['Content-Length'] = cl;
          const cr = upstreamResp.headers.get('content-range');
          if (cr) respHeaders['Content-Range'] = cr;
          const ar = upstreamResp.headers.get('accept-ranges');
          if (ar) respHeaders['Accept-Ranges'] = ar;
          res.writeHead(upstreamResp.status, respHeaders);
          try {
            for await (const chunk of upstreamResp.body) {
              res.write(chunk);
            }
            res.end();
          } catch {
            try { res.end(); } catch {}
          }
        } catch {
          res.writeHead(502, corsHeaders());
          res.end(JSON.stringify({ error: 'upstream fetch failed' }));
        }
        return;
      }

      // ---- GATED UPSTREAM — windowed relay with IOS UA ----
      const clientRange = parseRangeHeader(req.headers.range);

      // Step 1: Prime with bounded request to unlock URL and discover total size
      let total, primeBuf, contentType;
      try {
        const primeResp = await fetch(upstream.href, {
          headers: { 'user-agent': GV_UA, 'Range': `bytes=0-${PRIME_WINDOW - 1}` },
        });
        if (!primeResp.ok) {
          res.writeHead(502, corsHeaders());
          res.end(JSON.stringify({ error: 'upstream failed: ' + primeResp.status }));
          return;
        }
        const cr = primeResp.headers.get('content-range');
        const crMatch = /\/(\d+)$/.exec(cr || '');
        total = crMatch ? Number(crMatch[1]) : null;
        if (total === null) {
          res.writeHead(502, corsHeaders());
          res.end(JSON.stringify({ error: 'could not determine total size' }));
          return;
        }
        cacheTotal(upstream.href, total);
        const ab = await primeResp.arrayBuffer();
        primeBuf = Buffer.from(ab);
        contentType = primeResp.headers.get('content-type') || 'application/octet-stream';
      } catch {
        res.writeHead(502, corsHeaders());
        res.end(JSON.stringify({ error: 'upstream fetch failed' }));
        return;
      }

      // Step 2: Determine effective byte range to serve
      let effStart, effEnd;
      if (!clientRange) {
        effStart = 0;
        effEnd = total - 1;
      } else {
        effStart = clientRange.start;
        effEnd = clientRange.end === undefined ? total - 1 : Math.min(clientRange.end, total - 1);
      }

      // Step 3: Build client response headers
      const respHeaders = {
        'Content-Type': contentType,
        'Content-Disposition': 'attachment; filename="vibecatch-audio"',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Accept-Ranges': 'bytes',
      };

      if (clientRange) {
        respHeaders['Content-Range'] = `bytes ${effStart}-${effEnd}/${total}`;
        respHeaders['Content-Length'] = String(effEnd - effStart + 1);
        res.writeHead(206, respHeaders);
      } else {
        respHeaders['Content-Length'] = String(total);
        res.writeHead(200, respHeaders);
      }

      // Step 4: Stream data — prime overlap + windowed fetches
      try {
        if (effStart === 0) {
          const primeEnd = Math.min(PRIME_WINDOW - 1, effEnd);
          res.write(primeBuf.subarray(0, primeEnd + 1));
        }

        const fetchStart = effStart === 0 ? Math.min(PRIME_WINDOW, effEnd + 1) : effStart;
        if (fetchStart <= effEnd) {
          const windows = planWindows(fetchStart, effEnd, 1048576);
          for (const [ws, we] of windows) {
            const resp = await fetch(upstream.href, {
              headers: { 'user-agent': GV_UA, 'Range': `bytes=${ws}-${we}` },
            });
            if (!resp.ok) {
              res.destroy();
              return;
            }
            const ab = await resp.arrayBuffer();
            res.write(Buffer.from(ab));
          }
        }

        res.end();
      } catch {
        try { res.destroy(); } catch {}
      }

      return;
    }

    // GET /ytdlp-status
    if (req.method === 'GET' && pathname === '/ytdlp-status') {
      if (!_ytdlpStatusCache) {
        const p = resolveYtDlpPath(opts);
        _ytdlpStatusCache = { available: !!p, path: p };
      }
      const cookiesP = resolveCookiesPath(opts);
      res.writeHead(200, corsHeaders());
      res.end(JSON.stringify({ ok: true, available: _ytdlpStatusCache.available, path: _ytdlpStatusCache.path, installing: !!resolveYtDlpPath._installPromise && !_ytdlpStatusCache.available, cookiesAvailable: !!cookiesP }));
      return;
    }

    // GET /download?videoId=<id>[&title=&artist=]
    if (req.method === 'GET' && pathname === '/download') {
      const videoId = urlObj.searchParams.get('videoId');
      if (!videoId) {
        res.writeHead(400, corsHeaders());
        res.end(JSON.stringify({ error: 'missing videoId parameter' }));
        return;
      }
      const binary = resolveYtDlpPath(opts);
      if (!binary) {
        autoInstallYtDlp();
        res.writeHead(502, corsHeaders());
        res.end(JSON.stringify({ error: 'yt-dlp not available — auto-install failed or not yet completed' }));
        return;
      }
      const title = sanitizeFilename(urlObj.searchParams.get('title') || 'YouTube Audio');
      const filename = title + '.m4a';
      let child;
      let bytesSent = false;
      try {
        const spawnOpts = process.platform === 'win32' && /\.(cmd|bat)$/i.test(binary) ? { shell: true } : {};
        const cookiesPath = resolveCookiesPath(opts);
        const baseArgs = [
          '-f', 'bestaudio[ext=m4a]/bestaudio',
          '--no-playlist',
          '--quiet',
          '--no-warnings',
          '--no-part',
          '--newline',
          '-o', '-',
        ];
        if (cookiesPath) baseArgs.push('--cookies', cookiesPath);
        baseArgs.push('https://www.youtube.com/watch?v=' + videoId);
        child = spawn(binary, baseArgs, spawnOpts);
      } catch (e) {
        res.writeHead(502, corsHeaders());
        res.end(JSON.stringify({ error: 'failed to launch yt-dlp: ' + e.message }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'audio/mp4',
        'Content-Disposition': 'attachment; filename="' + filename + '"',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': '*',
      });
      child.stdout.on('data', (chunk) => {
        bytesSent = true;
        res.write(chunk);
      });
      child.on('close', (code) => {
        if (!bytesSent && code !== 0) {
          let stderrTail = '';
          if (child.stderr) {
            const s = child.stderr;
            stderrTail = typeof s === 'string' ? s.slice(-200) : '';
          }
          if (!res.headersSent) {
            res.writeHead(502, corsHeaders());
          }
          res.end(JSON.stringify({ error: 'yt-dlp exited with code ' + code + (stderrTail ? ': ' + stderrTail : '') }));
        } else {
          res.end();
        }
      });
      child.on('error', (e) => {
        if (!bytesSent) {
          if (!res.headersSent) {
            res.writeHead(502, corsHeaders());
          }
          res.end(JSON.stringify({ error: 'yt-dlp process error: ' + e.message }));
        } else {
          try { res.end(); } catch {}
        }
      });
      req.on('close', () => { if (child && !child.killed) child.kill(); });
      return;
    }

    // 404 for everything else
    res.writeHead(404, corsHeaders());
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[vibecatch-local-node] listening on http://127.0.0.1:${port}`);
  });

  return server;
}

// ---------------------------------------------------------------------------
// Main guard — server starts ONLY when executed directly
// ---------------------------------------------------------------------------

const _isDirectlyExecuted = (() => {
  if (process.env.VIBECATCH_NODE_SERVE === '1') return true;
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    const scriptPathname = new URL(import.meta.url).pathname;
    // Normalize backslashes for cross-platform comparison
    const normArg = argv1.replace(/\\/g, '/');
    const normScript = scriptPathname.replace(/\\/g, '/');
    return normArg === normScript || normArg.endsWith(normScript) || normScript.endsWith(normArg);
  } catch {
    return false;
  }
})();

if (_isDirectlyExecuted) {
  const port = Number(process.env.VIBECATCH_NODE_PORT) || 8794;
  startServer(port);
}
