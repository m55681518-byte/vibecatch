import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header, BottomNav } from './components/Navigation';
import { DiscoverTab } from './components/DiscoverTab';
import { SearchTab } from './components/SearchTab';
import { LibraryTab } from './components/LibraryTab';
import { StudioTab } from './components/StudioTab';
import { SettingsTab } from './components/SettingsTab';
import { FloatingPlayer } from './components/FloatingPlayer';
import { FullPlayerModal } from './components/FullPlayerModal';
import { SleepTimerModal } from './components/SleepTimerModal';
import { AudioTrimmerModal } from './components/AudioTrimmerModal';
import { PWAInstallBanner } from './components/PWAInstallBanner';

const MainLayout: React.FC = () => {
  const { activeTab } = useApp();

  return (
    <div className="relative min-h-screen bg-[#0a0b10] text-slate-100 flex flex-col font-sans select-none overflow-x-hidden">
      {/* Dynamic Cyber Ambient Background Mesh */}
      <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-pink-500/10 rounded-full blur-[120px] animate-pulse-glow" />
        <div className="absolute top-1/3 -right-40 w-96 h-96 bg-cyan-500/10 rounded-full blur-[120px] animate-pulse-glow" />
        <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-purple-600/10 rounded-full blur-[120px]" />
      </div>

      {/* Top Header */}
      <Header />

      {/* PWA Install Notification */}
      <PWAInstallBanner />

      {/* Main Tab Content */}
      <main className="flex-1 w-full max-w-6xl mx-auto pt-2">
        {activeTab === 'discover' && <DiscoverTab />}
        {activeTab === 'search' && <SearchTab />}
        {activeTab === 'library' && <LibraryTab />}
        {activeTab === 'studio' && <StudioTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </main>

      {/* Persistent Floating Bottom Audio Player */}
      <FloatingPlayer />

      {/* Bottom Mobile Navigation */}
      <BottomNav />

      {/* Fullscreen Immersive Modal Player */}
      <FullPlayerModal />

      {/* Sleep Timer Modal */}
      <SleepTimerModal />

      {/* In-Browser CPU Audio Trimmer & Ringtone Maker Modal */}
      <AudioTrimmerModal />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}
