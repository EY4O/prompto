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
      out.push({ type: "character", label: c.name, tags, prose: c.prose, ref: c.id });
      const outfit = b.outfit && c.outfits[b.outfit];
      if (outfit) out.push({ type: "outfit", label: b.outfit, tags: outfit.tags.map((t) => ({ t, w: 1 })), prose: outfit.prose });
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

export function render(recipe, profile, db) {
  const blocks = resolveBlocks(recipe, db).filter((b) => !b.off);
  const tagList = [...profile.prefix.map((t) => ({ t, w: 1 })), ...blocks.flatMap((b) => b.tags.filter((x) => !x.off))];
  const tagStr = tagList.map((x) => fmtTag(x, profile.weights)).join(", ");
  const missingProse = blocks.filter((b) => !b.prose && b.tags.length).map((b) => b.label || b.type);
  const proseStr = blocks
    .map((b) => sentence(b.prose || b.tags.filter((x) => !x.off).map((x) => x.t).join(", ")))
    .filter(Boolean)
    .join(" ");
  let positive;
  if (profile.format === "tags") positive = tagStr;
  else if (profile.format === "prose") positive = proseStr;
  else positive = tagStr + "\n\n" + proseStr;

  // A recipe's own negative replaces the profile default; Flux-style profiles have none.
  const negative = profile.negative === null ? null : (recipe.negative || "").trim() || profile.negative;
  return { positive, negative, tagList, missingProse: profile.format === "tags" ? [] : missingProse };
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
  const { tagList, missingProse } = render(recipe, profile, db);
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
  for (const m of missingProse) issues.push(`${m} has no prose, so tags are used as written`);
  return issues;
}

const A1111_SAMPLERS = {
  euler: "Euler", euler_ancestral: "Euler a", dpmpp_2m: "DPM++ 2M", dpmpp_2m_sde: "DPM++ 2M SDE",
  dpmpp_sde: "DPM++ SDE", dpmpp_3m_sde: "DPM++ 3M SDE", ddim: "DDIM", uni_pc: "UniPC", lcm: "LCM", heun: "Heun"
};

// Forge/A1111 "parameters" text: paste into the prompt box, then press the read-parameters arrow.
export function toA1111(recipe, profile, db) {
  const { positive, negative } = render(recipe, profile, db);
  const s = recipe.settings || {};
  const loras = (s.loras || []).map((l) => `<lora:${l.name.replace(/\.safetensors$/, "")}:${l.w}>`).join(" ");
  const parts = [
    s.steps && `Steps: ${s.steps}`,
    s.sampler && `Sampler: ${A1111_SAMPLERS[s.sampler] || s.sampler}`,
    s.scheduler && `Schedule type: ${s.scheduler[0].toUpperCase() + s.scheduler.slice(1)}`,
    s.cfg != null && `CFG scale: ${s.cfg}`,
    s.seed != null && `Seed: ${s.seed}`,
    s.width && `Size: ${s.width}x${s.height}`,
    s.model && `Model: ${s.model.replace(/\.safetensors$/, "")}`
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

export function parseTags(text) {
  return text
    .split(/,|\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => {
      const m = raw.match(/^\((.+):([\d.]+)\)$/);
      const t = (m ? m[1] : raw).replace(/\\([()])/g, "$1").replace(/_/g, " ");
      return { t, w: m ? Number(m[2]) : 1 };
    });
}
