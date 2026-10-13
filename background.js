// Capture plumbing. Everything captured here lands in `captures`; the side
// panel drains that queue into its inbox, so the two never overwrite each other.
import { postIdFromUrl, fetchPost, e621IdFromUrl, fetchE621 } from "./lib/booru.js";
import { imageIdFromUrl, postIdFromUrl as civitaiPostId, hostOf, fetchCivitaiImage, fetchCivitaiPost, hasMeta, civitaiToRecipe, withFileRecipe, smallImage } from "./lib/civitai.js";
import { readImageText, recipeFromText } from "./lib/pngmeta.js";

const CIVITAI_PATTERNS = ["https://civitai.com/*", "https://civitai.green/*", "https://civitai.red/*"];

const BOORU_PATTERNS = [
  "https://danbooru.donmai.us/*",
  "https://safebooru.donmai.us/*",
  "https://gelbooru.com/*",
  "https://safebooru.org/*",
  "https://e621.net/*",
  "https://e926.net/*"
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "prompto-selection", title: "Save “%s” to Prompto", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "prompto-image", title: "Save image to Prompto", contexts: ["image"] });
    chrome.contextMenus.create({
      id: "prompto-booru",
      title: "Import post to Prompto",
      contexts: ["page", "image", "link"],
      documentUrlPatterns: BOORU_PATTERNS
    });
    chrome.contextMenus.create({
      id: "prompto-civitai",
      title: "Import Civitai image recipe",
      contexts: ["page", "image", "link"],
      documentUrlPatterns: CIVITAI_PATTERNS
    });
  });
});

async function pushCapture(item) {
  const { captures = [] } = await chrome.storage.local.get("captures");
  captures.push({ id: "cap_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: Date.now(), ...item });
  await chrome.storage.local.set({ captures });
}

// Runs inside the booru page. Danbooru exposes data-tag-name on each tag row;
// Gelbooru-style sites only expose a tag-type-* class, so read the link text.
function scrapeBooruTags() {
  const groups = { artist: [], copyright: [], character: [], general: [], meta: [] };
  const dan = document.querySelectorAll("#tag-list li[data-tag-name]");
  if (dan.length) {
    dan.forEach((li) => {
      const list = li.closest("ul");
      const m = list && list.className.match(/(artist|copyright|character|general|meta)-tag-list/);
      (groups[m ? m[1] : "general"] || groups.general).push(li.dataset.tagName.replace(/_/g, " "));
    });
  } else {
    document.querySelectorAll('li[class*="tag-type-"]').forEach((li) => {
      const m = li.className.match(/tag-type-(\w+)/);
      const links = [...li.querySelectorAll('a[href*="tags="]')].filter((a) => a.textContent.trim() !== "?");
      const name = links.length ? links[links.length - 1].textContent.trim() : "";
      if (!name) return;
      const type = m ? m[1] : "general";
      (groups[type] || groups.general).push(name.replace(/_/g, " "));
    });
  }
  const img = document.querySelector("#image, #image-container img, img#img");
  return { groups, title: document.title, image: img ? img.src : null };
}

// Danbooru posts come from the JSON API: exact categories, no page scraping.
async function captureE621(ref, extra = {}) {
  const post = await fetchE621(ref.host, ref.id);
  await pushCapture({ kind: "booru", post, url: post.url, source: post.site, title: post.characters.join(", ") || "Post " + post.id, ...extra });
  return post;
}

async function captureDanbooru(ref, extra = {}) {
  const post = await fetchPost(ref.host, ref.id);
  await pushCapture({ kind: "booru", post, url: post.url, source: new URL(ref.host).hostname, title: post.characters.join(", ") || "Post " + post.id, ...extra });
  return post;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const source = tab && tab.url ? new URL(tab.url).hostname.replace(/^www\./, "") : "";
  if (info.menuItemId === "prompto-selection") {
    await pushCapture({ kind: "text", text: info.selectionText.trim(), url: tab && tab.url, source });
  } else if (info.menuItemId === "prompto-image") {
    // On a Civitai image, its API knows more than the file: the base model, hashes
    // and version ids, and prompts from workflows too tangled to trace.
    const civ = [info.linkUrl, tab && tab.url].find((u) => u && imageIdFromUrl(u));
    if (civ) {
      try { await captureCivitai(civ); return; } catch {}
    }
    // The original file may still carry its generation data (PNG chunks or EXIF).
    const meta = await recipeFromImageUrl(info.srcUrl);
    if (meta) await pushCapture({ kind: "png", format: meta.format, meta, thumb: info.srcUrl, title: fileName(info.srcUrl), url: tab && tab.url, source });
    else await pushCapture({ kind: "image", image: info.srcUrl, url: tab && tab.url, source });
  } else if (info.menuItemId === "prompto-civitai" && tab) {
    const url = [info.linkUrl, tab.url].find((u) => u && (imageIdFromUrl(u) || civitaiPostId(u)));
    if (!url) {
      await pushCapture({ kind: "text", text: "Couldn't tell which Civitai image that was. Right-click its thumbnail link, or open the image's page first.", url: tab.url, source: "civitai.com" });
      return;
    }
    try { await captureCivitai(url); }
    catch (e) { await pushCapture({ kind: "text", text: `Couldn't read ${url}: ${e.message}`, url: tab.url, source: hostOf(url) }); }
  } else if (info.menuItemId === "prompto-booru" && tab) {
    // A thumbnail link in search results points at its post; otherwise use the page.
    const ref = postIdFromUrl(info.linkUrl || "") || postIdFromUrl(tab.url);
    try {
      if (ref) return void (await captureDanbooru(ref));
      const e6 = e621IdFromUrl(info.linkUrl || "") || e621IdFromUrl(tab.url);
      if (e6) return void (await captureE621(e6));
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrapeBooruTags });
      await pushCapture({ kind: "booru", groups: result.groups, title: result.title, url: tab.url, source, image: info.srcUrl || result.image });
    } catch (e) {
      await pushCapture({ kind: "text", text: "Couldn't read tags from " + (info.linkUrl || tab.url) + ": " + e.message, url: tab.url, source });
    }
  }
});

// Civitai images are read through its API by id, from a link (thumbnails in a
// feed link to /images/{id}), an image page, or a post (every image in it that
// has generation data). The page's own host (.com/.green/.red) is kept.
async function captureCivitai(url) {
  const host = hostOf(url);
  const one = async (item) => {
    const page = `https://${host}/images/${item.id}`;
    let meta = civitaiToRecipe(item, page);
    // The API rarely has the ComfyUI workflow; the original file often does.
    if (!meta.comfy) meta = withFileRecipe(meta, await recipeFromImageUrl(item.url));
    await pushCapture({ kind: "png", format: "Civitai", meta, thumb: smallImage(item.url), title: `Civitai #${item.id}`, url: page, source: host });
  };
  const imageId = imageIdFromUrl(url);
  if (imageId) {
    await one(await fetchCivitaiImage(imageId, host));
    return 1;
  }
  const postId = civitaiPostId(url);
  const items = (await fetchCivitaiPost(postId, host)).filter(hasMeta);
  if (!items.length) throw new Error("none of the images in that post have generation data");
  for (const item of items.slice(0, 20)) await one(item);
  return Math.min(items.length, 20);
}

const fileName = (url) => { try { return decodeURIComponent(new URL(url).pathname.split("/").pop()) || "Image"; } catch { return "Image"; } };

// Reads generation data from the original image file, when the host lets us
// fetch it (most image CDNs allow it). Data: URLs work too.
async function recipeFromImageUrl(url) {
  if (!url || !/^(https?:|data:image\/)/.test(url)) return null;
  try {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 60 * 1024 * 1024) return null;
    const img = await readImageText(buf);
    return img ? recipeFromText(img.text) : null;
  } catch { return null; }
}

// The "+ Prompto" button on Danbooru character tags.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === "prompto:civitai") {
    if (sender.tab) chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
    captureCivitai(msg.url)
      .then((count) => reply({ ok: true, count }))
      .catch((e) => reply({ ok: false, error: e.message }));
    return true;
  }
  if (!msg || msg.type !== "prompto:character") return;
  // Open the panel first, while the click still counts as a user gesture.
  if (sender.tab) chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
  const extra = { focus: msg.tag || null, openSheet: true };
  // Gelbooru-style pages send the tag groups they already show.
  if (msg.groups) {
    const source = new URL(msg.url).hostname.replace(/^www\./, "");
    pushCapture({ kind: "booru", groups: msg.groups, title: msg.title, url: msg.url, source, image: msg.image, ...extra })
      .then(() => reply({ ok: true }))
      .catch((e) => reply({ ok: false, error: e.message }));
    return true;
  }
  const ref = postIdFromUrl(msg.url);
  if (!ref) { reply({ ok: false, error: "Not a Danbooru post" }); return; }
  captureDanbooru(ref, extra)
    .then(() => reply({ ok: true }))
    .catch((e) => reply({ ok: false, error: e.message }));
  return true; // reply asynchronously
});

chrome.omnibox.setDefaultSuggestion({ description: "Save to your Prompto inbox" });
chrome.omnibox.onInputEntered.addListener((text) => {
  if (text.trim()) pushCapture({ kind: "text", text: text.trim(), source: "address bar" });
});
