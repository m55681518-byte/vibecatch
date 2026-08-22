import React from 'react';
import {
  Play,
  Pause,
  SkipForward,
  Heart,
  Maximize2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useApp } from '../context/AppContext';

export const FloatingPlayer: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    togglePlay,
    nextTrack,
    toggleFavorite,
    currentTime,
    duration,
    progress,
    seek,
    setIsFullPlayerOpen,
    isMuted,
    toggleMute,
  } = useApp();

  if (!currentTrack) return null;

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    if (duration > 0) {
      seek(ratio * duration);
    }
  };

  return (
    <div className="fixed bottom-16 left-0 right-0 z-20 px-2 sm:px-4 pointer-events-none">
      <div className="max-w-3xl mx-auto backdrop-blur-2xl bg-[#121420]/95 border border-white/15 rounded-2xl shadow-2xl overflow-hidden pointer-events-auto transform transition-all duration-300 hover:border-pink-500/40">
        {/* Scrubbable Progress Bar on top border */}
        <div
          onClick={handleProgressClick}
          className="w-full h-1.5 bg-slate-800/80 cursor-pointer relative group"
        >
          <div
            className="h-full bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-400 relative transition-all duration-100"
            style={{ width: `${progress * 100}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-glow-cyan opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Content Bar */}
        <div className="flex items-center justify-between px-3 py-2 sm:py-2.5">
          {/* Left: Thumbnail & Song Info */}
          <div
            onClick={() => setIsFullPlayerOpen(true)}
            className="flex items-center space-x-3 cursor-pointer min-w-0 flex-1 group select-none pr-2"
          >
            {/* Spinning Mini Vinyl Thumbnail */}
            <div className="relative w-11 h-11 sm:w-12 sm:h-12 flex-shrink-0 rounded-xl overflow-hidden border border-white/20 shadow-md">
              <img
                src={currentTrack.thumbnailUrl}
                alt={currentTrack.title}
                className={`w-full h-full object-cover ${isPlaying ? 'animate-spin-slow' : ''}`}
              />
              <div className="absolute inset-0 m-auto w-3 h-3 bg-[#0a0b10] border border-cyan-400 rounded-full" />
            </div>

            {/* Title & Artist */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center space-x-2">
                <p className="text-sm font-bold text-white truncate group-hover:text-cyan-300 transition-colors">
                  {currentTrack.title}
                </p>
                {/* Platform Badge */}
                <span
                  className={`text-[9px] uppercase font-mono px-1 py-0.2 rounded border flex-shrink-0 ${
                    currentTrack.platform === 'tiktok'
                      ? 'bg-pink-500/20 text-pink-400 border-pink-500/40'
                      : currentTrack.platform === 'youtube'
                      ? 'bg-red-500/20 text-red-400 border-red-500/40'
                      : 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40'
                  }`}
                >
                  {currentTrack.platform === 'tiktok' ? 'TikTok' : currentTrack.platform === 'youtube' ? 'YT Music' : 'Audio'}
                </span>
              </div>
              <div className="flex items-center space-x-2 text-xs text-slate-400">
                <span className="truncate max-w-[140px] sm:max-w-[200px]">{currentTrack.artist}</span>
                <span>•</span>
                <span className="font-mono text-[11px] text-cyan-400/90">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Quick Controls */}
          <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
            {/* Mute / Unmute (Desktop/Tablet) */}
            <button
              onClick={toggleMute}
              className="hidden sm:flex items-center justify-center w-9 h-9 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-pink-400" /> : <Volume2 className="w-4 h-4" />}
            </button>

            {/* Favorite / Like */}
            <button
              onClick={() => toggleFavorite(currentTrack.id)}
              className="flex items-center justify-center w-9 h-9 rounded-full text-slate-400 hover:text-pink-400 transition-colors active:scale-90"
              title="Like"
            >
              <Heart
                className={`w-4 h-4 ${
                  currentTrack.isFavorite ? 'text-pink-500 fill-pink-500 shadow-glow-pink' : ''
                }`}
              />
            </button>

            {/* Play / Pause Main Button */}
            <button
              onClick={togglePlay}
              className="w-10 h-10 rounded-full bg-gradient-to-r from-pink-500 to-cyan-400 flex items-center justify-center text-[#0a0b10] shadow-glow-pink hover:scale-105 active:scale-95 transition-transform"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current translate-x-0.5" />
              )}
            </button>

            {/* Next Track */}
            <button
              onClick={nextTrack}
              className="flex items-center justify-center w-9 h-9 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors active:scale-90"
              title="Next Track"
            >
              <SkipForward className="w-4 h-4 fill-current" />
            </button>

            {/* Expand to Full Player */}
            <button
              onClick={() => setIsFullPlayerOpen(true)}
              className="flex items-center justify-center w-9 h-9 rounded-full text-slate-400 hover:text-cyan-400 hover:bg-white/10 transition-colors"
              title="Open Fullscreen Player"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
