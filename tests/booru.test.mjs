import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  postIdFromUrl, e621IdFromUrl, classify, draftCharacter, sceneTags, fetchPost, fetchE621, fetchLook, postFromGroups, displayName
} from "../lib/booru.js";
import { stubFetch } from "./helpers.mjs";

let stub = null;
afterEach(() => { if (stub) stub.restore(); stub = null; });

describe("URL parsing", () => {
  test("postIdFromUrl accepts donmai.us posts only", () => {
    assert.deepEqual(postIdFromUrl("https://danbooru.donmai.us/posts/123456?q=frieren"), { host: "https://danbooru.donmai.us", id: 123456 });
    assert.deepEqual(postIdFromUrl("https://safebooru.donmai.us/posts/7"), { host: "https://safebooru.donmai.us", id: 7 });
    assert.equal(postIdFromUrl("https://danbooru.donmai.us/posts?tags=x"), null);
    assert.equal(postIdFromUrl("https://evil-donmai.us/posts/1"), null);
    assert.equal(postIdFromUrl("not a url"), null);
  });
  test("e621IdFromUrl accepts e621 and e926", () => {
    assert.deepEqual(e621IdFromUrl("https://e621.net/posts/42"), { host: "https://e621.net", id: 42 });
    assert.deepEqual(e621IdFromUrl("https://e926.net/posts/9?x=1"), { host: "https://e926.net", id: 9 });
    assert.equal(e621IdFromUrl("https://danbooru.donmai.us/posts/42"), null);
    assert.equal(e621IdFromUrl("::"), null);
  });
});

describe("classify", () => {
  const cases = {
    "1girl": "count", "2boys": "count", "6+girls": "count",
    "hair ribbon": "outfit", "white capelet": "outfit", "thighhighs": "outfit", "katana": "outfit",
    "hair between eyes": "appearance", "long_hair": "appearance", "green eyes": "appearance", "pointy ears": "appearance", "mature female": "appearance",
    "holding staff": "skip", "smile": "skip", "blue sky": "skip", "outdoors": "skip"
  };
  for (const [tag, kind] of Object.entries(cases)) test(`${tag} → ${kind}`, () => assert.equal(classify(tag), kind));
});

describe("draftCharacter", () => {
  const bucketsOf = (d) => Object.fromEntries(d.buckets.map((x) => [x.t, x.b]));

  test("solo post: every appearance/outfit tag goes to the character", () => {
    const post = { characters: ["frieren"], copyrights: ["sousou no frieren"], general: ["1girl", "long hair", "white hair", "white capelet", "smile", "outdoors"] };
    const d = draftCharacter("frieren", post, { frieren: null });
    assert.equal(d.name, "Frieren");
    assert.equal(d.series, "Sousou No Frieren");
    assert.equal(d.postCount, 0);
    assert.equal(d.soloLook, false);
    assert.deepEqual(bucketsOf(d), {
      "long hair": "appearance", "white hair": "appearance", "white capelet": "outfit",
      "1girl": "skip", smile: "skip", outdoors: "skip"
    });
  });

  test("look tags above the threshold are added, maybes go to skip", () => {
    const post = { characters: ["frieren"], copyrights: [], general: [] };
    const look = { postCount: 900, solo: true, tags: [
      { name: "1girl", freq: 0.95 }, { name: "elf", freq: 0.9 }, { name: "twintails", freq: 0.7 }, { name: "earrings", freq: 0.3 }, { name: "staff", freq: 0.1 }
    ] };
    const d = draftCharacter("frieren", post, { frieren: look });
    assert.deepEqual(bucketsOf(d), { "1girl": "appearance", elf: "appearance", twintails: "appearance", earrings: "skip" });
    assert.equal(d.buckets.find((x) => x.t === "elf").f, 0.9);
    assert.equal(d.postCount, 900);
    assert.equal(d.soloLook, true);
  });

  test("multi-character post: a shared tag goes to the character Danbooru ties it to most", () => {
    const post = { characters: ["frieren", "himmel (sousou no frieren)"], copyrights: ["sousou no frieren"], general: ["1girl", "1boy", "earrings", "blue hair"] };
    const looks = {
      frieren: { postCount: 500, solo: true, tags: [{ name: "earrings", freq: 0.35 }, { name: "blue hair", freq: 0.02 }] },
      "himmel (sousou no frieren)": { postCount: 300, solo: true, tags: [{ name: "earrings", freq: 0.25 }, { name: "blue hair", freq: 0.3 }] }
    };
    const f = bucketsOf(draftCharacter("frieren", post, looks));
    const h = bucketsOf(draftCharacter("himmel (sousou no frieren)", post, looks));
    assert.equal(f.earrings, "outfit");
    assert.equal(h.earrings, "skip");
    assert.equal(h["blue hair"], "appearance");
    assert.equal(f["blue hair"], "skip");
  });

  test("series falls back to the tag qualifier, then Original", () => {
    const post = { characters: ["x"], copyrights: [], general: [] };
    assert.equal(draftCharacter("himmel (sousou no frieren)", post, {}).series, "Sousou No Frieren");
    assert.equal(draftCharacter("himmel (sousou no frieren)", post, {}).name, "Himmel");
    assert.equal(draftCharacter("someone", post, {}).series, "Original");
  });

  test("e621 species on a solo post go to appearance", () => {
    const post = { characters: ["sarah (x)"], copyrights: [], species: ["domestic cat"], general: ["domestic cat", "green eyes", "fur"] };
    const b = bucketsOf(draftCharacter("sarah (x)", post, {}));
    assert.equal(b["domestic cat"], "appearance");
    assert.equal(b["green eyes"], "appearance");
    assert.equal(b.fur, "skip");
  });
});

test("sceneTags keeps scene/framing tags only", () => {
  const post = { general: ["1girl", "solo", "outdoors", "blue sky", "smile", "long hair", "holding staff", "from below", "multiple girls"] };
  assert.deepEqual(sceneTags(post), ["outdoors", "blue sky", "from below"]);
});

test("postFromGroups reads older captures", () => {
  const p = postFromGroups({ url: "https://gelbooru.com/index.php?page=post&id=55", source: "gelbooru.com", image: "i.jpg", groups: { character: ["a"], general: ["1girl"] } });
  assert.equal(p.id, 55);
  assert.deepEqual(p.characters, ["a"]);
  assert.deepEqual(p.copyrights, []);
  assert.equal(p.preview, "i.jpg");
});

test("displayName keeps symbol-only names", () => {
  assert.equal(displayName("long_hair"), "long hair");
  assert.equal(displayName("^_^"), "^_^");
});

describe("fetching (stubbed)", () => {
  test("fetchPost reads Danbooru's JSON", async () => {
    stub = stubFetch(() => ({
      id: 101, rating: "g",
      tag_string_character: "frieren himmel_(sousou_no_frieren)", tag_string_general: "1girl long_hair",
      tag_string_copyright: "sousou_no_frieren", tag_string_artist: "x",
      preview_file_url: "https://cdn/p.jpg", large_file_url: "https://cdn/l.jpg"
    }));
    const p = await fetchPost("https://danbooru.donmai.us", 101);
    assert.match(stub.calls[0].url, /^https:\/\/danbooru\.donmai\.us\/posts\/101\.json\?only=/);
    assert.equal(stub.calls[0].init.credentials, "omit");
    assert.deepEqual(p, {
      id: 101, host: "https://danbooru.donmai.us", url: "https://danbooru.donmai.us/posts/101", rating: "g",
      characters: ["frieren", "himmel (sousou no frieren)"], copyrights: ["sousou no frieren"], artists: ["x"],
      general: ["1girl", "long hair"], preview: "https://cdn/p.jpg", image: "https://cdn/l.jpg"
    });
  });

  test("fetchPost throws on an HTTP error", async () => {
    stub = stubFetch(() => ({ status: 404, body: {} }));
    await assert.rejects(fetchPost("https://danbooru.donmai.us", 1), /Danbooru answered 404/);
  });

  test("fetchE621 drops taxonomy species and names the client", async () => {
    stub = stubFetch(() => ({ post: {
      id: 77, rating: "s",
      tags: { general: ["green_eyes", "fur"], species: ["domestic_cat", "felid", "mammal"], character: ["sarah_(x)"], copyright: [], artist: [] },
      preview: { url: "https://static/p.jpg" }, sample: { url: "https://static/s.jpg" }
    } }));
    const p = await fetchE621("https://e621.net", 77);
    assert.match(stub.calls[0].url, /^https:\/\/e621\.net\/posts\/77\.json\?_client=Prompto/);
    assert.equal(p.site, "e621.net");
    assert.deepEqual(p.species, ["domestic cat"]);
    assert.deepEqual(p.general, ["domestic cat", "green eyes", "fur"]);
    assert.deepEqual(p.characters, ["sarah (x)"]);
    assert.equal(p.image, "https://static/s.jpg");
    assert.equal(p.preview, "https://static/p.jpg");
  });

  test("fetchLook falls back from solo posts when there are fewer than 25", async () => {
    stub = stubFetch((url) => decodeURIComponent(url).includes("solo")
      ? { post_count: 10, related_tags: [{ tag: { name: "short_hair", category: 0, post_count: 5 }, frequency: 0.9 }] }
      : { post_count: 400, related_tags: [{ tag: { name: "long_hair", category: 0, post_count: 300 }, frequency: 0.8 }] });
    const cache = {};
    const look = await fetchLook("Frieren", cache);
    assert.equal(stub.calls.length, 2);
    assert.match(decodeURIComponent(stub.calls[0].url), /query=frieren solo rating:g/);
    assert.match(decodeURIComponent(stub.calls[1].url), /query=frieren rating:g&/);
    assert.equal(look.solo, false);
    assert.equal(look.postCount, 400);
    assert.deepEqual(look.tags, [{ name: "long hair", freq: 0.8 }]);
    assert.equal(cache.frieren, look);

    // a fresh cache entry is reused without fetching
    assert.equal(await fetchLook("frieren", cache), look);
    assert.equal(stub.calls.length, 2);

    // an entry older than a week is refetched
    cache.frieren.at = Date.now() - 8 * 864e5;
    await fetchLook("frieren", cache);
    assert.equal(stub.calls.length, 4);
  });

  test("fetchLook keeps the solo look when there are enough solo posts", async () => {
    stub = stubFetch(() => ({ post_count: 30, related_tags: [] }));
    const look = await fetchLook("himmel (sousou no frieren)", null);
    assert.equal(stub.calls.length, 1);
    assert.match(decodeURIComponent(stub.calls[0].url), /query=himmel_\(sousou_no_frieren\) solo/);
    assert.equal(look.solo, true);
    assert.equal(look.postCount, 30);
  });
});
