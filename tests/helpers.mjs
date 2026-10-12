// Shared test helpers: tiny PNG builder and a fetch stub. No dependencies.
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const latin1 = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
const utf8 = (s) => new TextEncoder().encode(s);
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

export function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(latin1(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export const tEXt = (key, text) => pngChunk("tEXt", concat(latin1(key), [0], latin1(text)));
export const zTXt = (key, text) => pngChunk("zTXt", concat(latin1(key), [0, 0], deflateSync(utf8(text))));
export const iTXt = (key, text, { compressed = false, lang = "", translated = "" } = {}) =>
  pngChunk("iTXt", concat(latin1(key), [0, compressed ? 1 : 0, 0], latin1(lang), [0], utf8(translated), [0],
    compressed ? deflateSync(utf8(text)) : utf8(text)));

// A valid 1x1 RGBA PNG, with any extra chunks inserted after IHDR.
export function makePng(extra = []) {
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, 1); v.setUint32(4, 1);
  ihdr[8] = 8; ihdr[9] = 6; // bit depth 8, RGBA
  const idat = deflateSync(Uint8Array.from([0, 255, 0, 0, 255])); // filter byte + one pixel
  return concat(sig, pngChunk("IHDR", ihdr), ...extra, pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0)));
}

// readPngText wants an ArrayBuffer, not a view.
export const toArrayBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

// Replaces globalThis.fetch with a router: handler(url, init) returns a body
// object (sent as JSON with status 200), or {status, body}. Returns the call log
// and a restore function.
export function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    let r = await handler(String(url), init);
    if (!(r && typeof r === "object" && "status" in r && "body" in r)) r = { status: 200, body: r };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

// EXIF (big-endian TIFF) with UserComment in the Exif IFD, as A1111/Forge write it.
// encoding "unicode" = UTF-16BE (piexif's default), "unicode-le", or "ascii".
export function exifUserComment(text, encoding = "unicode") {
  const body = encoding === "ascii" ? concat(latin1("ASCII\0\0\0"), utf8(text))
    : concat(latin1("UNICODE\0"), Uint8Array.from([...text].flatMap((ch) => {
      const c = ch.charCodeAt(0);
      return encoding === "unicode-le" ? [c & 255, c >> 8] : [c >> 8, c & 255];
    })));
  const t = new Uint8Array(44 + body.length);
  const v = new DataView(t.buffer);
  t.set(latin1("MM"), 0); v.setUint16(2, 42); v.setUint32(4, 8);
  v.setUint16(8, 1); v.setUint16(10, 0x8769); v.setUint16(12, 4); v.setUint32(14, 1); v.setUint32(18, 26); v.setUint32(22, 0);
  v.setUint16(26, 1); v.setUint16(28, 0x9286); v.setUint16(30, 7); v.setUint32(32, body.length); v.setUint32(36, 44); v.setUint32(40, 0);
  t.set(body, 44);
  return t;
}

const segment = (marker, data) => concat([0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 255], data);

export function makeJpeg(text, { encoding, comment } = {}) {
  return concat([0xff, 0xd8], segment(0xe1, concat(latin1("Exif\0\0"), exifUserComment(text, encoding))),
    comment ? segment(0xfe, utf8(comment)) : new Uint8Array(0), [0xff, 0xda, 0, 2], [0xff, 0xd9]);
}

const le32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };

export function makeWebp(text, encoding = "ascii") {
  const t = exifUserComment(text, encoding);
  const body = concat(latin1("WEBP"), latin1("EXIF"), le32(t.length), t, t.length & 1 ? [0] : []);
  return concat(latin1("RIFF"), le32(body.length), body);
}
