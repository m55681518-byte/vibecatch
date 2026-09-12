// Pure helpers for choosing where a full-file download should come from.
//
// The /stream relay is window-capped (~1MiB) for preview/playback; real
// downloads must go through the local node's yt-dlp /download endpoint,
// which pipes the complete file (cookie-jar bot-wall bypass).

import { buildRelayStreamUrl } from './localNode';

export interface DownloadSource {
  streamUrl: string;
  downloadUrl?: string;
}

/**
 * Full-file download endpoint: prefer the local node's yt-dlp /download,
 * fall back to whatever streaming URL exists.
 */
export function pickDownloadUrl(track: DownloadSource): string {
  return track.downloadUrl || track.streamUrl;
}

/**
 * True when the streamUrl is a DIRECT host (googlevideo CDN) that can stream
 * straight to the device via a plain <audio> element with no CORS headers.
 * False for relay-wrapped URLs (localhost node, *.trycloudflare.com tunnel)
 * which go through HTTPS relay for playback.
 */
export function isDirectStreamUrl(url: string): boolean {
  if (typeof url !== 'string' || !url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return false;
    if (host === 'trycloudflare.com' || host.endsWith('.trycloudflare.com')) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * True when a host is known to serve media bytes WITHOUT any
 * Access-Control-Allow-Origin header — i.e. safe to *play* via a plain
 * <audio> element but NOT safe to `fetch()` cross-origin from the PWA.
 *
 * Covers YouTube/googlevideo, TikTok CDN, and other known non-CORS CDNs.
 * When this returns true and a relay is available, the URL MUST be routed
 * through the CORS relay for byte-downloads.
 */
export function isNoCorsCdnHost(url: string): boolean {
  if (typeof url !== 'string' || !url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'googlevideo.com' || host.endsWith('.googlevideo.com')) return true;
    if (host.endsWith('.tiktokcdn.com') || host.endsWith('.bytecdn.cn') ||
        host.endsWith('.muscdn.com') || host === 'tikwm.com') return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Build the CORS-safe URL the browser may `fetch()` for a full-file download.
 *
 * Browser `fetch()` from a PWA origin is blocked for any cross-origin URL that
 * doesn't send `Access-Control-Allow-Origin`. This includes googlevideo (YouTube),
 * TikTok CDN, and many other media CDNs. To guarantee byte-level downloads work,
 * ALL external URLs are routed through the CORS relay (`/stream?url=...`), which
 * wraps responses with `Access-Control-Allow-Origin: *`.
 *
 * Exceptions (bypass the relay):
 * - localhost / loopback URLs (local node — already CORS-safe)
 * - URLs already on the relay host (avoid double-wrapping)
 * - URLs that are already relay-wrapped (/stream?url= pattern)
 * - explicit local-node `/download?videoId=` URLs
 *
 * Pure / deterministic.
 */
export function fetchUrlForDownload(
  track: DownloadSource,
  relayBase?: string | null
): string {
  const prefer = track.downloadUrl || track.streamUrl || '';
  if (!prefer) {
    throw new Error('No audio source available for this track.');
  }

  if (!relayBase) {
    // No relay available — still block bare googlevideo URLs for safety
    if (isNoCorsCdnHost(prefer)) {
      throw new Error(
        'CORS block: this track is served by a CDN with no cross-origin access. ' +
        'Enable a relay and try again.'
      );
    }
    return prefer;
  }

  // Already a relay-wrapped URL (any relay, not just ours) — don't double-wrap
  if (/\/stream\?url=/.test(prefer)) return prefer;

  try {
    const urlObj = new URL(prefer);
    const relayObj = new URL(relayBase);

    // Same host as the relay — don't double-wrap
    if (urlObj.hostname === relayObj.hostname) return prefer;

    // Localhost / loopback — local node, no CORS issues
    const h = urlObj.hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0') return prefer;
  } catch {
    // URL parse failed — fall through to relay wrap
  }

  // All other external URLs: route through CORS relay for safety
  return buildRelayStreamUrl(relayBase, prefer);
}

/**
 * Playback source: cached blob > DIRECT minted streamUrl (thin-signer / direct
 * to-device playback) > local-node full file > relay download. For legacy
 * relay-wrapped streamUrls (not direct), keep download > stream ordering.
 */
export function playbackSourceFor(track: DownloadSource, blobUrl?: string | null): string {
  if (blobUrl) return blobUrl;
  if (isDirectStreamUrl(track.streamUrl)) return track.streamUrl;
  return track.downloadUrl || track.streamUrl;
}

/**
 * Ordered, deduped list of fallback playback sources for a track:
 * blob (if given), then the primary playbackSourceFor pick, then the
 * remaining candidate URLs in streamUrl/downloadUrl order.
 */
export function playbackChain(track: DownloadSource, blobUrl?: string | null): string[] {
  const chain: string[] = [];
  if (blobUrl) chain.push(blobUrl);
  const primary = playbackSourceFor(track, null);
  if (primary) chain.push(primary);
  for (const candidate of [track.downloadUrl, track.streamUrl]) {
    if (candidate && !chain.includes(candidate)) chain.push(candidate);
  }
  return chain;
}

/**
 * Build a /download URL against an arbitrary base origin (host may include a port).
 */
function buildDownloadUrl(base: string, videoId: string, title?: string, artist?: string): string {
  const params = new URLSearchParams();
  params.set('videoId', videoId);
  if (title) params.set('title', title);
  if (artist) params.set('artist', artist);
  return `${base}/download?${params.toString()}`;
}

/**
 * Build the local-node /download URL for a video.
 */
export function buildLocalDownloadUrl(
  port: number,
  videoId: string,
  title?: string,
  artist?: string
): string {
  return buildDownloadUrl(`http://127.0.0.1:${port}`, videoId, title, artist);
}

/**
 * Build the /download URL against a REMOTE relay base (zero-setup phone path).
 * The base is used verbatim — never rewritten to 127.0.0.1.
 */
export function buildRelayDownloadUrl(
  baseUrl: string,
  videoId: string,
  title?: string,
  artist?: string
): string {
  return buildDownloadUrl(baseUrl.replace(/\/+$/, ''), videoId, title, artist);
}

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  webm: 'audio/webm',
  wav: 'audio/wav',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
};

/**
 * Blob MIME type + file extension derived from a Track's audioFormat.
 */
export function audioFormatMeta(format?: string): { mime: string; ext: string } {
  const fmt = format || 'mp3';
  return { mime: AUDIO_MIME[fmt] || 'audio/mpeg', ext: fmt };
}
