#!/usr/bin/env python3
"""Build Video Drift release archives for Chrome-family browsers and Firefox.

Usage:
    python3 tools/build.py            # builds both targets into dist/
    python3 tools/build.py chrome     # one target only

The version is read from extension/manifest.json and is always part of the
archive name, e.g. dist/video-drift-chrome-1.0.0.zip.
"""
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "extension"
DIST = ROOT / "dist"
NAME = "video-drift"
GECKO_ID = "video-drift@vkardin.github.io"
SKIP = {".DS_Store", "Thumbs.db"}


def load_manifest():
    with open(SRC / "manifest.json", encoding="utf-8") as f:
        return json.load(f)


def firefox_manifest(m):
    m = json.loads(json.dumps(m))
    worker = m["background"].pop("service_worker")
    m["background"] = {"scripts": ["shared/store.js", worker]}
    m["browser_specific_settings"] = {
        "gecko": {
            "id": GECKO_ID,
            "strict_min_version": "115.0",
            "data_collection_permissions": {"required": ["none"]},
        }
    }
    m["host_permissions"] = ["<all_urls>"]
    return m


def files():
    for p in sorted(SRC.rglob("*")):
        if p.is_file() and p.name not in SKIP and p.name != "manifest.json":
            yield p


def pack(target, manifest):
    version = manifest["version"]
    DIST.mkdir(exist_ok=True)
    out = DIST / f"{NAME}-{target}-{version}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        for p in files():
            z.write(p, p.relative_to(SRC).as_posix())
    print(f"built {out.relative_to(ROOT)}")
    return out


def main(argv):
    targets = argv[1:] or ["chrome", "firefox"]
    base = load_manifest()
    if not base.get("version"):
        sys.exit("manifest.json has no version")
    for target in targets:
        if target == "chrome":
            pack("chrome", base)
        elif target == "firefox":
            pack("firefox", firefox_manifest(base))
        else:
            sys.exit(f"unknown target: {target}")


if __name__ == "__main__":
    main(sys.argv)
