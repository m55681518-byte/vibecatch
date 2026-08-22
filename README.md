# ⚡ VibeCatch — Decentralized Client-Side Audio Streamer & PWA

> **Lightning-fast, mobile-first Progressive Web App (PWA)** designed to stream and organize audio tracks from TikTok and YouTube/YouTube Music URLs with a **$0 Backend Decentralized Architecture**.

---

## 🌟 Key Features

1. **Decentralized Client-Side Architecture ($0 Infrastructure Cost)**:
   - Zero centralized proxy servers or paid backends.
   - All audio demuxing, range chunking, WAV slicing, and IndexedDB caching run 100% locally in browser memory.
   - Scales infinitely to 10M+ users with zero server bandwidth limits.

2. **3-Tier Audio Resolution Strategy**:
   - 🎯 **Tier 1 (Tagged Studio Match)**: Parses official source metadata tags to stream clean studio-quality audio.
   - 🧠 **Tier 2 (Caption & Hashtag NLP Parsing)**: Scans captions & `#hashtags` when tracks are labeled as *"original sound"* to extract song/artist identity.
   - ⚡ **Tier 3 (Raw CDN Direct Stream)**: Extracts raw video audio directly from streaming CDNs into memory for custom edits, sped-up tracks, and remixes.

3. **Android Native PWA & Web Share Target API**:
   - `manifest.json` configured with `share_target`.
   - Appears natively in Android system "Share" sheets from TikTok and YouTube.
   - Service Worker (`sw.js`) for full offline caching and background audio playback.

4. **YouTube Music Parity & Local Database**:
   - Floating persistent bottom player with scrubbable waveform and mini-vinyl.
   - 100% offline playback via IndexedDB (`audio_blobs` store).
   - Custom playlists, "Save for Later", Favorites, and JSON Library Backup/Restore.
   - 10-Band Graphic Equalizer with Presets, Sub-Bass Boost, and 3D Spatial Pan.
   - In-Browser Audio Cutter & Ringtone Maker.

5. **3D Visualizers & Battery Saver**:
   - Three.js 3D Spinning Vinyl with dynamic groove physics and tone-arm animation.
   - 4-Mode Cyberpunk Audio Visualizers (Spectrum Bars, Oscilloscope Wave, Radial Pulse, Particle Burst).
   - Automatic frame throttling on low battery (`navigator.getBattery()`).

6. **Native Sponsored Placement**:
   - Seamlessly blended glassmorphism sponsored card for passive monetization without disrupting the UX.

---

## 🚀 Quick Start Guide

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Development Server
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

### 3. Build for Production (Static Cloudflare Pages)
```bash
npm run build
```
The optimized static build will be in `dist/`.

---

## 📱 Installing on Android / iOS
1. Open the app in Chrome (Android) or Safari (iOS).
2. Tap **"Install App"** on the top banner or select **"Add to Home Screen"** from your browser menu.
3. On Android, open TikTok or YouTube, tap **Share**, and choose **VibeCatch** to automatically extract and stream audio tracks!
