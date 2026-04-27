MX Offroad Master Map Renderer (GitHub Pages)

This repository contains a static web renderer that visualizes the uploaded game map file
`47afacdf238bd338eccf531e71f9500d.data.br`.

The renderer is intentionally minimal and optimized:
- Renders only the actual map surface meshes
- Uses instanced meshes for efficient drawing
- Fullscreen viewport with no debug UI

Controls
- Click inside the viewport to lock the cursor
- Mouse: look around
- W/A/S/D: move
- Q/E: descend/ascend
- Shift: faster movement
- Esc: release cursor

Data note
- `map-data.json` includes extracted mesh geometry and can be large.

Files
- `index.html` - main app shell
- `styles.css` - UI/theme styling
- `app.js` - map rendering, interaction, inspector
- `map-data.json` - generated metadata used by the viewer
- `scripts/extract_map.py` - extractor from Unity map data to JSON

How to regenerate `map-data.json`
1. Install extractor dependency:
	python -m pip install UnityPy
2. Run extractor from repo root:
	python scripts/extract_map.py 47afacdf238bd338eccf531e71f9500d.data.br map-data.json

Run locally
1. Start a static server in repo root:
	python -m http.server 8000
2. Open:
	http://localhost:8000/

Deploy to GitHub Pages (recommended)
1. Push this repository to GitHub.
2. In repository settings, open Pages.
3. Set source to "Deploy from a branch".
4. Select branch `main` and folder `/ (root)`.
5. Save.

After deployment, the site URL will host the full interactive map viewer.

