// A floating "+ Prompto" button on Civitai image and post pages. Civitai is a
// single-page app: moving between images doesn't reload the page, so the button
// follows the address instead of being added once.
(() => {
  if (window.__promptoCivitai) return;
  window.__promptoCivitai = true;

  const style = document.createElement("style");
  style.textContent = `
    .prompto-civitai {
      position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
      padding: 0 14px; height: 32px; border-radius: 999px 0; border: 1px solid #b76e79;
      background: rgba(16,17,23,.86); color: #f4ecef; backdrop-filter: blur(6px);
      font: 600 11px/30px system-ui, sans-serif; letter-spacing: .5px; text-transform: uppercase;
      cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.35); transition: background .2s, color .2s, opacity .2s;
    }
    .prompto-civitai:hover { background: linear-gradient(115deg, #f7dccf, #f4a7c0 45%, #9b7fd1 75%, #7cc3dd); color: #101117; border-color: transparent; }
    .prompto-civitai[data-state="busy"] { opacity: .6; cursor: progress; }
    .prompto-civitai[data-state="done"] { border-color: #3f9b6e; }
    .prompto-civitai[data-state="error"] { border-color: #e0435a; }`;
  document.documentElement.append(style);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "prompto-civitai";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (btn.dataset.state === "busy") return;
    const what = page();
    if (!what) return;
    btn.dataset.state = "busy";
    btn.textContent = "Reading…";
    chrome.runtime.sendMessage({ type: "prompto:civitai", url: location.href }, (res) => {
      const ok = res && res.ok;
      btn.dataset.state = ok ? "done" : "error";
      btn.textContent = ok ? (res.count > 1 ? `Added ${res.count} ✓` : "Added ✓") : "Retry";
      btn.title = ok ? "In your Prompto inbox" : (res && res.error) || chrome.runtime.lastError?.message || "Couldn't reach Prompto";
    });
  });

  const page = () => {
    const m = location.pathname.match(/^\/(images|posts)\/(\d+)/);
    return m ? { kind: m[1], id: m[2] } : null;
  };

  let shown = null;
  function sync() {
    const what = page();
    const key = what ? what.kind + what.id : null;
    if (key === shown) return;
    shown = key;
    if (!what) return void btn.remove();
    delete btn.dataset.state;
    btn.textContent = what.kind === "posts" ? "+ Prompto · post" : "+ Prompto recipe";
    btn.title = what.kind === "posts" ? "Add every image in this post that has generation data" : "Add this image's recipe to your Prompto inbox";
    if (!btn.isConnected) document.body.append(btn);
  }
  sync();
  // pushState from the page's own scripts isn't visible here, so watch the address.
  if (window.navigation) navigation.addEventListener("navigatesuccess", () => setTimeout(sync, 50));
  setInterval(sync, 800);
})();
