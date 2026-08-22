import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  Track,
  Playlist,
  HistoryItem,
  UserSettings,
  StorageInfo,
  TabType,
  VisualizerMode,
  DemuxProgress,
} from '../types';
import { audioEngine } from '../services/audioEngine';
import {
  getAllTracks,
  saveTrack as dbSaveTrack,
  deleteTrack as dbDeleteTrack,
  toggleFavoriteTrack as dbToggleFavorite,
  getAllPlaylists,
  savePlaylist as dbSavePlaylist,
  deletePlaylist as dbDeletePlaylist,
  addTrackToPlaylist as dbAddTrackToPlaylist,
  removeTrackFromPlaylist as dbRemoveTrackFromPlaylist,
  getHistory,
  addHistoryItem,
  clearHistory as dbClearHistory,
  getStoredSettings,
  saveStoredSettings as dbSaveSettings,
  getStorageStats,
  deleteAudioBlob,
} from '../services/db';
import { downloadAudioDirectly, cacheTrackOffline } from '../services/demuxer';
import { checkSharedUrl, setupLaunchHandler } from '../services/shareTarget';
import { CURATED_TRACKS } from '../services/extractor';

interface AppContextType {
  // Navigation & UI
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  isFullPlayerOpen: boolean;
  setIsFullPlayerOpen: (open: boolean) => void;
  isSleepTimerOpen: boolean;
  setIsSleepTimerOpen: (open: boolean) => void;
  isTrimmerOpen: boolean;
  setIsTrimmerOpen: (open: boolean) => void;
  trimmerTrack: Track | null;
  openTrimmer: (track: Track) => void;
  visualizerMode: VisualizerMode;
  setVisualizerMode: (mode: VisualizerMode) => void;

  // Media Player
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  progress: number;
  volume: number;
  isMuted: boolean;
  loopMode: 'off' | 'all' | 'one';
  isShuffle: boolean;
  playbackRate: number;
  queue: Track[];
  queueIndex: number;
  sleepTimerSeconds: number | null;

  // Player Actions
  playTrack: (track: Track, newQueue?: Track[], index?: number) => Promise<void>;
  togglePlay: () => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  seek: (seconds: number) => void;
  nextTrack: () => void;
  prevTrack: () => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  cycleLoopMode: () => void;
  toggleShuffle: () => void;
  setPlaybackRate: (rate: number) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  startSleepTimer: (minutes: number) => void;
  cancelSleepTimer: () => void;

  // Library & Data
  tracks: Track[];
  playlists: Playlist[];
  history: HistoryItem[];
  storageInfo: StorageInfo | null;
  settings: UserSettings;
  isOnline: boolean;
  downloadProgress: Record<string, DemuxProgress>;

  // Data Actions
  saveTrackToLibrary: (track: Track) => Promise<void>;
  deleteTrackFromLibrary: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  downloadTrack: (track: Track) => Promise<void>;
  cacheOffline: (track: Track) => Promise<void>;
  removeOfflineCache: (trackId: string) => Promise<void>;
  createNewPlaylist: (name: string, description: string) => Promise<Playlist>;
  deletePlaylistById: (id: string) => Promise<void>;
  addTrackToPlaylistId: (playlistId: string, trackId: string) => Promise<void>;
  removeTrackFromPlaylistId: (playlistId: string, trackId: string) => Promise<void>;
  clearUserHistory: () => Promise<void>;
  updateSettings: (newSettings: Partial<UserSettings>) => Promise<void>;
  refreshLibrary: () => Promise<void>;

  // Shared Target / Input interception
  interceptedUrl: string | null;
  clearInterceptedUrl: () => void;

  // PWA Install
  installPrompt: any;
  triggerInstallPrompt: () => Promise<boolean>;
  isAppInstalled: boolean;
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Navigation & Modals
  const [activeTab, setActiveTab] = useState<TabType>('discover');
  const [isFullPlayerOpen, setIsFullPlayerOpen] = useState(false);
  const [isSleepTimerOpen, setIsSleepTimerOpen] = useState(false);
  const [isTrimmerOpen, setIsTrimmerOpen] = useState(false);
  const [trimmerTrack, setTrimmerTrack] = useState<Track | null>(null);
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>('vinyl3d');

  // Player State
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [loopMode, setLoopMode] = useState<'off' | 'all' | 'one'>('off');
  const [isShuffle, setIsShuffle] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1.0);
  const [queue, setQueue] = useState<Track[]>(CURATED_TRACKS);
  const [queueIndex, setQueueIndex] = useState(0);
  const [sleepTimerSeconds, setSleepTimerSeconds] = useState<number | null>(null);

  // Library & Persistence
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [settings, setSettings] = useState<UserSettings>({
    theme: 'cyber',
    visualizerQuality: 'ultra',
    autoPlayNext: true,
    defaultBitrate: '320',
    normalizeVolume: true,
    crossfadeDuration: 2,
    spatialAudio: true,
    batterySaverOptimization: true,
    preferredTier: 'auto',
  });

  // Network & PWA
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DemuxProgress>>({});
  const [interceptedUrl, setInterceptedUrl] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);

  const sleepTimerRef = useRef<NodeJS.Timeout | null>(null);
  const queueRef = useRef<Track[]>(queue);
  queueRef.current = queue;
  const queueIndexRef = useRef<number>(queueIndex);
  queueIndexRef.current = queueIndex;
  const loopModeRef = useRef(loopMode);
  loopModeRef.current = loopMode;

  // Initialize Library & Audio Engine Listeners
  const refreshLibrary = useCallback(async () => {
    try {
      const [allTracks, allPlaylists, allHistory, stSettings, storage] = await Promise.all([
        getAllTracks(),
        getAllPlaylists(),
        getHistory(),
        getStoredSettings(),
        getStorageStats(),
      ]);

      setTracks(allTracks);
      setPlaylists(allPlaylists);
      setHistory(allHistory);
      setSettings(stSettings);
      setStorageInfo(storage);

      // If library has tracks and queue is default, set queue
      if (allTracks.length > 0 && queue.length === CURATED_TRACKS.length) {
        setQueue(allTracks);
      }
    } catch (err) {
      console.warn('Failed to load local DB:', err);
    }
  }, [queue.length]);

  useEffect(() => {
    refreshLibrary();

    // Check shared URL from Web Share Target API on startup
    const share = checkSharedUrl();
    if (share && share.url) {
      setInterceptedUrl(share.url);
      setActiveTab('discover');
    }

    setupLaunchHandler((url) => {
      setInterceptedUrl(url);
      setActiveTab('discover');
    });

    // PWA Install prompt listener
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    window.addEventListener('appinstalled', () => {
      setIsAppInstalled(true);
      setInstallPrompt(null);
    });

    // Online / Offline listener
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Audio Engine Listeners
    audioEngine.setListeners({
      onTimeUpdate: (cur, dur) => {
        setCurrentTime(cur);
        if (dur && isFinite(dur)) setDuration(dur);
      },
      onPlayStateChange: (playing) => {
        setIsPlaying(playing);
      },
      onTrackEnd: () => {
        handleTrackEnded();
      },
      onError: (e) => {
        console.warn('Audio playback error:', e);
        setIsPlaying(false);
      },
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [refreshLibrary]);

  // Handle Track Ended Logic (Loop One, Loop All, Next)
  const handleTrackEnded = useCallback(() => {
    const mode = loopModeRef.current;
    const curQueue = queueRef.current;
    const curIdx = queueIndexRef.current;

    if (mode === 'one') {
      const cur = curQueue[curIdx];
      if (cur) audioEngine.playTrack(cur, 0);
    } else if (curIdx < curQueue.length - 1) {
      const nextIdx = curIdx + 1;
      setQueueIndex(nextIdx);
      const nextT = curQueue[nextIdx];
      audioEngine.playTrack(nextT, 0);
      setCurrentTrack(nextT);
    } else if (mode === 'all' && curQueue.length > 0) {
      setQueueIndex(0);
      const firstT = curQueue[0];
      audioEngine.playTrack(firstT, 0);
      setCurrentTrack(firstT);
    } else {
      setIsPlaying(false);
    }
  }, []);

  // Update MediaSession Prev / Next controls
  useEffect(() => {
    audioEngine.setMediaSessionTrackHandlers(
      () => prevTrack(),
      () => nextTrack()
    );
  });

  // Play a Track
  const playTrack = async (track: Track, newQueue?: Track[], index?: number) => {
    if (newQueue && newQueue.length > 0) {
      setQueue(newQueue);
      const idx = index !== undefined ? index : newQueue.findIndex((t) => t.id === track.id);
      setQueueIndex(idx >= 0 ? idx : 0);
    } else if (!queue.some((t) => t.id === track.id)) {
      const updatedQueue = [track, ...queue];
      setQueue(updatedQueue);
      setQueueIndex(0);
    } else {
      const idx = queue.findIndex((t) => t.id === track.id);
      setQueueIndex(idx >= 0 ? idx : 0);
    }

    setCurrentTrack(track);
    await audioEngine.playTrack(track);
    setIsPlaying(true);

    // Save to history
    await addHistoryItem({
      url: track.originalUrl || track.streamUrl,
      platform: track.platform,
      title: track.title,
      artist: track.artist,
      thumbnailUrl: track.thumbnailUrl,
    });

    const allHistory = await getHistory();
    setHistory(allHistory);
  };

  const togglePlay = async () => {
    if (!currentTrack) {
      if (queue.length > 0) {
        await playTrack(queue[0]);
      }
      return;
    }
    const state = await audioEngine.togglePlay();
    setIsPlaying(state);
  };

  const pause = () => {
    audioEngine.pause();
    setIsPlaying(false);
  };

  const resume = async () => {
    await audioEngine.resume();
    setIsPlaying(true);
  };

  const seek = (seconds: number) => {
    audioEngine.seek(seconds);
    setCurrentTime(seconds);
  };

  const nextTrack = () => {
    if (queue.length === 0) return;
    let nextIdx = queueIndex + 1;
    if (isShuffle) {
      nextIdx = Math.floor(Math.random() * queue.length);
    } else if (nextIdx >= queue.length) {
      nextIdx = 0;
    }
    setQueueIndex(nextIdx);
    const t = queue[nextIdx];
    if (t) {
      setCurrentTrack(t);
      audioEngine.playTrack(t);
    }
  };

  const prevTrack = () => {
    if (queue.length === 0) return;
    if (currentTime > 3) {
      seek(0);
      return;
    }
    let pIdx = queueIndex - 1;
    if (pIdx < 0) {
      pIdx = queue.length - 1;
    }
    setQueueIndex(pIdx);
    const t = queue[pIdx];
    if (t) {
      setCurrentTrack(t);
      audioEngine.playTrack(t);
    }
  };

  const setVolume = (v: number) => {
    setVolumeState(v);
    setIsMuted(v === 0);
    audioEngine.setVolume(v);
  };

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      audioEngine.setVolume(volume || 0.8);
    } else {
      setIsMuted(true);
      audioEngine.setVolume(0);
    }
  };

  const cycleLoopMode = () => {
    if (loopMode === 'off') setLoopMode('all');
    else if (loopMode === 'all') setLoopMode('one');
    else setLoopMode('off');
  };

  const toggleShuffle = () => {
    setIsShuffle((prev) => !prev);
  };

  const setPlaybackRate = (rate: number) => {
    setPlaybackRateState(rate);
    audioEngine.setPlaybackRate(rate);
  };

  const addToQueue = (track: Track) => {
    if (!queue.some((t) => t.id === track.id)) {
      setQueue((prev) => [...prev, track]);
    }
  };

  const removeFromQueue = (index: number) => {
    setQueue((prev) => prev.filter((_, i) => i !== index));
    if (index === queueIndex) {
      nextTrack();
    } else if (index < queueIndex) {
      setQueueIndex((prev) => prev - 1);
    }
  };

  const clearQueue = () => {
    setQueue([]);
    setQueueIndex(0);
  };

  // Sleep Timer with smooth volume fade-out
  const startSleepTimer = (minutes: number) => {
    if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
    const totalSecs = minutes * 60;
    setSleepTimerSeconds(totalSecs);

    let remaining = totalSecs;
    sleepTimerRef.current = setInterval(() => {
      remaining -= 1;
      setSleepTimerSeconds(remaining);

      // Fade out volume in the last 15 seconds
      if (remaining <= 15 && remaining > 0) {
        audioEngine.setVolume(Math.max(0, (remaining / 15) * volume));
      }

      if (remaining <= 0) {
        if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
        audioEngine.pause();
        setIsPlaying(false);
        setSleepTimerSeconds(null);
        audioEngine.setVolume(volume); // reset volume
      }
    }, 1000);
  };

  const cancelSleepTimer = () => {
    if (sleepTimerRef.current) {
      clearInterval(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
    setSleepTimerSeconds(null);
    audioEngine.setVolume(volume);
  };

  // Library & Storage Actions
  const saveTrackToLibrary = async (track: Track) => {
    await dbSaveTrack(track);
    await refreshLibrary();
  };

  const deleteTrackFromLibrary = async (id: string) => {
    await dbDeleteTrack(id);
    await refreshLibrary();
  };

  const toggleFavorite = async (id: string) => {
    await dbToggleFavorite(id);
    await refreshLibrary();
    if (currentTrack && currentTrack.id === id) {
      setCurrentTrack((prev) => (prev ? { ...prev, isFavorite: !prev.isFavorite } : null));
    }
  };

  const downloadTrack = async (track: Track) => {
    await downloadAudioDirectly(track, (progress) => {
      setDownloadProgress((prev) => ({ ...prev, [track.id]: progress }));
    });
    await refreshLibrary();
    setTimeout(() => {
      setDownloadProgress((prev) => {
        const next = { ...prev };
        delete next[track.id];
        return next;
      });
    }, 3000);
  };

  const cacheOffline = async (track: Track) => {
    await cacheTrackOffline(track, (progress) => {
      setDownloadProgress((prev) => ({ ...prev, [track.id]: progress }));
    });
    await refreshLibrary();
    setTimeout(() => {
      setDownloadProgress((prev) => {
        const next = { ...prev };
        delete next[track.id];
        return next;
      });
    }, 2000);
  };

  const removeOfflineCache = async (trackId: string) => {
    await deleteAudioBlob(trackId);
    await refreshLibrary();
  };

  const createNewPlaylist = async (name: string, description: string): Promise<Playlist> => {
    const playlist: Playlist = {
      id: `pl_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      name,
      description,
      trackIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80',
    };
    await dbSavePlaylist(playlist);
    await refreshLibrary();
    return playlist;
  };

  const deletePlaylistById = async (id: string) => {
    await dbDeletePlaylist(id);
    await refreshLibrary();
  };

  const addTrackToPlaylistId = async (playlistId: string, trackId: string) => {
    await dbAddTrackToPlaylist(playlistId, trackId);
    await refreshLibrary();
  };

  const removeTrackFromPlaylistId = async (playlistId: string, trackId: string) => {
    await dbRemoveTrackFromPlaylist(playlistId, trackId);
    await refreshLibrary();
  };

  const clearUserHistory = async () => {
    await dbClearHistory();
    setHistory([]);
  };

  const updateSettings = async (newSettings: Partial<UserSettings>) => {
    const updated = await dbSaveSettings(newSettings);
    setSettings(updated);
  };

  const openTrimmer = (track: Track) => {
    setTrimmerTrack(track);
    setIsTrimmerOpen(true);
  };

  const triggerInstallPrompt = async (): Promise<boolean> => {
    if (!installPrompt) return false;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    setInstallPrompt(null);
    return outcome === 'accepted';
  };

  const clearInterceptedUrl = () => setInterceptedUrl(null);

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <AppContext.Provider
      value={{
        activeTab,
        setActiveTab,
        isFullPlayerOpen,
        setIsFullPlayerOpen,
        isSleepTimerOpen,
        setIsSleepTimerOpen,
        isTrimmerOpen,
        setIsTrimmerOpen,
        trimmerTrack,
        openTrimmer,
        visualizerMode,
        setVisualizerMode,

        currentTrack,
        isPlaying,
        currentTime,
        duration,
        progress,
        volume,
        isMuted,
        loopMode,
        isShuffle,
        playbackRate,
        queue,
        queueIndex,
        sleepTimerSeconds,

        playTrack,
        togglePlay,
        pause,
        resume,
        seek,
        nextTrack,
        prevTrack,
        setVolume,
        toggleMute,
        cycleLoopMode,
        toggleShuffle,
        setPlaybackRate,
        addToQueue,
        removeFromQueue,
        clearQueue,
        startSleepTimer,
        cancelSleepTimer,

        tracks,
        playlists,
        history,
        storageInfo,
        settings,
        isOnline,
        downloadProgress,

        saveTrackToLibrary,
        deleteTrackFromLibrary,
        toggleFavorite,
        downloadTrack,
        cacheOffline,
        removeOfflineCache,
        createNewPlaylist,
        deletePlaylistById,
        addTrackToPlaylistId,
        removeTrackFromPlaylistId,
        clearUserHistory,
        updateSettings,
        refreshLibrary,

        interceptedUrl,
        clearInterceptedUrl,

        installPrompt,
        triggerInstallPrompt,
        isAppInstalled,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
