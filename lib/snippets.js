// Snippets: naming new ones, guessing a category, spotting and merging
// duplicates, renaming snippets and categories, removing.
import { slug } from "./wildcards.js";

// The wildcard a snippet answers to: "Golden hour" is __golden_hour__.
export const wildcardToken = (name) => (slug(name) ? `__${slug(name)}__` : "");

const norm = (t) => String(t || "").toLowerCase().replace(/_/g, " ").trim();
const tagKey = (tags) => [...new Set((tags || []).map(norm).filter(Boolean))].sort().join("|");
const proseKey = (s) => (tagKey(s.tags) ? "" : String(s.prose || "").trim().toLowerCase());

// An existing snippet with the same tags (in any order), or the same prose when there are no tags.
export function findDuplicate(snippets, { tags = [], prose = "" }) {
  const key = tagKey(tags);
  if (key) return snippets.find((s) => tagKey(s.tags) === key) || null;
  const p = String(prose || "").trim().toLowerCase();
  return p ? snippets.find((s) => proseKey(s) === p) || null : null;
}

// Groups of two or more snippets with the same tags (or the same prose).
export function duplicateGroups(snippets) {
  const groups = new Map();
  for (const s of snippets) {
    const key = tagKey(s.tags) ? "t:" + tagKey(s.tags) : proseKey(s) ? "p:" + proseKey(s) : "";
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

// Gives a name that no other snippet in the category uses: "Safebooru #12", "Safebooru #12 (2)".
export function uniqueName(snippets, name, cat, exceptId = null) {
  const taken = new Set(snippets.filter((s) => s.cat === cat && s.id !== exceptId).map((s) => s.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name} (${n})`.toLowerCase())) return `${name} (${n})`;
}

// A first guess at where pasted tags belong. Most tags of one kind wins; otherwise null.
const KINDS = {
  Negative: /\b(worst|low|bad|normal) quality\b|\blowres\b|\bbad (anatomy|hands|proportions)\b|\bjpeg artifacts\b|\bwatermark\b|\bsignature\b|\bextra (digits?|fingers|limbs)\b|\bblurry\b|\bdeformed\b|\btext\b/,
  Lighting: /light(ing|s)?\b|\bshadows?\b|\blens flare\b|\bglow(ing)?\b|\bgolden hour\b|\bsilhouette\b|\bbloom\b|\bgodrays?\b|\bsun ?rays?\b|\billuminat/,
  Camera: /\bfrom (above|below|side|behind|front)\b|\bclose-?up\b|\b(upper|lower|full) body\b|\bcowboy shot\b|\bportrait\b|\b(wide|long|medium) shot\b|\bdutch angle\b|\bpov\b|\bfisheye\b|\bdepth of field\b|\bbokeh\b|\b(low|high) angle\b|\bpanorama\b|\bfocus\b/,
  Style: /\(style\)|\(medium\)|\bfilm grain\b|\bchromatic aberration\b|\bfaded colors\b|\bwatercolor\b|\bsketch\b|\bpainterly\b|\b(oil|acrylic) paint/i
};
const STYLE_MORE = /\bcel shading\b|\bmonochrome\b|\bgreyscale\b|\blineart\b|\bflat colou?r\b|\bretro\b|\bvintage\b|\banime (screencap|coloring)\b|\btraditional media\b|\bpixel art\b|\b(19|20)\d0s\b|\bvaporwave\b|\bukiyo-?e\b|\bimpasto\b/;

export function guessCategory(tags) {
  const list = (tags || []).map(norm).filter(Boolean);
  if (!list.length) return null;
  const score = {};
  for (const t of list) {
    for (const [cat, re] of Object.entries(KINDS)) if (re.test(t) || (cat === "Style" && STYLE_MORE.test(t))) score[cat] = (score[cat] || 0) + 1;
  }
  const [best, n = 0] = Object.entries(score).sort((a, b) => b[1] - a[1])[0] || [];
  return best && n * 2 >= list.length ? best : null;
}

// Recipes whose tags or prose mention a wildcard token.
function recipesWith(db, token) {
  if (!token) return [];
  return db.recipes.filter((r) => r.blocks.some((b) => (b.prose || "").includes(token) || (b.tags || []).some((t) => (t.t || t || "").includes(token))));
}
export const recipesUsing = (db, name) => recipesWith(db, wildcardToken(name));

// Rewrites one wildcard as another in every recipe; returns the recipes changed.
function rewriteToken(db, from, to) {
  if (!from || !to || from === to) return [];
  const used = recipesWith(db, from);
  for (const r of used) {
    for (const b of r.blocks) {
      if (b.prose) b.prose = b.prose.split(from).join(to);
      for (const t of b.tags || []) if (t.t) t.t = t.t.split(from).join(to);
    }
  }
  return used;
}

// Renames a snippet and rewrites its wildcard in the recipes that used it.
export function renameSnippet(db, id, name) {
  const s = db.snippets.find((x) => x.id === id);
  if (!s || !name.trim()) return [];
  const used = rewriteToken(db, wildcardToken(s.name), wildcardToken(name));
  s.name = name;
  return used;
}

// Moves every snippet in a category to another name. __category__ wildcards follow,
// unless a snippet has that name (a snippet's own name wins over its category).
export function renameCategory(db, from, to) {
  to = String(to || "").trim();
  if (!to || to === from) return { moved: 0, recipes: [] };
  let moved = 0;
  for (const s of db.snippets) if (s.cat === from) { s.cat = to; moved++; }
  const shadowed = db.snippets.some((s) => slug(s.name) === slug(from));
  return { moved, recipes: shadowed ? [] : rewriteToken(db, wildcardToken(from), wildcardToken(to)) };
}

// Keeps one snippet of a duplicate group: the others go, their wildcards point at
// the kept one, and their prose fills in if the kept one has none.
export function mergeSnippets(db, keepId, dropIds) {
  const keep = db.snippets.find((s) => s.id === keepId);
  if (!keep) return { removed: 0, recipes: [] };
  const drop = db.snippets.filter((s) => dropIds.includes(s.id) && s.id !== keepId);
  const recipes = new Set();
  for (const d of drop) {
    if (!keep.prose && d.prose) keep.prose = d.prose;
    if (!keep.image && d.image) { keep.image = d.image; if (d.source) keep.source = d.source; }
    for (const r of rewriteToken(db, wildcardToken(d.name), wildcardToken(keep.name))) recipes.add(r);
  }
  const gone = new Set(drop.map((d) => d.id));
  db.snippets = db.snippets.filter((s) => !gone.has(s.id));
  return { removed: drop.length, recipes: [...recipes] };
}

export function removeSnippet(db, id) {
  const s = db.snippets.find((x) => x.id === id);
  if (!s) return null;
  db.snippets = db.snippets.filter((x) => x.id !== id);
  return s;
}

// Orders snippets the same way as the cast: "added", "az" or "used" (recipes using the wildcard).
export function sortSnippets(list, db, mode = "added") {
  const out = [...list];
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  if (mode === "az") out.sort(byName);
  else if (mode === "used") {
    const n = new Map(out.map((s) => [s.id, recipesUsing(db, s.name).length]));
    out.sort((a, b) => n.get(b.id) - n.get(a.id) || byName(a, b));
  }
  return out;
}

// Snippets as wildcard files for Impact Pack's wildcard processor and Forge's
// Dynamic Prompts: __name__ reads name.txt, one entry per line. Mirrors Prompto's
// own lookup: a snippet's file holds one tag per line, a category's file one
// snippet per line, and a snippet name wins over a category with the same name.
export function wildcardFiles(snippets) {
  const files = new Map();
  const entry = (x) => ((x.tags || []).length ? x.tags.join(", ") : x.prose || "");
  for (const x of snippets) {
    const n = slug(x.name);
    if (!n || files.has(n)) continue;
    const lines = (x.tags || []).length ? x.tags : x.prose ? [x.prose] : [];
    if (lines.length) files.set(n, lines);
  }
  const cats = new Map();
  for (const x of snippets) {
    const c = slug(x.cat);
    if (!c || files.has(c)) continue;
    if (!cats.has(c)) cats.set(c, []);
    const e = entry(x);
    if (e) cats.get(c).push(e);
  }
  for (const [c, lines] of cats) if (lines.length) files.set(c, lines);
  return [...files].map(([name, lines]) => ({ name: name + ".txt", text: lines.map((l) => l.replace(/\r?\n/g, " ")).join("\n") + "\n" }));
}
