import { DEFAULT_PROFILES, STOCKS, huesOf, BLOCK_TYPES, render, draftProse, loraBase, estimateClipTokens, lint, toA1111, looksLikeTags, parseTags } from "./lib/render.js";
import { DEFAULT_TEMPLATES, SLOT_HELP, proseFromTags } from "./lib/prose.js";
import { readRecipeFromFile, parseComfy } from "./lib/pngmeta.js";
import { fromMeta as toRecipe1 } from "./lib/recipe1.js";
import { SEED } from "./lib/seed.js";
import { loadTagList, importTagCsv, clearTagList, tagListInfo, searchLocal, libraryTags, searchLibrary, searchDanbooru } from "./lib/tags.js";
import { attachAutocomplete } from "./lib/autocomplete.js";
import { tagDiff, wordDiff, settingsDiff, changed } from "./lib/diff.js";
import { cardPng, asciiJson } from "./lib/card.js";
import { detect as detectForeign, convert as convertForeign } from "./lib/importers.js";
import { stamp, fingerprints, merge as mergeSync, toSyncFile, fromSyncFile, apply as applySync } from "./lib/sync.js";
import * as syncfs from "./lib/syncfs.js";
import { hasWildcards, wildcardNames, expand, seededRandom, slug } from "./lib/wildcards.js";
import { fetchLook, draftCharacter, postFromGroups, sceneTags } from "./lib/booru.js";
import { DEFAULT_COMFY, normalizeBase, originPattern, ping, findTabs, queueGraph, applyInTab, bridgeCall, fetchLoras, queueInTab } from "./lib/comfy.js";

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
  sync: { handle: null, state: "off", at: 0, error: "", busy: false, timer: 0 },
  rolls: {}, comparing: false, cmpPick: [], refPick: null, pendingForeign: null, folder: "all", picking: false, picked: new Set(), renamingFolder: null, tab: "inbox", recipeId: null, openChar: null, openProfile: null, q: "", filter: "all", sort: "new", lightbox: null, diffId: null,
  importId: null, sheet: null,
  comfyLive: false, comfyTab: null, bridge: null, syncedRev: -1, focus: null, pendingImport: null, rev: 0
};
let saveTimer;
const persist = () => {
  ui.rev++;
  clearTimeout(saveTimer); saveTimer = setTimeout(() => store.save(db), 250);
  if (ui.sync.state === "on") { clearTimeout(ui.sync.timer); ui.sync.timer = setTimeout(() => syncNow("change"), 4000); }
};

// Brings any saved library (or an imported file) up to the current shape.
function migrate(d) {
  for (const k of ["inbox", "recipes", "characters", "snippets"]) if (!Array.isArray(d[k])) d[k] = [];
  if (!d.profiles || !Object.keys(d.profiles).length) d.profiles = structuredClone(DEFAULT_PROFILES);
  d.settings = { comfyUrl: DEFAULT_COMFY, onlineTags: true, proseTemplates: {}, autoResults: true, deviceName: "", ...(d.settings || {}) };
  if (!d.settings.deviceName) d.settings.deviceName = "Device " + Math.random().toString(36).slice(2, 6).toUpperCase();
  if (!Array.isArray(d.tombstones)) d.tombstones = [];
  if (!Array.isArray(d.recentSends)) d.recentSends = [];
  if (!Array.isArray(d.folders)) d.folders = [];
  for (const r of d.recipes) { if (!Array.isArray(r.runs)) r.runs = []; if (!Array.isArray(r.versions)) r.versions = []; }
  for (const c of d.characters) {
    c.appearance = c.appearance || []; c.outfits = c.outfits || {};
    if (!Array.isArray(c.refs)) c.refs = c.image ? [{ id: "ref_" + c.id, src: c.image, note: "", outfit: null, at: Date.now() }] : [];
  }
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
  ui.recipeId = null; ui.importId = null; ui.lightbox = null; ui.diffId = null; ui.comparing = false; ui.cmpPick = []; drawLightbox();
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
    label = item.format === "Civitai" ? "Civitai" : "Recipe · " + item.format;
    const s = item.meta.settings;
    body = `${item.thumb ? `<img class="slip-thumb" src="${esc(item.thumb)}" alt="">` : ""}
      <p class="slip-text">${esc(item.meta.positive || "(no prompt text found)")}</p>
      <p class="kv" style="margin-top:6px">${esc([s.model, s.sampler, s.steps && s.steps + " steps", s.seed != null && "seed " + s.seed].filter(Boolean).join(" · "))}</p>`;
    const match = matchRecipe(item.meta.positive);
    if (match) body += `<p class="slip-match">Same prompt as <b>${esc(match.title)}</b></p>`;
    files = match && item.thumb ? [["results", "Results"], ["recipe", "Recipe"]] : [["recipe", "Recipe"]];
  } else if (item.kind === "card") {
    label = "Prompto card";
    const d = item.data;
    const what = d.kind === "cast" ? `Cast · ${d.character.name}` : `Recipe · ${d.recipe.title}`;
    body = `${item.thumb ? `<img class="slip-thumb card" src="${esc(item.thumb)}" alt="">` : ""}<p class="slip-text">${esc(what)}</p>
      ${d.kind === "recipe" && d.cast && d.cast.length ? `<p class="kv" style="margin-top:4px">with ${esc(d.cast.map((c) => c.name).join(", "))}</p>` : ""}`;
    files = [["card", "Import"]];
  } else if (item.kind === "image") {
    body = `<img class="slip-thumb" src="${esc(item.image)}" alt="">${item.note ? `<p class="hint" style="margin-top:6px">${esc(item.note)}</p>` : ""}`;
    files = db.characters.length ? [["recipe", "Recipe"], ["reference", "Reference…"]] : [["recipe", "Recipe"]];
    if (ui.refPick === item.id) {
      body += `<div class="ref-pick"><select data-ref-pick="${item.id}" aria-label="Cast member and outfit">${db.characters.map((c) =>
        `<option value="${c.id}|">${esc(c.name)}</option>${Object.keys(c.outfits).map((o) => `<option value="${c.id}|${esc(o)}">${esc(c.name)} · ${esc(o)}</option>`).join("")}`).join("")}</select>
        <button class="btn sm" data-act="ref-file" data-id="${item.id}">Add reference</button></div>`;
    }
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
  if (as === "card") return importCard(item);
  if (as === "reference") { ui.refPick = ui.refPick === id ? null : id; return draw(); }
  if (as === "results") {
    const r = matchRecipe(item.meta.positive);
    if (!r) return toast("No recipe has this prompt any more");
    addRun(r, { thumb: item.thumb, seed: item.meta.settings.seed, source: item.source || "PNG", filename: item.title, positive: item.meta.positive });
    done();
    toast("Added to " + r.title + "'s results");
    return go("recipe/" + r.id);
  }
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
const SITE_NAMES = { "danbooru.donmai.us": "Danbooru", "safebooru.donmai.us": "Danbooru", "gelbooru.com": "Gelbooru", "safebooru.org": "Safebooru", "e621.net": "e621", "e926.net": "e926" };
function siteName(post) {
  let host = post.site || "";
  try { host = host || new URL(post.url).hostname; } catch {}
  return SITE_NAMES[host.replace(/^www\./, "")] || "Booru post";
}
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
        <div class="row"><span class="tag">${esc(siteName(post))}${post.id ? " #" + post.id : ""}</span><span class="slip-src">${esc(post.artists.join(", "))}</span></div>
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
      if (post.preview) addRef(target, post.preview, outfit.length ? Object.keys(target.outfits).pop() : null, post.url || "");
      ids.push(target.id);
    } else {
      const c = {
        id: uid("chr"), name: d.name.trim() || titleCase(d.tag), series: d.series, trigger: d.tag, lora: null,
        appearance, prose: "", outfits: outfit.length ? { [outfitName]: { tags: outfit, prose: "" } } : {},
        notes: post.url ? "From " + post.url : "", image: post.preview || null,
        refs: post.preview ? [{ id: uid("ref"), src: post.preview, note: post.url || "", outfit: null, at: Date.now() }] : []
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
  const json = files.find((f) => f.type === "application/json" || /\.(json|csv)$/i.test(f.name));
  if (json) return readImport(json);
  let read = 0, saved = 0;
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const meta = await readRecipeFromFile(file).catch(() => null); // PNG chunks, or JPEG/WebP EXIF
    const thumb = await makeThumb(file);
    saved++;
    if (meta && meta.format === "prompto" && meta.data && meta.data.app === "prompto") {
      db.inbox.unshift({ id: uid("in"), kind: "card", data: meta.data, title: file.name, source: file.name, createdAt: Date.now(), thumb });
      read++;
    } else if (meta && meta.format !== "none") {
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
  return `<a class="tk${ui.picked.has(r.id) ? " picked" : ""}" href="#recipe/${r.id}" style="${huesOf(p)};--stub:58px" draggable="true" data-recipe="${r.id}">
    ${ui.picking ? `<span class="pick-box" aria-hidden="true">${ui.picked.has(r.id) ? "✓" : ""}</span>` : ""}
    <div class="tk-bg"><span class="tk-mark">${pad(r.no, 2)}</span></div>
    <div class="tk-head"><span class="tag">${esc(p.label)}</span><span class="num">No. <b>${pad(r.no)}</b>${r.fav ? " ✦" : ""}</span></div>
    <h3 class="tk-title">${esc(r.title)}</h3>
    <div class="visual">${r.image ? `<img src="${esc(r.image)}" alt="">` : orbs(r.id)}</div>
    <div class="tk-tear"></div>
    <div class="tk-stub">
      <div><p>${(r.runs || []).length ? `${avgRating(r) ? stars(avgRating(r)) : "unrated"} · ${r.runs.length} result${r.runs.length > 1 ? "s" : ""}` : `${s.width ? s.width + "×" + s.height : "—"} · ${s.steps || "—"} steps`}</p><p class="mono">seed ${s.seed ?? "—"}</p></div>
      <div class="barcode-wrap">${barcode(r.id)}</div>
    </div>
  </a>`;
}

// ---------- Folders ----------
const folderById = (id) => db.folders.find((f) => f.id === id);
const inFolder = (r, f) => f === "all" || (f === "unfiled" ? !folderById(r.folder) : r.folder === f);

function folderRow() {
  const count = (f) => db.recipes.filter((r) => inFolder(r, f)).length;
  const chip = (id, label) => `<button class="folder${ui.folder === id ? " on" : ""}" data-act="folder" data-f="${esc(id)}" data-drop-folder="${esc(id)}" aria-pressed="${ui.folder === id}">${esc(label)}<b>${count(id)}</b></button>`;
  const cur = folderById(ui.folder);
  return `<div class="folders" role="group" aria-label="Folders">
      ${chip("all", "All")}${chip("unfiled", "Unfiled")}${db.folders.map((f) => chip(f.id, f.name)).join("")}
      <button class="folder add" data-act="folder-new" aria-label="New folder">+ Folder</button>
    </div>
    ${cur ? `<div class="folder-tools">
      ${ui.renamingFolder === cur.id ? `<input class="folder-name" id="folder-name" value="${esc(cur.name)}" aria-label="Folder name" spellcheck="false"><button class="link" data-act="folder-rename-save">Save</button>`
        : `<span class="kv">${esc(cur.name)}</span><button class="link" data-act="folder-rename">Rename</button>`}
      <button class="link" data-act="folder-del">Delete folder</button></div>` : ""}`;
}

function moveToFolder(ids, folder) {
  for (const r of db.recipes) if (ids.has(r.id)) r.folder = folder === "unfiled" ? null : folder;
  persist();
}

function drawRecipes() {
  if (ui.filter !== "all" && ui.filter !== "fav" && !db.profiles[ui.filter]) ui.filter = "all";
  if (ui.folder !== "all" && ui.folder !== "unfiled" && !folderById(ui.folder)) ui.folder = "all";
  const list = db.recipes.filter((r) => inFolder(r, ui.folder) && (ui.filter === "all" || ui.filter === r.profile || (ui.filter === "fav" && r.fav)) &&
    matches(ui.q, r.title, render(r, profileOf(r), db).positive));
  const SORTS = { new: (a, b) => b.createdAt - a.createdAt, rated: (a, b) => avgRating(b) - avgRating(a) || b.createdAt - a.createdAt, runs: (a, b) => (b.runs || []).length - (a.runs || []).length };
  list.sort(SORTS[ui.sort] || SORTS.new);
  const f = (id, label) => `<button class="fchip" data-act="filter" data-f="${esc(id)}" aria-pressed="${ui.filter === id}">${esc(label)}</button>`;
  view.innerHTML = `
    ${folderRow()}
    <div class="spread">
      <div class="filters">${f("all", "All")}${f("fav", "✦")}${Object.values(db.profiles).map((p) => f(p.id, p.label)).join("")}</div>
      <button class="btn sm" data-act="new-recipe">New <i aria-hidden="true">→</i></button>
    </div>
    <div class="sec">Recipes<span class="aside"><button class="link" data-act="pick-toggle">${ui.picking ? "Done" : "Select"}</button> · ${list.length} of ${db.recipes.length} ·
      <select id="sort" aria-label="Sort recipes">${[["new", "Newest"], ["rated", "Top rated"], ["runs", "Most results"]].map(([v, l]) => `<option value="${v}" ${ui.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select></span></div>
    ${list.length ? `<div class="grid${ui.picking ? " picking" : ""}">${list.map(recipeTicket).join("")}</div>`
      : `<div class="empty"><h3>No <span class="holo-text">match</span></h3><p>${ui.folder !== "all" ? "Nothing in this folder yet. Drag a recipe onto it, or pick it in the recipe." : "Try another filter, or file something from the inbox."}</p></div>`}
    ${ui.picking ? `<div class="bulk-bar" role="toolbar" aria-label="Selected recipes">
      <span><b>${ui.picked.size}</b> selected</span>
      <select id="bulk-folder" aria-label="Move to folder"><option value="">Move to…</option><option value="unfiled">Unfiled</option>${db.folders.map((fo) => `<option value="${fo.id}">${esc(fo.name)}</option>`).join("")}</select>
      <button class="link" data-act="bulk-star">Star</button>
      <button class="link" data-act="bulk-del">Delete</button>
    </div>` : ""}`;
}

const isWeighted = (w) => Math.abs((w ?? 1) - 1) > 0.001;
function chip(x, i, j) {
  const w = x.w ?? 1;
  return `<span class="chip edit${isWeighted(w) ? " weighted" : ""}${x.off ? " off" : ""}" tabindex="0" data-i="${i}" data-j="${j}"
    title="Click to mute. Scroll or press + and − to weight.">${esc(x.t)}${isWeighted(w) ? `<span class="w">${w.toFixed(1)}</span>` : ""}<button data-act="tag-del" aria-label="Remove ${esc(x.t)}">×</button></span>`;
}

function blockHtml(b, i) {
  const tools = `<div class="tools">
    ${b.type !== "character" && b.tags.length ? `<button data-act="block-draft" data-i="${i}" title="Write prose from this block's tags">${b.prose ? "Redraft" : "Write"}</button>` : ""}
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
    <textarea class="prose" data-i="${i}" rows="1" placeholder="${esc(draftProse(b, db) || "Prose for natural-language models")}">${esc(b.prose)}</textarea>
  </div>`;
}

function drawBlocks(r) {
  $("#blocks").innerHTML = r.blocks.length ? r.blocks.map(blockHtml).join("")
    : `<p class="hint" style="padding:10px 0">No blocks yet. Add a subject, a cast member or a snippet below.</p>`;
}

function drawOutput(r) {
  const p = profileOf(r);
  const out = finalOut(r);
  const issues = lint(r, p, db);
  for (const n of new Set(wildcardNames(out.template + " " + (out.negative || "")))) if (!wildcardEntries(n)) issues.push(`__${n}__ doesn't match a snippet or snippet category`);
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
    ${out.wild ? `<div class="wild-bar"><span class="kv">Wildcards · roll ${rollOf(r)}</span><button class="link" data-act="roll" data-d="-1" ${rollOf(r) > 1 ? "" : "hidden"}>← Back</button><button class="link" data-act="roll" data-d="1">Roll again</button><button class="link" data-act="copy-raw" title="Keep {a|b} and __name__ for Dynamic Prompts">Copy with wildcards</button></div>` : ""}
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
    ${out.wild ? `<div class="actions" style="margin-top:6px"><button class="btn ghost sm" data-act="queue-variants" title="Loads and queues several rolls on the same seed">Queue variants</button>
      <select id="variant-count" aria-label="How many variants">${[2, 3, 4, 6].map((n) => `<option ${n === 3 ? "selected" : ""}>${n}</option>`).join("")}</select></div>` : ""}
  </section>`;
}

function drawRecipe() {
  const r = recipeById(ui.recipeId);
  const p = profileOf(r);
  const s = r.settings;
  const field = (k, label, val, cls = "") => `<label class="${cls}">${label}<input data-s="${k}" value="${esc(val ?? "")}" spellcheck="false"></label>`;
  view.innerHTML = `
    <div class="backbar">
      <a class="link" href="#recipes">← Recipes</a>
      <div class="row">
        <button class="link" data-act="fav">${r.fav ? "Unstar" : "Star"}</button>
        <button class="link" data-act="share-recipe" title="Save this recipe as a PNG card others can drop on Prompto, Forge or ComfyUI">Share card</button>
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
      <label class="recipe-folder">Folder <select id="recipe-folder"><option value="">Unfiled</option>${db.folders.map((fo) => `<option value="${fo.id}" ${r.folder === fo.id ? "selected" : ""}>${esc(fo.name)}</option>`).join("")}</select></label>
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
    <div id="results">${resultsHtml(r)}</div>
    <div id="versions">${versionsHtml(r)}</div>

    <section class="tk settings" style="--stub:0px">
      <div class="tk-bg"></div>
      <div class="tk-head"><span class="tag">Settings</span><span class="kv">${r.comfy ? "ComfyUI graph attached" : "No ComfyUI graph"}</span></div>
      <div class="settings-grid">
        ${field("model", "Model", s.model, "full")}
        <div class="full" id="lora-edit">${loraRows(r)}</div>
        ${field("sampler", "Sampler", s.sampler)}${field("scheduler", "Scheduler", s.scheduler)}
        ${field("steps", "Steps", s.steps)}${field("cfg", "CFG", s.cfg)}
        ${field("seed", "Seed", s.seed)}${field("size", "Size", s.width ? s.width + "x" + s.height : "")}
      </div>
      <div class="spread" style="margin-top:12px"><span class="kv">Created ${ago(r.createdAt)}</span><div class="barcode-wrap">${barcode(r.id, 96)}</div></div>
    </section>`;
  drawBlocks(r);
  drawOutput(r);
}

const drawVersions = (r) => { const el = $("#versions"); if (el) el.innerHTML = versionsHtml(r); };
const refresh = (r) => { persist(); drawBlocks(r); drawOutput(r); if (ui.diffId) drawVersions(r); };

// ---------- LoRAs ----------
function addLora(r, name, w) {
  name = String(name || "").trim();
  if (!name) return;
  const weight = w === undefined || w === "" ? 1 : Number(w);
  r.settings.loras = r.settings.loras || [];
  const hit = r.settings.loras.find((l) => loraBase(l.name) === loraBase(name));
  if (hit) hit.w = weight; else r.settings.loras.push({ name, w: weight });
  toast(`LoRA ${loraLabel(name)} at ${weight}`);
}

// For showing: file name without folders or extension, original case.
const loraLabel = (v) => String(v || "").split(/[\\/]/).pop().replace(/\.(safetensors|ckpt|pt|bin)$/i, "");

function loraRows(r) {
  const installed = db.settings.loraList && db.settings.loraList.names;
  const have = installed && new Set(installed.map(loraBase));
  const rows = (r.settings.loras || []).map((l, j) => {
    const missing = have && !have.has(loraBase(l.name));
    return `<div class="lora-row${missing ? " missing" : ""}">
      <span class="lora-name" title="${esc(l.name)}${missing ? " (not in ComfyUI's loras folder)" : ""}">${missing ? "⚠ " : ""}${esc(loraLabel(l.name))}</span>
      <input type="range" min="0" max="2" step="0.05" value="${l.w}" data-lora-w="${j}" aria-label="Weight for ${esc(loraLabel(l.name))}">
      <input class="lora-num" type="number" min="-2" max="3" step="0.05" value="${l.w}" data-lora-w="${j}" aria-label="Weight">
      <button data-act="lora-del" data-j="${j}" aria-label="Remove ${esc(loraLabel(l.name))}">×</button>
    </div>`;
  }).join("");
  return `<span class="lora-label">LoRAs</span>${rows}<input class="lora-add" placeholder="${installed ? `+ LoRA (${installed.length} installed)` : "+ LoRA name"}" aria-label="Add a LoRA" spellcheck="false">`;
}

// LoRA names from ComfyUI, plus any already used in the library.
function loraSuggestions(q, plain) {
  const needle = q.replace(/^<(lora:)?/i, "").toLowerCase();
  const names = new Map();
  for (const n of (db.settings.loraList && db.settings.loraList.names) || []) names.set(loraBase(n), n);
  for (const r of db.recipes) for (const l of r.settings.loras || []) if (!names.has(loraBase(l.name))) names.set(loraBase(l.name), l.name);
  for (const c of db.characters) if (c.lora && !names.has(loraBase(c.lora.name))) names.set(loraBase(c.lora.name), c.lora.name);
  return [...names].filter(([b]) => !needle || b.includes(needle)).sort(([a], [b]) => (b.startsWith(needle) - a.startsWith(needle)) || a.localeCompare(b)).slice(0, 8)
    .map(([b, full]) => {
      const folder = String(full).split(/[\\/]/).slice(0, -1).join("/");
      return { name: loraLabel(full), insert: plain ? full : `<lora:${full}:1>`, cat: "lora", count: folder, source: "lora" };
    });
}

// ---------- Results (generation history) ----------
// Prompts are compared loosely: case, spacing, escaped brackets and trailing
// punctuation don't stop a match.
const promptKey = (t) => String(t || "").replace(/\\([()])/g, "$1").toLowerCase().replace(/\s+/g, " ").replace(/[\s,.]+$/, "").trim();

// Remember what was just sent out, so an image made from it finds its recipe.
function noteSend(r, positive, reason = "sent") {
  const key = promptKey(positive);
  db.recentSends = [{ recipeId: r.id, key, at: Date.now() }, ...db.recentSends.filter((x) => x.key !== key)].slice(0, 40);
  saveVersion(r, reason);
  persist();
}

// ---------- Wildcards ----------
// __name__ matches a snippet by name (one of its tags) or a category (one of its snippets).
function wildcardEntries(name) {
  const n = slug(name);
  const one = db.snippets.find((x) => slug(x.name) === n);
  if (one) return one.tags.length ? one.tags : one.prose ? [one.prose] : null;
  const cat = db.snippets.filter((x) => slug(x.cat) === n);
  return cat.length ? cat.map((x) => (x.tags.length ? x.tags.join(", ") : x.prose)).filter(Boolean) : null;
}
const rollOf = (r) => ui.rolls[r.id] || 1;
const expandText = (r, text, part, roll = rollOf(r)) => expand(text, seededRandom(`${r.id}:${roll}:${part}`), wildcardEntries);

// The prompt as it leaves Prompto: rendered, then wildcards rolled.
function finalOut(r, roll = rollOf(r)) {
  const out = render(r, profileOf(r), db);
  const wild = hasWildcards(out.positive) || hasWildcards(out.negative || "");
  return {
    ...out, wild, template: out.positive,
    positive: wild ? expandText(r, out.positive, "pos", roll) : out.positive,
    negative: out.negative != null && wild ? expandText(r, out.negative, "neg", roll) : out.negative
  };
}

// ---------- Share cards ----------
const stripCast = (c) => ({ ...structuredClone({ ...c, refs: [], image: null }) });
const fileSlug = (s) => slug(s) || "prompto";

function downloadBytes(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function shareRecipe(r) {
  const p = profileOf(r);
  const out = finalOut(r);
  const s = r.settings;
  const cast = r.blocks.filter((b) => b.type === "character" && charById(b.ref)).map((b) => stripCast(charById(b.ref)));
  const recipe = structuredClone({ ...r, runs: [], versions: [], image: null, coverId: null });
  const payload = { app: "prompto", kind: "recipe", version: 1, recipe, cast, profile: p };
  // A recipe with a ComfyUI graph also opens in ComfyUI.
  let graph = null;
  if (r.comfy && r.comfy.pos) {
    graph = structuredClone(r.comfy.graph);
    graph[r.comfy.pos.id].inputs[r.comfy.pos.key] = out.positive;
    if (r.comfy.neg && out.negative != null) graph[r.comfy.neg.id].inputs[r.comfy.neg.key] = out.negative;
  }
  const bytes = await cardPng({
    tag: p.label, no: "No. " + pad(r.no), mark: pad(r.no, 2), title: r.title, cover: r.image, stock: huesOf(p), seed: r.id,
    lines: [{ label: "Positive", text: out.positive, max: 10 }, ...(out.negative ? [{ label: "Negative", text: out.negative, max: 3 }] : [])],
    footer: [s.width && `${s.width}×${s.height}`, s.steps && `${s.steps} steps`, s.cfg != null && `CFG ${s.cfg}`, s.seed != null && `seed ${s.seed}`, (s.loras || []).length && `${s.loras.length} LoRA${s.loras.length > 1 ? "s" : ""}`].filter(Boolean).join(" · ")
  }, {
    prompto: asciiJson(payload),
    parameters: toA1111(r, p, db, (t, part) => (hasWildcards(t) ? expandText(r, t, part) : t)),
    prompt: graph ? asciiJson(graph) : null,
    // The shared recipe format, with exact model references (Model Librarian reads it)
    recipe: asciiJson(toRecipe1(r, { positive: out.positive, negative: out.negative, title: r.title }))
  });
  downloadBytes(bytes, `${fileSlug(r.title)}.prompto.png`);
  toast("Card saved");
}

async function shareCast(c) {
  const outfits = Object.entries(c.outfits);
  const bytes = await cardPng({
    tag: c.series || "Cast", no: c.trigger ? "trigger " + c.trigger : "", mark: initials(c.name), title: c.name, cover: c.image, stock: "", seed: c.id,
    lines: [
      { label: "Appearance", text: c.appearance.join(", "), max: 4 },
      ...outfits.slice(0, 3).map(([o, v]) => ({ label: "Outfit · " + o, text: v.tags.join(", "), max: 2 })),
      ...(c.prose ? [{ label: "Prose", text: c.prose, max: 3 }] : [])
    ],
    footer: [c.lora && `LoRA ${loraLabel(c.lora.name)} at ${c.lora.w}`, outfits.length && `${outfits.length} outfit${outfits.length > 1 ? "s" : ""}`].filter(Boolean).join(" · ") || "Reusable character"
  }, { prompto: asciiJson({ app: "prompto", kind: "cast", version: 1, character: stripCast(c) }) });
  downloadBytes(bytes, `${fileSlug(c.name)}.prompto.png`);
  toast("Card saved");
}

// Adds a card's cast member, or merges it into the one with the same trigger.
function mergeCast(incoming) {
  const existing = (incoming.trigger && castByTrigger(incoming.trigger)) || db.characters.find((c) => c.name === incoming.name);
  if (existing) {
    for (const t of incoming.appearance || []) if (!existing.appearance.includes(t)) existing.appearance.push(t);
    for (const [o, v] of Object.entries(incoming.outfits || {})) if (!existing.outfits[o]) existing.outfits[o] = v;
    if (!existing.prose && incoming.prose) existing.prose = incoming.prose;
    if (!existing.lora && incoming.lora) existing.lora = incoming.lora;
    return existing.id;
  }
  const c = { ...incoming, id: uid("chr"), refs: [], image: null };
  db.characters.unshift(c);
  return c.id;
}

function importCard(item) {
  const d = item.data;
  const done = () => { db.inbox = db.inbox.filter((x) => x.id !== item.id); persist(); };
  if (d.kind === "cast") {
    const id = mergeCast(d.character);
    done(); toast("Added to cast"); return go("cast/" + id);
  }
  if (d.profile && !db.profiles[d.profile.id]) db.profiles[d.profile.id] = d.profile;
  const map = {};
  for (const c of d.cast || []) map[c.id] = mergeCast(c);
  const r = { ...structuredClone(d.recipe), id: uid("rec"), no: db.nextNo++, createdAt: Date.now(), runs: [], versions: [], image: null, coverId: null };
  if (!db.profiles[r.profile]) r.profile = Object.keys(db.profiles)[0];
  for (const b of r.blocks) if (b.type === "character" && map[b.ref]) b.ref = map[b.ref];
  db.recipes.unshift(r);
  done(); toast("Recipe imported");
  go("recipe/" + r.id);
}

// ---------- Sync between devices ----------
// Read the shared file, merge it with this library item by item, write the
// result back. Runs a few seconds after changes and every minute.
async function syncNow(reason = "manual") {
  const s = ui.sync;
  if (!s.handle || s.busy) return;
  s.busy = true;
  try {
    db.syncHashes = stamp(db, db.syncHashes || {});
    const remote = fromSyncFile(await syncfs.readSync(s.handle));
    let changed = false;
    if (remote) {
      const before = fingerprints(db);
      applySync(db, mergeSync(db, remote));
      const after = fingerprints(db);
      changed = Object.keys({ ...before, ...after }).some((k) => before[k] !== after[k]);
    }
    await syncfs.writeSync(s.handle, toSyncFile(db, db.settings.deviceName));
    db.syncHashes = fingerprints(db);
    s.at = Date.now(); s.state = "on"; s.error = "";
    db.settings.lastSyncAt = s.at;
    await store.save(db);
    if (changed) {
      toast("Synced changes from another device");
      if (!view.contains(document.activeElement) || document.activeElement === document.body) draw();
    } else if (reason === "manual") toast("Synced");
    if (ui.tab === "settings" && !view.contains(document.activeElement)) draw();
  } catch (e) {
    s.error = e && e.name === "NotAllowedError" ? "Prompto lost access to the folder. Reconnect it." : (e && e.message) || "Sync failed";
    s.state = e && e.name === "NotAllowedError" ? "prompt" : "error";
    if (reason === "manual") toast(s.error);
    if (ui.tab === "settings") draw();
  } finally { s.busy = false; }
}

async function startSync(ask) {
  const s = ui.sync;
  if (!s.handle) return;
  const state = await syncfs.permission(s.handle, ask).catch(() => "denied");
  s.state = state === "granted" ? "on" : state;
  if (s.state === "on") await syncNow(ask ? "manual" : "start");
  else if (ui.tab === "settings") draw();
}

function syncCard() {
  const s = ui.sync;
  if (!syncfs.supported()) return `<p class="hint">This browser can't open folders, so sync isn't available here.</p>`;
  const status = !s.handle ? "Not set up"
    : s.state === "on" ? `Synced ${s.at ? ago(s.at) : "—"} · ${esc(s.handle.name)}`
    : s.state === "prompt" ? `Paused · ${esc(s.handle.name)} needs permission again`
    : s.state === "error" ? `Error · ${esc(s.error)}` : "Off";
  return `<section class="tk" style="--stub:0px;padding-bottom:14px">
    <div class="tk-bg"></div>
    <div class="tk-head"><span class="tag">Sync</span><span class="kv">${status}</span></div>
    <p class="hint" style="margin-top:8px">Pick a folder your cloud service keeps in sync (OneDrive, Dropbox, Google Drive). Prompto keeps <span class="mono">prompto-sync.json</span> there and merges it with each device's library: the newer edit wins, and deletions carry over. Each device keeps its own ComfyUI address and LoRA list.</p>
    <div class="settings-grid"><label class="full">This device<input id="device-name" value="${esc(db.settings.deviceName)}" spellcheck="false"></label></div>
    <div class="row" style="margin-top:10px">
      ${!s.handle ? `<button class="btn sm" data-act="sync-choose">Choose sync folder <i aria-hidden="true">→</i></button>`
        : s.state === "prompt" ? `<button class="btn sm" data-act="sync-reconnect">Reconnect folder</button>`
        : `<button class="btn ghost sm" data-act="sync-now">Sync now</button>`}
      ${s.handle ? `<button class="link" data-act="sync-choose">Change folder</button><button class="link" data-act="sync-stop">Stop syncing</button>` : ""}
    </div>
  </section>`;
}

// ---------- Versions ----------
// A snapshot is taken whenever a recipe leaves Prompto (copied, loaded, queued)
// and whenever you press Save version, unless nothing changed since the last one.
const versionBody = (r) => JSON.stringify([r.profile, r.blocks, r.negative, r.settings]);

function saveVersion(r, reason) {
  r.versions = r.versions || [];
  const body = versionBody(r);
  if (r.versions[0] && r.versions[0].body === body) return false;
  const p = profileOf(r);
  const out = render(r, p, db);
  r.versions.unshift({
    id: uid("ver"), at: Date.now(), reason, body, profile: r.profile, profileLabel: p.label, format: p.format,
    positive: out.positive, negative: out.negative, settings: structuredClone(r.settings), blocks: structuredClone(r.blocks), recipeNegative: r.negative
  });
  r.versions = r.versions.slice(0, 30);
  return true;
}

function diffHtml(ops) {
  return ops.map((o) => o.op === "same" ? esc(o.v) : `<span class="d-${o.op}">${esc(o.v)}</span>`).join("");
}

function versionsHtml(r) {
  const vs = r.versions || [];
  const p = profileOf(r);
  const current = render(r, p, db);
  const sel = vs.find((v) => v.id === ui.diffId);
  let diff = "";
  if (sel) {
    const tags = p.format === "tags" && sel.format === "tags";
    const join = (ops, sep) => ops.map((o) => o.op === "same" ? esc(o.v) : `<span class="d-${o.op}">${esc(o.v)}</span>`).join(sep);
    const pos = tags ? join(tagDiff(sel.positive, current.positive), ", ") : diffHtml(wordDiff(sel.positive, current.positive));
    const negOps = wordDiff(sel.negative || "", current.negative || "");
    const sets = settingsDiff(sel.settings, r.settings);
    const vNo = vs.length - vs.indexOf(sel);
    diff = `<section class="tk diff" style="--stub:0px;padding-bottom:14px">
      <div class="tk-bg"></div>
      <div class="tk-head"><span class="tag">v${vNo} → now</span><span class="kv">${esc(sel.profileLabel)}${sel.profile !== r.profile ? " → " + esc(p.label) : ""}</span></div>
      <div class="out-label"><span>Positive</span></div><div class="out-text">${pos || '<span class="hint">empty</span>'}</div>
      ${changed(negOps) ? `<div class="out-label"><span>Negative</span></div><div class="out-text">${diffHtml(negOps)}</div>` : ""}
      ${sets.length ? `<div class="out-label"><span>Settings</span></div><ul class="diff-sets">${sets.map(([k, a, b]) => `<li><span>${esc(k)}</span> <span class="d-del">${esc(a)}</span> → <span class="d-add">${esc(b)}</span></li>`).join("")}</ul>` : ""}
      ${!changed(tagDiff(sel.positive, current.positive)) && !changed(negOps) && !sets.length ? `<p class="hint" style="margin-top:8px">No differences.</p>` : ""}
    </section>`;
  }
  return `<div class="sec">Versions<span class="aside">${vs.length ? vs.length + " saved" : "none yet"} · <button class="link" data-act="ver-save">Save version</button></span></div>
    ${vs.length ? `<ul class="versions">${vs.map((v, i) => `<li class="${v.id === ui.diffId ? "on" : ""}">
        <b>v${vs.length - i}</b><span class="kv">${esc(v.reason)} · ${ago(v.at)}</span>
        <span class="row" style="margin-left:auto"><button class="link" data-act="ver-diff" data-v="${v.id}">${v.id === ui.diffId ? "Hide" : "Compare"}</button><button class="link" data-act="ver-restore" data-v="${v.id}">Restore</button></span>
      </li>`).join("")}</ul>${diff}`
      : `<p class="hint">A version is saved each time you copy, load or queue this recipe, so you can see what changed between runs.</p>`}`;
}

function matchRecipe(positive) {
  const key = promptKey(positive);
  if (!key) return null;
  const sent = db.recentSends.find((x) => x.key === key && Date.now() - x.at < 3 * 864e5);
  if (sent && recipeById(sent.recipeId)) return recipeById(sent.recipeId);
  return db.recipes.find((r) => promptKey(render(r, profileOf(r), db).positive) === key) || null;
}

function addRun(r, run) {
  if (!run.thumb) return false;
  r.runs = r.runs || [];
  if (run.filename && r.runs.some((x) => x.filename === run.filename && x.source === run.source)) return false;
  r.runs.unshift({ id: uid("run"), at: Date.now(), rating: 0, ...run });
  r.runs = r.runs.slice(0, 60);
  if (!r.image) { r.image = run.thumb; r.coverId = r.runs[0].id; }
  return true;
}

const rated = (r) => (r.runs || []).filter((x) => x.rating);
const avgRating = (r) => { const xs = rated(r); return xs.length ? xs.reduce((n, x) => n + x.rating, 0) / xs.length : 0; };
const stars = (n) => "★★★★★".slice(0, Math.round(n)) + "☆☆☆☆☆".slice(0, 5 - Math.round(n));

function starButtons(run, where) {
  return `<span class="stars" role="group" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) =>
    `<button data-act="run-rate" data-run="${run.id}" data-n="${n}" data-where="${where}" aria-label="${n} star${n > 1 ? "s" : ""}" aria-pressed="${run.rating >= n}">${run.rating >= n ? "★" : "☆"}</button>`).join("")}</span>`;
}

function resultsHtml(r) {
  const runs = r.runs || [];
  const avg = avgRating(r);
  const picking = ui.comparing && runs.length > 1;
  return `<div class="sec">Results<span class="aside">${runs.length > 1 ? `<button class="link" data-act="cmp-toggle">${picking ? "Cancel" : "Compare"}</button> · ` : ""}${runs.length ? `${runs.length} · ${avg ? stars(avg) + " " + avg.toFixed(1) : "unrated"}` : "none yet"}</span></div>
    ${picking ? `<div class="cmp-bar"><span class="kv">Pick 2 to 4 results · ${ui.cmpPick.length} picked</span><button class="btn sm" data-act="cmp-open">Side by side <i aria-hidden="true">→</i></button></div>` : ""}
    ${runs.length ? `<div class="runs${picking ? " picking" : ""}">${runs.map((x) => `<figure class="run${r.coverId === x.id ? " is-cover" : ""}${picking && ui.cmpPick.includes(x.id) ? " cmp-on" : ""}">
        <button class="run-img" data-act="${picking ? "cmp-pick" : "run-open"}" data-run="${x.id}" aria-label="${picking ? "Pick for comparison" : "Open result"}"><img src="${esc(x.thumb)}" alt="">${picking && ui.cmpPick.includes(x.id) ? `<span class="cmp-n">${ui.cmpPick.indexOf(x.id) + 1}</span>` : ""}</button>
        <figcaption>${starButtons(x, "grid")}<span class="kv">${ago(x.at)}</span></figcaption>
      </figure>`).join("")}</div>`
      : `<p class="hint">Images made with this recipe land here: ComfyUI-Prompto captures them automatically, or drop a PNG on the panel and choose <b>Results</b> in the inbox.</p>`}`;
}

// Side by side: the first pick is the baseline; the others show which tags they added or dropped.
function drawCompareBox(box, lb) {
  const r = recipeById(lb.recipeId);
  const runs = lb.runIds.map((id) => r && r.runs.find((x) => x.id === id)).filter(Boolean);
  if (runs.length < 2) { ui.lightbox = null; box.hidden = true; box.innerHTML = ""; return; }
  const base = runs[0];
  const chips = (ops, op) => ops.filter((o) => o.op === op).map((o) => `<span class="chip ro d-${op}">${esc(o.v)}</span>`).join("");
  const cell = (x, i) => {
    let diff = "";
    if (i === 0) diff = `<p class="kv">baseline</p>`;
    else if (!x.positive || !base.positive) diff = `<p class="kv">prompt not recorded</p>`;
    else {
      const ops = tagDiff(base.positive, x.positive);
      diff = changed(ops) ? `<div class="chips">${chips(ops, "add")}${chips(ops, "del")}</div>` : `<p class="kv">same prompt</p>`;
    }
    return `<figure class="cmp-cell">
      <img src="${esc(x.thumb)}" alt="">
      <figcaption>
        <div class="spread">${starButtons(x, "compare")}<span class="kv">${x.seed != null ? "seed " + esc(x.seed) : ""}</span></div>
        ${x.seed != null && base.seed != null && i > 0 && String(x.seed) !== String(base.seed) ? `<p class="kv">different seed</p>` : ""}
        ${diff}
      </figcaption>
    </figure>`;
  };
  box.hidden = false;
  box.innerHTML = `<div class="lb-card cmp-card" role="dialog" aria-label="Compare results">
    <div class="cmp-head spread"><b>${esc(r.title)}</b><button class="link" data-act="lb-close">Close</button></div>
    <div class="cmp-grid n${runs.length}">${runs.map(cell).join("")}</div>
    ${base.positive ? `<details class="cmp-prompt"><summary class="kv">Baseline prompt</summary><p class="out-text">${esc(base.positive)}</p></details>` : ""}
  </div>`;
}

function drawRefBox(box, lb) {
  const c = charById(lb.charId);
  const refs = c ? c.refs || [] : [];
  const ref = refs.find((x) => x.id === lb.refId) || refs[0];
  if (!ref) { box.hidden = true; box.innerHTML = ""; return; }
  const i = refs.indexOf(ref);
  box.hidden = false;
  box.innerHTML = `<div class="lb-card" role="dialog" aria-label="Reference">
    <img src="${esc(ref.src)}" alt="">
    <div class="lb-meta">
      <div class="spread"><b>${esc(c.name)}${ref.outfit ? " · " + esc(ref.outfit) : ""}</b><span class="kv">${i + 1} of ${refs.length}</span></div>
      <input class="ref-note" data-ref-note="${ref.id}" data-c="${c.id}" value="${esc(ref.note)}" placeholder="Note or source" spellcheck="false">
      <div class="actions" style="margin-top:8px">
        <button class="btn ghost sm" data-act="ref-cover" data-c="${c.id}" data-ref="${ref.id}">${c.image === ref.src ? "Cover ✓" : "Use as cover"}</button>
        <button class="link" data-act="ref-del" data-c="${c.id}" data-ref="${ref.id}">Remove</button>
      </div>
      <div class="spread" style="margin-top:10px">
        <button class="link" data-act="ref-step" data-d="-1" ${i ? "" : "hidden"}>← Previous</button>
        <button class="link" data-act="lb-close">Close</button>
        <button class="link" data-act="ref-step" data-d="1" ${i < refs.length - 1 ? "" : "hidden"}>Next →</button>
      </div>
    </div>
  </div>`;
}

function drawLightbox() {
  const box = $("#lightbox");
  const lb = ui.lightbox;
  if (lb && lb.kind === "ref") return drawRefBox(box, lb);
  if (lb && lb.kind === "compare") return drawCompareBox(box, lb);
  const r = lb && recipeById(lb.recipeId);
  const run = r && r.runs.find((x) => x.id === lb.runId);
  if (!run) { box.hidden = true; box.innerHTML = ""; return; }
  const i = r.runs.indexOf(run);
  box.hidden = false;
  box.innerHTML = `<div class="lb-card" role="dialog" aria-label="Result">
    <img src="${esc(run.thumb)}" alt="">
    <div class="lb-meta">
      <div class="spread">${starButtons(run, "lightbox")}<span class="kv">${i + 1} of ${r.runs.length}</span></div>
      <p class="kv">${esc([run.source, run.seed != null && "seed " + run.seed, new Date(run.at).toLocaleString()].filter(Boolean).join(" · "))}</p>
      <div class="actions" style="margin-top:8px">
        <button class="btn ghost sm" data-act="run-cover" data-run="${run.id}">${r.coverId === run.id ? "Cover ✓" : "Use as cover"}</button>
        ${run.seed != null ? `<button class="btn ghost sm" data-act="run-seed" data-run="${run.id}">Use seed</button>` : ""}
        <button class="link" data-act="run-del" data-run="${run.id}">Remove</button>
      </div>
      <div class="spread" style="margin-top:10px">
        <button class="link" data-act="run-step" data-d="-1" ${i ? "" : "hidden"}>← Newer</button>
        <button class="link" data-act="lb-close">Close</button>
        <button class="link" data-act="run-step" data-d="1" ${i < r.runs.length - 1 ? "" : "hidden"}>Older →</button>
      </div>
    </div>
  </div>`;
}

// ---------- ComfyUI ----------
const comfyBase = () => db.settings.comfyUrl || DEFAULT_COMFY;
// The tab the heartbeat linked to (it has the bridge), else any ComfyUI tab.
async function comfyTab() {
  const tabs = await findTabs(comfyBase());
  return tabs.find((t) => ui.comfyTab && t.id === ui.comfyTab.id) || tabs[0] || null;
}

async function withComfyTab(payload, okLabel) {
  if (!hasChrome) return toast("Load Prompto as an extension to reach ComfyUI");
  const tab = await comfyTab();
  if (!tab) return toast("Open ComfyUI in a browser tab first");
  try {
    const res = await applyInTab(tab.id, payload);
    toast(res && res.ok ? `${okLabel}: ${res.applied.join(", ")}${res.warnings && res.warnings.length ? ". " + res.warnings.join("; ") : ""}` : (res && res.error) || "ComfyUI didn't respond");
  } catch { toast("Couldn't reach the ComfyUI tab. Check the address in Settings."); }
}

// Loads and queues several wildcard rolls on the same seed, one after another.
async function queueVariants(r, count) {
  if (!hasChrome) return toast("Load Prompto as an extension to reach ComfyUI");
  const tab = await comfyTab();
  if (!tab) return toast("Open ComfyUI in a browser tab first");
  const start = rollOf(r);
  saveVersion(r, `queued ${count} variants`);
  let queued = 0;
  for (let i = 0; i < count; i++) {
    const out = finalOut(r, start + i);
    const key = promptKey(out.positive);
    db.recentSends = [{ recipeId: r.id, key, at: Date.now() }, ...db.recentSends.filter((x) => x.key !== key)].slice(0, 40);
    try {
      const res = await applyInTab(tab.id, { mode: "recipe", positive: out.positive, negative: out.negative, settings: r.settings });
      if (!res || !res.ok) { toast((res && res.error) || "ComfyUI didn't respond"); break; }
      const q = await queueInTab(tab.id);
      if (!q || !q.ok) { toast((q && q.error) || "ComfyUI didn't queue it"); break; }
      queued++;
    } catch { toast("Couldn't reach the ComfyUI tab"); break; }
  }
  ui.rolls[r.id] = start + queued;
  persist(); drawOutput(r); drawVersions(r);
  if (queued) toast(`Queued ${queued} variant${queued > 1 ? "s" : ""} on seed ${r.settings.seed}`);
}

async function queueSaved(r) {
  if (!r.comfy || !r.comfy.pos) return toast("No ComfyUI graph yet. Import a ComfyUI PNG to attach one.");
  if (!ui.comfyLive) return toast(`ComfyUI isn't answering at ${comfyBase()}`);
  const out = finalOut(r);
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
      // Drafted prose too, so the Prompto Character node can write prose for any cast member.
      proseDraft: c.prose ? "" : castDraft(c),
      outfits: Object.entries(c.outfits).map(([name, o]) => ({ name, tags: o.tags, prose: o.prose, proseDraft: o.prose ? "" : castDraft(c, name) }))
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
  if (!ui.bridge) return false;
  if (ui.syncedRev !== ui.rev) {
    const rev = ui.rev;
    const ok = await bridgeCall(tab.id, "syncLibrary", [snapshot()]).catch(() => null);
    if (ok && ok.ok) ui.syncedRev = rev;
  }
  const caps = await bridgeCall(tab.id, "takeCaptures").catch(() => null);
  if (!Array.isArray(caps) || !caps.length) return true;
  const have = new Set(db.inbox.map((i) => i.id));
  const fresh = [], filed = new Set();
  for (const item of caps.map(captureToInbox)) {
    if (have.has(item.id)) continue;
    // A capture made from a recipe goes straight to that recipe's results.
    const r = db.settings.autoResults && item.kind === "png" && item.thumb && matchRecipe(item.meta.positive);
    if (r && addRun(r, { thumb: item.thumb, seed: item.meta.settings.seed, source: item.source, filename: item.title, positive: item.meta.positive })) { filed.add(r.title); continue; }
    fresh.push(item);
  }
  for (const item of fresh) db.inbox.unshift(item);
  if (filed.size) {
    toast("Added to results: " + [...filed].join(", "));
    if (ui.recipeId) { const el = $("#results"); if (el) el.innerHTML = resultsHtml(recipeById(ui.recipeId)); }
  }
  await store.save(db);
  await bridgeCall(tab.id, "ackCaptures", [caps.map((c) => c.id)]).catch(() => null);
  persist();
  if (fresh.length) {
    toast(fresh.length === 1 ? "New capture from ComfyUI" : `${fresh.length} captures from ComfyUI`);
    if (ui.tab === "inbox" && !ui.recipeId) draw(); else $("#count-inbox").textContent = db.inbox.length;
  }
  return true;
}

let beating = false;
async function heartbeat() {
  if (beating) return;
  beating = true;
  try { await beat(); } finally { beating = false; }
}
// The installed LoRA list feeds autocomplete and the missing-LoRA check.
async function refreshLoras(tab, announce) {
  const names = await fetchLoras(comfyBase(), tab ? tab.id : null);
  if (!names) { if (announce) toast("Couldn't read the LoRA list. Open ComfyUI in a tab and try again."); return false; }
  db.settings.loraList = { at: Date.now(), names };
  persist();
  if (announce) toast(`Found ${names.length} LoRAs`);
  if (ui.recipeId) { drawOutput(recipeById(ui.recipeId)); const el = $("#lora-edit"); if (el) el.innerHTML = loraRows(recipeById(ui.recipeId)); }
  return true;
}

async function beat() {
  const base = comfyBase();
  const [live, tabs] = await Promise.all([ping(base), findTabs(base)]);
  const hadBridge = ui.bridge;
  // Use the first tab with the bridge; a tab still loading or showing an error page has none.
  let tab = tabs[0] || null;
  ui.bridge = null;
  for (const t of tabs) {
    if (await syncBridge(t).catch(() => false)) { tab = t; break; }
  }
  const list = db.settings.loraList;
  if ((tab || live) && (!list || Date.now() - list.at > 10 * 60e3)) refreshLoras(tab).catch(() => {});
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
// ---------- Reference boards ----------
function addRef(c, src, outfit = null, note = "") {
  if (!src) return false;
  c.refs = c.refs || [];
  if (c.refs.some((x) => x.src === src && x.outfit === outfit)) return false;
  c.refs.push({ id: uid("ref"), src, note, outfit, at: Date.now() });
  if (!c.image) c.image = src;
  return true;
}
function refStrip(c, outfit, editable) {
  const refs = (c.refs || []).filter((x) => (x.outfit || null) === (outfit || null));
  if (!refs.length && !editable) return "";
  return `<div class="refs" data-drop-cast="${c.id}" ${outfit ? `data-drop-outfit="${esc(outfit)}"` : ""}>
    ${refs.map((x) => `<button class="ref${c.image === x.src ? " is-cover" : ""}" data-act="ref-open" data-c="${c.id}" data-ref="${x.id}" aria-label="Open reference"><img src="${esc(x.src)}" alt="" loading="lazy"></button>`).join("")}
    ${editable ? `<span class="ref-drop">Drop images here</span>` : ""}
  </div>`;
}

const templates = () => db.settings.proseTemplates;
const castDraft = (c, outfit) => outfit
  ? proseFromTags("outfit", c.outfits[outfit].tags, templates())
  : proseFromTags("character", c.appearance, templates(), { name: c.name });

function castTicket(c, i) {
  const open = ui.openChar === c.id;
  const ro = (arr) => arr.map((t) => `<span class="chip ro">${esc(t)}</span>`).join("");
  const detail = open ? `<div class="char-open">
      <div class="group-label">References</div>${refStrip(c, null, true)}
      <div class="group-label">Appearance</div><div class="chips">${strChips(c.appearance, `${c.id}|appearance`)}</div>
      <div class="group-label spread">Prose<button class="link" data-act="cast-draft" data-c="${c.id}">Write from tags</button></div><textarea class="prose" data-cf="prose" data-c="${c.id}" rows="1" placeholder="${esc(castDraft(c) || "a short natural-language description")}">${esc(c.prose)}</textarea>
      ${Object.entries(c.outfits).map(([o, v]) => `<div class="group-label">Outfit · ${esc(o)}</div>${refStrip(c, o, true)}<div class="chips">${strChips(v.tags, `${c.id}|outfit|${o}`)}</div>
        <div class="row" style="justify-content:flex-end"><button class="link" data-act="cast-draft" data-c="${c.id}" data-o="${esc(o)}">Write from tags</button></div>
        <textarea class="prose" data-cf="outfit-prose" data-o="${esc(o)}" data-c="${c.id}" rows="1" placeholder="${esc(castDraft(c, o) || "what they're wearing, in prose")}">${esc(v.prose)}</textarea>`).join("")}
      <div class="row"><input class="chip-add" data-new-outfit="${c.id}" placeholder="+ outfit name" aria-label="New outfit"></div>
      <div class="group-label">Trigger word</div><textarea class="prose" data-cf="trigger" data-c="${c.id}" rows="1">${esc(c.trigger)}</textarea>
      <div class="group-label">Notes</div><textarea class="prose" data-cf="notes" data-c="${c.id}" rows="1" placeholder="what works, what doesn't">${esc(c.notes)}</textarea>
    </div>` : `<div class="chips" style="margin-top:10px">${ro(c.appearance.slice(0, 8))}${c.appearance.length > 8 ? `<span class="chip ro">+${c.appearance.length - 8}</span>` : ""}</div>
      ${(c.refs || []).length > 1 ? `<div class="refs mini">${c.refs.slice(0, 6).map((x) => `<button class="ref" data-act="ref-open" data-c="${c.id}" data-ref="${x.id}" aria-label="Open reference"><img src="${esc(x.src)}" alt="" loading="lazy"></button>`).join("")}${c.refs.length > 6 ? `<span class="kv">+${c.refs.length - 6}</span>` : ""}</div>` : ""}`;
  return `<article class="tk${i % 2 ? " ink" : ""}${c.image ? " has-cover" : ""}" id="c-${c.id}" style="--stub:60px" data-drop-cast="${c.id}">
    <div class="tk-bg"><span class="tk-mark">${esc(initials(c.name))}</span></div>
    <div class="tk-head"><span class="tag">${esc(c.series)}</span>${c.trigger ? `<span class="num">trigger <b>${esc(c.trigger)}</b></span>` : ""}</div>
    ${c.image ? `<button class="cast-ref-btn" data-act="ref-open" data-c="${c.id}" data-ref="${esc(((c.refs || []).find((x) => x.src === c.image) || {}).id || "")}" aria-label="Open references"><img class="cast-ref" src="${esc(c.image)}" alt=""></button>` : ""}
    <h3 class="tk-title">${esc(c.name)}</h3>
    ${detail}
    <div class="group-label">Start a recipe</div>
    <div class="row" style="margin-bottom:14px">${(Object.keys(c.outfits).length ? Object.keys(c.outfits) : [""]).map((o) => `<button class="fchip" data-act="cast-recipe" data-c="${c.id}" data-o="${esc(o)}">${esc(o || "No outfit")}</button>`).join("")}</div>
    <div class="tk-tear"></div>
    <div class="tk-stub">
      <div><p>${c.lora ? esc(c.lora.name) : "No LoRA"}</p><p class="mono">${c.lora ? "weight " + c.lora.w : "tags only"}</p></div>
      <span class="row"><button class="link" data-act="share-cast" data-c="${c.id}">Share</button><button class="link" data-act="cast-toggle" data-c="${c.id}">${open ? "Done" : "Edit"}</button></span>
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
      ${p.format !== "tags" ? check("autoProse", "Draft prose from tags when a block has none", p.autoProse !== false) : ""}
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

    <div class="sec">Prose templates</div>
    <section class="tk" style="--stub:0px;padding-bottom:14px">
      <div class="tk-bg"></div>
      <div class="tk-head"><span class="tag">Tags to prose</span><span class="kv">no AI</span></div>
      <p class="hint" style="margin-top:8px">How blocks without prose are written for prose models. Slots in {braces} are filled from the tags; text in [brackets] is left out when a slot inside it is empty.</p>
      <div class="tpl-grid">${Object.keys(DEFAULT_TEMPLATES).map((k) => {
        const v = db.settings.proseTemplates[k];
        return `<label>${esc(k)}<input data-tpl="${k}" value="${esc(v ?? DEFAULT_TEMPLATES[k])}" spellcheck="false"><small>${esc(SLOT_HELP[k])} · <button class="link" data-act="tpl-reset" data-k="${k}">Reset</button></small></label>`;
      }).join("")}</div>
      <p class="kv tpl-sample" style="margin-top:10px">${esc(proseFromTags("character", ["1girl", "silver hair", "long hair", "twin braids", "red eyes", "freckles"], db.settings.proseTemplates, { name: "Rin" }))}</p>
    </section>

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
      <label class="check" style="margin-top:10px"><input type="checkbox" data-setting="autoResults" ${db.settings.autoResults ? "checked" : ""}> File captures made from a recipe straight into its results</label>
      <p class="hint" style="margin-top:8px">Loading into a workflow needs ComfyUI open in a browser tab. The desktop app runs on port 8000 and only supports queueing saved graphs.</p>
      <p class="kv" style="margin-top:8px">${db.settings.loraList ? `${db.settings.loraList.names.length} LoRAs found ${ago(db.settings.loraList.at)}` : "LoRA list not read yet"} · <button class="link" data-act="lora-refresh">Refresh</button></p>
      <p class="kv" style="margin-top:8px">${ui.bridge ? `ComfyUI-Prompto ${esc(ui.bridge)} is installed: your library syncs to its sidebar and captures from ComfyUI land in the inbox.`
        : "Install ComfyUI-Prompto in ComfyUI for a Prompto sidebar there, right-click “Save to Prompto”, and auto-capture of saved images."}</p>
    </section>

    <div class="sec">Sync</div>
    ${syncCard()}

    <div class="sec">Library</div>
    <section class="tk" style="--stub:0px;padding-bottom:14px">
      <div class="tk-bg"></div>
      <div class="tk-head"><span class="tag">Backup</span><span class="kv">JSON</span></div>
      <p class="kv" style="margin-top:10px">${plural(n("recipes"), "recipe")} · ${n("characters")} cast · ${plural(n("snippets"), "snippet")} · ${n("inbox")} in inbox · ${plural(Object.keys(db.profiles).length, "profile")}</p>
      ${ui.pendingForeign ? `<div class="import-box">
          <p class="snip-name">${esc(ui.pendingForeign.name)}</p>
          <p class="kv">${esc(ui.pendingForeign.format)} · ${plural(ui.pendingForeign.recipes.length, "recipe")} · ${plural(ui.pendingForeign.snippets.length, "snippet")}${ui.pendingForeign.skipped ? ` · ${ui.pendingForeign.skipped} already here` : ""}</p>
          <p class="hint">${esc([...ui.pendingForeign.recipes.slice(0, 3).map((r) => r.title), ...ui.pendingForeign.snippets.slice(0, 3).map((s) => s.cat + " · " + s.name)].join(", "))}${ui.pendingForeign.recipes.length + ui.pendingForeign.snippets.length > 6 ? "…" : ""}</p>
          <div class="row"><button class="btn sm" data-act="foreign-add">Add them</button><button class="link" data-act="foreign-cancel">Cancel</button></div>
        </div>` : ""}
      ${pend ? `<div class="import-box">
          <p class="snip-name">${esc(pend.name)}</p>
          <p class="kv">${plural(pend.data.recipes.length, "recipe")} · ${pend.data.characters.length} cast · ${plural(pend.data.snippets.length, "snippet")} · ${pend.data.inbox.length} in inbox</p>
          <p class="hint">Merge adds anything you don't already have. Replace swaps your whole library for this file.</p>
          <div class="row"><button class="btn sm" data-act="import-merge">Merge</button><button class="btn ghost sm" data-act="import-replace">Replace</button><button class="link" data-act="import-cancel">Cancel</button></div>
        </div>` : ""}
      <div class="row" style="margin-top:10px">
        <button class="btn sm" data-act="export">Export <i aria-hidden="true">→</i></button>
        <label class="btn ghost sm" for="import-file" style="cursor:pointer" title="A Prompto backup, or a file from FranckyB Prompt Manager, ComfyAssets PromptManager, A1111 styles.csv or tag-complete chants">Import</label>
        <input type="file" id="import-file" class="sr-only" accept=".json,.csv,application/json,text/csv">
        <button class="link" data-act="clear-samples">Remove sample items</button>
      </div>
      <p class="hint" style="margin-top:8px">The tag list isn't included; it stays on this device. <b>Import</b> also reads files from FranckyB's Prompt Manager, ComfyAssets' PromptManager, A1111 <span class="mono">styles.csv</span> and tag-complete chants.</p>
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
  const text = await file.text();
  // Not a Prompto backup? It may come from another prompt tool.
  const foreign = detectForeign(file.name, text);
  if (foreign && foreign.format !== "prompto") return readForeign(file.name, foreign);
  try {
    const json = JSON.parse(text);
    const data = json && json.app === "prompto" ? json.data : json;
    if (!data || !["recipes", "characters", "snippets", "inbox"].some((k) => Array.isArray(data[k]))) throw new Error();
    ui.pendingImport = { name: file.name, data: migrate(data) };
    go("settings");
    requestAnimationFrame(() => $(".import-box")?.scrollIntoView({ block: "center", behavior: "smooth" }));
  } catch { toast("That file isn't a Prompto library"); }
}

// ---------- Importing from other tools ----------
function readForeign(name, found) {
  const { recipes, snippets } = convertForeign(found);
  const haveSnip = new Set(db.snippets.map((x) => `${x.cat}|${x.name}`.toLowerCase()));
  // Imported recipes remember the prompt they came from, since added trigger words change their output.
  const haveRec = new Set(db.recipes.flatMap((r) => [promptKey(render(r, profileOf(r), db).positive), r.importKey].filter(Boolean)));
  const freshS = snippets.filter((x) => !haveSnip.has(`${x.cat}|${x.name}`.toLowerCase()));
  const freshR = recipes.filter((x) => !haveRec.has(promptKey(x.positive)));
  if (!freshS.length && !freshR.length) return toast(recipes.length || snippets.length ? `Everything in that ${found.format} file is already here` : `Nothing to import in that ${found.format} file`);
  ui.pendingForeign = { name, format: found.format, recipes: freshR, snippets: freshS, skipped: recipes.length + snippets.length - freshR.length - freshS.length };
  go("settings");
  requestAnimationFrame(() => $(".import-box")?.scrollIntoView({ block: "center", behavior: "smooth" }));
}

function applyForeign() {
  const f = ui.pendingForeign;
  for (const x of f.snippets) db.snippets.push({ id: uid("sn"), ...x });
  for (const x of f.recipes) {
    const r = newRecipe();
    const set = Object.fromEntries(Object.entries(x.settings || {}).filter(([, v]) => v !== undefined && v !== "" && v !== null));
    Object.assign(r, { title: x.title, blocks: x.blocks, negative: x.negative, fav: x.fav, image: x.image || null, importKey: promptKey(x.positive) });
    r.settings = { ...r.settings, ...set, loras: set.loras || [] };
    r.profile = guessProfile(r.settings.model || "", x.positive);
    db.recipes.unshift(r);
  }
  const msg = [f.recipes.length && `${f.recipes.length} recipe${f.recipes.length > 1 ? "s" : ""}`, f.snippets.length && `${f.snippets.length} snippet${f.snippets.length > 1 ? "s" : ""}`].filter(Boolean).join(" and ");
  ui.pendingForeign = null;
  persist(); draw();
  toast(`Imported ${msg}`);
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
  suggestLocal(q, input) {
    if (input && (input.classList.contains("lora-add") || q.startsWith("<"))) return loraSuggestions(q, input.classList.contains("lora-add"));
    if (tagIndexRev !== ui.rev) { tagIndex = libraryTags(db); tagIndexRev = ui.rev; }
    const yours = searchLibrary(tagIndex, q, 3);
    const seen = new Set(yours.map((x) => x.name.toLowerCase()));
    return [...yours, ...searchLocal(q, 8).filter((x) => !seen.has(x.name.toLowerCase()))].slice(0, 8);
  },
  suggestOnline: (q, signal) => (db.settings.onlineTags ? searchDanbooru(q, signal) : Promise.resolve([]))
});

// ---------- Events ----------
document.addEventListener("click", async (e) => {
  if (e.target.id === "lightbox") { ui.lightbox = null; return drawLightbox(); }
  const card = ui.picking && e.target.closest("a.tk[data-recipe]");
  if (card) {
    e.preventDefault();
    const id = card.dataset.recipe;
    if (ui.picked.has(id)) ui.picked.delete(id); else ui.picked.add(id);
    return draw();
  }
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
    case "new-recipe": { const n = newRecipe(); if (folderById(ui.folder)) n.folder = ui.folder; db.recipes.unshift(n); persist(); go("recipe/" + n.id); break; }
    case "folder": ui.folder = el.dataset.f; ui.renamingFolder = null; draw(); break;
    case "folder-new": {
      const f = { id: uid("fld"), name: "New folder" };
      db.folders.push(f); ui.folder = f.id; ui.renamingFolder = f.id; persist(); draw();
      const inp = $("#folder-name"); if (inp) { inp.focus(); inp.select(); }
      break;
    }
    case "folder-rename": ui.renamingFolder = ui.folder; draw(); $("#folder-name")?.focus(); break;
    case "folder-rename-save": { const f = folderById(ui.folder); f.name = $("#folder-name").value.trim() || f.name; ui.renamingFolder = null; persist(); draw(); break; }
    case "folder-del": {
      const f = folderById(ui.folder);
      if (!armed(el, "Press again to delete")) return;
      for (const r2 of db.recipes) if (r2.folder === f.id) r2.folder = null;
      db.folders = db.folders.filter((x) => x.id !== f.id); ui.folder = "unfiled"; persist(); draw();
      toast(`Deleted ${f.name}; its recipes are unfiled`); break;
    }
    case "pick-toggle": ui.picking = !ui.picking; ui.picked.clear(); draw(); break;
    case "bulk-star": {
      if (!ui.picked.size) return toast("Pick some recipes first");
      const allStarred = db.recipes.filter((x) => ui.picked.has(x.id)).every((x) => x.fav);
      for (const x of db.recipes) if (ui.picked.has(x.id)) x.fav = !allStarred;
      persist(); draw(); break;
    }
    case "bulk-del": {
      if (!ui.picked.size) return toast("Pick some recipes first");
      if (!armed(el, `Press again to delete ${ui.picked.size}`)) return;
      const n = ui.picked.size;
      db.recipes = db.recipes.filter((x) => !ui.picked.has(x.id)); ui.picked.clear(); persist(); draw();
      toast(`Deleted ${n} recipe${n > 1 ? "s" : ""}`); break;
    }
    case "profile": r.profile = el.dataset.p; persist(); drawRecipe(); break;
    case "edit-profile": ui.openProfile = el.dataset.p; break;
    case "fav": r.fav = !r.fav; persist(); drawRecipe(); break;
    case "dup": {
      const d = { ...structuredClone(r), id: uid("rec"), no: db.nextNo++, title: r.title + " copy", createdAt: Date.now(), runs: [], versions: [], coverId: null };
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
    case "block-draft": {
      const text = draftProse(r.blocks[i], db);
      if (!text) return toast("Add some tags first");
      r.blocks[i].prose = text; refresh(r); $(`.prose[data-i="${i}"]`)?.focus(); break;
    }
    case "cast-draft": {
      const c = charById(el.dataset.c), o = el.dataset.o;
      const text = castDraft(c, o);
      if (!text) return toast("Add some tags first");
      if (o) c.outfits[o].prose = text; else c.prose = text;
      persist(); draw(); break;
    }
    case "tpl-reset": delete db.settings.proseTemplates[el.dataset.k]; persist(); draw(); break;
    case "block-up": [r.blocks[i - 1], r.blocks[i]] = [r.blocks[i], r.blocks[i - 1]]; refresh(r); break;
    case "block-del": r.blocks.splice(i, 1); refresh(r); break;
    case "add-block": {
      r.blocks.push({ type: $("#add-type").value, tags: [], prose: "" });
      refresh(r); $(`.chip-add[data-i="${r.blocks.length - 1}"]`)?.focus(); break;
    }
    case "copy-pos": { const pos = finalOut(r).positive; noteSend(r, pos, "copied"); drawVersions(r); copy(pos, "Prompt copied"); break; }
    case "copy-raw": copy(finalOut(r).template, "Copied with wildcards"); break;
    case "roll": ui.rolls[r.id] = Math.max(1, rollOf(r) + Number(el.dataset.d)); drawOutput(r); break;
    case "queue-variants": return queueVariants(r, Number($("#variant-count").value));
    case "copy-neg": copy(finalOut(r).negative || "", "Negative copied"); break;
    case "copy-a1111": noteSend(r, finalOut(r).positive, "copied for Forge"); drawVersions(r); copy(toA1111(r, profileOf(r), db, (t, part) => (hasWildcards(t) ? expandText(r, t, part) : t)), "Copied. Paste it into Forge, then press ↙"); break;
    case "comfy-load": {
      const out = finalOut(r);
      noteSend(r, out.positive, "loaded into ComfyUI"); drawVersions(r);
      return withComfyTab({ mode: "recipe", positive: out.positive, negative: out.negative, settings: r.settings, title: r.title, image: r.image || null }, "Loaded");
    }
    case "comfy-node": { const pos = finalOut(r).positive; noteSend(r, pos, "sent to a node"); drawVersions(r); return withComfyTab({ mode: "selected", text: pos, append: false }, "Sent"); }
    case "send-comfy": noteSend(r, finalOut(r).positive, "queued"); drawVersions(r); return queueSaved(r);
    case "lora-del": r.settings.loras.splice(Number(el.dataset.j), 1); persist(); $("#lora-edit").innerHTML = loraRows(r); drawOutput(r); break;
    case "share-recipe": return shareRecipe(r).catch((e) => toast("Couldn't make the card: " + e.message));
    case "share-cast": return shareCast(charById(el.dataset.c)).catch((e) => toast("Couldn't make the card: " + e.message));
    case "ver-save": toast(saveVersion(r, "saved") ? "Version saved" : "Nothing changed since the last version"); persist(); drawVersions(r); break;
    case "ver-diff": ui.diffId = ui.diffId === el.dataset.v ? null : el.dataset.v; drawVersions(r); break;
    case "ver-restore": {
      const v = r.versions.find((x) => x.id === el.dataset.v);
      if (!armed(el, "Press again")) return;
      saveVersion(r, "before restore");
      r.profile = db.profiles[v.profile] ? v.profile : r.profile;
      r.blocks = structuredClone(v.blocks); r.negative = v.recipeNegative || ""; r.settings = structuredClone(v.settings);
      ui.diffId = null; persist(); drawRecipe();
      toast(`Restored v${r.versions.length - r.versions.indexOf(v)}`); break;
    }
    case "run-open": ui.lightbox = { recipeId: r.id, runId: el.dataset.run }; drawLightbox(); break;
    case "cmp-toggle": ui.comparing = !ui.comparing; ui.cmpPick = []; $("#results").innerHTML = resultsHtml(r); break;
    case "cmp-pick": {
      const id = el.dataset.run, at = ui.cmpPick.indexOf(id);
      if (at >= 0) ui.cmpPick.splice(at, 1);
      else if (ui.cmpPick.length < 4) ui.cmpPick.push(id);
      else toast("Four at most");
      $("#results").innerHTML = resultsHtml(r); break;
    }
    case "cmp-open":
      if (ui.cmpPick.length < 2) return toast("Pick at least two results");
      ui.lightbox = { kind: "compare", recipeId: r.id, runIds: [...ui.cmpPick] }; drawLightbox(); break;
    case "lb-close": ui.lightbox = null; drawLightbox(); break;
    case "ref-open": ui.lightbox = { kind: "ref", charId: el.dataset.c, refId: el.dataset.ref }; drawLightbox(); break;
    case "ref-step": {
      const c = charById(ui.lightbox.charId);
      const idx = c.refs.findIndex((x) => x.id === ui.lightbox.refId) + Number(el.dataset.d);
      if (c.refs[idx]) { ui.lightbox.refId = c.refs[idx].id; drawLightbox(); }
      break;
    }
    case "ref-cover": { const c = charById(el.dataset.c); c.image = c.refs.find((x) => x.id === el.dataset.ref).src; persist(); drawLightbox(); if (!ui.recipeId) draw(); toast("Cover updated"); break; }
    case "ref-del": {
      if (!armed(el, "Press again")) return;
      const c = charById(el.dataset.c);
      const idx = c.refs.findIndex((x) => x.id === el.dataset.ref);
      const [gone] = c.refs.splice(idx, 1);
      if (c.image === gone.src) c.image = c.refs[0] ? c.refs[0].src : null;
      const next = c.refs[idx] || c.refs[idx - 1];
      ui.lightbox = next ? { kind: "ref", charId: c.id, refId: next.id } : null;
      persist(); drawLightbox(); if (!ui.recipeId) draw(); break;
    }
    case "ref-file": {
      const item = db.inbox.find((x) => x.id === el.dataset.id);
      const [cid, outfit] = $(`[data-ref-pick="${el.dataset.id}"]`).value.split("|");
      const c = charById(cid);
      addRef(c, item.image, outfit || null, item.url || item.source || "");
      db.inbox = db.inbox.filter((x) => x.id !== item.id);
      ui.refPick = null; ui.openChar = c.id; persist();
      toast(`Added to ${c.name}'s references`);
      go("cast/" + c.id); break;
    }
    case "run-step": {
      const lr = recipeById(ui.lightbox.recipeId);
      const idx = lr.runs.findIndex((x) => x.id === ui.lightbox.runId) + Number(el.dataset.d);
      if (lr.runs[idx]) { ui.lightbox.runId = lr.runs[idx].id; drawLightbox(); }
      break;
    }
    case "run-rate": case "run-cover": case "run-seed": case "run-del": {
      const lr = recipeById((ui.lightbox && ui.lightbox.recipeId) || ui.recipeId);
      if (!lr) return;
      const run = lr.runs.find((x) => x.id === el.dataset.run);
      if (act === "run-rate") run.rating = run.rating === Number(el.dataset.n) ? 0 : Number(el.dataset.n);
      if (act === "run-cover") { lr.image = run.thumb; lr.coverId = run.id; toast("Cover updated"); }
      if (act === "run-seed") { lr.settings.seed = run.seed; toast("Seed set to " + run.seed); }
      if (act === "run-del") {
        if (!armed(el, "Press again")) return;
        const idx = lr.runs.indexOf(run);
        lr.runs.splice(idx, 1);
        if (lr.coverId === run.id) { lr.coverId = null; lr.image = lr.runs[0] ? lr.runs[0].thumb : lr.image; }
        ui.lightbox = lr.runs[idx] || lr.runs[idx - 1] ? { recipeId: lr.id, runId: (lr.runs[idx] || lr.runs[idx - 1]).id } : null;
      }
      persist();
      if (ui.recipeId === lr.id) { if (act === "run-seed") drawRecipe(); else $("#results").innerHTML = resultsHtml(lr); }
      drawLightbox();
      break;
    }
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
    case "sync-choose": {
      try { ui.sync.handle = await syncfs.chooseFolder(); }
      catch (e) { if (e && e.name !== "AbortError") toast("Couldn't open that folder"); return; }
      await startSync(true); break;
    }
    case "sync-reconnect": await startSync(true); break;
    case "sync-now": await syncNow("manual"); break;
    case "sync-stop":
      if (!armed(el, "Press again to stop")) return;
      await syncfs.forgetFolder(); ui.sync = { ...ui.sync, handle: null, state: "off", at: 0, error: "" }; draw(); toast("Sync stopped; this device keeps its library"); break;
    case "lora-refresh": refreshLoras(ui.comfyTab, true).then(() => draw()); break;
    case "import-cancel": ui.pendingImport = null; draw(); break;
    case "foreign-add": applyForeign(); break;
    case "foreign-cancel": ui.pendingForeign = null; draw(); break;
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
  if (t.id === "sort") { ui.sort = t.value; return draw(); }
  if (t.id === "recipe-folder") { r.folder = t.value || null; persist(); return toast(t.value ? "Moved to " + folderById(t.value).name : "Unfiled"); }
  if (t.id === "bulk-folder" && t.value) {
    if (!ui.picked.size) { t.value = ""; return toast("Pick some recipes first"); }
    const n = ui.picked.size, name = t.value === "unfiled" ? "Unfiled" : folderById(t.value).name;
    moveToFolder(ui.picked, t.value); ui.picked.clear(); draw();
    return toast(`Moved ${n} recipe${n > 1 ? "s" : ""} to ${name}`);
  }
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
    if (t.dataset.s === "size") { const [w, h] = v.split(/[x×]/).map(Number); s.width = w || undefined; s.height = h || undefined; }
    else s[t.dataset.s] = ["steps", "cfg", "seed"].includes(t.dataset.s) && v !== "" ? Number(v) : v;
    if (t.dataset.s === "model") delete s.modelRef; // its hash / Civitai id belonged to the old model
    persist(); drawOutput(r);
  }
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "q") { ui.q = t.value; return draw(); }
  const r = ui.recipeId && recipeById(ui.recipeId);
  if (t.dataset.sheet === "name") { ui.sheet.drafts[t.dataset.d].name = t.value; return; }
  if (t.dataset.sheet === "outfit") { ui.sheet.drafts[t.dataset.d].outfitName = t.value; return; }
  if (t.id === "device-name") { db.settings.deviceName = t.value.trim() || db.settings.deviceName; return store.save(db); }
  if (t.id === "title") { r.title = t.value; return persist(); }
  if (t.id === "neg") { r.negative = t.value; persist(); return drawOutput(r); }
  if (t.dataset.loraW != null) {
    const l = r.settings.loras[t.dataset.loraW];
    l.w = Math.round(Number(t.value) * 100) / 100;
    const row = t.closest(".lora-row");
    row.querySelector(t.type === "range" ? ".lora-num" : "input[type=range]").value = l.w;
    persist(); return drawOutput(r);
  }
  if (t.classList.contains("prose") && t.dataset.i != null) { r.blocks[t.dataset.i].prose = t.value; persist(); return drawOutput(r); }
  if (t.dataset.pf && t.type !== "checkbox") { db.profiles[t.dataset.p][t.dataset.pf] = t.value; return persist(); }
  if (t.dataset.refNote) {
    const ref = charById(t.dataset.c).refs.find((x) => x.id === t.dataset.refNote);
    ref.note = t.value; return persist();
  }
  if (t.dataset.tpl) {
    db.settings.proseTemplates[t.dataset.tpl] = t.value;
    persist();
    const sample = $(".tpl-sample");
    if (sample) sample.textContent = proseFromTags("character", ["1girl", "silver hair", "long hair", "twin braids", "red eyes", "freckles"], db.settings.proseTemplates, { name: "Rin" });
    return;
  }
  if (t.dataset.cf) {
    const c = charById(t.dataset.c);
    if (t.dataset.cf === "outfit-prose") c.outfits[t.dataset.o].prose = t.value;
    else c[t.dataset.cf] = t.value;
    persist();
  }
});

document.addEventListener("keydown", (e) => {
  const t = e.target;
  if (e.key === "Escape" && ui.lightbox) { ui.lightbox = null; return drawLightbox(); }
  if (t.id === "folder-name" && e.key === "Enter") { e.preventDefault(); return $('[data-act="folder-rename-save"]').click(); }
  if (t.id === "cap-text" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); return $('[data-act="capture"]').click(); }
  if (t.classList.contains("lora-add") && e.key === "Enter") {
    e.preventDefault();
    const v = t.value.trim().replace(/^<lora:|>$/g, "");
    if (!v) return;
    const [name, w] = v.split(/:(?=-?[\d.]+$)/);
    const r = recipeById(ui.recipeId);
    addLora(r, name, w);
    persist(); $("#lora-edit").innerHTML = loraRows(r); drawOutput(r);
    $(".lora-add")?.focus();
    return;
  }
  if (t.classList.contains("chip-add") && e.key === "Enter") {
    e.preventDefault();
    const v = t.value.trim();
    if (!v) return;
    if (t.dataset.i != null) {
      const r = recipeById(ui.recipeId);
      // <lora:name:weight> typed into a tag field goes to the recipe's LoRAs.
      const rest = v.replace(/<lora:([^:>]+)(?::(-?[\d.]+))?>?/g, (_, name, w) => { addLora(r, name, w); return ""; });
      r.blocks[t.dataset.i].tags.push(...parseTags(rest));
      const le = $("#lora-edit"); if (le) le.innerHTML = loraRows(r);
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
const dragTypes = (e) => [...(e.dataTransfer?.types || [])];
const hasFiles = (e) => dragTypes(e).includes("Files");
// Images dragged out of another web page arrive as a URL rather than a file.
const hasImageUrl = (e) => !dragTypes(e).includes("application/x-prompto-recipe") && (dragTypes(e).includes("text/uri-list") || dragTypes(e).includes("text/html"));
function draggedImageUrl(e) {
  const html = e.dataTransfer.getData("text/html");
  const m = html && html.match(/<img[^>]+src="([^"]+)"/i);
  if (m) return m[1].replace(/&amp;/g, "&");
  const uri = (e.dataTransfer.getData("text/uri-list") || "").split("\n").find((l) => l && !l.startsWith("#"));
  return uri && /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(uri) ? uri.trim() : null;
}
// Recipe cards carry their id; dropping one on a folder chip files it there.
const RECIPE_DRAG = "application/x-prompto-recipe";
document.addEventListener("dragstart", (e) => {
  const card = e.target.closest && e.target.closest("a.tk[data-recipe]");
  if (!card) return;
  const ids = ui.picking && ui.picked.has(card.dataset.recipe) ? [...ui.picked] : [card.dataset.recipe];
  e.dataTransfer.setData(RECIPE_DRAG, JSON.stringify(ids));
  e.dataTransfer.effectAllowed = "move";
});
document.addEventListener("dragover", (e) => {
  if (!dragTypes(e).includes(RECIPE_DRAG)) return;
  const chip = e.target.closest && e.target.closest("[data-drop-folder]");
  document.querySelectorAll(".folder.drop-here").forEach((x) => x !== chip && x.classList.remove("drop-here"));
  if (chip && chip.dataset.dropFolder !== "all") { e.preventDefault(); chip.classList.add("drop-here"); }
});
document.addEventListener("drop", (e) => {
  if (!dragTypes(e).includes(RECIPE_DRAG)) return;
  const chip = e.target.closest && e.target.closest("[data-drop-folder]");
  if (!chip || chip.dataset.dropFolder === "all") return;
  e.preventDefault(); e.stopImmediatePropagation();
  const ids = new Set(JSON.parse(e.dataTransfer.getData(RECIPE_DRAG)));
  moveToFolder(ids, chip.dataset.dropFolder);
  ui.picked.clear(); draw();
  toast(`Moved ${ids.size} recipe${ids.size > 1 ? "s" : ""} to ${chip.dataset.dropFolder === "unfiled" ? "Unfiled" : folderById(chip.dataset.dropFolder).name}`);
}, true);

let dropTarget = null;
function markDrop(e) {
  const t = e.target.closest && e.target.closest("[data-drop-cast]");
  if (t === dropTarget) return;
  if (dropTarget) dropTarget.classList.remove("drop-here");
  dropTarget = t;
  if (t) t.classList.add("drop-here");
  veil.classList.toggle("on", !t && hasFiles(e));
}
document.addEventListener("dragenter", (e) => { if (hasFiles(e) || hasImageUrl(e)) { dragDepth++; markDrop(e); } });
document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; veil.classList.remove("on"); if (dropTarget) dropTarget.classList.remove("drop-here"); dropTarget = null; } });
document.addEventListener("dragover", (e) => {
  if (!hasFiles(e) && !hasImageUrl(e)) return;
  markDrop(e);
  if (hasFiles(e) || dropTarget) e.preventDefault();
});
document.addEventListener("drop", async (e) => {
  if (!db) { e.preventDefault(); return toast("One moment, the library is still loading"); }
  const target = e.target.closest && e.target.closest("[data-drop-cast]");
  dragDepth = 0; veil.classList.remove("on");
  if (dropTarget) dropTarget.classList.remove("drop-here");
  dropTarget = null;
  if (target) {
    e.preventDefault();
    const c = charById(target.dataset.dropCast);
    const outfit = (e.target.closest("[data-drop-outfit]") || {}).dataset?.dropOutfit || null;
    let added = 0;
    for (const f of [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"))) if (addRef(c, await makeThumb(f, 640), outfit, f.name)) added++;
    if (!added) { const url = draggedImageUrl(e); if (url && addRef(c, url, outfit, url)) added++; }
    persist(); draw();
    return toast(added ? `Added ${added} reference${added > 1 ? "s" : ""} to ${c.name}${outfit ? " · " + outfit : ""}` : "Drop an image file or an image from a web page");
  }
  if (!hasFiles(e)) return;
  e.preventDefault();
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
  if (syncfs.supported()) {
    ui.sync.handle = await syncfs.savedFolder();
    if (ui.sync.handle) await startSync(false);
    setInterval(() => { if (ui.sync.state === "on") syncNow("poll"); }, 60000);
  }
})();
