# VibeCatch Remote Worker — Contract + Setup

## HTTP contract (mirrors local node)
- `GET /vibecheck` → `{ok:true,name:'vibecatch-remote-worker',version:'1.0.0'}`
- `GET /resolve?videoId=<id>` → metadata JSON via yt-dlp --dump-json; bot-wall bypassed by a minimal Netscape cookie stub (auto-created at `<os.tmpdir>/vibecatch-worker/cookies.txt` if none provided). Set `VIBECATCH_YT_COOKIES=<path>` env var to override.
- `GET /download?videoId=<id>&title=<name>&range=<bytes>` → audio stream (m4a). Same cookie logic. Supports `?range=` byte ranges → 206 Partial Content. Client disconnect aborts yt-dlp mid-stream and clears partial cache.

## Environment requirements (for full audio + metadata extraction)
1. **Node.js ≥ 20** on `$PATH` — yt-dlp auto-detects it as the EJS JS runtime for solving YouTube's JavaScript challenges. Verify: `node --version` then `yt-dlp -J https://www.youtube.com/watch?v=dQw4w9WgXcQ 2>&1 | findstr /C:"jsc:node"` — should print `[jsc:node]`.
2. **yt-dlp** (latest from pip) — already pinned; includes bundled `yt-dlp-ejs` scripts.
3. **Bootstrap cookie stub**: On first launch without `VIBECATCH_YT_COOKIES`, the worker auto-writes a minimal Netscape-format stub at `<os.tmpdir>/vibecatch-worker/cookies.txt`. You can pre-provide one via `VIBECATCH_YT_COOKIES=<absolute-path-to-cookies.txt>`. This defeats the YouTube bot-wall on datacenter/residential IPs (proven: journal 055).
4. **Optional: bgutil PO-token provider** (for full audio downloads on restrictive IPs): install `bgutil-ytdlp-pot-provider` via pip and run its Node HTTP server on 127.0.0.1:4416 (`git clone`, `npm ci`, `npx tsc`, then `node build/main.js`). yt-dlp auto-detects the running server and generates GVS PO tokens for /download. Without it, some videos may return 403 or limited formats — metadata (/resolve) always works; /download succeeds for many videos but may be format-limited on strict CDNs. The worker itself requires no extra env — yt-dlp picks up the provider automatically when active.

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