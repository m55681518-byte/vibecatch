#!/usr/bin/env node
// VibeCatch Local Node — Phase 1: dependency-free localhost YouTube resolver
// Node >=18, zero npm dependencies (builtins only).
// Importing MUST NOT start the server; server starts only when executed directly.

import http from 'node:http';
import { URL } from 'node:url';

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
// startServer — HTTP server on 127.0.0.1 only
// ---------------------------------------------------------------------------

export function startServer(port) {
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
