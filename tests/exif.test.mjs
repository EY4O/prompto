import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readJpegWebpText, readExif } from "../lib/exif.js";
import { readImageText, readRecipeFromFile, recipeFromText } from "../lib/pngmeta.js";
import { makeJpeg, makeWebp, makePng, tEXt, toArrayBuffer, exifUserComment } from "./helpers.mjs";

const A1111 = "a fox in snow <lora:fox_style:0.8>\nNegative prompt: blurry\nSteps: 20, Sampler: DPM++ 2M Karras, CFG scale: 6, Seed: 42, Size: 832x1216, Model hash: ABCDEF1234, Model: juggernautXL, Lora hashes: \"fox_style: 1234abcd5678\"";
const file = (u8) => ({ arrayBuffer: async () => toArrayBuffer(u8) });

describe("EXIF UserComment", () => {
  test("UTF-16 big-endian (piexif), little-endian and ASCII", () => {
    assert.equal(readExif(exifUserComment("héllo ✓")).UserComment, "héllo ✓");
    assert.equal(readExif(exifUserComment("le text", "unicode-le")).UserComment, "le text");
    assert.equal(readExif(exifUserComment("plain", "ascii")).UserComment, "plain");
  });
  test("not TIFF → {}", () => assert.deepEqual(readExif(new Uint8Array([1, 2, 3])), {}));
});

describe("readJpegWebpText", () => {
  test("JPEG: APP1 EXIF and a COM comment", () => {
    assert.deepEqual(readJpegWebpText(makeJpeg("params", { comment: "hi" })), { format: "jpeg", text: { UserComment: "params", Comment: "hi" } });
  });
  test("WebP: EXIF chunk (odd length, padded)", () => {
    assert.deepEqual(readJpegWebpText(makeWebp("odd length!")), { format: "webp", text: { UserComment: "odd length!" } });
  });
  test("anything else → null", () => {
    assert.equal(readJpegWebpText(makePng()), null);
    assert.equal(readJpegWebpText(new Uint8Array([0, 1, 2, 3])), null);
  });
});

describe("readRecipeFromFile on JPEG / WebP", () => {
  test("A1111 data in a JPEG: hashes kept, sampler mapped", async () => {
    const r = await readRecipeFromFile(file(makeJpeg(A1111)));
    assert.equal(r.format, "A1111");
    assert.equal(r.positive, "a fox in snow");
    assert.equal(r.negative, "blurry");
    assert.deepEqual(r.settings.loras, [{ name: "fox_style", w: 0.8, hash: "1234abcd5678" }]);
    assert.deepEqual(r.settings.modelRef, { hash: "abcdef1234" });
    assert.equal(r.settings.sampler, "dpmpp_2m");
    assert.equal(r.settings.scheduler, "karras");
  });
  test("SwarmUI JSON in a WebP", async () => {
    const r = await readRecipeFromFile(file(makeWebp(JSON.stringify({ sui_image_params: { prompt: "forest", model: "sdxl", seed: 1, steps: 20, loras: ["moody"], loraweights: [0.7] } }))));
    assert.equal(r.format, "SwarmUI");
    assert.deepEqual(r.settings.loras, [{ name: "moody", w: 0.7 }]);
  });
  test("a JPEG with no generation data", async () => {
    assert.deepEqual(await readRecipeFromFile(file(makeJpeg(""))), { format: "none" });
  });
  test("readImageText covers PNG too", async () => {
    assert.deepEqual(await readImageText(toArrayBuffer(makePng([tEXt("parameters", "x")]))), { format: "png", text: { parameters: "x" } });
  });
});

describe("recipeFromText", () => {
  const graph = {
    "3": { class_type: "KSampler", inputs: { seed: 1, steps: 20, cfg: 5, sampler_name: "euler", scheduler: "normal", positive: ["6", 0], negative: ["7", 0], model: ["10", 0] } },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "juggernautXL.safetensors" } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "a fox" } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "blurry" } },
    "10": { class_type: "LoraLoader", inputs: { lora_name: "fox_style.safetensors", strength_model: 0.8, model: ["4", 0] } }
  };
  test("ComfyUI graph + A1111 text: graph settings, hashes from the text", () => {
    const r = recipeFromText({ prompt: JSON.stringify(graph), parameters: A1111 });
    assert.equal(r.format, "ComfyUI");
    assert.equal(r.positive, "a fox");
    assert.deepEqual(r.comfy.pos, { id: "6", key: "text" });
    assert.deepEqual(r.settings.loras, [{ name: "fox_style.safetensors", w: 0.8, hash: "1234abcd5678" }]);
    assert.deepEqual(r.settings.modelRef, { hash: "abcdef1234" });
  });
  test("a ComfyUI graph with NaN in it still reads", () => {
    const r = recipeFromText({ prompt: JSON.stringify(graph).replace('"cfg":5', '"cfg":NaN') });
    assert.equal(r.positive, "a fox");
  });
  test("NovelAI and InvokeAI", () => {
    assert.equal(recipeFromText({ Software: "NovelAI", Comment: '{"prompt":"1girl"}' }).format, "NovelAI");
    assert.equal(recipeFromText({ invokeai_metadata: '{"positive_prompt":"castle"}' }).positive, "castle");
  });
  test("nothing usable → null", () => assert.equal(recipeFromText({ Title: "x" }), null));
});
