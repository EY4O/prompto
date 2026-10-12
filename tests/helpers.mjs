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
