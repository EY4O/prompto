// Shareable cards: a recipe or cast member drawn as a Prompto ticket, saved as
// a PNG with its data in text chunks so Prompto (and Forge/ComfyUI) can read
// it back. Needs a DOM (canvas), so it's only used by the side panel.

// ---------- PNG text chunks ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
const ascii = (s) => /^[\x00-\x7f]*$/.test(s);
// JSON can carry any character as \uXXXX, which keeps it plain ASCII for tEXt.
export const asciiJson = (v) => JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

// tEXt when the text is ASCII (every reader understands it), iTXt (UTF-8) otherwise.
function textChunk(key, text) {
  const enc = new TextEncoder();
  if (ascii(text)) return chunk("tEXt", new Uint8Array([...enc.encode(key), 0, ...enc.encode(text)]));
  return chunk("iTXt", new Uint8Array([...enc.encode(key), 0, 0, 0, 0, 0, ...enc.encode(text)]));
}

export function withTextChunks(png, entries) {
  const iend = png.length - 12; // IEND is always the last 12 bytes
  const extra = Object.entries(entries).filter(([, v]) => v != null).map(([k, v]) => textChunk(k, v));
  const size = extra.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(png.length + size);
  out.set(png.subarray(0, iend));
  let p = iend;
  for (const c of extra) { out.set(c, p); p += c.length; }
  out.set(png.subarray(iend), p);
  return out;
}

// ---------- Drawing ----------
const W = 768, H = 1088, STUB = 168, PERF = 9, NOTCH = 22;

function hues(stock) {
  const m = [...String(stock || "").matchAll(/--l\d:(#[0-9a-f]{6})/gi)].map((x) => x[1]);
  return m.length ? m : ["#fde3ea", "#ffbdd2", "#f9d6d6", "#f2dcff", "#f2c4c4"];
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous"; // a remote image without CORS would block the export, so it's skipped
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrap(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? line + " " + w : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = next;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(last + "…").width > maxWidth && last.length) last = last.slice(0, -1);
    lines[maxLines - 1] = last.replace(/[\s,]+$/, "") + "…";
  }
  return lines;
}

function pill(ctx, x, y, text, dark) {
  ctx.font = "500 18px Oswald, 'Arial Narrow', sans-serif";
  const w = ctx.measureText(text).width + 28, h = 32;
  ctx.fillStyle = dark ? "#fbfaff" : "rgba(16,17,23,0.88)";
  // Round top-left and bottom-right corners, like the panel's 999px 0 pills.
  ctx.beginPath();
  ctx.moveTo(x + h, y); ctx.lineTo(x + w, y);
  ctx.arcTo(x + w, y + h, x + w - h, y + h, h); ctx.lineTo(x, y + h);
  ctx.arcTo(x, y, x + h, y, h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = dark ? "#101117" : "#fbfaff";
  ctx.fillText(text, x + 14, y + 23);
  return w;
}

function barcode(ctx, x, y, w, h, seed) {
  let s = 0;
  for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1000) / 1000; };
  let px = x;
  while (px < x + w) {
    const bw = rnd() > 0.6 ? 4 : 2;
    ctx.fillRect(px, y, bw, h);
    px += bw + 2 + Math.floor(rnd() * 5);
  }
}

function ticketShape(ctx) {
  // The ticket body with perforated top and bottom edges and notches at the tear line.
  ctx.save();
  ctx.beginPath();
  const r = 24;
  ctx.moveTo(r, 0); ctx.lineTo(W - r, 0); ctx.arcTo(W, 0, W, r, r); ctx.lineTo(W, H - r); ctx.arcTo(W, H, W - r, H, r);
  ctx.lineTo(r, H); ctx.arcTo(0, H, 0, H - r, r); ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r); ctx.closePath();
  ctx.clip();
  return () => {
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    const hole = (cx, cy, r) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); };
    for (let x = 16; x < W; x += 28) { hole(x, 0, PERF); hole(x, H, PERF); }
    hole(0, H - STUB, NOTCH); hole(W, H - STUB, NOTCH);
    ctx.restore();
  };
}

// card = { kind, tag, no, title, cover, lines: [{label, text}], footer, stock, seed }
export async function drawCard(card) {
  await Promise.all(["700 64px Oswald", "500 18px Oswald", "400 18px 'IBM Plex Mono'"].map((f) => document.fonts.load(f).catch(() => {})));
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const finish = ticketShape(ctx);
  const h = hues(card.stock);
  const bg = ctx.createConicGradient ? ctx.createConicGradient(3.5, W * 0.62, H * 0.42) : ctx.createLinearGradient(0, 0, W, H);
  h.concat(h[0]).forEach((c, i, a) => bg.addColorStop(i / (a.length - 1), c));
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const sheen = ctx.createLinearGradient(0, 0, 0, H);
  sheen.addColorStop(0, "rgba(255,240,245,0.55)"); sheen.addColorStop(0.7, "rgba(255,240,245,0.15)"); sheen.addColorStop(1, "rgba(183,110,121,0.18)");
  ctx.fillStyle = sheen; ctx.fillRect(0, 0, W, H);

  // watermark number
  ctx.font = "700 300px Oswald, 'Arial Narrow', sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.textAlign = "right";
  ctx.fillText(card.mark || "", W - 30, 330);
  ctx.textAlign = "left";

  pill(ctx, 44, 44, card.tag);
  ctx.font = "300 22px Oswald, 'Arial Narrow', sans-serif";
  ctx.fillStyle = "#101117";
  ctx.textAlign = "right";
  ctx.fillText(card.no || "", W - 44, 68);
  ctx.textAlign = "left";

  ctx.font = "700 64px Oswald, 'Arial Narrow', sans-serif";
  ctx.fillStyle = "rgba(16,17,23,0.92)";
  const titleLines = wrap(ctx, String(card.title).toUpperCase(), W - 88, 2);
  titleLines.forEach((l, i) => ctx.fillText(l, 44, 150 + i * 62));
  let y = 150 + titleLines.length * 62 - 10;

  const img = await loadImage(card.cover);
  const coverH = 360;
  if (img) {
    const scale = Math.max((W - 88) / img.width, coverH / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    ctx.save();
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(44, y, W - 88, coverH, 16) : ctx.rect(44, y, W - 88, coverH); ctx.clip();
    ctx.drawImage(img, 44 + (W - 88 - dw) / 2, y + (coverH - dh) / 2, dw, dh);
    ctx.restore();
    y += coverH + 28;
  } else y += 18;

  const bottom = H - STUB - 30;
  for (const block of card.lines) {
    if (y > bottom - 40) break;
    ctx.font = "500 18px Oswald, 'Arial Narrow', sans-serif";
    ctx.fillStyle = "#101117";
    ctx.fillText(block.label.toUpperCase(), 44, y);
    y += 30;
    ctx.font = "400 19px 'IBM Plex Mono', Consolas, monospace";
    ctx.fillStyle = "rgba(16,17,23,0.82)";
    const room = Math.max(1, Math.floor((bottom - y) / 27));
    for (const l of wrap(ctx, block.text, W - 88, Math.min(block.max || 8, room))) { ctx.fillText(l, 44, y); y += 27; }
    y += 18;
  }

  // tear line and stub
  ctx.strokeStyle = "rgba(16,17,23,0.28)";
  ctx.setLineDash([10, 8]); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(NOTCH + 6, H - STUB); ctx.lineTo(W - NOTCH - 6, H - STUB); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = "300 20px Oswald, 'Arial Narrow', sans-serif";
  ctx.fillStyle = "#101117";
  wrap(ctx, card.footer || "", W - 330, 2).forEach((l, i) => ctx.fillText(l, 44, H - STUB + 56 + i * 28));
  ctx.font = "700 30px Oswald, 'Arial Narrow', sans-serif";
  ctx.fillText("PROMPTO", 44, H - 40);
  ctx.font = "400 14px 'IBM Plex Mono', Consolas, monospace";
  ctx.fillStyle = "rgba(16,17,23,0.6)";
  ctx.fillText("drop this card on Prompto to import it", 200, H - 46);
  ctx.fillStyle = "#101117";
  barcode(ctx, W - 270, H - STUB + 36, 226, 64, card.seed || card.title);
  finish();
  return canvas;
}

export async function cardPng(card, chunks) {
  const canvas = await drawCard(card);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  return withTextChunks(new Uint8Array(await blob.arrayBuffer()), chunks);
}
