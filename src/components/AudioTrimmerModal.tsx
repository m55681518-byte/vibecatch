import React, { useState, useEffect, useRef } from 'react';
import { Scissors, X, Play, Pause, Download, Sparkles, CheckCircle2, Music } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { trimAudioSegment } from '../services/demuxer';
import confetti from 'canvas-confetti';

export const AudioTrimmerModal: React.FC = () => {
  const { isTrimmerOpen, setIsTrimmerOpen, trimmerTrack } = useApp();

  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(30);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportComplete, setExportComplete] = useState(false);

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (trimmerTrack) {
      const dur = trimmerTrack.duration || 120;
      setStartTime(0);
      setEndTime(Math.min(30, dur));
      setExportComplete(false);
    }
  }, [trimmerTrack]);

  if (!isTrimmerOpen || !trimmerTrack) return null;

  const duration = trimmerTrack.duration || 180;
  const clipDuration = Math.max(0, endTime - startTime);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    return `${m}:${s < 10 ? '0' : ''}${s}.${ms}`;
  };

  const handleTogglePreview = () => {
    if (!previewAudioRef.current) {
      const aud = new Audio(trimmerTrack.streamUrl);
      previewAudioRef.current = aud;
      aud.addEventListener('ended', () => setPreviewPlaying(false));
      aud.addEventListener('timeupdate', () => {
        if (aud.currentTime >= endTime) {
          aud.pause();
          aud.currentTime = startTime;
          setPreviewPlaying(false);
        }
      });
    }

    const aud = previewAudioRef.current;
    if (previewPlaying) {
      aud.pause();
      setPreviewPlaying(false);
    } else {
      aud.currentTime = startTime;
      aud.play();
      setPreviewPlaying(true);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      if (previewAudioRef.current) previewAudioRef.current.pause();
      setPreviewPlaying(false);

      const result = await trimAudioSegment(trimmerTrack, startTime, endTime);

      // Trigger download
      const a = document.createElement('a');
      a.href = result.url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 1500);

      setExportComplete(true);
      try {
        confetti({
          particleCount: 70,
          spread: 60,
          origin: { y: 0.7 },
          colors: ['#00f2fe', '#ff007f', '#a855f7'],
        });
      } catch (e) {
        // ignore
      }
    } catch (err) {
      console.warn('Trim failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const setPreset = (length: number) => {
    const newEnd = Math.min(startTime + length, duration);
    setEndTime(newEnd);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in select-none">
      <div className="relative w-full max-w-lg rounded-3xl p-6 bg-gradient-to-b from-[#181a30] via-[#121422] to-[#0d0e1a] border border-cyan-500/30 shadow-2xl space-y-5">
        {/* Close Button */}
        <button
          onClick={() => {
            if (previewAudioRef.current) previewAudioRef.current.pause();
            setIsTrimmerOpen(false);
          }}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full hover:bg-white/10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center space-x-3">
          <div className="p-3 rounded-2xl bg-gradient-to-tr from-pink-500 to-cyan-400 text-black">
            <Scissors className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Audio Cutter & Ringtone Maker</h3>
            <p className="text-xs text-slate-400">
              Decoded & encoded directly in your device CPU ($0 server).
            </p>
          </div>
        </div>

        {/* Track Preview Info */}
        <div className="flex items-center space-x-3 p-3 rounded-2xl bg-white/5 border border-white/10">
          <img
            src={trimmerTrack.thumbnailUrl}
            alt={trimmerTrack.title}
            className="w-12 h-12 rounded-xl object-cover"
          />
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold text-white truncate">{trimmerTrack.title}</h4>
            <p className="text-xs text-slate-400 truncate">{trimmerTrack.artist}</p>
          </div>
        </div>

        {/* Waveform Slicer Mock & Range */}
        <div className="space-y-3 bg-[#0a0c16] p-4 rounded-2xl border border-white/10">
          {/* Visual Waveform Representation */}
          <div className="h-16 flex items-center justify-between space-x-1 px-2 relative overflow-hidden rounded-xl bg-slate-900/60">
            {Array.from({ length: 48 }).map((_, i) => {
              const posRatio = i / 48;
              const trackTime = posRatio * duration;
              const isInside = trackTime >= startTime && trackTime <= endTime;

              return (
                <div
                  key={i}
                  className={`w-1.5 rounded-full transition-all ${
                    isInside
                      ? 'bg-gradient-to-t from-cyan-400 to-pink-500 shadow-glow-cyan'
                      : 'bg-slate-700 opacity-40'
                  }`}
                  style={{
                    height: `${Math.max(20, Math.sin(i * 0.5) * 45 + 35)}%`,
                  }}
                />
              );
            })}
          </div>

          {/* Time Readouts */}
          <div className="flex justify-between items-center text-xs font-mono">
            <div>
              <span className="text-slate-400 block text-[10px]">START TIME</span>
              <span className="text-cyan-400 font-bold text-sm">{formatTime(startTime)}</span>
            </div>
            <div className="text-center">
              <span className="text-slate-400 block text-[10px]">SELECTED DURATION</span>
              <span className="text-pink-400 font-bold text-sm">{clipDuration.toFixed(1)}s</span>
            </div>
            <div className="text-right">
              <span className="text-slate-400 block text-[10px]">END TIME</span>
              <span className="text-purple-400 font-bold text-sm">{formatTime(endTime)}</span>
            </div>
          </div>

          {/* Range Sliders */}
          <div className="space-y-2 pt-2">
            <div>
              <label className="text-[10px] font-mono text-slate-400">Start Marker (sec)</label>
              <input
                type="range"
                min={0}
                max={duration - 1}
                step={0.5}
                value={startTime}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setStartTime(Math.min(val, endTime - 1));
                }}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono text-slate-400">End Marker (sec)</label>
              <input
                type="range"
                min={1}
                max={duration}
                step={0.5}
                value={endTime}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setEndTime(Math.max(val, startTime + 1));
                }}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
            </div>
          </div>
        </div>

        {/* Quick Presets */}
        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono text-slate-400">Presets:</span>
          <button
            onClick={() => setPreset(15)}
            className="px-3 py-1 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-mono border border-white/10"
          >
            15s Story
          </button>
          <button
            onClick={() => setPreset(30)}
            className="px-3 py-1 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-mono border border-white/10"
          >
            30s Ringtone
          </button>
          <button
            onClick={() => setPreset(60)}
            className="px-3 py-1 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-mono border border-white/10"
          >
            60s Cut
          </button>
        </div>

        {/* Actions Dock */}
        <div className="flex space-x-2 pt-2 border-t border-white/10">
          <button
            onClick={handleTogglePreview}
            className="flex-1 py-3 rounded-2xl bg-white/10 hover:bg-white/15 text-white font-semibold text-xs flex items-center justify-center space-x-2 transition-all active:scale-95"
          >
            {previewPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            <span>{previewPlaying ? 'Pause Preview' : 'Preview Cut'}</span>
          </button>

          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-pink-500 to-cyan-400 hover:from-pink-600 hover:to-cyan-500 text-black font-bold text-xs shadow-glow-pink flex items-center justify-center space-x-2 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {isExporting ? (
              <>
                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                <span>Encoding WAV...</span>
              </>
            ) : exportComplete ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Exported!</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Export Ringtone</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
