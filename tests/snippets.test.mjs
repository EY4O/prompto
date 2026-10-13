import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { wildcardToken, findDuplicate, duplicateGroups, uniqueName, guessCategory, recipesUsing, renameSnippet, renameCategory, mergeSnippets, removeSnippet } from "../lib/snippets.js";
import { SEED } from "../lib/seed.js";

const library = () => JSON.parse(JSON.stringify(SEED));

describe("snippets", () => {
  test("a snippet's wildcard comes from its name", () => {
    assert.equal(wildcardToken("Golden hour"), "__golden_hour__");
    assert.equal(wildcardToken("Safebooru #5192328"), "__safebooru_5192328__");
    assert.equal(wildcardToken("  "), "");
  });

  test("duplicates are found by tag set, in any order and spelling", () => {
    const snippets = [{ id: "a", name: "Rim", cat: "Lighting", tags: ["rim light", "backlighting"], prose: "" }];
    assert.equal(findDuplicate(snippets, { tags: ["Backlighting", "rim_light"] })?.id, "a");
    assert.equal(findDuplicate(snippets, { tags: ["rim light"] }), null);
  });

  test("prose-only snippets are compared by their prose", () => {
    const snippets = [{ id: "p", name: "Mood", cat: "Unsorted", tags: [], prose: "A quiet rainy evening" }];
    assert.equal(findDuplicate(snippets, { prose: "a quiet rainy evening " })?.id, "p");
    assert.equal(findDuplicate(snippets, { prose: "" }), null);
  });

  test("names are kept unique within a category", () => {
    const snippets = [{ id: "a", name: "Safebooru #1", cat: "Scenes" }, { id: "b", name: "Safebooru #1 (2)", cat: "Scenes" }];
    assert.equal(uniqueName(snippets, "Safebooru #1", "Scenes"), "Safebooru #1 (3)");
    assert.equal(uniqueName(snippets, "Safebooru #1", "Lighting"), "Safebooru #1");
    assert.equal(uniqueName(snippets, "Safebooru #1", "Scenes", "a"), "Safebooru #1");
  });

  test("renaming rewrites the wildcard in recipes that used it", () => {
    const db = library();
    const sn = db.snippets.find((x) => x.name === "Golden hour");
    const r = db.recipes[0];
    const b = r.blocks.find((x) => Array.isArray(x.tags));
    b.prose = "at dusk, __golden_hour__";
    b.tags.push({ t: "__golden_hour__", w: 1 });
    assert.deepEqual(recipesUsing(db, "Golden hour").map((x) => x.id), [r.id]);
    const moved = renameSnippet(db, sn.id, "Magic hour");
    assert.deepEqual(moved.map((x) => x.id), [r.id]);
    assert.equal(sn.name, "Magic hour");
    assert.equal(b.prose, "at dusk, __magic_hour__");
    assert.ok(b.tags.some((t) => t.t === "__magic_hour__"));
    assert.equal(recipesUsing(db, "Golden hour").length, 0);
  });

  test("a rename that keeps the same wildcard touches no recipes", () => {
    const db = library();
    const sn = db.snippets.find((x) => x.name === "Golden hour");
    const b = db.recipes[0].blocks.find((x) => Array.isArray(x.tags));
    b.prose = "__golden_hour__";
    assert.deepEqual(renameSnippet(db, sn.id, "golden HOUR"), []);
    assert.equal(b.prose, "__golden_hour__");
  });

  test("removing a snippet", () => {
    const db = library();
    const n = db.snippets.length, id = db.snippets[0].id;
    assert.equal(removeSnippet(db, id).id, id);
    assert.equal(db.snippets.length, n - 1);
    assert.equal(removeSnippet(db, "sn_nobody"), null);
  });
});

describe("snippets: categories and duplicates", () => {
  test("pasted tags get a first guess at their category", () => {
    assert.equal(guessCategory(["chromatic aberration", "film grain", "faded colors", "1990s (style)"]), "Style");
    assert.equal(guessCategory(["rim light", "backlighting", "dark background"]), "Lighting");
    assert.equal(guessCategory(["from below", "cowboy shot", "depth of field"]), "Camera");
    assert.equal(guessCategory(["worst quality", "low quality", "bad anatomy", "watermark"]), "Negative");
    assert.equal(guessCategory(["1girl", "red hair", "school uniform"]), null);
    assert.equal(guessCategory([]), null);
  });

  test("duplicates are grouped by tags or by prose", () => {
    const groups = duplicateGroups([
      { id: "a", tags: ["x", "y"], prose: "" }, { id: "b", tags: ["Y", "x"], prose: "" },
      { id: "c", tags: [], prose: "A calm sea" }, { id: "d", tags: [], prose: "a calm sea" },
      { id: "e", tags: ["z"], prose: "" }, { id: "f", tags: [], prose: "" }
    ]);
    assert.deepEqual(groups.map((g) => g.map((s) => s.id)), [["a", "b"], ["c", "d"]]);
  });

  test("merging keeps one, points wildcards at it and keeps prose", () => {
    const db = library();
    db.snippets.push({ id: "dup1", cat: "Unsorted", name: "Uraraka Ochaco", tags: ["a", "b"], prose: "" },
                     { id: "dup2", cat: "Unsorted", name: "Uraraka copy", tags: ["b", "a"], prose: "round cheeks" });
    const b = db.recipes[0].blocks.find((x) => Array.isArray(x.tags));
    b.prose = "__uraraka_copy__";
    const res = mergeSnippets(db, "dup1", ["dup2"]);
    assert.equal(res.removed, 1);
    assert.ok(!db.snippets.some((s) => s.id === "dup2"));
    assert.equal(db.snippets.find((s) => s.id === "dup1").prose, "round cheeks");
    assert.equal(b.prose, "__uraraka_ochaco__");
  });

  test("renaming a category moves its snippets and its wildcard", () => {
    const db = library();
    const n = db.snippets.filter((s) => s.cat === "Lighting").length;
    const b = db.recipes[0].blocks.find((x) => Array.isArray(x.tags));
    b.prose = "__lighting__";
    const res = renameCategory(db, "Lighting", "Light setups");
    assert.equal(res.moved, n);
    assert.equal(db.snippets.filter((s) => s.cat === "Light setups").length, n);
    assert.equal(b.prose, "__light_setups__");
  });

  test("a category wildcard that a snippet's name shadows is left alone", () => {
    const db = library();
    db.snippets.push({ id: "s1", cat: "Misc", name: "Lighting", tags: ["soft light"], prose: "" });
    const b = db.recipes[0].blocks.find((x) => Array.isArray(x.tags));
    b.prose = "__lighting__";
    renameCategory(db, "Lighting", "Light setups");
    assert.equal(b.prose, "__lighting__");
  });
});
