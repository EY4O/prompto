// Imports from other prompt tools. Each reader turns a file into plain
// { recipes: [...], snippets: [...] } drafts; the side panel adds ids and
// numbers, and skips what's already in the library.
//
//   FranckyB ComfyUI-Prompt-Manager   prompt_manager_data.json or its export
//   ComfyAssets ComfyUI_PromptManager JSON export ({prompts: [...]}) or CSV
//   A1111 / Forge styles.csv          name, prompt, negative_prompt
//   a1111 tag-autocomplete chants     [{name, terms, content}]
import { looksLikeTags, parseTags } from "./render.js";

// ---------- CSV ----------
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

// ---------- shared shaping ----------
// Titles: the first few tags of a tag prompt, or the first phrase of prose.
const firstWords = (text, n = 40) => {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const title = looksLikeTags(t) ? parseTags(t).slice(0, 3).map((x) => x.t).join(", ") : t.split(/[,.\n]/)[0].trim();
  return title.slice(0, n) || "Imported";
};
// Other tools' snippets are often just two or three tags.
const shortTags = (t) => { const parts = t.split(",").map((x) => x.trim()).filter(Boolean); return parts.length >= 2 && parts.every((x) => x.split(/\s+/).length <= 4); };

function snippetFrom(name, cat, text) {
  const clean = String(text || "").replace(/\{prompt\}\s*,?/gi, "").trim();
  if (!clean) return null;
  const tags = looksLikeTags(clean) || shortTags(clean);
  return { cat, name: String(name || firstWords(clean, 32)).trim(), tags: tags ? parseTags(clean).map((x) => x.t) : [], prose: tags ? "" : clean };
}

function recipeFrom({ title, positive, negative = "", settings = {}, fav = false, image = null, extraTags = [], source }) {
  const tags = looksLikeTags(positive);
  const tagList = tags ? parseTags(positive) : [];
  for (const t of extraTags) if (t && !tagList.some((x) => x.t === t)) tagList.push({ t, w: 1 });
  return {
    title: String(title || firstWords(positive)).slice(0, 60),
    blocks: [{ type: "subject", tags: tagList, prose: tags ? "" : String(positive || "").trim() }],
    negative: String(negative || "").trim(), settings, fav, image, source, positive
  };
}

// ---------- detection ----------
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const HIDDEN = new Set(["__meta__", "_base_prompt_", "_prompt_prefix_"]);

export function detect(name, text) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".csv")) {
    const rows = parseCsv(text);
    if (!rows.length) return null;
    const cols = Object.keys(rows[0]);
    if (cols.includes("prompt") && cols.includes("name")) return { format: "A1111 styles", rows };
    if (cols.includes("text") && (cols.includes("rating") || cols.includes("category"))) return { format: "PromptManager (ComfyAssets)", rows };
    return null;
  }
  let json;
  try { json = JSON.parse(text); } catch { return null; }
  if (json && json.app === "prompto") return { format: "prompto" };
  const list = Array.isArray(json) ? json : isObj(json) && Array.isArray(json.prompts) ? json.prompts : null;
  if (list && list.length && list.every((p) => isObj(p) && typeof p.text === "string")) return { format: "PromptManager (ComfyAssets)", rows: list };
  if (Array.isArray(json) && json.length && json.every((c) => isObj(c) && typeof c.content === "string" && c.name)) return { format: "Tag-complete chants", rows: json };
  if (isObj(json)) {
    const cats = Object.entries(json).filter(([k, v]) => !HIDDEN.has(k) && isObj(v));
    const looksFrancky = cats.length && cats.every(([, v]) => Object.entries(v).every(([k, p]) => HIDDEN.has(k) || typeof p === "string" || (isObj(p) && ("prompt" in p || "workflow_data" in p))));
    if (looksFrancky) return { format: "Prompt Manager (FranckyB)", data: json };
  }
  return null;
}

// ---------- converters ----------
function fromStyles(rows) {
  const snippets = [];
  for (const r of rows) {
    const s = snippetFrom(r.name, "A1111 styles", r.prompt);
    if (s) snippets.push(s);
    const n = snippetFrom(`${r.name} (negative)`, "Negative", r.negative_prompt);
    if (n) snippets.push(n);
  }
  return { recipes: [], snippets };
}

function fromChants(rows) {
  return { recipes: [], snippets: rows.map((c) => snippetFrom(c.name, "Chants", c.content)).filter(Boolean) };
}

// ComfyAssets has no negatives or settings; a rating of 4+ becomes a star.
function fromComfyAssets(rows) {
  const recipes = rows.filter((p) => String(p.text || "").trim()).map((p) => recipeFrom({
    positive: p.text, fav: Number(p.rating) >= 4, source: "PromptManager",
    title: firstWords(p.text)
  }));
  return { recipes, snippets: [] };
}

function francky(data) {
  const recipes = [], snippets = [];
  for (const [cat, prompts] of Object.entries(data)) {
    if (HIDDEN.has(cat) || !isObj(prompts)) continue;
    for (const [name, raw] of Object.entries(prompts)) {
      if (HIDDEN.has(name)) continue;
      const p = typeof raw === "string" ? { prompt: raw } : raw;
      const loras = ["loras_a", "loras_b", "loras_c", "loras_d"].flatMap((k) => p[k] || [])
        .filter((l) => l && l.name && l.active !== false)
        .map((l) => ({ name: l.path || l.name, w: Number(l.strength ?? l.model_strength ?? 1) }));
      const triggers = (p.trigger_words || []).filter((t) => t && t.active !== false).map((t) => t.text).filter(Boolean);
      const m = p.workflow_data && p.workflow_data.models && (p.workflow_data.models.model_a || Object.values(p.workflow_data.models)[0]);
      if (m || loras.length) {
        const s = (m && m.sampler) || {}, res = (m && m.resolution) || {};
        const recipeLoras = m && Array.isArray(m.loras) && m.loras.length
          ? m.loras.map((l) => ({ name: l.path || l.name, w: Number(l.model_strength ?? l.strength ?? 1) })).filter((l) => l.name)
          : loras;
        recipes.push(recipeFrom({
          title: name, source: "Prompt Manager", image: p.thumbnail || null, extraTags: triggers,
          positive: (m && m.positive_prompt) || p.prompt || "",
          negative: (m && m.negative_prompt) || p.negative_prompt || "",
          settings: {
            model: (m && m.model) || "", loras: recipeLoras,
            sampler: s.sampler_name || "", scheduler: s.scheduler || "",
            steps: s.steps, cfg: s.cfg, seed: s.seed, width: res.width, height: res.height
          }
        }));
      } else {
        const sn = snippetFrom(name, cat, [p.prompt, ...triggers].filter(Boolean).join(", "));
        if (sn) snippets.push(sn);
      }
    }
  }
  return { recipes, snippets };
}

export function convert(found) {
  switch (found.format) {
    case "A1111 styles": return fromStyles(found.rows);
    case "Tag-complete chants": return fromChants(found.rows);
    case "PromptManager (ComfyAssets)": return fromComfyAssets(found.rows);
    case "Prompt Manager (FranckyB)": return francky(found.data);
    default: return { recipes: [], snippets: [] };
  }
}
