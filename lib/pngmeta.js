// Reads generation metadata out of PNG text chunks.
// ComfyUI writes `prompt` (API graph) and `workflow` (UI graph); A1111/Forge write `parameters`.

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

// Follows conditioning links back to the node input that holds the prompt string,
// returning where it lives so the text can be written back before queueing.
function comfyTextRef(graph, id, depth = 0, slot = 0) {
  const node = graph[id];
  if (!node || depth > 8) return null;
  const inp = node.inputs || {};
  for (const k of ["text", "text_g", "prompt", "string", "value"]) {
    if (typeof inp[k] === "string") return { id, key: k, text: inp[k] };
  }
  // A node that passes both through (ControlNetApplyAdvanced) outputs positive
  // on slot 0 and negative on slot 1, so slot 1 follows its negative input.
  const keys = slot === 1 && isLink(inp.negative) ? ["negative"] : ["text", "conditioning", "conditioning_1", "positive", "string"];
  for (const k of keys) {
    if (isLink(inp[k])) {
      const r = comfyTextRef(graph, inp[k][0], depth + 1, inp[k][1]);
      if (r) return r;
    }
  }
  return null;
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
  const loras = Object.values(graph)
    .filter((n) => /Lora/i.test(n.class_type) && typeof (n.inputs || {}).lora_name === "string")
    .map((n) => ({ name: n.inputs.lora_name, w: Number(n.inputs.strength_model ?? n.inputs.strength ?? 1) }));
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

export function parseA1111(text) {
  const lines = text.split("\n");
  const settingsIdx = lines.findIndex((l) => /^Steps: \d+/.test(l));
  const head = settingsIdx === -1 ? lines : lines.slice(0, settingsIdx);
  const negIdx = head.findIndex((l) => l.startsWith("Negative prompt:"));
  let positive = (negIdx === -1 ? head : head.slice(0, negIdx)).join("\n").trim();
  const negative = negIdx === -1 ? "" : head.slice(negIdx).join("\n").replace(/^Negative prompt:\s*/, "").trim();
  const kv = {};
  if (settingsIdx !== -1) {
    for (const m of lines.slice(settingsIdx).join(", ").matchAll(/([A-Za-z][\w /-]*): ("[^"]*"|[^,]*)/g)) kv[m[1].trim()] = m[2].trim();
  }
  const loras = [...positive.matchAll(/<lora:([^:>]+):?([\d.]*)>/g)].map((m) => ({ name: m[1], w: Number(m[2] || 1) }));
  positive = positive.replace(/<lora:[^>]+>,?\s*/g, "").replace(/[,\s]+$/, "").trim();
  const [width, height] = (kv.Size || "").split("x").map(Number);
  return {
    positive,
    negative,
    settings: {
      model: kv.Model || "",
      loras,
      sampler: kv.Sampler || "",
      scheduler: kv["Schedule type"] || "",
      steps: kv.Steps ? Number(kv.Steps) : undefined,
      cfg: kv["CFG scale"] ? Number(kv["CFG scale"]) : undefined,
      seed: kv.Seed ? Number(kv.Seed) : undefined,
      width,
      height
    }
  };
}

export async function readRecipeFromFile(file) {
  const chunks = await readPngText(await file.arrayBuffer());
  if (!chunks) return null;
  // A Prompto share card carries the whole recipe or cast member.
  if (chunks.prompto) {
    try { return { format: "prompto", data: JSON.parse(chunks.prompto) }; } catch {}
  }
  if (chunks.prompt) {
    try { return { format: "ComfyUI", ...parseComfy(chunks.prompt), workflow: chunks.workflow || null }; } catch {}
  }
  if (chunks.parameters) return { format: "A1111", ...parseA1111(chunks.parameters) };
  return { format: "none" };
}
