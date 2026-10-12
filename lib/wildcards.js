// Wildcards in tags and prose:
//   {red|blue|silver}   one of the options (can nest: {a {big|small} cat|a dog})
//   __hair_color__      one entry from a snippet or snippet category of that name
// Expansion is seeded, so a "roll" number always gives the same result.

const CHOICE = /\{([^{}]*\|[^{}]*)\}/;
const NAMED = /__([\w-]+)__/g;

export const hasWildcards = (s) => CHOICE.test(String(s || "")) || /__[\w-]+__/.test(String(s || ""));
export const wildcardNames = (s) => [...String(s || "").matchAll(NAMED)].map((m) => m[1]);
export const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export function seededRandom(seed) {
  let h = 2166136261 ^ String(seed).length;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  let s = h >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

// lookup(name) returns the entries for __name__, or null when nothing matches.
export function expand(text, rng, lookup) {
  let out = String(text || "");
  for (let i = 0; i < 20; i++) {
    let changed = false;
    out = out.replace(NAMED, (whole, name) => {
      const entries = lookup ? lookup(name) : null;
      if (!entries || !entries.length) return whole;
      changed = true;
      return entries[Math.floor(rng() * entries.length)];
    });
    const m = out.match(CHOICE);
    if (m) {
      const opts = m[1].split("|");
      out = out.slice(0, m.index) + opts[Math.floor(rng() * opts.length)].trim() + out.slice(m.index + m[0].length);
      changed = true;
    }
    if (!changed) break;
  }
  // An empty option can leave doubled commas behind: "a, , b".
  return out.replace(/,\s*,/g, ",").replace(/^\s*,\s*|\s*,\s*$/g, "").replace(/ {2,}/g, " ");
}
