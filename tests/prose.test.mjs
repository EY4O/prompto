import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { proseFromTags, fillTemplate, joinAnd, slotsFor, DEFAULT_TEMPLATES } from "../lib/prose.js";

describe("proseFromTags: character", () => {
  test("hair length + colour + style merge into one phrase", () => {
    assert.equal(proseFromTags("character", ["long hair", "silver hair", "twin braids"]), "a person with long silver hair in twin braids");
  });
  test("count tag sets who", () => {
    assert.equal(proseFromTags("character", ["1girl", "red eyes"]), "a girl with red eyes");
  });
  test("1boy + mature male reads as a man", () => {
    assert.equal(proseFromTags("character", ["1boy", "mature male", "short black hair", "grey eyes"]), "a man with short black hair and grey eyes");
  });
  test("species: elf + 1girl is an elf girl", () => {
    assert.equal(proseFromTags("character", ["1girl", "elf", "pointy ears"]), "an elf girl with pointy ears");
  });
  test("kemono tag replaces who", () => {
    assert.equal(proseFromTags("character", ["1girl", "cat girl"]), "a cat girl");
  });
  test("{name} comes from extra slots", () => {
    assert.equal(proseFromTags("character", ["1girl", "blue eyes"], null, { name: "Rin" }), "Rin, a girl with blue eyes");
  });
  test("heterochromia", () => {
    assert.equal(proseFromTags("character", ["heterochromia", "red eyes", "blue eyes"]), "a person with heterochromatic red and blue eyes");
  });
  test("muted tags ({t, off}) are ignored", () => {
    assert.equal(proseFromTags("character", [{ t: "1girl" }, { t: "red eyes", off: true }]), "a girl");
  });
  // BUG: the AGE replacement swaps "boys" for the singular "man", giving "two man".
  test("2boys + mature male reads as two men (lib/prose.js characterSlots AGE plural)", () => {
    assert.equal(proseFromTags("character", ["2boys", "mature male"]), "two men");
  });
});

describe("proseFromTags: other block types", () => {
  test("outfit drops the generic tag when a specific one exists", () => {
    assert.equal(proseFromTags("outfit", ["capelet", "white capelet", "earrings"]), "wearing a white capelet and earrings");
  });
  test("outfit articles: dresses, plurals and mass nouns", () => {
    assert.equal(proseFromTags("outfit", ["black dress", "gloves", "jewelry", "oversized hoodie"]), "wearing a black dress, gloves, jewelry and an oversized hoodie");
  });
  test("scene place and time", () => {
    assert.equal(proseFromTags("scene", ["city", "alley", "night"]), "a city alley at night");
    assert.equal(proseFromTags("scene", ["night", "city", "alley", "rain", "wet street"]), "a city alley at night with rain and wet street");
  });
  test("camera uses the phrase dictionary", () => {
    assert.equal(proseFromTags("camera", ["from behind", "cowboy shot", "depth of field"]), "seen from behind, a cowboy shot and a shallow depth of field");
  });
  test("lighting and style templates", () => {
    assert.equal(proseFromTags("lighting", ["rim light"]), "lit by a rim light");
    assert.equal(proseFromTags("style", ["watercolor"]), "in a watercolor style");
  });
  test("everything dropped gives an empty string", () => {
    assert.equal(proseFromTags("character", ["solo", "masterpiece", "white background"]), "");
    assert.equal(proseFromTags("scene", []), "");
    assert.equal(proseFromTags("pose", null), "");
  });
  test("custom templates override the defaults", () => {
    assert.equal(proseFromTags("outfit", ["red scarf"], { outfit: "dressed in {items}" }), "dressed in a red scarf");
  });
});

describe("fillTemplate", () => {
  test("optional [..] sections drop when a slot inside is empty", () => {
    assert.equal(fillTemplate(DEFAULT_TEMPLATES.character, { who: "a girl" }), "a girl");
    assert.equal(fillTemplate(DEFAULT_TEMPLATES.character, { name: "Rin", who: "a girl", appearance: "red eyes" }), "Rin, a girl with red eyes");
  });
  test("sections with several slots need all of them", () => {
    assert.equal(fillTemplate("[{a} and {b}] end", { a: "x" }), "end");
    assert.equal(fillTemplate("[{a} and {b}] end", { a: "x", b: "y" }), "x and y end");
  });
  test("tidies whitespace and stray commas", () => {
    assert.equal(fillTemplate("{a} , {b}", { a: "x", b: "" }), "x");
  });
});

describe("joinAnd / slotsFor", () => {
  test("joinAnd", () => {
    assert.equal(joinAnd([]), "");
    assert.equal(joinAnd(["a"]), "a");
    assert.equal(joinAnd(["a", "", "b"]), "a and b");
    assert.equal(joinAnd(["a", "b", "c"]), "a, b and c");
  });
  test("slotsFor character exposes hair/eyes/features separately", () => {
    const s = slotsFor("character", ["1girl", "long hair", "blonde hair", "green eyes", "freckles"]);
    assert.equal(s.who, "a girl");
    assert.equal(s.hair, "long blonde hair");
    assert.equal(s.eyes, "green eyes");
    assert.equal(s.features, "freckles");
  });
});
