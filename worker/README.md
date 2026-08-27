# VibeCatch Remote Worker — Contract + Setup

## Cloudflare thin signer (`worker/cf-signer-*.mjs`) — LIVE
- **Live endpoint:** `https://vibecatch-signer.pages.dev` (Pages Advanced-Mode worker; a
  Cloudflare Pages-scoped API token, not a Workers token, is what this account holds).
- **Contract (mirrors the signer provider used by the PWA):**
  - `GET /vibecheck` → `{ok:true,name:'vibecatch-cf-signer',version:'1.0.0'}`
  - `GET /resolve?videoId=<id>` → `{ok:true,videoId,audioUrl,title,artist,duration}` where
    `audioUrl` is a **raw signed googlevideo URL** (thin signer) — bytes stream straight from
    the CDN to the device via plain `<audio>` (no CORS), never through this worker.
  - `OPTIONS` → 204 + `Access-Control-Allow-Origin: *`; invalid id → 400; all clients failed →
    502; other methods/paths → 405/404.
- **Playback proof:** the minted URL is IP-pinned to Cloudflare's egress at mint time, but
  googlevideo re-signs for the requesting device via a standard CDN 302 chain (`ipbypass=yes&mip=…`)
  at fetch time — so `/resolve` works from any device/IP (verified live 2026-08-27, journal 068).
- **In the PWA:** the signer is provider #1 in `src/services/resolvers.ts` (kind `signer`,
  `raceYouTubeResolvers`). It races against cobalt/piped/invidious and usually wins on speed
  (~800ms); if it is down the race falls through to the other providers.
- **Rebuild + redeploy** (Pages-scoped token):
  ```
  # 1. rebuild the self-contained Pages bundle (concatenates core+worker, strips the core import)
  node scripts\build-signer-pages-bundle.mjs   # -> _worker.js in <repo>/deploy/signer/
  # 2. deploy (wrangler installed at C:\Users\Mike-\Documents\vibecatch-tools\wrangler)
  set CLOUDFLARE_API_TOKEN=<token from "ACCOUNT ID AND CLOUDFLAIRE TOKEN.txt">
  set CLOUDFLARE_ACCOUNT_ID=66a463623b9929ea2e1eb3a700291e08
  wrangler pages deploy <repo>\deploy\signer --project-name=vibecatch-signer --branch=main
  ```
  (Source-of-truth bundle build lives in `scripts\build-signer-pages-bundle.mjs`, added journal 068.)

## HTTP contract (mirrors local node)
- `GET /vibecheck` → `{ok:true,name:'vibecatch-remote-worker',version:'1.0.0'}`
- `GET /resolve?videoId=<id>` → metadata JSON via yt-dlp --dump-json; bot-wall bypassed by a minimal Netscape cookie stub (auto-created at `<os.tmpdir>/vibecatch-worker/cookies.txt` if none provided). Set `VIBECATCH_YT_COOKIES=<path>` env var to override.
- `GET /download?videoId=<id>&title=<name>&range=<bytes>` → audio stream (m4a). Same cookie logic. Supports `?range=` byte ranges → 206 Partial Content. Client disconnect aborts yt-dlp mid-stream and clears partial cache.

## Environment requirements (for full audio + metadata extraction)
1. **Node.js ≥ 20** on `$PATH` — yt-dlp auto-detects it as the EJS JS runtime for solving YouTube's JavaScript challenges. Verify: `node --version` then `yt-dlp -J https://www.youtube.com/watch?v=dQw4w9WgXcQ 2>&1 | findstr /C:"jsc:node"` — should print `[jsc:node]`.
2. **yt-dlp** (latest from pip) — already pinned; includes bundled `yt-dlp-ejs` scripts.
3. **Bootstrap cookie stub**: On first launch without `VIBECATCH_YT_COOKIES`, the worker auto-writes a minimal Netscape-format stub at `<os.tmpdir>/vibecatch-worker/cookies.txt`. You can pre-provide one via `VIBECATCH_YT_COOKIES=<absolute-path-to-cookies.txt>`. This defeats the YouTube bot-wall on datacenter/residential IPs (proven: journal 055).
4. **bgutil PO-token provider** (REQUIRED for full audio downloads — proven 2026-08-25, journal 060): install `bgutil-ytdlp-pot-provider` via pip AND run its Node HTTP server on 127.0.0.1:4416 (`git clone https://github.com/Brainicism/bgutil-ytdlp-pot-provider`, `cd server`, `npm ci --no-audit --no-fund`, `node node_modules\typescript\bin\tsc`, then `node build/main.js`). The worker passes `--extractor-args youtubepot-bgutilhttp:base_url=<VIBECATCH_POT_URL>` plus the SABR-proof client chain `player_client=mweb,tv_simply` automatically. Env var `VIBECATCH_POT_URL` overrides the default `http://127.0.0.1:4416`; set it to an empty string to disable both extractor-args (legacy behavior). Without a reachable server, /resolve metadata still works but /download returns 403 (GVS PO-token wall). Verified clients: `mweb` and `tv_simply` download full m4a; web/tv/android_vr/ios/android_music are SABR-forced or token-walled regardless of tokens.

## Running locally (self-host)
```cmd
set PATH=C:\Users\<you>\AppData\Local\Python\pythoncore-3.14-64\Scripts;%PATH%
set VIBECATCH_WORKER_SERVE=1
node worker\vibecatch-worker.mjs
```
Listens on `http://127.0.0.1:8795` (override with `VIBECATCH_WORKER_PORT` or `PORT` env). Works on any machine with Node≥20 and yt-dlp installed; no other services required for metadata extraction.

## Deploying as remote worker (PWA pool)
1. Ensure env above is satisfied on the host.
2. Add its URL to `public/workers.json` as `["https://<host>:<port>/vibecheck"]` — the PWA pool will probe `/vibecheck`, then use healthy workers for `/resolve` + `/download`.
3. The pool gracefully degrades: if no workers respond healthy, the PWA falls back to local Termux node (already shipped; see project README for Termux install).

## workers.json format
```json
[
  "https://my-worker-host.example.com:8795/vibecheck"]
```
If the array is empty or missing, the PWA shows no remote workers and uses local extraction only. Add entries later when a host is ready — no code change needed.

## Known limitations
- `/resolve` and video metadata extraction works from ANY IP with the cookie stub.
- `/download` audio streaming may be format-limited on YouTube's 2025/2026 CDN enforcement (GVS PO tokens). The optional bgutil provider (see above) restores full-format access. Without it, many videos still stream but some may be unavailable — this is a YouTube-side change, not a worker bug.