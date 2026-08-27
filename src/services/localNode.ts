// Local Node — browser-side detection and resolver
// Auto-detects a running vibecatch-node.mjs on 127.0.0.1 and uses it as provider #0.
// Zero npm dependencies, global fetch only.

export const DEFAULT_PORTS = [8794, 8795];

// Path served alongside the PWA bundle (public/workers.json). Each entry is a
// "/vibecheck" health endpoint of a RELAY — a node someone hosts and added to
// the pool. The browser probes them and uses the first healthy one, giving
// phones a zero-setup download path when no local node is running.
export const RELAY_MANIFEST_PATH = '/workers.json';

export interface ManifestUrlLike {
  origin?: string;
  href?: string;
}

export interface ManifestUrlOpts {
  location?: ManifestUrlLike;
  envBase?: string;
}

function baseUrlFromEnv(): string {
  try {
    if (
      typeof import.meta !== 'undefined' &&
      (import.meta as any).env &&
      typeof (import.meta as any).env.BASE_URL === 'string'
    ) {
      return (import.meta as any).env.BASE_URL;
    }
  } catch {
    // fall through to '/'
  }
  return '/';
}

/**
 * Resolve the relay manifest URL (public/workers.json) in a base-aware way.
 * GitHub Pages serves the SPA under a subpath (BASE_URL './') and Capacitor uses a
 * custom scheme ('capacitor://localhost'), so a hard-coded absolute '/workers.json'
 * would break both. With BASE_URL '/', behaviour is unchanged (origin + path).
 * Pure/exported so tests can drive location + envBase directly. NEVER throws.
 */
export function resolveRelayManifestUrl(opts?: ManifestUrlOpts): string {
  const envBase = opts?.envBase ?? baseUrlFromEnv();
  const loc =
    opts?.location ??
    (typeof location !== 'undefined' && location ? location : undefined);
  if (loc && loc.origin) {
    const origin = String(loc.origin);
    const href = String(loc.href || '');
    const dirBase = href ? new URL('.', href).href : origin + '/';
    return new URL(envBase + 'workers.json', dirBase).href;
  }
  return RELAY_MANIFEST_PATH;
}

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

export interface RelayInfo {
  baseUrl: string;
  version: string;
}

interface RelayProbeOpts {
  fetchImpl?: typeof fetch;
  manifestUrl?: string;
  timeoutMs?: number;
}

interface RelayResolveOpts {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ResolvedAudio {
  audioUrl: string;
  title: string;
  artist: string;
  duration: number;
  source: 'local-node' | 'relay';
  port: number;
  baseUrl?: string;
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
 * Same relay routing, but against a REMOTE relay base (zero-setup phone path).
 */
export function buildRelayStreamUrl(baseUrl: string, upstreamUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/stream?url=${encodeURIComponent(upstreamUrl)}`;
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

/**
 * Fetch the relay manifest (workers.json), probe each entry's /vibecheck, and
 * return the first healthy relay's { baseUrl, version } — or null. NEVER throws.
 *
 * The entry URLs must end in "/vibecheck"; the baseUrl is that URL minus the
 * probe path, e.g. "https://relay.trycloudflare.com/vibecheck" -> base
 * "https://relay.trycloudflare.com".
 */
export async function probeRelayManifest(opts?: RelayProbeOpts): Promise<RelayInfo | null> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const timeoutMs = opts?.timeoutMs ?? 1200;
  const manifestUrl =
    opts?.manifestUrl ?? resolveRelayManifestUrl();

  let entries: string[];
  try {
    const res = await fetchImpl(manifestUrl);
    if (!res.ok) return null;
    const parsed = await res.json();
    entries = Array.isArray(parsed) ? parsed.filter((e) => typeof e === 'string') : [];
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!/\/vibecheck$/.test(entry)) continue;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const probe = await fetchImpl(entry, { signal: controller.signal as any });
      clearTimeout(timer);
      if (!probe.ok) continue;
      const parsed = await probe.json();
      if (parsed && parsed.ok === true && /vibecatch/.test(parsed.name || '')) {
        return {
          baseUrl: entry.replace(/\/vibecheck$/, ''),
          version: parsed.version || '1.0.0',
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Resolve a video via a REMOTE relay's /resolve endpoint. NEVER throws.
 * Returns a ResolvedAudio with source 'relay' and the relay baseUrl.
 */
export async function resolveViaRelay(
  videoId: string,
  baseUrl: string,
  opts?: RelayResolveOpts
): Promise<ResolvedAudio | null> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const timeoutMs = opts?.timeoutMs ?? 1200;
  const base = baseUrl.replace(/\/+$/, '');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetchImpl(`${base}/resolve?videoId=${encodeURIComponent(videoId)}`, {
      signal: controller.signal as any,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    if (json && json.audioUrl) {
      return {
        audioUrl: json.audioUrl,
        title: json.title || '',
        artist: json.artist || '',
        duration: json.duration || 0,
        source: 'relay',
        port: 0,
        baseUrl: base,
      };
    }
    return null;
  } catch {
    return null;
  }
}
