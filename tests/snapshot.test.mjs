import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILES, usesProfileSettings, applyProfileSettings, settingsSummary } from "../lib/render.js";
import { snapshot } from "../lib/snapshot.js";
import { SEED } from "../lib/seed.js";

const clone = (v) => JSON.parse(JSON.stringify(v));
const seedDb = () => ({ ...clone(SEED), profiles: clone(DEFAULT_PROFILES), settings: {} });
const P = DEFAULT_PROFILES;

describe("profile settings", () => {
  test("every starting profile has sampler settings", () => {
    for (const p of Object.values(P)) for (const k of ["sampler", "scheduler", "steps", "cfg", "width", "height"]) assert.ok(p.settings[k] != null, `${p.id}.${k}`);
    assert.deepEqual(P.anima.settings, { sampler: "er_sde", scheduler: "simple", steps: 30, cfg: 4, width: 896, height: 1152 });
  });
  test("applyProfileSettings copies the profile's values and leaves seed and model", () => {
    const s = applyProfileSettings({ seed: 7, model: "x.safetensors", sampler: "euler" }, P.anima);
    assert.equal(s.sampler, "er_sde"); assert.equal(s.width, 896); assert.equal(s.seed, 7); assert.equal(s.model, "x.safetensors");
  });
  test("usesProfileSettings: untouched settings follow the profile, edited ones don't", () => {
    const s = applyProfileSettings({ seed: 1 }, P.illustrious);
    assert.ok(usesProfileSettings(s, P.illustrious));
    assert.ok(!usesProfileSettings(s, P.anima));
    s.cfg = 6.5;
    assert.ok(!usesProfileSettings(s, P.illustrious));
    assert.ok(usesProfileSettings({ steps: 9 }, { settings: {} }), "a profile without settings never disagrees");
  });
  test("settingsSummary", () => {
    assert.equal(settingsSummary(P.anima), "er_sde · simple · 30 steps · CFG 4 · 896×1152");
    assert.equal(settingsSummary({}), "");
  });
});

describe("snapshot()", () => {
  const snap = snapshot(seedDb(), 123);
  test("lists the profiles with their prefix, negative, artist setting and settings", () => {
    const a = snap.profiles.find((p) => p.id === "anima");
    assert.deepEqual(a.prefix, P.anima.prefix);
    assert.equal(a.artistAt, true);
    assert.equal(a.settings.sampler, "er_sde");
    assert.equal(snap.syncedAt, 123);
  });
  test("each recipe comes rendered with every profile", () => {
    const r = snap.recipes.find((x) => x.id === "rec_1");
    assert.equal(r.profileId, "illustrious");
    assert.deepEqual(Object.keys(r.renders).sort(), Object.keys(P).sort());
    assert.equal(r.renders.illustrious.positive, r.positive);
    assert.ok(r.renders.anima.positive.startsWith("masterpiece, best quality, score_7, safe"));
    assert.equal(r.renders.krea.negative, null);
  });
  test("cast members carry their LoRA", () => {
    const rin = snap.cast.find((c) => c.name === "Rin Aozora");
    assert.deepEqual(rin.lora, { name: "rin_aozora_v2.safetensors", w: 0.8 });
    assert.equal(snap.cast.find((c) => c.name === "Captain Vale").lora, null);
  });
});
