import React from 'react';
import {
  Compass,
  Search,
  Library,
  Sliders,
  Settings as SettingsIcon,
  Download,
  Wifi,
  WifiOff,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { TabType } from '../types';
import { downloadProjectZip } from '../assets/projectZipBase64';

export const Header: React.FC = () => {
  const { isOnline, installPrompt, triggerInstallPrompt, isAppInstalled, setActiveTab } = useApp();

  return (
    <header className="sticky top-0 z-30 w-full backdrop-blur-xl bg-[#0a0b10]/80 border-b border-white/10 px-4 py-3">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        {/* Brand Logo */}
        <div
          onClick={() => setActiveTab('discover')}
          className="flex items-center space-x-2.5 cursor-pointer group select-none"
        >
          <div className="relative w-9 h-9 rounded-xl bg-gradient-to-tr from-pink-500 via-purple-500 to-cyan-400 p-[1.5px] shadow-glow-pink">
            <div className="w-full h-full bg-[#0d0f18] rounded-[10px] flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-cyan-400 group-hover:rotate-12 transition-transform duration-300" />
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-pink-500 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                VibeCatch
              </span>
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-400 border border-pink-500/30">
                PWA
              </span>
            </div>
            <p className="text-[10px] text-slate-400 hidden sm:block">
              Decentralized TikTok & YT Audio
            </p>
          </div>
        </div>

        {/* Status & PWA Install & Zip Download */}
        <div className="flex items-center space-x-2.5">
          {/* Direct In-Memory ZIP Download Button */}
          <button
            onClick={downloadProjectZip}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-xs font-semibold border border-cyan-500/40 shadow-glow-cyan transition-all active:scale-95 cursor-pointer"
            title="Download full project zip"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400 animate-bounce" />
            <span>Download ZIP</span>
          </button>

          {/* Online/Offline Badge */}
          <div
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-mono border ${
              isOnline
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            }`}
          >
            {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">{isOnline ? 'Direct CDN' : 'Offline Vault'}</span>
          </div>

          {/* PWA Install Trigger */}
          {installPrompt && !isAppInstalled && (
            <button
              onClick={triggerInstallPrompt}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white text-xs font-semibold shadow-glow-pink transition-all active:scale-95"
            >
              <Download className="w-3.5 h-3.5 animate-bounce" />
              <span>Install App</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

export const BottomNav: React.FC = () => {
  const { activeTab, setActiveTab } = useApp();

  const tabs: { id: TabType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'discover', label: 'Discover', icon: Compass },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'library', label: 'Library', icon: Library },
    { id: 'studio', label: 'Audio Lab', icon: Sliders },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 backdrop-blur-2xl bg-[#0a0b10]/90 border-t border-white/10 pb-safe">
      <div className="max-w-md mx-auto grid grid-cols-5 h-16 items-center px-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center justify-center w-full h-full min-h-[44px] min-w-[44px] transition-all relative select-none ${
                isActive
                  ? 'text-cyan-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {isActive && (
                <span className="absolute top-1 w-6 h-1 rounded-full bg-gradient-to-r from-pink-500 to-cyan-400 shadow-glow-cyan" />
              )}
              <Icon className={`w-5 h-5 transition-transform duration-200 ${isActive ? 'scale-110 -translate-y-0.5' : ''}`} />
              <span className={`text-[10px] mt-1 font-medium tracking-tight ${isActive ? 'font-semibold text-white' : ''}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
