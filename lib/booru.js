// Danbooru post import: read a post through the JSON API, learn each character's
// usual look from Danbooru's related tags, and sort tags into appearance,
// outfit and skip. No DOM here, so the background worker can use it too.

const UA_PARAMS = { credentials: "omit" };
export const LOOK_THRESHOLD = 0.4; // share of a character's posts a tag must appear on
const MAYBE_THRESHOLD = 0.25; // shown in Skip so it can be promoted

export const displayName = (n) => (/[a-z0-9]/i.test(n) && !/^[\W_]+$/.test(n) ? n.replace(/_/g, " ") : n);
const norm = (t) => t.toLowerCase().replace(/_/g, " ").trim();

// ---------- Posts ----------
export function postIdFromUrl(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)donmai\.us$/.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/posts\/(\d+)/);
    return m ? { host: u.origin, id: Number(m[1]) } : null;
  } catch { return null; }
}

const split = (s) => (s || "").split(" ").filter(Boolean).map(displayName);

export async function fetchPost(host, id) {
  const fields = "id,tag_string_character,tag_string_copyright,tag_string_artist,tag_string_general,tag_string_meta,preview_file_url,large_file_url,rating";
  const res = await fetch(`${host}/posts/${id}.json?only=${fields}`, UA_PARAMS);
  if (!res.ok) throw new Error(`Danbooru answered ${res.status}`);
  const p = await res.json();
  return {
    id: p.id, host, url: `${host}/posts/${p.id}`, rating: p.rating,
    characters: split(p.tag_string_character),
    copyrights: split(p.tag_string_copyright),
    artists: split(p.tag_string_artist),
    general: split(p.tag_string_general),
    preview: p.preview_file_url || null,
    image: p.large_file_url || p.preview_file_url || null
  };
}

// Older captures and Gelbooru-style sites only have scraped tag groups.
export function postFromGroups(item) {
  const g = item.groups || {};
  let id = null;
  try { id = Number(new URL(item.url).searchParams.get("id")) || null; } catch {}
  return {
    id, host: null, url: item.url || null, site: item.source || "",
    characters: g.character || [], copyrights: g.copyright || [], artists: g.artist || [],
    general: g.general || [], preview: item.image || null, image: item.image || null
  };
}

// ---------- e621 / e926 ----------
export function e621IdFromUrl(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)(e621|e926)\.net$/.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/posts\/(\d+)/);
    return m ? { host: u.origin, id: Number(m[1]) } : null;
  } catch { return null; }
}

// e621 lists a species with its whole family tree; only the specific names help a prompt.
const E621_TAXONOMY = new Set(["mammal", "felid", "feline", "felis", "canid", "canine", "canis", "vulpine", "avian", "bird", "reptile",
  "scalie", "lizard", "squamate", "equid", "equine", "bovid", "bovine", "cervid", "leporid", "lagomorph", "rodent", "murid", "murine",
  "mustelid", "musteline", "procyonid", "ursid", "pantherine", "primate", "haplorhine", "marine", "fish", "amphibian", "arthropod", "insect"]);

// e621 asks browser-based tools to name themselves with _client, since a
// browser can't set its own User-Agent. Species tags describe the character's
// body, so they join the general tags.
export async function fetchE621(host, id) {
  const res = await fetch(`${host}/posts/${id}.json?_client=${encodeURIComponent("Prompto/1.0 (by EY4O)")}`, UA_PARAMS);
  if (!res.ok) throw new Error(`${new URL(host).hostname} answered ${res.status}`);
  const p = (await res.json()).post;
  const t = p.tags || {};
  const list = (k) => (t[k] || []).map(displayName);
  const species = list("species").filter((x) => !E621_TAXONOMY.has(x));
  return {
    id: p.id, host, url: `${host}/posts/${p.id}`, site: new URL(host).hostname, rating: p.rating,
    characters: list("character"), copyrights: list("copyright"), artists: list("artist"),
    species,
    general: [...species, ...list("general")],
    preview: (p.preview && p.preview.url) || null, image: (p.sample && p.sample.url) || (p.preview && p.preview.url) || null
  };
}

// ---------- A character's look ----------
// Tags that show up on most of the character's general-audience posts. Solo
// posts come first, so a character usually drawn with someone else doesn't
// inherit their hair; with too few solo posts it falls back to all posts.
const MIN_SOLO_POSTS = 25;

async function related(query) {
  const q = encodeURIComponent(query);
  const res = await fetch(`https://danbooru.donmai.us/related_tag.json?query=${q}&category=general&limit=40`, UA_PARAMS);
  if (!res.ok) throw new Error(`Danbooru answered ${res.status}`);
  const d = await res.json();
  return {
    postCount: d.post_count || 0,
    tags: (d.related_tags || []).map((r) => ({ name: displayName(r.tag.name), freq: r.frequency }))
  };
}

export async function fetchLook(tag, cache) {
  const key = norm(tag);
  const hit = cache && cache[key];
  if (hit && Date.now() - hit.at < 7 * 864e5) return hit;
  const base = key.replace(/ /g, "_");
  let look = { ...(await related(`${base} solo rating:g`)), solo: true };
  if (look.postCount < MIN_SOLO_POSTS) look = { ...(await related(`${base} rating:g`)), solo: false };
  look.at = Date.now();
  if (cache) cache[key] = look;
  return look;
}

// ---------- Sorting ----------
const EXPRESSION = /\b(holding|closed eyes|half-closed eyes|one eye closed|looking|open mouth|closed mouth|smile|smiling|grin|blush|tears|crying|frown|pout|expressionless|parted lips|tongue out|wink|sweat|surprised|angry|sad)\b/;
const OUTFIT = /\b(dress|shirt|skirt|jacket|coat|capelet|cape|cloak|hoodie|hooded|sweater|vest|uniform|kimono|yukata|apron|pants|shorts|jeans|leggings|pantyhose|thighhighs|kneehighs|socks|stockings|footwear|shoes|boots|sneakers|sandals|heels|gloves|mittens|sleeves|sleeveless|collar|necktie|tie|bowtie|ribbon|bow|hat|cap|beret|helmet|hood|headband|headwear|hairband|crown|tiara|wreath|earrings|necklace|choker|bracelet|jewelry|ring|glasses|eyewear|goggles|mask|scarf|belt|bag|armor|gauntlets|robe|swimsuit|bikini|leotard|bodysuit|suit|blazer|cardigan|camisole|tank top|crop top|serafuku|sailor collar|neckerchief|frills|lace|buttons|sash|obi|ornament|hairclip|scrunchie|brooch|wristband|armband|epaulettes|tricorne|clothes|clothing|outfit|costume|staff|sword|katana|weapon|wand)\b/;
const APPEARANCE = /\b(hair|bangs|sidelocks?|ahoge|braids?|braided|twintails|ponytail|bun|drills?|eyes|eyebrows|eyelashes|pupils|heterochromia|ears|tail|horns?|wings|halo|skin|skinned|tan|tanlines|freckles|mole|scar|fangs?|breasts|flat chest|muscular|abs|petite|elf|demon girl|cat girl|fox girl|dog girl|wolf girl|beard|stubble|mustache|facial hair|makeup|lipstick|eyeshadow|forehead|mature (female|male)|old (man|woman)|aged (up|down))\b/;
const COUNT = /^(\d|6\+)(girl|boy|other)s?$/;

export function classify(tag) {
  const t = norm(tag);
  if (COUNT.test(t)) return "count";
  if (EXPRESSION.test(t)) return "skip";
  if (OUTFIT.test(t)) return "outfit"; // before appearance: "hair ribbon" is an accessory
  if (APPEARANCE.test(t)) return "appearance";
  return "skip";
}

const nameFromTag = (tag) => {
  const base = displayName(tag).replace(/\s*\(.*\)$/, "");
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
};
const qualifier = (tag) => (displayName(tag).match(/\(([^)]+)\)$/) || [])[1] || "";
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

const freqMap = (look) => new Map((look ? look.tags : []).map((x) => [norm(x.name), x.freq]));

// Builds the starting sort for one character. `looks` maps each character tag
// in the post to its look, or null when Danbooru couldn't say (offline, or a
// character it barely knows), in which case only the post is used.
export function draftCharacter(tag, post, looks) {
  const look = looks[tag] || null;
  const solo = post.characters.length <= 1;
  const freq = freqMap(look);
  const others = post.characters.filter((c) => c !== tag).map((c) => freqMap(looks[c]));
  // With several characters, a post tag goes to whoever Danbooru ties it to most.
  const mine = (t) => {
    const f = freq.get(norm(t)) || 0;
    return f >= 0.2 && others.every((o) => f >= (o.get(norm(t)) || 0));
  };
  const buckets = new Map(); // tag -> appearance | outfit | skip
  const put = (t, b) => { if (!buckets.has(t)) buckets.set(t, b); };

  if (look) {
    for (const x of look.tags) {
      const kind = classify(x.name);
      if (x.freq >= LOOK_THRESHOLD) {
        if (kind === "appearance" || kind === "outfit") put(x.name, kind);
        else if (kind === "count" && x.freq >= 0.5) put(x.name, "appearance");
      }
    }
  }
  // e621 species describe the character's body.
  if (solo) for (const t of post.species || []) put(t, "appearance");
  // From this post: everything when it's the only character, otherwise only
  // the tags that belong to this character more than to the others.
  for (const t of post.general) {
    const kind = classify(t);
    if ((kind === "appearance" || kind === "outfit") && (solo || mine(t))) put(t, kind);
  }
  for (const t of post.general) put(t, "skip");
  if (look) for (const x of look.tags) if (x.freq >= MAYBE_THRESHOLD && classify(x.name) !== "count") put(x.name, "skip");

  const series = post.copyrights[0] ? titleCase(post.copyrights[0]) : titleCase(qualifier(tag)) || "Original";
  return {
    tag, include: true, name: nameFromTag(tag), series,
    buckets: [...buckets].map(([t, b]) => ({ t, b, f: freq.get(norm(t)) ?? null })),
    postCount: look ? look.postCount : 0,
    soloLook: !!(look && look.solo)
  };
}

// Scene and framing tags from the post that aren't about any character.
export function sceneTags(post) {
  return post.general.filter((t) => classify(t) === "skip" && !EXPRESSION.test(norm(t)) && !/^(solo|solo focus|multiple (girls|boys))$/.test(norm(t)));
}
