import { Track, EqualizerBand, EqualizerPreset } from '../types';
import { getPlayableAudioUrl } from './demuxer';
import { isDirectStreamUrl, playbackChain } from './downloadUrl';

export const EQUALIZER_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQUALIZER_PRESETS: EqualizerPreset[] = [
  { id: 'flat', name: 'Flat (Default)', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bassBoost: 0 },
  { id: 'bass', name: 'Super Bass Boost 🔊', gains: [7, 6, 4, 2, 0, -1, 0, 2, 4, 5], bassBoost: 6 },
  { id: 'edm', name: 'Cyber EDM / Phonk ⚡', gains: [6, 5, 2, -1, -2, 1, 3, 5, 6, 7], bassBoost: 4 },
  { id: 'pop', name: 'Pop & Viral Hits ✨', gains: [-1, 1, 3, 4, 3, 0, 2, 3, 4, 3], bassBoost: 1 },
  { id: 'rock', name: 'Rock & High Energy 🎸', gains: [4, 3, 1, -1, -2, 1, 3, 5, 6, 6], bassBoost: 2 },
  { id: 'vocal', name: 'Vocal Clarity 🎙️', gains: [-3, -2, 0, 2, 4, 5, 4, 2, 1, 0], bassBoost: 0 },
  { id: 'lofi', name: 'Lo-Fi Chill & Warm ☕', gains: [3, 4, 2, 1, 0, -2, -3, -4, -5, -6], bassBoost: 3 },
  { id: 'acoustic', name: 'Acoustic & Crisp 🎻', gains: [2, 1, 0, 1, 2, 3, 3, 4, 4, 3], bassBoost: 0 }
];

export interface AudioEngineListeners {
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onTrackEnd?: () => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  onError?: (err: any) => void;
}

class AudioEngine {
  private audio: HTMLAudioElement;
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private bassFilter: BiquadFilterNode | null = null;
  private gainNode: GainNode | null = null;
  private pannerNode: StereoPannerNode | null = null;
  private analyser: AnalyserNode | null = null;
  private isInitialized = false;

  private currentTrack: Track | null = null;
  private currentResolvedUrl = '';
  private fallbackUsed = false;
  private listeners: AudioEngineListeners = {};
  private currentPresetId = 'flat';
  private bassBoostGain = 0;
  private playbackRate = 1.0;
  private isBatteryLow = false;

  constructor() {
    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';
    this.audio.preload = 'auto';

    this.setupAudioEvents();
    this.checkBatterySaver();
  }

  private setupAudioEvents() {
    this.audio.addEventListener('timeupdate', () => {
      this.listeners.onTimeUpdate?.(this.audio.currentTime, this.audio.duration || 0);
    });

    this.audio.addEventListener('ended', () => {
      this.listeners.onTrackEnd?.();
    });

    this.audio.addEventListener('play', () => {
      this.listeners.onPlayStateChange?.(true);
      this.updateMediaSession();
    });

    this.audio.addEventListener('pause', () => {
      this.listeners.onPlayStateChange?.(false);
    });

    this.audio.addEventListener('error', (e) => {
      console.warn('Audio element error:', e);
      this.listeners.onError?.(e);
      this.retryNextPlaybackSource();
    });
  }

  public initContext() {
    if (this.isInitialized) return;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtx();

      // Master Gain
      this.gainNode = this.audioCtx.createGain();

      // Analyser Node for Visualizers
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;

      // Bass Boost Low-Shelf Filter
      this.bassFilter = this.audioCtx.createBiquadFilter();
      this.bassFilter.type = 'lowshelf';
      this.bassFilter.frequency.value = 60;
      this.bassFilter.gain.value = this.bassBoostGain;

      // 10-Band Graphic Equalizer
      this.eqFilters = EQUALIZER_FREQUENCIES.map((freq, index) => {
        const filter = this.audioCtx!.createBiquadFilter();
        if (index === 0) {
          filter.type = 'lowshelf';
        } else if (index === EQUALIZER_FREQUENCIES.length - 1) {
          filter.type = 'highshelf';
        } else {
          filter.type = 'peaking';
          filter.Q.value = 1.4;
        }
        filter.frequency.value = freq;
        filter.gain.value = 0;
        return filter;
      });

      // Spatial Panner (if supported)
      if (this.audioCtx.createStereoPanner) {
        this.pannerNode = this.audioCtx.createStereoPanner();
      }

      // Media Element Source
      this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);

      // Connect pipeline:
      // Source -> Bass -> EQ Filters (0..9) -> Panner -> Gain -> Analyser -> Destination
      let lastNode: AudioNode = this.sourceNode;

      if (this.bassFilter) {
        lastNode.connect(this.bassFilter);
        lastNode = this.bassFilter;
      }

      for (const filter of this.eqFilters) {
        lastNode.connect(filter);
        lastNode = filter;
      }

      if (this.pannerNode) {
        lastNode.connect(this.pannerNode);
        lastNode = this.pannerNode;
      }

      lastNode.connect(this.gainNode);
      this.gainNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);

      this.isInitialized = true;
    } catch (e) {
      console.warn('Web Audio API context init warning:', e);
    }
  }

  public setListeners(listeners: AudioEngineListeners) {
    this.listeners = { ...this.listeners, ...listeners };
  }

  public async playTrack(track: Track, startTime = 0): Promise<void> {
    this.initContext();

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    this.currentTrack = track;
    const resolvedUrl = await getPlayableAudioUrl(track);
    this.currentResolvedUrl = resolvedUrl;
    this.fallbackUsed = false;

    // Direct googlevideo streams send no ACAO headers; forcing 'anonymous'
    // would block plain media playback. Plain <audio> needs no CORS at all.
    this.audio.crossOrigin = isDirectStreamUrl(resolvedUrl) ? null : 'anonymous';

    this.audio.src = resolvedUrl;
    this.audio.currentTime = startTime;
    this.audio.playbackRate = this.playbackRate;

    try {
      await this.audio.play();
      this.setupMediaSessionHandlers();
      this.updateMediaSession();
    } catch (err) {
      console.warn('Auto-play blocked or failed:', err);
    }
  }

  /** One-shot fallback: on media error, move to the next source in the
   *  playback chain (e.g. relay download) instead of silently dying. */
  private retryNextPlaybackSource() {
    const track = this.currentTrack;
    if (!track || this.fallbackUsed) return;
    this.fallbackUsed = true;

    const src = this.currentResolvedUrl;
    const chain = playbackChain(track, null);
    const idx = chain.indexOf(src);
    if (idx === -1) {
      this.loadNextSource(chain[0]);
      return;
    }
    this.loadNextSource(chain[idx + 1]);
  }

  private loadNextSource(nextUrl?: string) {
    if (!nextUrl) return;
    this.currentResolvedUrl = nextUrl;
    this.audio.crossOrigin = isDirectStreamUrl(nextUrl) ? null : 'anonymous';
    this.audio.src = nextUrl;
    this.audio.currentTime = 0;
    this.audio.play().catch((err) => console.warn('Fallback replay failed:', err));
  }

  public async togglePlay(): Promise<boolean> {
    this.initContext();

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    if (this.audio.paused) {
      await this.audio.play();
      return true;
    } else {
      this.audio.pause();
      return false;
    }
  }

  public pause(): void {
    this.audio.pause();
  }

  public async resume(): Promise<void> {
    this.initContext();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    await this.audio.play();
  }

  public seek(seconds: number): void {
    if (isFinite(seconds)) {
      this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration || 9999));
    }
  }

  public setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.audio.volume = clamped;
    if (this.gainNode) {
      this.gainNode.gain.setValueAtTime(clamped, this.audioCtx?.currentTime || 0);
    }
  }

  public setPlaybackRate(rate: number): void {
    const clamped = Math.max(0.5, Math.min(2.5, rate));
    this.playbackRate = clamped;
    this.audio.playbackRate = clamped;
  }

  public getPlaybackRate(): number {
    return this.playbackRate;
  }

  public setPan(pan: number): void {
    if (this.pannerNode && this.audioCtx) {
      const clamped = Math.max(-1, Math.min(1, pan));
      this.pannerNode.pan.setValueAtTime(clamped, this.audioCtx.currentTime);
    }
  }

  public setEqualizerBand(index: number, gainDb: number): void {
    if (this.eqFilters[index] && this.audioCtx) {
      const clamped = Math.max(-12, Math.min(12, gainDb));
      this.eqFilters[index].gain.setValueAtTime(clamped, this.audioCtx.currentTime);
    }
  }

  public setBassBoost(gainDb: number): void {
    this.bassBoostGain = Math.max(0, Math.min(12, gainDb));
    if (this.bassFilter && this.audioCtx) {
      this.bassFilter.gain.setValueAtTime(this.bassBoostGain, this.audioCtx.currentTime);
    }
  }

  public applyPreset(preset: EqualizerPreset): void {
    this.currentPresetId = preset.id;
    preset.gains.forEach((gain, index) => {
      this.setEqualizerBand(index, gain);
    });
    if (preset.bassBoost !== undefined) {
      this.setBassBoost(preset.bassBoost);
    }
  }

  public getBands(): EqualizerBand[] {
    return EQUALIZER_FREQUENCIES.map((freq, i) => ({
      frequency: freq,
      gain: this.eqFilters[i]?.gain?.value || 0,
      label: freq >= 1000 ? `${freq / 1000}k` : `${freq}`,
    }));
  }

  public getBassBoostGain(): number {
    return this.bassBoostGain;
  }

  public getCurrentPresetId(): string {
    return this.currentPresetId;
  }

  public getAnalyserData(frequencyArray: Uint8Array<ArrayBuffer>): void {
    if (this.analyser) {
      this.analyser.getByteFrequencyData(frequencyArray as any);
    }
  }

  public getTimeDomainData(timeArray: Uint8Array<ArrayBuffer>): void {
    if (this.analyser) {
      this.analyser.getByteTimeDomainData(timeArray as any);
    }
  }

  public getAudioElement(): HTMLAudioElement {
    return this.audio;
  }

  public getCurrentTime(): number {
    return this.audio.currentTime || 0;
  }

  public getDuration(): number {
    return this.audio.duration || 0;
  }

  public isPlaying(): boolean {
    return !this.audio.paused && !this.audio.ended;
  }

  public getCurrentTrack(): Track | null {
    return this.currentTrack;
  }

  // MediaSession Native Android & iOS Integration
  private updateMediaSession() {
    if ('mediaSession' in navigator && this.currentTrack) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.currentTrack.title,
        artist: this.currentTrack.artist,
        album: 'VibeCatch Decentralized Audio',
        artwork: [
          { src: this.currentTrack.thumbnailUrl, sizes: '96x96', type: 'image/jpeg' },
          { src: this.currentTrack.thumbnailUrl, sizes: '128x128', type: 'image/jpeg' },
          { src: this.currentTrack.thumbnailUrl, sizes: '192x192', type: 'image/jpeg' },
          { src: this.currentTrack.thumbnailUrl, sizes: '512x512', type: 'image/jpeg' },
        ],
      });
    }
  }

  private setupMediaSessionHandlers() {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {
        this.resume();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        this.pause();
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) {
          this.seek(details.seekTime);
        }
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        this.seek(this.audio.currentTime + (details.seekOffset || 10));
      });
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        this.seek(this.audio.currentTime - (details.seekOffset || 10));
      });
    }
  }

  public setMediaSessionTrackHandlers(onPrev?: () => void, onNext?: () => void) {
    if ('mediaSession' in navigator) {
      if (onPrev) {
        navigator.mediaSession.setActionHandler('previoustrack', onPrev);
      }
      if (onNext) {
        navigator.mediaSession.setActionHandler('nexttrack', onNext);
      }
    }
  }

  private checkBatterySaver() {
    if ('getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        const update = () => {
          this.isBatteryLow = battery.level < 0.2 && !battery.charging;
        };
        update();
        battery.addEventListener('levelchange', update);
        battery.addEventListener('chargingchange', update);
      }).catch(() => {
        // ignore
      });
    }
  }

  public isBatterySaverActive(): boolean {
    return this.isBatteryLow;
  }
}

export const audioEngine = new AudioEngine();
