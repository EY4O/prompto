// The shared recipe format, `recipe/1` (also used by Model Librarian for ComfyUI;
// spec: https://github.com/EY4O/comfyui-model-librarian/blob/main/docs/RECIPE_FORMAT.md).
// Every image-metadata reader produces a recipe/1 object, which keeps the exact
// model references (hashes, Civitai version ids) needed to find the files again.
// toMeta() turns it into the compact shape the side panel files as a recipe.
// No DOM here, so the background worker can use it.

export const SCHEMA = "recipe/1";

export function empty() {
  return {
    schema: SCHEMA, id: null, title: "", created: null, format: "",
    source: { url: null, site: null, filename: null, image_id: null },
    prompt: { positive: "", negative: "" },
    settings: { sampler: null, scheduler: null, sampler_raw: null, steps: null, cfg: null, seed: null, width: null, height: null, denoise: null, clip_skip: null },
    model: null, vae: null, loras: [], base_model: null, tags: [], notes: "", comfy: null
  };
}

// ---------------------------------------------------------------- small helpers
export const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};
const int = (v) => { const n = num(v); return n ? Math.trunc(n) : null; };
const str = (v) => (v == null || v === "" ? null : String(v));

export function stem(p) {
  if (!p) return null;
  return String(p).replace(/\\/g, "/").split("/").pop().replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i, "");
}

export function ref({ name = null, file = null, hash = null, versionId = null, modelId = null, ...extra } = {}) {
  return {
    name: str(name) || stem(file), file: str(file), hash: hash ? String(hash).trim().toLowerCase() : null,
    civitai_version_id: int(versionId), civitai_model_id: int(modelId), ...extra
  };
}

export function lora({ weight = 1, clipWeight = null, ...rest } = {}) {
  return { ...ref(rest), weight: num(weight) ?? 1, clip_weight: num(clipWeight) };
}

const key = (l) => (l.hash || "").slice(0, 10) || String(l.civitai_version_id || "") || (stem(l.file) || l.name || "").toLowerCase();
const keys = (l) => new Set([key(l), (stem(l.file) || "").toLowerCase(), (l.name || "").toLowerCase()].filter(Boolean));

// Adds a LoRA, or enriches the one already listed under the same name, hash or version id.
export function mergeLora(list, add) {
  const nk = keys(add);
  for (const l of list) {
    const same = [...keys(l)].some((k) => nk.has(k)) || (add.civitai_version_id && add.civitai_version_id === l.civitai_version_id);
    if (same) {
      for (const [k, v] of Object.entries(add)) {
        if (v != null && (l[k] == null || l[k] === "" || l[k] === 1) && k !== "weight" && k !== "_src") l[k] = v;
      }
      return;
    }
  }
  list.push(add);
}

// No conflicting version id or hash (hashes compare on the shorter prefix).
function compatible(a, b) {
  if (a.civitai_version_id && b.civitai_version_id && a.civitai_version_id !== b.civitai_version_id) return false;
  const ha = (a.hash || "").toLowerCase(), hb = (b.hash || "").toLowerCase();
  const n = Math.min(ha.length, hb.length);
  return !(n && ha.slice(0, n) !== hb.slice(0, n));
}

// Civitai lists a LoRA twice: as a <lora:file:w> prompt tag and as a resource
// with only a display name + version id (or hash). A resource that matched
// nothing is folded into the one prompt-tag entry with the same strength.
export function pairResources(list) {
  const out = list.filter((l) => l._src !== "res");
  for (const res of list.filter((l) => l._src === "res")) {
    const cands = out.filter((l) => l._src === "tag" && compatible(l, res) && Math.abs((l.weight || 0) - (res.weight || 0)) < 1e-6);
    if (cands.length === 1) {
      const t = cands[0];
      for (const k of ["civitai_version_id", "civitai_model_id", "hash", "version"]) if (res[k] && !t[k]) t[k] = res[k];
      if (res.name && res.name !== t.name && !t.display_name) t.display_name = res.name;
    } else out.push(res);
  }
  for (const l of out) delete l._src;
  return out;
}

// A1111-style sampler names → ComfyUI sampler and scheduler.
export const SAMPLERS = {
  "euler a": "euler_ancestral", "euler": "euler", "heun": "heun", "lms": "lms", "ddim": "ddim", "unipc": "uni_pc", "lcm": "lcm",
  "dpm2": "dpm_2", "dpm2 a": "dpm_2_ancestral", "dpm fast": "dpm_fast", "dpm adaptive": "dpm_adaptive",
  "dpm++ 2m": "dpmpp_2m", "dpm++ 2m sde": "dpmpp_2m_sde", "dpm++ 2s a": "dpmpp_2s_ancestral", "dpm++ sde": "dpmpp_sde",
  "dpm++ 3m sde": "dpmpp_3m_sde", "restart": "restart", "res multistep": "res_multistep", "er sde": "er_sde",
  "dpm++ 2m sde gpu": "dpmpp_2m_sde_gpu", "dpm++ 3m sde gpu": "dpmpp_3m_sde_gpu", "euler cfg++": "euler_cfg_pp"
};
export const SCHEDULERS = {
  karras: "karras", exponential: "exponential", "sgm uniform": "sgm_uniform", simple: "simple", normal: "normal", beta: "beta",
  "align your steps": "align_your_steps", "ddim uniform": "ddim_uniform", "kl optimal": "kl_optimal", "linear quadratic": "linear_quadratic"
};

export function mapSampler(name, scheduleType) {
  let s = String(name || "").trim(), scheduler = "";
  const low = s.toLowerCase();
  for (const [k, v] of Object.entries(SCHEDULERS)) {
    if (low.endsWith(" " + k)) { scheduler = v; s = s.slice(0, -k.length - 1); break; }
  }
  if (!scheduler && scheduleType && String(scheduleType).toLowerCase() !== "automatic") {
    const st = String(scheduleType).toLowerCase();
    scheduler = SCHEDULERS[st] || st.replace(/\s+/g, "_");
  }
  const sampler = !s ? "" : SAMPLERS[s.toLowerCase()] || (/^[a-z0-9_]+$/.test(s) ? s : s.toLowerCase().replace(/\+\+/g, "pp").replace(/\s+/g, "_"));
  return { sampler, scheduler };
}

const LORA_TAG = /<(?:lora|lyco):([^:>]+)(?::(-?[\d.]+))?(?::(-?[\d.]+))?>/gi;

// Pulls <lora:name:w[:clip]> tags out of a prompt into the LoRA list.
export function takeLoraTags(text, list) {
  const tag = new RegExp(LORA_TAG.source + String.raw`,?\s*`, "gi"); // the tag and the separator after it
  const out = String(text || "").replace(tag, (_, n, w, c) => {
    mergeLora(list, { ...lora({ file: n.trim(), weight: w || 1, clipWeight: c }), _src: "tag" });
    return "";
  });
  return out.replace(/\s*,\s*(,\s*)+/g, ", ").replace(/[ \t]{2,}/g, " ").trim().replace(/^,|,$/g, "").trim();
}

// The JSON object/array starting at s[start] (string-aware brace matching).
function balanced(s, start) {
  const open = s[start], close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

// JSON.parse that turns NaN/Infinity (which ComfyUI writes into PNGs) into null.
export function loads(s) {
  if (typeof s !== "string") return s;
  try { return JSON.parse(s); } catch {}
  return JSON.parse(s.replace(/(?<=[:,\[]\s*)-?(NaN|Infinity)(?=\s*[,}\]])/g, "null"));
}

// ---------------------------------------------------------------- A1111 / Forge
export function parseA1111(text, { pair = true } = {}) {
  const r = empty();
  r.format = "a1111";
  const lines = String(text || "").trim().split("\n");
  const idx = lines.findIndex((l) => /^\s*Steps:\s*\d+/.test(l));
  const head = idx === -1 ? lines : lines.slice(0, idx);
  const negI = head.findIndex((l) => l.startsWith("Negative prompt:"));
  const positive = (negI === -1 ? head : head.slice(0, negI)).join("\n").trim();
  const negative = negI === -1 ? "" : head.slice(negI).join("\n").replace(/^Negative prompt:\s*/, "").trim();
  let tail = idx === -1 ? "" : lines.slice(idx).join(", ");
  // JSON blobs first (they contain commas)
  const blobs = {};
  for (const k of ["Hashes", "Civitai resources", "Civitai metadata"]) {
    const m = new RegExp(k.replace(/ /g, "\\s") + ":\\s*([\\[{])").exec(tail);
    if (!m) continue;
    const at = m.index + m[0].length - 1;
    const raw = balanced(tail, at);
    if (!raw) continue;
    try { blobs[k] = loads(raw); } catch {}
    tail = tail.slice(0, m.index) + tail.slice(at + raw.length);
  }
  const kv = {};
  for (const m of tail.matchAll(/([A-Za-z][\w /-]*?):\s*("(?:\\.|[^"\\])*"|[^,]*)(?:,|$)/g)) {
    const v = m[2].trim();
    kv[m[1].trim()] = v.length >= 2 && v[0] === '"' && v.endsWith('"') ? v.slice(1, -1) : v;
  }
  const loras = [];
  r.prompt.positive = takeLoraTags(positive, loras);
  r.prompt.negative = negative;
  const s = r.settings;
  s.sampler_raw = str(kv.Sampler);
  const ms = mapSampler(kv.Sampler, kv["Schedule type"]);
  s.sampler = ms.sampler || null; s.scheduler = ms.scheduler || null;
  s.steps = num(kv.Steps); s.cfg = num(kv["CFG scale"]); s.seed = num(kv.Seed);
  if ((kv.Size || "").includes("x")) { const [w, h] = kv.Size.split("x"); s.width = num(w); s.height = num(h); }
  s.denoise = num(kv["Denoising strength"]); s.clip_skip = num(kv["Clip skip"]);
  if (kv.Model || kv["Model hash"]) r.model = ref({ name: kv.Model, file: kv.Model, hash: kv["Model hash"] });
  if (kv.VAE || kv["VAE hash"]) r.vae = ref({ name: kv.VAE, file: kv.VAE, hash: kv["VAE hash"] });
  for (const pairText of (kv["Lora hashes"] || "").split(",")) {
    const i = pairText.indexOf(":");
    const n = pairText.slice(0, i).trim(), h = pairText.slice(i + 1).trim();
    if (i > 0 && n && h) mergeLora(loras, lora({ file: n, hash: h }));
  }
  const hashes = blobs.Hashes && typeof blobs.Hashes === "object" ? blobs.Hashes : {};
  for (const [k, h] of Object.entries(hashes)) {
    if (k === "model") { if (r.model) r.model.hash = r.model.hash || String(h).toLowerCase(); else r.model = ref({ hash: h }); }
    else if (k.startsWith("lora:")) mergeLora(loras, lora({ file: k.slice(5), hash: h }));
  }
  for (const res of Array.isArray(blobs["Civitai resources"]) ? blobs["Civitai resources"] : []) {
    const t = String(res.type || "").toLowerCase();
    if (t === "checkpoint" || t === "model") {
      const m0 = r.model || ref();
      m0.civitai_version_id = m0.civitai_version_id || int(res.modelVersionId);
      m0.name = m0.name || str(res.modelName);
      r.model = m0;
    } else if (["lora", "locon", "lycoris", "dora"].includes(t)) {
      mergeLora(loras, { ...lora({ name: res.modelName, weight: res.weight ?? 1, versionId: res.modelVersionId, version: res.modelVersionName }), _src: "res" });
    }
  }
  r.loras = pair ? pairResources(loras) : loras;
  return r;
}

// ---------------------------------------------------------------- other generators
export function parseNovelAI(comment, text = {}) {
  const c = loads(comment);
  const r = empty();
  r.format = "novelai";
  r.prompt.positive = c.prompt || text.Description || "";
  r.prompt.negative = c.uc || "";
  const s = r.settings;
  Object.assign(s, { steps: num(c.steps), cfg: num(c.scale), seed: num(c.seed), width: num(c.width), height: num(c.height),
    sampler_raw: str(c.sampler), sampler: str(c.sampler), scheduler: str(c.noise_schedule) });
  r.model = ref({ name: text.Source || "NovelAI", downloadable: false }); // NovelAI's models can't be downloaded
  return r;
}

export function parseInvokeAI(meta) {
  const m = loads(meta);
  const r = empty();
  r.format = "invokeai";
  r.prompt.positive = typeof m.positive_prompt === "string" ? m.positive_prompt : "";
  r.prompt.negative = m.negative_prompt || "";
  Object.assign(r.settings, { seed: num(m.seed), steps: num(m.steps), cfg: num(m.cfg_scale), width: num(m.width), height: num(m.height), scheduler: str(m.scheduler) });
  const mod = m.model || {};
  if (mod.name || mod.model_name) r.model = ref({ name: mod.name || mod.model_name, hash: String(mod.hash || "").replace("blake3:", "") || null });
  for (const e of m.loras || []) {
    const lm = e.model || e.lora || {};
    const n = lm.name || lm.model_name;
    if (n) mergeLora(r.loras, lora({ name: n, file: n, weight: e.weight ?? 1 }));
  }
  return r;
}

// SwarmUI (sui_image_params) and Fooocus write JSON into `parameters`.
export function parseJsonParameters(p) {
  if (p && typeof p.sui_image_params === "object") {
    const q = p.sui_image_params;
    const r = empty();
    r.format = "swarmui";
    r.prompt.positive = q.prompt || ""; r.prompt.negative = q.negativeprompt || "";
    Object.assign(r.settings, { seed: num(q.seed), steps: num(q.steps), cfg: num(q.cfgscale), width: num(q.width), height: num(q.height),
      sampler: str(q.sampler), scheduler: str(q.scheduler), clip_skip: q.clipstopatlayer ? Math.abs(int(q.clipstopatlayer)) : null });
    if (q.model) r.model = ref({ file: q.model });
    if (q.vae) r.vae = ref({ file: q.vae });
    const w = q.loraweights || [];
    (q.loras || []).forEach((n, i) => mergeLora(r.loras, lora({ file: n, weight: i < w.length ? w[i] : 1 })));
    return r;
  }
  const has = (...ks) => ks.some((k) => p && k in p);
  if (has("Prompt", "prompt") && has("Base Model", "base_model", "base_model_name", "Fooocus V2 Expansion", "fooocus_scheme")) {
    const g = (...ks) => { for (const k of ks) if (p[k] != null) return p[k]; return null; };
    const r = empty();
    r.format = "fooocus";
    r.prompt.positive = g("Prompt", "prompt") || ""; r.prompt.negative = g("Negative Prompt", "negative_prompt") || "";
    Object.assign(r.settings, { seed: num(g("Seed", "seed")), steps: num(g("Steps", "steps")), cfg: num(g("Guidance Scale", "guidance_scale")),
      sampler: str(g("Sampler", "sampler")), scheduler: str(g("Scheduler", "scheduler")) });
    const m = /(\d+)\D+(\d+)/.exec(String(g("Resolution", "resolution") || ""));
    if (m) { r.settings.width = Number(m[1]); r.settings.height = Number(m[2]); }
    const bm = g("Base Model", "base_model", "base_model_name");
    if (bm) r.model = ref({ file: bm, hash: g("Base Model Hash", "base_model_hash") });
    for (const [k, v] of Object.entries(p)) {
      if (/^LoRA \d+$/.test(k) && typeof v === "string" && v.includes(":")) {
        const i = v.lastIndexOf(":");
        mergeLora(r.loras, lora({ file: v.slice(0, i).trim(), weight: v.slice(i + 1).trim() }));
      }
    }
    for (const e of Array.isArray(p.loras) ? p.loras : []) {
      if (Array.isArray(e) && e.length) mergeLora(r.loras, lora({ file: e[0], weight: e.length > 1 ? e[1] : 1, hash: e.length > 2 ? e[2] : null }));
    }
    return r;
  }
  return null;
}

// Metadata fields (PNG chunks / EXIF) → recipe/1, or null. ComfyUI's `prompt`
// graph is handled by pngmeta.parseComfy, which also keeps where the prompt
// text lives in the graph.
export function fromText(text) {
  if (text.recipe) {
    try { const r = loads(text.recipe); if (r && r.schema === SCHEMA) return r; } catch {}
  }
  const params = text.parameters || text.UserComment || "";
  let pjson = null;
  if (params.trim().startsWith("{")) { try { pjson = loads(params); } catch {} }
  try {
    if (text.invokeai_metadata) return parseInvokeAI(text.invokeai_metadata);
    if (pjson) { const r = parseJsonParameters(pjson); if (r) return r; }
    if (params && !pjson) return parseA1111(params);
    if (text.Comment && (String(text.Software || "").startsWith("NovelAI") || text.Comment.trim().startsWith('{"prompt"'))) return parseNovelAI(text.Comment, text);
  } catch {}
  return null;
}

// Adds hashes / Civitai ids / missing settings from a second source.
export function enrich(base, extra) {
  if (extra.model) {
    if (!base.model) base.model = extra.model;
    else for (const [k, v] of Object.entries(extra.model)) if (v != null && !base.model[k]) base.model[k] = v;
  }
  for (const l of extra.loras || []) mergeLora(base.loras, { ...l });
  for (const [k, v] of Object.entries(extra.settings || {})) if (v != null && base.settings[k] == null) base.settings[k] = v;
  for (const k of ["positive", "negative"]) if (!base.prompt[k] && extra.prompt[k]) base.prompt[k] = extra.prompt[k];
  return base;
}

// ---------------------------------------------------------------- Civitai
// /api/v1/images item (withMeta) → recipe/1, keeping hashes and version ids.
export function fromCivitaiItem(item, pageUrl = null) {
  const meta = (item && item.meta) || {};
  const m = meta.meta && typeof meta.meta === "object" ? meta.meta : meta;
  const lines = [String(m.prompt || "")];
  if (m.negativePrompt) lines.push("Negative prompt: " + m.negativePrompt);
  const a = parseA1111(lines.join("\n"), { pair: false });
  const s = a.settings;
  s.sampler_raw = str(m.sampler);
  const ms = mapSampler(m.sampler, m["Schedule type"] || m.scheduler);
  s.sampler = ms.sampler || null; s.scheduler = ms.scheduler || null;
  s.steps = num(m.steps); s.cfg = num(m.cfgScale); s.seed = num(m.seed);
  if (String(m.Size || "").includes("x")) { const [w, h] = String(m.Size).split("x"); s.width = num(w); s.height = num(h); }
  s.width = s.width || num(m.width) || num(item.width); s.height = s.height || num(m.height) || num(item.height);
  s.denoise = num(m["Denoising strength"] ?? m.denoise); s.clip_skip = num(m.clipSkip ?? m["Clip skip"]);
  a.model = m.Model || m["Model hash"] ? ref({ name: m.Model, file: m.Model, hash: m["Model hash"] }) : null;
  const CHECKPOINT = ["model", "checkpoint", "diffusionmodel", "diffusion_model", "unet"];
  for (const res of m.resources || []) {
    const t = String(res.type || "").toLowerCase();
    if (CHECKPOINT.includes(t)) {
      const mr = ref({ name: res.name, hash: res.hash });
      if (a.model) { for (const [k, v] of Object.entries(mr)) if (v != null && !a.model[k]) a.model[k] = v; } else a.model = mr;
    } else if (["lora", "locon", "lycoris", "dora"].includes(t)) {
      mergeLora(a.loras, { ...lora({ name: res.name, weight: res.weight ?? 1, hash: res.hash }), _src: "res" });
    }
  }
  for (const res of m.civitaiResources || []) {
    const t = String(res.type || "").toLowerCase();
    if (CHECKPOINT.includes(t)) {
      a.model = a.model || ref();
      a.model.civitai_version_id = a.model.civitai_version_id || int(res.modelVersionId);
      a.model.name = a.model.name || str(res.modelName);
    } else if (["lora", "locon", "lycoris", "dora"].includes(t)) {
      mergeLora(a.loras, { ...lora({ name: res.modelName || (res.modelVersionId ? null : res.modelVersionName), weight: res.weight ?? 1, versionId: res.modelVersionId, version: res.modelVersionName }), _src: "res" });
    }
  }
  for (const [k, h] of Object.entries(m.hashes || {})) {
    if (k === "model" && a.model) a.model.hash = a.model.hash || String(h).toLowerCase();
    else if (k.startsWith("lora:")) mergeLora(a.loras, lora({ file: k.slice(5), hash: h }));
  }
  a.loras = pairResources(a.loras);
  let comfy = null;
  try {
    const c = loads(m.comfy);
    if (c && c.prompt) comfy = { prompt: loads(c.prompt) };
  } catch {}
  a.comfy = comfy;
  a.format = "civitai";
  a.base_model = str(item.baseModel || m.baseModel);
  const host = (() => { try { return new URL(pageUrl).hostname; } catch { return "civitai.com"; } })();
  a.source = { url: pageUrl || (item.id ? `https://${host}/images/${item.id}` : null), site: "civitai", filename: null, image_id: item.id ?? null };
  a.title = item.id ? `Civitai #${item.id}` : "Civitai image";
  return a;
}

// ---------------------------------------------------------------- Prompto's compact shape
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ""));

// recipe/1 → the meta the side panel files ({ format, positive, negative, settings, ref }).
// LoRAs keep their hash / Civitai version id when known, so ComfyUI-Prompto and
// Model Librarian can find the exact files.
export function toMeta(rec, format) {
  const s = rec.settings || {};
  const m = rec.model;
  const settings = {
    model: (m && (m.file || m.name)) || "",
    loras: (rec.loras || []).map((l) => clean({
      name: l.file || l.name || l.display_name || l.version || `civitai-${l.civitai_version_id}`, w: l.weight ?? 1, clip: l.clip_weight ?? null,
      hash: l.hash, versionId: l.civitai_version_id, label: l.display_name
    })),
    sampler: s.sampler || s.sampler_raw || "",
    scheduler: s.scheduler || "",
    steps: s.steps ?? undefined, cfg: s.cfg ?? undefined, seed: s.seed ?? undefined,
    width: s.width ?? undefined, height: s.height ?? undefined
  };
  if (m && (m.hash || m.civitai_version_id)) settings.modelRef = clean({ hash: m.hash, versionId: m.civitai_version_id });
  if (rec.base_model) settings.baseModel = rec.base_model;
  if (s.clip_skip) settings.clipSkip = s.clip_skip;
  return { format: format || rec.format, positive: rec.prompt.positive || "", negative: rec.prompt.negative || "", settings };
}

// A Prompto recipe or meta ({ settings, positive?, negative?, title? }) → recipe/1,
// e.g. for share cards and for handing a recipe to Model Librarian.
export function fromMeta(x, { positive, negative, title } = {}) {
  const s = x.settings || {};
  const r = empty();
  r.format = "prompto";
  r.title = title ?? x.title ?? "";
  r.prompt.positive = positive ?? x.positive ?? "";
  r.prompt.negative = negative ?? x.negative ?? "";
  Object.assign(r.settings, { sampler: str(s.sampler), scheduler: str(s.scheduler), steps: num(s.steps), cfg: num(s.cfg), seed: num(s.seed),
    width: num(s.width), height: num(s.height), clip_skip: num(s.clipSkip) });
  const mr = s.modelRef || {};
  if (s.model || mr.hash || mr.versionId) r.model = ref({ name: stem(s.model), file: s.model || null, hash: mr.hash, versionId: mr.versionId });
  r.loras = (s.loras || []).filter((l) => l && l.name).map((l) => ({
    ...lora({ name: l.label || stem(l.name), file: l.name, hash: l.hash, versionId: l.versionId, weight: l.w ?? 1, clipWeight: l.clip }),
    ...(l.label ? { display_name: l.label } : {})
  }));
  r.base_model = str(s.baseModel);
  return r;
}
