import fs from 'fs';
import zlib from 'zlib';

function createCrcTable() {
  let c;
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    crcTable[n] = c;
  }
  return crcTable;
}

const crcTable = createCrcTable();

function crc32(buf) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

function writePng(width, height, getPixel) {
  // RGBA 8-bit
  const rowBytes = width * 4 + 1; // +1 filter byte per row
  const rawData = Buffer.alloc(rowBytes * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    rawData[rowOffset] = 0; // Filter None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y, width, height);
      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);

  // PNG Header
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = createChunk('IHDR', ihdr);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const body = Buffer.concat([typeBuf, data]);
  const crcVal = crc32(body);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([lenBuf, body, crcBuf]);
}

function renderIcon(size, isMaskable = false) {
  return writePng(size, size, (x, y, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxR = w / 2;

    if (!isMaskable && dist > maxR * 0.96) {
      return [0, 0, 0, 0]; // transparent rounded corner
    }

    // Base background gradient: dark blue/black
    const normY = y / h;
    let r = Math.floor(10 + normY * 12);
    let g = Math.floor(11 + normY * 14);
    let b = Math.floor(18 + normY * 26);
    let a = 255;

    // Outer glow ring
    const ringDist = Math.abs(dist - maxR * 0.7);
    if (ringDist < 6) {
      const glow = 1 - (ringDist / 6);
      r = Math.floor(r * (1 - glow) + 0 * glow);
      g = Math.floor(g * (1 - glow) + 242 * glow);
      b = Math.floor(b * (1 - glow) + 254 * glow);
    }

    // Inner Vinyl circle
    const vinylDist = Math.abs(dist - maxR * 0.45);
    if (dist < maxR * 0.6) {
      // darker vinyl center
      r = Math.floor(r * 0.4);
      g = Math.floor(g * 0.4);
      b = Math.floor(b * 0.5);
    }

    // Center Core Hot Pink Orb
    if (dist < maxR * 0.22) {
      const coreFactor = 1 - (dist / (maxR * 0.22));
      r = Math.floor(219 * coreFactor + r * (1 - coreFactor));
      g = Math.floor(39 * coreFactor + g * (1 - coreFactor));
      b = Math.floor(119 * coreFactor + b * (1 - coreFactor));
    }

    // Center Cyan Pin
    if (dist < maxR * 0.08) {
      r = 0;
      g = 242;
      b = 254;
    }

    return [r, g, b, a];
  });
}

// Generate PNG icons
fs.writeFileSync('public/icon-192.png', renderIcon(192));
fs.writeFileSync('public/icon-512.png', renderIcon(512));
fs.writeFileSync('public/icon-maskable.png', renderIcon(512, true));
fs.copyFileSync('public/favicon.svg', 'public/logo.svg');
console.log('PNG Icons successfully generated!');
