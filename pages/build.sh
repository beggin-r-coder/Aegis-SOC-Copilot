#!/usr/bin/env bash
# Assemble the static GitHub Pages demo into ./site (run from the repo root).
# Requires the triage-service Python dependencies to be installed.
set -euo pipefail
out="${1:-site}"
rm -rf "$out" && mkdir -p "$out"
cp app/src/main/resources/static/{index.html,app.css,app.js} "$out/"
cp pages/demo.js "$out/"
# Load the demo backend before the app script (both run before DOMContentLoaded).
python3 - "$out/index.html" <<'PY'
import sys, pathlib
page = pathlib.Path(sys.argv[1])
html = page.read_text()
tag = '<script src="app.js" defer></script>'
assert tag in html, "app.js script tag not found"
page.write_text(html.replace(tag, '<script src="demo.js"></script>\n  ' + tag))
PY
python3 pages/build_demo_data.py "$out/demo-data.json"
touch "$out/.nojekyll"
echo "Site ready in $out/"
