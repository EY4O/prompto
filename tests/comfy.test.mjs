import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { comfyApply, parseLoraList, normalizeBase, originPattern, DEFAULT_COMFY } from "../lib/comfy.js";

// ---------- a tiny LiteGraph stand-in ----------
const widget = (name, value, extra = {}) => ({
  name, value, ...extra, calls: [],
  callback(v) { this.calls.push(v); }
});
const combo = (name, value, values) => widget(name, value, { type: "combo", options: { values } });

function node(id, type, { widgets = [], inputs = [], title } = {}) {
  const n = {
    id, type, title, widgets, mode: 0, links: {},
    inputs: inputs.map((name) => ({ name })),
    getInputNode(slot) { return this.links[this.inputs[slot].name] || null; }
  };
  return n;
}
const link = (to, input, from) => { to.links[input] = from; };

let saved;
let dirtied;
function install(nodes, { selected = {}, active = null, extraWindow = {} } = {}) {
  dirtied = 0;
  globalThis.window = {
    app: {
      graph: { _nodes: nodes, setDirtyCanvas() { dirtied++; } },
      canvas: { selected_nodes: selected, setDirty() {} }
    },
    ...extraWindow
  };
  globalThis.document = { activeElement: active };
}
beforeEach(() => { saved = { window: globalThis.window, document: globalThis.document }; });
afterEach(() => {
  if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window;
  if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
});

function sdxlWorkflow() {
  const ckpt = node(1, "CheckpointLoaderSimple", { widgets: [combo("ckpt_name", "old.safetensors", ["old.safetensors", "illustrious/illustriousXL_v10.safetensors"])] });
  const loraValues = ["rin_aozora_v2.safetensors", "detail.safetensors", "old.safetensors"];
  const loraNode = (id, val, mode = 0) => {
    const n = node(id, "LoraLoader", { widgets: [combo("lora_name", val, loraValues), widget("strength_model", 1), widget("strength_clip", 1)] });
    n.mode = mode;
    return n;
  };
  const l10 = loraNode(10, "old.safetensors", 4), l11 = loraNode(11, "old.safetensors"), l12 = loraNode(12, "detail.safetensors");
  const pos = node(6, "CLIPTextEncode", { title: "Positive", widgets: [widget("text", "old positive", { type: "customtext" })], inputs: ["clip"] });
  const neg = node(7, "CLIPTextEncode", { title: "Negative", widgets: [widget("text", "old negative", { type: "customtext" })], inputs: ["clip"] });
  const latent = node(5, "EmptyLatentImage", { widgets: [widget("width", 512), widget("height", 512), widget("batch_size", 1)] });
  const samplerWidgets = (steps) => [
    widget("seed", 1), widget("control_after_generate", "fixed"), widget("steps", steps), widget("cfg", 7),
    combo("sampler_name", "euler", ["euler", "euler_ancestral"]), combo("scheduler", "normal", ["normal", "karras"]), widget("denoise", 1)
  ];
  const k1 = node(3, "KSampler", { widgets: samplerWidgets(20), inputs: ["model", "positive", "negative", "latent_image"] });
  const k2 = node(20, "KSampler", { title: "Hires", widgets: samplerWidgets(12), inputs: ["model", "positive", "negative", "latent_image"] });
  for (const k of [k1, k2]) { link(k, "positive", pos); link(k, "negative", neg); }
  // deliberately out of id order, and the hires sampler after the first
  const nodes = [ckpt, l12, latent, pos, neg, k1, l10, k2, l11];
  return { nodes, ckpt, l10, l11, l12, pos, neg, latent, k1, k2 };
}

const recipePayload = (over = {}) => ({
  positive: "1girl, smile", negative: "lowres",
  settings: {
    seed: 918273645, steps: 28, cfg: 5, sampler: "euler_ancestral", scheduler: "karras",
    model: "illustriousXL_v10.safetensors", width: 832, height: 1216,
    loras: [{ name: "rin_aozora_v2.safetensors", w: 0.8 }, { name: "missing_lora.safetensors", w: 1 }]
  },
  ...over
});

describe("comfyApply: recipe mode", () => {
  test("sets prompt, negative and settings on the first sampler only", () => {
    const g = sdxlWorkflow();
    install(g.nodes);
    const res = comfyApply(recipePayload());
    assert.equal(res.ok, true);
    assert.equal(g.pos.widgets[0].value, "1girl, smile");
    assert.deepEqual(g.pos.widgets[0].calls, ["1girl, smile"]);
    assert.equal(g.neg.widgets[0].value, "lowres");
    const w = (n, name) => n.widgets.find((x) => x.name === name).value;
    assert.equal(w(g.k1, "seed"), 918273645);
    assert.equal(w(g.k1, "steps"), 28);
    assert.equal(w(g.k1, "cfg"), 5);
    assert.equal(w(g.k1, "sampler_name"), "euler_ancestral");
    assert.equal(w(g.k1, "scheduler"), "karras");
    // the hires pass keeps its own values
    assert.equal(w(g.k2, "steps"), 12);
    assert.equal(w(g.k2, "seed"), 1);
    assert.equal(w(g.k2, "sampler_name"), "euler");
    // model matched by file name inside a folder
    assert.equal(w(g.ckpt, "ckpt_name"), "illustrious/illustriousXL_v10.safetensors");
    assert.equal(w(g.latent, "width"), 832);
    assert.equal(w(g.latent, "height"), 1216);
    assert.deepEqual(res.applied, ["prompt", "negative", "seed", "steps", "CFG", "sampler", "scheduler", "model", "size", "1 LoRA"]);
    assert.ok(dirtied > 0, "canvas marked dirty");
  });

  test("LoRA loaders fill in id order; missing and unused ones are bypassed", () => {
    const g = sdxlWorkflow();
    install(g.nodes);
    const res = comfyApply(recipePayload());
    const w = (n, name) => n.widgets.find((x) => x.name === name).value;
    assert.equal(w(g.l10, "lora_name"), "rin_aozora_v2.safetensors");
    assert.equal(w(g.l10, "strength_model"), 0.8);
    assert.equal(w(g.l10, "strength_clip"), 0.8);
    assert.equal(g.l10.mode, 0, "a bypassed loader that gets a LoRA is re-enabled");
    assert.equal(g.l11.mode, 4, "missing LoRA → bypassed");
    assert.equal(w(g.l11, "lora_name"), "old.safetensors", "left alone");
    assert.equal(g.l12.mode, 4, "unused → bypassed");
    assert.deepEqual(res.warnings, ["missing_lora isn't installed, so its loader is bypassed", "bypassed 1 unused LoRA loader"]);
  });

  test("more LoRAs than loaders warns", () => {
    const g = sdxlWorkflow();
    install(g.nodes);
    const loras = ["rin_aozora_v2", "detail", "old", "detail"].map((name) => ({ name, w: 1 }));
    const res = comfyApply(recipePayload({ settings: { loras } }));
    assert.ok(res.warnings.includes("1 more LoRA loader node needed"), res.warnings.join(" | "));
    assert.ok(res.applied.includes("3 LoRAs"));
  });

  test("values not in a combo's options are skipped", () => {
    const g = sdxlWorkflow();
    install(g.nodes);
    const res = comfyApply(recipePayload({ settings: { sampler: "dpmpp_9m", model: "nope.safetensors" } }));
    assert.equal(g.k1.widgets.find((x) => x.name === "sampler_name").value, "euler");
    assert.equal(g.ckpt.widgets[0].value, "old.safetensors");
    assert.ok(!res.applied.includes("sampler") && !res.applied.includes("model"));
  });

  test("Flux encoder: both clip_l and t5xxl get the prompt via guider → FluxGuidance", () => {
    const enc = node(6, "CLIPTextEncodeFlux", { widgets: [widget("clip_l", "", { options: { multiline: true } }), widget("t5xxl", "", { options: { multiline: true } }), widget("guidance", 3.5)], inputs: ["clip"] });
    const fg = node(26, "FluxGuidance", { widgets: [widget("guidance", 3.5)], inputs: ["conditioning"] });
    const guider = node(22, "BasicGuider", { inputs: ["model", "conditioning"] });
    const noise = node(25, "RandomNoise", { widgets: [widget("noise_seed", 0)] });
    const unet = node(12, "UNETLoader", { widgets: [combo("unet_name", "a.safetensors", ["a.safetensors", "flux1-dev.safetensors"])] });
    link(fg, "conditioning", enc);
    link(guider, "conditioning", fg);
    install([unet, noise, guider, fg, enc]);
    const res = comfyApply({ positive: "a cat on a windowsill", negative: "ignored", settings: { seed: 99, model: "flux1-dev.safetensors" } });
    assert.equal(res.ok, true);
    assert.equal(enc.widgets[0].value, "a cat on a windowsill");
    assert.equal(enc.widgets[1].value, "a cat on a windowsill");
    assert.equal(enc.widgets[2].value, 3.5);
    assert.equal(noise.widgets[0].value, 99);
    assert.equal(unet.widgets[0].value, "flux1-dev.safetensors");
    assert.ok(!res.applied.includes("negative"));
  });

  test("errors when no prompt node can be found", () => {
    install([node(1, "Note", { widgets: [widget("text", "hello")] })]);
    assert.deepEqual(comfyApply(recipePayload()), { ok: false, error: "Couldn't find the prompt node in this workflow." });
  });

  test("not ComfyUI / bridge present", () => {
    globalThis.window = {};
    globalThis.document = { activeElement: null };
    assert.equal(comfyApply(recipePayload()).ok, false);
    globalThis.window = { PromptoBridge: { apply: (p) => ({ ok: true, via: "bridge", got: p.positive }) } };
    assert.deepEqual(comfyApply(recipePayload()), { ok: true, via: "bridge", got: "1girl, smile" });
  });
});

describe("comfyApply: selected mode", () => {
  test("appends to the selected text nodes", () => {
    const a = node(6, "CLIPTextEncode", { widgets: [widget("text", "1girl")] });
    const b = node(7, "CLIPTextEncode", { widgets: [widget("text", "1boy, ")] });
    const c = node(8, "KSampler", { widgets: [widget("steps", 20)] });
    install([a, b, c], { selected: { 6: a, 7: b, 8: c } });
    const res = comfyApply({ mode: "selected", append: true, text: "smile" });
    assert.deepEqual(res, { ok: true, applied: ["2 nodes"] });
    assert.equal(a.widgets[0].value, "1girl, smile");
    assert.equal(b.widgets[0].value, "1boy, smile");
  });

  test("replaces when not appending", () => {
    const a = node(6, "CLIPTextEncode", { widgets: [widget("text", "1girl")] });
    install([a], { selected: { 6: a } });
    assert.deepEqual(comfyApply({ mode: "selected", append: false, text: "cat" }), { ok: true, applied: ["1 node"] });
    assert.equal(a.widgets[0].value, "cat");
  });

  test("inserts at the caret of the focused textarea", () => {
    const box = { tagName: "TEXTAREA", value: "1girl, smile", selectionStart: 5, selectionEnd: 5 };
    const a = node(6, "CLIPTextEncode", { title: "Positive", widgets: [widget("text", "1girl, smile", { element: box })] });
    const other = node(7, "CLIPTextEncode", { widgets: [widget("text", "untouched")] });
    install([other, a], { active: box, selected: { 7: other } });
    const res = comfyApply({ mode: "selected", append: true, text: "red hair" });
    assert.deepEqual(res, { ok: true, applied: ["Positive"] });
    assert.equal(a.widgets[0].value, "1girl, red hair, smile");
    assert.equal(box.value, "1girl, red hair, smile");
    assert.equal(other.widgets[0].value, "untouched", "the focused box wins over the selection");
  });

  test("replaces the selected range of the focused textarea", () => {
    const box = { tagName: "TEXTAREA", value: "1girl, smile, outdoors", selectionStart: 7, selectionEnd: 12 };
    const a = node(6, "CLIPTextEncode", { widgets: [widget("text", box.value, { inputEl: box })] });
    install([a], { active: box });
    comfyApply({ mode: "selected", append: true, text: "grin" });
    assert.equal(a.widgets[0].value, "1girl, grin, outdoors");
  });

  test("errors when nothing is targeted", () => {
    const a = node(6, "CLIPTextEncode", { widgets: [widget("text", "1girl")] });
    install([a], { active: { tagName: "INPUT" } });
    assert.deepEqual(comfyApply({ mode: "selected", append: true, text: "x" }), {
      ok: false, error: "Click into a prompt box, or select a text node, in ComfyUI first."
    });
    assert.equal(a.widgets[0].value, "1girl");
  });
});

describe("helpers", () => {
  test("parseLoraList: old and new object_info formats", () => {
    const old = { LoraLoader: { input: { required: { lora_name: [["a.safetensors", "b.safetensors"], {}] } } } };
    const neu = { LoraLoader: { input: { required: { lora_name: ["COMBO", { options: ["c.safetensors"] }] } } } };
    assert.deepEqual(parseLoraList(old), ["a.safetensors", "b.safetensors"]);
    assert.deepEqual(parseLoraList(neu), ["c.safetensors"]);
    assert.equal(parseLoraList(null), null);
    assert.equal(parseLoraList({}), null);
    assert.equal(parseLoraList({ LoraLoader: { input: { required: { lora_name: ["COMBO", {}] } } } }), null);
  });

  test("normalizeBase", () => {
    assert.equal(normalizeBase("127.0.0.1:8188"), "http://127.0.0.1:8188");
    assert.equal(normalizeBase("http://localhost:8188/some/path?x=1"), "http://localhost:8188");
    assert.equal(normalizeBase("https://comfy.example.com"), "https://comfy.example.com");
    assert.equal(normalizeBase(DEFAULT_COMFY), DEFAULT_COMFY);
    assert.throws(() => normalizeBase("http://"));
  });

  test("originPattern covers every port on the host", () => {
    assert.equal(originPattern("http://127.0.0.1:8188"), "http://127.0.0.1/*");
    assert.equal(originPattern("https://comfy.example.com"), "https://comfy.example.com/*");
  });
});
