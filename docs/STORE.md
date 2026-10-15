# Chrome Web Store listing

Everything the Web Store's submission form asks for, ready to paste. Submitting needs a Chrome Web Store developer account (a one-time registration fee) and is done by hand at the [Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## Package

```bash
python tools/package.py
```

Writes `dist/prompto-<version>.zip` with only the files Chrome loads (manifest, service worker, side panel, `lib/`, `content/`, `icons/`, `fonts/`, LICENSE), and stops if a module the extension imports would be left out. Upload that zip. Bump `version` in `manifest.json` before each upload; the store rejects a version it has already seen.

## Images

```bash
python tools/store-assets.py
```

Draws `docs/store/`: three 1280×800 screenshots from the README images, and the 440×280 small promo tile. The store icon is `icons/icon128.png`.

## Store listing

**Name:** Prompto

**Summary** (132 characters at most):

> Capture, organize and remix Stable Diffusion prompts, image recipes and character tags.

**Category:** Productivity (Tools also fits)

**Language:** English

**Description:**

> Prompto is a side panel for the prompts, image recipes and characters you collect while making images with Stable Diffusion, ComfyUI or Forge.
>
> CAPTURE ANYTHING
> Right-click text, an image, a booru post or a Civitai image to save it to Prompto's inbox. Type "p" and a space in the address bar to jot an idea. Drop a PNG, JPEG or WebP on the panel and Prompto reads the prompt, settings and models inside it (ComfyUI, A1111/Forge, Fooocus, InvokeAI, SwarmUI and NovelAI).
>
> ONE RECIPE, EVERY MODEL
> A recipe is built from blocks (subject, character, pose, scene, lighting…) with tags and prose side by side. Model profiles turn it into the right prompt for Illustrious, Anima, Flux Krea or Qwen Image, with each model's quality tags, negative and sampler settings.
>
> CHARACTERS FROM BOORUS
> A + Prompto button on Danbooru, Gelbooru and Safebooru learns a character's usual look and sorts the tags into appearance and outfit.
>
> PROMPT TOOLS
> Tag autocomplete, weights, {a|b} and __snippet__ wildcards, a CLIP token counter and a checker for duplicate and conflicting tags. Every run is versioned, and results come back to their recipe with ratings.
>
> COMFYUI AND FORGE
> Load a recipe, LoRAs included, into the workflow open in ComfyUI, queue it on several models at once, or copy it in Forge's format. The free ComfyUI-Prompto extension adds Prompto nodes and a sidebar to ComfyUI.
>
> YOURS
> Everything stays on your devices. Sync between computers through a folder you choose (OneDrive, Dropbox, Google Drive). No account, no AI, no tracking.

## Privacy practices

**Single purpose:**

> Collect and organize image-generation prompts, recipes and character tags in a side panel, and send them to the user's own ComfyUI or Forge.

**Permission justifications:**

| Permission | Why |
|---|---|
| `sidePanel` | Prompto's whole interface is the side panel. |
| `storage` | Keeps the library (recipes, cast, snippets, settings) in `chrome.storage.local` on the device. |
| `unlimitedStorage` | Recipes keep result thumbnails and reference images, which outgrow the default storage quota. |
| `contextMenus` | The right-click items that save selected text, an image, a booru post or a Civitai image to the inbox. |
| `scripting` | Reads the tags of the booru post the user right-clicked, and edits the workflow in the user's own open ComfyUI tab when they press Load into workflow or Queue. |
| `activeTab` | Reaches the page the user just right-clicked or clicked the toolbar button on, only when they do: for example to read the generation data in the original file of an image they chose to save. |
| Host: `127.0.0.1`, `localhost` | The user's own ComfyUI, to load recipes, read the installed LoRA list and queue images. |
| Host: `*.donmai.us`, `gelbooru.com`, `safebooru.org`, `e621.net`, `e926.net` | Reads post tags, and Danbooru's related tags for a character, when the user imports a post. |
| Host: `civitai.com`, `civitai.green`, `civitai.red` | Reads an image's generation data from Civitai's public images API when the user imports it. |
| Optional host: all sites | Asked for only when the user sets a ComfyUI address in Settings that isn't on this computer, and then only for that address. |

**Remote code:** No. All code ships in the package; nothing is loaded or evaluated from the network.

**Data usage:** Prompto doesn't collect or transmit user data. Tick none of the data categories. Certify that data isn't sold, isn't used for anything unrelated to the single purpose, and isn't used for creditworthiness or lending.

**Privacy policy URL:** link to [PRIVACY.md](PRIVACY.md) on GitHub, e.g. `https://github.com/EY4O/prompto/blob/main/docs/PRIVACY.md`.
