// Local Node — browser-side detection and resolver
// Auto-detects a running vibecatch-node.mjs on 127.0.0.1 and uses it as provider #0.
// Zero npm dependencies, global fetch only.

export const DEFAULT_PORTS = [8794, 8795];

interface ProbeOpts {
  fetchImpl?: typeof fetch;
  ports?: number[];
}

interface ResolveOpts {
  fetchImpl?: typeof fetch;
  port?: number;
}

export interface LocalNodeInfo {
  port: number;
  version: string;
}

export interface ResolvedAudio {
  audioUrl: string;
  title: string;
  artist: string;
  duration: number;
  source: 'local-node';
  port: number;
}

/**
 * Build the URL that routes an upstream (e.g. googlevideo) stream through the
 * local node's GET /stream?url=<encoded-upstream> relay endpoint.
 * The relay adds CORS headers and Content-Disposition so the browser can fetch it.
 */
export function buildLocalStreamUrl(port: number, upstreamUrl: string): string {
  return `http://127.0.0.1:${port}/stream?url=${encodeURIComponent(upstreamUrl)}`;
}

/**
 * Probe localhost for a running vibecatch-local-node instance.
 * Sequentially tries each port with a 1200ms timeout per probe.
 * Returns { port, version } of the first match, or null. NEVER throws.
 */
export async function probeLocalNode(opts?: ProbeOpts): Promise<LocalNodeInfo | null> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const ports = opts?.ports ?? DEFAULT_PORTS;

  for (const port of ports) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);

      const res = await fetchImpl(`http://127.0.0.1:${port}/vibecheck`, {
        signal: controller.signal as any,
      });
      clearTimeout(timer);

      if (!res.ok) continue;

      const parsed = await res.json();
      if (parsed && parsed.ok === true && parsed.name === 'vibecatch-local-node') {
        return { port, version: parsed.version || '1.0.0' };
      }
    } catch {
      // Connection refused, timeout, parse error — skip to next port
      continue;
    }
  }

  return null;
}

/**
 * Try to resolve a video via /resolve on a specific port.
 * Returns { audioUrl, title, artist, duration, port } or null. NEVER throws.
 */
async function tryResolveOnPort(
  videoId: string,
  port: number,
  fetchImpl: typeof fetch,
): Promise<ResolvedAudio | null> {
  try {
    const res = await fetchImpl(
      `http://127.0.0.1:${port}/resolve?videoId=${encodeURIComponent(videoId)}`,
    );

    if (!res.ok) return null;

    const json = await res.json();

    if (json && json.audioUrl) {
      return {
        audioUrl: json.audioUrl,
        title: json.title || '',
        artist: json.artist || '',
        duration: json.duration || 0,
        source: 'local-node',
        port,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve a YouTube video via the local node's /resolve endpoint.
 *
 * Port discovery strategy:
 *  - When `opts.port` IS given: skip probing, resolve directly on that port.
 *  - When `opts.port` is NOT given: probe DEFAULT_PORTS via /vibecheck
 *    (reuse probeLocalNode semantics: ~1200ms timeout, never throws).
 *    If a probe succeeds, resolve on that port.
 *    If all probes fail, fall back to trying /resolve on each DEFAULT_PORT.
 *
 * Returns a ResolvedAudio with the answering `port`, or null. NEVER throws.
 */
export async function resolveViaLocalNode(
  videoId: string,
  opts?: ResolveOpts,
): Promise<ResolvedAudio | null> {
  const fetchImpl = opts?.fetchImpl ?? fetch;

  // If a specific port was given, skip probing and go straight to /resolve.
  if (opts?.port !== undefined) {
    return tryResolveOnPort(videoId, opts.port, fetchImpl);
  }

  // No port given — probe DEFAULT_PORTS via /vibecheck.
  const ports = DEFAULT_PORTS;
  for (const port of ports) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);

      const res = await fetchImpl(`http://127.0.0.1:${port}/vibecheck`, {
        signal: controller.signal as any,
      });
      clearTimeout(timer);

      if (res.ok) {
        const parsed = await res.json();
        if (parsed && parsed.ok === true && parsed.name === 'vibecatch-local-node') {
          // Found a live node — resolve on this port.
          const result = await tryResolveOnPort(videoId, port, fetchImpl);
          if (result) return result;
        }
      }
    } catch {
      // Probe failed — continue to next port.
      continue;
    }
  }

  // All /vibecheck probes failed — fallback: try /resolve directly on each port.
  for (const port of ports) {
    const result = await tryResolveOnPort(videoId, port, fetchImpl);
    if (result) return result;
  }

  return null;
}
