// Civitai image recipes. Civitai's CDN usually strips PNG metadata, so the
// generation data comes from its public images API instead. No DOM here, so
// the background worker can use it.
import { parseComfy } from "./pngmeta.js";

export function imageIdFromUrl(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)civitai\.(com|green|red)$/.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/images\/(\d+)/);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

// A1111-style sampler names → ComfyUI sampler and scheduler.
const SAMPLERS = {
  "euler a": "euler_ancestral", "euler": "euler", "heun": "heun", "lms": "lms", "ddim": "ddim", "unipc": "uni_pc", "lcm": "lcm",
  "dpm2": "dpm_2", "dpm2 a": "dpm_2_ancestral", "dpm fast": "dpm_fast", "dpm adaptive": "dpm_adaptive",
  "dpm++ 2m": "dpmpp_2m", "dpm++ 2m sde": "dpmpp_2m_sde", "dpm++ 2s a": "dpmpp_2s_ancestral", "dpm++ sde": "dpmpp_sde",
  "dpm++ 3m sde": "dpmpp_3m_sde", "restart": "restart", "res multistep": "res_multistep", "er sde": "er_sde"
};
const SCHEDULERS = { karras: "karras", exponential: "exponential", "sgm uniform": "sgm_uniform", simple: "simple", normal: "normal", beta: "beta", "align your steps": "align_your_steps" };

export function mapSampler(name, scheduleType) {
  let s = String(name || "").trim(), scheduler = "";
  const low = s.toLowerCase();
  for (const [k, v] of Object.entries(SCHEDULERS)) {
    if (low.endsWith(" " + k)) { scheduler = v; s = s.slice(0, -k.length - 1); break; }
  }
  if (!scheduler && scheduleType) scheduler = SCHEDULERS[String(scheduleType).toLowerCase()] || String(scheduleType).toLowerCase();
  const sampler = SAMPLERS[s.toLowerCase()] || (/^[a-z0-9_]+$/.test(s) ? s : s.toLowerCase().replace(/\+\+/g, "pp").replace(/\s+/g, "_"));
  return { sampler, scheduler };
}

// The CDN serves any width; a 450px copy is plenty for thumbnails.
export const smallImage = (url) => String(url || "").replace(/\/(original=true|width=\d+)\//, "/width=450/");

async function fetchItem(id, extra = "") {
  const res = await fetch(`https://civitai.com/api/v1/images?imageId=${id}&withMeta=true${extra}`, { credentials: "omit" });
  if (!res.ok) throw new Error(`Civitai answered ${res.status}`);
  const d = await res.json();
  return (d.items || [])[0] || null;
}

export async function fetchCivitaiImage(id) {
  // Images above the default content level only come back when asked for.
  const item = (await fetchItem(id)) || (await fetchItem(id, "&nsfw=X"));
  if (!item) throw new Error("Civitai has no public image with that id");
  return item;
}

export function civitaiToRecipe(item) {
  const m = (item.meta && item.meta.meta) || item.meta || {};
  const loras = [];
  const addLora = (name, w) => {
    if (!name || loras.some((l) => l.name.toLowerCase() === String(name).toLowerCase())) return;
    loras.push({ name: String(name), w: Number(w ?? 1) });
  };
  let positive = String(m.prompt || "").replace(/<lora:([^:>]+):?(-?[\d.]*)>/g, (_, n, w) => { addLora(n, w || 1); return ""; });
  positive = positive.replace(/[ \t]{2,}/g, " ").replace(/\s*,\s*(,\s*)+/g, ", ").replace(/[,\s]+$/, "").trim();
  for (const r of m.resources || []) if (r.type === "lora") addLora(r.name, r.weight);
  for (const r of m.civitaiResources || []) if (r.type === "lora" && r.modelVersionName) addLora(r.modelVersionName, r.weight);
  const [w, h] = String(m.Size || "").split("x").map(Number);
  const { sampler, scheduler } = mapSampler(m.sampler, m["Schedule type"]);
  const model = m.Model || ((m.resources || []).find((r) => r.type === "model") || {}).name || "";

  // Images made on Civitai with ComfyUI carry the graph; keep it for Queue saved graph.
  let comfy = null;
  try {
    const c = typeof m.comfy === "string" ? JSON.parse(m.comfy) : m.comfy;
    if (c && c.prompt) comfy = parseComfy(c.prompt).comfy;
  } catch {}

  return {
    format: "Civitai",
    positive,
    negative: String(m.negativePrompt || "").trim(),
    comfy,
    settings: {
      model, loras, sampler, scheduler,
      steps: m.steps != null ? Number(m.steps) : undefined,
      cfg: m.cfgScale != null ? Number(m.cfgScale) : undefined,
      seed: m.seed != null ? Number(m.seed) : undefined,
      width: w || m.width || item.width || undefined,
      height: h || m.height || item.height || undefined
    }
  };
}
