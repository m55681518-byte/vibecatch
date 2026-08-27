// YouTube Multi-Provider Audio Resolver
// Browser-compatible, zero-dependency, concurrent provider race

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderDescriptor {
  name: string;
  kind: 'cobalt' | 'piped' | 'invidious' | 'signer';
  method: 'GET' | 'POST';
  endpoint: string;
}

interface ResolvedAudio {
  audioUrl: string;
  title?: string;
  artist?: string;
  duration?: number;
  source: string;
}

interface RaceOpts {
  providers?: ProviderDescriptor[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

export const PROVIDERS_YT: ProviderDescriptor[] = [
  // Cloudflare thin signer (Turn B) — mints a raw signed googlevideo URL as
  // tiny JSON; audio bytes stream direct to the device (direct-to-device path).
  {
    name: 'signer-cloudflare',
    kind: 'signer',
    method: 'GET',
    endpoint: 'https://vibecatch-signer.pages.dev/resolve?videoId={id}',
  },
  // Cobalt public instances (POST)
  {
    name: 'cobalt-official',
    kind: 'cobalt',
    method: 'POST',
    endpoint: 'https://api.cobalt.tools/api/json',
  },
  {
    name: 'cobalt-kittycat',
    kind: 'cobalt',
    method: 'POST',
    endpoint: 'https://dog.kittycat.boo/',
  },
  {
    name: 'cobalt-kwiatek',
    kind: 'cobalt',
    method: 'POST',
    endpoint: 'https://cobalt-api.kwiatekmiki.com/',
  },
  // Piped instances (GET)
  {
    name: 'piped-kavin',
    kind: 'piped',
    method: 'GET',
    endpoint: 'https://pipedapi.kavin.rocks/streams/{id}',
  },
  {
    name: 'piped-adminforge',
    kind: 'piped',
    method: 'GET',
    endpoint: 'https://pipedapi.adminforge.de/streams/{id}',
  },
  {
    name: 'piped-drgns',
    kind: 'piped',
    method: 'GET',
    endpoint: 'https://pipedapi.drgns.space/streams/{id}',
  },
  // Invidious instances (GET) — last resort
  {
    name: 'invidious-nerdvpn',
    kind: 'invidious',
    method: 'GET',
    endpoint: 'https://invidious.nerdvpn.de/api/v1/videos/{id}',
  },
  {
    name: 'invidious-yewtu',
    kind: 'invidious',
    method: 'GET',
    endpoint: 'https://yewtu.be/api/v1/videos/{id}',
  },
];

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

/** Normalize a Cobalt API response into a standard result. */
export function normalizeCobaltAudio(
  json: Record<string, any>,
): ResolvedAudio | null {
  if (!json || json.status === 'error' || !json.url) {
    return null;
  }
  return {
    audioUrl: json.url,
    title: json.title,
    artist: json.artist,
    duration: json.duration,
    source: 'cobalt',
  };
}

/** Normalize a Piped /streams response — pick highest-bitrate audio stream. */
export function normalizePipedStreams(
  json: Record<string, any>,
): ResolvedAudio | null {
  if (!json) return null;

  const streams: any[] = json.audioStreams;
  if (!streams || !Array.isArray(streams) || streams.length === 0) return null;

  const audioOnly = streams.filter(
    (s: any) => typeof s.mimeType === 'string' && s.mimeType.startsWith('audio/'),
  );
  if (audioOnly.length === 0) return null;

  audioOnly.sort(
    (a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0),
  );

  const best = audioOnly[0];
  return {
    audioUrl: best.url,
    title: json.title || '',
    artist: json.uploader || '',
    duration: json.duration,
    source: 'piped',
  };
}

/** Normalize an Invidious /api/v1/videos response — best adaptive audio format. */
export function normalizeInvidiousAdaptive(
  json: Record<string, any>,
): ResolvedAudio | null {
  if (!json) return null;

  const formats: any[] = json.adaptiveFormats;
  if (!formats || !Array.isArray(formats) || formats.length === 0) return null;

  const audioOnly = formats.filter(
    (f: any) => typeof f.type === 'string' && f.type.startsWith('audio/'),
  );
  if (audioOnly.length === 0) return null;

  audioOnly.sort(
    (a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0),
  );

  const best = audioOnly[0];
  return {
    audioUrl: best.url,
    title: json.title || '',
    artist: json.author || '',
    duration: json.lengthSeconds,
    source: 'invidious',
  };
}

/** Normalize a Cloudflare thin-signer /resolve response ({ok,videoId,audioUrl,...}). */
export function normalizeSignerResponse(
  json: Record<string, any>,
): ResolvedAudio | null {
  if (!json || json.ok !== true || typeof json.audioUrl !== 'string' || json.audioUrl.length === 0) {
    return null;
  }
  return {
    audioUrl: json.audioUrl,
    title: json.title || '',
    artist: json.artist || '',
    duration: typeof json.duration === 'number' ? json.duration : undefined,
    source: 'signer',
  };
}

// ---------------------------------------------------------------------------
// Provider Fetcher Factory
// ---------------------------------------------------------------------------

function createProviderPromise(
  provider: ProviderDescriptor,
  videoId: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<ResolvedAudio> {
  return new Promise<ResolvedAudio>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        controller.abort();
        reject(new Error(`${provider.name} timed out`));
      }
    }, timeoutMs);

    const url =
      provider.method === 'GET'
        ? provider.endpoint.replace('{id}', videoId)
        : provider.endpoint;

    const init: RequestInit = { signal: controller.signal as any };

    if (provider.method === 'POST') {
      init.method = 'POST';
      init.headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      init.body = JSON.stringify({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        downloadMode: 'audio',
      });
    }

    fetchImpl(url, init)
      .then(async (res: Response) => {
        if (settled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();

        // Try all normalizers — any shape may come from any provider
        let normalized: ResolvedAudio | null = null;
        normalized = normalizeCobaltAudio(json)
          ?? normalizePipedStreams(json)
          ?? normalizeInvidiousAdaptive(json)
          ?? normalizeSignerResponse(json);

        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (normalized) {
          resolve({ ...normalized, source: provider.name });
        } else {
          reject(new Error(`${provider.name} returned unusable data`));
        }
      })
      .catch((err: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ---------------------------------------------------------------------------
// Race Resolver
// ---------------------------------------------------------------------------

/**
 * Fire all providers concurrently and return the first successful result.
 * Uses Promise.any semantics — first non-null normalized result wins.
 * NEVER throws.
 */
export async function raceYouTubeResolvers(
  videoId: string,
  opts?: RaceOpts,
): Promise<ResolvedAudio | null> {
  const providers = opts?.providers ?? PROVIDERS_YT;
  const timeoutMs = opts?.timeoutMs ?? 6000;
  const fetchImpl = opts?.fetchImpl ?? fetch;

  const attempts = providers.map((p) =>
    createProviderPromise(p, videoId, timeoutMs, fetchImpl),
  );

  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Resolution Cache
// ---------------------------------------------------------------------------

/** Cache for resolved audio URLs with TTL expiry. All KV errors swallowed. */
export class ResolutionCache {
  private kv: { get(k: string): any; set(k: string, v: any): void };
  private ttlMs: number;
  private nowFn: () => number;

  constructor(
    kv: { get(k: string): any; set(k: string, v: any): void },
    opts?: { ttlMs?: number; now?: () => number },
  ) {
    this.kv = kv;
    this.ttlMs = opts?.ttlMs ?? 6 * 60 * 60 * 1000; // default 6h
    this.nowFn = opts?.now ?? (() => Date.now());
  }

  put(key: string, value: any): void {
    try {
      this.kv.set(key, { v: value, t: this.nowFn() });
    } catch {
      // swallow
    }
  }

  get(key: string): any | null {
    try {
      const entry = this.kv.get(key);
      if (!entry) return null;
      if (this.nowFn() - entry.t > this.ttlMs) {
        this.kv.set(key, undefined as any); // drop stale
        return null;
      }
      return entry.v;
    } catch {
      return null;
    }
  }
}
