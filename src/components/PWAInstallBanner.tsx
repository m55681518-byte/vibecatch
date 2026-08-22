import React, { useState } from 'react';
import { Download, X, Sparkles, Share2, Smartphone } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const PWAInstallBanner: React.FC = () => {
  const { installPrompt, triggerInstallPrompt, isAppInstalled } = useApp();
  const [dismissed, setDismissed] = useState(false);

  if (!installPrompt || isAppInstalled || dismissed) return null;

  return (
    <div className="fixed top-14 left-0 right-0 z-40 px-3 sm:px-4 pointer-events-none animate-in fade-in slide-in-from-top-4">
      <div className="max-w-2xl mx-auto rounded-2xl p-3.5 bg-gradient-to-r from-[#1b1e36] via-[#15172b] to-[#1b1e36] border border-cyan-500/40 shadow-2xl backdrop-blur-xl pointer-events-auto flex items-center justify-between space-x-3">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-pink-500 to-cyan-400 p-[1px] flex-shrink-0 shadow-glow-cyan">
            <div className="w-full h-full bg-[#0a0b10] rounded-[10px] flex items-center justify-center">
              <Smartphone className="w-5 h-5 text-cyan-400" />
            </div>
          </div>
          <div className="min-w-0">
            <h4 className="text-xs sm:text-sm font-bold text-white truncate">
              Install VibeCatch Native PWA
            </h4>
            <p className="text-[11px] text-slate-300 line-clamp-1">
              Enables Android system &quot;Share Menu&quot; to auto-extract songs from TikTok & YouTube!
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 flex-shrink-0">
          <button
            onClick={triggerInstallPrompt}
            className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-pink-500 to-cyan-400 text-black text-xs font-bold shadow-glow-pink hover:scale-105 active:scale-95 transition-transform"
          >
            Install
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
