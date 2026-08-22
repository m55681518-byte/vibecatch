import React, { useState } from 'react';
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  Download,
  Scissors,
  Moon,
  Sliders,
  ListMusic,
  Disc3,
  Activity,
  Radio,
  FileText,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { VisualizerMode } from '../types';
import { Vinyl3D } from './Visualizers/Vinyl3D';
import { SpectrumVisualizer } from './Visualizers/SpectrumVisualizer';
import { LyricsView } from './Visualizers/LyricsView';

export const FullPlayerModal: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    togglePlay,
    seek,
    nextTrack,
    prevTrack,
    currentTime,
    duration,
    progress,
    loopMode,
    cycleLoopMode,
    isShuffle,
    toggleShuffle,
    playbackRate,
    setPlaybackRate,
    volume,
    setVolume,
    isMuted,
    toggleMute,
    toggleFavorite,
    isFullPlayerOpen,
    setIsFullPlayerOpen,
    visualizerMode,
    setVisualizerMode,
    downloadTrack,
    downloadProgress,
    openTrimmer,
    setIsSleepTimerOpen,
    sleepTimerSeconds,
    queue,
    queueIndex,
    playTrack,
    removeFromQueue,
    setActiveTab,
    settings,
  } = useApp();

  const [showQueue, setShowQueue] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  if (!isFullPlayerOpen || !currentTrack) return null;

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    seek(val);
  };

  const trackProgress = downloadProgress[currentTrack.id];
  const isDownloading = trackProgress && trackProgress.stage !== 'ready' && trackProgress.stage !== 'idle';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-[#101222] via-[#0c0d18] to-[#07080e] backdrop-blur-3xl overflow-y-auto select-none animate-in fade-in zoom-in-95 duration-200">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 max-w-2xl mx-auto w-full flex-shrink-0">
        <button
          onClick={() => setIsFullPlayerOpen(false)}
          className="w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 active:scale-90 transition-all"
          title="Minimize"
        >
          <ChevronDown className="w-6 h-6" />
        </button>

        <div className="text-center">
          <span className="text-[10px] font-mono tracking-widest text-cyan-400 uppercase">
            Playing From {currentTrack.platform === 'tiktok' ? 'TikTok Sound' : currentTrack.platform === 'youtube' ? 'YouTube Music' : 'Direct Audio'}
          </span>
          <p className="text-xs font-bold text-white truncate max-w-[200px]">
            {currentTrack.title}
          </p>
        </div>

        <button
          onClick={() => setShowQueue(!showQueue)}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
            showQueue
              ? 'text-cyan-400 bg-cyan-500/20 border border-cyan-500/40'
              : 'text-slate-400 hover:text-white hover:bg-white/10'
          }`}
          title="Up Next Queue"
        >
          <ListMusic className="w-5 h-5" />
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col items-center justify-between max-w-xl mx-auto w-full px-4 py-3 space-y-4">
        {/* Visualizer Mode Switcher Pill */}
        {!showQueue && (
          <div className="flex items-center space-x-1 p-1 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
            <button
              onClick={() => setVisualizerMode('vinyl3d')}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-xl text-xs font-medium transition-all ${
                visualizerMode === 'vinyl3d'
                  ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white shadow-glow-pink'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Disc3 className="w-3.5 h-3.5" />
              <span>3D Vinyl</span>
            </button>
            <button
              onClick={() => setVisualizerMode('spectrum')}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-xl text-xs font-medium transition-all ${
                visualizerMode === 'spectrum'
                  ? 'bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-glow-cyan'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Spectrum</span>
            </button>
            <button
              onClick={() => setVisualizerMode('waveform')}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-xl text-xs font-medium transition-all ${
                visualizerMode === 'waveform'
                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-glow-purple'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Wave</span>
            </button>
            <button
              onClick={() => setVisualizerMode('lyrics')}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-xl text-xs font-medium transition-all ${
                visualizerMode === 'lyrics'
                  ? 'bg-gradient-to-r from-pink-500 to-cyan-400 text-white shadow-glow-pink'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Lyrics</span>
            </button>
          </div>
        )}

        {/* Center Display: 3D Vinyl / Visualizer / Lyrics OR Queue Drawer */}
        <div className="w-full flex-1 min-h-[260px] max-h-[360px] flex items-center justify-center relative">
          {showQueue ? (
            /* Up Next Queue Drawer */
            <div className="w-full h-full bg-[#121424]/90 border border-white/10 rounded-2xl p-3 overflow-y-auto space-y-2">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <span className="text-xs font-mono text-cyan-400 uppercase tracking-wider">
                  Up Next ({queue.length} Tracks)
                </span>
                <span className="text-[11px] text-slate-400">Tap to play</span>
              </div>
              {queue.map((t, idx) => (
                <div
                  key={t.id + '_' + idx}
                  onClick={() => playTrack(t, queue, idx)}
                  className={`flex items-center justify-between p-2 rounded-xl cursor-pointer transition-all ${
                    idx === queueIndex
                      ? 'bg-gradient-to-r from-pink-500/20 to-cyan-500/20 border border-cyan-500/40 text-white'
                      : 'hover:bg-white/5 text-slate-300'
                  }`}
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <span className="font-mono text-xs text-slate-500 w-4 text-center">
                      {idx + 1}
                    </span>
                    <img
                      src={t.thumbnailUrl}
                      alt={t.title}
                      className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{t.title}</p>
                      <p className="text-xs text-slate-400 truncate">{t.artist}</p>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-slate-400 pl-2">
                    {formatTime(t.duration)}
                  </span>
                </div>
              ))}
            </div>
          ) : visualizerMode === 'vinyl3d' ? (
            <Vinyl3D track={currentTrack} isPlaying={isPlaying} quality={settings.visualizerQuality} />
          ) : visualizerMode === 'lyrics' ? (
            <LyricsView track={currentTrack} currentTime={currentTime} duration={duration} onSeek={seek} />
          ) : (
            <SpectrumVisualizer mode={visualizerMode} isPlaying={isPlaying} />
          )}
        </div>

        {/* Track Title, Artist & Actions */}
        <div className="w-full space-y-1">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1 pr-2">
              <h2 className="text-xl sm:text-2xl font-black text-white truncate drop-shadow-sm">
                {currentTrack.title}
              </h2>
              <div className="flex items-center space-x-2 text-sm text-slate-400">
                <span className="truncate">{currentTrack.artist}</span>
                <span>•</span>
                <span className="font-mono text-xs text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
                  {currentTrack.bitrate || '320kbps MP3'}
                </span>
                {currentTrack.isOfflineAvailable && (
                  <span className="font-mono text-[10px] text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-500/30">
                    Offline Ready
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={() => toggleFavorite(currentTrack.id)}
              className="w-11 h-11 rounded-full flex items-center justify-center text-slate-400 hover:text-pink-400 active:scale-90 transition-transform"
            >
              <Heart
                className={`w-6 h-6 ${
                  currentTrack.isFavorite ? 'text-pink-500 fill-pink-500 shadow-glow-pink' : ''
                }`}
              />
            </button>
          </div>

          {/* Scrubbable Progress Slider */}
          <div className="space-y-1 pt-2">
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleProgressChange}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-pink-500 focus:outline-none"
            />
            <div className="flex justify-between text-xs font-mono text-slate-400">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        </div>

        {/* Primary Controls Dock */}
        <div className="flex items-center justify-between w-full max-w-sm px-2">
          {/* Shuffle */}
          <button
            onClick={toggleShuffle}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              isShuffle ? 'text-cyan-400 shadow-glow-cyan' : 'text-slate-400 hover:text-white'
            }`}
            title="Shuffle"
          >
            <Shuffle className="w-5 h-5" />
          </button>

          {/* Previous Track */}
          <button
            onClick={prevTrack}
            className="w-12 h-12 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:scale-90 transition-all"
            title="Previous Track"
          >
            <SkipBack className="w-6 h-6 fill-current" />
          </button>

          {/* Big Center Play / Pause */}
          <button
            onClick={togglePlay}
            className="w-16 h-16 rounded-full bg-gradient-to-tr from-pink-500 via-purple-500 to-cyan-400 p-[2px] shadow-glow-pink active:scale-95 transition-transform"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            <div className="w-full h-full bg-[#0a0b10] hover:bg-black/50 rounded-full flex items-center justify-center text-white transition-colors">
              {isPlaying ? (
                <Pause className="w-8 h-8 fill-current text-cyan-400" />
              ) : (
                <Play className="w-8 h-8 fill-current text-pink-400 translate-x-0.5" />
              )}
            </div>
          </button>

          {/* Next Track */}
          <button
            onClick={nextTrack}
            className="w-12 h-12 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:scale-90 transition-all"
            title="Next Track"
          >
            <SkipForward className="w-6 h-6 fill-current" />
          </button>

          {/* Loop Mode */}
          <button
            onClick={cycleLoopMode}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              loopMode !== 'off' ? 'text-pink-400 shadow-glow-pink' : 'text-slate-400 hover:text-white'
            }`}
            title={`Loop Mode: ${loopMode}`}
          >
            {loopMode === 'one' ? <Repeat1 className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}
          </button>
        </div>

        {/* Auxiliary Feature Dock (Download, Ringtone, Speed, Equalizer, Sleep Timer) */}
        <div className="grid grid-cols-5 gap-2 w-full pt-1 pb-2 border-t border-white/10">
          {/* 1. Download MP3 Direct Action */}
          <button
            onClick={() => downloadTrack(currentTrack)}
            disabled={isDownloading}
            className="flex flex-col items-center justify-center p-2 rounded-xl bg-white/5 hover:bg-pink-500/20 text-slate-300 hover:text-pink-300 transition-all active:scale-95 border border-white/5"
            title="Download MP3 directly to device"
          >
            <Download className={`w-4 h-4 ${isDownloading ? 'animate-bounce text-pink-400' : ''}`} />
            <span className="text-[10px] mt-1 font-mono">
              {isDownloading ? `${trackProgress.percent}%` : 'Save MP3'}
            </span>
          </button>

          {/* 2. Audio Cutter / Ringtone */}
          <button
            onClick={() => openTrimmer(currentTrack)}
            className="flex flex-col items-center justify-center p-2 rounded-xl bg-white/5 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 transition-all active:scale-95 border border-white/5"
            title="Create Ringtone / Cut Snippet"
          >
            <Scissors className="w-4 h-4" />
            <span className="text-[10px] mt-1 font-mono">Ringtone</span>
          </button>

          {/* 3. Speed Controller */}
          <div className="relative">
            <button
              onClick={() => setShowSpeedMenu(!showSpeedMenu)}
              className="w-full flex flex-col items-center justify-center p-2 rounded-xl bg-white/5 hover:bg-purple-500/20 text-slate-300 hover:text-purple-300 transition-all active:scale-95 border border-white/5"
              title="Playback Speed"
            >
              <span className="text-xs font-mono font-bold text-cyan-400">{playbackRate}x</span>
              <span className="text-[10px] mt-1 font-mono">Speed</span>
            </button>

            {showSpeedMenu && (
              <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-50 bg-[#151728] border border-white/20 rounded-xl shadow-2xl p-1 grid grid-cols-3 gap-1 w-44">
                {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => {
                      setPlaybackRate(rate);
                      setShowSpeedMenu(false);
                    }}
                    className={`py-1 text-xs font-mono rounded-lg ${
                      playbackRate === rate
                        ? 'bg-pink-500 text-white font-bold'
                        : 'text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 4. Audio Equalizer Studio */}
          <button
            onClick={() => {
              setIsFullPlayerOpen(false);
              setActiveTab('studio');
            }}
            className="flex flex-col items-center justify-center p-2 rounded-xl bg-white/5 hover:bg-purple-500/20 text-slate-300 hover:text-purple-300 transition-all active:scale-95 border border-white/5"
            title="10-Band Equalizer & Bass Boost"
          >
            <Sliders className="w-4 h-4" />
            <span className="text-[10px] mt-1 font-mono">Equalizer</span>
          </button>

          {/* 5. Sleep Timer */}
          <button
            onClick={() => setIsSleepTimerOpen(true)}
            className={`flex flex-col items-center justify-center p-2 rounded-xl transition-all active:scale-95 border ${
              sleepTimerSeconds
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-glow-cyan'
                : 'bg-white/5 hover:bg-amber-500/20 text-slate-300 hover:text-amber-300 border-white/5'
            }`}
            title="Sleep Timer"
          >
            <Moon className="w-4 h-4" />
            <span className="text-[10px] mt-1 font-mono">
              {sleepTimerSeconds ? `${Math.ceil(sleepTimerSeconds / 60)}m` : 'Timer'}
            </span>
          </button>
        </div>

        {/* Volume Slider (Mobile & Desktop) */}
        <div className="flex items-center space-x-3 w-full max-w-xs px-4">
          <button onClick={toggleMute} className="text-slate-400 hover:text-white">
            {isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4 text-pink-400" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={isMuted ? 0 : volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
        </div>
      </div>
    </div>
  );
};
