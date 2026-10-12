import { DEFAULT_PROFILES, STOCKS, huesOf, BLOCK_TYPES, render, estimateClipTokens, lint, toA1111, looksLikeTags, parseTags } from "./lib/render.js";
import { readRecipeFromFile, parseComfy } from "./lib/pngmeta.js";
import { SEED } from "./lib/seed.js";
import { loadTagList, importTagCsv, clearTagList, tagListInfo, searchLocal, libraryTags, searchLibrary, searchDanbooru } from "./lib/tags.js";
import { attachAutocomplete } from "./lib/autocomplete.js";
import { fetchLook, draftCharacter, postFromGroups, sceneTags } from "./lib/booru.js";
import { DEFAULT_COMFY, normalizeBase, originPattern, ping, findTab, queueGraph, applyInTab, bridgeCall } from "./lib/comfy.js";

const hasChrome = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");

// ---------- Storage ----------
// The extension keeps everything in chrome.storage.local. Opened as a plain
// page (for quick previews), it falls back to localStorage.
const store = {
  async load() {
    if (hasChrome) return (await chrome.storage.local.get("db")).db;
    try { return JSON.parse(localStorage.getItem("prompto-db")); } catch { return null; }
  },
  async save(data) {
    if (hasChrome) return chrome.storage.local.set({ db: data });
    try { localStorage.setItem("prompto-db", JSON.stringify(data)); } catch {}
  }
};

let db;
const ui = {
  tab: "inbox", recipeId: null, openChar: null, openProfile: null, q: "", filter: "all",
  importId: null, sheet: null,
  comfyLive: false, comfyTab: null, bridge: null, syncedRev: -1, focus: null, pendingImport: null, rev: 0
};
let saveTimer;
const persist = () => { ui.rev++; clearTimeout(saveTimer); saveTimer = setTimeout(() => store.save(db), 250); };

// Brings any saved library (or an imported file) up to the current shape.
function migrate(d) {
  for (const k of ["inbox", "recipes", "characters", "snippets"]) if (!Array.isArray(d[k])) d[k] = [];
  if (!d.profiles || !Object.keys(d.profiles).length) d.profiles = structuredClone(DEFAULT_PROFILES);
  d.settings = { comfyUrl: DEFAULT_COMFY, onlineTags: true, ...(d.settings || {}) };
  for (const c of d.characters) { c.appearance = c.appearance || []; c.outfits = c.outfits || {}; }
  d.nextNo = Math.max(d.nextNo || 1, ...d.recipes.map((r) => (r.no || 0) + 1));
  d.version = 2;
  return d;
}

// ---------- Helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const uid = (p) => p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pad = (n, l = 3) => String(n).padStart(l, "0");
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const profileOf = (r) => db.profiles[r.profile] || Object.values(db.profiles)[0];
const FORMAT_LABEL = { tags: "Tags", hybrid: "Tags + prose", prose: "Prose" };
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let s = seed || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
}
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "now";
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  return h < 24 ? h + "h ago" : Math.round(h / 24) + "d ago";
}
function barcode(id, w = 72) {
  const r = rng(hash(id));
  let x = 0, bars = "";
  while (x < w) {
    const bw = r() > 0.6 ? 2 : 1;
    bars += `<rect x="${x}" width="${bw}" height="22"/>`;
    x += bw + 1 + Math.floor(r() * 3);
  }
  return `<svg class="barcode" viewBox="0 0 ${w} 22" width="${w}" height="22" fill="currentColor" aria-hidden="true">${bars}</svg>`;
}
function orbs(id) {
  const r = rng(hash(id));
  const kinds = ["", "gold", "pearl", "gold soft", "ink", ""];
  let out = "";
  for (let i = 0; i < 3; i++) {
    const s = 18 + r() * 26;
    out += `<span class="orb ${kinds[Math.floor(r() * kinds.length)]}" style="--s:${s.toFixed(0)}%;--x:${(r() * (100 - s)).toFixed(0)}%;--y:${(r() * 40).toFixed(0)}%;--dx:${(r() * 12 - 6).toFixed(0)}px;--dy:${(r() * 10 - 5).toFixed(0)}px"></span>`;
  }
  return out;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
}
async function copy(text, label = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch { toast("Couldn't reach the clipboard"); }
}
// Two-step confirm for destructive buttons; side panels don't reliably support confirm().
function armed(el, prompt = "Press again to confirm") {
  if (el.dataset.armed === "1") return true;
  const label = el.textContent;
  el.dataset.armed = "1"; el.textContent = prompt;
  setTimeout(() => { el.dataset.armed = ""; el.textContent = label; }, 3000);
  return false;
}
const matches = (q, ...fields) => !q || fields.join(" ").toLowerCase().includes(q.toLowerCase());
const recipeById = (id) => db.recipes.find((r) => r.id === id);
const charById = (id) => db.characters.find((c) => c.id === id);

// ---------- Theme ----------
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
try { applyTheme(localStorage.getItem("prompto-theme")); } catch {}
$("#theme-btn").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem("prompto-theme", next); } catch {}
});

// ---------- Routing ----------
const TABS = ["inbox", "recipes", "characters", "snippets", "settings"];
function route() {
  const [tab, id] = location.hash.replace(/^#/, "").split("/");
  ui.recipeId = null; ui.importId = null;
  if (tab === "recipe" && id && recipeById(id)) { ui.tab = "recipes"; ui.recipeId = id; }
  else if (tab === "import" && id && db.inbox.some((i) => i.id === id && i.kind === "booru")) { ui.tab = "inbox"; ui.importId = id; }
  else if (tab === "cast") { ui.tab = "characters"; ui.openChar = id || ui.openChar; }
  else if (TABS.includes(tab)) ui.tab = tab;
  draw();
  if (tab === "cast" && id) requestAnimationFrame(() => $("#c-" + id)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  else window.scrollTo(0, 0);
}
const go = (hash) => { if (location.hash === "#" + hash) route(); else location.hash = hash; };

function draw() {
  document.querySelectorAll("#tabs button").forEach((b) => {
    if (b.dataset.tab === ui.tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  $("#settings-btn").setAttribute("aria-pressed", String(ui.tab === "settings"));
  $("#count-inbox").textContent = db.inbox.length || "";
  $(".search").hidden = !!ui.recipeId || !!ui.importId || ui.tab === "settings";
  if (ui.recipeId) drawRecipe();
  else if (ui.importId) drawImport();
  else ({ inbox: drawInbox, recipes: drawRecipes, characters: drawCast, snippets: drawSnippets, settings: drawSettings })[ui.tab]();
  if (ui.focus) { $(ui.focus)?.focus(); ui.focus = null; }
}

// ---------- Inbox ----------
const KIND_LABEL = { booru: "Booru", image: "Image" };
function slip(item) {
  let label = KIND_LABEL[item.kind] || "Note";
  let body = "", files = [];
  if (item.kind === "text") {
    if (looksLikeTags(item.text)) label = "Tags";
    body = `<p class="slip-text">${esc(item.text)}</p>`;
    files = [["recipe", "Recipe"], ["snippet", "Snippet"]];
  } else if (item.kind === "booru") {
    const post = postOf(item);
    const chipList = (arr, n = 99) => arr.slice(0, n).map((t) => `<span class="chip ro">${esc(t)}</span>`).join("") + (arr.length > n ? `<span class="chip ro">+${arr.length - n}</span>` : "");
    body = (post.preview ? `<img class="slip-thumb" src="${esc(post.preview)}" alt="">` : "")
      + [["characters", "Character"], ["copyrights", "Series"], ["general", "General"]]
        .filter(([k]) => post[k].length)
        .map(([k, l]) => `<div class="group-label">${l}</div><div class="chips">${chipList(post[k], 10)}</div>`).join("");
    files = post.characters.length ? [["import", "Cast…"], ["snippet", "Snippet"]] : [["snippet", "Snippet"]];
  } else if (item.kind === "png") {
    label = "PNG · " + item.format;
    const s = item.meta.settings;
    body = `${item.thumb ? `<img class="slip-thumb" src="${esc(item.thumb)}" alt="">` : ""}
      <p class="slip-text">${esc(item.meta.positive || "(no prompt text found)")}</p>
      <p class="kv" style="margin-top:6px">${esc([s.model, s.sampler, s.steps && s.steps + " steps", s.seed != null && "seed " + s.seed].filter(Boolean).join(" · "))}</p>`;
    files = [["recipe", "Recipe"]];
  } else if (item.kind === "image") {
    body = `<img class="slip-thumb" src="${esc(item.image)}" alt="">${item.note ? `<p class="hint" style="margin-top:6px">${esc(item.note)}</p>` : ""}`;
    files = [["recipe", "Recipe"]];
  }
  return `<article class="tk wide">
    <div class="tk-bg"></div>
    <div class="tk-main">
      <div class="row"><span class="tag">${esc(label)}</span><span class="slip-src">${esc(item.source || item.title || "")}</span></div>
      ${body}
      <div class="slip-actions"><span class="lbl">File as</span>
        ${files.map(([k, l]) => `<button class="fchip" data-act="file" data-as="${k}" data-id="${item.id}">${l}</button>`).join("")}
        <button class="link" style="margin-left:auto" data-act="discard" data-id="${item.id}">Discard</button>
      </div>
    </div>
    <div class="tk-tear-v"></div>
    <div class="tk-stub-v">
      <div>${ago(item.createdAt)}<br><b>No. ${esc(item.id.slice(-4))}</b></div>
      <div class="barcode-wrap">${barcode(item.id, 60)}</div>
    </div>
  </article>`;
}

function drawInbox() {
  const items = db.inbox.filter((i) => matches(ui.q, i.text, i.title, i.source, i.meta && i.meta.positive,
    i.kind === "booru" && [...postOf(i).characters, ...postOf(i).general].join(" ")));
  view.innerHTML = `
    <div class="capture">
      <textarea id="cap-text" rows="2" placeholder="Paste tags or jot an idea. Ctrl+Enter saves."></textarea>
      <div class="spread">
        <label class="link" for="cap-file" style="cursor:pointer">Read a PNG</label>
        <input type="file" id="cap-file" class="sr-only" accept="image/*" multiple>
        <button class="btn sm" data-act="capture">Capture <i aria-hidden="true">→</i></button>
      </div>
    </div>
    <p class="hint" style="margin-top:8px">Right-click text, images or a booru post to save it here. In the address bar, type <span class="mono">p</span>, a space, then your idea. Drop a PNG anywhere on the panel.</p>
    <div class="sec">Unsorted<span class="aside">${items.length} waiting</span></div>
    ${items.length ? `<div class="stack">${items.map(slip).join("")}</div>`
      : `<div class="empty"><h3>Inbox <span class="holo-text">zero</span></h3><p>New captures land here until you file them.</p></div>`}`;
}

// Picks a profile for imported text or PNGs, falling back if the preset was deleted.
function guessProfile(model, text) {
  const want = /krea|flux/i.test(model) ? "krea" : /qwen/i.test(model) ? "qwen" : /anima/i.test(model) ? "anima"
    : looksLikeTags(text) ? "illustrious" : "krea";
  if (db.profiles[want]) return want;
  const fmt = looksLikeTags(text) ? "tags" : "prose";
  return (Object.values(db.profiles).find((p) => p.format === fmt) || Object.values(db.profiles)[0]).id;
}

function fileItem(id, as) {
  const item = db.inbox.find((i) => i.id === id);
  if (!item) return;
  const done = () => { db.inbox = db.inbox.filter((i) => i.id !== id); persist(); };
  if (as === "recipe") {
    const r = newRecipe();
    if (item.kind === "text") {
      const tags = looksLikeTags(item.text);
      r.profile = guessProfile("", item.text);
      r.title = item.text.replace(/^idea:\s*/i, "").split(/[,.]/)[0].slice(0, 40);
      r.blocks = [{ type: "subject", tags: tags ? parseTags(item.text) : [], prose: tags ? "" : item.text.replace(/^idea:\s*/i, "") }];
    } else if (item.kind === "png") {
      const m = item.meta;
      r.profile = guessProfile(m.settings.model || "", m.positive);
      r.title = (item.title || "Imported").replace(/\.\w+$/, "").slice(0, 40);
      const tags = looksLikeTags(m.positive);
      r.blocks = [{ type: "subject", tags: tags ? parseTags(m.positive) : [], prose: tags ? "" : m.positive }];
      r.negative = m.negative || "";
      r.settings = { ...r.settings, ...Object.fromEntries(Object.entries(m.settings).filter(([, v]) => v !== undefined && v !== "")) };
      r.image = item.thumb || null;
      r.comfy = m.comfy || null;
    } else if (item.kind === "image") {
      r.title = "Reference " + pad(r.no);
      r.image = item.image;
      r.blocks = [{ type: "subject", tags: [], prose: "" }];
    }
    db.recipes.unshift(r);
    done();
    toast("Filed as recipe");
    go("recipe/" + r.id);
  } else if (as === "import") {
    go("import/" + id);
  } else if (as === "snippet") {
    const post = item.kind === "booru" ? postOf(item) : null;
    const text = post ? post.general.join(", ") : item.text;
    const tags = !!post || looksLikeTags(text);
    db.snippets.unshift({
      id: uid("sn"), cat: "Unsorted",
      name: post ? (post.characters[0] ? titleCase(post.characters[0]) : "Booru tags") : text.split(/[,.]/)[0].slice(0, 32),
      tags: tags ? parseTags(text).map((x) => x.t) : [],
      prose: tags ? "" : text
    });
    done();
    toast("Filed as snippet");
    go("snippets");
  }
}

// ---------- Danbooru import sheet ----------
const postOf = (item) => item.post || postFromGroups(item);
const normTag = (t) => String(t || "").toLowerCase().replace(/_/g, " ").trim();
const castByTrigger = (tag) => db.characters.find((c) => c.trigger && normTag(c.trigger) === normTag(tag));
const BUCKETS = ["appearance", "outfit", "skip"];

// Character looks are cached for a week, so reopening a sheet doesn't hit Danbooru.
let lookCache = null;
async function looksFor(tags) {
  if (!lookCache) lookCache = (hasChrome && (await chrome.storage.local.get("lookCache")).lookCache) || {};
  const out = {}, failed = [];
  await Promise.all(tags.map(async (t) => {
    try { out[t] = await fetchLook(t, lookCache); }
    catch { out[t] = null; failed.push(t); }
  }));
  if (hasChrome) chrome.storage.local.set({ lookCache }).catch(() => {});
  return { looks: out, failed };
}

async function openSheet(item) {
  const post = postOf(item);
  const sheet = { itemId: item.id, post, drafts: null, failed: [], snippet: false };
  ui.sheet = sheet;
  const { looks, failed } = await looksFor(post.characters);
  if (ui.sheet !== sheet) return; // the user moved on
  sheet.failed = failed;
  sheet.drafts = post.characters.map((tag) => {
    const d = draftCharacter(tag, post, looks);
    const existing = castByTrigger(tag);
    d.include = !item.focus || normTag(item.focus) === normTag(tag);
    d.mode = existing ? "outfit" : "new";
    d.targetId = existing ? existing.id : null;
    d.outfitName = existing ? `post ${post.id || ""}`.trim() : "default";
    return d;
  });
  if (ui.importId === item.id) drawImport();
}

function sheetDraft(d, i) {
  const target = d.targetId && charById(d.targetId);
  const next = (b) => BUCKETS[(BUCKETS.indexOf(b) + 1) % 3];
  const chips = (bucket) => d.buckets.map((x, j) => x.b !== bucket ? "" :
    `<button class="chip bucket b-${bucket}" data-act="sheet-cycle" data-d="${i}" data-j="${j}" title="Move to ${next(bucket)}">${esc(x.t)}${x.f != null ? `<span class="w">${Math.round(x.f * 100)}%</span>` : ""}</button>`).join("");
  const count = (bucket) => d.buckets.filter((x) => x.b === bucket).length;
  const source = d.postCount ? `look from ${d.postCount.toLocaleString()} ${d.soloLook ? "solo " : ""}posts` : "sorted from this post only";
  return `<article class="tk${i % 2 ? " ink" : ""}${d.include ? "" : " is-muted"}" style="--stub:0px;padding-bottom:14px">
    <div class="tk-bg"><span class="tk-mark">${esc(initials(d.name))}</span></div>
    <div class="tk-head"><label class="check" style="margin:0"><input type="checkbox" data-sheet="include" data-d="${i}" ${d.include ? "checked" : ""} aria-label="Import ${esc(d.name)}"> <span class="tag">${esc(d.series)}</span></label><span class="kv">${esc(source)}</span></div>
    <input class="title-input sheet-name" data-sheet="name" data-d="${i}" value="${esc(d.name)}" aria-label="Name" spellcheck="false">
    <p class="kv" style="margin-top:4px">trigger <b>${esc(d.tag)}</b></p>
    ${target ? `<div class="sheet-match"><span>Already in your cast as <b>${esc(target.name)}</b></span>
      <div class="seg" role="group" aria-label="What to do">${[["outfit", "Add as outfit"], ["new", "New card"]].map(([v, l]) =>
        `<button data-act="sheet-mode" data-d="${i}" data-v="${v}" aria-pressed="${d.mode === v}">${l}</button>`).join("")}</div></div>` : ""}
    <div class="group-label">Appearance · ${count("appearance")}</div><div class="chips">${chips("appearance") || '<span class="hint">None yet</span>'}</div>
    <div class="group-label">Outfit · ${count("outfit")}</div><div class="chips">${chips("outfit") || '<span class="hint">None yet</span>'}</div>
    <label class="sheet-outfit">Outfit name<input data-sheet="outfit" data-d="${i}" value="${esc(d.outfitName)}" spellcheck="false"></label>
    <div class="group-label">Skip · ${count("skip")}</div><div class="chips">${chips("skip")}</div>
  </article>`;
}

function drawImport() {
  const item = db.inbox.find((i) => i.id === ui.importId);
  if (!ui.sheet || ui.sheet.itemId !== item.id) openSheet(item);
  const sheet = ui.sheet;
  const post = sheet.post;
  const picked = sheet.drafts ? sheet.drafts.filter((d) => d.include).length : 0;
  const head = `
    <div class="backbar"><a class="link" href="#inbox">← Inbox</a>${post.url ? `<a class="link" href="${esc(post.url)}" target="_blank" rel="noopener">Open post</a>` : ""}</div>
    <article class="tk wide" style="--stubw:96px">
      <div class="tk-bg"></div>
      <div class="tk-main">
        <div class="row"><span class="tag">${post.id ? "Danbooru #" + post.id : "Booru post"}</span><span class="slip-src">${esc(post.artists.join(", "))}</span></div>
        <h3 class="tk-title" style="font-size:22px">${esc(post.characters.map((c) => titleCase(c.replace(/\s*\(.*\)$/, ""))).join(" · ") || "No characters")}</h3>
        <p class="kv" style="margin-top:6px">${esc(post.copyrights.map(titleCase).join(", "))}</p>
      </div>
      <div class="tk-tear-v"></div>
      <div class="tk-stub-v">${post.preview ? `<img class="sheet-thumb" src="${esc(post.preview)}" alt="">` : ""}<div class="barcode-wrap">${barcode(item.id, 70)}</div></div>
    </article>`;
  if (!post.characters.length) {
    view.innerHTML = head + `<div class="empty"><h3>No <span class="holo-text">characters</span></h3><p>This post has no character tags. File its tags as a snippet from the inbox instead.</p></div>`;
    return;
  }
  if (!sheet.drafts) {
    view.innerHTML = head + `<div class="sec">Reading Danbooru</div>${post.characters.map((c) =>
      `<p class="hint sheet-wait">Learning ${esc(titleCase(c.replace(/\s*\(.*\)$/, "")))}'s usual look from their posts…</p>`).join("")}`;
    return;
  }
  view.innerHTML = head + `
    <p class="hint" style="margin-top:12px">Click a tag to move it: appearance → outfit → skip. Percentages show how often the tag appears on the character's posts.</p>
    ${sheet.failed.length ? `<p class="hint sheet-warn">Couldn't reach Danbooru for ${esc(sheet.failed.map(titleCase).join(", "))}, so those tags come from this post only.</p>` : ""}
    <div class="sec">Characters<span class="aside">${picked} of ${sheet.drafts.length} selected</span></div>
    <div class="stack" style="gap:18px">${sheet.drafts.map(sheetDraft).join("")}</div>
    <label class="check" style="margin-top:16px"><input type="checkbox" data-sheet="snippet" ${sheet.snippet ? "checked" : ""}> Also save the scene tags as a snippet</label>
    <div class="actions"><button class="btn" data-act="sheet-file">${picked ? `File ${picked} to cast` : "Pick a character"} <i aria-hidden="true">→</i></button></div>`;
}

function fileSheet() {
  const sheet = ui.sheet, post = sheet.post;
  const chosen = sheet.drafts.filter((d) => d.include);
  if (!chosen.length) return toast("Pick at least one character");
  const ids = [];
  for (const d of chosen) {
    const appearance = d.buckets.filter((x) => x.b === "appearance").map((x) => x.t);
    const outfit = d.buckets.filter((x) => x.b === "outfit").map((x) => x.t);
    const outfitName = (d.outfitName || "outfit").trim().toLowerCase();
    const target = d.mode === "outfit" && d.targetId && charById(d.targetId);
    if (target) {
      for (const t of appearance) if (!target.appearance.some((a) => normTag(a) === normTag(t))) target.appearance.push(t);
      if (outfit.length) {
        let name = outfitName, n = 2;
        while (target.outfits[name]) name = `${outfitName} ${n++}`;
        target.outfits[name] = { tags: outfit, prose: "" };
      }
      if (!target.image && post.preview) target.image = post.preview;
      ids.push(target.id);
    } else {
      const c = {
        id: uid("chr"), name: d.name.trim() || titleCase(d.tag), series: d.series, trigger: d.tag, lora: null,
        appearance, prose: "", outfits: outfit.length ? { [outfitName]: { tags: outfit, prose: "" } } : {},
        notes: post.url ? "From " + post.url : "", image: post.preview || null
      };
      db.characters.unshift(c);
      ids.push(c.id);
    }
  }
  if (sheet.snippet) {
    const scene = sceneTags(post);
    if (scene.length) db.snippets.unshift({ id: uid("sn"), cat: "Scenes", name: post.id ? `Danbooru #${post.id}` : "Booru scene", tags: scene, prose: "" });
  }
  db.inbox = db.inbox.filter((i) => i.id !== sheet.itemId);
  ui.sheet = null;
  persist();
  toast(ids.length === 1 ? "Added to cast" : `${ids.length} characters added to cast`);
  go("cast/" + ids[0]);
}

async function makeThumb(file, max = 480) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / bmp.width);
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } catch { return null; }
}

async function handleFiles(files) {
  const json = files.find((f) => f.type === "application/json" || f.name.endsWith(".json"));
  if (json) return readImport(json);
  let read = 0, saved = 0;
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const meta = file.type === "image/png" ? await readRecipeFromFile(file) : null;
    const thumb = await makeThumb(file);
    saved++;
    if (meta && meta.format !== "none") {
      db.inbox.unshift({ id: uid("in"), kind: "png", format: meta.format, title: file.name, source: file.name, createdAt: Date.now(), thumb, meta });
      read++;
    } else {
      db.inbox.unshift({ id: uid("in"), kind: "image", title: file.name, source: file.name, createdAt: Date.now(), image: thumb, note: "No generation data in this file. Kept as a reference." });
    }
  }
  if (!saved) return toast("Drop a PNG or other image");
  persist();
  toast(read ? `Read ${read} recipe${read > 1 ? "s" : ""}` : "Saved as reference");
  go("inbox");
}

// ---------- Recipes ----------
function newRecipe() {
  const first = db.profiles.illustrious ? "illustrious" : Object.keys(db.profiles)[0];
  return {
    id: uid("rec"), no: db.nextNo++, title: "Untitled", profile: first, fav: false, createdAt: Date.now(),
    blocks: [], negative: "",
    settings: { model: "", loras: [], sampler: "euler_ancestral", scheduler: "normal", steps: 28, cfg: 5, seed: Math.floor(Math.random() * 1e9), width: 832, height: 1216 }
  };
}

function recipeTicket(r) {
  const p = profileOf(r);
  const s = r.settings || {};
  return `<a class="tk" href="#recipe/${r.id}" style="${huesOf(p)};--stub:58px">
    <div class="tk-bg"><span class="tk-mark">${pad(r.no, 2)}</span></div>
    <div class="tk-head"><span class="tag">${esc(p.label)}</span><span class="num">No. <b>${pad(r.no)}</b>${r.fav ? " ✦" : ""}</span></div>
    <h3 class="tk-title">${esc(r.title)}</h3>
    <div class="visual">${r.image ? `<img src="${esc(r.image)}" alt="">` : orbs(r.id)}</div>
    <div class="tk-tear"></div>
    <div class="tk-stub">
      <div><p>${s.width ? s.width + "×" + s.height : "—"} · ${s.steps || "—"} steps</p><p class="mono">seed ${s.seed ?? "—"}</p></div>
      <div class="barcode-wrap">${barcode(r.id)}</div>
    </div>
  </a>`;
}

function drawRecipes() {
  if (ui.filter !== "all" && ui.filter !== "fav" && !db.profiles[ui.filter]) ui.filter = "all";
  const list = db.recipes.filter((r) => (ui.filter === "all" || ui.filter === r.profile || (ui.filter === "fav" && r.fav)) &&
    matches(ui.q, r.title, render(r, profileOf(r), db).positive));
  const f = (id, label) => `<button class="fchip" data-act="filter" data-f="${esc(id)}" aria-pressed="${ui.filter === id}">${esc(label)}</button>`;
  view.innerHTML = `
    <div class="spread">
      <div class="filters">${f("all", "All")}${f("fav", "✦")}${Object.values(db.profiles).map((p) => f(p.id, p.label)).join("")}</div>
      <button class="btn sm" data-act="new-recipe">New <i aria-hidden="true">→</i></button>
    </div>
    <div class="sec">Recipes<span class="aside">${list.length} of ${db.recipes.length}</span></div>
    ${list.length ? `<div class="grid">${list.map(recipeTicket).join("")}</div>`
      : `<div class="empty"><h3>No <span class="holo-text">match</span></h3><p>Try another filter, or file something from the inbox.</p></div>`}`;
}

const isWeighted = (w) => Math.abs((w ?? 1) - 1) > 0.001;
function chip(x, i, j) {
  const w = x.w ?? 1;
  return `<span class="chip edit${isWeighted(w) ? " weighted" : ""}${x.off ? " off" : ""}" tabindex="0" data-i="${i}" data-j="${j}"
    title="Click to mute. Scroll or press + and − to weight.">${esc(x.t)}${isWeighted(w) ? `<span class="w">${w.toFixed(1)}</span>` : ""}<button data-act="tag-del" aria-label="Remove ${esc(x.t)}">×</button></span>`;
}

function blockHtml(b, i) {
  const tools = `<div class="tools">
    <button data-act="block-mute" data-i="${i}">${b.off ? "Unmute" : "Mute"}</button>
    ${i ? `<button data-act="block-up" data-i="${i}" aria-label="Move up">↑</button>` : ""}
    <button data-act="block-del" data-i="${i}">Remove</button></div>`;
  if (b.type === "character") {
    const c = charById(b.ref);
    if (!c) return `<div class="block"><div class="block-head"><span class="block-type">Missing cast member</span>${tools}</div></div>`;
    const outfit = b.outfit && c.outfits[b.outfit];
    return `<div class="block${b.off ? " is-off" : ""}">
      <div class="block-head"><span class="block-type">Character</span>${tools}</div>
      <div class="ref-line"><span class="tag">${esc(c.name)}</span>
        <select data-act="outfit" data-i="${i}" aria-label="Outfit"><option value="">No outfit</option>${Object.keys(c.outfits).map((o) => `<option ${o === b.outfit ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>
        <a class="link" href="#cast/${c.id}">Edit cast</a></div>
      <div class="chips" style="margin-top:8px">${[c.trigger, ...c.appearance, ...(outfit ? outfit.tags : [])].filter(Boolean).map((t) => `<span class="chip ro">${esc(t)}</span>`).join("")}</div>
    </div>`;
  }
  return `<div class="block${b.off ? " is-off" : ""}">
    <div class="block-head"><span class="block-type">${esc(b.type)}</span>${tools}</div>
    <div class="chips">${b.tags.map((x, j) => chip(x, i, j)).join("")}<input class="chip-add" data-i="${i}" placeholder="+ tags" aria-label="Add tags to ${esc(b.type)}"></div>
    <textarea class="prose" data-i="${i}" rows="1" placeholder="Prose for natural-language models">${esc(b.prose)}</textarea>
  </div>`;
}

function drawBlocks(r) {
  $("#blocks").innerHTML = r.blocks.length ? r.blocks.map(blockHtml).join("")
    : `<p class="hint" style="padding:10px 0">No blocks yet. Add a subject, a cast member or a snippet below.</p>`;
}

function drawOutput(r) {
  const p = profileOf(r);
  const out = render(r, p, db);
  const issues = lint(r, p, db);
  let meter = "";
  if (p.clip) {
    const n = estimateClipTokens(out.positive);
    const chunks = Math.max(1, Math.ceil(n / 75));
    meter = `<div class="meter"><span>≈ ${n} tokens</span><div class="meter-bar"><span style="width:${Math.min(100, (n / (chunks * 75)) * 100).toFixed(0)}%"></span></div><span>${chunks} × 75</span></div>`;
  }
  $("#output").innerHTML = `<section class="tk out" style="${huesOf(p)}">
    <div class="tk-bg"></div>
    <div class="tk-head"><span class="tag">Output · ${esc(p.label)}</span><span class="num">${esc(FORMAT_LABEL[p.format])}</span></div>
    <div class="out-label"><span>Positive</span><button class="link" data-act="copy-pos">Copy</button></div>
    <div class="out-text">${esc(out.positive) || '<span class="hint">Nothing yet</span>'}</div>
    ${meter}
    <div class="out-label"><span>Negative</span>${out.negative != null ? `<button class="link" data-act="copy-neg">Copy</button>` : ""}</div>
    ${out.negative == null ? `<div class="out-text muted">Not used by ${esc(p.label)}.</div>` : `<div class="out-text">${esc(out.negative)}</div>`}
    <ul class="lint">${issues.length ? issues.map((x) => `<li>${esc(x)}</li>`).join("") : `<li class="ok">No problems found</li>`}</ul>
    <div class="actions">
      <button class="btn sm" data-act="copy-pos">Copy prompt <i aria-hidden="true">→</i></button>
      <button class="btn ghost sm" data-act="copy-a1111" title="Paste into Forge or A1111, then press the read-parameters arrow">Copy for Forge</button>
    </div>
    <div class="out-label"><span>ComfyUI</span><span class="kv">${ui.comfyTab ? "tab open" : "no tab open"}</span></div>
    <div class="actions" style="margin-top:6px">
      <button class="btn ghost sm" data-act="comfy-load" title="Writes the prompt, negative and settings into the workflow open in ComfyUI">Load into workflow</button>
      <button class="btn ghost sm" data-act="comfy-node" title="Replaces the text of the node you have selected in ComfyUI">Selected node</button>
      ${r.comfy ? `<button class="btn ghost sm" data-act="send-comfy" title="Queues the graph saved in this recipe's PNG, with the current prompt">Queue saved graph</button>` : ""}
    </div>
  </section>`;
}

function drawRecipe() {
  const r = recipeById(ui.recipeId);
  const p = profileOf(r);
  const s = r.settings;
  const loras = (s.loras || []).map((l) => `${l.name}:${l.w}`).join(", ");
  const field = (k, label, val, cls = "") => `<label class="${cls}">${label}<input data-s="${k}" value="${esc(val ?? "")}" spellcheck="false"></label>`;
  view.innerHTML = `
    <div class="backbar">
      <a class="link" href="#recipes">← Recipes</a>
      <div class="row">
        <button class="link" data-act="fav">${r.fav ? "Unstar" : "Star"}</button>
        <button class="link" data-act="dup">Duplicate</button>
        <button class="link" data-act="del-recipe">Delete</button>
      </div>
    </div>
    <section class="tk" style="${huesOf(p)};--stub:0px;padding-bottom:14px">
      <div class="tk-bg"><span class="tk-mark">${pad(r.no, 2)}</span></div>
      <div class="tk-head"><span class="tag">Recipe</span><span class="num">No. <b>${pad(r.no)}</b>${r.fav ? " ✦" : ""}</span></div>
      <input class="title-input" id="title" value="${esc(r.title)}" aria-label="Recipe title" spellcheck="false">
      ${r.image ? `<div class="visual"><img src="${esc(r.image)}" alt=""></div>` : ""}
      <div class="profiles" role="group" aria-label="Model profile">
        ${Object.values(db.profiles).map((x) => `<button data-act="profile" data-p="${esc(x.id)}" aria-pressed="${x.id === p.id}"><b>${esc(x.label)}</b><small>${esc(x.base)}</small></button>`).join("")}
      </div>
      <p class="profile-hint kv">${esc(p.hint)}${p.weights ? " · weights on" : " · weights ignored"} · <a class="link" href="#settings" data-act="edit-profile" data-p="${esc(p.id)}">Edit profile</a></p>
    </section>

    <div class="sec">Blocks<span class="aside">scroll a tag to weight it</span></div>
    <div id="blocks"></div>
    <div class="add-row">
      <select id="add-type" aria-label="Block type">${BLOCK_TYPES.filter((t) => t !== "character").map((t) => `<option>${t}</option>`).join("")}</select>
      <button class="btn ghost sm" data-act="add-block">Add block</button>
      <select id="add-char" aria-label="Add cast member"><option value="">+ Cast</option>${db.characters.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
      <select id="add-snip" aria-label="Insert snippet"><option value="">+ Snippet</option>${db.snippets.map((x) => `<option value="${x.id}">${esc(x.cat)} · ${esc(x.name)}</option>`).join("")}</select>
    </div>

    <div class="sec">Negative<span class="aside">blank uses the profile default</span></div>
    <textarea class="prose" id="neg" rows="1" placeholder="${esc(p.negative ?? "Not used by this profile")}">${esc(r.negative)}</textarea>

    <div id="output"></div>

    <section class="tk settings" style="--stub:0px">
      <div class="tk-bg"></div>
      <div class="tk-head"><span class="tag">Settings</span><span class="kv">${r.comfy ? "ComfyUI graph attached" : "No ComfyUI graph"}</span></div>
      <div class="settings-grid">
        ${field("model", "Model", s.model, "full")}
        ${field("loras", "LoRAs (name:weight, …)", loras, "full")}
        ${field("sampler", "Sampler", s.sampler)}${field("scheduler", "Scheduler", s.scheduler)}
        ${field("steps", "Steps", s.steps)}${field("cfg", "CFG", s.cfg)}
        ${field("seed", "Seed", s.seed)}${field("size", "Size", s.width ? s.width + "x" + s.height : "")}
      </div>
      <div class="spread" style="margin-top:12px"><span class="kv">Created ${ago(r.createdAt)}</span><div class="barcode-wrap">${barcode(r.id, 96)}</div></div>
    </section>`;
  drawBlocks(r);
  drawOutput(r);
}

const refresh = (r) => { persist(); drawBlocks(r); drawOutput(r); };

// ---------- ComfyUI ----------
const comfyBase = () => db.settings.comfyUrl || DEFAULT_COMFY;

async function withComfyTab(payload, okLabel) {
  if (!hasChrome) return toast("Load Prompto as an extension to reach ComfyUI");
  const tab = await findTab(comfyBase());
  if (!tab) return toast("Open ComfyUI in a browser tab first");
  try {
    const res = await applyInTab(tab.id, payload);
    toast(res && res.ok ? `${okLabel}: ${res.applied.join(", ")}` : (res && res.error) || "ComfyUI didn't respond");
  } catch { toast("Couldn't reach the ComfyUI tab. Check the address in Settings."); }
}

async function queueSaved(r) {
  if (!r.comfy || !r.comfy.pos) return toast("No ComfyUI graph yet. Import a ComfyUI PNG to attach one.");
  if (!ui.comfyLive) return toast(`ComfyUI isn't answering at ${comfyBase()}`);
  const out = render(r, profileOf(r), db);
  const graph = structuredClone(r.comfy.graph);
  graph[r.comfy.pos.id].inputs[r.comfy.pos.key] = out.positive;
  if (r.comfy.neg && out.negative != null) graph[r.comfy.neg.id].inputs[r.comfy.neg.key] = out.negative;
  if (r.comfy.seed && r.settings.seed != null) graph[r.comfy.seed.id].inputs[r.comfy.seed.key] = Number(r.settings.seed);
  try { await queueGraph(comfyBase(), graph); toast("Queued in ComfyUI"); }
  catch (e) { toast(e.message || "Couldn't reach ComfyUI"); }
}

// What the ComfyUI sidebar shows: prompts already rendered, so the ComfyUI side
// never needs Prompto's rendering rules.
function snapshot() {
  return {
    syncedAt: Date.now(),
    recipes: db.recipes.map((r) => {
      const p = profileOf(r);
      const out = render(r, p, db);
      const thumb = r.image && r.image.startsWith("data:") && r.image.length < 80000 ? r.image : null;
      return { id: r.id, no: r.no, title: r.title, profile: p.label, fav: !!r.fav, positive: out.positive, negative: out.negative, settings: r.settings, thumb };
    }),
    snippets: db.snippets.map(({ id, cat, name, tags, prose }) => ({ id, cat, name, tags, prose })),
    cast: db.characters.map((c) => ({
      id: c.id, name: c.name, series: c.series, tags: [c.trigger, ...c.appearance].filter(Boolean), prose: c.prose,
      outfits: Object.entries(c.outfits).map(([name, o]) => ({ name, tags: o.tags, prose: o.prose }))
    }))
  };
}

function captureToInbox(cap) {
  const base = { id: "in_" + cap.id, createdAt: cap.createdAt || Date.now(), source: cap.source || "ComfyUI" };
  if (cap.kind === "text") return { ...base, kind: "text", text: cap.text };
  if (cap.graph) {
    try { return { ...base, kind: "png", format: "ComfyUI", title: cap.filename, thumb: cap.thumb, meta: parseComfy(cap.graph) }; } catch {}
  }
  return { ...base, kind: "image", title: cap.filename, image: cap.thumb, note: "No prompt found in this image." };
}

// With the ComfyUI-Prompto extension installed: push the library, collect captures.
async function syncBridge(tab) {
  ui.bridge = (await bridgeCall(tab.id, "info").catch(() => null))?.version || null;
  if (!ui.bridge) return;
  if (ui.syncedRev !== ui.rev) {
    const rev = ui.rev;
    const ok = await bridgeCall(tab.id, "syncLibrary", [snapshot()]).catch(() => null);
    if (ok && ok.ok) ui.syncedRev = rev;
  }
  const caps = await bridgeCall(tab.id, "takeCaptures").catch(() => null);
  if (!Array.isArray(caps) || !caps.length) return;
  const have = new Set(db.inbox.map((i) => i.id));
  const fresh = caps.map(captureToInbox).filter((i) => !have.has(i.id));
  for (const item of fresh) db.inbox.unshift(item);
  await store.save(db);
  await bridgeCall(tab.id, "ackCaptures", [caps.map((c) => c.id)]).catch(() => null);
  persist();
  if (fresh.length) {
    toast(fresh.length === 1 ? "New capture from ComfyUI" : `${fresh.length} captures from ComfyUI`);
    if (ui.tab === "inbox" && !ui.recipeId) draw(); else $("#count-inbox").textContent = db.inbox.length;
  }
}

let beating = false;
async function heartbeat() {
  if (beating) return;
  beating = true;
  try { await beat(); } finally { beating = false; }
}
async function beat() {
  const base = comfyBase();
  const [live, tab] = await Promise.all([ping(base), findTab(base)]);
  const hadBridge = ui.bridge;
  if (tab) await syncBridge(tab).catch(() => {}); else ui.bridge = null;
  const changed = live !== ui.comfyLive || !!tab !== !!ui.comfyTab || hadBridge !== ui.bridge;
  ui.comfyLive = live; ui.comfyTab = tab;
  const el = $("#comfy-status");
  el.dataset.state = tab || live ? "on" : "off";
  el.textContent = ui.bridge ? "ComfyUI · linked" : tab ? "ComfyUI · tab open" : live ? "ComfyUI · live" : "ComfyUI · offline";
  el.title = base;
  if (changed && ui.recipeId) drawOutput(recipeById(ui.recipeId));
  if (changed && (ui.tab === "snippets" || ui.tab === "settings") && !ui.recipeId && !view.contains(document.activeElement)) draw();
}

// ---------- Cast ----------
const initials = (n) => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
function strChips(arr, path) {
  return arr.map((t, j) => `<span class="chip">${esc(t)}<button data-act="str-del" data-path="${esc(path)}" data-j="${j}" aria-label="Remove ${esc(t)}">×</button></span>`).join("")
    + `<input class="chip-add" data-path="${esc(path)}" placeholder="+ tags" aria-label="Add tags">`;
}
// String-list targets edited through chips: cast appearance, outfits, profile quality tags.
function listTarget(path) {
  const [a, b, c] = path.split("|");
  if (a === "profile") return db.profiles[b].prefix;
  const ch = charById(a);
  return b === "appearance" ? ch.appearance : ch.outfits[c].tags;
}
function castTicket(c, i) {
  const open = ui.openChar === c.id;
  const ro = (arr) => arr.map((t) => `<span class="chip ro">${esc(t)}</span>`).join("");
  const detail = open ? `<div class="char-open">
      <div class="group-label">Appearance</div><div class="chips">${strChips(c.appearance, `${c.id}|appearance`)}</div>
      <div class="group-label">Prose</div><textarea class="prose" data-cf="prose" data-c="${c.id}" rows="1" placeholder="a short natural-language description">${esc(c.prose)}</textarea>
      ${Object.entries(c.outfits).map(([o, v]) => `<div class="group-label">Outfit · ${esc(o)}</div><div class="chips">${strChips(v.tags, `${c.id}|outfit|${o}`)}</div>
        <textarea class="prose" data-cf="outfit-prose" data-o="${esc(o)}" data-c="${c.id}" rows="1" placeholder="what they're wearing, in prose">${esc(v.prose)}</textarea>`).join("")}
      <div class="row"><input class="chip-add" data-new-outfit="${c.id}" placeholder="+ outfit name" aria-label="New outfit"></div>
      <div class="group-label">Trigger word</div><textarea class="prose" data-cf="trigger" data-c="${c.id}" rows="1">${esc(c.trigger)}</textarea>
      <div class="group-label">Notes</div><textarea class="prose" data-cf="notes" data-c="${c.id}" rows="1" placeholder="what works, what doesn't">${esc(c.notes)}</textarea>
    </div>` : `<div class="chips" style="margin-top:10px">${ro(c.appearance.slice(0, 8))}${c.appearance.length > 8 ? `<span class="chip ro">+${c.appearance.length - 8}</span>` : ""}</div>`;
  return `<article class="tk${i % 2 ? " ink" : ""}" id="c-${c.id}" style="--stub:60px">
    <div class="tk-bg"><span class="tk-mark">${esc(initials(c.name))}</span></div>
    <div class="tk-head"><span class="tag">${esc(c.series)}</span>${c.trigger ? `<span class="num">trigger <b>${esc(c.trigger)}</b></span>` : ""}</div>
    ${c.image ? `<img class="cast-ref" src="${esc(c.image)}" alt="">` : ""}
    <h3 class="tk-title">${esc(c.name)}</h3>
    ${detail}
    <div class="group-label">Start a recipe</div>
    <div class="row" style="margin-bottom:14px">${(Object.keys(c.outfits).length ? Object.keys(c.outfits) : [""]).map((o) => `<button class="fchip" data-act="cast-recipe" data-c="${c.id}" data-o="${esc(o)}">${esc(o || "No outfit")}</button>`).join("")}</div>
    <div class="tk-tear"></div>
    <div class="tk-stub">
      <div><p>${c.lora ? esc(c.lora.name) : "No LoRA"}</p><p class="mono">${c.lora ? "weight " + c.lora.w : "tags only"}</p></div>
      <button class="link" data-act="cast-toggle" data-c="${c.id}">${open ? "Done" : "Edit"}</button>
    </div>
  </article>`;
}
function drawCast() {
  const list = db.characters.filter((c) => matches(ui.q, c.name, c.series, c.trigger, c.appearance.join(" ")));
  view.innerHTML = `
    <div class="spread"><p class="hint">Reusable characters. A recipe pulls in the latest tags each time.</p>
      <button class="btn sm" data-act="new-cast">New <i aria-hidden="true">→</i></button></div>
    <div class="sec">Cast<span class="aside">${list.length}</span></div>
    <div class="stack" style="gap:18px">${list.map(castTicket).join("")}</div>`;
}

// ---------- Snippets ----------
function drawSnippets() {
  const list = db.snippets.filter((x) => matches(ui.q, x.name, x.cat, x.tags.join(" "), x.prose));
  const cats = [...new Set(list.map((x) => x.cat))];
  const node = (x, k) => ui.comfyTab ? `<button class="link" data-act="snip-node" data-id="${x.id}" data-k="${k}" title="Append to the selected ComfyUI node">→ Node</button>` : "";
  view.innerHTML = cats.length ? cats.map((cat) => {
    const items = list.filter((x) => x.cat === cat);
    return `<div class="sec">${esc(cat)}<span class="aside">${items.length}</span></div>` + items.map((x) => `
      <div class="snip">
        <div class="spread"><span class="snip-name">${esc(x.name)}</span>
          <div class="row">${x.tags.length ? `<button class="link" data-act="snip-copy" data-id="${x.id}" data-k="tags">Tags</button>` : ""}${x.prose ? `<button class="link" data-act="snip-copy" data-id="${x.id}" data-k="prose">Prose</button>` : ""}${node(x, x.tags.length ? "tags" : "prose")}</div></div>
        ${x.tags.length ? `<div class="chips">${x.tags.map((t) => `<span class="chip ro">${esc(t)}</span>`).join("")}</div>` : ""}
        ${x.prose ? `<p class="snip-prose">${esc(x.prose)}</p>` : ""}
      </div>`).join("");
  }).join("") : `<div class="empty"><h3>No <span class="holo-text">snippets</span></h3><p>File tags from the inbox to start a collection.</p></div>`;
}

const SNIP_BLOCK = { Lighting: "lighting", Camera: "camera", Style: "style" };

// ---------- Settings ----------
function profileTicket(p) {
  const open = ui.openProfile === p.id;
  const used = db.recipes.filter((r) => r.profile === p.id).length;
  const check = (k, label, on) => `<label class="check"><input type="checkbox" data-pf="${k}" data-p="${esc(p.id)}" ${on ? "checked" : ""}> ${label}</label>`;
  const editor = open ? `<div class="pf-edit">
      <div class="settings-grid">
        <label>Name<input data-pf="label" data-p="${esc(p.id)}" value="${esc(p.label)}"></label>
        <label>Short note<input data-pf="base" data-p="${esc(p.id)}" value="${esc(p.base)}"></label>
        <label class="full">Suggested settings<input data-pf="hint" data-p="${esc(p.id)}" value="${esc(p.hint)}"></label>
      </div>
      <div class="group-label">Output</div>
      <div class="seg" role="group" aria-label="Output format">${["tags", "hybrid", "prose"].map((v) => `<button data-act="pf-format" data-p="${esc(p.id)}" data-v="${v}" aria-pressed="${p.format === v}">${FORMAT_LABEL[v]}</button>`).join("")}</div>
      ${check("weights", "Write weights as (tag:1.2)", p.weights)}
      ${check("clip", "Show the CLIP token counter", p.clip)}
      <div class="group-label">Quality tags, added first in tag output</div>
      <div class="chips">${strChips(p.prefix, `profile|${p.id}|prefix`)}</div>
      <div class="group-label">Default negative</div>
      ${check("hasNeg", "This model uses a negative prompt", p.negative !== null)}
      ${p.negative !== null ? `<textarea class="prose" data-pf="negative" data-p="${esc(p.id)}" rows="1" placeholder="lowres, worst quality, …">${esc(p.negative)}</textarea>` : ""}
      <div class="group-label">Paper</div>
      <div class="row">${Object.keys(STOCKS).map((k) => `<button class="swatch" style="${STOCKS[k]}" data-act="pf-stock" data-p="${esc(p.id)}" data-v="${k}" aria-pressed="${p.stock === k}" aria-label="${k}" title="${k}"></button>`).join("")}</div>
    </div>` : "";
  return `<article class="tk" style="${huesOf(p)};--stub:0px;padding-bottom:12px">
    <div class="tk-bg"></div>
    <div class="tk-head"><span class="tag">${esc(FORMAT_LABEL[p.format])}</span><span class="num">${used} recipe${used === 1 ? "" : "s"}</span></div>
    <h3 class="tk-title">${esc(p.label)}</h3>
    <p class="kv" style="margin-top:6px">${esc([p.base, p.hint].filter(Boolean).join(" · "))}</p>
    ${editor}
    <div class="row" style="margin-top:10px">
      <button class="link" data-act="pf-toggle" data-p="${esc(p.id)}">${open ? "Done" : "Edit"}</button>
      <button class="link" data-act="pf-dup" data-p="${esc(p.id)}">Duplicate</button>
      ${DEFAULT_PROFILES[p.id] ? `<button class="link" data-act="pf-reset" data-p="${esc(p.id)}">Reset</button>` : ""}
      <button class="link" data-act="pf-del" data-p="${esc(p.id)}">Delete</button>
    </div>
  </article>`;
}

function drawSettings() {
  const info = tagListInfo();
  const pend = ui.pendingImport;
  const n = (k) => db[k].length;
  view.innerHTML = `
    <div class="sec">Model profiles<span class="aside">${Object.keys(db.profiles).length}</span></div>
    <p class="hint">How a recipe turns into prompt text. Changes apply to every recipe on that profile.</p>
    <div class="stack" style="margin-top:12px">${Object.values(db.profiles).map(profileTicket).join("")}</div>
    <div class="row" style="margin-top:12px"><button class="btn ghost sm" data-act="pf-new">New profile</button></div>

    <div class="sec">Tag autocomplete</div>
    <section class="tk" style="--stub:0px;padding-bottom:14px">
      <div class="tk-bg"></div>
      <div class="tk-head"><span class="tag">Tag list</span><span class="kv">${info ? esc(info.source) : "none loaded"}</span></div>
      <h3 class="tk-title">${info ? info.count.toLocaleString() + " tags" : "Your tags only"}</h3>
      <p class="hint" style="margin-top:8px">${info ? `Loaded ${ago(info.loadedAt)}. ` : ""}Import a tag CSV in the a1111 tag-autocomplete format (name, category, post count, aliases). <a class="link" href="https://github.com/DominikDoom/a1111-sd-webui-tagcomplete/tree/main/tags" target="_blank" rel="noopener">Find a list</a></p>
      <div class="row" style="margin-top:10px">
        <label class="btn ghost sm" for="tag-file" style="cursor:pointer">${info ? "Replace list" : "Import CSV"}</label>
        <input type="file" id="tag-file" class="sr-only" accept=".csv,text/csv">
        ${info ? `<button class="link" data-act="tags-clear">Remove list</button>` : ""}
      </div>
      <label class="check" style="margin-top:10px"><input type="checkbox" data-setting="onlineTags" ${db.settings.onlineTags ? "checked" : ""}> Look up tags on Danbooru as you type</label>
      <p class="hint">Sends what you type to danbooru.donmai.us when the imported list has few matches.</p>
    </section>

    <div class="sec">ComfyUI</div>
    <section class="tk" style="--stub:0px;padding-bottom:14px">
      <div class="tk-bg"></div>
      <div class="tk-head"><span class="tag">Connection</span><span class="kv">${ui.bridge ? "linked" : ui.comfyTab ? "tab open" : ui.comfyLive ? "server answering" : "not found"}</span></div>
      <div class="settings-grid">
        <label class="full">Address<input id="comfy-url" value="${esc(comfyBase())}" spellcheck="false" placeholder="${DEFAULT_COMFY}"></label>
      </div>
      <div class="row" style="margin-top:10px"><button class="btn ghost sm" data-act="comfy-save">Save address</button></div>
      <p class="hint" style="margin-top:8px">Loading into a workflow needs ComfyUI open in a browser tab. The desktop app runs on port 8000 and only supports queueing saved graphs.</p>
      <p class="kv" style="margin-top:8px">${ui.bridge ? `ComfyUI-Prompto ${esc(ui.bridge)} is installed: your library syncs to its sidebar and captures from ComfyUI land in the inbox.`
        : "Install ComfyUI-Prompto in ComfyUI for a Prompto sidebar there, right-click “Save to Prompto”, and auto-capture of saved images."}</p>
    </section>

    <div class="sec">Library</div>
    <section class="tk" style="--stub:0px;padding-bottom:14px">
      <div class="tk-bg"></div>
      <div class="tk-head"><span class="tag">Backup</span><span class="kv">JSON</span></div>
      <p class="kv" style="margin-top:10px">${plural(n("recipes"), "recipe")} · ${n("characters")} cast · ${plural(n("snippets"), "snippet")} · ${n("inbox")} in inbox · ${plural(Object.keys(db.profiles).length, "profile")}</p>
      ${pend ? `<div class="import-box">
          <p class="snip-name">${esc(pend.name)}</p>
          <p class="kv">${plural(pend.data.recipes.length, "recipe")} · ${pend.data.characters.length} cast · ${plural(pend.data.snippets.length, "snippet")} · ${pend.data.inbox.length} in inbox</p>
          <p class="hint">Merge adds anything you don't already have. Replace swaps your whole library for this file.</p>
          <div class="row"><button class="btn sm" data-act="import-merge">Merge</button><button class="btn ghost sm" data-act="import-replace">Replace</button><button class="link" data-act="import-cancel">Cancel</button></div>
        </div>` : ""}
      <div class="row" style="margin-top:10px">
        <button class="btn sm" data-act="export">Export <i aria-hidden="true">→</i></button>
        <label class="btn ghost sm" for="import-file" style="cursor:pointer">Import</label>
        <input type="file" id="import-file" class="sr-only" accept=".json,application/json">
        <button class="link" data-act="clear-samples">Remove sample items</button>
      </div>
      <p class="hint" style="margin-top:8px">The tag list isn't included; it stays on this device.</p>
    </section>`;
}

function exportLibrary() {
  const payload = { app: "prompto", version: db.version, exportedAt: new Date().toISOString(), data: db };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `prompto-library-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("Library exported");
}

async function readImport(file) {
  try {
    const json = JSON.parse(await file.text());
    const data = json && json.app === "prompto" ? json.data : json;
    if (!data || !["recipes", "characters", "snippets", "inbox"].some((k) => Array.isArray(data[k]))) throw new Error();
    ui.pendingImport = { name: file.name, data: migrate(data) };
    go("settings");
    requestAnimationFrame(() => $(".import-box")?.scrollIntoView({ block: "center", behavior: "smooth" }));
  } catch { toast("That file isn't a Prompto library"); }
}

function mergeLibrary(inc) {
  let added = 0;
  let maxNo = Math.max(0, ...db.recipes.map((r) => r.no), ...inc.recipes.map((r) => r.no || 0));
  const nos = new Set(db.recipes.map((r) => r.no));
  for (const k of ["inbox", "recipes", "characters", "snippets"]) {
    const have = new Set(db[k].map((x) => x.id));
    const fresh = inc[k].filter((x) => !have.has(x.id));
    if (k === "recipes") for (const r of fresh) if (!r.no || nos.has(r.no)) r.no = ++maxNo;
    db[k].push(...fresh);
    added += fresh.length;
  }
  for (const [id, p] of Object.entries(inc.profiles)) if (!db.profiles[id]) db.profiles[id] = p;
  db.nextNo = Math.max(db.nextNo, maxNo + 1);
  return added;
}

const SEED_IDS = new Set([...SEED.inbox, ...SEED.recipes, ...SEED.characters, ...SEED.snippets].map((x) => x.id));

// ---------- Autocomplete ----------
let tagIndex = null, tagIndexRev = -1;
attachAutocomplete({
  suggestLocal(q) {
    if (tagIndexRev !== ui.rev) { tagIndex = libraryTags(db); tagIndexRev = ui.rev; }
    const yours = searchLibrary(tagIndex, q, 3);
    const seen = new Set(yours.map((x) => x.name.toLowerCase()));
    return [...yours, ...searchLocal(q, 8).filter((x) => !seen.has(x.name.toLowerCase()))].slice(0, 8);
  },
  suggestOnline: (q, signal) => (db.settings.onlineTags ? searchDanbooru(q, signal) : Promise.resolve([]))
});

// ---------- Events ----------
document.addEventListener("click", async (e) => {
  const tabBtn = e.target.closest("#tabs button");
  if (tabBtn) return go(tabBtn.dataset.tab);
  if (e.target.closest("#settings-btn")) return go("settings");

  const chipEl = e.target.closest(".chip.edit");
  const el = e.target.closest("[data-act]");
  const r = ui.recipeId && recipeById(ui.recipeId);

  if (chipEl && !el) {
    const x = r.blocks[chipEl.dataset.i].tags[chipEl.dataset.j];
    x.off = !x.off;
    const sel = `.chip.edit[data-i="${chipEl.dataset.i}"][data-j="${chipEl.dataset.j}"]`;
    refresh(r);
    $(sel)?.focus();
    return;
  }
  if (!el) return;
  const act = el.dataset.act;
  const i = Number(el.dataset.i);
  const pf = el.dataset.p && db.profiles[el.dataset.p];

  switch (act) {
    case "capture": {
      const t = $("#cap-text").value.trim();
      if (!t) { toast("Type or paste something first"); return $("#cap-text").focus(); }
      db.inbox.unshift({ id: uid("in"), kind: "text", text: t, source: "typed", createdAt: Date.now() });
      persist(); ui.focus = "#cap-text"; draw(); toast("Captured");
      break;
    }
    case "file": return fileItem(el.dataset.id, el.dataset.as);
    case "sheet-cycle": {
      const x = ui.sheet.drafts[el.dataset.d].buckets[el.dataset.j];
      x.b = BUCKETS[(BUCKETS.indexOf(x.b) + 1) % 3];
      const y = window.scrollY; drawImport(); window.scrollTo(0, y); break;
    }
    case "sheet-mode": ui.sheet.drafts[el.dataset.d].mode = el.dataset.v; drawImport(); break;
    case "sheet-file": return fileSheet();
    case "discard": db.inbox = db.inbox.filter((x) => x.id !== el.dataset.id); persist(); draw(); toast("Discarded"); break;
    case "filter": ui.filter = el.dataset.f; draw(); break;
    case "new-recipe": { const n = newRecipe(); db.recipes.unshift(n); persist(); go("recipe/" + n.id); break; }
    case "profile": r.profile = el.dataset.p; persist(); drawRecipe(); break;
    case "edit-profile": ui.openProfile = el.dataset.p; break;
    case "fav": r.fav = !r.fav; persist(); drawRecipe(); break;
    case "dup": {
      const d = { ...structuredClone(r), id: uid("rec"), no: db.nextNo++, title: r.title + " copy", createdAt: Date.now() };
      db.recipes.unshift(d); persist(); toast("Duplicated"); go("recipe/" + d.id); break;
    }
    case "del-recipe":
      if (!armed(el, "Press again to delete")) return;
      db.recipes = db.recipes.filter((x) => x.id !== r.id); persist(); toast("Recipe deleted"); go("recipes"); break;
    case "tag-del": {
      const c = el.closest(".chip");
      r.blocks[c.dataset.i].tags.splice(c.dataset.j, 1); refresh(r); break;
    }
    case "block-mute": r.blocks[i].off = !r.blocks[i].off; refresh(r); break;
    case "block-up": [r.blocks[i - 1], r.blocks[i]] = [r.blocks[i], r.blocks[i - 1]]; refresh(r); break;
    case "block-del": r.blocks.splice(i, 1); refresh(r); break;
    case "add-block": {
      r.blocks.push({ type: $("#add-type").value, tags: [], prose: "" });
      refresh(r); $(`.chip-add[data-i="${r.blocks.length - 1}"]`)?.focus(); break;
    }
    case "copy-pos": copy(render(r, profileOf(r), db).positive, "Prompt copied"); break;
    case "copy-neg": copy(render(r, profileOf(r), db).negative || "", "Negative copied"); break;
    case "copy-a1111": copy(toA1111(r, profileOf(r), db), "Copied. Paste it into Forge, then press ↙"); break;
    case "comfy-load": {
      const out = render(r, profileOf(r), db);
      return withComfyTab({ mode: "recipe", positive: out.positive, negative: out.negative, settings: r.settings }, "Loaded");
    }
    case "comfy-node": return withComfyTab({ mode: "selected", text: render(r, profileOf(r), db).positive, append: false }, "Sent");
    case "send-comfy": return queueSaved(r);
    case "cast-toggle": ui.openChar = ui.openChar === el.dataset.c ? null : el.dataset.c; draw(); break;
    case "cast-recipe": {
      const c = charById(el.dataset.c);
      const n = newRecipe();
      n.title = c.name + (el.dataset.o ? " · " + el.dataset.o : "");
      n.blocks = [{ type: "character", ref: c.id, outfit: el.dataset.o || "" }, { type: "scene", tags: [], prose: "" }];
      if (c.lora) n.settings.loras = [{ ...c.lora }];
      db.recipes.unshift(n); persist(); go("recipe/" + n.id); break;
    }
    case "new-cast": {
      const c = { id: uid("chr"), name: "New cast member", series: "Original", trigger: "", lora: null, appearance: [], prose: "", outfits: {}, notes: "" };
      db.characters.unshift(c); ui.openChar = c.id; persist(); draw(); break;
    }
    case "str-del": listTarget(el.dataset.path).splice(Number(el.dataset.j), 1); persist(); draw(); break;
    case "snip-copy": {
      const x = db.snippets.find((s) => s.id === el.dataset.id);
      copy(el.dataset.k === "tags" ? x.tags.join(", ") : x.prose, "Snippet copied"); break;
    }
    case "snip-node": {
      const x = db.snippets.find((s) => s.id === el.dataset.id);
      return withComfyTab({ mode: "selected", text: el.dataset.k === "tags" ? x.tags.join(", ") : x.prose, append: true }, "Added");
    }

    // profiles
    case "pf-toggle": ui.openProfile = ui.openProfile === pf.id ? null : pf.id; draw(); break;
    case "pf-format": pf.format = el.dataset.v; persist(); draw(); break;
    case "pf-stock": pf.stock = el.dataset.v; persist(); draw(); break;
    case "pf-new": {
      const p = { id: uid("pf"), label: "New profile", base: "", format: "tags", weights: true, clip: true, prefix: [], negative: "", hint: "", stock: "lilac" };
      db.profiles[p.id] = p; ui.openProfile = p.id; persist(); draw(); break;
    }
    case "pf-dup": {
      const p = { ...structuredClone(pf), id: uid("pf"), label: pf.label + " copy" };
      db.profiles[p.id] = p; ui.openProfile = p.id; persist(); draw(); toast("Profile duplicated"); break;
    }
    case "pf-reset":
      if (!armed(el, "Press again to reset")) return;
      db.profiles[pf.id] = structuredClone(DEFAULT_PROFILES[pf.id]); persist(); draw(); toast("Profile reset"); break;
    case "pf-del": {
      const used = db.recipes.filter((x) => x.profile === pf.id).length;
      if (used) return toast(`${used} recipe${used > 1 ? "s use" : " uses"} this profile. Switch ${used > 1 ? "them" : "it"} first.`);
      if (Object.keys(db.profiles).length === 1) return toast("Keep at least one profile");
      if (!armed(el, "Press again to delete")) return;
      delete db.profiles[pf.id]; persist(); draw(); toast("Profile deleted"); break;
    }

    // settings
    case "tags-clear":
      if (!armed(el, "Press again to remove")) return;
      await clearTagList(); draw(); toast("Tag list removed"); break;
    case "comfy-save": {
      let base;
      try { base = normalizeBase($("#comfy-url").value.trim() || DEFAULT_COMFY); } catch { return toast("That address doesn't look right"); }
      if (hasChrome && chrome.permissions) {
        const origins = [originPattern(base)];
        // Must be asked during the click; the browser shows its own prompt.
        const ok = (await chrome.permissions.contains({ origins })) || (await chrome.permissions.request({ origins }).catch(() => false));
        if (!ok) return toast("Prompto needs access to that address to reach ComfyUI");
      }
      db.settings.comfyUrl = base; persist(); toast("Saved " + base); heartbeat(); draw(); break;
    }
    case "export": exportLibrary(); break;
    case "import-cancel": ui.pendingImport = null; draw(); break;
    case "import-merge": {
      const added = mergeLibrary(ui.pendingImport.data);
      ui.pendingImport = null; persist(); draw(); toast(added ? `Added ${added} item${added > 1 ? "s" : ""}` : "Nothing new in that file"); break;
    }
    case "import-replace":
      if (!armed(el, "Press again to replace")) return;
      db = ui.pendingImport.data; ui.pendingImport = null; persist(); draw(); toast("Library replaced"); break;
    case "clear-samples": {
      if (!armed(el, "Press again to remove")) return;
      const before = db.recipes.length + db.characters.length + db.snippets.length + db.inbox.length;
      for (const k of ["inbox", "recipes", "characters", "snippets"]) db[k] = db[k].filter((x) => !SEED_IDS.has(x.id));
      for (const r2 of db.recipes) r2.blocks = r2.blocks.filter((b) => b.type !== "character" || charById(b.ref));
      const gone = before - (db.recipes.length + db.characters.length + db.snippets.length + db.inbox.length);
      persist(); draw(); toast(gone ? `Removed ${gone} sample item${gone > 1 ? "s" : ""}` : "No sample items left"); break;
    }
  }
});

document.addEventListener("change", async (e) => {
  const t = e.target;
  const r = ui.recipeId && recipeById(ui.recipeId);
  if (t.id === "cap-file") return handleFiles([...t.files]);
  if (t.id === "import-file") return t.files[0] && readImport(t.files[0]);
  if (t.id === "tag-file" && t.files[0]) {
    toast("Reading tag list…");
    try { const info = await importTagCsv(t.files[0]); toast(`Loaded ${info.count.toLocaleString()} tags`); }
    catch (err) { toast(err.message || "Couldn't read that CSV"); }
    return draw();
  }
  if (t.dataset.setting) { db.settings[t.dataset.setting] = t.checked; return persist(); }
  if (t.dataset.sheet === "include") { ui.sheet.drafts[t.dataset.d].include = t.checked; const y = window.scrollY; drawImport(); return window.scrollTo(0, y); }
  if (t.dataset.sheet === "snippet") { ui.sheet.snippet = t.checked; return; }
  if (t.dataset.pf) {
    const p = db.profiles[t.dataset.p];
    // Text fields save on input; only checkboxes change the editor's layout.
    if (t.type !== "checkbox") return;
    if (t.dataset.pf === "hasNeg") p.negative = t.checked ? (DEFAULT_PROFILES[p.id] && DEFAULT_PROFILES[p.id].negative) || "" : null;
    else p[t.dataset.pf] = t.checked;
    persist();
    return draw();
  }
  if (t.dataset.act === "outfit") { r.blocks[t.dataset.i].outfit = t.value; return refresh(r); }
  if (t.id === "add-char" && t.value) {
    r.blocks.push({ type: "character", ref: t.value, outfit: Object.keys(charById(t.value).outfits)[0] || "" });
    t.value = "";
    return refresh(r);
  }
  if (t.id === "add-snip" && t.value) {
    const x = db.snippets.find((s) => s.id === t.value);
    if (x.cat === "Negative") r.negative = [r.negative, x.tags.join(", ")].filter(Boolean).join(", ");
    else r.blocks.push({ type: SNIP_BLOCK[x.cat] || "style", tags: x.tags.map((tg) => ({ t: tg, w: 1 })), prose: x.prose });
    toast("Inserted " + x.name);
    return x.cat === "Negative" ? (persist(), drawRecipe()) : refresh(r);
  }
  if (t.dataset.s) {
    const s = r.settings, v = t.value.trim();
    if (t.dataset.s === "loras") s.loras = v ? v.split(",").map((p) => { const [name, w] = p.trim().split(/:(?=[\d.]+$)/); return { name, w: Number(w || 1) }; }) : [];
    else if (t.dataset.s === "size") { const [w, h] = v.split(/[x×]/).map(Number); s.width = w || undefined; s.height = h || undefined; }
    else s[t.dataset.s] = ["steps", "cfg", "seed"].includes(t.dataset.s) && v !== "" ? Number(v) : v;
    persist(); drawOutput(r);
  }
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "q") { ui.q = t.value; return draw(); }
  const r = ui.recipeId && recipeById(ui.recipeId);
  if (t.dataset.sheet === "name") { ui.sheet.drafts[t.dataset.d].name = t.value; return; }
  if (t.dataset.sheet === "outfit") { ui.sheet.drafts[t.dataset.d].outfitName = t.value; return; }
  if (t.id === "title") { r.title = t.value; return persist(); }
  if (t.id === "neg") { r.negative = t.value; persist(); return drawOutput(r); }
  if (t.classList.contains("prose") && t.dataset.i != null) { r.blocks[t.dataset.i].prose = t.value; persist(); return drawOutput(r); }
  if (t.dataset.pf && t.type !== "checkbox") { db.profiles[t.dataset.p][t.dataset.pf] = t.value; return persist(); }
  if (t.dataset.cf) {
    const c = charById(t.dataset.c);
    if (t.dataset.cf === "outfit-prose") c.outfits[t.dataset.o].prose = t.value;
    else c[t.dataset.cf] = t.value;
    persist();
  }
});

document.addEventListener("keydown", (e) => {
  const t = e.target;
  if (t.id === "cap-text" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); return $('[data-act="capture"]').click(); }
  if (t.classList.contains("chip-add") && e.key === "Enter") {
    e.preventDefault();
    const v = t.value.trim();
    if (!v) return;
    if (t.dataset.i != null) {
      const r = recipeById(ui.recipeId);
      r.blocks[t.dataset.i].tags.push(...parseTags(v));
      const sel = `.chip-add[data-i="${t.dataset.i}"]`;
      refresh(r); $(sel)?.focus();
    } else if (t.dataset.path) {
      const list = listTarget(t.dataset.path);
      for (const x of parseTags(v)) if (!list.includes(x.t)) list.push(x.t);
      ui.focus = `.chip-add[data-path="${CSS.escape(t.dataset.path)}"]`; persist(); draw();
    } else if (t.dataset.newOutfit) {
      charById(t.dataset.newOutfit).outfits[v.toLowerCase()] = { tags: [], prose: "" };
      persist(); draw();
    }
    return;
  }
  if (t.classList.contains("chip-add") && e.key === "Backspace" && !t.value && t.dataset.i != null) {
    const r = recipeById(ui.recipeId);
    r.blocks[t.dataset.i].tags.pop();
    const sel = `.chip-add[data-i="${t.dataset.i}"]`;
    refresh(r); $(sel)?.focus();
    return;
  }
  if (t.classList.contains("chip") && t.classList.contains("edit")) {
    const delta = { "+": 0.1, "=": 0.1, "-": -0.1, "_": -0.1 }[e.key];
    if (delta) { e.preventDefault(); return weigh(t, delta); }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); return t.click(); }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); return t.querySelector("button").click(); }
  }
});

function weigh(chipEl, delta) {
  const r = recipeById(ui.recipeId);
  const x = r.blocks[chipEl.dataset.i].tags[chipEl.dataset.j];
  x.w = Math.min(2, Math.max(0.1, Math.round(((x.w ?? 1) + delta) * 10) / 10));
  const sel = `.chip.edit[data-i="${chipEl.dataset.i}"][data-j="${chipEl.dataset.j}"]`;
  refresh(r);
  $(sel)?.focus({ preventScroll: true });
}
document.addEventListener("wheel", (e) => {
  const c = e.target.closest(".chip.edit");
  if (!c) return;
  e.preventDefault();
  weigh(c, e.deltaY < 0 ? 0.1 : -0.1);
}, { passive: false });

// Card sheen follows the pointer, as on the reference tickets.
document.addEventListener("pointermove", (e) => {
  const tk = e.target.closest && e.target.closest(".tk");
  if (!tk) return;
  const b = tk.getBoundingClientRect();
  tk.style.setProperty("--mx", ((e.clientX - b.left) / b.width) * 100 + "%");
  tk.style.setProperty("--my", ((e.clientY - b.top) / b.height) * 100 + "%");
});

// PNG (or library JSON) drop, anywhere on the panel
const veil = $("#drop-veil");
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
document.addEventListener("dragenter", (e) => { if (hasFiles(e)) { dragDepth++; veil.classList.add("on"); } });
document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; veil.classList.remove("on"); } });
document.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; veil.classList.remove("on");
  handleFiles([...e.dataTransfer.files]);
});

// ---------- Captures from the background worker ----------
async function drainCaptures() {
  if (!hasChrome) return;
  const { captures = [] } = await chrome.storage.local.get("captures");
  if (!captures.length) return;
  for (const c of captures) db.inbox.unshift(c);
  await chrome.storage.local.set({ captures: [] });
  persist();
  // The Danbooru button asks for its post to open straight in the import sheet.
  const opener = captures.filter((c) => c.openSheet).pop();
  if (opener) return go("import/" + opener.id);
  if (ui.tab === "inbox" && !ui.recipeId && !ui.importId) draw();
  else $("#count-inbox").textContent = db.inbox.length;
  toast(captures.length === 1 ? "New capture in inbox" : captures.length + " new captures");
}

// ---------- Boot ----------
(async () => {
  db = migrate((await store.load()) || structuredClone(SEED));
  await store.save(db);
  await Promise.all([drainCaptures(), loadTagList()]);
  if (hasChrome) chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.captures) drainCaptures(); });
  window.addEventListener("hashchange", route);
  route();
  heartbeat();
  setInterval(heartbeat, 8000);
})();
