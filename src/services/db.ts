import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Track, Playlist, HistoryItem, UserSettings, StorageInfo } from '../types';

interface VibeCatchDB extends DBSchema {
  tracks: {
    key: string;
    value: Track;
    indexes: { 'by-added': number; 'by-platform': string; 'by-favorite': number };
  };
  audio_blobs: {
    key: string; // trackId
    value: {
      trackId: string;
      blob: Blob;
      mimeType: string;
      sizeBytes: number;
      savedAt: number;
    };
  };
  playlists: {
    key: string;
    value: Playlist;
    indexes: { 'by-created': number };
  };
  history: {
    key: string;
    value: HistoryItem;
    indexes: { 'by-time': number };
  };
  settings: {
    key: string;
    value: any;
  };
}

const DB_NAME = 'vibecatch_database_v2';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<VibeCatchDB>> | null = null;

export const getDB = async (): Promise<IDBPDatabase<VibeCatchDB>> => {
  if (!dbPromise) {
    dbPromise = openDB<VibeCatchDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Tracks store
        if (!db.objectStoreNames.contains('tracks')) {
          const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
          trackStore.createIndex('by-added', 'addedAt');
          trackStore.createIndex('by-platform', 'platform');
          trackStore.createIndex('by-favorite', 'isFavorite');
        }

        // Audio Blobs store for 100% offline audio storage
        if (!db.objectStoreNames.contains('audio_blobs')) {
          db.createObjectStore('audio_blobs', { keyPath: 'trackId' });
        }

        // Playlists store
        if (!db.objectStoreNames.contains('playlists')) {
          const playlistStore = db.createObjectStore('playlists', { keyPath: 'id' });
          playlistStore.createIndex('by-created', 'createdAt');
        }

        // History store
        if (!db.objectStoreNames.contains('history')) {
          const historyStore = db.createObjectStore('history', { keyPath: 'id' });
          historyStore.createIndex('by-time', 'timestamp');
        }

        // Settings store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
};

// ==================== TRACKS ====================

export const getAllTracks = async (): Promise<Track[]> => {
  const db = await getDB();
  const tracks = await db.getAllFromIndex('tracks', 'by-added');
  return tracks.reverse(); // newest first
};

export const getTrackById = async (id: string): Promise<Track | undefined> => {
  const db = await getDB();
  return db.get('tracks', id);
};

export const saveTrack = async (track: Track): Promise<void> => {
  const db = await getDB();
  await db.put('tracks', track);
};

export const deleteTrack = async (id: string): Promise<void> => {
  const db = await getDB();
  const tx = db.transaction(['tracks', 'audio_blobs'], 'readwrite');
  await tx.objectStore('tracks').delete(id);
  await tx.objectStore('audio_blobs').delete(id);
  await tx.done;
};

export const toggleFavoriteTrack = async (id: string): Promise<boolean> => {
  const db = await getDB();
  const track = await db.get('tracks', id);
  if (!track) return false;
  track.isFavorite = !track.isFavorite;
  await db.put('tracks', track);
  return track.isFavorite;
};

// ==================== OFFLINE AUDIO BLOBS ====================

export const saveAudioBlob = async (trackId: string, blob: Blob, mimeType = 'audio/mpeg'): Promise<number> => {
  const db = await getDB();
  const sizeBytes = blob.size;
  await db.put('audio_blobs', {
    trackId,
    blob,
    mimeType,
    sizeBytes,
    savedAt: Date.now(),
  });

  // Mark track as offline available
  const track = await db.get('tracks', trackId);
  if (track) {
    track.isOfflineAvailable = true;
    track.offlineBlobId = trackId;
    track.fileSizeBytes = sizeBytes;
    await db.put('tracks', track);
  }

  return sizeBytes;
};

export const getAudioBlob = async (trackId: string): Promise<Blob | null> => {
  const db = await getDB();
  const record = await db.get('audio_blobs', trackId);
  return record ? record.blob : null;
};

export const deleteAudioBlob = async (trackId: string): Promise<void> => {
  const db = await getDB();
  await db.delete('audio_blobs', trackId);
  const track = await db.get('tracks', trackId);
  if (track) {
    track.isOfflineAvailable = false;
    track.offlineBlobId = undefined;
    await db.put('tracks', track);
  }
};

export const getAllStoredBlobIds = async (): Promise<string[]> => {
  const db = await getDB();
  return db.getAllKeys('audio_blobs');
};

// ==================== PLAYLISTS ====================

export const getAllPlaylists = async (): Promise<Playlist[]> => {
  const db = await getDB();
  let playlists = await db.getAll('playlists');
  
  // Seed default system playlists if empty
  if (playlists.length === 0) {
    const defaultPlaylists: Playlist[] = [
      {
        id: 'vibes_tiktok',
        name: 'TikTok Viral Bangers 🔥',
        description: 'Trending sounds and viral audio hits extracted directly from TikTok.',
        coverUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400&q=80',
        trackIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isSystem: true,
      },
      {
        id: 'vibes_offline',
        name: 'Offline Vault ⚡',
        description: 'Locally cached media tracks ready for zero-internet playback.',
        coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80',
        trackIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isSystem: true,
      },
      {
        id: 'vibes_nightdrive',
        name: 'Night Drive & Cyber Synth 🏎️',
        description: 'Heavy basslines, synthwave and nighttime aesthetic frequencies.',
        coverUrl: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=400&q=80',
        trackIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isSystem: false,
      }
    ];
    for (const p of defaultPlaylists) {
      await db.put('playlists', p);
    }
    playlists = defaultPlaylists;
  }

  return playlists;
};

export const savePlaylist = async (playlist: Playlist): Promise<void> => {
  const db = await getDB();
  playlist.updatedAt = Date.now();
  await db.put('playlists', playlist);
};

export const deletePlaylist = async (id: string): Promise<void> => {
  const db = await getDB();
  await db.delete('playlists', id);
};

export const addTrackToPlaylist = async (playlistId: string, trackId: string): Promise<Playlist | undefined> => {
  const db = await getDB();
  const playlist = await db.get('playlists', playlistId);
  if (!playlist) return undefined;
  if (!playlist.trackIds.includes(trackId)) {
    playlist.trackIds.push(trackId);
    playlist.updatedAt = Date.now();
    await db.put('playlists', playlist);
  }
  return playlist;
};

export const removeTrackFromPlaylist = async (playlistId: string, trackId: string): Promise<Playlist | undefined> => {
  const db = await getDB();
  const playlist = await db.get('playlists', playlistId);
  if (!playlist) return undefined;
  playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId);
  playlist.updatedAt = Date.now();
  await db.put('playlists', playlist);
  return playlist;
};

// ==================== HISTORY ====================

export const getHistory = async (): Promise<HistoryItem[]> => {
  const db = await getDB();
  const history = await db.getAllFromIndex('history', 'by-time');
  return history.reverse().slice(0, 30);
};

export const addHistoryItem = async (item: Omit<HistoryItem, 'id' | 'timestamp'>): Promise<void> => {
  const db = await getDB();
  const id = `hist_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  await db.put('history', {
    ...item,
    id,
    timestamp: Date.now(),
  });
};

export const clearHistory = async (): Promise<void> => {
  const db = await getDB();
  await db.clear('history');
};

// ==================== SETTINGS ====================

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'cyber',
  visualizerQuality: 'ultra',
  autoPlayNext: true,
  defaultBitrate: '320',
  normalizeVolume: true,
  crossfadeDuration: 2,
  spatialAudio: true,
  batterySaverOptimization: true,
  preferredTier: 'auto',
};

export const getStoredSettings = async (): Promise<UserSettings> => {
  const db = await getDB();
  const record = await db.get('settings', 'user_config');
  return record ? { ...DEFAULT_SETTINGS, ...record.value } : DEFAULT_SETTINGS;
};

export const saveStoredSettings = async (settings: Partial<UserSettings>): Promise<UserSettings> => {
  const db = await getDB();
  const current = await getStoredSettings();
  const updated = { ...current, ...settings };
  await db.put('settings', { key: 'user_config', value: updated });
  return updated;
};

// ==================== STORAGE STATS ====================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export const getStorageStats = async (): Promise<StorageInfo> => {
  const db = await getDB();
  const tracks = await db.getAll('tracks');
  const blobs = await db.getAll('audio_blobs');

  let totalBlobBytes = 0;
  for (const b of blobs) {
    totalBlobBytes += b.sizeBytes || b.blob.size || 0;
  }

  let quotaBytes = 1024 * 1024 * 1024 * 5; // default estimate: 5GB
  let usageBytes = totalBlobBytes;

  if (navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      if (estimate.usage !== undefined) usageBytes = estimate.usage;
      if (estimate.quota !== undefined) quotaBytes = estimate.quota;
    } catch (e) {
      console.warn('Storage estimate failed:', e);
    }
  }

  const percentUsed = Math.min(100, Math.round((usageBytes / (quotaBytes || 1)) * 100));

  return {
    usageBytes,
    quotaBytes,
    usageFormatted: formatBytes(usageBytes),
    quotaFormatted: formatBytes(quotaBytes),
    percentUsed,
    trackCount: tracks.length,
    offlineTrackCount: blobs.length,
  };
};

export const clearAllLocalData = async (): Promise<void> => {
  const db = await getDB();
  const tx = db.transaction(['tracks', 'audio_blobs', 'playlists', 'history'], 'readwrite');
  await tx.objectStore('tracks').clear();
  await tx.objectStore('audio_blobs').clear();
  await tx.objectStore('playlists').clear();
  await tx.objectStore('history').clear();
  await tx.done;
};

export const exportLibraryJSON = async (): Promise<string> => {
  const tracks = await getAllTracks();
  const playlists = await getAllPlaylists();
  const payload = {
    appName: 'VibeCatch',
    version: '2.0.0',
    exportDate: new Date().toISOString(),
    tracks,
    playlists,
  };
  return JSON.stringify(payload, null, 2);
};

export const importLibraryJSON = async (jsonString: string): Promise<{ trackCount: number; playlistCount: number }> => {
  const parsed = JSON.parse(jsonString);
  const db = await getDB();
  let trackCount = 0;
  let playlistCount = 0;

  if (Array.isArray(parsed.tracks)) {
    for (const t of parsed.tracks) {
      // Don't import offline blob states directly unless re-downloaded
      await db.put('tracks', {
        ...t,
        isOfflineAvailable: false,
        offlineBlobId: undefined,
      });
      trackCount++;
    }
  }

  if (Array.isArray(parsed.playlists)) {
    for (const p of parsed.playlists) {
      await db.put('playlists', p);
      playlistCount++;
    }
  }

  return { trackCount, playlistCount };
};
