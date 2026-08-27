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