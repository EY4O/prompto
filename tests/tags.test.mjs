// Only the pure parts of lib/tags.js; the IndexedDB functions need a browser.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseTagCsv, displayName, searchLibrary, libraryTags, formatCount } from "../lib/tags.js";

describe("parseTagCsv", () => {
  const csv = [
    "name,category,count,aliases",
    '1girl,0,6000000,"1girls,sole_female"',
    "^_^,0,5000,",
    "",
    "long_hair,0,4000000,longhair",
    'hatsune_miku,4,90000,"miku,hatsune_miku_(cosplay)"',
    "o_o,0,300"
  ].join("\r\n");

  test("header row skipped, underscores become spaces, emoticons keep theirs", () => {
    const r = parseTagCsv(csv);
    assert.deepEqual(r.names, ["1girl", "^_^", "long hair", "hatsune miku", "o_o"]);
    assert.deepEqual(r.cats, [0, 0, 0, 4, 0]);
    assert.deepEqual(r.counts, [6000000, 5000, 4000000, 90000, 300]);
  });
  test("aliases are split, cleaned and rejoined", () => {
    assert.deepEqual(parseTagCsv(csv).aliases, ["1girls,sole female", "", "longhair", "miku,hatsune miku (cosplay)", ""]);
  });
  test("a tag literally named 'name' with a count is kept", () => {
    assert.deepEqual(parseTagCsv("name,0,12").names, ["name"]);
  });
});

test("displayName", () => {
  assert.equal(displayName("long_hair"), "long hair");
  assert.equal(displayName("^_^"), "^_^");
  assert.equal(displayName(">_<"), ">_<");
  assert.equal(displayName("___"), "___");
});

describe("libraryTags / searchLibrary", () => {
  const db = {
    recipes: [
      { blocks: [{ tags: [{ t: "long hair" }, { t: "hair ribbon" }] }, { tags: [] }] },
      { blocks: [{ tags: [{ t: "long hair" }] }, {}] }
    ],
    characters: [{ appearance: ["long hair", "red eyes"], outfits: { a: { tags: ["hairband"] } } }],
    snippets: [{ tags: ["hair bun"] }],
    profiles: { x: { prefix: ["masterpiece"] } }
  };

  test("libraryTags counts uses across the library", () => {
    const idx = libraryTags(db);
    const uses = Object.fromEntries(idx.map((t) => [t.name, t.uses]));
    assert.deepEqual(uses, { "long hair": 3, "hair ribbon": 1, "red eyes": 1, hairband: 1, "hair bun": 1, masterpiece: 1 });
  });

  test("prefix matches rank above word matches, then by uses", () => {
    const idx = libraryTags(db);
    const hits = searchLibrary(idx, "hair");
    assert.deepEqual(hits.map((h) => h.name), ["hair ribbon", "hairband", "hair bun", "long hair"]);
    assert.deepEqual(hits[3], { name: "long hair", cat: -1, count: 3, source: "yours" });
    assert.deepEqual(searchLibrary(idx, "hair", 2).map((h) => h.name), ["hair ribbon", "hairband"]);
  });

  test("word matches need at least three characters", () => {
    const idx = libraryTags(db);
    assert.deepEqual(searchLibrary(idx, "ha").map((h) => h.name), ["hair ribbon", "hairband", "hair bun"]);
    assert.deepEqual(searchLibrary(idx, "re").map((h) => h.name), ["red eyes"]);
    assert.deepEqual(searchLibrary(idx, "  "), []);
  });

  test("underscores in the query match spaces", () => {
    assert.deepEqual(searchLibrary(libraryTags(db), "long_h").map((h) => h.name), ["long hair"]);
  });
});

test("formatCount", () => {
  assert.equal(formatCount(1, "yours"), "used once");
  assert.equal(formatCount(3, "yours"), "used 3×");
  assert.equal(formatCount(0, "lora"), "LoRA");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(1000), "1k");
  assert.equal(formatCount(1500), "1.5k");
  assert.equal(formatCount(15400), "15k");
  assert.equal(formatCount(2000000), "2M");
  assert.equal(formatCount(6400000), "6.4M");
});
