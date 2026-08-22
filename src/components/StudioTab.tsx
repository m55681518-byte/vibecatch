import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Zap,
  Volume2,
  Gauge,
  Scissors,
  RotateCcw,
  Sparkles,
  Radio,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  audioEngine,
  EQUALIZER_FREQUENCIES,
  EQUALIZER_PRESETS,
} from '../services/audioEngine';
import { EqualizerPreset } from '../types';

export const StudioTab: React.FC = () => {
  const { currentTrack, openTrimmer, playbackRate, setPlaybackRate } = useApp();
  const [bands, setBands] = useState<number[]>(new Array(10).fill(0));
  const [activePreset, setActivePreset] = useState<string>('flat');
  const [bassBoost, setBassBoost] = useState<number>(0);
  const [pan, setPan] = useState<number>(0);

  useEffect(() => {
    // Read initial equalizer state from audioEngine
    const curBands = audioEngine.getBands().map((b) => b.gain);
    setBands(curBands);
    setBassBoost(audioEngine.getBassBoostGain());
    setActivePreset(audioEngine.getCurrentPresetId());
  }, []);

  const handleBandChange = (index: number, val: number) => {
    const next = [...bands];
    next[index] = val;
    setBands(next);
    setActivePreset('custom');
    audioEngine.setEqualizerBand(index, val);
  };

  const handlePresetSelect = (preset: EqualizerPreset) => {
    setActivePreset(preset.id);
    setBands([...preset.gains]);
    setBassBoost(preset.bassBoost || 0);
    audioEngine.applyPreset(preset);
  };

  const handleBassBoostChange = (val: number) => {
    setBassBoost(val);
    audioEngine.setBassBoost(val);
  };

  const handlePanChange = (val: number) => {
    setPan(val);
    audioEngine.setPan(val);
  };

  const resetEQ = () => {
    const flat = EQUALIZER_PRESETS[0];
    handlePresetSelect(flat);
    setPan(0);
    audioEngine.setPan(0);
    setPlaybackRate(1.0);
  };

  return (
    <div className="space-y-6 pb-24 max-w-5xl mx-auto px-3 sm:px-4 pt-3">
      {/* Header Banner */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <Sliders className="w-5 h-5 text-pink-500" />
            <h1 className="text-xl sm:text-2xl font-black text-white">
              Web Audio 10-Band Studio
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Hardware-accelerated DSP processing via client Web Audio API Biquad Filters.
          </p>
        </div>

        <button
          onClick={resetEQ}
          className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-mono border border-white/10"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset</span>
        </button>
      </div>

      {/* EQ Presets Pills */}
      <div className="space-y-2">
        <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
          Acoustic DSP Presets
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {EQUALIZER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handlePresetSelect(preset)}
              className={`p-3 rounded-2xl text-xs font-semibold text-left transition-all border ${
                activePreset === preset.id
                  ? 'bg-gradient-to-r from-pink-500/20 to-purple-500/20 text-pink-300 border-pink-500/50 shadow-glow-pink'
                  : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
              }`}
            >
              <span className="block font-bold">{preset.name}</span>
              <span className="text-[10px] text-slate-400 font-mono mt-0.5 block">
                {preset.bassBoost ? `+${preset.bassBoost}dB Bass` : 'Linear Curve'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 10-Band Graphic Sliders */}
      <div className="rounded-3xl p-5 bg-[#121424] border border-white/10 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono uppercase tracking-wider text-cyan-400">
            10-Band Graphic Equalizer (-12dB to +12dB)
          </span>
          <span className="text-xs font-mono text-pink-400">
            {activePreset === 'custom' ? 'Custom EQ' : activePreset.toUpperCase()}
          </span>
        </div>

        {/* Sliders Container */}
        <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 sm:gap-4 pt-4 pb-2 items-end">
          {EQUALIZER_FREQUENCIES.map((freq, idx) => {
            const gain = bands[idx] || 0;
            const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}Hz`;

            return (
              <div key={freq} className="flex flex-col items-center space-y-3">
                {/* dB Value Badge */}
                <span
                  className={`text-[10px] font-mono font-bold ${
                    gain > 0
                      ? 'text-pink-400'
                      : gain < 0
                      ? 'text-cyan-400'
                      : 'text-slate-500'
                  }`}
                >
                  {gain > 0 ? `+${gain.toFixed(0)}` : gain.toFixed(0)}
                </span>

                {/* Vertical Slider Bar */}
                <div className="h-44 sm:h-48 flex items-center justify-center relative">
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={1}
                    value={gain}
                    onChange={(e) => handleBandChange(idx, parseFloat(e.target.value))}
                    className="w-40 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-pink-500 -rotate-90 origin-center"
                  />
                </div>

                {/* Frequency Label */}
                <span className="text-[10px] font-mono text-slate-400">{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bass Boost & Spatial Audio Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* 1. Bass Boost Knob */}
        <div className="rounded-3xl p-5 bg-[#121424] border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Zap className="w-4 h-4 text-pink-500" />
              <span className="text-sm font-bold text-white">Sub-Bass Boost</span>
            </div>
            <span className="text-xs font-mono text-pink-400 font-bold">+{bassBoost} dB</span>
          </div>
          <p className="text-[11px] text-slate-400">
            60Hz Low-shelf filter for heavy phonk and electronic kick drums.
          </p>
          <input
            type="range"
            min={0}
            max={12}
            step={1}
            value={bassBoost}
            onChange={(e) => handleBassBoostChange(parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-pink-500"
          />
        </div>

        {/* 2. Stereo Panner */}
        <div className="rounded-3xl p-5 bg-[#121424] border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Radio className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-bold text-white">3D Spatial Pan</span>
            </div>
            <span className="text-xs font-mono text-cyan-400 font-bold">
              {pan === 0 ? 'Center' : pan < 0 ? `L ${Math.abs(pan * 100).toFixed(0)}%` : `R ${(pan * 100).toFixed(0)}%`}
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            Stereo Panner Node shifts audio across binaural sound stage.
          </p>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={pan}
            onChange={(e) => handlePanChange(parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
        </div>

        {/* 3. Speed / Pitch Controller */}
        <div className="rounded-3xl p-5 bg-[#121424] border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Gauge className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-bold text-white">Playback Speed</span>
            </div>
            <span className="text-xs font-mono text-purple-400 font-bold">{playbackRate}x</span>
          </div>
          <p className="text-[11px] text-slate-400">
            Accelerate or slow tempo from 0.5x to 2.0x without pitch distortion.
          </p>
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.05}
            value={playbackRate}
            onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
          />
        </div>
      </div>

      {/* Ringtone Cutter CTA */}
      {currentTrack && (
        <div className="rounded-3xl p-5 bg-gradient-to-r from-pink-500/15 via-purple-600/10 to-cyan-500/15 border border-pink-500/30 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-3 rounded-2xl bg-pink-500/20 text-pink-400 border border-pink-500/40">
              <Scissors className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Audio Cutter & Ringtone Maker</h3>
              <p className="text-xs text-slate-400">
                Trim &quot;{currentTrack.title}&quot; to 15s/30s ringtone or custom WAV clip.
              </p>
            </div>
          </div>
          <button
            onClick={() => openTrimmer(currentTrack)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white text-xs font-bold shadow-glow-pink transition-all active:scale-95 cursor-pointer whitespace-nowrap"
          >
            Launch Trimmer
          </button>
        </div>
      )}
    </div>
  );
};
