# Development

The repository root is the extension: Chrome loads `manifest.json` from it directly. There's no build step.

```
manifest.json        MV3 manifest; `version` is bumped with every change
background.js        service worker (module): context menus, omnibox, Danbooru capture, + Prompto messages
content/danbooru.js  adds the + Prompto button to character tags on Danbooru post pages
sidepanel.html/.css  the side panel
sidepanel.js         views, routing and events for the side panel
lib/render.js        model profiles, block rendering, linter, Forge export
lib/pngmeta.js       PNG text-chunk reader, ComfyUI graph and A1111 parameter parsing
lib/booru.js         Danbooru posts, character looks (related tags) and tag sorting
lib/tags.js          tag list (CSV → IndexedDB), library tags, Danbooru tag lookups
lib/autocomplete.js  the tag suggestion dropdown
lib/comfy.js         ComfyUI heartbeat, tab bridge, in-page graph editing, queueing
lib/seed.js          sample data for first run
docs/                this file, README images
```

## Run it locally

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → this folder.
2. After editing, press the reload arrow on Prompto's card. Close and reopen the side panel to pick up panel changes.
3. Inspect the panel with right-click → **Inspect**; inspect the worker from the **service worker** link on the extension card.

For quick UI work you can also serve the folder (for example `python -m http.server 5178`) and open `sidepanel.html`. Without the `chrome.*` APIs it falls back to `localStorage`, and capture and ComfyUI features are inactive.

## Tests

There's no automated suite yet. The parsing and rendering modules (`lib/render.js`, `lib/pngmeta.js`, `lib/booru.js`) have no DOM dependencies and can be exercised from Node 18+:

```
node -e "import('./lib/render.js').then(m => console.log(Object.keys(m.DEFAULT_PROFILES)))"
```

Danbooru rejects Node's default user agent, so pass a `User-Agent` header when testing `lib/booru.js` from Node.

## Releasing

1. Bump `version` in `manifest.json`: patch for fixes and small changes, minor for features.
2. Commit and push to `main`.
3. For the Chrome Web Store: zip the folder contents (without `.git`, `.claude` and `docs/`), and upload it in the Chrome Web Store developer dashboard. That needs a one-time developer registration and an icon set, which doesn't exist yet.
