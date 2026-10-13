// Reads generation metadata out of image files: PNG text chunks here, JPEG/WebP
// EXIF in exif.js. ComfyUI writes `prompt` (API graph) and `workflow` (UI graph);
// A1111/Forge write `parameters` (EXIF UserComment in JPEG/WebP); NovelAI,
// InvokeAI, SwarmUI and Fooocus have their own keys. Parsers live in recipe1.js.
import { readJpegWebpText } from "./exif.js";
import * as R1 from "./recipe1.js";

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decodeText(bytes) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("latin1").decode(bytes); }
}

export async function readPngText(buffer) {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (u8.length < 8 || sig.some((b, i) => u8[i] !== b)) return null;
  const out = {};
  let p = 8;
  while (p + 8 <= u8.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(...u8.subarray(p + 4, p + 8));
    const data = u8.subarray(p + 8, p + 8 + len);
    if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      const z = data.indexOf(0);
      const key = new TextDecoder("latin1").decode(data.subarray(0, z));
      if (type === "tEXt") out[key] = decodeText(data.subarray(z + 1));
      else if (type === "zTXt") out[key] = decodeText(await inflate(data.subarray(z + 2)));
      else {
        const compressed = data[z + 1] === 1;
        let q = data.indexOf(0, z + 3) + 1; // skip language tag
        q = data.indexOf(0, q) + 1; // skip translated keyword
        const body = data.subarray(q);
        out[key] = decodeText(compressed ? await inflate(body) : body);
      }
    }
    if (type === "IEND") break;
    p += 12 + len;
  }
  return out;
}

const isLink = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === "string";

// Inputs that hold prompt text. Impact's wildcard processor keeps the rolled
// text in populated_text and the template in wildcard_text.
const TEXT_KEYS = ["text", "text_g", "prompt", "populated_text", "wildcard_text", "string", "value"];

// Follows conditioning links back to the node input that holds the prompt string,
// returning where it lives so the text can be written back before queueing.
// Text can also pass through switches (input<select>) and text joins (string_a +
// string_b), as in workflows built with Impact Pack, easy-use or LoRA Manager.
function comfyTextRef(graph, id, depth = 0, slot = 0) {
  const node = graph[id];
  if (!node || depth > 16) return null;
  const inp = node.inputs || {};
  const strings = TEXT_KEYS.filter((k) => typeof inp[k] === "string");
  const filled = strings.find((k) => inp[k].trim());
  if (filled) return { id, key: filled, text: inp[filled] };
  const follow = (k) => (isLink(inp[k]) ? comfyTextRef(graph, inp[k][0], depth + 1, inp[k][1]) : null);
  // A node that passes both through (ControlNetApplyAdvanced) outputs positive
  // on slot 0 and negative on slot 1, so slot 1 follows its negative input.
  if (slot === 1 && isLink(inp.negative)) return follow("negative");
  const sel = Number(inp.select);
  if (Number.isInteger(sel) && isLink(inp["input" + sel])) return follow("input" + sel);
  if ("string_a" in inp || "string_b" in inp) {
    const side = (k) => follow(k) || (typeof inp[k] === "string" ? { id, key: k, text: inp[k] } : null);
    const parts = [side("string_a"), side("string_b")].filter((x) => x && x.text.trim());
    if (parts.length) {
      const main = parts.reduce((a, b) => (b.text.length > a.text.length ? b : a));
      const d = typeof inp.delimiter === "string" ? inp.delimiter : ", ";
      return { id: main.id, key: main.key, text: parts.map((x) => x.text).join(d) };
    }
  }
  for (const k of ["text", "conditioning", "conditioning_1", "positive", "string", "text_positive"]) {
    const r = follow(k);
    if (r) return r;
  }
  // An empty text box is still the prompt (an empty negative, say).
  return strings.length ? { id, key: strings[0], text: inp[strings[0]] } : null;
}

// Keys are tried in order across the whole graph, so "ckpt_name" or "unet_name"
// wins over a detector's "model_name" wherever the nodes sit.
function firstInput(graph, keys) {
  for (const k of keys) {
    for (const node of Object.values(graph)) {
      const v = node.inputs && node.inputs[k];
      if (v != null && !isLink(v)) return v;
    }
  }
  return undefined;
}

// LoRAs from every kind of loader: LoraLoader (lora_name), LoRA Manager's
// loader/stacker (a `loras` list), rgthree's Power Lora Loader (lora_N rows)
// and stacks with lora_name_N slots (Efficiency, Comfyroll). Off rows are skipped.
function graphLoras(graph) {
  const out = [];
  const add = (name, w) => {
    if (typeof name !== "string" || !name || name.toLowerCase() === "none" || out.some((l) => l.name === name)) return;
    out.push({ name, w: Number(isLink(w) || w == null ? 1 : w) });
  };
  for (const node of Object.values(graph)) {
    const inp = node.inputs || {};
    if (!/lora/i.test(node.class_type || "") && !Object.keys(inp).some((k) => k.startsWith("lora_name"))) continue;
    if (typeof inp.lora_name === "string") add(inp.lora_name, inp.strength_model ?? inp.strength);
    const list = inp.loras && !Array.isArray(inp.loras) ? inp.loras.__value__ : inp.loras;
    if (Array.isArray(list)) for (const e of list) if (e && e.active !== false) add(e.name, e.strength);
    for (const [k, v] of Object.entries(inp)) {
      if (v && typeof v === "object" && !Array.isArray(v) && typeof v.lora === "string" && v.on !== false) add(v.lora, v.strength);
      const m = /^lora_name_(\d+)$/.exec(k);
      if (m && !/^(off|false)$/i.test(String(inp[`switch_${m[1]}`] ?? "On"))) add(v, inp[`model_weight_${m[1]}`] ?? inp[`lora_wt_${m[1]}`] ?? inp[`strength_${m[1]}`]);
    }
  }
  return out;
}

export function parseComfy(promptJson) {
  const graph = typeof promptJson === "string" ? JSON.parse(promptJson) : promptJson;
  let pos = null, neg = null;
  for (const node of Object.values(graph)) {
    const inp = node.inputs || {};
    if (isLink(inp.positive) && !pos) pos = comfyTextRef(graph, inp.positive[0], 0, inp.positive[1]);
    if (isLink(inp.negative) && !neg) neg = comfyTextRef(graph, inp.negative[0], 0, inp.negative[1]);
  }
  if (!pos) {
    const guider = Object.values(graph).find((n) => /Guider/.test(n.class_type) && isLink((n.inputs || {}).conditioning));
    if (guider) pos = comfyTextRef(graph, guider.inputs.conditioning[0]);
  }
  if (!pos) {
    const encoders = Object.entries(graph)
      .filter(([, n]) => /CLIPTextEncode/.test(n.class_type))
      .map(([id]) => comfyTextRef(graph, id))
      .filter(Boolean);
    pos = encoders[0] || null;
    neg = neg || encoders[1] || null;
  }
  // Edit workflows often route the negative back to the same encoder (or zero it out).
  if (neg && pos && neg.id === pos.id && neg.key === pos.key) neg = null;
  const positive = pos ? pos.text : "";
  const negative = neg ? neg.text : "";
  const seedNode = Object.entries(graph).find(([, n]) => n.inputs && ["seed", "noise_seed"].some((k) => typeof n.inputs[k] === "number"));
  const loras = graphLoras(graph);
  return {
    positive,
    negative,
    comfy: {
      graph,
      pos: pos && { id: pos.id, key: pos.key },
      neg: neg && { id: neg.id, key: neg.key },
      seed: seedNode && { id: seedNode[0], key: "seed" in seedNode[1].inputs ? "seed" : "noise_seed" }
    },
    settings: {
      model: firstInput(graph, ["ckpt_name", "unet_name", "model_name"]) || "",
      loras,
      sampler: firstInput(graph, ["sampler_name"]) || "",
      scheduler: firstInput(graph, ["scheduler"]) || "",
      steps: firstInput(graph, ["steps"]),
      cfg: firstInput(graph, ["cfg", "guidance"]),
      seed: firstInput(graph, ["seed", "noise_seed"]),
      width: firstInput(graph, ["width"]),
      height: firstInput(graph, ["height"])
    }
  };
}

// A1111/Forge "parameters" text, with hashes and Civitai resource ids kept on the LoRAs.
export function parseA1111(text) {
  return R1.toMeta(R1.parseA1111(text), "A1111");
}

// PNG text chunks, or JPEG/WebP EXIF fields → { format, text }, or null.
export async function readImageText(buffer) {
  const png = await readPngText(buffer);
  if (png) return { format: "png", text: png };
  return readJpegWebpText(buffer);
}

const LABEL = { a1111: "A1111", novelai: "NovelAI", invokeai: "InvokeAI", swarmui: "SwarmUI", fooocus: "Fooocus", prompto: "Prompto" };

// Metadata fields → a recipe meta, or null when there's no generation data.
export function recipeFromText(text) {
  if (text.prompt) {
    try {
      const c = parseComfy(R1.loads(text.prompt));
      const params = text.parameters || "";
      if (params && !params.trim().startsWith("{")) { // ComfyUI saves that also write A1111 text carry the hashes
        const m = R1.toMeta(R1.enrich(R1.fromMeta(c), R1.parseA1111(params)), "ComfyUI");
        c.settings = { ...c.settings, loras: m.settings.loras, ...(m.settings.modelRef ? { modelRef: m.settings.modelRef } : {}) };
        // A graph Prompto can't trace still has its prompts in the A1111 text.
        const a = parseA1111(params);
        if (!c.positive.trim() && a.positive) c.positive = a.positive;
        if (!c.negative.trim() && a.negative) c.negative = a.negative;
      }
      return { format: "ComfyUI", ...c, workflow: text.workflow || null };
    } catch {}
  }
  const rec = R1.fromText(text);
  return rec ? R1.toMeta(rec, LABEL[rec.format] || rec.format) : null;
}

export async function readRecipeFromFile(file) {
  const img = await readImageText(await file.arrayBuffer());
  if (!img) return null;
  const t = img.text;
  // A Prompto share card carries the whole recipe or cast member.
  if (t.prompto) {
    try { return { format: "prompto", data: JSON.parse(t.prompto) }; } catch {}
  }
  return recipeFromText(t) || { format: "none" };
}
