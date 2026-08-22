import React, { useEffect, useRef } from 'react';
import { Track } from '../../types';

interface LyricsViewProps {
  track: Track | null;
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
}

export const LyricsView: React.FC<LyricsViewProps> = ({ track, currentTime, duration, onSeek }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const lyrics = track?.lyrics || [
    'No synchronised lyrics found for this audio track.',
    'Decentralized in-memory stream is active.',
    'Enjoy high-fidelity client-side playback on VibeCatch.',
  ];

  // Estimate current lyric index based on track progress
  const activeIndex = Math.min(
    lyrics.length - 1,
    Math.floor((currentTime / (duration || 1)) * lyrics.length)
  );

  useEffect(() => {
    if (containerRef.current) {
      const activeEl = containerRef.current.querySelector(`[data-index="${activeIndex}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeIndex]);

  const handleLineClick = (index: number) => {
    if (duration > 0) {
      const targetTime = (index / lyrics.length) * duration;
      onSeek(targetTime);
    }
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full max-h-[360px] overflow-y-auto px-4 py-8 space-y-6 text-center select-none scrollbar-thin scrollbar-thumb-pink-500/20"
    >
      <div className="text-xs uppercase tracking-widest text-cyan-400 font-mono mb-2">
        Live Synchronized Lyrics
      </div>
      {lyrics.map((line, idx) => {
        const isActive = idx === activeIndex;
        const isPast = idx < activeIndex;

        return (
          <p
            key={idx}
            data-index={idx}
            onClick={() => handleLineClick(idx)}
            className={`cursor-pointer transition-all duration-300 transform font-medium ${
              isActive
                ? 'text-2xl md:text-3xl text-white font-bold scale-105 drop-shadow-[0_0_15px_rgba(0,242,254,0.6)] py-2'
                : isPast
                ? 'text-lg md:text-xl text-slate-500 hover:text-slate-300 opacity-60'
                : 'text-lg md:text-xl text-slate-400/80 hover:text-slate-200 opacity-80'
            }`}
          >
            {line}
          </p>
        );
      })}
    </div>
  );
};
