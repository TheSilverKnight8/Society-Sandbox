# Society-Sandbox

*(working title)*

**Society Sandbox** is a medieval society simulation sandbox: build a starting setup on a map, then watch kingdoms grow and run scenarios through it. It is being built in stages from Caleb's spec ([`SPEC.md`](SPEC.md)). The builder's choices are written down in [`docs/decisions.md`](docs/decisions.md).

It is an installable web app (PWA) for Chrome on a computer, hosted on GitHub Pages. Everything runs in the browser. Maps are saved in the browser on your computer and nowhere else.

## What is in it (Stage 1)

| Area | What it does |
| --- | --- |
| Home | Lists your maps with a picture of each. **New map** asks for a name, a size (Small 128, Medium 256, Large 384 or Titanic 512 tiles a side) and whether to start from a generated map or a blank sea. |
| Map mode | The map in an angled isometric view. Paint terrain (10 types), raise, lower, flatten or smooth the ground, and place deposits (stone, iron ore, gold ore, clay, fish, berries). **Generate** makes a new map from a seed and settings (shape, land, mountains, forests, deserts, rivers, resources). Undo and redo. |
| Moving around | Wheel zooms toward the pointer. Right or middle drag moves the map; so do WASD and the arrow keys. **+** and **−** zoom; the corner button shows the whole map. |
| Saving | Changes save by themselves a moment after the last edit, in the browser's storage (IndexedDB). The header shows Saving / Saved. |
| Map files | The download button on a map saves it as one file (`<name>.map.json`). **Import map** adds a map from such a file. Files carry a format version, so files exported today still open after the app changes. |

Coming next (Stage 2, to be confirmed): the main screen, setups built on a map, and the first individuals.

## Run it on your computer

Needs Node.js 20.19 or newer.

```bash
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173) in Chrome.

## Put it online (GitHub Pages)

1. The repository must be **public** (Pages is free for public repositories). Only the code is public; your maps stay in your browser.
2. **Settings > Pages > Build and deployment > Source**: choose **GitHub Actions**.
3. Push to `main`. [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds and publishes the app to `https://<your-username>.github.io/<repo-name>/`.

To install it: open the site in Chrome and use the install button in the address bar.

## Where your maps are

In Chrome's storage for the site's address, on this computer only. The published site and `localhost` have separate storage, and so do different browsers or Chrome profiles. To move a map from one to another, export it and import it there. Clearing Chrome's site data for the address deletes the maps stored there; an exported file is a full copy.

## Project layout

```
src/
  map/          map shape, terrain and deposit types, generator, painting tools, files and versions
  render/       isometric projection, terrain chunk pictures, the view (camera, drawing, picking)
  lib/          browser storage (IndexedDB), app state and autosave, noise and random numbers
  pages/        Home (the map list), Map mode
  components/   app frame, dialogs, shared pieces
  graphics/     app icon, Croswell Industries logo
docs/           the builder's decisions
```

Built with React, TypeScript, Vite, Tailwind CSS and vite-plugin-pwa. The map is drawn with the browser's 2D canvas. Headings use Norwester by Jamie Wilson (SIL Open Font License, `src/assets/fonts/`).
