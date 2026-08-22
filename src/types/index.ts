export type PlatformType = 'tiktok' | 'youtube' | 'direct' | 'sample';

export type ResolutionTier = 'tier1_studio' | 'tier2_nlp' | 'tier3_raw_cdn';

export interface ResolutionMetadata {
  tier: ResolutionTier;
  tierLabel: string;
  tierDescription: string;
  sourceConfidence: number; // 0 to 100%
  extractedKeywords?: string[];
  originalSoundName?: string;
  matchedStudioTitle?: string;
  matchedStudioArtist?: string;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number; // in seconds
  thumbnailUrl: string;
  streamUrl: string;
  platform: PlatformType;
  originalUrl?: string;
  addedAt: number;
  playsCount: number;
  isFavorite: boolean;
  isOfflineAvailable: boolean;
  offlineBlobId?: string;
  audioFormat: 'mp3' | 'm4a' | 'webm' | 'wav' | 'aac' | 'ogg';
  bitrate?: string;
  views?: string | number;
  fileSizeBytes?: number;
  lyrics?: string[];
  channelName?: string;
  channelUrl?: string;
  resolution?: ResolutionMetadata;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  coverUrl?: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
  isSystem?: boolean;
}

export interface StoredAudioBlob {
  id: string;
  trackId: string;
  blob: Blob;
  mimeType: string;
  sizeBytes: number;
  savedAt: number;
}

export interface ExtractionResult {
  success: boolean;
  track?: Track;
  error?: string;
  rawDetails?: {
    author?: string;
    description?: string;
    likeCount?: string | number;
    shareCount?: string | number;
    commentCount?: string | number;
    soundTitle?: string;
    soundAuthor?: string;
    caption?: string;
    hashtags?: string[];
  };
}

export type TabType = 'discover' | 'search' | 'library' | 'studio' | 'settings';

export type VisualizerMode = 'vinyl3d' | 'spectrum' | 'waveform' | 'radial' | 'particles' | 'lyrics';

export type VisualizerQuality = 'ultra' | 'balanced' | 'low' | 'canvas2d' | 'disabled';

export interface EqualizerBand {
  frequency: number;
  gain: number; // -12 to +12 dB
  label: string;
  node?: BiquadFilterNode;
}

export interface EqualizerPreset {
  id: string;
  name: string;
  gains: number[]; // 10 bands
  bassBoost?: number;
}

export interface DemuxProgress {
  stage: 'idle' | 'resolving' | 'fetching' | 'demuxing' | 'buffering' | 'ready' | 'error';
  percent: number;
  bytesLoaded: number;
  totalBytes: number;
  message: string;
}

export interface StorageInfo {
  usageBytes: number;
  quotaBytes: number;
  usageFormatted: string;
  quotaFormatted: string;
  percentUsed: number;
  trackCount: number;
  offlineTrackCount: number;
}

export interface UserSettings {
  theme: 'cyber' | 'oled' | 'aurora' | 'sunset' | 'neon';
  visualizerQuality: VisualizerQuality;
  autoPlayNext: boolean;
  defaultBitrate: '320' | '192' | '128';
  normalizeVolume: boolean;
  crossfadeDuration: number;
  spatialAudio: boolean;
  batterySaverOptimization: boolean;
  preferredTier: 'auto' | 'studio_first' | 'raw_cdn_first';
}

export interface HistoryItem {
  id: string;
  url: string;
  platform: PlatformType;
  title: string;
  artist: string;
  thumbnailUrl: string;
  timestamp: number;
}

export interface SponsoredItem {
  id: string;
  title: string;
  subtitle: string;
  brand: string;
  badge: string;
  description: string;
  imageUrl: string;
  ctaText: string;
  targetUrl: string;
  category: 'audio_gear' | 'streaming' | 'studio_plugins' | 'creator_tools';
}
