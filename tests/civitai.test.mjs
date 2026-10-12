import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { imageIdFromUrl, postIdFromUrl, hostOf, hasMeta, mapSampler, smallImage, civitaiToRecipe, fetchCivitaiImage, fetchCivitaiPost } from "../lib/civitai.js";
import { stubFetch } from "./helpers.mjs";

let stub = null;
afterEach(() => { if (stub) stub.restore(); stub = null; });

test("imageIdFromUrl", () => {
  assert.equal(imageIdFromUrl("https://civitai.com/images/12345?postId=9"), 12345);
  assert.equal(imageIdFromUrl("https://civitai.green/images/7"), 7);
  assert.equal(imageIdFromUrl("https://civitai.com/models/12345"), null);
  assert.equal(imageIdFromUrl("https://notcivitai.com/images/1"), null);
  assert.equal(imageIdFromUrl("nope"), null);
});

describe("mapSampler", () => {
  test("scheduler suffix is split off", () => {
    assert.deepEqual(mapSampler("DPM++ 2M Karras"), { sampler: "dpmpp_2m", scheduler: "karras" });
    assert.deepEqual(mapSampler("DPM++ 2M SDE Exponential"), { sampler: "dpmpp_2m_sde", scheduler: "exponential" });
  });
  test("Euler a", () => {
    assert.deepEqual(mapSampler("Euler a"), { sampler: "euler_ancestral", scheduler: "" });
    assert.deepEqual(mapSampler("Euler a", "Karras"), { sampler: "euler_ancestral", scheduler: "karras" });
  });
  test("ComfyUI names pass through; unknown names are slugged", () => {
    assert.deepEqual(mapSampler("euler_ancestral", "simple"), { sampler: "euler_ancestral", scheduler: "simple" });
    assert.deepEqual(mapSampler("DPM++ 4M Fancy"), { sampler: "dpmpp_4m_fancy", scheduler: "" });
    assert.deepEqual(mapSampler(undefined), { sampler: "", scheduler: "" });
  });
});

test("smallImage asks the CDN for a 450px copy", () => {
  assert.equal(smallImage("https://image.civitai.com/abc/uuid/original=true/1.jpeg"), "https://image.civitai.com/abc/uuid/width=450/1.jpeg");
  assert.equal(smallImage("https://image.civitai.com/abc/uuid/width=1024/1.jpeg"), "https://image.civitai.com/abc/uuid/width=450/1.jpeg");
  assert.equal(smallImage(null), "");
});

describe("civitaiToRecipe", () => {
  test("nested meta.meta with resources and <lora:> in the prompt", () => {
    const item = {
      width: 1, height: 1,
      meta: { meta: {
        prompt: "1girl, <lora:rin_v2:0.7>, smile,  <lora:Detail:-0.5>, outdoors",
        negativePrompt: " lowres ",
        sampler: "DPM++ 2M Karras", steps: 30, cfgScale: 7, seed: 5, Size: "832x1216",
        resources: [
          { type: "lora", name: "detail", weight: 1 },
          { type: "lora", name: "glow", weight: 0.4 },
          { type: "model", name: "ponyV6" }
        ],
        civitaiResources: [{ type: "lora", modelVersionName: "eyes_v1", weight: 0.6 }, { type: "checkpoint", modelVersionName: "x" }]
      } }
    };
    const r = civitaiToRecipe(item);
    assert.equal(r.format, "Civitai");
    assert.equal(r.positive, "1girl, smile, outdoors");
    assert.equal(r.negative, "lowres");
    assert.equal(r.comfy, null);
    assert.deepEqual(r.settings, {
      model: "ponyV6",
      loras: [{ name: "rin_v2", w: 0.7 }, { name: "Detail", w: -0.5 }, { name: "glow", w: 0.4 }, { name: "eyes_v1", w: 0.6 }],
      sampler: "dpmpp_2m", scheduler: "karras", steps: 30, cfg: 7, seed: 5, width: 832, height: 1216
    });
  });

  test("flat meta, Model field, size from the item, ComfyUI graph kept", () => {
    const graph = { "3": { class_type: "KSampler", inputs: { seed: 1, positive: ["6", 0], negative: ["7", 0] } }, "6": { class_type: "CLIPTextEncode", inputs: { text: "p" } }, "7": { class_type: "CLIPTextEncode", inputs: { text: "n" } } };
    const r = civitaiToRecipe({ width: 640, height: 480, meta: { prompt: "a cat", Model: "flux1-dev", sampler: "Euler", comfy: JSON.stringify({ prompt: graph }) } });
    assert.equal(r.settings.model, "flux1-dev");
    assert.equal(r.settings.width, 640);
    assert.equal(r.settings.height, 480);
    assert.equal(r.settings.steps, undefined);
    assert.equal(r.settings.sampler, "euler");
    assert.deepEqual(r.comfy.pos, { id: "6", key: "text" });
    assert.equal(r.negative, "");
  });

  test("item with no meta", () => {
    const r = civitaiToRecipe({});
    assert.equal(r.positive, "");
    assert.deepEqual(r.settings.loras, []);
  });
});

describe("fetchCivitaiImage (stubbed)", () => {
  test("retries with nsfw=X when the default level has nothing", async () => {
    stub = stubFetch((url) => (url.includes("nsfw=X") ? { items: [{ id: 9, meta: { prompt: "x" } }] } : { items: [] }));
    const item = await fetchCivitaiImage(9);
    assert.equal(item.id, 9);
    assert.equal(stub.calls.length, 2);
    assert.match(stub.calls[0].url, /imageId=9&withMeta=true$/);
  });
  test("throws when there's no public image", async () => {
    stub = stubFetch(() => ({ items: [] }));
    await assert.rejects(fetchCivitaiImage(1), /no public image/);
  });
});

describe("hosts and posts", () => {
  test("post ids and hosts", () => {
    assert.equal(postIdFromUrl("https://civitai.red/posts/77?x=1"), 77);
    assert.equal(postIdFromUrl("https://civitai.com/images/77"), null);
    assert.equal(imageIdFromUrl("https://civitai.red/images/5"), 5);
    assert.equal(hostOf("https://civitai.red/images/5"), "civitai.red");
    assert.equal(hostOf("https://www.civitai.com/images/5"), "civitai.com");
    assert.equal(hostOf("https://example.com/images/5"), "civitai.com");
  });
  test("the API is asked on the page's own host", async () => {
    stub = stubFetch(() => ({ items: [{ id: 5, meta: { prompt: "x" } }] }));
    await fetchCivitaiImage(5, "civitai.red");
    assert.equal(stub.calls[0].url, "https://civitai.red/api/v1/images?imageId=5&withMeta=true");
  });
  test("falls back to civitai.com when that host's API fails", async () => {
    stub = stubFetch((url) => (url.includes("civitai.green") ? { status: 404, body: {} } : { items: [{ id: 5 }] }));
    assert.equal((await fetchCivitaiImage(5, "civitai.green")).id, 5);
    assert.ok(stub.calls[1].url.startsWith("https://civitai.com/"));
  });
  test("a post lists its images; hasMeta tells which have recipes", async () => {
    stub = stubFetch(() => ({ items: [{ id: 1, meta: { prompt: "a" } }, { id: 2, meta: null }, { id: 3, meta: { meta: { civitaiResources: [{ type: "lora" }] } } }] }));
    const items = await fetchCivitaiPost(77, "civitai.com");
    assert.ok(stub.calls[0].url.endsWith("postId=77&limit=50&withMeta=true"));
    assert.deepEqual(items.map(hasMeta), [true, false, true]);
  });
});

describe("civitaiToRecipe keeps the exact model references", () => {
  test("hashes, version ids, base model; tag + resource + civitaiResource are one LoRA", () => {
    const r = civitaiToRecipe({
      id: 555, baseModel: "Illustrious",
      meta: { prompt: "a lighthouse, <lora:watercolor_v3:0.8>", Model: "illustriousXL_v20", "Model hash": "1A2B3C4D5E", sampler: "Euler a",
        resources: [{ name: "Watercolor Wash", type: "lora", weight: 0.8, hash: "aaaa1111bb" }],
        civitaiResources: [{ type: "checkpoint", modelVersionId: 999 }, { type: "lora", weight: 0.8, modelVersionId: 111, modelVersionName: "v3" }] }
    }, "https://civitai.red/images/555");
    assert.deepEqual(r.settings.loras, [{ name: "watercolor_v3", w: 0.8, hash: "aaaa1111bb", versionId: 111, label: "Watercolor Wash" }]);
    assert.deepEqual(r.settings.modelRef, { hash: "1a2b3c4d5e", versionId: 999 });
    assert.equal(r.settings.baseModel, "Illustrious");
  });
});
