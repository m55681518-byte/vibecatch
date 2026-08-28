// VibeCatch Cloudflare Worker Signer — pure mint core
// Races InnerTube player clients with plain fetch(); returns the raw signed
// googlevideo URL (thin signer — bytes stream direct to the device, Turn A).
//
// CF-compatible by construction: no node: imports, no CommonJS require, no
// child processes, no fs/http/server. Runs on any WebStandards fetch runtime
// (Cloudflare Workers, Deno, browsers, Node 18+).

// ---------------------------------------------------------------------------
// PICK_CLIENTS — InnerTube client descriptors to race
// ---------------------------------------------------------------------------

export const PICK_CLIENTS = [
  {
    name: 'IOS',
    key: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc',
    endpoint: 'https://www.youtube.com/youtubei/v1/player',
    context: {
      client: {
        clientName: 'IOS',
        clientVersion: '20.10.4',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iPhone',
        osVersion: '18.3.2.22D82',
        hl: 'en',
        timeZone: 'UTC',
        utcOffsetMinutes: 0,
      },
    },
    headers: {
      'User-Agent': 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)',
      'X-Youtube-Client-Name': '5',
      'X-Youtube-Client-Version': '20.10.4',
      'Content-Type': 'application/json',
    },
  },
  {
    name: 'ANDROID',
    key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
    endpoint: 'https://www.youtube.com/youtubei/v1/player',
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '19.44.38',
        androidSdkVersion: 30,
        osName: 'Android',
        osVersion: '11',
        hl: 'en',
      },
    },
    headers: {
      'User-Agent': 'com.google.android.youtube/19.44.38 (Linux; U; Android 11) gzip',
      'X-Youtube-Client-Name': '3',
      'X-Youtube-Client-Version': '19.44.38',
      'Content-Type': 'application/json',
    },
  },
  {
    name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    endpoint: 'https://www.youtube.com/youtubei/v1/player',
    context: {
      client: {
        clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
        clientVersion: '2.0',
        hl: 'en',
      },
      thirdParty: {
        embedUrl: 'https://www.youtube.com/',
      },
    },
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Content-Type': 'application/json',
    },
  },
];

// ---------------------------------------------------------------------------
// Audio-Double Pivot (strict YT-Music/-Topic IDs rescue)
// Primary innerTube mint blocked from datacenter egress -> scrape the watch
// <title> (never blocked) -> InnerTube WEB search "<song> official audio" /
// "lyric" -> rank standard (non-Topic) candidates -> mint the best one.
// Returns the signed googlevideo URL of the unblocked standard upload.
// ---------------------------------------------------------------------------

export const WEB_SEARCH_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
export const WEB_SEARCH_ENDPOINT = 'https://www.youtube.com/youtubei/v1/search';

function parseLengthText(raw) {
  if (typeof raw !== 'string' || !/^\d+:\d{2}(:\d{2})?$/.test(raw.trim())) return 0;
  const parts = raw.trim().split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

function parseInnerTubeSearch(json) {
  const out = [];
  if (!json || !json.contents) return out;
  const two = json.contents.twoColumnSearchResultsRenderer;
  if (!two || !two.primaryContents) return out;
  const sections = (two.primaryContents.sectionListRenderer && two.primaryContents.sectionListRenderer.contents) || [];
  for (const section of sections) {
    const items = (section.itemSectionRenderer && section.itemSectionRenderer.contents) || [];
    for (const item of items) {
      const vr = item.videoRenderer;
      if (!vr || !vr.videoId) continue;
      const title =
        (vr.title && vr.title.runs && vr.title.runs[0] && vr.title.runs[0].text) ||
        (vr.title && vr.title.simpleText) ||
        '';
      if (!title) continue;
      const channel =
        (vr.ownerText && vr.ownerText.runs && vr.ownerText.runs[0] && vr.ownerText.runs[0].text) ||
        (vr.ownerText && vr.ownerText.simpleText) ||
        '';
      out.push({
        videoId: vr.videoId,
        title,
        channel,
        durationSec: parseLengthText((vr.lengthText && vr.lengthText.simpleText) || ''),
      });
    }
  }
  return out;
}

function rankCandidates(candidates, originalVideoId, originalDurationSec) {
  if (!candidates || !Array.isArray(candidates)) return [];
  const od = Number(originalDurationSec) || 0;
  return candidates
    .filter((c) => c && c.videoId && c.videoId !== originalVideoId)
    .filter((c) => {
      const ch = String(c.channel || '').trim().toLowerCase();
      const ti = String(c.title || '').trim().toLowerCase();
      return !/topic\s*$/.test(ch) && !/topic\s*$/.test(ti);
    })
    .map((c) => {
      let score = 0;
      if (/lyric/i.test(c.title || '')) score += 200;
      if (/official\s*(audio|video)?/i.test(c.title || '')) score += 150;
      if (/audio/i.test(c.title || '')) score += 120;
      const cd = Number(c.durationSec) || 0;
      if (od > 0 && cd > 0) score -= Math.min(Math.abs(cd - od), 600) / 2;
      return Object.assign({}, c, { score });
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0) || String(a.videoId).localeCompare(String(b.videoId)));
}

export function fetchWatchTitle(videoId, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  return (async () => {
    try {
      const res = await fetchImpl(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {});
      if (!res.ok || typeof res.text !== 'function') return null;
      const html = await res.text();
      const m = html.match(/<title>(.*?)<\/title>/i);
      if (!m) return null;
      let title = m[1].replace(/\s+/g, ' ').trim();
      title = title.replace(/\s*-\s*YouTube\s*$/, '').replace(/\s*-\s*Topic\s*$/, '').trim();
      if (!title || /^YouTube$/i.test(title)) return null;
      return title;
    } catch {
      return null;
    }
  })();
}

export async function searchStandardDouble(query, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs ?? 12000;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${WEB_SEARCH_ENDPOINT}?key=${WEB_SEARCH_KEY}&prettyPrint=false`, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: '2.20250728.01.00', hl: 'en' } },
          query,
        }),
        signal: controller.signal,
      });
      if (!res.ok) return [];
      return rankCandidates(parseInnerTubeSearch(await res.json()), null, 0);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return [];
  }
}

export function pickDoubleCandidate(candidates, originalVideoId, originalDurationSec) {
  const ranked = rankCandidates(candidates, originalVideoId, originalDurationSec);
  return ranked.length > 0 ? ranked[0] : null;
}

export async function extractWithDoublePivot(videoId, opts = {}) {
  if (!opts.prioritizeDouble) {
    const primary = await mintSignedUrl(videoId, opts);
    if (primary) return primary;
  }
  try {
    const title = await fetchWatchTitle(videoId, opts);
    if (!title) return null;
    let candidates = await searchStandardDouble(`${title} official audio`, opts);
    if (candidates.length === 0) {
      candidates = await searchStandardDouble(`${title} lyric`, opts);
    }
    const ordered = rankCandidates(candidates, videoId, opts.originalDurationSec || 0);
    for (const cand of ordered) {
      const minted = await mintSignedUrl(cand.videoId, opts);
      if (minted) {
        return {
          ...minted,
          doubled: true,
          originalVideoId: videoId,
          viaVideoId: cand.videoId,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// pickBestAudioFormat — filter audio streams with plain url, highest bitrate
// ---------------------------------------------------------------------------

export function pickBestAudioFormat(streams) {
  if (!streams || !Array.isArray(streams) || streams.length === 0) return null;

  const audioWithUrl = streams.filter(
    (s) =>
      typeof s.mimeType === 'string' &&
      s.mimeType.startsWith('audio/') &&
      typeof s.url === 'string' &&
      s.url.length > 0,
  );

  if (audioWithUrl.length === 0) return null;

  audioWithUrl.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  return audioWithUrl[0];
}

// ---------------------------------------------------------------------------
// normalizeClientResponse — map InnerTube JSON to a resolved signer payload
// ---------------------------------------------------------------------------

export function normalizeClientResponse(json) {
  if (!json) return null;
  const ps = json.playabilityStatus;
  if (!ps || ps.status !== 'OK') return null;

  const vd = json.videoDetails;
  if (!vd) return null;

  const sd = json.streamingData;
  const formats = sd ? (sd.adaptiveFormats || sd.formats || []) : [];
  const best = pickBestAudioFormat(formats);
  if (!best) return null;

  return {
    audioUrl: best.url,
    title: vd.title || '',
    artist: vd.author || '',
    duration: Number(vd.lengthSeconds) || 0,
  };
}

// ---------------------------------------------------------------------------
// mintSignedUrl — race every client; return the first usable signed payload
// ---------------------------------------------------------------------------

export async function mintSignedUrl(videoId, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const clients = opts.clients && opts.clients.length > 0 ? opts.clients : PICK_CLIENTS;

  const attempts = clients.map((client) =>
    (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onOuterAbort = () => controller.abort();
      if (opts.signal) {
        if (opts.signal.aborted) controller.abort();
        else opts.signal.addEventListener('abort', onOuterAbort, { once: true });
      }
      try {
        const endpointUrl = `${client.endpoint}?key=${client.key}&prettyPrint=false`;
        const resp = await fetchImpl(endpointUrl, {
          method: 'POST',
          headers: client.headers,
          body: JSON.stringify({
            context: client.context,
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          }),
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(client.name + ' HTTP ' + resp.status);
        const json = await resp.json();
        const normalized = normalizeClientResponse(json);
        if (!normalized) throw new Error(client.name + ' returned unusable data');
        return normalized;
      } finally {
        clearTimeout(timer);
        if (opts.signal) opts.signal.removeEventListener('abort', onOuterAbort);
      }
    })(),
  );

  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}