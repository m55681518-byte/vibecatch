#!/usr/bin/env bash
# VibeCatch Termux Setup — turn your Android phone into a local node
# Idempotent: safe to re-run. Termux has no elevated privilege commands.
set -euo pipefail

PORT=8794
VC_DIR=~/vibecatch
NODE_SCRIPT=vibecatch-node.mjs
NODE_URL="https://vibecatch.pages.dev/vibecatch-node.mjs"
SETUP_LOG="${VC_DIR}/node.log"
START_SCRIPT="${VC_DIR}/start-node.sh"

# ── 1. Install Termux-native packages (skip if already present) ──────────────
if command -v node >/dev/null 2>&1 && command -v ffmpeg >/dev/null 2>&1; then
  echo "✓ node & ffmpeg already installed"
else
  echo "Installing nodejs-lts and ffmpeg via pkg …"
  pkg install -y nodejs-lts ffmpeg
fi

# ── 2. Install / update yt-dlp via pip (ARM-safe, never download x86 binary) ─
if command -v yt-dlp >/dev/null 2>&1; then
  echo "✓ yt-dlp already installed"
else
  echo "Installing yt-dlp via pip3 …"
fi
pip3 install -U yt-dlp

# ── 3. Create the vibecatch directory and download the node script ───────────
mkdir -p "${VC_DIR}"
echo "Downloading ${NODE_SCRIPT} …"
curl -fsSL "${NODE_URL}" -o "${VC_DIR}/${NODE_SCRIPT}"

# ── 4. Acquire wake-lock so Android Doze does not kill downloads ─────────────
termux-wake-lock
echo "✓ Wake-lock acquired"

# ── 5. Write the start-node.sh helper for reboot re-launch ──────────────────
cat > "${START_SCRIPT}" <<LAUNCH
#!/usr/bin/env bash
termux-wake-lock
cd ${VC_DIR}
nohup node ${VC_DIR}/${NODE_SCRIPT} > ${SETUP_LOG} 2>&1 &
echo \$! > ${VC_DIR}/node.pid
echo "Node started on port ${PORT} — log: ${SETUP_LOG}"
LAUNCH
chmod +x "${START_SCRIPT}"

# ── 6. Launch the node now ──────────────────────────────────────────────────
bash "${START_SCRIPT}"

# Give the node a moment to bind
sleep 1

# ── 7. Verify via /vibecheck ────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo " VibeCatch Node — Post-Install Check"
echo "═══════════════════════════════════════════════════"
if curl -sf "http://127.0.0.1:${PORT}/vibecheck" >/dev/null 2>&1; then
  echo "✓ Node is live on port ${PORT}"
  echo ""
  echo "NEXT STEPS:"
  echo "  1. Open https://vibecatch.pages.dev in Chrome"
  echo "  2. The app will auto-detect your local node"
  echo "  3. Paste any TikTok or YouTube link to extract audio"
  echo ""
  echo "To restart after reboot:  bash ~/vibecatch/start-node.sh"
  echo "To view logs:             tail -f ${SETUP_LOG}"
  echo "To stop:                  kill \$(cat ~/vibecatch/node.pid)"
else
  echo "⚠ Node did not respond yet — it may still be starting."
  echo "  Check logs:  tail -f ${SETUP_LOG}"
  echo "  Retry:       bash ~/vibecatch/start-node.sh"
fi
