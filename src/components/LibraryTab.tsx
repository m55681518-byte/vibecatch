import React, { useState } from 'react';
import {
  HardDrive,
  FolderPlus,
  Play,
  Download,
  Trash2,
  Heart,
  Clock,
  ListMusic,
  FileJson,
  Upload,
  CheckCircle2,
  Sparkles,
  Scissors,
  Bookmark,
  Plus,
  Radio,
  Layers,
  Cpu,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { exportLibraryJSON, importLibraryJSON } from '../services/db';
import { Playlist, Track } from '../types';
import { SponsoredCard } from './SponsoredCard';
import { SPONSORED_ITEMS } from '../services/extractor';

export const LibraryTab: React.FC = () => {
  const {
    tracks,
    playlists,
    history,
    storageInfo,
    playTrack,
    deleteTrackFromLibrary,
    toggleFavorite,
    downloadTrack,
    openTrimmer,
    refreshLibrary,
    createNewPlaylist,
    deletePlaylistById,
    removeTrackFromPlaylistId,
    downloadProgress,
  } = useApp();

  const [subTab, setSubTab] = useState<'offline' | 'playlists' | 'favorites' | 'history'>('offline');
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const offlineTracks = tracks.filter((t) => t.isOfflineAvailable);
  const favoriteTracks = tracks.filter((t) => t.isFavorite);

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) return;
    const pl = await createNewPlaylist(newPlaylistName.trim(), newPlaylistDesc.trim());
    setNewPlaylistName('');
    setNewPlaylistDesc('');
    setIsCreatingPlaylist(false);
    setSelectedPlaylist(pl);
  };

  const handleExport = async () => {
    try {
      const json = await exportLibraryJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `VibeCatch-Library-Backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn('Export failed:', e);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const result = await importLibraryJSON(text);
      await refreshLibrary();
      setImportStatus(`Successfully restored ${result.trackCount} tracks and ${result.playlistCount} playlists!`);
      setTimeout(() => setImportStatus(null), 4000);
    } catch (err) {
      setImportStatus('Invalid JSON backup file.');
      setTimeout(() => setImportStatus(null), 3000);
    }
  };

  const currentDisplayTracks: Track[] =
    subTab === 'offline'
      ? offlineTracks
      : subTab === 'favorites'
      ? favoriteTracks
      : tracks;

  // Render 3-Tier Resolution Badge
  const renderTierBadge = (track: Track) => {
    const tier = track.resolution?.tier || 'tier1_studio';
    if (tier === 'tier1_studio') {
      return (
        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center space-x-1">
          <span>🎯 Tier 1: Studio Clean</span>
        </span>
      );
    }
    if (tier === 'tier2_nlp') {
      return (
        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 flex items-center space-x-1">
          <span>🧠 Tier 2: Caption NLP</span>
        </span>
      );
    }
    return (
      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 flex items-center space-x-1">
        <span>⚡ Tier 3: Raw Video CDN</span>
      </span>
    );
  };

  return (
    <div className="space-y-5 pb-24 max-w-5xl mx-auto px-3 sm:px-4 pt-3">
      {/* Storage Indicator & Top Stats Banner */}
      <div className="rounded-3xl p-5 bg-gradient-to-r from-[#15172b] via-[#121422] to-[#15172b] border border-white/10 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <HardDrive className="w-5 h-5 text-cyan-400" />
            <h2 className="text-base sm:text-lg font-bold text-white">
              Local IndexedDB Vault ($0 Infrastructure)
            </h2>
          </div>
          <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/25">
            {storageInfo ? storageInfo.offlineTrackCount : 0} Offline Cached
          </span>
        </div>

        {/* Storage Bar */}
        <div className="space-y-1">
          <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-400 transition-all duration-300"
              style={{ width: `${Math.max(3, storageInfo?.percentUsed || 1)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs font-mono text-slate-400">
            <span>IndexedDB Stored: {storageInfo?.usageFormatted || '0 MB'}</span>
            <span>Estimated Quota: {storageInfo?.quotaFormatted || '5 GB'}</span>
          </div>
        </div>

        {/* Backup / Restore Controls */}
        <div className="flex items-center space-x-2 pt-1">
          <button
            onClick={handleExport}
            className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-mono flex items-center space-x-1.5 transition-all"
          >
            <FileJson className="w-3.5 h-3.5 text-pink-400" />
            <span>Export Backup</span>
          </button>
          <label className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-mono flex items-center space-x-1.5 cursor-pointer transition-all">
            <Upload className="w-3.5 h-3.5 text-cyan-400" />
            <span>Restore JSON</span>
            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
          </label>
        </div>

        {importStatus && (
          <p className="text-xs font-mono text-emerald-300 bg-emerald-500/10 p-2 rounded-xl border border-emerald-500/30">
            {importStatus}
          </p>
        )}
      </div>

      {/* Sub-Tabs Nav */}
      <div className="flex items-center space-x-2 border-b border-white/10 pb-2 overflow-x-auto scrollbar-none">
        <button
          onClick={() => {
            setSubTab('offline');
            setSelectedPlaylist(null);
          }}
          className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
            subTab === 'offline' && !selectedPlaylist
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-glow-cyan'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <HardDrive className="w-3.5 h-3.5" />
          <span>Offline Vault ({offlineTracks.length})</span>
        </button>

        <button
          onClick={() => {
            setSubTab('playlists');
            setSelectedPlaylist(null);
          }}
          className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
            subTab === 'playlists'
              ? 'bg-pink-500/20 text-pink-300 border border-pink-500/40 shadow-glow-pink'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <ListMusic className="w-3.5 h-3.5" />
          <span>Playlists ({playlists.length})</span>
        </button>

        <button
          onClick={() => {
            setSubTab('favorites');
            setSelectedPlaylist(null);
          }}
          className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
            subTab === 'favorites' && !selectedPlaylist
              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-glow-purple'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Heart className="w-3.5 h-3.5" />
          <span>Favorites ({favoriteTracks.length})</span>
        </button>

        <button
          onClick={() => {
            setSubTab('history');
            setSelectedPlaylist(null);
          }}
          className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
            subTab === 'history' && !selectedPlaylist
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>History ({history.length})</span>
        </button>
      </div>

      {/* ==================== SUB-VIEW: PLAYLISTS ==================== */}
      {subTab === 'playlists' && !selectedPlaylist && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-mono uppercase tracking-wider text-slate-400">
              Your Playlists
            </h3>
            <button
              onClick={() => setIsCreatingPlaylist(true)}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white text-xs font-semibold shadow-glow-pink transition-all active:scale-95"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>New Playlist</span>
            </button>
          </div>

          {/* New Playlist Form */}
          {isCreatingPlaylist && (
            <div className="p-4 rounded-2xl bg-[#17192f] border border-pink-500/30 space-y-3 animate-in fade-in">
              <h4 className="text-sm font-bold text-white">Create New Playlist</h4>
              <input
                type="text"
                placeholder="Playlist name (e.g. Gym Viral Phonk)"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-xl text-white text-sm outline-none focus:border-pink-500"
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={newPlaylistDesc}
                onChange={(e) => setNewPlaylistDesc(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-xl text-white text-sm outline-none focus:border-pink-500"
              />
              <div className="flex space-x-2">
                <button
                  onClick={handleCreatePlaylist}
                  className="px-4 py-1.5 rounded-xl bg-pink-500 text-white text-xs font-semibold"
                >
                  Create
                </button>
                <button
                  onClick={() => setIsCreatingPlaylist(false)}
                  className="px-4 py-1.5 rounded-xl bg-white/5 text-slate-300 text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Playlists Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {playlists.map((pl) => (
              <div
                key={pl.id}
                onClick={() => setSelectedPlaylist(pl)}
                className="group p-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-pink-500/40 cursor-pointer transition-all shadow-md space-y-3"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 border border-white/10">
                    <img
                      src={pl.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80'}
                      alt={pl.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-bold text-white truncate group-hover:text-pink-300">
                      {pl.name}
                    </h4>
                    <p className="text-xs text-slate-400 line-clamp-1">{pl.description}</p>
                    <span className="text-[10px] font-mono text-cyan-400">
                      {pl.trackIds.length} Tracks
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Seamless Native Sponsored Placement in Playlists View */}
          <div className="pt-2">
            <SponsoredCard item={SPONSORED_ITEMS[1]} />
          </div>
        </div>
      )}

      {/* ==================== PLAYLIST DETAILS VIEW ==================== */}
      {selectedPlaylist && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSelectedPlaylist(null)}
              className="text-xs font-mono text-cyan-400 hover:underline"
            >
              ← Back to Playlists
            </button>
            {!selectedPlaylist.isSystem && (
              <button
                onClick={() => {
                  deletePlaylistById(selectedPlaylist.id);
                  setSelectedPlaylist(null);
                }}
                className="text-xs font-mono text-red-400 hover:text-red-300"
              >
                Delete Playlist
              </button>
            )}
          </div>

          <div className="flex items-center space-x-4 p-4 rounded-2xl bg-white/5 border border-white/10">
            <img
              src={selectedPlaylist.coverUrl}
              alt={selectedPlaylist.name}
              className="w-20 h-20 rounded-xl object-cover border border-white/10"
            />
            <div>
              <h3 className="text-lg font-bold text-white">{selectedPlaylist.name}</h3>
              <p className="text-xs text-slate-400">{selectedPlaylist.description}</p>
              <p className="text-xs font-mono text-cyan-400 mt-1">
                {selectedPlaylist.trackIds.length} Tracks in Playlist
              </p>
            </div>
          </div>

          {/* Tracks in Playlist */}
          <div className="space-y-2">
            {tracks
              .filter((t) => selectedPlaylist.trackIds.includes(t.id))
              .map((track) => (
                <div
                  key={track.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10"
                >
                  <div
                    onClick={() => playTrack(track)}
                    className="flex items-center space-x-3 cursor-pointer min-w-0 flex-1"
                  >
                    <img
                      src={track.thumbnailUrl}
                      alt={track.title}
                      className="w-10 h-10 rounded-lg object-cover"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{track.title}</p>
                      <p className="text-xs text-slate-400 truncate">{track.artist}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => removeTrackFromPlaylistId(selectedPlaylist.id, track.id)}
                    className="p-2 text-slate-400 hover:text-red-400"
                    title="Remove from playlist"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ==================== SUB-VIEW: TRACKS / FAVORITES / OFFLINE ==================== */}
      {!selectedPlaylist && subTab !== 'playlists' && subTab !== 'history' && (
        <div className="space-y-3">
          {currentDisplayTracks.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-white/10 rounded-3xl p-8 space-y-3">
              <HardDrive className="w-12 h-12 text-slate-600 mx-auto" />
              <h3 className="text-base font-bold text-slate-300">
                {subTab === 'offline'
                  ? 'No Offline Tracks Cached Yet'
                  : 'No Favorite Tracks Saved'}
              </h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Extract any TikTok or YouTube audio and tap &quot;Save MP3&quot; or &quot;Offline Cache&quot; to store full audio files directly in your device CPU vault.
              </p>
            </div>
          ) : (
            currentDisplayTracks.map((track, idx) => {
              const prog = downloadProgress[track.id];
              const isDown = prog && prog.stage !== 'ready' && prog.stage !== 'idle';

              return (
                <React.Fragment key={track.id + '_' + idx}>
                  <div className="group flex items-center justify-between p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-cyan-500/30 transition-all shadow-sm">
                    <div
                      onClick={() => playTrack(track, currentDisplayTracks, idx)}
                      className="flex items-center space-x-3 cursor-pointer min-w-0 flex-1 pr-2"
                    >
                      <div className="relative w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 border border-white/10">
                        <img
                          src={track.thumbnailUrl}
                          alt={track.title}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 m-auto w-7 h-7 rounded-full bg-cyan-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Play className="w-3.5 h-3.5 fill-current translate-x-0.5" />
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-semibold text-white truncate">{track.title}</h4>
                        <p className="text-xs text-slate-400 truncate">{track.artist}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1 font-mono">
                          {renderTierBadge(track)}
                          {track.isOfflineAvailable ? (
                            <span className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20 text-[9px]">
                              Offline ({( (track.fileSizeBytes || 3500000) / (1024 * 1024) ).toFixed(1)} MB)
                            </span>
                          ) : (
                            <span className="text-cyan-400 text-[9px]">{track.bitrate || '320kbps'}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center space-x-1.5 flex-shrink-0">
                      <button
                        onClick={() => toggleFavorite(track.id)}
                        className="p-2 rounded-xl text-slate-400 hover:text-pink-400"
                        title="Favorite"
                      >
                        <Heart
                          className={`w-4 h-4 ${track.isFavorite ? 'text-pink-500 fill-pink-500' : ''}`}
                        />
                      </button>

                      <button
                        onClick={() => openTrimmer(track)}
                        className="p-2 rounded-xl text-slate-400 hover:text-cyan-400"
                        title="Cut Ringtone"
                      >
                        <Scissors className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => downloadTrack(track)}
                        disabled={Boolean(isDown)}
                        className="p-2 rounded-xl bg-white/5 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 border border-white/10"
                        title="Download MP3"
                      >
                        <Download className={`w-4 h-4 ${isDown ? 'animate-bounce text-cyan-400' : ''}`} />
                      </button>

                      <button
                        onClick={() => deleteTrackFromLibrary(track.id)}
                        className="p-2 rounded-xl text-slate-500 hover:text-red-400"
                        title="Delete from library"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Seamless native sponsored placement blended into track feed at index 1 */}
                  {idx === 1 && (
                    <div className="py-1">
                      <SponsoredCard item={SPONSORED_ITEMS[0]} />
                    </div>
                  )}
                </React.Fragment>
              );
            })
          )}
        </div>
      )}

      {/* ==================== SUB-VIEW: HISTORY ==================== */}
      {subTab === 'history' && !selectedPlaylist && (
        <div className="space-y-2">
          {history.length === 0 ? (
            <p className="text-xs font-mono text-slate-400 text-center py-8">No history yet.</p>
          ) : (
            history.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <img
                    src={item.thumbnailUrl}
                    alt={item.title}
                    className="w-10 h-10 rounded-lg object-cover"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{item.title}</p>
                    <p className="text-xs text-slate-400 truncate">{item.artist}</p>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-slate-500">
                  {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
