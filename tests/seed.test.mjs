import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED } from "../lib/seed.js";
import { DEFAULT_PROFILES, BLOCK_TYPES, lint } from "../lib/render.js";

test("seed recipes reference real profiles, cast members and outfits", () => {
  const ids = new Set(SEED.characters.map((c) => c.id));
  for (const r of SEED.recipes) {
    assert.ok(DEFAULT_PROFILES[r.profile], `${r.id} profile ${r.profile}`);
    for (const b of r.blocks) {
      assert.ok(BLOCK_TYPES.includes(b.type), `${r.id} block ${b.type}`);
      if (b.ref) {
        assert.ok(ids.has(b.ref), `${r.id} ref ${b.ref}`);
        if (b.outfit) assert.ok(SEED.characters.find((c) => c.id === b.ref).outfits[b.outfit], `${r.id} outfit ${b.outfit}`);
      } else {
        assert.ok(Array.isArray(b.tags), `${r.id} ${b.type} has tags`);
      }
    }
  }
});

test("ids and numbers are unique; nextNo is past every recipe number", () => {
  const all = [...SEED.inbox, ...SEED.characters, ...SEED.recipes, ...SEED.snippets].map((x) => x.id);
  assert.equal(new Set(all).size, all.length);
  assert.ok(SEED.recipes.every((r) => r.no < SEED.nextNo));
  assert.equal(new Set(SEED.recipes.map((r) => r.no)).size, SEED.recipes.length);
});

test("seed recipes lint without duplicate or conflict warnings", () => {
  const db = { ...SEED, settings: {} };
  for (const r of SEED.recipes) {
    const issues = lint(r, DEFAULT_PROFILES[r.profile], db).filter((m) => /appears|conflicts|burn/.test(m));
    assert.deepEqual(issues, [], r.id);
  }
});
