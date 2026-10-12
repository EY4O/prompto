// Tag dictionary behind autocomplete. Three sources, merged at query time:
//  1. an imported tag CSV (the a1111 tag-autocomplete format: name,category,count,"aliases"),
//     kept in IndexedDB because it runs to a few MB
//  2. tags already used in the library, so it works with no setup
//  3. optional live lookups against Danbooru's public tag API

export const CATEGORIES = { "-1": "yours", 0: "general", 1: "artist", 3: "copyright", 4: "character", 5: "meta" };

// ---------- IndexedDB ----------
function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("prompto-tags", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("lists");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const idb = await open();
  return new Promise((resolve, reject) => {
    const t = idb.transaction("lists", mode);
    const req = fn(t.objectStore("lists"));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  });
}

// ---------- CSV ----------
function splitCsvLine(line) {
  const cells = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

// Booru names use underscores; prompts use spaces. Emoticons like ^_^ keep theirs.
const KEEP_UNDERSCORE = new Set(["o_o", "0_0", "x_x", "u_u", "t_t", "@_@", "=_=", "._.", ";_;", "^_^", ">_<", "-_-"]);
export const displayName = (n) => (KEEP_UNDERSCORE.has(n) || !/[a-z0-9]/i.test(n) ? n : n.replace(/_/g, " "));
const norm = (s) => s.toLowerCase().replace(/_/g, " ").trim();

export function parseTagCsv(text) {
  const names = [], cats = [], counts = [], aliases = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name, cat, count, alias] = splitCsvLine(line);
    if (!name || (name === "name" && isNaN(Number(count)))) continue;
    names.push(displayName(name.trim()));
    cats.push(Number(cat) || 0);
    counts.push(Number(count) || 0);
    aliases.push((alias || "").split(",").map((a) => displayName(a.trim())).filter(Boolean).join(","));
  }
  return { names, cats, counts, aliases };
}

// ---------- Local list ----------
let list = null;
function prepare(l) {
  l.norm = l.names.map(norm);
  l.aliasNorm = l.aliases.map((a) => (a ? "," + norm(a).replace(/\s*,\s*/g, ",") : ""));
  return l;
}

export async function loadTagList() {
  try {
    const l = await tx("readonly", (s) => s.get("main"));
    list = l ? prepare(l) : null;
  } catch { list = null; }
  return tagListInfo();
}
export async function importTagCsv(file) {
  const parsed = parseTagCsv(await file.text());
  if (!parsed.names.length) throw new Error("No tags found in that file");
  const record = { ...parsed, source: file.name, loadedAt: Date.now() };
  await tx("readwrite", (s) => s.put(record, "main"));
  list = prepare(record);
  return tagListInfo();
}
export async function clearTagList() {
  await tx("readwrite", (s) => s.delete("main"));
  list = null;
}
export const tagListInfo = () => (list ? { count: list.names.length, source: list.source, loadedAt: list.loadedAt } : null);

export function searchLocal(q, limit = 8) {
  if (!list) return [];
  const nq = norm(q);
  if (!nq) return [];
  const hits = [];
  for (let i = 0; i < list.norm.length; i++) {
    const n = list.norm[i];
    let score = 0, via = "";
    if (n.startsWith(nq)) score = 3;
    else if (n.includes(" " + nq)) score = 2;
    else if (list.aliasNorm[i] && list.aliasNorm[i].includes("," + nq)) {
      score = 1;
      via = list.aliases[i].split(",").find((a) => norm(a).startsWith(nq)) || "";
    }
    if (score) hits.push({ i, score, via });
  }
  hits.sort((a, b) => b.score - a.score || list.counts[b.i] - list.counts[a.i]);
  return hits.slice(0, limit).map(({ i, via }) => ({ name: list.names[i], cat: list.cats[i], count: list.counts[i], alias: via, source: "list" }));
}

// ---------- Your own tags ----------
export function libraryTags(db) {
  const counts = new Map();
  const add = (t) => { if (t) counts.set(t, (counts.get(t) || 0) + 1); };
  for (const r of db.recipes) for (const b of r.blocks) (b.tags || []).forEach((x) => add(x.t));
  for (const c of db.characters) {
    c.appearance.forEach(add);
    Object.values(c.outfits).forEach((o) => o.tags.forEach(add));
  }
  for (const s of db.snippets) s.tags.forEach(add);
  for (const p of Object.values(db.profiles)) p.prefix.forEach(add);
  return [...counts].map(([name, uses]) => ({ name, norm: norm(name), uses }));
}
export function searchLibrary(index, q, limit = 4) {
  const nq = norm(q);
  if (!nq) return [];
  // Whole-tag prefix matches first; word matches only once the query is specific enough.
  const rank = (t) => (t.norm.startsWith(nq) ? 2 : nq.length >= 3 && t.norm.includes(" " + nq) ? 1 : 0);
  return index
    .map((t) => ({ ...t, r: rank(t) }))
    .filter((t) => t.r)
    .sort((a, b) => b.r - a.r || b.uses - a.uses)
    .slice(0, limit)
    .map((t) => ({ name: t.name, cat: -1, count: t.uses, source: "yours" }));
}

// ---------- Danbooru ----------
const cache = new Map();
export async function searchDanbooru(q, signal) {
  const key = norm(q).replace(/ /g, "_");
  if (key.length < 2) return [];
  if (cache.has(key)) return cache.get(key);
  const url = "https://danbooru.donmai.us/tags.json?limit=8&search[order]=count&search[hide_empty]=true"
    + "&only=name,post_count,category&search[name_matches]=" + encodeURIComponent(key) + "*";
  const res = await fetch(url, { signal, credentials: "omit" });
  if (!res.ok) throw new Error("Danbooru " + res.status);
  const rows = (await res.json()).map((r) => ({ name: displayName(r.name), cat: r.category, count: r.post_count, source: "danbooru" }));
  cache.set(key, rows);
  return rows;
}

export function formatCount(n, source) {
  if (source === "yours") return n === 1 ? "used once" : `used ${n}×`;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k";
  return String(n);
}
