// Undo for deletions: a copy of the lists a deletion touches, put back as they were.
export const snapshotLists = (db, kinds) => Object.fromEntries(kinds.map((k) => [k, structuredClone(db[k])]));

// Puts the lists back. Items that come back count as edited now and lose their
// tombstones, so a deletion that already reached the sync folder can't win.
export function restoreLists(db, snap, now = Date.now()) {
  const back = new Set();
  for (const [k, list] of Object.entries(snap)) {
    const have = new Set((db[k] || []).map((x) => x.id));
    for (const it of list) if (!have.has(it.id)) { back.add(`${k}:${it.id}`); it.updatedAt = now; }
    db[k] = list;
  }
  db.tombstones = (db.tombstones || []).filter((t) => !back.has(`${t.kind}:${t.id}`));
  return back.size;
}
