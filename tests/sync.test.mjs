import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as S from "../lib/sync.js";
import { SEED } from "../lib/seed.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
const T = Date.now();
const library = () => ({ ...clone(SEED), settings: { proseTemplates: {} }, folders: [], profiles: { p1: { id: "p1", label: "Profile" } } });
// What the other device would read: the library round-tripped through the sync file.
const viaFile = (db) => S.fromSyncFile(JSON.parse(JSON.stringify(S.toSyncFile(db, "other"))));

describe("sync: stamping", () => {
  test("first sync stamps items with their creation time, not now", () => {
    const db = library();
    S.stamp(db, {}, T);
    assert.equal(db.recipes[0].updatedAt, db.recipes[0].createdAt);
  });

  test("an edit is stamped now; an unchanged item keeps its stamp", () => {
    const db = library();
    const h = S.stamp(db, {}, T);
    const untouched = db.recipes[1].updatedAt;
    db.recipes[0].title = "edited";
    S.stamp(db, h, T + 500);
    assert.equal(db.recipes[0].updatedAt, T + 500);
    assert.equal(db.recipes[1].updatedAt, untouched);
  });

  test("a deleted item leaves a tombstone", () => {
    const db = library();
    const h = S.stamp(db, {}, T);
    db.snippets = db.snippets.filter((s) => s.id !== "sn_1");
    S.stamp(db, h, T + 1);
    assert.deepEqual(db.tombstones.map((t) => [t.kind, t.id]), [["snippets", "sn_1"]]);
  });

  test("fingerprints ignore updatedAt", () => {
    const item = { id: "x", title: "a" };
    assert.equal(S.fingerprint(item), S.fingerprint({ ...item, updatedAt: 99 }));
  });
});

describe("sync: merging", () => {
  test("the newer edit wins and new items from either side are kept", () => {
    const A = library(), B = clone(A);
    let hA = S.stamp(A, {}, T), hB = S.stamp(B, {}, T);
    A.recipes[0].title = "A"; hA = S.stamp(A, hA, T + 1000);
    B.recipes[0].title = "B"; B.recipes.push({ id: "rec_b", no: 9, title: "from B", blocks: [], createdAt: T + 2000 }); hB = S.stamp(B, hB, T + 2000);
    const m = S.merge(A, viaFile(B));
    assert.equal(m.recipes.find((r) => r.id === "rec_1").title, "B");
    assert.ok(m.recipes.some((r) => r.id === "rec_b"));
    assert.equal(m.nextNo, 10);
  });

  test("a deletion spreads to the other device", () => {
    const A = library(), B = clone(A);
    let hA = S.stamp(A, {}, T); S.stamp(B, {}, T);
    A.snippets = A.snippets.filter((s) => s.id !== "sn_6"); hA = S.stamp(A, hA, T + 1000);
    const m = S.merge(B, viaFile(A));
    assert.ok(!m.snippets.some((s) => s.id === "sn_6"));
  });

  test("an edit made after a deletion brings the item back", () => {
    const A = library(), B = clone(A);
    let hA = S.stamp(A, {}, T), hB = S.stamp(B, {}, T);
    A.snippets = A.snippets.filter((s) => s.id !== "sn_6"); hA = S.stamp(A, hA, T + 1000);
    B.snippets.find((s) => s.id === "sn_6").name = "revived"; hB = S.stamp(B, hB, T + 3000);
    const m = S.merge(A, viaFile(B));
    assert.equal(m.snippets.find((s) => s.id === "sn_6").name, "revived");
  });

  test("profiles merge by id and the newer prose templates win", () => {
    const A = library(), B = clone(A);
    let hA = S.stamp(A, {}, T); S.stamp(B, {}, T);
    A.profiles.p2 = { id: "p2", label: "New on A" };
    A.settings.proseTemplates = { outfit: "dressed in {items}" };
    hA = S.stamp(A, hA, T + 1000);
    const m = S.merge(B, viaFile(A));
    assert.equal(m.profiles.p2.label, "New on A");
    assert.equal(m.proseTemplates.outfit, "dressed in {items}");
  });

  test("apply keeps device-only settings", () => {
    const A = library(); A.settings.comfyUrl = "http://127.0.0.1:8000"; A.settings.loraList = { names: ["x"] };
    const B = library(); B.recipes[0].title = "from B";
    S.stamp(A, {}, T); S.stamp(B, {}, T);
    S.apply(A, S.merge(A, viaFile(B)));
    assert.equal(A.settings.comfyUrl, "http://127.0.0.1:8000");
    assert.deepEqual(A.settings.loraList, { names: ["x"] });
  });

  test("old tombstones are pruned, newest per item kept", () => {
    const kept = S.pruneTombstones([
      { kind: "recipes", id: "a", at: T - 100 * 864e5 },
      { kind: "recipes", id: "b", at: T - 10 },
      { kind: "recipes", id: "b", at: T - 5 }
    ], T);
    assert.deepEqual(kept, [{ kind: "recipes", id: "b", at: T - 5 }]);
  });

  test("only Prompto sync files are read", () => {
    assert.equal(S.fromSyncFile({ app: "other" }), null);
    assert.equal(S.fromSyncFile(null), null);
  });
});
