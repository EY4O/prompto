// Snippets: naming new ones, spotting duplicates, renaming and removing.
import { slug } from "./wildcards.js";

// The wildcard a snippet answers to: "Golden hour" is __golden_hour__.
export const wildcardToken = (name) => (slug(name) ? `__${slug(name)}__` : "");

const tagKey = (tags) => [...new Set((tags || []).map((t) => String(t).toLowerCase().replace(/_/g, " ").trim()).filter(Boolean))].sort().join("|");

// An existing snippet with the same tags (in any order), or the same prose when there are no tags.
export function findDuplicate(snippets, { tags = [], prose = "" }) {
  const key = tagKey(tags);
  if (key) return snippets.find((s) => tagKey(s.tags) === key) || null;
  const p = String(prose || "").trim().toLowerCase();
  return p ? snippets.find((s) => !tagKey(s.tags) && String(s.prose || "").trim().toLowerCase() === p) || null : null;
}

// Gives a name that no other snippet in the category uses: "Safebooru #12", "Safebooru #12 (2)".
export function uniqueName(snippets, name, cat, exceptId = null) {
  const taken = new Set(snippets.filter((s) => s.cat === cat && s.id !== exceptId).map((s) => s.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name} (${n})`.toLowerCase())) return `${name} (${n})`;
}

// Recipes whose tags or prose use a snippet's wildcard.
export function recipesUsing(db, name) {
  const token = wildcardToken(name);
  if (!token) return [];
  return db.recipes.filter((r) => r.blocks.some((b) => (b.prose || "").includes(token) || (b.tags || []).some((t) => (t.t || t || "").includes(token))));
}

// Renames a snippet and rewrites its wildcard in the recipes that used it.
export function renameSnippet(db, id, name) {
  const s = db.snippets.find((x) => x.id === id);
  if (!s || !name.trim()) return [];
  const from = wildcardToken(s.name), to = wildcardToken(name);
  const used = from && to && from !== to ? recipesUsing(db, s.name) : [];
  for (const r of used) {
    for (const b of r.blocks) {
      if (b.prose) b.prose = b.prose.split(from).join(to);
      for (const t of b.tags || []) if (t.t) t.t = t.t.split(from).join(to);
    }
  }
  s.name = name;
  return used;
}

export function removeSnippet(db, id) {
  const s = db.snippets.find((x) => x.id === id);
  if (!s) return null;
  db.snippets = db.snippets.filter((x) => x.id !== id);
  return s;
}
