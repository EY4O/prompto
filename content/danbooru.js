// Adds a "+ Prompto" button to each character tag on a Danbooru post page.
// Clicking it imports the post and opens Prompto's import sheet on that character.
(() => {
  if (!/^\/posts\/\d+/.test(location.pathname) || document.querySelector(".prompto-add")) return;

  const style = document.createElement("style");
  style.textContent = `
    .prompto-add {
      margin-left: 6px; padding: 0 7px; height: 18px; border-radius: 999px 0;
      border: 1px solid #b76e79; background: transparent; color: inherit;
      font: 600 10px/16px system-ui, sans-serif; letter-spacing: .3px; text-transform: uppercase;
      cursor: pointer; flex: none; align-self: center; opacity: .75; transition: opacity .2s, background .2s;
    }
    .prompto-add:hover { opacity: 1; background: linear-gradient(115deg, #f7dccf, #f4a7c0 45%, #9b7fd1 75%, #7cc3dd); color: #101117; border-color: transparent; }
    .prompto-add[data-state="busy"] { opacity: .5; cursor: progress; }
    .prompto-add[data-state="done"] { opacity: 1; border-color: #3f9b6e; }
    .prompto-add[data-state="error"] { opacity: 1; border-color: #e0435a; }`;
  document.head.append(style);

  for (const li of document.querySelectorAll("ul.character-tag-list li[data-tag-name]")) {
    const tag = li.dataset.tagName;
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
      chrome.runtime.sendMessage({ type: "prompto:character", tag, url: location.href }, (res) => {
        const ok = res && res.ok;
        btn.dataset.state = ok ? "done" : "error";
        btn.textContent = ok ? "Added ✓" : "Retry";
        btn.title = ok ? "Open Prompto to finish the import" : (res && res.error) || chrome.runtime.lastError?.message || "Couldn't reach Prompto";
      });
    });
    li.append(btn);
  }
})();
