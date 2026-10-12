// Sync between devices through a shared file (see lib/syncfs.js). Every synced
// item gets an `updatedAt` when its content changes, and deleted items leave a
// tombstone, so two libraries can be merged item by item: the newer edit wins,
// and a deletion wins over any edit older than it. No DOM here.

export const COLLECTIONS = ["inbox", "recipes", "characters", "snippets", "folders"];
const TOMBSTONE_DAYS = 90;

// A cheap, stable fingerprint of an item's content (its updatedAt excluded).
export function fingerprint(item) {
  const { updatedAt, ...rest } = item;
  const s = JSON.stringify(rest);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + ":" + s.length;
}

// Profiles live in an object keyed by id; sync treats them like any other list.
const items = (db, k) => (k === "profiles" ? Object.values(db.profiles || {}) : db[k] || []);
const KINDS = [...COLLECTIONS, "profiles"];

/**
 * Stamps updatedAt on items whose content changed since the last sync and
 * records tombstones for items that disappeared. Mutates db; returns the new
 * fingerprint map to remember for next time.
 */
export function stamp(db, prev = {}, now = Date.now()) {
  const next = {};
  db.tombstones = db.tombstones || [];
  for (const k of KINDS) {
    const seen = new Set();
    for (const it of items(db, k)) {
      const key = `${k}:${it.id}`;
      const fp = fingerprint(it);
      next[key] = fp;
      seen.add(key);
      // A real edit is stamped now. An item seen for the first time (e.g. the first
      // sync on this device) keeps its creation time, so it can't beat newer edits elsewhere.
      if (key in prev && prev[key] !== fp) it.updatedAt = now;
      else if (!it.updatedAt) it.updatedAt = it.createdAt || 1;
    }
    for (const key of Object.keys(prev)) {
      if (key.startsWith(k + ":") && !seen.has(key)) db.tombstones.push({ kind: k, id: key.slice(k.length + 1), at: now });
    }
  }
  // Templates are one setting, synced as a single stamped value.
  const tfp = fingerprint({ t: db.settings && db.settings.proseTemplates });
  if (prev["settings:proseTemplates"] !== tfp) db.templatesAt = now;
  next["settings:proseTemplates"] = tfp;
  db.tombstones = pruneTombstones(db.tombstones, now);
  return next;
}

// Fingerprints of everything as it is now, without stamping anything: what was
// just merged in from another device must not count as a local edit.
export function fingerprints(db) {
  const out = {};
  for (const k of KINDS) for (const it of items(db, k)) out[`${k}:${it.id}`] = fingerprint(it);
  out["settings:proseTemplates"] = fingerprint({ t: db.settings && db.settings.proseTemplates });
  return out;
}

export function pruneTombstones(list, now = Date.now()) {
  const newest = new Map();
  for (const t of list || []) {
    if (now - t.at > TOMBSTONE_DAYS * 864e5) continue;
    const key = `${t.kind}:${t.id}`;
    if (!newest.has(key) || newest.get(key).at < t.at) newest.set(key, t);
  }
  return [...newest.values()];
}

function mergeList(a, b, deadAt) {
  const byId = new Map();
  for (const it of a) byId.set(it.id, it);
  for (const it of b) {
    const have = byId.get(it.id);
    if (!have || (it.updatedAt || 0) > (have.updatedAt || 0)) byId.set(it.id, it);
  }
  // A tombstone removes an item unless the item was edited after the deletion.
  return [...byId.values()].filter((it) => !(deadAt(it.id) >= (it.updatedAt || 0)));
}

/**
 * Merges a remote library into the local one and returns the merged synced
 * parts. Order follows the local list, with new remote items after it.
 */
export function merge(local, remote) {
  const tombstones = pruneTombstones([...(local.tombstones || []), ...(remote.tombstones || [])]);
  const dead = new Map(tombstones.map((t) => [`${t.kind}:${t.id}`, t.at]));
  const out = { tombstones };
  for (const k of KINDS) {
    const deadAt = (id) => dead.get(`${k}:${id}`) ?? -1;
    const merged = mergeList(items(local, k), items(remote, k), deadAt);
    out[k] = k === "profiles" ? Object.fromEntries(merged.map((p) => [p.id, p])) : merged;
  }
  // Keep the merged lists in a sensible order: newest first, as the panel shows them.
  for (const k of ["inbox", "recipes", "characters"]) out[k].sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
  const remoteTemplatesNewer = (remote.templatesAt || 0) > (local.templatesAt || 0);
  out.proseTemplates = (remoteTemplatesNewer ? remote.proseTemplates : local.settings && local.settings.proseTemplates) || {};
  out.templatesAt = Math.max(local.templatesAt || 0, remote.templatesAt || 0);
  out.nextNo = Math.max(local.nextNo || 1, remote.nextNo || 1, ...out.recipes.map((r) => (r.no || 0) + 1));
  return out;
}

// What goes into the shared file: the synced parts only. The ComfyUI address,
// LoRA list, tag-lookup setting and sync state stay on each device.
export function toSyncFile(db, device) {
  const data = { tombstones: db.tombstones || [], profiles: db.profiles, proseTemplates: (db.settings && db.settings.proseTemplates) || {}, templatesAt: db.templatesAt || 0, nextNo: db.nextNo };
  for (const k of COLLECTIONS) data[k] = db[k] || [];
  return { app: "prompto", kind: "sync", version: 1, savedAt: Date.now(), device, data };
}

export function fromSyncFile(json) {
  if (!json || json.app !== "prompto" || json.kind !== "sync" || !json.data) return null;
  const d = json.data;
  return { ...d, settings: { proseTemplates: d.proseTemplates || {} } };
}

// Applies a merge result to the live library, leaving device-only settings alone.
export function apply(db, merged) {
  for (const k of COLLECTIONS) db[k] = merged[k];
  db.profiles = Object.keys(merged.profiles).length ? merged.profiles : db.profiles;
  db.tombstones = merged.tombstones;
  db.settings.proseTemplates = merged.proseTemplates;
  db.templatesAt = merged.templatesAt;
  db.nextNo = merged.nextNo;
  return db;
}
