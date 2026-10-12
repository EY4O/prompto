// Drafts natural-language prose from a block's tags, without AI. Each block
// type has a template with {slots}; text in [square brackets] is dropped when a
// slot inside it is empty. The slots are worked out here from the tags.

export const DEFAULT_TEMPLATES = {
  subject: "{list}",
  character: "[{name}, ]{who}[ with {appearance}]",
  outfit: "wearing {items}",
  pose: "{list}",
  scene: "[{place}][ {time}][ with {details}]",
  lighting: "lit by {list}",
  camera: "{list}",
  style: "in a {list} style"
};

// Slots each template can use, shown in Settings.
export const SLOT_HELP = {
  subject: "{list}",
  character: "{name} {who} {appearance} {hair} {eyes} {features}",
  outfit: "{items}",
  pose: "{list}",
  scene: "{place} {time} {details}",
  lighting: "{list}",
  camera: "{list}",
  style: "{list}"
};

// ---------- Phrase dictionary ----------
const DROP = new Set(["solo", "solo focus", "male focus", "female focus", "absurdres", "highres", "masterpiece", "best quality",
  "simple background", "white background", "transparent background"]);
const COUNT = {
  "1girl": "a girl", "1boy": "a boy", "1other": "a person", "2girls": "two girls", "2boys": "two boys",
  "3girls": "three girls", "3boys": "three boys", "multiple girls": "several girls", "multiple boys": "several boys"
};
// Age tags refine the count: "1boy" + "mature male" reads as "a man".
const AGE = { "mature female": ["girl", "woman"], "mature male": ["boy", "man"], "old woman": ["girl", "old woman"], "old man": ["boy", "old man"], "child": ["girl", "child"] };
const SPECIES = new Set(["elf", "dark elf", "demon", "angel", "vampire", "android", "robot", "fairy", "witch", "kitsune", "mermaid"]);
const KEMONO = /^(cat|fox|dog|wolf|bunny|rabbit|cow|demon|monster|horse|mouse|tiger|lion|bear) (girl|boy)$/;
const PHRASE = {
  "looking at viewer": "looking at the viewer", "looking back": "looking back over the shoulder",
  "hand on hip": "a hand on the hip", "hands on hips": "hands on the hips",
  "cowboy shot": "a cowboy shot", "upper body": "an upper-body shot", "full body": "a full-body shot",
  "portrait": "a portrait", "close-up": "a close-up", "wide shot": "a wide shot", "pov": "a first-person view",
  "from behind": "seen from behind", "from above": "seen from above", "from below": "seen from below",
  "from side": "seen from the side", "dutch angle": "a tilted dutch angle", "depth of field": "a shallow depth of field",
  "blurry background": "a blurred background", "bokeh": "soft bokeh",
  "backlighting": "backlight", "rim light": "a rim light", "rim lighting": "a rim light", "golden hour": "golden-hour sun",
  "volumetric lighting": "volumetric light", "light rays": "rays of light", "lens flare": "a lens flare",
  "soft lighting": "soft light", "dramatic lighting": "dramatic light",
  "scar across eye": "a scar across one eye", "mole under eye": "a mole under one eye", "scar on face": "a scar on the face",
  "facial mark": "a facial mark", "overcast": "an overcast sky", "cloudy sky": "a cloudy sky", "blue sky": "a blue sky", "fang": "a fang", "beauty mark": "a beauty mark", "pointy ears": "pointy ears"
};
const TIMES = { night: "at night", day: "during the day", sunset: "at sunset", sunrise: "at sunrise", dusk: "at dusk", dawn: "at dawn",
  evening: "in the evening", morning: "in the morning", twilight: "at twilight", "night sky": "under a night sky" };
// Whole-tag place names only, so "wet street" stays a detail.
const PLACES = new Set(["alley", "street", "city", "town", "village", "forest", "woods", "beach", "room", "bedroom", "classroom", "cafe",
  "restaurant", "field", "flower field", "garden", "greenhouse", "ruins", "castle", "library", "shrine", "temple", "mountain", "lake",
  "river", "ocean", "sea", "desert", "rooftop", "train", "train station", "station", "park", "kitchen", "bathroom", "stage", "office",
  "school", "hallway", "corridor", "bridge", "harbor", "ship deck", "ship", "cave", "meadow", "cityscape", "landscape", "market",
  "church", "tavern", "spaceship", "space", "underwater", "battlefield", "throne room", "bar", "onsen", "pool", "classroom"]);
const COLORS = new Set(["silver", "white", "grey", "gray", "black", "blonde", "blond", "brown", "light brown", "dark brown", "red", "dark red",
  "pink", "light pink", "purple", "light purple", "blue", "light blue", "dark blue", "aqua", "green", "light green", "dark green",
  "orange", "yellow", "multicolored", "two-tone", "streaked", "gradient", "rainbow"]);
const LENGTHS = ["absurdly long", "very long", "very short", "long", "medium", "short"];
const HAIR_IN = /^(twin braids|single braid|braid|braids|french braid|side braid|twintails|low twintails|ponytail|high ponytail|low ponytail|side ponytail|hair bun|double bun|single hair bun|bob cut|hime cut|drill hair|twin drills)$/;
const HAIR_WITH = /^(bangs|blunt bangs|parted bangs|swept bangs|sidelocks|ahoge|hair between eyes|hair over one eye|hair intakes|antenna hair)$/;
const HAIR_TEXTURE = /^(messy|wavy|curly|straight|spiked|fluffy|floating) hair$/;
const MASS = new Set(["jewelry", "armor", "makeup", "lace", "frills", "lingerie", "clothing", "fur trim", "rain", "snow", "fog"]);
const PLURALISH = /(s|wear)$/; // shorts, sneakers, gloves, glasses, footwear

const norm = (t) => String(t).toLowerCase().replace(/_/g, " ").replace(/\s*\(.*\)$/, "").trim();
const article = (p) => (/^[aeiou]/i.test(p) && !/^(uni|one|eu)/i.test(p) ? "an " : "a ") + p;
const phrase = (t) => PHRASE[norm(t)] || norm(t);

export function joinAnd(items) {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs[0] || "";
  return xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
}

// Booru posts often carry both "capelet" and "white capelet"; keep the specific one.
function dropGeneric(tags) {
  const ns = tags.map(norm);
  return tags.filter((t, i) => !ns.some((o, j) => j !== i && o.endsWith(" " + ns[i])));
}

function item(t) {
  const n = norm(t);
  if (MASS.has(n) || MASS.has(n.split(" ").pop())) return n;
  if (/dress$/.test(n)) return article(n);
  return PLURALISH.test(n) ? n : article(n);
}

// ---------- Characters ----------
function hairParts(n) {
  const m = n.match(/^(.+) hair$/);
  if (!m) return null;
  let rest = m[1], length = "";
  for (const l of LENGTHS) if (rest === l || rest.startsWith(l + " ")) { length = l; rest = rest.slice(l.length).trim(); break; }
  if (rest && !COLORS.has(rest)) return length && !rest ? { length } : null;
  return { length, color: rest };
}

function hairPhrase(tags) {
  let length = "", texture = "";
  const colors = [], inStyles = [], withStyles = [], used = new Set();
  for (const t of tags) {
    const n = norm(t);
    const parts = hairParts(n);
    if (parts && (parts.length || parts.color)) {
      if (parts.length) length = parts.length;
      if (parts.color && !colors.includes(parts.color)) colors.push(parts.color);
      used.add(t);
    } else if (HAIR_TEXTURE.test(n)) { texture = n.replace(/ hair$/, ""); used.add(t); }
    else if (HAIR_IN.test(n)) {
      const style = n === "hair bun" ? "a bun" : /ponytail$|^single braid$|^braid$|^french braid$|^side braid$|^bob cut$|^hime cut$/.test(n) ? article(n) : n;
      inStyles.push(style); used.add(t);
    } else if (HAIR_WITH.test(n)) { withStyles.push(n); used.add(t); }
  }
  if (!used.size) return { text: "", used };
  let text = [length, texture, colors.length > 1 ? colors.join("-and-") : colors[0], "hair"].filter(Boolean).join(" ");
  if (inStyles.length) text += " in " + joinAnd(inStyles);
  if (withStyles.length) text += " with " + joinAnd(withStyles);
  return { text, used };
}

function eyesPhrase(tags) {
  const colors = [], used = new Set();
  let hetero = false;
  for (const t of tags) {
    const n = norm(t);
    if (n === "heterochromia") { hetero = true; used.add(t); continue; }
    const m = n.match(/^(.+) eyes$/);
    if (m && COLORS.has(m[1])) { colors.push(m[1]); used.add(t); }
  }
  if (hetero) return { text: colors.length ? `heterochromatic ${joinAnd(colors)} eyes` : "heterochromatic eyes", used };
  return { text: colors.length ? `${colors.join("-and-")} eyes` : "", used };
}

function characterSlots(tags) {
  const live = dropGeneric(tags.filter((t) => !DROP.has(norm(t))));
  const used = new Set();
  let who = "", species = "";
  for (const t of live) { const n = norm(t); if (!who && COUNT[n]) { who = COUNT[n]; used.add(t); } }
  for (const t of live) {
    const n = norm(t);
    if (AGE[n]) { const [from, to] = AGE[n]; who = who ? who.replace(from + (who.endsWith("s") ? "s" : ""), to) : article(to); if (/^a [aeiou]/.test(who)) who = article(who.slice(2)); used.add(t); }
    else if (KEMONO.test(n)) { who = article(n); used.add(t); }
    else if (!species && SPECIES.has(n)) { species = n; used.add(t); }
  }
  if (species) {
    const m = who.match(/^(an?|two|three|several) (.+)$/);
    if (!who) who = article(species);
    else if (m) who = m[1].startsWith("a") ? article(`${species} ${m[2]}`) : `${m[1]} ${species} ${m[2]}`;
  }
  if (!who) who = "a person";
  const hair = hairPhrase(live);
  const eyes = eyesPhrase(live);
  const features = live.filter((t) => !used.has(t) && !hair.used.has(t) && !eyes.used.has(t)).map(phrase);
  return { who, hair: hair.text, eyes: eyes.text, features: joinAnd(features), appearance: joinAnd([hair.text, eyes.text, ...features]) };
}

// ---------- Scenes ----------
function sceneSlots(tags) {
  const live = dropGeneric(tags.filter((t) => !DROP.has(norm(t))));
  let time = "";
  const places = [], details = [];
  for (const t of live) {
    const n = norm(t);
    if (!time && TIMES[n]) time = TIMES[n];
    else if (PLACES.has(n) && places.length < 3) places.push(n);
    else details.push(phrase(t));
  }
  return { place: places.length ? article(places.join(" ")) : "", time, details: joinAnd(details) };
}

// ---------- Templates ----------
export function fillTemplate(template, slots) {
  const filled = template.replace(/\[([^\]]*)\]/g, (_, inner) => {
    const names = [...inner.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    return names.every((n) => slots[n]) ? inner : "";
  });
  return filled.replace(/\{(\w+)\}/g, (_, n) => slots[n] || "").replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").replace(/^[,\s]+|[,\s]+$/g, "").trim();
}

export function slotsFor(type, tags) {
  switch (type) {
    case "character": return characterSlots(tags);
    case "outfit": return { items: joinAnd(dropGeneric(tags.filter((t) => !DROP.has(norm(t)))).map(item)) };
    case "scene": return sceneSlots(tags);
    default: return { list: joinAnd(dropGeneric(tags.filter((t) => !DROP.has(norm(t)))).map(phrase)) };
  }
}

// The one entry point: tags (strings or {t, off}) in, a prose draft out.
// `extra` adds slots the tags can't provide, such as a cast member's {name}.
export function proseFromTags(type, tags, templates, extra = {}) {
  const names = (tags || []).filter((x) => !(x && x.off)).map((x) => (typeof x === "string" ? x : x.t)).filter(Boolean);
  const live = names.filter((t) => !DROP.has(norm(t)));
  if (!live.length) return "";
  const tpl = (templates && templates[type]) || DEFAULT_TEMPLATES[type] || "{list}";
  return fillTemplate(tpl, { ...slotsFor(type, live), ...extra }) || joinAnd(live.map(phrase));
}
