// The sync folder: a directory you pick (ideally one OneDrive, Dropbox or
// Google Drive keeps in sync), remembered in IndexedDB, holding prompto-sync.json.
export const FILE = "prompto-sync.json";

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("prompto-sync", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const t = req.result.transaction("kv", mode);
      const r = fn(t.objectStore("kv"));
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
    };
  });
}

export const supported = () => typeof window !== "undefined" && "showDirectoryPicker" in window;
export const savedFolder = () => idb("readonly", (s) => s.get("folder")).catch(() => null);
export const forgetFolder = () => idb("readwrite", (s) => s.delete("folder"));

export async function chooseFolder() {
  const handle = await window.showDirectoryPicker({ id: "prompto-sync", mode: "readwrite" });
  await idb("readwrite", (s) => s.put(handle, "folder"));
  return handle;
}

// "granted", "prompt" or "denied". Asking needs a click, so `ask` is only set from a button.
export async function permission(handle, ask = false) {
  const opts = { mode: "readwrite" };
  let state = await handle.queryPermission(opts);
  if (state === "prompt" && ask) state = await handle.requestPermission(opts);
  return state;
}

export async function readSync(handle) {
  try {
    const file = await (await handle.getFileHandle(FILE)).getFile();
    return JSON.parse(await file.text());
  } catch (e) {
    if (e && e.name === "NotFoundError") return null;
    throw e;
  }
}

export async function writeSync(handle, json) {
  const fh = await handle.getFileHandle(FILE, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(json));
  await w.close();
}
