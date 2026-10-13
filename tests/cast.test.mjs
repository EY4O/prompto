import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { removeCharacter } from "../lib/cast.js";
import { render, DEFAULT_PROFILES } from "../lib/render.js";
import { SEED } from "../lib/seed.js";

const library = () => JSON.parse(JSON.stringify(SEED));

describe("cast: removing a character", () => {
  test("removes the character and the recipe blocks that used them", () => {
    const db = library();
    const using = db.recipes.filter((r) => r.blocks.some((b) => b.type === "character" && b.ref === "chr_rin"));
    assert.ok(using.length, "the sample library has a recipe with Rin");
    const res = removeCharacter(db, "chr_rin");
    assert.equal(res.character.name, "Rin Aozora");
    assert.deepEqual(res.recipes.map((r) => r.id), using.map((r) => r.id));
    assert.ok(!db.characters.some((c) => c.id === "chr_rin"));
    assert.ok(!db.recipes.some((r) => r.blocks.some((b) => b.ref === "chr_rin")));
  });

  test("leaves other characters and recipes alone", () => {
    const db = library();
    const vale = JSON.stringify(db.recipes.find((r) => r.blocks.some((b) => b.ref === "chr_vale")));
    removeCharacter(db, "chr_rin");
    assert.equal(JSON.stringify(db.recipes.find((r) => r.blocks.some((b) => b.ref === "chr_vale"))), vale);
    assert.equal(db.characters.length, SEED.characters.length - 1);
  });

  test("a recipe that used the character still renders, without their tags", () => {
    const db = library();
    const r = db.recipes.find((x) => x.blocks.some((b) => b.ref === "chr_rin"));
    removeCharacter(db, "chr_rin");
    const profile = DEFAULT_PROFILES.illustrious;
    const out = render(r, profile, db);
    assert.ok(!out.positive.includes("rin_aozora"));
  });

  test("an unknown id changes nothing", () => {
    const db = library();
    assert.equal(removeCharacter(db, "chr_nobody"), null);
    assert.deepEqual(db, library());
  });
});

describe("cast: sorting", () => {
  test("A–Z, most used and the library's own order", async () => {
    const { sortCast, seriesOf } = await import("../lib/cast.js");
    const db = library();
    const names = (l) => l.map((c) => c.name);
    assert.deepEqual(names(sortCast(db.characters, db, "added")), names(db.characters));
    assert.deepEqual(names(sortCast(db.characters, db, "az")), ["Captain Vale", "Hatsune Miku", "Rin Aozora"]);
    db.recipes.push({ id: "r9", blocks: [{ type: "character", ref: "chr_miku" }] }, { id: "r10", blocks: [{ type: "character", ref: "chr_miku" }] });
    assert.equal(sortCast(db.characters, db, "used")[0].name, "Hatsune Miku");
    assert.equal(seriesOf({ series: "  " }), "Original");
  });
});
