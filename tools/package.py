"""Zips the extension for the Chrome Web Store: the files Chrome loads, nothing else.

    python tools/package.py        ->  dist/prompto-<version>.zip

Fails if a module the panel or service worker imports isn't in the zip.
"""

import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = ["manifest.json", "background.js", "sidepanel.html", "sidepanel.css", "sidepanel.js", "LICENSE"]
FOLDERS = ["lib", "content", "icons", "fonts"]


def collect():
    out = [f for f in FILES]
    for folder in FOLDERS:
        for base, _, names in os.walk(os.path.join(ROOT, folder)):
            out += [os.path.relpath(os.path.join(base, n), ROOT).replace(os.sep, "/") for n in sorted(names)]
    return out


def check_imports(files):
    have = set(files)
    missing = []
    for f in files:
        if not f.endswith(".js"):
            continue
        text = open(os.path.join(ROOT, f), encoding="utf-8").read()
        for spec in re.findall(r'''(?:from|import)\s*\(?\s*["'](\.{1,2}/[^"']+)["']''', text):
            target = os.path.normpath(os.path.join(os.path.dirname(f), spec)).replace(os.sep, "/")
            if target not in have:
                missing.append(f"{f} imports {spec}")
    return missing


def main():
    version = json.load(open(os.path.join(ROOT, "manifest.json"), encoding="utf-8"))["version"]
    files = collect()
    missing = check_imports(files)
    if missing:
        sys.exit("Not packaged:\n  " + "\n  ".join(missing))
    os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
    out = os.path.join(ROOT, "dist", f"prompto-{version}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(os.path.join(ROOT, f), f)
    print(f"{out}: {len(files)} files, {os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    main()
