// lib/card.js draws on a canvas; only its PNG chunk helpers are tested here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withTextChunks, asciiJson } from "../lib/card.js";
import { readPngText } from "../lib/pngmeta.js";
import { makePng, toArrayBuffer, tEXt } from "./helpers.mjs";

test("asciiJson escapes everything outside ASCII and still parses back", () => {
  const value = { name: "Frieren · フリーレン", emoji: "🌸", plain: "ok" };
  const s = asciiJson(value);
  assert.match(s, /^[\x00-\x7e]*$/);
  assert.ok(s.includes("\\u00b7"));
  assert.deepEqual(JSON.parse(s), value);
});

test("withTextChunks adds chunks before IEND that readPngText reads back", async () => {
  const png = makePng([tEXt("existing", "kept")]);
  const recipe = { app: "prompto", title: "Rainy neon alley", tags: ["1girl", "night"] };
  const out = withTextChunks(png, { prompto: asciiJson(recipe), parameters: "1girl, night\nSteps: 28", skipped: null });
  // still ends with IEND
  assert.equal(String.fromCharCode(...out.subarray(out.length - 8, out.length - 4)), "IEND");
  const chunks = await readPngText(toArrayBuffer(out));
  assert.deepEqual(Object.keys(chunks).sort(), ["existing", "parameters", "prompto"]);
  assert.deepEqual(JSON.parse(chunks.prompto), recipe);
  assert.equal(chunks.parameters, "1girl, night\nSteps: 28");
});

test("non-ASCII text goes into an iTXt chunk as UTF-8", async () => {
  const out = withTextChunks(makePng(), { comment: "café ✓" });
  const types = [];
  for (let p = 8; p + 8 <= out.length;) {
    const len = new DataView(out.buffer, out.byteOffset).getUint32(p);
    types.push(String.fromCharCode(...out.subarray(p + 4, p + 8)));
    p += 12 + len;
  }
  assert.ok(types.includes("iTXt"), types.join(","));
  assert.deepEqual(await readPngText(toArrayBuffer(out)), { comment: "café ✓" });
});
