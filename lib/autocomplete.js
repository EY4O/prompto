// Tag autocomplete for every `.chip-add` input. It completes the segment after
// the last comma; picking a suggestion commits it with a synthetic Enter, so the
// panel's normal "add tags" path does the actual work.
import { CATEGORIES, formatCount } from "./tags.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function attachAutocomplete({ suggestLocal, suggestOnline }) {
  const box = document.createElement("ul");
  box.id = "ac";
  box.className = "ac";
  box.setAttribute("role", "listbox");
  box.hidden = true;
  document.body.append(box);

  let input = null, items = [], active = -1, timer = 0, ctl = null, seq = 0;

  const segment = (v) => v.slice(v.lastIndexOf(",") + 1).trim();

  function place() {
    if (!input) return;
    const r = input.getBoundingClientRect();
    const w = Math.max(240, Math.min(320, window.innerWidth - 24));
    box.style.width = w + "px";
    box.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + "px";
    const below = window.innerHeight - r.bottom;
    if (below < 220 && r.top > below) { box.style.top = ""; box.style.bottom = window.innerHeight - r.top + 4 + "px"; }
    else { box.style.bottom = ""; box.style.top = r.bottom + 4 + "px"; }
  }

  function draw(note = "") {
    if (!input || (!items.length && !note)) return close();
    box.innerHTML = items.map((x, i) => `<li role="option" id="ac-${i}" class="ac-item${i === active ? " on" : ""}" data-i="${i}" aria-selected="${i === active}">
        <span class="ac-dot" data-cat="${x.cat}" title="${esc(CATEGORIES[x.cat] || "tag")}"></span>
        <span class="ac-name">${esc(x.name)}${x.alias ? `<small>← ${esc(x.alias)}</small>` : ""}</span>
        <span class="ac-count">${esc(formatCount(x.count, x.source))}</span></li>`).join("")
      + (note ? `<li class="ac-note">${esc(note)}</li>` : "");
    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-activedescendant", active >= 0 ? "ac-" + active : "");
    place();
  }

  function close() {
    box.hidden = true;
    items = []; active = -1;
    clearTimeout(timer);
    if (ctl) ctl.abort();
    if (input) { input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); }
  }

  function merge(a, b) {
    const seen = new Set(a.map((x) => x.name.toLowerCase()));
    return [...a, ...b.filter((x) => !seen.has(x.name.toLowerCase()))].slice(0, 8);
  }

  // LoRA fields, or a tag starting with "<", complete LoRA names instead of tags.
  const loraMode = (q) => input.classList.contains("lora-add") || q.startsWith("<");

  // "@" marks an artist tag: suggest names without it, and picking one keeps it.
  let artist = false;

  function update() {
    const typed = segment(input.value);
    artist = typed.startsWith("@");
    const q = artist ? typed.slice(1) : typed;
    const lora = loraMode(q);
    if (q.length < (lora ? 1 : 2)) return close();
    items = suggestLocal(q, input);
    active = items.length ? 0 : -1;
    draw();
    clearTimeout(timer);
    if (ctl) ctl.abort();
    if (lora || !suggestOnline || items.filter((x) => x.source === "list").length >= 5) return;
    const mine = ++seq;
    timer = setTimeout(async () => {
      ctl = new AbortController();
      try {
        const online = await suggestOnline(q, ctl.signal);
        if (mine !== seq || !input) return;
        items = merge(items, online);
        if (active < 0 && items.length) active = 0;
        draw();
      } catch (e) {
        if (e.name !== "AbortError" && mine === seq && !items.length) draw("Danbooru didn't answer. Check your connection.");
      }
    }, 280);
  }

  function pick(i) {
    const x = items[i];
    if (!x || !input) return;
    const v = input.value;
    const cut = v.lastIndexOf(",");
    const name = x.insert ?? x.name;
    // Artists (Danbooru category 1) are written @name; profiles drop the @ for models that don't want it.
    const at = x.insert == null && (artist || x.cat === 1) && !name.startsWith("@") ? "@" : "";
    input.value = (cut === -1 ? "" : v.slice(0, cut + 1) + " ") + at + name;
    const target = input;
    close();
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }

  document.addEventListener("focusin", (e) => {
    if (!e.target.classList || !(e.target.classList.contains("chip-add") || e.target.classList.contains("lora-add"))) return;
    input = e.target;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", "ac");
    input.setAttribute("autocomplete", "off");
  });
  document.addEventListener("focusout", (e) => { if (e.target === input) setTimeout(close, 120); });
  document.addEventListener("input", (e) => { if (e.target === input) update(); });
  // Capture phase, so arrow keys and Enter reach this before the panel's handlers.
  document.addEventListener("keydown", (e) => {
    if (e.target !== input || box.hidden || !items.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      draw();
    } else if ((e.key === "Enter" || e.key === "Tab") && active >= 0 && e.isTrusted) {
      e.preventDefault(); e.stopImmediatePropagation();
      pick(active);
    } else if (e.key === "Escape") {
      e.preventDefault(); close();
    }
  }, true);
  box.addEventListener("mousedown", (e) => {
    const li = e.target.closest(".ac-item");
    if (!li) return;
    e.preventDefault();
    pick(Number(li.dataset.i));
  });
  window.addEventListener("scroll", place, { passive: true });
  window.addEventListener("resize", place);
}
