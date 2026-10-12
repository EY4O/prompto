import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PROFILES, render, lint, toA1111, parseTags, estimateClipTokens, fmtTag, loraBase, looksLikeTags, resolveBlocks
} from "../lib/render.js";
import { SEED } from "../lib/seed.js";

const clone = (v) => JSON.parse(JSON.stringify(v));
const T = (...tags) => tags.map((t) => ({ t, w: 1 }));
const seedDb = () => ({ ...clone(SEED), profiles: clone(DEFAULT_PROFILES), settings: {} });
const recipe = (db, id) => db.recipes.find((r) => r.id === id);
const P = DEFAULT_PROFILES;

const castDb = () => ({
  characters: [{
    id: "c1", name: "Rin", trigger: "rin_aozora",
    appearance: ["1girl", "long hair", "silver hair", "twin braids"], prose: "",
    outfits: { street: { tags: ["white capelet", "capelet"], prose: "" }, posh: { tags: ["ball gown"], prose: "in a ball gown" } }
  }],
  settings: {}
});

describe("render() per default profile", () => {
  test("illustrious (tags): quality prefix first, weights kept, profile negative", () => {
    const db = seedDb();
    const out = render(recipe(db, "rec_1"), P.illustrious, db);
    assert.ok(out.positive.startsWith("masterpiece, best quality, amazing quality, very aesthetic, absurdres, newest, rin_aozora, 1girl, silver hair"));
    assert.match(out.positive, /\(backlighting:1\.2\)/);
    assert.match(out.positive, /oversized hoodie, black shorts, high-top sneakers/);
    assert.ok(!out.positive.includes("\n"), "tag format has no prose section");
    assert.equal(out.negative, P.illustrious.negative);
    assert.deepEqual(out.missingProse, [], "tag profiles never report missing prose");
    assert.equal(out.tagList[0].t, "masterpiece");
  });

  test("anima (hybrid): tags, a blank line, then prose; weights dropped", () => {
    const db = seedDb();
    const out = render(recipe(db, "rec_1"), P.anima, db);
    const [tags, prose] = out.positive.split("\n\n");
    assert.ok(tags.startsWith("masterpiece, best quality, rin_aozora"));
    assert.ok(tags.includes("backlighting") && !tags.includes("(backlighting:1.2)"));
    assert.ok(prose.startsWith("A young woman with long silver hair in twin braids"));
    // the camera block has no prose, so it's drafted and reported
    assert.match(prose, /Seen from behind, a cowboy shot and a shallow depth of field\./);
    assert.deepEqual(out.missingProse, ["camera"]);
    assert.equal(out.drafted, true);
  });

  test("flux krea (prose): no prefix, negative is null even if the recipe sets one", () => {
    const db = seedDb();
    const r = recipe(db, "rec_2");
    r.negative = "ugly";
    const out = render(r, P.krea, db);
    assert.equal(out.negative, null);
    assert.ok(out.positive.startsWith("An elderly botanist"));
    assert.ok(!out.positive.includes("masterpiece"));
    assert.ok(out.positive.endsWith("Kodak Portra."), "sentences get a full stop");
  });

  test("qwen (prose): recipe negative overrides the profile default", () => {
    const db = seedDb();
    const r = recipe(db, "rec_3");
    assert.equal(render(r, P.qwen, db).negative, P.qwen.negative);
    r.negative = "  watermark, logo  ";
    assert.equal(render(r, P.qwen, db).negative, "watermark, logo");
  });

  test("every seed recipe renders with its own profile", () => {
    const db = seedDb();
    for (const r of db.recipes) {
      const out = render(r, P[r.profile], db);
      assert.equal(typeof out.positive, "string");
      assert.ok(out.positive.length > 20, r.id);
    }
  });
});

describe("render() blocks", () => {
  test("character block expands to trigger + appearance + chosen outfit", () => {
    const db = castDb();
    const r = { blocks: [{ type: "character", ref: "c1", outfit: "posh" }], negative: "" };
    const out = render(r, P.illustrious, db);
    assert.ok(out.positive.endsWith("rin_aozora, 1girl, long hair, silver hair, twin braids, ball gown"));
    const blocks = resolveBlocks(r, db);
    assert.deepEqual(blocks.map((b) => b.type), ["character", "outfit"]);
    assert.equal(blocks[1].label, "posh");
  });

  test("character block with an unknown ref is skipped", () => {
    const r = { blocks: [{ type: "character", ref: "nope" }, { type: "pose", tags: T("standing") }] };
    assert.deepEqual(resolveBlocks(r, castDb()).map((b) => b.type), ["pose"]);
  });

  test("drafted prose when a block has no prose (autoProse on), trigger left out", () => {
    const db = castDb();
    const r = { blocks: [{ type: "character", ref: "c1", outfit: "street" }], negative: "" };
    const out = render(r, P.krea, db);
    assert.equal(out.positive, "Rin, a girl with long silver hair in twin braids. Wearing a white capelet.");
    assert.ok(!/rin.aozora/i.test(out.positive));
    assert.deepEqual(out.missingProse, ["Rin", "street"]);
  });

  test("autoProse: false uses tags as written", () => {
    const db = castDb();
    const r = { blocks: [{ type: "pose", tags: T("standing", "hand on hip") }] };
    const out = render(r, { ...P.krea, autoProse: false }, db);
    assert.equal(out.positive, "Standing, hand on hip.");
    assert.equal(out.drafted, false);
  });

  test("muted tags and muted blocks are left out", () => {
    const r = { blocks: [{ type: "pose", tags: [{ t: "sitting", w: 1, off: true }, { t: "smile", w: 1 }] }, { type: "scene", off: true, tags: T("beach") }] };
    const out = render(r, { ...P.illustrious, prefix: [] }, castDb());
    assert.equal(out.positive, "smile");
  });

  // BUG: resolveBlocks() builds a fresh object for character blocks and drops
  // `off`, so muting a character block in the side panel (block-mute) has no effect.
  test("muted character block is left out (lib/render.js resolveBlocks drops b.off)", () => {
    const r = { blocks: [{ type: "character", ref: "c1", outfit: "posh", off: true }, { type: "pose", tags: T("smile") }] };
    const out = render(r, { ...P.illustrious, prefix: [] }, castDb());
    assert.equal(out.positive, "smile");
  });
});

describe("lint()", () => {
  const base = { ...P.illustrious, prefix: [] };
  test("duplicates (including the quality prefix)", () => {
    const issues = lint({ blocks: [{ type: "style", tags: T("masterpiece", "Masterpiece") }] }, P.illustrious, castDb());
    assert.ok(issues.includes("“masterpiece” appears 3 times"), issues.join(" | "));
  });
  test("conflicting tags", () => {
    const issues = lint({ blocks: [{ type: "character", tags: T("short hair", "long hair") }, { type: "scene", tags: T("day", "night") }] }, base, castDb());
    assert.ok(issues.includes("“short hair” conflicts with “long hair”"));
    assert.ok(issues.includes("“day” conflicts with “night”"));
  });
  test("weights above 1.5 may burn on a weighted profile", () => {
    const issues = lint({ blocks: [{ type: "lighting", tags: [{ t: "glow", w: 1.6 }, { t: "rim light", w: 1.5 }] }] }, base, castDb());
    assert.deepEqual(issues, ["“glow” at 1.6 may burn"]);
  });
  test("profiles without weights report that weights are ignored", () => {
    const issues = lint({ blocks: [{ type: "lighting", tags: [{ t: "glow", w: 1.3 }], prose: "glowing" }] }, P.anima, castDb());
    assert.ok(issues.includes("Anima ignores weights"), issues.join(" | "));
  });
  test("missing LoRA only when db.settings.loraList is set", () => {
    const db = castDb();
    const r = { blocks: [], settings: { loras: [{ name: "detail.safetensors", w: 1 }, { name: "Missing_Lora.safetensors", w: 1 }] } };
    assert.deepEqual(lint(r, base, db), [], "no list, no check");
    db.settings.loraList = { names: ["styles\\detail.safetensors"] };
    assert.deepEqual(lint(r, base, db), ["LoRA “missing_lora” isn't in ComfyUI's loras folder"]);
  });
  test("drafted vs as-written prose notes", () => {
    const r = { blocks: [{ type: "pose", tags: T("standing") }] };
    assert.deepEqual(lint(r, P.krea, castDb()), ["pose prose is drafted from its tags"]);
    assert.deepEqual(lint(r, { ...P.krea, autoProse: false }, castDb()), ["pose has no prose, so tags are used as written"]);
  });
  test("a clean recipe has no issues", () => {
    assert.deepEqual(lint({ blocks: [{ type: "pose", tags: T("standing", "smile") }] }, base, castDb()), []);
  });
});

describe("toA1111()", () => {
  test("positive + LoRAs, negative line, settings line with sampler name mapping", () => {
    const db = seedDb();
    const text = toA1111(recipe(db, "rec_1"), P.illustrious, db);
    const lines = text.split("\n");
    assert.equal(lines.length, 3);
    assert.ok(lines[0].endsWith(", depth of field <lora:rin_aozora_v2:0.8>"), lines[0]);
    assert.equal(lines[1], "Negative prompt: " + P.illustrious.negative);
    assert.equal(lines[2], "Steps: 28, Sampler: Euler a, Schedule type: Normal, CFG scale: 5, Seed: 918273645, Size: 832x1216, Model: illustriousXL_v10");
  });
  test("unknown sampler names pass through; dpmpp_2m maps", () => {
    const db = seedDb();
    assert.match(toA1111(recipe(db, "rec_4"), P.anima, db), /Sampler: er_sde,/);
    const r = { blocks: [{ type: "subject", tags: T("cat") }], settings: { sampler: "dpmpp_2m", scheduler: "karras" } };
    assert.match(toA1111(r, P.illustrious, db), /Sampler: DPM\+\+ 2M, Schedule type: Karras/);
  });
  test("no negative line for a null-negative profile", () => {
    const db = seedDb();
    const text = toA1111(recipe(db, "rec_2"), P.krea, db);
    assert.ok(!text.includes("Negative prompt"));
    assert.equal(text.split("\n").length, 2);
  });
  test("fx hook post-processes positive and negative", () => {
    const db = seedDb();
    const seen = [];
    const fx = (s, kind) => { seen.push(kind); return kind === "pos" ? "POS" : "NEG"; };
    const text = toA1111({ blocks: [], settings: {} }, P.illustrious, db, fx);
    assert.equal(text, "POS\nNegative prompt: NEG");
    assert.deepEqual(seen, ["pos", "neg"]);
  });
});

describe("parseTags()", () => {
  test("plain tags, underscores become spaces, newlines split", () => {
    assert.deepEqual(parseTags("1girl, long_hair,\nsmile"), [{ t: "1girl", w: 1 }, { t: "long hair", w: 1 }, { t: "smile", w: 1 }]);
  });
  test("weighted group gives each tag inside the weight", () => {
    assert.deepEqual(parseTags("(worst quality, low quality:1.4), cat"), [
      { t: "worst quality", w: 1.4 }, { t: "low quality", w: 1.4 }, { t: "cat", w: 1 }
    ]);
    assert.deepEqual(parseTags("(red hair:0.8)"), [{ t: "red hair", w: 0.8 }]);
  });
  test("single parentheses are 1.1", () => {
    assert.deepEqual(parseTags("(smile), (a, b)"), [{ t: "smile", w: 1.1 }, { t: "a", w: 1.1 }, { t: "b", w: 1.1 }]);
  });
  test("escaped parentheses are literal and don't nest", () => {
    assert.deepEqual(parseTags("frieren \\(sousou no frieren\\), smile"), [{ t: "frieren (sousou no frieren)", w: 1 }, { t: "smile", w: 1 }]);
  });
  test("{a|b} wildcards stay whole even with commas", () => {
    assert.deepEqual(parseTags("{red, blue|green}, cat"), [{ t: "{red, blue|green}", w: 1 }, { t: "cat", w: 1 }]);
  });
  test("__wildcard__ keeps its underscores", () => {
    assert.deepEqual(parseTags("__hair_color__, long_hair"), [{ t: "__hair_color__", w: 1 }, { t: "long hair", w: 1 }]);
  });
  test("fmtTag writes weights and escapes parens", () => {
    assert.equal(fmtTag({ t: "frieren (sousou no frieren)", w: 1.2 }), "(frieren \\(sousou no frieren\\):1.2)");
    assert.equal(fmtTag({ t: "cat", w: 1.2 }, false), "cat");
    assert.equal(fmtTag({ t: "cat" }), "cat");
  });
});

describe("render helpers", () => {
  test("estimateClipTokens returns a number", () => {
    const n = estimateClipTokens("masterpiece, 1girl, (smile:1.2)");
    assert.equal(typeof n, "number");
    assert.ok(Number.isFinite(n) && n > 0);
    assert.equal(estimateClipTokens(""), 0);
  });
  test("loraBase strips folders, extension and case", () => {
    assert.equal(loraBase("chars\\Rin/Rin_V2.safetensors"), "rin_v2");
    assert.equal(loraBase(null), "");
  });
  test("looksLikeTags", () => {
    assert.equal(looksLikeTags("1girl, smile, outdoors"), true);
    assert.equal(looksLikeTags("a cat sitting on a mat, in the warm sun, painted in oils by an old master"), false);
    assert.equal(looksLikeTags("a, b"), false);
  });
});
