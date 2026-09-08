// VibeCatch Cloudflare Worker — thin signer entry point
// deploy: wrangler deploy worker/cf-signer-worker.mjs
//
// Routes:
//   OPTIONS                                -> 204 + CORS
//   /vibecheck                             -> {ok:true,name:'vibecatch-cf-signer',version}
//   /resolve?videoId=<id>                  -> {videoId,audioUrl,title,artist,duration} + CORS
//   /stream?url=<encoded-upstream>         -> byte proxy of the upstream (audio) + CORS
//   anything else / non-GET                -> 404/405
//
// The PWA fetches /resolve, then streams audioUrl directly to the device via
// plain <audio> (no CORS on the googlevideo bytes — Turn A handles that).
// /stream is the CORS-safe FULL-BYTE download relay: the browser byte-download
// fetches <signer>/stream?url=<signed-googlevideo> and the worker proxies the
// bytes with Access-Control-Allow-Origin:* (the CDN sends no ACAO headers).

import { extractWithDoublePivot } from './cf-signer-core.mjs';

const NAME = 'vibecatch-cf-signer';
const VERSION = '1.0.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

const YT_ID_RE = /^[A-Za-z0-9_-]{4,}$/;

export function validVideoId(id) {
  if (!id || typeof id !== 'string') return false;
  if (!YT_ID_RE.test(id)) return false;
  if (/^[A-Z]+$/.test(id)) return false; // all-caps = like/playlist/list id, not a video
  return true;
}

function json(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS, extraHeaders || {}),
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET') {
      return json({ error: 'only GET allowed' }, 405);
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/vibecheck') {
      return json({ ok: true, name: NAME, version: VERSION }, 200);
    }

    if (pathname === '/resolve') {
      const videoId = url.searchParams.get('videoId');
      if (!videoId || !validVideoId(videoId)) {
        return json({ error: 'invalid videoId' }, 400);
      }

      const timeoutMs =
        env && env.SIGNER_TIMEOUT_MS
          ? Number(env.SIGNER_TIMEOUT_MS) || 15000
          : 15000;

      const result = await extractWithDoublePivot(videoId, {
        timeoutMs,
        signal: request.signal,
      });

      if (!result) {
        return json({ error: 'all youtube clients failed for this video' }, 502);
      }

      return json({ videoId, ...result }, 200);
    }

    if (pathname === '/stream') {
      const upstreamParam = url.searchParams.get('url');
      if (!upstreamParam) {
        return json({ error: 'missing url parameter' }, 400);
      }
      let upstream;
      try {
        upstream = new URL(upstreamParam);
      } catch {
        return json({ error: 'invalid url' }, 400);
      }
      if (upstream.protocol !== 'http:' && upstream.protocol !== 'https:') {
        return json({ error: 'only http/https URLs allowed' }, 400);
      }

      const fwdHeaders = {};
      fwdHeaders['Range'] = request.headers.get('range') || 'bytes=0-';

      let upstreamResp;
      try {
        upstreamResp = await fetch(upstream.href, {
          headers: fwdHeaders,
          signal: request.signal,
        });
      } catch {
        return json({ error: 'upstream fetch failed' }, 502);
      }
      if (upstreamResp.status >= 400) {
        return json({ error: 'upstream failed: ' + upstreamResp.status }, 502);
      }

      const respHeaders = {
        'Content-Type': upstreamResp.headers.get('content-type') || 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="vibecatch-audio"',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      };
      const cl = upstreamResp.headers.get('content-length');
      if (cl) respHeaders['Content-Length'] = cl;
      const cr = upstreamResp.headers.get('content-range');
      if (cr) respHeaders['Content-Range'] = cr;
      const ar = upstreamResp.headers.get('accept-ranges');
      if (ar) respHeaders['Accept-Ranges'] = ar;

      return new Response(upstreamResp.body, {
        status: upstreamResp.status,
        headers: respHeaders,
      });
    }

    return json({ error: 'not found' }, 404);
  },
};
