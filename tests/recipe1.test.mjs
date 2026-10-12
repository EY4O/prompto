import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as R1 from "../lib/recipe1.js";

// Partial match: objects list only the keys that must match; arrays match in length and order.
function partial(actual, expected, path = "") {
  if (expected === null || typeof expected !== "object") return assert.deepEqual(actual, expected, path);
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path} should be a list`);
    assert.equal(actual.length, expected.length, `${path} length`);
    return expected.forEach((e, i) => partial(actual[i], e, `${path}[${i}]`));
  }
  assert.ok(actual && typeof actual === "object", `${path} should be an object, got ${JSON.stringify(actual)}`);
  for (const [k, v] of Object.entries(expected)) partial(actual[k], v, path ? `${path}.${k}` : k);
}

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/recipe1.json", import.meta.url), "utf8"));

describe("shared recipe/1 fixtures (also run by Model Librarian)", () => {
  for (const c of fixtures.cases) {
    test(c.name, () => {
      const rec = c.civitai ? R1.fromCivitaiItem(c.civitai, c.page || null) : R1.fromText(c.text);
      partial(rec, c.expect);
      assert.doesNotThrow(() => JSON.stringify(rec));
    });
  }
});

describe("toMeta / fromMeta", () => {
  test("model and LoRA references survive the round trip through Prompto's shape", () => {
    const c = fixtures.cases.find((x) => x.civitai);
    const meta = R1.toMeta(R1.fromCivitaiItem(c.civitai, c.page), "Civitai");
    assert.deepEqual(meta.settings.loras, [{ name: "watercolor_v3", w: 0.8, hash: "aaaa1111bb", versionId: 111, label: "Watercolor Wash" }]);
    assert.deepEqual(meta.settings.modelRef, { hash: "1a2b3c4d5e", versionId: 999 });
    assert.equal(meta.settings.baseModel, "Illustrious");
    const back = R1.fromMeta({ ...meta, title: "T" });
    assert.equal(back.schema, "recipe/1");
    assert.deepEqual([back.model.file, back.model.hash, back.model.civitai_version_id], ["illustriousXL_v20", "1a2b3c4d5e", 999]);
    partial(back.loras, [{ file: "watercolor_v3", name: "Watercolor Wash", display_name: "Watercolor Wash", hash: "aaaa1111bb", civitai_version_id: 111, weight: 0.8 }]);
  });
  test("a plain Prompto recipe has no references to lose", () => {
    const back = R1.fromMeta({ settings: { model: "x.safetensors", loras: [{ name: "Illustrious\\a.safetensors", w: 0.6 }], steps: 20 } }, { positive: "p" });
    partial(back, { prompt: { positive: "p" }, settings: { steps: 20 }, model: { file: "x.safetensors", name: "x", hash: null }, loras: [{ file: "Illustrious\\a.safetensors", name: "a", weight: 0.6 }] });
  });
});

describe("helpers", () => {
  test("mapSampler", () => {
    assert.deepEqual(R1.mapSampler("DPM++ 2M SDE GPU Karras"), { sampler: "dpmpp_2m_sde_gpu", scheduler: "karras" });
    assert.deepEqual(R1.mapSampler("Euler", "Automatic"), { sampler: "euler", scheduler: "" });
  });
  test("loads turns NaN and Infinity into null", () => {
    assert.deepEqual(R1.loads('{"a": NaN, "b": [1, -Infinity], "c": "NaN"}'), { a: null, b: [1, null], c: "NaN" });
  });
  test("LoRA tags come out with their separators", () => {
    const list = [];
    assert.equal(R1.takeLoraTags("a, <lora:x:0.5>, b <lyco:y:1:0.4> c", list), "a, b c");
    assert.deepEqual(list.map((l) => [l.file, l.weight, l.clip_weight]), [["x", 0.5, null], ["y", 1, 0.4]]);
  });
});
