// Removing a cast member. Recipes keep working: their blocks for that
// character go too, so nothing renders a character that no longer exists.
export function removeCharacter(db, id) {
  const character = db.characters.find((c) => c.id === id);
  if (!character) return null;
  db.characters = db.characters.filter((c) => c.id !== id);
  const recipes = [];
  for (const r of db.recipes) {
    const before = r.blocks.length;
    r.blocks = r.blocks.filter((b) => b.type !== "character" || b.ref !== id);
    if (r.blocks.length !== before) recipes.push(r);
  }
  return { character, recipes };
}

// Recipes with a character block for this cast member.
export const recipesWithCharacter = (db, id) => db.recipes.filter((r) => r.blocks.some((b) => b.type === "character" && b.ref === id));

export const seriesOf = (c) => (c.series || "").trim() || "Original";

// Orders a list of cast members: "added" keeps the library's order (newest first),
// "az" is by name, "used" is by how many recipes use them.
export function sortCast(list, db, mode = "added") {
  const out = [...list];
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  if (mode === "az") out.sort(byName);
  else if (mode === "used") {
    const n = new Map(out.map((c) => [c.id, recipesWithCharacter(db, c.id).length]));
    out.sort((a, b) => n.get(b.id) - n.get(a.id) || byName(a, b));
  }
  return out;
}
