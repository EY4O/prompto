// Writes Prompto's sample library as a ComfyUI-Prompto snapshot, so the Prompto
// nodes and example workflows work before anything is synced.
// Usage: node tools/export-samples.mjs ../ComfyUI-Prompto/samples.json
import { writeFileSync } from "node:fs";
import { SEED } from "../lib/seed.js";
import { DEFAULT_PROFILES } from "../lib/render.js";
import { snapshot } from "../lib/snapshot.js";

const out = process.argv[2];
if (!out) { console.error("Usage: node tools/export-samples.mjs <path to samples.json>"); process.exit(1); }
const db = { ...structuredClone(SEED), profiles: structuredClone(DEFAULT_PROFILES), settings: {} };
const snap = snapshot(db, 0);
writeFileSync(out, JSON.stringify(snap, null, 1) + "\n");
console.log(`Wrote ${snap.recipes.length} recipes, ${snap.cast.length} cast, ${snap.snippets.length} snippets, ${snap.profiles.length} profiles to ${out}`);
