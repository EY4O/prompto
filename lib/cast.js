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
