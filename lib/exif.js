// Text metadata from JPEG and WebP files: EXIF UserComment (where A1111/Forge,
// SwarmUI and Civitai put the generation data), ImageDescription, XPComment,
// JPEG comments and XMP. PNG text chunks are read by pngmeta.js.

const IMAGE_DESC = 0x010e, XP_COMMENT = 0x9c9c, EXIF_IFD = 0x8769, USER_COMMENT = 0x9286;
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

const utf8 = (b) => new TextDecoder("utf-8").decode(b).replace(/\0+$/, "");
const utf16 = (b, le) => new TextDecoder(le ? "utf-16le" : "utf-16be").decode(b).replace(/\0+$/, "");
const ascii = (u8, off, n) => String.fromCharCode(...u8.subarray(off, off + n));

function userComment(raw) {
  const head = ascii(raw, 0, 8), body = raw.subarray(8);
  if (head.startsWith("UNICODE")) {
    // A1111/piexif write UTF-16 big-endian; some tools write little-endian.
    const le = body.length > 1 && body[1] === 0 && body[0] !== 0;
    return utf16(body, le);
  }
  if (head.startsWith("ASCII") || raw.subarray(0, 8).every((b) => b === 0)) return utf8(body);
  return utf8(raw);
}

// TIFF structure inside an EXIF block → { ImageDescription, XPComment, UserComment }.
export function readExif(u8) {
  let t = u8;
  if (ascii(t, 0, 6) === "Exif\0\0") t = t.subarray(6);
  if (t.length < 8 || !["II", "MM"].includes(ascii(t, 0, 2))) return {};
  const le = ascii(t, 0, 2) === "II";
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u16 = (o) => v.getUint16(o, le), u32 = (o) => v.getUint32(o, le);
  const out = {};
  const entries = (off) => {
    const list = [];
    if (off + 2 > t.length) return list;
    const n = Math.min(u16(off), 512);
    for (let i = 0; i < n; i++) {
      const p = off + 2 + 12 * i;
      if (p + 12 > t.length) break;
      const tag = u16(p), type = u16(p + 2), count = u32(p + 4);
      const size = (TYPE_SIZE[type] || 1) * count;
      const at = size <= 4 ? p + 8 : u32(p + 8);
      if (at + size > t.length) continue;
      list.push({ tag, value: t.subarray(at, at + size) });
    }
    return list;
  };
  try {
    let exifIfd = 0;
    for (const { tag, value } of entries(u32(4))) {
      if (tag === EXIF_IFD) exifIfd = new DataView(value.buffer, value.byteOffset, 4).getUint32(0, le);
      else if (tag === IMAGE_DESC) out.ImageDescription = utf8(value);
      else if (tag === XP_COMMENT) out.XPComment = utf16(value, true);
    }
    if (exifIfd) for (const { tag, value } of entries(exifIfd)) if (tag === USER_COMMENT) out.UserComment = userComment(value);
  } catch {}
  return Object.fromEntries(Object.entries(out).filter(([, s]) => s.trim()));
}

const XMP_NS = "http://ns.adobe.com/xap/1.0/\0";

function jpeg(u8) {
  const out = {};
  let p = 2;
  while (p + 4 <= u8.length && u8[p] === 0xff) {
    const marker = u8[p + 1];
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan: no more metadata
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
    const len = (u8[p + 2] << 8) | u8[p + 3];
    const seg = u8.subarray(p + 4, p + 2 + len);
    p += 2 + len;
    if (marker === 0xe1 && ascii(seg, 0, 6) === "Exif\0\0") {
      for (const [k, s] of Object.entries(readExif(seg))) if (!(k in out)) out[k] = s;
    } else if (marker === 0xe1 && ascii(seg, 0, XMP_NS.length) === XMP_NS) {
      out.XMP ??= utf8(seg.subarray(XMP_NS.length));
    } else if (marker === 0xfe) out.Comment ??= utf8(seg);
  }
  return out;
}

function webp(u8) {
  const out = {};
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let p = 12;
  while (p + 8 <= u8.length) {
    const fourcc = ascii(u8, p, 4), size = v.getUint32(p + 4, true);
    const body = u8.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size & 1);
    if (fourcc === "EXIF") { for (const [k, s] of Object.entries(readExif(body))) if (!(k in out)) out[k] = s; }
    else if (fourcc === "XMP ") out.XMP ??= utf8(body);
  }
  return out;
}

// → { format: "jpeg" | "webp", text: {...} }, or null for anything else.
export function readJpegWebpText(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (u8.length > 3 && u8[0] === 0xff && u8[1] === 0xd8) return { format: "jpeg", text: jpeg(u8) };
  if (u8.length > 12 && ascii(u8, 0, 4) === "RIFF" && ascii(u8, 8, 4) === "WEBP") return { format: "webp", text: webp(u8) };
  return null;
}
