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
 * Build the local-node /download URL for a video.
 */
export function buildLocalDownloadUrl(
  port: number,
  videoId: string,
  title?: string,
  artist?: string
): string {
  const params = new URLSearchParams();
  params.set('videoId', videoId);
  if (title) params.set('title', title);
  if (artist) params.set('artist', artist);
  return `http://127.0.0.1:${port}/download?${params.toString()}`;
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
