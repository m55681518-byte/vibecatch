// Pure helpers for choosing where a full-file download should come from.
//
// The /stream relay is window-capped (~1MiB) for preview/playback; real
// downloads must go through the local node's yt-dlp /download endpoint,
// which pipes the complete file (cookie-jar bot-wall bypass).

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
