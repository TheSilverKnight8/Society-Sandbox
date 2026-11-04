# Society-Sandbox

*(working title)*

**Society Sandbox** is a medieval society simulation sandbox: build a starting setup on a map, then watch kingdoms grow and run scenarios through it. It is being built in stages from Caleb's spec ([`SPEC.md`](SPEC.md)). The builder's choices are written down in [`docs/decisions.md`](docs/decisions.md).

It is an installable web app (PWA) for Chrome on a computer, hosted on GitHub Pages. Everything runs in the browser. Maps are saved in the browser on your computer and nowhere else.

## What is in it (Stages 1 to 4)

| Area | What it does |
| --- | --- |
| Home | Setups, saved runs and maps, each with a picture. **New map** asks for a name, a size (Small 128, Medium 256, Large 384 or Titanic 512 tiles a side) and whether to start from a generated map or a blank sea. **New setup** asks for a name and a map. |
| Map mode | The map in an angled isometric view. Paint terrain (10 types), raise, lower, flatten or smooth the ground, and place deposits (stone, iron ore, gold ore, clay, fish, berries). **Generate** makes a new map from a seed and settings. Undo and redo. Saves by itself. |
| Main screen | Opens a setup or saved run. The toolbar along the bottom: **Main** (Play/Pause, 1x 2x 3x, Save setup or Save run, Start again from setup) and **Units** (place people, remove people). Click a person in Main to inspect them. |
| Setups and runs | A setup keeps its own copy of the map. Build it, **Save setup**, press Play; **Save run…** keeps a moment of a run as a saved run. |
| People | Get hungry and tired. They gather berries and fish (which run out and grow back), carry and eat food, and sleep where they stand. Starving takes health; at none they die. Inspect shows their needs and what they are doing; **Edit** changes health, food, rest, sex and age. |
| Imperatives | Orders to people: Move, Gather food, Rest, Stop. Choose people (click one, or drag a box) then the order, or the order then the people. |
| Settlements | Pairs found camps; camps grow into villages. Grown settlements spread: young families strike out, and settlements past their size or crowded send people off to found new ones. Mines, quarries, woodcutters and fishing huts stand out at their resource; fields ring the outskirts; villages pave paths to their buildings. Each has land with a border and its name on the map. People cut trees and break stone, carry them, and build huts (2×2 tiles), houses (2×3) and a storehouse (3×3); families get homes and sleep in them. R turns a building while placing it. Click a building to see its settlement. **Units** places buildings (finished) and campfires; **Imperatives** orders a settlement to build, set a focus, send settlers or be abandoned. |
| Jobs and production | Villages give their adults jobs as tradesmen: farmers, woodcutters, quarrymen, miners, fishers; children from 8 help at farms and fishing huts. Workers carry what they make to the store (storehouse or campfire); hungry people eat from it and builders take wood and stone from it. Fields grow from March to November and ripen to wheat. The settlement panel shows the store and jobs. |
| Coins and trade | Each settlement has a treasury and sets its own prices (shown in its panel). Workers are paid for what they bring in; people buy food and pottery and pay rent for their homes. Smithies make tools from iron ore (tools make work faster), potteries make pottery from clay, and a town's mint strikes coins from gold ore. Traders from a market carry goods to whichever settlement nearby pays most. A person's coins and pottery go to their pair and children when they die. |
| Towns and cities | A village with 60 people and 12 homes becomes a town; a town with 200 and 40 becomes a city. Towns build townhouses and put up a wooden fence with gates around their buildings. |
| Cultures | Cultures form among people who have lived without one for a few years, and children are born into them. Each has traits (temper, livelihood, outlook, order) that the player can edit, along with its name and color. A settlement far from the rest of its culture may break away and found a new one, or can be ordered to. **Map: Cultures** colors each settlement's land by its culture. **Rules** turns culture formation off. |
| Nations | A person of high influence claims rule and founds a nation; nations can also be placed (Units, Nation). Rulers (crowned) succeed one another by the nation's succession policy; officials at a hall collect taxes. Policies follow the main culture; unhappy people revolt or break from their culture. Nations stand in peace, trade, alliance or rivalry, and expansionist ones send settlers. **Map: Nations** colors their lands. Unique people get names. |
| Technology | Cultures research a tree of 17 medieval technologies, faster with scholars at a scriptorium or university; some need goods from the store. The market, smithy, mint, townhouse, hall and town fences need their technology first; others speed farming, building, workshops, trade and research, or allow policies. The sim picks what to research by a culture's traits; the culture panel or the Research order steers it. Nations take their main culture's technology and some of their other cultures'. |
| Life cycle | People age (children are drawn smaller, elders grey-haired) and can die of old age. Adults pair up, pairs have children, and children stay near their mother. Inspect shows the pair, parents and children. **Rules** (Main tab) turns pairing, births and aging off together, which freezes the population. |
| Moving around | Wheel zooms toward the pointer. Right or middle drag moves the map; so do WASD and the arrow keys. **+** and **−** zoom; the corner button shows the whole map. |
| Map files | The download button on a map saves it as one file (`<name>.map.json`). **Import map** adds a map from such a file. |

Coming next (Stage 5): military and war.

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
  sim/          the simulation (runs in a Web Worker): world, people, paths; the app's client for it
  world/        setups and saved runs: their shape and format version
  render/       isometric projection, terrain chunk pictures, people, the view (camera, drawing, picking)
  lib/          browser storage (IndexedDB), app state, setups and runs, noise and random numbers
  pages/        Home, Map mode, the main screen
  components/   app frame, dialogs, shared pieces
  graphics/     app icon, Croswell Industries logo
docs/           the builder's decisions
```

Built with React, TypeScript, Vite, Tailwind CSS and vite-plugin-pwa. The map is drawn with the browser's 2D canvas. Headings use Norwester by Jamie Wilson (SIL Open Font License, `src/assets/fonts/`).
