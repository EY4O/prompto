// Civitai image recipes. Civitai's CDN usually strips image metadata, so the
// generation data comes from its public images API instead, on the same host
// as the page (civitai.com, civitai.green or civitai.red). Hashes and model
// version ids are kept, so the exact files can be found again. No DOM here, so
// the background worker can use it.
import { parseComfy } from "./pngmeta.js";
import { fromCivitaiItem, toMeta, mapSampler, stem } from "./recipe1.js";

const base = (n) => (stem(n) || "").toLowerCase();

export { mapSampler };

const HOST = /(^|\.)civitai\.(com|green|red)$/;

function civitaiUrl(url) {
  try {
    const u = new URL(url);
    return HOST.test(u.hostname) ? u : null;
  } catch { return null; }
}

export function imageIdFromUrl(url) {
  const u = civitaiUrl(url);
  const m = u && u.pathname.match(/^\/images\/(\d+)/);
  return m ? Number(m[1]) : null;
}

export function postIdFromUrl(url) {
  const u = civitaiUrl(url);
  const m = u && u.pathname.match(/^\/posts\/(\d+)/);
  return m ? Number(m[1]) : null;
}

// The site the link is on, so .red/.green links stay on their own host.
export function hostOf(url) {
  const u = civitaiUrl(url);
  return u ? u.hostname.replace(/^www\./, "") : "civitai.com";
}

// The CDN serves any width; a 450px copy is plenty for thumbnails.
export const smallImage = (url) => String(url || "").replace(/\/(original=true|width=\d+)\//, "/width=450/");

async function images(host, query) {
  const get = async (h) => {
    const res = await fetch(`https://${h}/api/v1/images?${query}&withMeta=true`, { credentials: "omit" });
    if (!res.ok) throw new Error(`Civitai answered ${res.status}`);
    return (await res.json()).items || [];
  };
  try { return await get(host); } catch (e) {
    if (host === "civitai.com") throw e;
    return get("civitai.com"); // the API lives on civitai.com too
  }
}

// Images above the default content level only come back when asked for.
const withNsfw = async (host, query) => {
  const items = await images(host, query);
  return items.length ? items : images(host, query + "&nsfw=X");
};

export async function fetchCivitaiImage(id, host = "civitai.com") {
  const item = (await withNsfw(host, `imageId=${id}`))[0];
  if (!item) throw new Error("Civitai has no public image with that id");
  return item;
}

// Every image in a post (up to 50); ones without generation data are kept, flagged.
export async function fetchCivitaiPost(id, host = "civitai.com") {
  const items = await withNsfw(host, `postId=${id}&limit=50`);
  if (!items.length) throw new Error("Civitai has no public images in that post");
  return items;
}

export const hasMeta = (item) => {
  const m = (item && item.meta && (item.meta.meta || item.meta)) || {};
  return !!(m.prompt || m.comfy || (m.resources || []).length || (m.civitaiResources || []).length);
};

// → { format, positive, negative, comfy, settings } (settings carry modelRef,
// baseModel and each LoRA's hash / versionId when Civitai knows them).
export function civitaiToRecipe(item, pageUrl = null) {
  const rec = fromCivitaiItem(item || {}, pageUrl);
  const meta = toMeta(rec, "Civitai");
  // Images made on Civitai with ComfyUI carry the graph; keep it for Queue saved
  // graph. Its loaders also name the real model and LoRA files (with folders),
  // which Civitai's resource list sometimes leaves out.
  let comfy = null;
  try {
    if (rec.comfy && rec.comfy.prompt) {
      const g = parseComfy(rec.comfy.prompt);
      comfy = g.comfy;
      if (g.settings.model) meta.settings.model = g.settings.model;
      for (const l of g.settings.loras) {
        const hit = meta.settings.loras.find((x) => base(x.name) === base(l.name));
        if (hit) hit.name = l.name;
        else meta.settings.loras.push({ name: l.name, w: l.w });
      }
    }
  } catch {}
  return { format: "Civitai", positive: meta.positive, negative: meta.negative, comfy, settings: meta.settings };
}

// The original file, when it's a ComfyUI PNG, carries the whole workflow, which
// Civitai's API leaves out unless the image was made on Civitai. The API's prompt,
// base model and hashes stay; the file adds the graph (for Queue saved graph) and
// the real model and LoRA file names.
export function withFileRecipe(meta, file) {
  if (!meta || !file || file.format !== "ComfyUI" || !file.comfy || !file.comfy.graph) return meta;
  const out = { ...meta, settings: { ...meta.settings } };
  if (!out.comfy) out.comfy = file.comfy;
  if (!String(out.positive || "").trim() && file.positive) out.positive = file.positive;
  if (!String(out.negative || "").trim() && file.negative) out.negative = file.negative;
  const fs = file.settings || {};
  if (fs.model) out.settings.model = fs.model;
  const loras = (out.settings.loras || []).map((l) => ({ ...l }));
  for (const l of fs.loras || []) {
    const hit = loras.find((x) => base(x.name) === base(l.name));
    if (hit) hit.name = l.name;
    else loras.push({ name: l.name, w: l.w });
  }
  out.settings.loras = loras;
  return out;
}

// Civitai's own generator lists the checkpoint and LoRAs by version id only, with
// no names. Its model-versions API names each one: the model's name, the primary
// file and that file's SHA256, which is what Model Librarian downloads by.
export async function fetchVersion(id, host = "civitai.com") {
  const get = async (h) => {
    const res = await fetch(`https://${h}/api/v1/model-versions/${id}`, { credentials: "omit" });
    if (!res.ok) throw new Error(`Civitai answered ${res.status}`);
    return res.json();
  };
  try { return await get(host); } catch (e) {
    if (host === "civitai.com") throw e;
    return get("civitai.com");
  }
}

export function versionFile(v) {
  const files = (v && v.files) || [];
  const f = files.find((x) => x.primary) || files.find((x) => /model/i.test(x.type || "")) || files[0];
  return f ? { file: f.name, hash: f.hashes && f.hashes.SHA256 ? String(f.hashes.SHA256).toLowerCase() : null } : null;
}

const unnamed = (n) => !n || /^civitai-\d+$/.test(n);

// Fills in names, file names and hashes for resources known only by version id.
// lookup(versionId) resolves to a model-versions answer (or rejects); a lookup that
// fails leaves that resource as it was.
export async function nameResources(meta, lookup) {
  if (!meta || !meta.settings) return meta;
  const s = meta.settings;
  const seen = new Map();
  const get = (id) => {
    if (!seen.has(id)) seen.set(id, Promise.resolve().then(() => lookup(id)).catch(() => null));
    return seen.get(id);
  };
  const loras = await Promise.all((s.loras || []).map(async (l) => {
    if (!l.versionId || !unnamed(l.name)) return l;
    const v = await get(l.versionId), f = versionFile(v);
    if (!f) return l;
    return { ...l, name: f.file, label: l.label || (v.model && v.model.name) || v.name, ...(l.hash || !f.hash ? {} : { hash: f.hash }) };
  }));
  const settings = { ...s, loras };
  const ref = s.modelRef || {};
  if (!s.model && ref.versionId) {
    const v = await get(ref.versionId), f = versionFile(v);
    if (f) {
      settings.model = f.file;
      settings.modelRef = { ...ref, ...(ref.hash || !f.hash ? {} : { hash: f.hash }) };
    }
  }
  return { ...meta, settings };
}
