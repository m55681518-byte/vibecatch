// GUARDIAN TDD ENFORCER — googlevideo windowed relay (freebuff-task-20260823-gvwindow)
// Real-world gate (proven by live probes on video 4_zr_97R5mw):
//   1) every upstream request needs the matching InnerTube User-Agent (IOS);
//   2) every request needs a BOUNDED range header with span <= ~1MiB
//      (open-ended "bytes=0-" and huge bounds get 403);
//   3) a URL's FIRST successful request must start at 0; afterwards any
//      bounded mid-offset range on that same url is allowed.
// => /stream must translate client requests into <=1MiB bounded windows
//    (priming from 0 when needed) and stitch the bytes back.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const nodeScriptPath = path.join(root, 'vibecatch-node.mjs');
const mod = fs.existsSync(nodeScriptPath)
  ? await import('file://' + nodeScriptPath.split(path.sep).join('/'))
  : {};

const IOS_UA = 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)';
const WINDOW = 1048576;
const TOTAL = 3 * 1024 * 1024 + 7777; // ~3.15MB -> forces multi-window stitch
const GV_BODY = Buffer.alloc(TOTAL);
for (let i = 0; i < TOTAL; i++) GV_BODY[i] = (i * 31 + 7) & 0xff;

function makeGatedUpstream() {
  const unlocked = new Set();
  return http.createServer((req, res) => {
    const ua = req.headers['user-agent'];
    if (ua !== IOS_UA) { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('no ua'); return; }
    const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    if (!m) { res.writeHead(403); res.end('range must be bounded'); return; }
    const start = Number(m[1]), end = Number(m[2]);
    if (end < start || end >= TOTAL) { res.writeHead(403); res.end('bad bound'); return; }
    if (end - start + 1 > WINDOW) { res.writeHead(403); res.end('span too large'); return; }
    if (start > 0 && !unlocked.has(req.url)) { res.writeHead(403); res.end('not unlocked'); return; }
    unlocked.add(req.url);
    res.writeHead(206, {
      'Content-Type': 'audio/webm',
      'Content-Range': `bytes ${start}-${end}/${TOTAL}`,
      'Content-Length': String(end - start + 1),
    });
    res.end(GV_BODY.subarray(start, end + 1));
  });
}

let gvUpstream, gvPort, gvServer;
before(async () => {
  if (!mod.startServer) throw new Error('startServer not exported');
  await new Promise((r) => { gvUpstream = makeGatedUpstream(); gvUpstream.listen(0, '127.0.0.1', r); });
  gvPort = gvUpstream.address().port;
  // gvHosts override makes the relay treat our local mock as a gated googlevideo host
  gvServer = mod.startServer(0, { gvHosts: ['127.0.0.1'] });
  await new Promise((r) => gvServer.on('listening', r));
});
after(() => { try { gvServer && gvServer.close(); } catch {} try { gvUpstream && gvUpstream.close(); } catch {} });

function get(pathname, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: gvServer.address().port, path: pathname, method: 'GET', headers: headers || {} },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}
const gvUrl = () => `http://127.0.0.1:${gvPort}/videoplayback?id=o-X&itag=251`;

describe('G1 full download through windowed relay', () => {
  test('no client range -> 200 stitched whole file (windows of <=1MiB)', { timeout: 60000 }, async () => {
    const r = await get('/stream?url=' + encodeURIComponent(gvUrl()));
    assert.equal(r.status, 200, 'expected 200 stitched');
    assert.equal(r.body.length, TOTAL, `stitched size must equal ${TOTAL}`);
    assert.ok(r.body.equals(GV_BODY), 'stitched bytes must match upstream content');
    assert.equal(r.headers['content-length'], String(TOTAL));
    assert.match(String(r.headers['content-disposition'] || ''), /attachment/i);
  });

  test('open-ended client range -> 206 from offset to end', { timeout: 60000 }, async () => {
    const off = 2500000;
    const r = await get('/stream?url=' + encodeURIComponent(gvUrl()), { range: `bytes=${off}-` });
    assert.equal(r.status, 206);
    assert.equal(r.headers['content-range'], `bytes ${off}-${TOTAL - 1}/${TOTAL}`);
    assert.ok(r.body.equals(GV_BODY.subarray(off)), 'tail bytes must match');
  });
});

describe('G2 arbitrary mid-offset client range', () => {
  test('bounded client range is served exactly after auto-prime', { timeout: 60000 }, async () => {
    const a = 1500000, b = 2500000;
    const r = await get('/stream?url=' + encodeURIComponent(gvUrl()), { range: `bytes=${a}-${b}` });
    assert.equal(r.status, 206);
    assert.equal(r.headers['content-range'], `bytes ${a}-${b}/${TOTAL}`);
    assert.equal(r.body.length, b - a + 1);
    assert.ok(r.body.equals(GV_BODY.subarray(a, b + 1)), 'slice must match');
  });
});

describe('G3 window planner (pure helper)', () => {
  test('planWindows covers span with each window <= limit', async () => {
    if (typeof mod.planWindows !== 'function') throw new Error('export planWindows(start,endInclusive,limit) not implemented yet');
    const w = mod.planWindows(0, TOTAL - 1, WINDOW);
    let prev = -1;
    for (const [s, e] of w) {
      assert.equal(s, prev + 1, 'windows must be contiguous');
      assert.ok(e - s + 1 <= WINDOW, 'window span within limit');
      prev = e;
    }
    assert.equal(prev, TOTAL - 1, 'must cover to end');
    const one = mod.planWindows(5, 5, WINDOW);
    assert.deepEqual(one, [[5, 5]]);
  });

  test('parseRangeHeader handles bounded, open-ended and absent', async () => {
    if (typeof mod.parseRangeHeader !== 'function') throw new Error('export parseRangeHeader(h) not implemented yet');
    assert.deepEqual(mod.parseRangeHeader('bytes=10-19'), { start: 10, end: 19 });
    assert.deepEqual(mod.parseRangeHeader('bytes=42-'), { start: 42, end: undefined });
    assert.equal(mod.parseRangeHeader(undefined), null);
    assert.equal(mod.parseRangeHeader('bytes=a-b'), null);
  });
});

describe('G4 non-gated hosts keep simple passthrough', () => {
  let plain, plainSrv, plainPort;
  before(async () => {
    plain = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': '9' });
      res.end('PLAINDATA');
    });
    await new Promise((r) => plain.listen(0, '127.0.0.1', r));
    plainPort = plain.address().port;
    plainSrv = mod.startServer(0); // default gvHosts -> localhost NOT gated
    await new Promise((r) => plainSrv.on('listening', r));
  });
  after(() => { try { plainSrv.close(); } catch {} try { plain.close(); } catch {} });

  test('plain upstream relays without UA/window logic', async () => {
    const r = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: plainSrv.address().port, path: '/stream?url=' + encodeURIComponent(`http://127.0.0.1:${plainPort}/f`), method: 'GET' },
        (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c), headers: res.headers })); }
      );
      req.on('error', reject); req.end();
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.toString(), 'PLAINDATA');
  });
});
