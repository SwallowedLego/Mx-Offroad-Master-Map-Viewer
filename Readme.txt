MX Offroad Master Map Viewer (GitHub Pages)

This repository now contains a static web tool that visualizes the uploaded game map file
`47afacdf238bd338eccf531e71f9500d.data.br`.

The viewer renders in 3D with freecam movement:
- Scene objects (including script-only objects)
- Colliders
- Trigger colliders (normally invisible in-game)
- Lights, cameras, audio sources, particles, and physics objects

3D controls
- Click inside the viewport to lock the cursor
- Mouse: look around (freecam)
- W/A/S/D: move forward/left/back/right
- Q/E: move down/up
- Shift: speed boost
- Esc: release cursor
- F: inspect object under the center reticle

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

