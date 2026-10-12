// Capture plumbing. Everything captured here lands in `captures`; the side
// panel drains that queue into its inbox, so the two never overwrite each other.

const BOORU_PATTERNS = [
  "https://danbooru.donmai.us/posts/*",
  "https://safebooru.donmai.us/posts/*",
  "https://gelbooru.com/*",
  "https://safebooru.org/*"
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "prompto-selection", title: "Save “%s” to Prompto", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "prompto-image", title: "Save image to Prompto", contexts: ["image"] });
    chrome.contextMenus.create({
      id: "prompto-booru",
      title: "Import post tags to Prompto",
      contexts: ["page", "image"],
      documentUrlPatterns: BOORU_PATTERNS
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
  return { groups, title: document.title };
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const source = tab && tab.url ? new URL(tab.url).hostname.replace(/^www\./, "") : "";
  if (info.menuItemId === "prompto-selection") {
    await pushCapture({ kind: "text", text: info.selectionText.trim(), url: tab && tab.url, source });
  } else if (info.menuItemId === "prompto-image") {
    await pushCapture({ kind: "image", image: info.srcUrl, url: tab && tab.url, source });
  } else if (info.menuItemId === "prompto-booru" && tab) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrapeBooruTags });
      await pushCapture({ kind: "booru", groups: result.groups, title: result.title, url: tab.url, source, image: info.srcUrl });
    } catch (e) {
      await pushCapture({ kind: "text", text: "Couldn't read tags from this page.", url: tab.url, source });
    }
  }
});

chrome.omnibox.setDefaultSuggestion({ description: "Save to your Prompto inbox" });
chrome.omnibox.onInputEntered.addListener((text) => {
  if (text.trim()) pushCapture({ kind: "text", text: text.trim(), source: "address bar" });
});
