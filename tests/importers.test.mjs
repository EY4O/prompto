import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { detect, convert, parseCsv } from "../lib/importers.js";

test("parseCsv handles quotes, doubled quotes, CRLF and blank lines", () => {
  const rows = parseCsv('Name,Prompt\r\n"a, b","say ""hi"""\r\n\r\nc,d');
  assert.deepEqual(rows, [{ name: "a, b", prompt: 'say "hi"' }, { name: "c", prompt: "d" }]);
  assert.deepEqual(parseCsv(""), []);
});

describe("A1111 styles.csv", () => {
  const csv = [
    "name,prompt,negative_prompt",
    'Cinematic,"{prompt}, cinematic lighting, film grain, depth of field","lowres, blurry"',
    'Painterly,"oil painting of {prompt}",',
    "Empty,,"
  ].join("\n");

  test("detected", () => {
    const found = detect("styles.csv", csv);
    assert.equal(found.format, "A1111 styles");
    assert.equal(found.rows.length, 3);
  });

  test("{prompt} removed, negative becomes its own snippet", () => {
    const { recipes, snippets } = convert(detect("styles.csv", csv));
    assert.deepEqual(recipes, []);
    assert.deepEqual(snippets, [
      { cat: "A1111 styles", name: "Cinematic", tags: ["cinematic lighting", "film grain", "depth of field"], prose: "" },
      { cat: "Negative", name: "Cinematic (negative)", tags: ["lowres", "blurry"], prose: "" },
      { cat: "A1111 styles", name: "Painterly", tags: [], prose: "oil painting of" }
    ]);
  });
});

test("tag-autocomplete chants", () => {
  const json = JSON.stringify([{ name: "Fantasy", terms: "fantasy,magic", content: "fantasy, magic circle, glowing runes" }]);
  const found = detect("chants.json", json);
  assert.equal(found.format, "Tag-complete chants");
  assert.deepEqual(convert(found), {
    recipes: [],
    snippets: [{ cat: "Chants", name: "Fantasy", tags: ["fantasy", "magic circle", "glowing runes"], prose: "" }]
  });
});

describe("ComfyAssets PromptManager", () => {
  test("JSON export: rating 4+ becomes a favourite, blank prompts skipped", () => {
    const json = JSON.stringify({ prompts: [
      { text: "1girl, smile, outdoors, night", rating: 5, category: "portraits" },
      { text: "a cat asleep in a cardboard box", rating: 2 },
      { text: "   ", rating: 5 }
    ] });
    const found = detect("export.json", json);
    assert.equal(found.format, "PromptManager (ComfyAssets)");
    const { recipes, snippets } = convert(found);
    assert.deepEqual(snippets, []);
    assert.equal(recipes.length, 2);
    assert.equal(recipes[0].fav, true);
    assert.equal(recipes[0].title, "1girl, smile, outdoors");
    assert.deepEqual(recipes[0].blocks[0].tags.map((x) => x.t), ["1girl", "smile", "outdoors", "night"]);
    assert.equal(recipes[0].source, "PromptManager");
    assert.equal(recipes[1].fav, false);
    assert.equal(recipes[1].title, "a cat asleep in a cardboard box");
    assert.equal(recipes[1].blocks[0].prose, "a cat asleep in a cardboard box");
    assert.deepEqual(recipes[1].blocks[0].tags, []);
  });

  test("a bare JSON array works too", () => {
    assert.equal(detect("x.json", JSON.stringify([{ text: "a" }])).format, "PromptManager (ComfyAssets)");
  });

  test("CSV export", () => {
    const csv = "id,text,category,rating\n1,\"masterpiece, 1girl, beach\",x,4\n2,a quiet street at dawn,y,3\n";
    const found = detect("prompts.csv", csv);
    assert.equal(found.format, "PromptManager (ComfyAssets)");
    const { recipes } = convert(found);
    assert.deepEqual(recipes.map((r) => r.fav), [true, false]);
    assert.equal(recipes[1].blocks[0].prose, "a quiet street at dawn");
  });
});

describe("FranckyB Prompt Manager", () => {
  const data = {
    __meta__: { version: 2 },
    _prompt_prefix_: { x: "ignored" },
    Characters: {
      Rin: {
        prompt: "1girl, silver hair",
        thumbnail: "data:image/png;base64,AAAA",
        trigger_words: [{ text: "rin_aozora", active: true }, { text: "off_word", active: false }],
        workflow_data: { models: { model_a: {
          model: "illustriousXL_v10.safetensors",
          positive_prompt: "1girl, silver hair, red eyes, smile",
          negative_prompt: "lowres",
          sampler: { sampler_name: "euler_ancestral", scheduler: "normal", steps: 28, cfg: 5, seed: 7 },
          resolution: { width: 832, height: 1216 },
          loras: [{ name: "rin", path: "chars/rin.safetensors", model_strength: 0.8 }, { name: "detail", model_strength: 0.4 }]
        } } }
      },
      Vale: {
        prompt: "1boy, mature male, stubble",
        loras_a: [{ name: "vale.safetensors", strength: 0.7 }, { name: "off.safetensors", active: false }],
        loras_b: [{ name: "grit.safetensors", model_strength: 0.5 }]
      },
      Plain: { prompt: "golden hour, lens flare, warm light" },
      Legacy: "rim light, dark background",
      _base_prompt_: "hidden"
    }
  };

  test("detected; random JSON is not", () => {
    assert.equal(detect("prompt_manager_data.json", JSON.stringify(data)).format, "Prompt Manager (FranckyB)");
    assert.equal(detect("x.json", JSON.stringify({ foo: 1 })), null);
    assert.equal(detect("x.json", JSON.stringify({ a: { b: 3 } })), null);
    assert.equal(detect("x.json", JSON.stringify([1, 2, 3])), null);
    assert.equal(detect("x.json", "not json"), null);
    assert.equal(detect("x.csv", "a,b\n1,2"), null);
    assert.deepEqual(detect("backup.json", JSON.stringify({ app: "prompto" })), { format: "prompto" });
  });

  test("workflow_data entries become recipes with settings and model_strength LoRAs", () => {
    const { recipes } = convert(detect("p.json", JSON.stringify(data)));
    const rin = recipes.find((r) => r.title === "Rin");
    assert.deepEqual(rin.settings, {
      model: "illustriousXL_v10.safetensors",
      loras: [{ name: "chars/rin.safetensors", w: 0.8 }, { name: "detail", w: 0.4 }],
      sampler: "euler_ancestral", scheduler: "normal", steps: 28, cfg: 5, seed: 7, width: 832, height: 1216
    });
    assert.equal(rin.negative, "lowres");
    assert.equal(rin.image, "data:image/png;base64,AAAA");
    assert.deepEqual(rin.blocks[0].tags.map((x) => x.t), ["1girl", "silver hair", "red eyes", "smile", "rin_aozora"], "active trigger words are appended as written");
    assert.equal(rin.source, "Prompt Manager");
  });

  test("loras_a..d alone also make a recipe", () => {
    const { recipes } = convert(detect("p.json", JSON.stringify(data)));
    const vale = recipes.find((r) => r.title === "Vale");
    assert.deepEqual(vale.settings.loras, [{ name: "vale.safetensors", w: 0.7 }, { name: "grit.safetensors", w: 0.5 }]);
    assert.equal(vale.settings.model, "");
  });

  test("plain prompts become snippets (incl. legacy strings); hidden keys ignored", () => {
    const { recipes, snippets } = convert(detect("p.json", JSON.stringify(data)));
    assert.deepEqual(recipes.map((r) => r.title), ["Rin", "Vale"]);
    assert.deepEqual(snippets, [
      { cat: "Characters", name: "Plain", tags: ["golden hour", "lens flare", "warm light"], prose: "" },
      { cat: "Characters", name: "Legacy", tags: ["rim light", "dark background"], prose: "" }
    ]);
  });
});

test("convert of an unknown format is empty", () => {
  assert.deepEqual(convert({ format: "prompto" }), { recipes: [], snippets: [] });
});
