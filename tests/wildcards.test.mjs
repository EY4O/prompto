import { test } from "node:test";
import assert from "node:assert/strict";
import { expand, seededRandom, slug, hasWildcards, wildcardNames } from "../lib/wildcards.js";

const outcomes = (text, lookup, n = 200) => new Set(Array.from({ length: n }, (_, i) => expand(text, seededRandom(i), lookup)));

test("expansion is deterministic per seed", () => {
  const text = "{red|blue|green|silver} hair, {smile|frown}";
  for (const seed of [0, 1, 42, "roll-7"]) assert.equal(expand(text, seededRandom(seed)), expand(text, seededRandom(seed)));
  assert.ok(outcomes(text).size > 1, "different seeds give different results");
});

test("seededRandom yields values in [0, 1)", () => {
  const rng = seededRandom(123);
  for (let i = 0; i < 100; i++) { const v = rng(); assert.ok(v >= 0 && v < 1); }
});

test("nested choices", () => {
  const seen = outcomes("{a {big|small} cat|a dog}");
  assert.deepEqual([...seen].sort(), ["a big cat", "a dog", "a small cat"]);
});

test("an empty option leaves no doubled commas", () => {
  const seen = outcomes("red, {|shiny}, hat");
  assert.deepEqual([...seen].sort(), ["red, hat", "red, shiny, hat"]);
  assert.deepEqual([...outcomes("{|shiny}, hat")].sort(), ["hat", "shiny, hat"]);
});

test("named wildcards use the lookup; unknown names are left as written", () => {
  const lookup = (n) => (n === "hair_color" ? ["silver hair", "{pink|blue} hair"] : null);
  const seen = outcomes("__hair_color__, __nope__", lookup);
  assert.deepEqual([...seen].sort(), ["blue hair, __nope__", "pink hair, __nope__", "silver hair, __nope__"]);
  assert.equal(expand("__x__", seededRandom(1)), "__x__", "no lookup at all");
  assert.equal(expand("__x__", seededRandom(1), () => []), "__x__", "empty entries");
});

test("text without wildcards is unchanged", () => {
  assert.equal(expand("1girl, smile", seededRandom(1)), "1girl, smile");
  assert.equal(expand(null, seededRandom(1)), "");
});

test("hasWildcards / wildcardNames / slug", () => {
  assert.equal(hasWildcards("{a|b}"), true);
  assert.equal(hasWildcards("__hair__"), true);
  assert.equal(hasWildcards("{a} b"), false);
  assert.equal(hasWildcards(undefined), false);
  assert.deepEqual(wildcardNames("__a__ and __b-c__"), ["a", "b-c"]);
  assert.equal(slug("Hair Color!"), "hair_color");
  assert.equal(slug("  --Outfits / Summer-- "), "outfits_summer");
});
