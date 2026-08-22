import React, { useState } from 'react';
import { Moon, X, Clock, Check, Sparkles } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const SleepTimerModal: React.FC = () => {
  const {
    isSleepTimerOpen,
    setIsSleepTimerOpen,
    sleepTimerSeconds,
    startSleepTimer,
    cancelSleepTimer,
  } = useApp();

  const [customMinutes, setCustomMinutes] = useState('20');

  if (!isSleepTimerOpen) return null;

  const presets = [15, 30, 45, 60, 90];

  const formatRemaining = (totalSecs: number) => {
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${m}m ${s < 10 ? '0' : ''}${s}s`;
  };

  const handleStartCustom = () => {
    const mins = parseInt(customMinutes, 10);
    if (!isNaN(mins) && mins > 0) {
      startSleepTimer(mins);
      setIsSleepTimerOpen(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in select-none">
      <div className="relative w-full max-w-sm rounded-3xl p-6 bg-gradient-to-b from-[#181a30] via-[#121422] to-[#0d0e1a] border border-white/15 shadow-2xl space-y-5">
        {/* Close Button */}
        <button
          onClick={() => setIsSleepTimerOpen(false)}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full hover:bg-white/10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Title */}
        <div className="flex items-center space-x-3">
          <div className="p-3 rounded-2xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
            <Moon className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Sleep Timer</h3>
            <p className="text-xs text-slate-400">Audio will gently fade out and stop.</p>
          </div>
        </div>

        {/* Active Timer Display */}
        {sleepTimerSeconds !== null && (
          <div className="p-4 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-center space-y-1">
            <span className="text-xs font-mono text-cyan-300 uppercase tracking-wider">
              Timer In Progress
            </span>
            <div className="text-3xl font-black font-mono text-white tracking-widest">
              {formatRemaining(sleepTimerSeconds)}
            </div>
            <button
              onClick={cancelSleepTimer}
              className="mt-2 text-xs font-semibold text-pink-400 hover:text-pink-300 underline"
            >
              Cancel Sleep Timer
            </button>
          </div>
        )}

        {/* Presets Grid */}
        <div className="space-y-2">
          <span className="text-xs font-mono uppercase text-slate-400">Quick Presets</span>
          <div className="grid grid-cols-3 gap-2">
            {presets.map((mins) => (
              <button
                key={mins}
                onClick={() => {
                  startSleepTimer(mins);
                  setIsSleepTimerOpen(false);
                }}
                className="py-2.5 rounded-xl bg-white/5 hover:bg-cyan-500/20 text-slate-200 hover:text-cyan-300 font-mono text-xs font-bold border border-white/10 transition-all active:scale-95"
              >
                {mins} Mins
              </button>
            ))}
          </div>
        </div>

        {/* Custom Input */}
        <div className="space-y-2 pt-2 border-t border-white/10">
          <span className="text-xs font-mono uppercase text-slate-400">Custom Duration</span>
          <div className="flex space-x-2">
            <input
              type="number"
              min="1"
              max="240"
              value={customMinutes}
              onChange={(e) => setCustomMinutes(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-white/15 rounded-xl text-white font-mono text-sm text-center outline-none focus:border-cyan-400"
              placeholder="Minutes"
            />
            <button
              onClick={handleStartCustom}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-cyan-400 text-black font-bold text-xs shadow-glow-pink transition-all active:scale-95 whitespace-nowrap"
            >
              Start
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
