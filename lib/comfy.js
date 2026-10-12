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

export async function findTab(base) {
  if (typeof chrome === "undefined" || !chrome.tabs) return null;
  try {
    const tabs = await chrome.tabs.query({ url: originPattern(base) });
    const mine = tabs.filter((t) => t.url && t.url.startsWith(base));
    return mine.find((t) => t.active) || mine[0] || null;
  } catch { return null; }
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

// Runs inside the ComfyUI page, so it must be self-contained.
// If a companion ComfyUI extension has installed window.PromptoBridge, defer to it;
// otherwise edit the LiteGraph graph directly through window.app.
export function comfyApply(payload) {
  if (window.PromptoBridge && typeof window.PromptoBridge.apply === "function") return window.PromptoBridge.apply(payload);
  const app = window.app || (window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app);
  if (!app || !app.graph) return { ok: false, error: "This tab doesn't look like ComfyUI." };
  const graph = app.graph;
  const nodes = graph._nodes || graph.nodes || [];
  const textWidget = (n) => (n.widgets || []).find((w) => ["text", "prompt", "text_g", "string"].includes(w.name) && typeof w.value === "string");
  const setText = (n, v) => { const w = textWidget(n); w.value = v; if (w.callback) w.callback(v); };
  const dirty = () => { if (graph.setDirtyCanvas) graph.setDirtyCanvas(true, true); if (app.canvas && app.canvas.setDirty) app.canvas.setDirty(true, true); };

  if (payload.mode === "selected") {
    const sel = Object.values((app.canvas && app.canvas.selected_nodes) || {}).filter(textWidget);
    if (!sel.length) return { ok: false, error: "Select a text node in ComfyUI first." };
    for (const n of sel) {
      const cur = textWidget(n).value;
      setText(n, payload.append && cur.trim() ? cur.replace(/[,\s]*$/, "") + ", " + payload.text : payload.text);
    }
    dirty();
    return { ok: true, applied: [sel.length + " node" + (sel.length > 1 ? "s" : "")] };
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

  const applied = ["prompt"];
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
  dirty();
  return { ok: true, applied };
}
