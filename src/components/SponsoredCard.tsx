import React, { useState } from 'react';
import { ExternalLink, Sparkles, X, ShieldCheck, Headphones } from 'lucide-react';
import { SponsoredItem } from '../types';
import { SPONSORED_ITEMS } from '../services/extractor';

interface SponsoredCardProps {
  item?: SponsoredItem;
  className?: string;
  variant?: 'compact' | 'expanded';
}

export const SponsoredCard: React.FC<SponsoredCardProps> = ({
  item = SPONSORED_ITEMS[0],
  className = '',
  variant = 'compact',
}) => {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !item) return null;

  return (
    <div
      className={`group relative rounded-2xl p-3 sm:p-3.5 bg-gradient-to-r from-cyan-950/25 via-[#13162a]/90 to-purple-950/25 border border-cyan-500/25 hover:border-cyan-500/50 backdrop-blur-xl shadow-card transition-all duration-300 ${className}`}
    >
      {/* Top Meta Bar */}
      <div className="flex items-center justify-between pb-2 border-b border-white/5">
        <div className="flex items-center space-x-1.5">
          <span className="text-[9px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 flex items-center space-x-1">
            <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
            <span>Promoted Partner</span>
          </span>
          <span className="text-[10px] text-slate-400 font-mono">• {item.brand}</span>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            setDismissed(true);
          }}
          className="p-1 text-slate-500 hover:text-slate-300 rounded-md hover:bg-white/5 transition-colors"
          title="Dismiss ad"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Main Content */}
      <div className="flex items-center space-x-3 pt-2.5">
        {/* Product Image */}
        <div className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-xl overflow-hidden flex-shrink-0 border border-cyan-500/30 shadow-md">
          <img
            src={item.imageUrl}
            alt={item.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h4 className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-cyan-300 transition-colors">
            {item.title}
          </h4>
          <p className="text-[11px] text-slate-300 line-clamp-1">{item.subtitle}</p>
          <p className="text-[10px] text-slate-400 line-clamp-1 mt-0.5 font-mono">
            {item.description}
          </p>
        </div>

        {/* Action Button */}
        <a
          href={item.targetUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-black text-xs font-bold shadow-glow-cyan flex items-center space-x-1 transition-all active:scale-95 whitespace-nowrap"
        >
          <span>{item.ctaText}</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
};
