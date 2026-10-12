import { proseFromTags } from "./prose.js";

// Turns a recipe's blocks into prompt text for a given model profile.
// Profiles live in the library (db.profiles) so they can be edited; these are
// the starting presets and what "Reset" restores.

// Holographic paper stocks a profile's tickets can be printed on.
export const STOCKS = {
  blush: "--l1:#fde3ea;--l2:#ffbdd2;--l3:#f9d6d6;--l4:#f2dcff;--l5:#f2c4c4",
  ruby: "--l1:#ffc2cf;--l2:#ff8fa8;--l3:#ffd1d9;--l4:#ffb3e6;--l5:#e0435a;--l6:#ffe4ea;--l7:#ffd7e9",
  pearl: "--l1:#ffffff;--l2:#f4eefc;--l3:#fff6f2;--l4:#e8e2ff;--l5:#e9dde6;--l7:#e6f4ff",
  gold: "--l1:#f7dccf;--l2:#e9b3a4;--l3:#fbe8dc;--l4:#f1d0d8;--l5:#b76e79;--l6:#fff1e8;--l7:#f6e2c9",
  lilac: "--l1:#efe6ff;--l2:#d9c8ff;--l3:#f4eefc;--l4:#c9b8f0;--l5:#9b7fd1;--l6:#faf6ff;--l7:#dcefff",
  sky: "--l1:#e6f4ff;--l2:#cfe6ff;--l3:#f2f8ff;--l4:#dcd6ff;--l5:#7cc3dd;--l6:#f4fbff;--l7:#e8fff8"
};
export const huesOf = (p) => STOCKS[p && p.stock] || STOCKS.blush;

export const DEFAULT_PROFILES = {
  illustrious: {
    id: "illustrious", label: "Illustrious", base: "SDXL · CLIP", format: "tags", weights: true, clip: true,
    prefix: ["masterpiece", "best quality", "amazing quality", "very aesthetic", "absurdres", "newest"],
    negative: "lowres, worst quality, bad quality, bad anatomy, jpeg artifacts, signature, watermark, text",
    hint: "Euler a · 28 steps · CFG 5", stock: "blush"
  },
  anima: {
    id: "anima", label: "Anima", base: "Tags + prose", format: "hybrid", weights: false, clip: false,
    prefix: ["masterpiece", "best quality"],
    negative: "worst quality, low quality, bad anatomy, watermark",
    hint: "Tags first, then a sentence", stock: "ruby"
  },
  krea: {
    id: "krea", label: "Flux Krea", base: "Prose · no negative", format: "prose", weights: false, clip: false,
    prefix: [], negative: null,
    hint: "Guidance 4.5 · 28 steps · CFG 1", stock: "pearl"
  },
  qwen: {
    id: "qwen", label: "Qwen Image", base: "Long prose · text", format: "prose", weights: false, clip: false,
    prefix: [], negative: "blurry, low quality, distorted text",
    hint: "CFG 4 · 40 steps", stock: "gold"
  }
};

export const BLOCK_TYPES = ["subject", "character", "outfit", "pose", "scene", "lighting", "camera", "style"];

const escapeTag = (t) => t.replace(/([()])/g, "\\$1");
export const fmtTag = ({ t, w = 1 }, weights = true) =>
  weights && Math.abs(w - 1) > 0.001 ? `(${escapeTag(t)}:${w.toFixed(1)})` : escapeTag(t);

// Expands character references into ordinary blocks.
export function resolveBlocks(recipe, db) {
  const out = [];
  for (const b of recipe.blocks) {
    if (b.type === "character" && b.ref) {
      const c = db.characters.find((x) => x.id === b.ref);
      if (!c) continue;
      const tags = [c.trigger, ...c.appearance].filter(Boolean).map((t) => ({ t, w: 1 }));
      // The trigger stays in tag output but not in drafted prose; {name} covers that.
      out.push({ type: "character", label: c.name, tags, prose: c.prose, ref: c.id, draftTags: c.appearance, extra: { name: c.name }, off: b.off });
      const outfit = b.outfit && c.outfits[b.outfit];
      if (outfit) out.push({ type: "outfit", label: b.outfit, tags: outfit.tags.map((t) => ({ t, w: 1 })), prose: outfit.prose, off: b.off });
    } else out.push(b);
  }
  return out;
}

const sentence = (s) => {
  const t = s.trim();
  if (!t) return "";
  const cap = t[0].toUpperCase() + t.slice(1);
  return /[.!?"]$/.test(cap) ? cap : cap + ".";
};

// File name without folders or extension, for comparing LoRAs across machines.
export const loraBase = (v) => String(v || "").split(/[\\/]/).pop().replace(/\.(safetensors|ckpt|pt|bin)$/i, "").toLowerCase();

// The prose a block would get from its tags, using the library's templates.
export function draftProse(block, db) {
  const templates = db && db.settings && db.settings.proseTemplates;
  return proseFromTags(block.type, block.draftTags || block.tags, templates, block.extra);
}

export function render(recipe, profile, db) {
  const blocks = resolveBlocks(recipe, db).filter((b) => !b.off);
  const tagList = [...profile.prefix.map((t) => ({ t, w: 1 })), ...blocks.flatMap((b) => b.tags.filter((x) => !x.off))];
  const tagStr = tagList.map((x) => fmtTag(x, profile.weights)).join(", ");
  const missingProse = blocks.filter((b) => !b.prose && b.tags.length).map((b) => b.label || b.type);
  // Blocks without prose get a drafted sentence, unless the profile turns that off.
  const auto = profile.autoProse !== false;
  const proseStr = blocks
    .map((b) => sentence(b.prose || (auto ? draftProse(b, db) : b.tags.filter((x) => !x.off).map((x) => x.t).join(", "))))
    .filter(Boolean)
    .join(" ");
  let positive;
  if (profile.format === "tags") positive = tagStr;
  else if (profile.format === "prose") positive = proseStr;
  else positive = tagStr + "\n\n" + proseStr;

  // A recipe's own negative replaces the profile default; Flux-style profiles have none.
  const negative = profile.negative === null ? null : (recipe.negative || "").trim() || profile.negative;
  return { positive, negative, tagList, missingProse: profile.format === "tags" ? [] : missingProse, drafted: auto };
}

// Rough CLIP estimate: words split on spaces and punctuation, each comma is a token.
export function estimateClipTokens(text) {
  const words = (text.match(/[A-Za-z0-9']+/g) || []).length;
  const punct = (text.match(/[,():.\\]/g) || []).length;
  return Math.round(words * 1.15 + punct);
}

const CONFLICTS = [
  ["short hair", "long hair"], ["day", "night"], ["indoors", "outdoors"], ["smile", "frown"],
  ["open mouth", "closed mouth"], ["from above", "from below"], ["sitting", "standing"]
];

export function lint(recipe, profile, db) {
  const { tagList, missingProse, drafted } = render(recipe, profile, db);
  const issues = [];
  const seen = new Map();
  for (const { t } of tagList) {
    const k = t.toLowerCase().trim();
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  for (const [k, n] of seen) if (n > 1) issues.push(`“${k}” appears ${n} times`);
  for (const [a, b] of CONFLICTS) if (seen.has(a) && seen.has(b)) issues.push(`“${a}” conflicts with “${b}”`);
  if (profile.weights) {
    for (const x of tagList) if (x.w > 1.5) issues.push(`“${x.t}” at ${x.w.toFixed(1)} may burn`);
  } else if (tagList.some((x) => Math.abs((x.w || 1) - 1) > 0.001)) {
    issues.push(`${profile.label} ignores weights`);
  }
  const installed = db && db.settings && db.settings.loraList && db.settings.loraList.names;
  if (installed && installed.length) {
    const have = new Set(installed.map(loraBase));
    for (const l of (recipe.settings && recipe.settings.loras) || []) if (!have.has(loraBase(l.name))) issues.push(`LoRA “${loraBase(l.name)}” isn't in ComfyUI's loras folder`);
  }
  for (const m of missingProse) issues.push(drafted ? `${m} prose is drafted from its tags` : `${m} has no prose, so tags are used as written`);
  return issues;
}

const A1111_SAMPLERS = {
  euler: "Euler", euler_ancestral: "Euler a", dpmpp_2m: "DPM++ 2M", dpmpp_2m_sde: "DPM++ 2M SDE",
  dpmpp_sde: "DPM++ SDE", dpmpp_3m_sde: "DPM++ 3M SDE", ddim: "DDIM", uni_pc: "UniPC", lcm: "LCM", heun: "Heun"
};

// Forge/A1111 "parameters" text: paste into the prompt box, then press the read-parameters arrow.
// `fx` post-processes the prompt text, e.g. expanding wildcards.
export function toA1111(recipe, profile, db, fx = (s) => s) {
  const out = render(recipe, profile, db);
  const positive = fx(out.positive, "pos"), negative = out.negative == null ? null : fx(out.negative, "neg");
  const s = recipe.settings || {};
  const loras = (s.loras || []).map((l) => `<lora:${l.name.replace(/\.safetensors$/, "")}:${l.w}>`).join(" ");
  const parts = [
    s.steps && `Steps: ${s.steps}`,
    s.sampler && `Sampler: ${A1111_SAMPLERS[s.sampler] || s.sampler}`,
    s.scheduler && `Schedule type: ${s.scheduler[0].toUpperCase() + s.scheduler.slice(1)}`,
    s.cfg != null && `CFG scale: ${s.cfg}`,
    s.seed != null && `Seed: ${s.seed}`,
    s.width && `Size: ${s.width}x${s.height}`,
    s.modelRef && s.modelRef.hash && `Model hash: ${s.modelRef.hash}`,
    s.model && `Model: ${s.model.replace(/\.safetensors$/, "")}`,
    (s.loras || []).some((l) => l.hash) && `Lora hashes: "${s.loras.filter((l) => l.hash).map((l) => `${l.name.replace(/\.safetensors$/, "")}: ${l.hash}`).join(", ")}"`
  ].filter(Boolean);
  return [positive + (loras ? " " + loras : ""), negative ? `Negative prompt: ${negative}` : "", parts.join(", ")]
    .filter(Boolean)
    .join("\n");
}

// Heuristic used when importing raw text: short comma-separated chunks read as tags.
export function looksLikeTags(text) {
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return false;
  const avgWords = parts.reduce((n, p) => n + p.split(/\s+/).length, 0) / parts.length;
  return avgWords <= 3.5;
}

// Splits a prompt into tags. Commas inside brackets don't split, and a weighted
// group like "(worst quality, low quality:1.4)" gives each tag inside its weight.
export function parseTags(text) {
  const parts = [];
  let depth = 0, cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && (text[i + 1] === "(" || text[i + 1] === ")")) { cur += ch + text[++i]; continue; }
    if (ch === "(" || ch === "{") depth++;
    if ((ch === ")" || ch === "}") && depth > 0) depth--;
    if ((ch === "," || ch === "\n") && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  const out = [];
  for (const raw of parts.map((x) => x.trim()).filter(Boolean)) {
    const m = raw.match(/^\(([\s\S]+):([\d.]+)\)$/);
    const group = m ? m[1] : /^\(([^():]+)\)$/.test(raw) ? raw.slice(1, -1) : null;
    const w = m ? Number(m[2]) : group ? 1.1 : 1;
    // {a|b} wildcards stay whole even when they contain commas.
    const inner = group && !/^\{/.test(group) ? group.split(",") : [m ? m[1] : raw];
    for (const piece of inner.map((x) => x.trim()).filter(Boolean)) {
      const base = piece.replace(/\\([()])/g, "$1");
      // __wildcard__ names keep their underscores.
      const t = /__[\w-]+__/.test(base) ? base : base.replace(/_/g, " ");
      out.push({ t, w });
    }
  }
  return out;
}
