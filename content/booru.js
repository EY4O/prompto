// Adds a "+ Prompto" button to each character tag on booru post pages.
// Danbooru posts are read through its API; Gelbooru-style pages (Gelbooru,
// Safebooru) send the tag groups they already show.
(() => {
  const host = location.hostname.replace(/^www\./, "");
  const danbooru = /(^|\.)donmai\.us$/.test(host);
  const isPost = danbooru ? /^\/posts\/\d+/.test(location.pathname)
    : new URLSearchParams(location.search).get("page") === "post" && new URLSearchParams(location.search).get("s") === "view";
  if (!isPost || document.querySelector(".prompto-add")) return;

  const style = document.createElement("style");
  style.textContent = `
    .prompto-add {
      margin-left: 6px; padding: 0 7px; height: 18px; border-radius: 999px 0;
      border: 1px solid #b76e79; background: transparent; color: inherit;
      font: 600 10px/16px system-ui, sans-serif; letter-spacing: .3px; text-transform: uppercase;
      cursor: pointer; flex: none; align-self: center; opacity: .75; transition: opacity .2s, background .2s; vertical-align: middle;
    }
    .prompto-add:hover { opacity: 1; background: linear-gradient(115deg, #f7dccf, #f4a7c0 45%, #9b7fd1 75%, #7cc3dd); color: #101117; border-color: transparent; }
    .prompto-add[data-state="busy"] { opacity: .5; cursor: progress; }
    .prompto-add[data-state="done"] { opacity: 1; border-color: #3f9b6e; }
    .prompto-add[data-state="error"] { opacity: 1; border-color: #e0435a; }`;
  document.head.append(style);

  // Gelbooru-style tag rows: class tag-type-*, name in the tags= link.
  function gelbooruGroups() {
    const groups = { artist: [], copyright: [], character: [], general: [], meta: [] };
    for (const li of document.querySelectorAll('li[class*="tag-type-"]')) {
      const type = (li.className.match(/tag-type-(\w+)/) || [])[1] || "general";
      const name = tagFromRow(li);
      if (!name) continue;
      (groups[type] || (type === "metadata" ? groups.meta : groups.general)).push(name.replace(/_/g, " "));
    }
    return groups;
  }
  function tagFromRow(li) {
    const a = [...li.querySelectorAll('a[href*="tags="]')].pop();
    if (!a) return "";
    try { return new URL(a.getAttribute("href"), location.href).searchParams.get("tags") || a.textContent.trim(); }
    catch { return a.textContent.trim(); }
  }

  const rows = danbooru
    ? [...document.querySelectorAll("ul.character-tag-list li[data-tag-name]")].map((li) => [li, li.dataset.tagName])
    : [...document.querySelectorAll('li[class*="tag-type-character"]')].map((li) => [li, tagFromRow(li)]);

  for (const [li, tag] of rows) {
    if (!tag) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "prompto-add";
    btn.textContent = "+ Prompto";
    btn.title = `Add ${tag.replace(/_/g, " ")} to your Prompto cast`;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.state === "busy") return;
      btn.dataset.state = "busy";
      btn.textContent = "Adding…";
      const msg = { type: "prompto:character", tag, url: location.href };
      if (!danbooru) {
        const img = document.querySelector("#image, #image-container img, img#img");
        Object.assign(msg, { groups: gelbooruGroups(), title: document.title, image: img ? img.src : null });
      }
      chrome.runtime.sendMessage(msg, (res) => {
        const ok = res && res.ok;
        btn.dataset.state = ok ? "done" : "error";
        btn.textContent = ok ? "Added ✓" : "Retry";
        btn.title = ok ? "Open Prompto to finish the import" : (res && res.error) || chrome.runtime.lastError?.message || "Couldn't reach Prompto";
      });
    });
    li.append(btn);
  }
})();
