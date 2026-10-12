// Talking to ComfyUI two ways:
//  - the HTTP API (heartbeat, queueing a stored graph), which works even with no tab open
//  - an open ComfyUI tab, where a function runs in the page to edit the live graph

export const DEFAULT_COMFY = "http://127.0.0.1:8188";

export function normalizeBase(url) {
  const u = new URL(/^https?:\/\//.test(url) ? url : "http://" + url);
  return u.origin;
}
// Host permission pattern for a base URL. Match patterns cover every port on a host.
export const originPattern = (base) => { const u = new URL(base); return `${u.protocol}//${u.hostname}/*`; };

export async function ping(base) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 1500);
  try {
    const res = await fetch(base + "/system_stats", { signal: ctl.signal });
    // ComfyUI's same-origin check can answer 403 to an extension; it's still ComfyUI.
    if (res.status === 403) return true;
    return res.ok && !!(await res.json()).system;
  } catch { return false; }
  finally { clearTimeout(timer); }
}

// Every open ComfyUI tab at this address, the active one first.
export async function findTabs(base) {
  if (typeof chrome === "undefined" || !chrome.tabs) return [];
  try {
    const tabs = await chrome.tabs.query({ url: originPattern(base) });
    const mine = tabs.filter((t) => t.url && t.url.startsWith(base));
    return [...mine.filter((t) => t.active), ...mine.filter((t) => !t.active)];
  } catch { return []; }
}

export async function findTab(base) {
  return (await findTabs(base))[0] || null;
}

export async function queueGraph(base, graph) {
  const res = await fetch(base + "/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: "prompto" })
  });
  if (res.status === 403) throw new Error("ComfyUI refused. Start it with --enable-cors-header");
  if (!res.ok) throw new Error("ComfyUI rejected the graph (" + res.status + ")");
}

export async function applyInTab(tabId, payload) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: comfyApply, args: [payload] });
  return result;
}

// Calls a method on window.PromptoBridge (installed by the ComfyUI-Prompto
// extension) inside the tab. Returns null when the bridge isn't there.
export async function bridgeCall(tabId, method, args = []) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (m, a) => {
      const b = window.PromptoBridge;
      if (!b || typeof b[m] !== "function") return { missing: true };
      try { return { value: await b[m](...a) }; }
      catch (e) { return { error: String((e && e.message) || e) }; }
    },
    args: [method, args]
  });
  if (!result || result.missing) return null;
  if (result.error) throw new Error(result.error);
  return result.value;
}

// ComfyUI lists installed LoRAs as the options of LoraLoader's lora_name input.
// Older servers send [[names], {...}], newer ones ["COMBO", {options: [names]}].
export function parseLoraList(info) {
  const spec = info && info.LoraLoader && info.LoraLoader.input && info.LoraLoader.input.required && info.LoraLoader.input.required.lora_name;
  if (!spec) return null;
  if (Array.isArray(spec[0])) return spec[0];
  if (spec[1] && Array.isArray(spec[1].options)) return spec[1].options;
  return null;
}

// Through the open tab first (the bridge, then a same-origin fetch in the page),
// then straight at the server, which some ComfyUI versions refuse.
export async function fetchLoras(base, tabId) {
  if (tabId != null && typeof chrome !== "undefined" && chrome.scripting) {
    try {
      const viaBridge = await bridgeCall(tabId, "loras");
      if (Array.isArray(viaBridge)) return viaBridge;
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN",
        func: async () => { try { const r = await fetch("/object_info/LoraLoader"); return r.ok ? await r.json() : null; } catch { return null; } }
      });
      const list = parseLoraList(result);
      if (list) return list;
    } catch {}
  }
  try {
    const r = await fetch(base + "/object_info/LoraLoader");
    if (r.ok) return parseLoraList(await r.json());
  } catch {}
  return null;
}

// Presses Queue in the open ComfyUI tab: through the bridge when it's there,
// otherwise through ComfyUI's own app object.
export async function queueInTab(tabId) {
  const viaBridge = await bridgeCall(tabId, "queue").catch(() => null);
  if (viaBridge) return viaBridge;
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN",
    func: async () => {
      const app = window.app || (window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app);
      if (!app || !app.queuePrompt) return { ok: false, error: "This tab doesn't look like ComfyUI." };
      await app.queuePrompt(0, 1);
      return { ok: true };
    }
  });
  return result;
}

// Runs inside the ComfyUI page, so it must be self-contained.
// If a companion ComfyUI extension has installed window.PromptoBridge, defer to it;
// otherwise edit the LiteGraph graph directly through window.app.
export function comfyApply(payload) {
  if (window.PromptoBridge && typeof window.PromptoBridge.apply === "function") return window.PromptoBridge.apply(payload);
  const app = window.app || (window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app);
  if (!app || !app.graph) return { ok: false, error: "This tab doesn't look like ComfyUI." };
  const graph = app.graph;
  const nodes = graph._nodes || graph.nodes || [];
  const PROMPT_NAMES = ["text", "prompt", "text_g", "text_l", "clip_l", "t5xxl"];
  const TEXT_NAMES = [...PROMPT_NAMES, "positive", "wildcard_text", "string", "value", "text_positive"];
  const isText = (w) => typeof w.value === "string" && (TEXT_NAMES.includes(w.name) || w.type === "customtext" || !!(w.options && w.options.multiline));
  const textWidgets = (n) => (n.widgets || []).filter(isText);
  const textWidget = (n) => textWidgets(n)[0];
  const put = (w, v) => { if (!w) return; w.value = v; if (w.callback) w.callback(v); };
  // Encoders with split boxes (SDXL text_g/text_l, Flux clip_l/t5xxl) get the prompt in each.
  const setText = (n, v) => { const boxes = textWidgets(n).filter((w) => PROMPT_NAMES.includes(w.name)); for (const w of boxes.length ? boxes : [textWidget(n)]) put(w, v); };
  const dirty = () => { if (graph.setDirtyCanvas) graph.setDirtyCanvas(true, true); if (app.canvas && app.canvas.setDirty) app.canvas.setDirty(true, true); };

  if (payload.mode === "selected") {
    // The prompt box still focused in the page wins; otherwise the selected nodes.
    const el = document.activeElement && document.activeElement.tagName === "TEXTAREA" ? document.activeElement : null;
    let list = [];
    if (el) for (const n of nodes) for (const w of n.widgets || []) if (isText(w) && (w.element === el || w.inputEl === el)) list = [{ n, w, el }];
    if (!list.length) list = Object.values((app.canvas && app.canvas.selected_nodes) || {}).filter(textWidget).map((n) => ({ n, w: textWidget(n), el: null }));
    if (!list.length) return { ok: false, error: "Click into a prompt box, or select a text node, in ComfyUI first." };
    for (const { w, el: box } of list) {
      if (!payload.append) { put(w, payload.text); continue; }
      const old = w.value, start = box ? box.selectionStart : old.length, end = box ? box.selectionEnd : old.length;
      const before = old.slice(0, start), after = old.slice(end);
      const left = before.trim() && !/[,(\n]\s*$/.test(before) ? before.replace(/\s*$/, "") + ", " : before;
      const right = after.trim() && !/^\s*[,)\n]/.test(after) ? ", " + after.replace(/^\s*/, "") : after;
      put(w, left + payload.text + right);
      if (box) box.value = w.value;
    }
    dirty();
    return { ok: true, applied: [list[0].el ? (list[0].n.title || list[0].n.type) : list.length + " node" + (list.length > 1 ? "s" : "")] };
  }

  const upstream = (node, name, depth) => {
    if (!node || depth > 8 || !node.inputs) return null;
    const slot = node.inputs.findIndex((i) => i.name === name);
    if (slot < 0 || !node.getInputNode) return null;
    const src = node.getInputNode(slot);
    if (!src) return null;
    if (textWidget(src)) return src;
    for (const k of ["conditioning", "conditioning_1", "positive", "text"]) {
      const r = upstream(src, k, depth + 1);
      if (r) return r;
    }
    return null;
  };
  let pos = null, neg = null;
  for (const n of nodes) {
    if (!pos) pos = upstream(n, "positive", 0);
    if (!neg) neg = upstream(n, "negative", 0);
  }
  if (!pos) for (const n of nodes) if (/Guider/.test(n.type || "")) pos = pos || upstream(n, "conditioning", 0);
  if (!pos) return { ok: false, error: "Couldn't find the prompt node in this workflow." };

  const applied = ["prompt"], warnings = [];
  setText(pos, payload.positive);
  if (neg && neg !== pos && payload.negative != null) { setText(neg, payload.negative); applied.push("negative"); }

  // Only set a widget when the value is valid for it: combo widgets list their options.
  // The first match wins, samplers first, so a hires-fix pass keeps its own steps.
  const hasCond = (n) => (n.inputs || []).some((i) => i.name === "positive" || i.name === "noise");
  const ordered = [...nodes].sort((a, b) => hasCond(b) - hasCond(a));
  const setWidget = (names, v, label) => {
    if (v == null || v === "") return;
    for (const n of ordered) {
      const w = (n.widgets || []).find((x) => names.includes(x.name));
      if (!w) continue;
      const opts = w.options && Array.isArray(w.options.values) ? w.options.values : null;
      let val = v;
      if (opts) {
        val = opts.find((o) => o === v) || opts.find((o) => String(o).split(/[\\/]/).pop() === String(v).split(/[\\/]/).pop());
        if (val == null) continue;
      }
      w.value = val;
      if (w.callback) w.callback(val);
      applied.push(label);
      return;
    }
  };
  const s = payload.settings || {};
  setWidget(["seed", "noise_seed"], s.seed, "seed");
  setWidget(["steps"], s.steps, "steps");
  setWidget(["cfg"], s.cfg, "CFG");
  setWidget(["sampler_name"], s.sampler, "sampler");
  setWidget(["scheduler"], s.scheduler, "scheduler");
  setWidget(["ckpt_name", "unet_name"], s.model, "model");
  if (s.width && s.height) {
    const latent = nodes.find((n) => (n.widgets || []).some((w) => w.name === "width") && (n.widgets || []).some((w) => w.name === "height"));
    if (latent) {
      for (const [k, v] of [["width", s.width], ["height", s.height]]) {
        const w = latent.widgets.find((x) => x.name === k);
        w.value = Number(v);
        if (w.callback) w.callback(w.value);
      }
      applied.push("size");
    }
  }
  // LoRAs fill the workflow's existing LoRA loader nodes in order; no nodes are added.
  const loras = (s.loras || []).filter((l) => l && l.name);
  if (loras.length) {
    const base = (v) => String(v).split(/[\\/]/).pop().replace(/\.(safetensors|ckpt|pt|bin)$/i, "").toLowerCase();
    const loaders = nodes.filter((n) => /LoraLoader/i.test(n.type || "") && (n.widgets || []).some((w) => w.name === "lora_name")).sort((a, b) => a.id - b.id);
    let set = 0;
    loras.forEach((l, i) => {
      const n = loaders[i];
      if (!n) return;
      const w = n.widgets.find((x) => x.name === "lora_name");
      const opts = w.options && Array.isArray(w.options.values) ? w.options.values : null;
      const val = opts ? opts.find((o) => base(o) === base(l.name)) : l.name;
      // A loader whose LoRA is missing is bypassed rather than left on its old LoRA.
      if (val == null) { n.mode = 4; warnings.push(`${base(l.name)} isn't installed, so its loader is bypassed`); return; }
      w.value = val;
      if (w.callback) w.callback(val);
      for (const k of ["strength_model", "strength_clip"]) {
        const sw = n.widgets.find((x) => x.name === k);
        if (sw) { sw.value = Number(l.w); if (sw.callback) sw.callback(sw.value); }
      }
      if (n.mode === 4) n.mode = 0;
      set++;
    });
    if (loras.length > loaders.length) warnings.push(`${loras.length - loaders.length} more LoRA loader node${loras.length - loaders.length > 1 ? "s" : ""} needed`);
    const spare = loaders.slice(loras.length).filter((n) => n.mode !== 4);
    for (const n of spare) n.mode = 4; // bypass loaders this recipe doesn't use
    if (spare.length) warnings.push(`bypassed ${spare.length} unused LoRA loader${spare.length > 1 ? "s" : ""}`);
    if (set) applied.push(set === 1 ? "1 LoRA" : set + " LoRAs");
  }
  dirty();
  return { ok: true, applied, warnings };
}
