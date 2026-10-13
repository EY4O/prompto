import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { snapshotLists, restoreLists } from "../lib/undo.js";
import { removeCharacter } from "../lib/cast.js";
import { stamp } from "../lib/sync.js";
import { SEED } from "../lib/seed.js";

const library = () => ({ ...JSON.parse(JSON.stringify(SEED)), settings: {}, profiles: {}, folders: [] });

describe("undo", () => {
  test("puts a deleted character and their recipe blocks back", () => {
    const db = library();
    const before = JSON.stringify([db.characters, db.recipes]);
    const snap = snapshotLists(db, ["characters", "recipes"]);
    removeCharacter(db, "chr_rin");
    assert.equal(restoreLists(db, snap, 5), 1);
    const strip = (x) => JSON.stringify(x, (k, v) => (k === "updatedAt" ? undefined : v));
    assert.equal(strip([db.characters, db.recipes]), strip(JSON.parse(before)));
  });

  test("a restored item beats the deletion already recorded for sync", () => {
    const db = library();
    let h = stamp(db, {}, 100);
    const snap = snapshotLists(db, ["snippets"]);
    db.snippets = db.snippets.filter((s) => s.id !== "sn_1");
    h = stamp(db, h, 200);
    assert.ok(db.tombstones.some((t) => t.id === "sn_1"));
    restoreLists(db, snap, 300);
    assert.ok(!db.tombstones.some((t) => t.id === "sn_1"));
    assert.equal(db.snippets.find((s) => s.id === "sn_1").updatedAt, 300);
  });

  test("the snapshot is a copy, not a reference", () => {
    const db = library();
    const snap = snapshotLists(db, ["snippets"]);
    db.snippets[0].name = "changed";
    assert.notEqual(snap.snippets[0].name, "changed");
  });
});
