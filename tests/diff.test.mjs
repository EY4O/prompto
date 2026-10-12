import { test } from "node:test";
import assert from "node:assert/strict";
import { tagDiff, wordDiff, settingsDiff, changed } from "../lib/diff.js";

test("tagDiff: tag by tag, case-insensitive", () => {
  assert.deepEqual(tagDiff("1girl, smile, outdoors", "1girl, Outdoors, night"), [
    { op: "same", v: "1girl" }, { op: "del", v: "smile" }, { op: "same", v: "Outdoors" }, { op: "add", v: "night" }
  ]);
  assert.equal(changed(tagDiff("a, b", "A,\nB")), false);
  assert.deepEqual(tagDiff("", "a"), [{ op: "add", v: "a" }]);
  assert.deepEqual(tagDiff("a", null), [{ op: "del", v: "a" }]);
});

test("wordDiff: word by word, whitespace matched loosely", () => {
  const ops = wordDiff("the red cat", "the  blue cat");
  assert.deepEqual(ops.filter((o) => o.op !== "same"), [{ op: "del", v: "red" }, { op: "add", v: "blue" }]);
  assert.equal(ops.map((o) => (o.op === "del" ? "" : o.v)).join(""), "the  blue cat");
  assert.equal(changed(wordDiff("a cat\nsat", "a cat sat")), false);
});

test("settingsDiff lists only changed settings", () => {
  const a = { model: "m.safetensors", steps: 20, loras: [] };
  const b = { model: "m.safetensors", steps: 30, loras: [{ name: "x", w: 0.8 }], seed: 7 };
  assert.deepEqual(settingsDiff(a, b), [["loras", "none", "x:0.8"], ["steps", 20, 30], ["seed", "—", 7]]);
  assert.deepEqual(settingsDiff(), []);
  assert.deepEqual(settingsDiff({ cfg: 5 }, { cfg: "5" }), [], "compared as strings");
});
