import confetti from 'canvas-confetti';
import { Track, DemuxProgress, ExtractionResult } from '../types';
import { saveAudioBlob, getAudioBlob, saveTrack } from './db';
import { pickDownloadUrl, audioFormatMeta, playbackSourceFor, fetchUrlForDownload } from './downloadUrl';
import { extractYouTubeId } from './extractor';

/**
 * Always-on Cloudflare Pages signer base. It mints signed googlevideo URLs for
 * playback (/resolve) AND relays full audio bytes with CORS for byte-downloads
 * (/stream?url=...) — laptop-free and tunnel-free by design.
 */
export const CLOUD_SIGNER_BASE = 'https://vibecatch-signer.pages.dev';

/**
 * CORS-enabled relay base for browser byte-downloads. ALWAYS the always-on
 * cloud signer (zero laptop dependency) — never 127.0.0.1 or a laptop tunnel.
 * NEVER throws. Returns a base (no trailing slash) or null in the edge case
 * where the app is built without a signer base.
 */
async function discoverRelayBase(): Promise<string | null> {
  return CLOUD_SIGNER_BASE || null;
}

/**
 * Try to get a fresh streamUrl for a track whose signed URL may have expired.
 *
 * Extracts the YouTube videoId from the track's originalUrl, re-runs the full
 * 3-tier extractor to mint a brand-new googlevideo signed URL, and persists
 * the updated streamUrl/downloadUrl back to IndexedDB so subsequent plays and
 * downloads don't hit the expired URL again.
 *
 * Returns the refreshed Track on success, or the original track unchanged on
 * failure (the caller should surface the original error).
 */
async function refreshExpiredStreamUrl(track: Track): Promise<Track> {
  // Only YouTube tracks have a videoId we can re-resolve
  const videoId = extractYouTubeId(track.originalUrl || '');
  if (!videoId) return track;

  // Dynamic import to avoid circular dependency at module load time
  const { extractMedia } = await import('./extractor');
  const result: ExtractionResult = await extractMedia(track.originalUrl!);
  if (!result.success || !result.track) return track;

  // Merge the fresh URLs into the existing track (preserve user edits like
  // favorite, playlist membership, etc.)
  const refreshed: Track = {
    ...track,
    streamUrl: result.track.streamUrl,
    downloadUrl: result.track.downloadUrl,
  };

  // Persist the new URLs so future plays/downloads use the fresh ones
  try {
    await saveTrack(refreshed);
  } catch {
    // Non-fatal — the in-memory copy is already updated
  }

  return refreshed;
}

/**
 * Map a real HTTP Content-Type returned by the relay/signer to the concrete
 * { mime, ext } used for blob labeling, IndexedDB persistence and filename.
 * Returns null when the header is missing/unknown so callers fall back to
 * audioFormatMeta(track.audioFormat).
 */
export function detectDownloadFileMeta(contentType: string | null): { mime: string; ext: string } | null {
  if (!contentType) return null;
  const ct = contentType.toLowerCase();
  if (ct.includes('webm')) return { mime: 'audio/webm', ext: 'webm' };
  if (ct.includes('ogg') || ct.includes('opus')) return { mime: 'audio/ogg', ext: 'ogg' };
  if (ct.includes('m4a') || ct.includes('aac')) return { mime: 'audio/mp4', ext: 'm4a' };
  if (ct.includes('mp4')) return { mime: 'audio/mp4', ext: 'm4a' };
  if (ct.includes('mpeg') || ct.includes('mp3')) return { mime: 'audio/mpeg', ext: 'mp3' };
  if (ct.includes('wav') || ct.includes('wave')) return { mime: 'audio/wav', ext: 'wav' };
  return null;
}

/**
 * True on browsers where a programmatic <a download> click fired after async
 * work (fetch + IndexedDB) is blocked because the initiating tap has lost its
 * user activation — Chrome for Android and iOS Safari. These need the native
 * download triggered from a real 'Tap to save' button gesture instead.
 */
export function isMobileDownload(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * Fire the native download for a pending save inside a fresh (synchronous)
 * user gesture — call this directly from a button onClick. The blob URL is
 * revoked lazily (60s) so the browser can finish picking up the download.
 */
export function triggerPendingSave(pending: { blobUrl: string; filename: string }): void {
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = pending.blobUrl;
  a.download = pending.filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(pending.blobUrl);
  }, 60000);
}

/**
 * Downloads media audio stream directly in-memory, saves to IndexedDB,
 * and triggers an instant HTML5 direct file download.
 */
const MAX_FETCH_RETRIES = 2;
const RETRY_BASE_MS = 1200;

/**
 * Hard ceiling for response HEADERS to arrive. If a fetch never settles
 * (hanging TCP/TLS to the relay, or a Cloudflare worker subrequest stalled on
 * the upstream CDN) the browser fetch() stays pending indefinitely — that's
 * the "frozen at 25%" download stall. No timer anywhere = stuck forever.
 */
const FETCH_HEADER_TIMEOUT_MS = 20000;
/**
 * Whole-body ceiling for the non-streaming download paths (offline cache,
 * trimmer) which read the full body via arrayBuffer().
 */
const FETCH_BODY_TIMEOUT_MS = 60000;
/**
 * Ceiling between consecutive body chunks while draining the relay stream.
 * Guards against a response whose headers arrive but whose body stalls.
 */
const READER_STALL_TIMEOUT_MS = 30000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pure timer watchdog tied to an AbortController. `arm()` begins a countdown
 * that aborts the controller if nothing calls `clear()` / re-`arm()`s first.
 * Rejected aborts surface as catchable errors instead of an eternal freeze.
 */
function stallWatchdog(
  abort: AbortController,
  ms: number,
  reason: string
): { arm: (msOverride?: number) => void; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (msOverride?: number) => {
    clearTimeout(timer);
    const budget = typeof msOverride === 'number' ? msOverride : ms;
    timer = setTimeout(() => {
      console.warn(`[DL] STALL: ${reason} — aborting after ${budget}ms`);
      abort.abort();
    }, budget);
  };
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return { arm, clear };
}

export async function downloadAudioDirectly(
  track: Track,
  onProgress?: (progress: DemuxProgress) => void
): Promise<{ success: boolean; blobUrl?: string; error?: string }> {
  let { mime: dlMime, ext: dlExt } = audioFormatMeta(track.audioFormat);
  try {
    onProgress?.({
      stage: 'resolving',
      percent: 10,
      bytesLoaded: 0,
      totalBytes: 0,
      message: 'Resolving decentralized media stream...',
    });

    // Check if we already have the Blob stored in IndexedDB
    let blob = await getAudioBlob(track.id);

    // A blob saved by this code carries its real mime type — use it to label
    // re-downloads consistently instead of the guessed track.audioFormat.
    if (blob) {
      console.log(`[DL] Using cached blob for "${track.title}" (${(blob.size / 1024).toFixed(0)} KB, type=${blob.type})`);
      const cachedMeta = detectDownloadFileMeta(blob.type);
      if (cachedMeta) {
        dlMime = cachedMeta.mime;
        dlExt = cachedMeta.ext;
      }
    }

    if (!blob) {
      onProgress?.({
        stage: 'fetching',
        percent: 25,
        bytesLoaded: 0,
        totalBytes: 0,
        message: 'Fetching audio chunks directly from CDN...',
      });

      const relayBase = await discoverRelayBase();
      let fetchUrl = fetchUrlForDownload(track, relayBase);
      console.log(`[DL] fetchUrl=${fetchUrl}`);
      console.log(`[DL] track.id=${track.id}  audioFormat=${track.audioFormat}`);
      console.log(`[DL] track.streamUrl=${track.streamUrl?.slice(0, 120)}  downloadUrl=${track.downloadUrl?.slice(0, 120)}`);
      console.log(`[DL] download started at ${new Date().toISOString()}`);

      let lastErr: any = null;
      let response: Response | null = null;

      for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt++) {
        const controller = new AbortController();
        const watchdog = stallWatchdog(
          controller,
          FETCH_HEADER_TIMEOUT_MS,
          `fetch(${fetchUrl.slice(0, 120)}...) never returned headers (attempt ${attempt + 1})`,
        );
        try {
          if (attempt > 0) {
            const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1);
            console.log(`[DL] Retry attempt ${attempt}/${MAX_FETCH_RETRIES} after ${backoff}ms`);
            onProgress?.({
              stage: 'fetching',
              percent: 25,
              bytesLoaded: 0,
              totalBytes: 0,
              message: `Retrying download (attempt ${attempt + 1})...`,
            });
            await sleep(backoff);
          }

          const fetchStart = performance.now();
          console.log(`[DL] fetch START (attempt ${attempt + 1}): ${new Date().toISOString()} ${fetchUrl}`);

          watchdog.arm();
          response = await fetch(fetchUrl, {
            headers: {
              'Accept': 'audio/*, video/*',
            },
            signal: controller.signal,
          });

          const fetchMs = Math.round(performance.now() - fetchStart);
          console.log(`[DL] fetch response (${fetchMs}ms, attempt ${attempt + 1}): status=${response.status} content-type=${response.headers.get('content-type')} content-length=${response.headers.get('content-length')} content-range=${response.headers.get('content-range')} redirectUrl=${response.url?.slice(0, 140)}`);

          // Expired googlevideo signed URLs return 403 Forbidden or 410 Gone.
          // Re-resolve via the extractor to mint a fresh signed URL, then retry.
          if (!response.ok && (response.status === 403 || response.status === 410)) {
            console.log(`[DL] Stream expired (${response.status}) — re-resolving...`);
            onProgress?.({
              stage: 'resolving',
              percent: 10,
              bytesLoaded: 0,
              totalBytes: 0,
              message: 'Stream URL expired — re-resolving audio...',
            });

            const freshTrack = await refreshExpiredStreamUrl(track);
            if (freshTrack.streamUrl !== track.streamUrl || freshTrack.downloadUrl !== track.downloadUrl) {
              // Update the in-memory track so callers see the fresh URL
              track.streamUrl = freshTrack.streamUrl;
              track.downloadUrl = freshTrack.downloadUrl;
              fetchUrl = fetchUrlForDownload(track, relayBase);
              console.log(`[DL] Refreshed fetchUrl=${fetchUrl}`);

              const refreshStart = performance.now();
              watchdog.arm();
              response = await fetch(fetchUrl, {
                headers: { 'Accept': 'audio/*, video/*' },
                signal: controller.signal,
              });
              console.log(`[DL] Retry fetch after refresh (${Math.round(performance.now() - refreshStart)}ms): status=${response.status}`);
            }
          }

          if (response.ok) break; // success — exit retry loop

          lastErr = new Error(`Failed to fetch media stream (Status: ${response.status})`);
          console.warn(`[DL] Non-OK response (attempt ${attempt + 1}):`, lastErr.message);

          // Don't retry on permanent client errors (except 403/410 which are handled above)
          if (response.status >= 400 && response.status < 500 && response.status !== 403 && response.status !== 410) {
            break;
          }
        } catch (fetchErr: any) {
          lastErr = fetchErr;
          console.warn(`[DL] Fetch error (attempt ${attempt + 1}):`, fetchErr?.name, fetchErr?.message || fetchErr);
          // Network errors (including stall aborts) are transient — retry with fresh controller
        } finally {
          watchdog.clear();
        }
      }

      if (!response || !response.ok) {
        const msg = lastErr?.message || `Failed to fetch media stream (Status: ${response?.status})`;
        console.error(`[DL] All attempts failed: ${msg}`);
        throw new Error(msg);
      }

      // Label blobs/IndexedDB/filename with the REAL Content-Type from the
      // relay — the source of truth for what the stream actually is. The old
      // code hardcoded audio/mpeg and derived the extension from the guessed
      // audioFormat, producing corrupt/failed downloads.
      const detectedMeta = detectDownloadFileMeta(response.headers.get('content-type'));
      if (detectedMeta) {
        dlMime = detectedMeta.mime;
        dlExt = detectedMeta.ext;
      }

      const contentLength = response.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : 4 * 1024 * 1024;

      // Stream reader for progress updates
      if (response.body && ReadableStream) {
        const reader = response.body.getReader();
        console.log(`[DL] Got body reader — draining ${totalBytes} bytes`);
        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;
        let firstChunkMs: number | null = null;
        const bodyStart = performance.now();

        const bodyStall = new AbortController();
        bodyStall.signal.addEventListener('abort', () => {
          console.warn(`[DL] Body-stall abort fired — canceling reader`);
          reader.cancel().catch(() => {});
        });
        const bodyWatchdog = stallWatchdog(
          bodyStall,
          READER_STALL_TIMEOUT_MS,
          `reader stalled (no chunk for 30s at ${(receivedBytes / (1024 * 1024)).toFixed(1)}MB)`,
        );

        while (true) {
          bodyWatchdog.arm();
          let result: ReadableStreamReadResult<Uint8Array>;
          try {
            result = await reader.read();
          } catch (readErr: any) {
            console.error(`[DL] reader.read() ERROR:`, readErr?.name, readErr?.message || readErr);
            throw readErr;
          }
          bodyWatchdog.clear();
          const { done, value } = result;
          if (done) break;
          if (value) {
            if (firstChunkMs === null) {
              firstChunkMs = Math.round(performance.now() - bodyStart);
              console.log(`[DL] FIRST chunk after ${firstChunkMs}ms (${value.length}B)`);
            }
            chunks.push(value);
            receivedBytes += value.length;
            console.log(`[DL] chunk +${value.length}B => ${(receivedBytes / (1024 * 1024)).toFixed(2)} MB / ${totalBytes} bytes`);
            const pct = Math.min(90, Math.round(25 + (receivedBytes / (totalBytes || 1)) * 60));
            onProgress?.({
              stage: 'demuxing',
              percent: pct,
              bytesLoaded: receivedBytes,
              totalBytes: totalBytes || receivedBytes,
              message: `Demuxing in-memory stream (${(receivedBytes / (1024 * 1024)).toFixed(1)} MB)...`,
            });
          }
        }
        bodyWatchdog.clear();

        blob = new Blob(chunks as BlobPart[], { type: dlMime });
      } else {
        const arrayBuffer = await response.arrayBuffer();
        blob = new Blob([arrayBuffer], { type: dlMime });
      }

      console.log(`[DL] Blob ready: ${(blob.size / (1024 * 1024)).toFixed(2)} MB, type=${blob.type}`);

      onProgress?.({
        stage: 'buffering',
        percent: 92,
        bytesLoaded: blob.size,
        totalBytes: blob.size,
        message: 'Writing audio blob to IndexedDB vault...',
      });

      // Save to IndexedDB for 100% offline persistence
      await saveAudioBlob(track.id, blob, dlMime);
      
      track.isOfflineAvailable = true;
      track.fileSizeBytes = blob.size;
      await saveTrack(track);
    }

    onProgress?.({
      stage: 'ready',
      percent: 100,
      bytesLoaded: blob.size,
      totalBytes: blob.size,
      message: 'Download complete! File saved.',
    });

    // Create Blob URL for instant native download
    const blobUrl = URL.createObjectURL(blob);
    const filename = `${sanitizeFilename(track.artist)} - ${sanitizeFilename(track.title)}.${dlExt}`;
    console.log(`[DL] Download ready: filename="${filename}" mobile=${isMobileDownload()}`);

    if (isMobileDownload()) {
      // Chrome for Android / iOS Safari block this programmatic <a download>
      // click after async work — the initiating tap has already lost its user
      // activation. Surface a 'Tap to save' button (pendingSave) instead, which
      // triggers the native download from a fresh synchronous click gesture.
      onProgress?.({
        stage: 'ready',
        percent: 100,
        bytesLoaded: blob.size,
        totalBytes: blob.size,
        message: 'Download ready — tap to save.',
        pendingSave: { blobUrl, filename },
      });
      return { success: true, blobUrl };
    }

    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
    }, 1500);

    // Trigger celebratory confetti effect
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.8 },
        colors: ['#00f2fe', '#ff007f', '#4facfe', '#8b5cf6', '#00ffcc'],
      });
    } catch (e) {
      // ignore
    }

    return { success: true, blobUrl };
  } catch (err: any) {
    console.error('Download error:', err);
    onProgress?.({
      stage: 'error',
      percent: 0,
      bytesLoaded: 0,
      totalBytes: 0,
      message: err.message || 'Download failed. Check connection.',
    });
    return { success: false, error: err.message };
  }
}

/**
 * Caches a track offline in IndexedDB without triggering an explicit file save prompt
 */
export async function cacheTrackOffline(
  track: Track,
  onProgress?: (progress: DemuxProgress) => void
): Promise<boolean> {
  try {
    const existing = await getAudioBlob(track.id);
    if (existing) return true;

    onProgress?.({
      stage: 'fetching',
      percent: 30,
      bytesLoaded: 0,
      totalBytes: 0,
      message: 'Fetching audio for offline cache...',
    });

    const relayBase = await discoverRelayBase();
    let fetchUrl = fetchUrlForDownload(track, relayBase);
    console.log(`[DL-cache] fetchUrl=${fetchUrl} (started ${new Date().toISOString()})`);

    const cacheStall = new AbortController();
    const cacheWatchdog = stallWatchdog(
      cacheStall,
      FETCH_HEADER_TIMEOUT_MS,
      `cache fetch ${fetchUrl.slice(0, 100)}... never returned headers`,
    );
    cacheWatchdog.arm();
    let response = await fetch(fetchUrl, { signal: cacheStall.signal });
    cacheWatchdog.clear();
    console.log(`[DL-cache] fetch response: status=${response.status} content-type=${response.headers.get('content-type')} content-length=${response.headers.get('content-length')}`);

    // Expired googlevideo signed URLs return 403/410 — re-resolve and retry.
    if (!response.ok && (response.status === 403 || response.status === 410)) {
      const freshTrack = await refreshExpiredStreamUrl(track);
      if (freshTrack.streamUrl !== track.streamUrl || freshTrack.downloadUrl !== track.downloadUrl) {
        track.streamUrl = freshTrack.streamUrl;
        track.downloadUrl = freshTrack.downloadUrl;
        fetchUrl = fetchUrlForDownload(track, relayBase);
        console.log(`[DL-cache] Refreshed fetchUrl=${fetchUrl}`);
        cacheWatchdog.arm();
        response = await fetch(fetchUrl, { signal: cacheStall.signal });
        cacheWatchdog.clear();
      }
    }
    if (!response.ok) throw new Error('Offline fetch failed');

    const detectedMeta = detectDownloadFileMeta(response.headers.get('content-type'));
    const fallbackMeta = audioFormatMeta(track.audioFormat);
    const cacheMime = detectedMeta?.mime ?? fallbackMeta.mime;

    cacheWatchdog.arm(FETCH_BODY_TIMEOUT_MS);
    const buffer = await response.arrayBuffer();
    cacheWatchdog.clear();
    const blob = new Blob([buffer], { type: cacheMime });

    await saveAudioBlob(track.id, blob, cacheMime);
    track.isOfflineAvailable = true;
    track.fileSizeBytes = blob.size;
    await saveTrack(track);

    onProgress?.({
      stage: 'ready',
      percent: 100,
      bytesLoaded: blob.size,
      totalBytes: blob.size,
      message: 'Cached offline successfully!',
    });

    return true;
  } catch (e) {
    console.warn('Failed to cache track offline:', e);
    return false;
  }
}

/**
 * Returns playable URL (either cached blob: URL or remote direct URL)
 */
export async function getPlayableAudioUrl(track: Track): Promise<string> {
  try {
    const blob = await getAudioBlob(track.id);
    if (blob) {
      return URL.createObjectURL(blob);
    }
  } catch (e) {
    console.warn('Failed to retrieve offline blob:', e);
  }
  return playbackSourceFor(track, null);
}

/**
 * In-browser Web Audio Trimmer / Ringtone Maker
 * Decodes audio buffer, slices segment, and encodes to standard WAV Blob
 */
export async function trimAudioSegment(
  track: Track,
  startTime: number,
  endTime: number
): Promise<{ blob: Blob; url: string; filename: string }> {
  // Trimmer fetches the full file via browser fetch(), so it needs the CORS-safe
  // relay download endpoint — never a raw direct googlevideo URL (no ACAO headers).
  const streamUrl = pickDownloadUrl(track);
  const trimStall = new AbortController();
  const trimWatchdog = stallWatchdog(
    trimStall,
    FETCH_HEADER_TIMEOUT_MS,
    `trimmer fetch ${streamUrl.slice(0, 100)}... never returned headers`,
  );
  trimWatchdog.arm();
  let response = await fetch(streamUrl, { signal: trimStall.signal });
  trimWatchdog.clear();

  // Expired googlevideo signed URLs return 403/410 — re-resolve and retry.
  if (!response.ok && (response.status === 403 || response.status === 410)) {
    const freshTrack = await refreshExpiredStreamUrl(track);
    const freshUrl = pickDownloadUrl(freshTrack);
    trimWatchdog.arm();
    response = await fetch(freshUrl, { signal: trimStall.signal });
    trimWatchdog.clear();
  }

  trimWatchdog.arm(FETCH_BODY_TIMEOUT_MS);
  const arrayBuffer = await response.arrayBuffer();
  trimWatchdog.clear();

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioCtx();
  const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  const sampleRate = decodedBuffer.sampleRate;
  const channels = decodedBuffer.numberOfChannels;

  const startSample = Math.floor(Math.max(0, startTime) * sampleRate);
  const endSample = Math.min(decodedBuffer.length, Math.floor(endTime * sampleRate));
  const sliceLength = Math.max(1, endSample - startSample);

  const trimmedBuffer = audioCtx.createBuffer(channels, sliceLength, sampleRate);

  for (let c = 0; c < channels; c++) {
    const channelData = decodedBuffer.getChannelData(c);
    const trimmedData = trimmedBuffer.getChannelData(c);
    for (let i = 0; i < sliceLength; i++) {
      trimmedData[i] = channelData[startSample + i];
    }
  }

  // Encode trimmedBuffer to WAV Blob in memory
  const wavBlob = audioBufferToWav(trimmedBuffer);
  const blobUrl = URL.createObjectURL(wavBlob);
  const filename = `${sanitizeFilename(track.artist)} - ${sanitizeFilename(track.title)} (Ringtone ${Math.round(startTime)}s-${Math.round(endTime)}s).wav`;

  await audioCtx.close();

  return { blob: wavBlob, url: blobUrl, filename };
}

// Convert AudioBuffer to standard PCM 16-bit WAV Blob
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const dataLength = buffer.length * blockAlign;
  const bufferLength = 44 + dataLength;

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  // Write WAV Header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write interleaved PCM samples
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      let sample = buffer.getChannelData(channel)[i];
      // Clamp sample to [-1, 1]
      sample = Math.max(-1, Math.min(1, sample));
      // Convert to 16-bit signed integer
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([view], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim().slice(0, 50);
}
