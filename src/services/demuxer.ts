import confetti from 'canvas-confetti';
import { Track, DemuxProgress } from '../types';
import { saveAudioBlob, getAudioBlob, saveTrack } from './db';
import { pickDownloadUrl, audioFormatMeta, playbackSourceFor } from './downloadUrl';

/**
 * Downloads media audio stream directly in-memory, saves to IndexedDB,
 * and triggers an instant HTML5 direct file download.
 */
export async function downloadAudioDirectly(
  track: Track,
  onProgress?: (progress: DemuxProgress) => void
): Promise<{ success: boolean; blobUrl?: string; error?: string }> {
  const { mime: dlMime, ext: dlExt } = audioFormatMeta(track.audioFormat);
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

    if (!blob) {
      onProgress?.({
        stage: 'fetching',
        percent: 25,
        bytesLoaded: 0,
        totalBytes: 0,
        message: 'Fetching audio chunks directly from CDN...',
      });

      const response = await fetch(pickDownloadUrl(track), {
        headers: {
          'Accept': 'audio/*, video/*',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch media stream (Status: ${response.status})`);
      }

      const contentLength = response.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : 4 * 1024 * 1024;

      // Stream reader for progress updates
      if (response.body && ReadableStream) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            receivedBytes += value.length;
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

        blob = new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
      } else {
        const arrayBuffer = await response.arrayBuffer();
        blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
      }

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

    const response = await fetch(pickDownloadUrl(track));
    if (!response.ok) throw new Error('Offline fetch failed');

    const buffer = await response.arrayBuffer();
    const blob = new Blob([buffer], { type: audioFormatMeta(track.audioFormat).mime });

    await saveAudioBlob(track.id, blob, audioFormatMeta(track.audioFormat).mime);
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
  const response = await fetch(streamUrl);
  const arrayBuffer = await response.arrayBuffer();

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
