// What ComfyUI-Prompto gets: prompts already rendered, so the ComfyUI side never
// needs Prompto's rendering rules. Each recipe comes rendered with every profile,
// so the Prompto Recipe node can retarget it to another model.

import { render } from "./render.js";
import { proseFromTags } from "./prose.js";

export function castDraft(c, outfit, templates) {
  return outfit
    ? proseFromTags("outfit", c.outfits[outfit].tags, templates)
    : proseFromTags("character", c.appearance, templates, { name: c.name });
}

export function snapshot(db, now = Date.now()) {
  const templates = db.settings && db.settings.proseTemplates;
  const profiles = Object.values(db.profiles);
  return {
    syncedAt: now,
    profiles: profiles.map((p) => ({
      id: p.id, label: p.label, format: p.format, prefix: p.prefix || [], negative: p.negative,
      artistAt: !!p.artistAt, settings: p.settings || {}
    })),
    recipes: db.recipes.map((r) => {
      const p = db.profiles[r.profile] || profiles[0];
      const out = render(r, p, db);
      const renders = Object.fromEntries(profiles.map((q) => {
        const o = q.id === p.id ? out : render(r, q, db);
        return [q.id, { positive: o.positive, negative: o.negative }];
      }));
      const thumb = r.image && r.image.startsWith("data:") && r.image.length < 80000 ? r.image : null;
      return {
        id: r.id, no: r.no, title: r.title, profile: p.label, profileId: p.id, fav: !!r.fav,
        positive: out.positive, negative: out.negative, renders, settings: r.settings, thumb
      };
    }),
    snippets: db.snippets.map(({ id, cat, name, tags, prose }) => ({ id, cat, name, tags, prose })),
    cast: db.characters.map((c) => ({
      id: c.id, name: c.name, series: c.series, tags: [c.trigger, ...c.appearance].filter(Boolean), prose: c.prose,
      // Drafted prose too, so the Prompto Character node can write prose for any cast member.
      proseDraft: c.prose ? "" : castDraft(c, null, templates),
      lora: c.lora && c.lora.name ? { name: c.lora.name, w: c.lora.w ?? 1 } : null,
      outfits: Object.entries(c.outfits).map(([name, o]) => ({ name, tags: o.tags, prose: o.prose, proseDraft: o.prose ? "" : castDraft(c, name, templates) }))
    }))
  };
}
