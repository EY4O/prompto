// Small LCS diff for comparing recipe versions: tag by tag for tag prompts,
// word by word for prose. Prompts are short, so the O(n·m) table is fine.

function lcsOps(a, b, eq = (x, y) => x === y) {
  const n = a.length, m = b.length;
  const t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = eq(a[i], b[j]) ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) { ops.push({ op: "same", v: b[j] }); i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) ops.push({ op: "del", v: a[i++] });
    else ops.push({ op: "add", v: b[j++] });
  }
  while (i < n) ops.push({ op: "del", v: a[i++] });
  while (j < m) ops.push({ op: "add", v: b[j++] });
  return ops;
}

const tagsOf = (s) => String(s || "").split(/,\s*|\n+/).map((x) => x.trim()).filter(Boolean);
const wordsOf = (s) => String(s || "").match(/\S+|\s+/g) || [];

export function tagDiff(before, after) {
  return lcsOps(tagsOf(before), tagsOf(after), (x, y) => x.toLowerCase() === y.toLowerCase());
}

export function wordDiff(before, after) {
  // Whitespace runs are matched loosely so reflowed text doesn't show as changed.
  return lcsOps(wordsOf(before), wordsOf(after), (x, y) => x === y || (!x.trim() && !y.trim()));
}

// Settings that differ between two recipe snapshots, as [label, before, after].
export function settingsDiff(a = {}, b = {}) {
  const show = (v, k) => k === "loras" ? (v || []).map((l) => `${l.name}:${l.w}`).join(", ") || "none" : v ?? "—";
  const keys = ["model", "loras", "sampler", "scheduler", "steps", "cfg", "seed", "width", "height"];
  return keys
    .map((k) => [k, show(a[k], k), show(b[k], k)])
    .filter(([, x, y]) => String(x) !== String(y));
}

export const changed = (ops) => ops.some((o) => o.op !== "same");
