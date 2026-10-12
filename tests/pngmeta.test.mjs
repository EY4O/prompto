import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readPngText, parseComfy, parseA1111, readRecipeFromFile } from "../lib/pngmeta.js";
import { makePng, toArrayBuffer, tEXt, zTXt, iTXt } from "./helpers.mjs";

describe("readPngText", () => {
  test("not a PNG gives null", async () => {
    assert.equal(await readPngText(new Uint8Array([1, 2, 3]).buffer), null);
    assert.equal(await readPngText(new ArrayBuffer(0)), null);
  });
  test("a PNG with no text chunks gives {}", async () => {
    assert.deepEqual(await readPngText(toArrayBuffer(makePng())), {});
  });
  test("tEXt, zTXt, iTXt (plain and compressed) are all read", async () => {
    const png = makePng([
      tEXt("parameters", "1girl, smile\nSteps: 20"),
      zTXt("prompt", '{"3":{"class_type":"KSampler"}}'),
      iTXt("workflow", "plain é text"),
      iTXt("comment", "compressed ✓ text", { compressed: true, lang: "en", translated: "Kommentar" })
    ]);
    assert.deepEqual(await readPngText(toArrayBuffer(png)), {
      parameters: "1girl, smile\nSteps: 20",
      prompt: '{"3":{"class_type":"KSampler"}}',
      workflow: "plain é text",
      comment: "compressed ✓ text"
    });
  });
  test("tEXt that isn't UTF-8 falls back to latin1", async () => {
    const png = makePng([tEXt("k", "café")]); // a lone 0xE9 byte is invalid UTF-8
    assert.deepEqual(await readPngText(toArrayBuffer(png)), { k: "café" });
  });
});

const ksamplerGraph = () => ({
  "3": { class_type: "KSampler", inputs: { seed: 42, steps: 28, cfg: 5, sampler_name: "euler_ancestral", scheduler: "normal", denoise: 1, model: ["10", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "illustriousXL_v10.safetensors" } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: 832, height: 1216, batch_size: 1 } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "1girl, smile", clip: ["10", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "lowres, bad hands", clip: ["10", 1] } },
  "10": { class_type: "LoraLoader", inputs: { lora_name: "rin.safetensors", strength_model: 0.8, strength_clip: 0.8, model: ["11", 0], clip: ["11", 1] } },
  "11": { class_type: "LoraLoader", inputs: { lora_name: "detail.safetensors", strength_model: 0.5, strength_clip: 1, model: ["4", 0], clip: ["4", 1] } },
  "12": { class_type: "LoraLoaderModelOnly", inputs: { lora_name: "style.safetensors", strength_model: 0.3, model: ["4", 0] } }
});

describe("parseComfy", () => {
  test("KSampler graph: prompts, settings and refs", () => {
    const r = parseComfy(JSON.stringify(ksamplerGraph()));
    assert.equal(r.positive, "1girl, smile");
    assert.equal(r.negative, "lowres, bad hands");
    assert.deepEqual(r.comfy.pos, { id: "6", key: "text" });
    assert.deepEqual(r.comfy.neg, { id: "7", key: "text" });
    assert.deepEqual(r.comfy.seed, { id: "3", key: "seed" });
    assert.deepEqual(r.settings, {
      model: "illustriousXL_v10.safetensors",
      loras: [{ name: "rin.safetensors", w: 0.8 }, { name: "detail.safetensors", w: 0.5 }, { name: "style.safetensors", w: 0.3 }],
      sampler: "euler_ancestral", scheduler: "normal", steps: 28, cfg: 5, seed: 42, width: 832, height: 1216
    });
  });

  test("a ControlNet node between encoder and sampler is followed for the positive", () => {
    const g = ksamplerGraph();
    g["20"] = { class_type: "ControlNetApply", inputs: { conditioning: ["6", 0], control_net: ["21", 0], image: ["22", 0], strength: 1 } };
    g["3"].inputs.positive = ["20", 0];
    const r = parseComfy(g);
    assert.equal(r.positive, "1girl, smile");
    assert.equal(r.negative, "lowres, bad hands");
  });

  test("ControlNetApplyAdvanced: positive is found", () => {
    const g = ksamplerGraph();
    g["20"] = { class_type: "ControlNetApplyAdvanced", inputs: { positive: ["6", 0], negative: ["7", 0], control_net: ["21", 0], image: ["22", 0] } };
    g["3"].inputs.positive = ["20", 0];
    g["3"].inputs.negative = ["20", 1];
    assert.equal(parseComfy(g).positive, "1girl, smile");
  });

  // BUG: comfyTextRef ignores the link's output slot. ControlNetApplyAdvanced's
  // output 1 is the negative, but the walk follows its "positive" input first,
  // lands on the positive encoder, and the same-node check then blanks the negative.
  test("ControlNetApplyAdvanced: negative comes from output slot 1 (lib/pngmeta.js comfyTextRef)", () => {
    const g = ksamplerGraph();
    g["20"] = { class_type: "ControlNetApplyAdvanced", inputs: { positive: ["6", 0], negative: ["7", 0], control_net: ["21", 0], image: ["22", 0] } };
    g["3"].inputs.positive = ["20", 0];
    g["3"].inputs.negative = ["20", 1];
    assert.equal(parseComfy(g).negative, "lowres, bad hands");
  });

  test("Flux: BasicGuider + FluxGuidance + RandomNoise", () => {
    const g = {
      "6": { class_type: "CLIPTextEncode", inputs: { text: "a cat on a windowsill", clip: ["11", 0] } },
      "12": { class_type: "UNETLoader", inputs: { unet_name: "flux1-dev.safetensors", weight_dtype: "default" } },
      "13": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["25", 0], guider: ["22", 0], sampler: ["16", 0], sigmas: ["17", 0], latent_image: ["27", 0] } },
      "16": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
      "17": { class_type: "BasicScheduler", inputs: { scheduler: "simple", steps: 20, denoise: 1, model: ["12", 0] } },
      "22": { class_type: "BasicGuider", inputs: { model: ["12", 0], conditioning: ["26", 0] } },
      "25": { class_type: "RandomNoise", inputs: { noise_seed: 123456 } },
      "26": { class_type: "FluxGuidance", inputs: { guidance: 3.5, conditioning: ["6", 0] } },
      "27": { class_type: "EmptySD3LatentImage", inputs: { width: 1024, height: 768, batch_size: 1 } }
    };
    const r = parseComfy(g);
    assert.equal(r.positive, "a cat on a windowsill");
    assert.equal(r.negative, "");
    assert.deepEqual(r.comfy.seed, { id: "25", key: "noise_seed" });
    assert.equal(r.settings.model, "flux1-dev.safetensors");
    assert.equal(r.settings.cfg, 3.5);
    assert.equal(r.settings.seed, 123456);
    assert.equal(r.settings.sampler, "euler");
    assert.equal(r.settings.scheduler, "simple");
    assert.equal(r.settings.steps, 20);
    assert.equal(r.settings.width, 1024);
  });

  test("negative routed back to the positive encoder gives an empty negative", () => {
    const g = ksamplerGraph();
    g["30"] = { class_type: "ConditioningZeroOut", inputs: { conditioning: ["6", 0] } };
    g["3"].inputs.negative = ["30", 0];
    const r = parseComfy(g);
    assert.equal(r.positive, "1girl, smile");
    assert.equal(r.negative, "");
    assert.equal(r.comfy.neg, null);
  });

  test("model comes from ckpt_name/unet_name, not a detector's model_name", () => {
    const g = ksamplerGraph();
    g["1"] = { class_type: "UltralyticsDetectorProvider", inputs: { model_name: "bbox/face_yolov8m.pt" } };
    assert.equal(parseComfy(g).settings.model, "illustriousXL_v10.safetensors");
    delete g["4"];
    g["40"] = { class_type: "UNETLoader", inputs: { unet_name: "anima.safetensors" } };
    assert.equal(parseComfy(g).settings.model, "anima.safetensors");
    delete g["40"];
    assert.equal(parseComfy(g).settings.model, "bbox/face_yolov8m.pt", "model_name is the last resort");
  });

  test("bare encoders with no sampler: first is positive, second negative", () => {
    const r = parseComfy({
      "1": { class_type: "CLIPTextEncode", inputs: { text: "pos" } },
      "2": { class_type: "CLIPTextEncodeSDXL", inputs: { text_g: "neg", text_l: "neg" } }
    });
    assert.equal(r.positive, "pos");
    assert.equal(r.negative, "neg");
  });
});

describe("parseA1111", () => {
  const text = [
    "masterpiece, 1girl, <lora:rin_v2:0.8>, smile, <lora:detail>",
    "outdoors",
    "Negative prompt: lowres, bad hands",
    "Steps: 28, Sampler: Euler a, Schedule type: Karras, CFG scale: 5.5, Seed: 123, Size: 832x1216, Model hash: abc, Model: illustriousXL_v10, Lora hashes: \"rin_v2: 1a2b, detail: 3c4d\""
  ].join("\n");

  test("positive, negative, LoRAs pulled out of the prompt", () => {
    const r = parseA1111(text);
    assert.equal(r.positive, "masterpiece, 1girl, smile, outdoors");
    assert.equal(r.negative, "lowres, bad hands");
    assert.deepEqual(r.settings.loras, [{ name: "rin_v2", w: 0.8 }, { name: "detail", w: 1 }]);
    assert.ok(!r.positive.includes("<lora"));
  });

  test("settings line", () => {
    const s = parseA1111(text).settings;
    assert.equal(s.model, "illustriousXL_v10");
    assert.equal(s.sampler, "Euler a");
    assert.equal(s.scheduler, "Karras");
    assert.equal(s.steps, 28);
    assert.equal(s.cfg, 5.5);
    assert.equal(s.seed, 123);
    assert.equal(s.width, 832);
    assert.equal(s.height, 1216);
  });

  test("no negative and no settings", () => {
    const r = parseA1111("just a prompt");
    assert.equal(r.positive, "just a prompt");
    assert.equal(r.negative, "");
    assert.equal(r.settings.steps, undefined);
    assert.deepEqual(r.settings.loras, []);
  });
});

describe("readRecipeFromFile", () => {
  const file = (u8) => ({ arrayBuffer: async () => toArrayBuffer(u8) });
  test("format detection by chunk", async () => {
    assert.equal((await readRecipeFromFile(file(makePng([tEXt("prompto", '{"app":"prompto"}')])))).format, "prompto");
    const comfy = await readRecipeFromFile(file(makePng([tEXt("prompt", JSON.stringify(ksamplerGraph())), tEXt("workflow", "{}")])));
    assert.equal(comfy.format, "ComfyUI");
    assert.equal(comfy.positive, "1girl, smile");
    assert.equal(comfy.workflow, "{}");
    const a = await readRecipeFromFile(file(makePng([tEXt("parameters", "cat\nSteps: 20")])));
    assert.equal(a.format, "A1111");
    assert.equal(a.settings.steps, 20);
    assert.deepEqual(await readRecipeFromFile(file(makePng())), { format: "none" });
    assert.equal(await readRecipeFromFile(file(new Uint8Array([0, 1, 2]))), null);
  });
});
