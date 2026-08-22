import React, { useState, useEffect } from 'react';
import {
  Search as SearchIcon,
  Play,
  Download,
  Plus,
  Flame,
  Radio,
  Music2,
  Sparkles,
  Check,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { searchTracks, SPONSORED_ITEMS } from '../services/extractor';
import { Track } from '../types';
import { SponsoredCard } from './SponsoredCard';

export const SearchTab: React.FC = () => {
  const { playTrack, downloadTrack, downloadProgress, addToQueue } = useApp();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [results, setResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addedIds, setAddedIds] = useState<Record<string, boolean>>({});

  const categories = [
    { id: 'all', label: 'All Hits' },
    { id: 'tiktok', label: 'TikTok Viral 🔥' },
    { id: 'youtube', label: 'YouTube Music 📺' },
    { id: 'phonk', label: 'Phonk / Drift 🏎️' },
    { id: 'lofi', label: 'Lo-Fi Chill ☕' },
    { id: 'synthwave', label: 'Synthwave 80s 🌆' },
  ];

  useEffect(() => {
    let isCancelled = false;
    const fetchResults = async () => {
      setIsSearching(true);
      try {
        const res = await searchTracks(query, category);
        if (!isCancelled) {
          setResults(res);
        }
      } catch (e) {
        console.warn('Search error:', e);
      } finally {
        if (!isCancelled) setIsSearching(false);
      }
    };

    const timer = setTimeout(fetchResults, 200);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [query, category]);

  const handleAddToQueue = (track: Track) => {
    addToQueue(track);
    setAddedIds((prev) => ({ ...prev, [track.id]: true }));
    setTimeout(() => {
      setAddedIds((prev) => {
        const next = { ...prev };
        delete next[track.id];
        return next;
      });
    }, 1500);
  };

  const renderTierPill = (track: Track) => {
    const tier = track.resolution?.tier || 'tier1_studio';
    if (tier === 'tier1_studio') {
      return <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded">Tier 1: Studio</span>;
    }
    if (tier === 'tier2_nlp') {
      return <span className="text-[9px] font-mono text-cyan-400 bg-cyan-500/10 px-1 py-0.2 rounded">Tier 2: NLP Match</span>;
    }
    return <span className="text-[9px] font-mono text-purple-400 bg-purple-500/10 px-1 py-0.2 rounded">Tier 3: Raw CDN</span>;
  };

  return (
    <div className="space-y-5 pb-24 max-w-5xl mx-auto px-3 sm:px-4 pt-3">
      {/* Search Bar */}
      <div className="relative">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
          <SearchIcon className="w-5 h-5 text-cyan-400" />
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs, viral sounds, artists, phonk, lo-fi..."
          className="w-full pl-12 pr-4 py-3.5 bg-[#121424] border border-white/15 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 rounded-2xl text-white text-sm placeholder-slate-500 transition-all font-mono outline-none shadow-xl"
        />
        {isSearching && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-pink-500/30 border-t-pink-500 rounded-full animate-spin" />
        )}
      </div>

      {/* Category Pills */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-1 scrollbar-none">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono whitespace-nowrap transition-all border ${
              category === cat.id
                ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white border-pink-500 shadow-glow-pink font-semibold'
                : 'bg-white/5 hover:bg-white/10 text-slate-400 border-white/10'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Results Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-mono uppercase tracking-wider text-slate-400">
          {query ? `Search Results for "${query}"` : 'Recommended Streams'} ({results.length})
        </h2>
        <span className="text-xs font-mono text-cyan-400">3-Tier Resolution Active</span>
      </div>

      {/* Results List */}
      <div className="space-y-2.5">
        {results.map((track, idx) => {
          const prog = downloadProgress[track.id];
          const isDown = prog && prog.stage !== 'ready' && prog.stage !== 'idle';
          const isAdded = addedIds[track.id];

          return (
            <React.Fragment key={track.id + '_' + idx}>
              <div className="group flex items-center justify-between p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-pink-500/30 backdrop-blur-md transition-all shadow-sm">
                {/* Left Artwork & Song Meta */}
                <div
                  onClick={() => playTrack(track, results, idx)}
                  className="flex items-center space-x-3 cursor-pointer min-w-0 flex-1 pr-2"
                >
                  <div className="relative w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 border border-white/10">
                    <img
                      src={track.thumbnailUrl}
                      alt={track.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                    <div className="absolute inset-0 m-auto w-7 h-7 rounded-full bg-pink-500/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-glow-pink">
                      <Play className="w-3.5 h-3.5 fill-current translate-x-0.5" />
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-semibold text-white truncate group-hover:text-cyan-300 transition-colors">
                      {track.title}
                    </h4>
                    <p className="text-xs text-slate-400 truncate">{track.artist}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5 font-mono">
                      <span
                        className={`uppercase px-1 py-0.2 rounded border text-[9px] ${
                          track.platform === 'tiktok'
                            ? 'bg-pink-500/15 text-pink-400 border-pink-500/30'
                            : 'bg-red-500/15 text-red-400 border-red-500/30'
                        }`}
                      >
                        {track.platform}
                      </span>
                      <span>•</span>
                      {renderTierPill(track)}
                      <span>•</span>
                      <span className="text-cyan-400 text-[10px]">{track.bitrate || '320kbps'}</span>
                    </div>
                  </div>
                </div>

                {/* Right Action Buttons */}
                <div className="flex items-center space-x-1.5 flex-shrink-0">
                  {/* Add to Queue */}
                  <button
                    onClick={() => handleAddToQueue(track)}
                    className={`p-2 rounded-xl border transition-all ${
                      isAdded
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                        : 'bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white border-white/10'
                    }`}
                    title="Add to Queue"
                  >
                    {isAdded ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  </button>

                  {/* Direct Download MP3 */}
                  <button
                    onClick={() => downloadTrack(track)}
                    disabled={Boolean(isDown)}
                    className="p-2 rounded-xl bg-white/5 hover:bg-pink-500/20 text-slate-300 hover:text-pink-300 border border-white/10 transition-all active:scale-95 disabled:opacity-50"
                    title="Download MP3"
                  >
                    <Download className={`w-4 h-4 ${isDown ? 'animate-bounce text-pink-400' : ''}`} />
                  </button>

                  {/* Instant Play */}
                  <button
                    onClick={() => playTrack(track, results, idx)}
                    className="p-2 rounded-xl bg-gradient-to-r from-pink-500 to-cyan-400 text-[#0a0b10] shadow-glow-pink hover:scale-105 active:scale-95 transition-transform"
                    title="Play"
                  >
                    <Play className="w-4 h-4 fill-current translate-x-0.5" />
                  </button>
                </div>
              </div>

              {/* Native sponsored placement embedded once after search result #2 */}
              {idx === 2 && (
                <div className="py-1">
                  <SponsoredCard item={SPONSORED_ITEMS[2]} />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
