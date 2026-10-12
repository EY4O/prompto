# Development

The repository root is the extension: Chrome loads `manifest.json` from it directly. There's no build step.

```
manifest.json        MV3 manifest; `version` is bumped with every change
background.js        service worker (module): context menus, omnibox, Danbooru capture, + Prompto messages
content/booru.js     adds the + Prompto button to character tags on Danbooru, Gelbooru and Safebooru posts
content/civitai.js   the floating + Prompto button on Civitai image and post pages (follows SPA navigation)
sidepanel.html/.css  the side panel
sidepanel.js         views, routing and events for the side panel
lib/render.js        model profiles, block rendering, linter, Forge export
lib/pngmeta.js       PNG text chunks, ComfyUI graph parsing, readRecipeFromFile for any image
lib/exif.js          JPEG/WebP EXIF (UserComment etc.), XMP and comments
lib/recipe1.js       the shared recipe/1 format: A1111, NovelAI, InvokeAI, SwarmUI, Fooocus and Civitai parsers, toMeta/fromMeta
lib/booru.js         Danbooru and e621 posts, character looks (related tags) and tag sorting
lib/civitai.js       Civitai image and post recipes from its images API (.com/.green/.red)
lib/prose.js         tags → prose templates
lib/diff.js          tag and word diffs for recipe versions
lib/wildcards.js     {a|b} and __name__ wildcards, seeded rolls
lib/card.js          share cards: ticket drawing and PNG text chunks
lib/importers.js     readers for other prompt tools' files
lib/sync.js          item-by-item merge for sync (stamps, tombstones; no DOM)
lib/syncfs.js        the sync folder: picker, saved handle, prompto-sync.json
lib/tags.js          tag list (CSV → IndexedDB), library tags, Danbooru tag lookups
lib/autocomplete.js  the tag suggestion dropdown
lib/comfy.js         ComfyUI heartbeat, tab bridge, in-page graph editing, queueing
lib/seed.js          sample data for first run
icons/               extension icons (16, 32, 48, 128), drawn by tools/make-icons.py
tools/make-icons.py  draws both projects' icons; needs Pillow and NumPy
docs/                this file, README images
```

## Run it locally

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → this folder.
2. After editing, press the reload arrow on Prompto's card. Close and reopen the side panel to pick up panel changes.
3. Inspect the panel with right-click → **Inspect**; inspect the worker from the **service worker** link on the extension card.

For quick UI work you can also serve the folder (for example `python -m http.server 5178`) and open `sidepanel.html`. Without the `chrome.*` APIs it falls back to `localStorage`, and capture and ComfyUI features are inactive.

## Tests

Node 18+ and nothing else: the suites use Node's built-in test runner and never touch the network (fetches are stubbed).

```
node --test
```

`tests/fixtures/recipe1.json` is shared with [Model Librarian](https://github.com/EY4O/comfyui-model-librarian) (same path there): both parsers run every case, so the two stay in step. Change both copies together.

| Suite | Covers |
|---|---|
| `render` | profiles (tags, prose, both), weights, negatives, character and outfit blocks, drafted prose, the checker, Forge export, tag parsing |
| `prose` | tags → prose drafts: hair, eyes, count and age, species, scenes, templates |
| `pngmeta` | PNG text chunks (tEXt, zTXt, iTXt), ComfyUI graphs (ControlNet, Flux), A1111 parameters |
| `booru`, `civitai` | post and image parsing, character looks, tag sorting, sampler mapping |
| `tags`, `wildcards`, `diff`, `importers`, `sync` | tag lists, wildcard rolls, version diffs, other tools' files, sync merging |
| `comfy`, `card`, `seed` | loading into a mock ComfyUI graph, share-card chunks, sample data |

GitHub Actions runs the same command on every push (`.github/workflows/test.yml`).

## Icons

`python tools/make-icons.py` redraws `icons/` and `docs/images/icon.png`; `python tools/make-icons.py --comfy ../ComfyUI-Prompto` redraws ComfyUI-Prompto's icon. The 16 and 32px icons drop the tear line and barcode, and 48px drops the barcode, so they stay legible; the 128px icon sits in the Web Store's 96px safe area.

## Releasing

1. Bump `version` in `manifest.json`: patch for fixes and small changes, minor for features.
2. Commit and push to `main`.
3. For the Chrome Web Store: zip the folder contents (without `.git`, `.claude` and `docs/`), and upload it in the Chrome Web Store developer dashboard. That needs a one-time developer registration; the icon set is in `icons/`.
