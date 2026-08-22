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
 * Resolve a YouTube video via the local node's /resolve endpoint.
 * Returns { audioUrl, title, artist, duration, source: 'local-node' } or null. NEVER throws.
 */
export async function resolveViaLocalNode(
  videoId: string,
  opts?: ResolveOpts,
): Promise<ResolvedAudio | null> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const port = opts?.port ?? 8794;

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
      };
    }

    return null;
  } catch {
    return null;
  }
}
