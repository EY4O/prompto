import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readPngText, parseComfy, parseA1111, readRecipeFromFile, recipeFromText } from "../lib/pngmeta.js";
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

  test("positive, negative, LoRAs pulled out of the prompt (with their Lora hashes)", () => {
    const r = parseA1111(text);
    assert.equal(r.positive, "masterpiece, 1girl, smile, outdoors");
    assert.equal(r.negative, "lowres, bad hands");
    assert.deepEqual(r.settings.loras, [{ name: "rin_v2", w: 0.8, hash: "1a2b" }, { name: "detail", w: 1, hash: "3c4d" }]);
    assert.ok(!r.positive.includes("<lora"));
  });

  test("settings line, sampler mapped to ComfyUI names", () => {
    const s = parseA1111(text).settings;
    assert.equal(s.model, "illustriousXL_v10");
    assert.equal(s.sampler, "euler_ancestral");
    assert.equal(s.scheduler, "karras");
    assert.deepEqual(s.modelRef, { hash: "abc" });
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

describe("parseComfy LoRA loaders", () => {
  test("rgthree rows, LoRA Manager lists and lora_name_N stacks (off entries skipped)", () => {
    const g = {
      "1": { class_type: "Power Lora Loader (rgthree)", inputs: { lora_1: { on: true, lora: "Krea 2\iiyo.safetensors", strength: 0.75 }, lora_2: { on: false, lora: "off.safetensors", strength: 1 }, "➕ Add Lora": "" } },
      "2": { class_type: "Lora Loader (LoraManager)", inputs: { text: "<lora:a:1>", loras: { __value__: [{ name: "lm_one", strength: 0.6, active: true }, { name: "lm_off", strength: 1, active: false }] } } },
      "3": { class_type: "CR LoRA Stack", inputs: { switch_1: "On", lora_name_1: "stack_a.safetensors", model_weight_1: 0.4, switch_2: "Off", lora_name_2: "stack_off.safetensors", lora_name_3: "None" } },
      "4": { class_type: "LoRA Stacker", inputs: { lora_name_1: "eff.safetensors", lora_wt_1: 0.9 } },
      "5": { class_type: "CLIPTextEncode", inputs: { text: "x" } }
    };
    assert.deepEqual(parseComfy(g).settings.loras, [
      { name: "Krea 2\iiyo.safetensors", w: 0.75 }, { name: "lm_one", w: 0.6 }, { name: "stack_a.safetensors", w: 0.4 }, { name: "eff.safetensors", w: 0.9 }
    ]);
  });
});

describe("pngmeta: tangled ComfyUI graphs", () => {
  // The shape of a real Civitai upload: the prompt goes through Impact's wildcard
  // processor, a text join with LoRA Manager trigger words, a regex and switches.
  const graph = {
    "57": { class_type: "ImpactWildcardProcessor", inputs: { wildcard_text: "1girl, {red|blue} eyes", populated_text: "1girl, red eyes", mode: "reproduce" } },
    "59": { class_type: "ImpactWildcardProcessor", inputs: { wildcard_text: "worst quality", populated_text: "worst quality" } },
    "58": { class_type: "Lora Loader (LoraManager)", inputs: { text: "", loras: { __value__: [] } } },
    "92": { class_type: "TriggerWord Toggle (LoraManager)", inputs: { trigger_words: ["58", 2] } },
    "83": { class_type: "StringConcatenate", inputs: { string_a: ["92", 0], string_b: ["57", 0], delimiter: "," } },
    "93": { class_type: "ImpactSwitch", inputs: { select: 1, input1: ["83", 0], input2: ["57", 0] } },
    "96": { class_type: "RegexReplace", inputs: { string: ["93", 0], regex_pattern: "^,|,$" } },
    "102": { class_type: "CLIPTextEncode", inputs: { text: ["96", 0], clip: ["4", 1] } },
    "80": { class_type: "ImpactSwitch", inputs: { select: 1, input1: ["102", 0] } },
    "106": { class_type: "CLIPTextEncode", inputs: { text: ["59", 0], clip: ["4", 1] } },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "fabricatedXL_v70.safetensors" } },
    "111": { class_type: "KSampler", inputs: { seed: 7, steps: 28, cfg: 6, sampler_name: "euler_ancestral", scheduler: "normal", positive: ["80", 0], negative: ["106", 0], model: ["4", 0] } }
  };

  test("follows switches, text joins, regexes and wildcard processors", () => {
    const c = parseComfy(graph);
    assert.equal(c.positive, "1girl, red eyes");
    assert.equal(c.negative, "worst quality");
    assert.deepEqual(c.comfy.pos, { id: "57", key: "populated_text" });
  });

  test("a join with text on both sides keeps both", () => {
    const g = structuredClone(graph);
    g["83"].inputs.string_a = "megumin";
    assert.equal(parseComfy(g).positive, "megumin,1girl, red eyes");
  });

  test("falls back to the A1111 parameters when the graph can't be traced", () => {
    const g = { "1": { class_type: "Mystery", inputs: { x: ["2", 0] } }, "3": { class_type: "KSampler", inputs: { positive: ["1", 0], negative: ["1", 1], seed: 1 } } };
    const meta = recipeFromText({ prompt: JSON.stringify(g), parameters: "1girl, smile\nNegative prompt: lowres\nSteps: 20, Sampler: Euler a, Seed: 1" });
    assert.equal(meta.format, "ComfyUI");
    assert.equal(meta.positive, "1girl, smile");
    assert.equal(meta.negative, "lowres");
  });

  test("NaN in the graph JSON doesn't stop the import", () => {
    const text = JSON.stringify(graph).replace('"seed":7', '"seed":7,"is_changed":NaN');
    assert.equal(recipeFromText({ prompt: text }).positive, "1girl, red eyes");
  });
});
