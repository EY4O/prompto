# Privacy policy

Prompto is a Chrome extension that keeps your image-generation prompts, recipes and characters. It has no server and no account, and its author receives nothing from it.

## What stays on your device

Your library (recipes, results, cast, snippets, model profiles and settings) is stored in Chrome's local extension storage on your computer. An imported tag list is kept in the browser's IndexedDB. If you turn on sync, Prompto writes `prompto-sync.json` into a folder you choose; your cloud service (OneDrive, Dropbox, Google Drive…) syncs that file, under that service's own terms.

## What goes over the network

Prompto only makes requests you start, to these places:

- **Danbooru, Gelbooru, Safebooru, e621 and e926**, when you import a post: the post's tags, and Danbooru's related tags for its characters. With tag lookups turned on in Settings, what you type in a tag field is sent to Danbooru's tag search when your imported list has few matches.
- **Civitai's public images API**, when you import a Civitai image or post.
- **The image itself**, when you save an image from a web page, to read the generation data inside the original file.
- **Your ComfyUI address** (by default `127.0.0.1:8188`), to load recipes into your workflow, queue images and read your installed LoRAs.

These sites receive the request like any visit from your browser. Prompto sends them nothing else and never sends your library anywhere.

## What Prompto doesn't do

No analytics, no tracking, no advertising, no AI services, and no selling or sharing of data.

## Contact

Questions go to the [issue tracker](https://github.com/EY4O/prompto/issues).
