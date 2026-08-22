import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Link,
  Clipboard,
  Play,
  Download,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Scissors,
  Plus,
  Heart,
  Share2,
  Cpu,
  Flame,
  Radio,
  Layers,
  HelpCircle,
  Check,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { extractMedia, CURATED_TRACKS, detectPlatform } from '../services/extractor';
import { Track } from '../types';
import { downloadProjectZip } from '../assets/projectZipBase64';

export const DiscoverTab: React.FC = () => {
  const {
    playTrack,
    downloadTrack,
    downloadProgress,
    saveTrackToLibrary,
    toggleFavorite,
    openTrimmer,
    interceptedUrl,
    clearInterceptedUrl,
  } = useApp();

  const [inputUrl, setInputUrl] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedTrack, setExtractedTrack] = useState<Track | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [showTierInfo, setShowTierInfo] = useState(false);

  // Auto-fill and auto-extract when intercepted from Android Web Share Target
  useEffect(() => {
    if (interceptedUrl) {
      setInputUrl(interceptedUrl);
      handleExtract(interceptedUrl);
      clearInterceptedUrl();
    }
  }, [interceptedUrl]);

  const handlePaste = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setInputUrl(text);
          handleExtract(text);
        }
      }
    } catch (err) {
      console.warn('Clipboard read failed:', err);
    }
  };

  const handleExtract = async (urlToExtract = inputUrl) => {
    const target = urlToExtract.trim();
    if (!target) return;

    setIsExtracting(true);
    setExtractionError(null);
    setExtractedTrack(null);

    try {
      const result = await extractMedia(target);
      if (result.success && result.track) {
        setExtractedTrack(result.track);
        // Automatically save to library
        await saveTrackToLibrary(result.track);
      } else {
        setExtractionError(result.error || 'Could not resolve media stream from this link.');
      }
    } catch (err: any) {
      setExtractionError(err.message || 'Decentralized extraction encountered an error.');
    } finally {
      setIsExtracting(false);
    }
  };

  const currentPlatform = detectPlatform(inputUrl);

  const trackProg = extractedTrack ? downloadProgress[extractedTrack.id] : null;
  const isDownloadingExtracted = trackProg && trackProg.stage !== 'ready' && trackProg.stage !== 'idle';

  return (
    <div className="space-y-6 pb-24 max-w-5xl mx-auto px-3 sm:px-4 pt-3">
      {/* High-Visibility Full Source Code Download Banner */}
      <div className="rounded-2xl p-4 bg-gradient-to-r from-pink-500/20 via-purple-600/20 to-cyan-500/20 border-2 border-cyan-400 shadow-glow-cyan flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center space-x-3 text-center sm:text-left">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-pink-500 to-cyan-400 p-[2px] flex-shrink-0 shadow-glow-pink">
            <div className="w-full h-full bg-[#0a0b10] rounded-[10px] flex items-center justify-center">
              <Download className="w-6 h-6 text-cyan-400 animate-bounce" />
            </div>
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-black text-white">
              Download Complete VibeCatch Project ZIP
            </h3>
            <p className="text-xs text-slate-300">
              All 51 production files: React components, 3-Tier Engine, PWA SW, 3D Vinyl & configs.
            </p>
          </div>
        </div>
        <button
          onClick={downloadProjectZip}
          className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-400 text-black font-extrabold text-xs sm:text-sm shadow-glow-pink hover:scale-105 active:scale-95 transition-all flex items-center justify-center space-x-2 text-center whitespace-nowrap cursor-pointer"
        >
          <Download className="w-4 h-4 text-black" />
          <span>DOWNLOAD ZIP (247 KB)</span>
        </button>
      </div>

      {/* Hero Decentralized Extractor Card */}
      <div className="relative rounded-3xl p-5 sm:p-7 bg-gradient-to-b from-[#16182c] via-[#121424] to-[#0d0e1a] border border-white/10 shadow-2xl overflow-hidden">
        {/* Glow ambient background */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-bl from-pink-500/15 via-purple-600/10 to-transparent blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-gradient-to-tr from-cyan-500/15 via-blue-600/10 to-transparent blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-4">
          {/* Tag & 3-Tier Strategy Info Badge */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <button
              onClick={() => setShowTierInfo(!showTierInfo)}
              className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-xs font-mono hover:bg-cyan-500/20 transition-colors"
            >
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>3-Tier Audio Resolution Strategy</span>
              <HelpCircle className="w-3 h-3 text-cyan-400/80" />
            </button>
            <div className="flex items-center space-x-2 text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>$0 Server Infrastructure</span>
            </div>
          </div>

          {/* 3-Tier Strategy Explainer Accordion */}
          {showTierInfo && (
            <div className="p-4 rounded-2xl bg-[#0e101f] border border-cyan-500/30 text-xs space-y-2 animate-in fade-in">
              <h4 className="font-bold text-white flex items-center space-x-1.5">
                <Cpu className="w-4 h-4 text-pink-400" />
                <span>How VibeCatch Resolves Audio Client-Side:</span>
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                <div className="p-2.5 rounded-xl bg-white/5 border border-emerald-500/20">
                  <span className="font-bold text-emerald-400 block font-mono">🎯 Tier 1: Tagged Studio</span>
                  <p className="text-[11px] text-slate-300 mt-1">
                    Detects official artist & song tags to stream pristine studio-quality audio.
                  </p>
                </div>
                <div className="p-2.5 rounded-xl bg-white/5 border border-cyan-500/20">
                  <span className="font-bold text-cyan-400 block font-mono">🧠 Tier 2: Caption NLP</span>
                  <p className="text-[11px] text-slate-300 mt-1">
                    Parses video captions & #hashtags when labeled as &quot;original sound&quot; to match studio masters.
                  </p>
                </div>
                <div className="p-2.5 rounded-xl bg-white/5 border border-purple-500/20">
                  <span className="font-bold text-purple-400 block font-mono">⚡ Tier 3: Raw CDN</span>
                  <p className="text-[11px] text-slate-300 mt-1">
                    Extracts custom edits, speed-ups & remixes directly from video CDN into browser memory.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white tracking-tight">
              Stream & Download <br className="hidden xs:inline" />
              <span className="bg-gradient-to-r from-pink-500 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                TikTok & YouTube Audio
              </span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1.5 max-w-xl">
              Paste any TikTok video, sound, or YouTube/YT Music link. Audio processing runs 100% on your device CPU for instant streaming and offline caching.
            </p>
          </div>

          {/* Platform Pills */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span
              onClick={() => handleExtract('https://www.tiktok.com/@vibecatch/video/739102910283')}
              className={`px-3 py-1 rounded-xl text-xs font-mono cursor-pointer transition-all border ${
                currentPlatform === 'tiktok'
                  ? 'bg-pink-500/20 text-pink-300 border-pink-500/50 shadow-glow-pink'
                  : 'bg-white/5 text-slate-400 border-white/10 hover:text-slate-200'
              }`}
            >
              🎵 TikTok Sounds
            </span>
            <span
              onClick={() => handleExtract('https://www.youtube.com/watch?v=jfKfPfyJRdk')}
              className={`px-3 py-1 rounded-xl text-xs font-mono cursor-pointer transition-all border ${
                currentPlatform === 'youtube'
                  ? 'bg-red-500/20 text-red-300 border-red-500/50 shadow-glow-pink'
                  : 'bg-white/5 text-slate-400 border-white/10 hover:text-slate-200'
              }`}
            >
              📺 YouTube / YT Music
            </span>
            <span
              className={`px-3 py-1 rounded-xl text-xs font-mono border ${
                currentPlatform === 'direct'
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-glow-cyan'
                  : 'bg-white/5 text-slate-400 border-white/10'
              }`}
            >
              ⚡ Direct Audio URLs
            </span>
          </div>

          {/* Central Input Group */}
          <div className="space-y-3 pt-2">
            <div className="relative flex items-center">
              <div className="absolute left-3.5 text-slate-400 pointer-events-none">
                <Link className="w-5 h-5 text-cyan-400" />
              </div>
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleExtract()}
                placeholder="Paste TikTok or YouTube link (e.g. vm.tiktok.com/... or youtu.be/...)"
                className="w-full pl-11 pr-24 sm:pr-28 py-3.5 bg-[#090b14]/90 border border-white/15 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 rounded-2xl text-white text-sm placeholder-slate-500 transition-all font-mono outline-none shadow-inner"
              />
              <button
                onClick={handlePaste}
                className="absolute right-2 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 hover:text-white text-xs font-medium flex items-center space-x-1 transition-all active:scale-95 border border-white/10"
                title="Paste from clipboard"
              >
                <Clipboard className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Paste</span>
              </button>
            </div>

            {/* Extract Action Button */}
            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                onClick={() => handleExtract()}
                disabled={isExtracting || !inputUrl.trim()}
                className="flex-1 py-3.5 px-6 rounded-2xl bg-gradient-to-r from-pink-500 via-purple-600 to-cyan-400 hover:from-pink-600 hover:to-cyan-500 text-white font-bold text-sm shadow-glow-pink flex items-center justify-center space-x-2 transition-all active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isExtracting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Resolving 3-Tier Media Stream...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Extract & Stream Audio</span>
                  </>
                )}
              </button>

              {/* Quick Try Demo Button */}
              <button
                onClick={() => {
                  const demo = CURATED_TRACKS[0];
                  setInputUrl(demo.originalUrl || demo.streamUrl);
                  handleExtract(demo.originalUrl || demo.streamUrl);
                }}
                className="px-4 py-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-mono flex items-center justify-center space-x-1.5 transition-all"
              >
                <Radio className="w-3.5 h-3.5 text-pink-400" />
                <span>Test Demo Track</span>
              </button>
            </div>
          </div>

          {/* Error Banner */}
          {extractionError && (
            <div className="flex items-start space-x-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs animate-in fade-in">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{extractionError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Real-Time Extraction Result Card with 3-Tier Badge */}
      {extractedTrack && (
        <div className="rounded-3xl p-5 sm:p-6 bg-gradient-to-r from-[#17192f] via-[#121422] to-[#17192f] border border-cyan-500/40 shadow-glow-cyan animate-in fade-in zoom-in-95 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="flex items-center space-x-1.5 text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/30">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{extractedTrack.resolution?.tierLabel || 'Resolved Media Stream'}</span>
            </span>
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-mono text-cyan-300 bg-cyan-500/20 px-2 py-0.5 rounded border border-cyan-500/30">
                Confidence: {extractedTrack.resolution?.sourceConfidence || 95}%
              </span>
              <span className="text-xs font-mono text-slate-300 bg-white/10 px-2 py-0.5 rounded">
                {extractedTrack.bitrate || '320kbps MP3'}
              </span>
            </div>
          </div>

          {extractedTrack.resolution?.tierDescription && (
            <p className="text-xs text-slate-300 font-mono bg-white/5 p-2 rounded-xl border border-white/10">
              ⚡ {extractedTrack.resolution.tierDescription}
            </p>
          )}

          <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-4 sm:space-y-0 sm:space-x-4">
            {/* Thumbnail */}
            <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden border border-white/20 flex-shrink-0 shadow-lg group">
              <img
                src={extractedTrack.thumbnailUrl}
                alt={extractedTrack.title}
                className="w-full h-full object-cover"
              />
              <button
                onClick={() => playTrack(extractedTrack)}
                className="absolute inset-0 m-auto w-10 h-10 rounded-full bg-pink-500/90 text-white flex items-center justify-center shadow-glow-pink hover:scale-110 transition-transform"
              >
                <Play className="w-5 h-5 fill-current translate-x-0.5" />
              </button>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h3 className="text-lg sm:text-xl font-bold text-white truncate">
                {extractedTrack.title}
              </h3>
              <p className="text-sm text-slate-300 truncate">{extractedTrack.artist}</p>
              <div className="flex items-center space-x-3 text-xs text-slate-400 mt-1 font-mono">
                <span>Duration: {Math.floor(extractedTrack.duration / 60)}:{(extractedTrack.duration % 60).toString().padStart(2, '0')}</span>
                <span>•</span>
                <span className="capitalize">{extractedTrack.platform} Platform</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-white/10">
            {/* 1. Play Stream */}
            <button
              onClick={() => playTrack(extractedTrack)}
              className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white text-xs font-semibold flex items-center justify-center space-x-1.5 shadow-glow-pink transition-all active:scale-95"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Play Now</span>
            </button>

            {/* 2. Download MP3 Direct Action */}
            <button
              onClick={() => downloadTrack(extractedTrack)}
              disabled={Boolean(isDownloadingExtracted)}
              className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 text-white text-xs font-semibold flex items-center justify-center space-x-1.5 shadow-glow-cyan transition-all active:scale-95 disabled:opacity-60"
            >
              <Download className={`w-3.5 h-3.5 ${isDownloadingExtracted ? 'animate-bounce' : ''}`} />
              <span>{isDownloadingExtracted ? `${trackProg?.percent}%` : 'Save MP3'}</span>
            </button>

            {/* 3. Trim Ringtone */}
            <button
              onClick={() => openTrimmer(extractedTrack)}
              className="py-2.5 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 text-xs font-medium flex items-center justify-center space-x-1.5 transition-all active:scale-95"
            >
              <Scissors className="w-3.5 h-3.5 text-cyan-400" />
              <span>Cut Ringtone</span>
            </button>

            {/* 4. Favorite */}
            <button
              onClick={() => toggleFavorite(extractedTrack.id)}
              className="py-2.5 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 text-xs font-medium flex items-center justify-center space-x-1.5 transition-all active:scale-95"
            >
              <Heart
                className={`w-3.5 h-3.5 ${
                  extractedTrack.isFavorite ? 'text-pink-500 fill-pink-500' : 'text-slate-400'
                }`}
              />
              <span>{extractedTrack.isFavorite ? 'Favorited' : 'Favorite'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Section 1: Viral TikTok Sounds Carousel */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Flame className="w-5 h-5 text-pink-500 animate-pulse" />
            <h2 className="text-lg sm:text-xl font-bold text-white">
              TikTok Viral Sounds (2026 Hits)
            </h2>
          </div>
          <span className="text-xs font-mono text-pink-400">Zero Server Cost</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {CURATED_TRACKS.filter((t) => t.platform === 'tiktok').map((track) => {
            const prog = downloadProgress[track.id];
            const isDown = prog && prog.stage !== 'ready' && prog.stage !== 'idle';

            return (
              <div
                key={track.id}
                className="group relative rounded-2xl p-3.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-pink-500/40 backdrop-blur-md transition-all duration-300 shadow-card flex items-center space-x-3"
              >
                <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 border border-white/10">
                  <img
                    src={track.thumbnailUrl}
                    alt={track.title}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                  />
                  <button
                    onClick={() => playTrack(track, CURATED_TRACKS)}
                    className="absolute inset-0 m-auto w-8 h-8 rounded-full bg-pink-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-glow-pink"
                  >
                    <Play className="w-4 h-4 fill-current translate-x-0.5" />
                  </button>
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-white truncate group-hover:text-pink-300 transition-colors">
                    {track.title}
                  </h4>
                  <p className="text-xs text-slate-400 truncate">{track.artist}</p>
                  <div className="flex items-center space-x-2 text-[10px] font-mono text-cyan-400 mt-1">
                    <span>{track.resolution?.tierLabel.split(':')[0] || 'Tier 1'}</span>
                    <span>•</span>
                    <span>320kbps</span>
                  </div>
                </div>

                <div className="flex flex-col space-y-1">
                  <button
                    onClick={() => playTrack(track, CURATED_TRACKS)}
                    className="p-2 rounded-lg bg-pink-500/20 hover:bg-pink-500 text-pink-300 hover:text-white transition-colors"
                    title="Play"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                  </button>
                  <button
                    onClick={() => downloadTrack(track)}
                    disabled={Boolean(isDown)}
                    className="p-2 rounded-lg bg-white/5 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 transition-colors"
                    title="Download MP3"
                  >
                    <Download className={`w-3.5 h-3.5 ${isDown ? 'animate-bounce text-cyan-400' : ''}`} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 2: YouTube Music Top Charts */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <TrendingUp className="w-5 h-5 text-red-500" />
            <h2 className="text-lg sm:text-xl font-bold text-white">
              YouTube Music Trending Top Charts
            </h2>
          </div>
          <span className="text-xs font-mono text-cyan-400">Direct CDN Stream</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {CURATED_TRACKS.filter((t) => t.platform === 'youtube').map((track) => {
            const prog = downloadProgress[track.id];
            const isDown = prog && prog.stage !== 'ready' && prog.stage !== 'idle';

            return (
              <div
                key={track.id}
                className="group relative rounded-2xl p-3.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-cyan-500/40 backdrop-blur-md transition-all duration-300 shadow-card flex items-center space-x-3"
              >
                <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 border border-white/10">
                  <img
                    src={track.thumbnailUrl}
                    alt={track.title}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                  />
                  <button
                    onClick={() => playTrack(track, CURATED_TRACKS)}
                    className="absolute inset-0 m-auto w-8 h-8 rounded-full bg-cyan-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-glow-cyan"
                  >
                    <Play className="w-4 h-4 fill-current translate-x-0.5" />
                  </button>
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-white truncate group-hover:text-cyan-300 transition-colors">
                    {track.title}
                  </h4>
                  <p className="text-xs text-slate-400 truncate">{track.artist}</p>
                  <div className="flex items-center space-x-2 text-[10px] font-mono text-red-400 mt-1">
                    <span>{track.views} plays</span>
                    <span>•</span>
                    <span>HD Studio</span>
                  </div>
                </div>

                <div className="flex flex-col space-y-1">
                  <button
                    onClick={() => playTrack(track, CURATED_TRACKS)}
                    className="p-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500 text-cyan-300 hover:text-white transition-colors"
                    title="Play"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                  </button>
                  <button
                    onClick={() => downloadTrack(track)}
                    disabled={Boolean(isDown)}
                    className="p-2 rounded-lg bg-white/5 hover:bg-pink-500/20 text-slate-400 hover:text-pink-300 transition-colors"
                    title="Download MP3"
                  >
                    <Download className={`w-3.5 h-3.5 ${isDown ? 'animate-bounce text-pink-400' : ''}`} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
