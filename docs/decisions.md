# Decisions made by Claude Code

The spec leaves implementation to Claude Code (SPEC 12: "Implementation details beyond the platform ... are not specified", and specific content, names, numbers and balance are code's). Each choice is written down here so Caleb can read it, test it and change it. Anything about *what* the app does that is not here or in `SPEC.md` is asked first.

## Build stages (proposed; to be agreed with Caleb at the Stage 1 checkpoint)

Macro to micro, with a test checkpoint at the end of each stage. Each system's toggles (SPEC 10) and imperatives (SPEC 4) are built in the stage that builds the system, not saved for the end.

1. **Foundation and maps:** Home, Map mode (generate and paint by hand), the isometric view, saving maps in the browser, map files. **(this stage)**
2. **The main screen and people:** setups made from a map; the main screen (the map with the WorldBox-style toolbar and time controls); placing units; individuals with needs (food, shelter, rest, safety), gathering from tiles, and the full life cycle (aging, pairing, births, death); inspecting an individual; saving setups and mid-run states. Ends with a performance check at 2,000+ individuals, which is the test for SPEC 2's Godot rule.
3. **Settlements, buildings and economy:** settlements founded by individuals, construction, buildings that consume, produce and employ, building placement, jobs (tradesman, trader), goods carried by hand, wealth.
4. **Cultures, nations and technology:** culture formation and breaks, research, nations (placed and emerging), policies and culture support, technology, diplomacy, officials, influence, unique individuals, succession.
5. **Military and war:** soldier types, weapons and equipment, armies and their leaders, battles with group orders and individual resolution, war declarations.
6. **Disasters, effects, beasts and criminals;** scenario events (player- and sim-triggered) and the record of events.
7. **Finishing:** a pass over every toggle and imperative against SPEC 10, tuning, and content additions Caleb asks for.

## Questions for Caleb (not answered by the spec)

| Question | What Stage 1 does until answered |
| --- | --- |
| App name | "Society Sandbox", from the spec's working title. |
| "Generated or painted by hand" (SPEC 3): either one, or both on the same map? | Both: a map can start generated or as a blank sea, and either can be painted over or regenerated. |
| The build stages above | Proposed, not agreed. |
| SPEC 4 asks for the main screen to be identical to WorldBox's, toolbar included. I could not find a reliable written description of WorldBox's current layout. | Not needed until Stage 2. A screenshot of the WorldBox screen as Caleb wants it copied would settle it. Map mode's toolbar (tabs above a row of tool buttons, along the bottom) is a stand-in in the same spirit. |

## Builder's additions in Stage 1 (not named in the spec; easy to remove)

- **Undo and redo** in Map mode (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y), up to 60 steps. Painting without it is hard to correct.
- **Delete a map**, with a confirmation.
- **Map files** (export and import). The spec says saving covers setups and runs; files are the only copy that survives Chrome's site data being cleared.
- **Height tools** (raise, lower, flatten, smooth). Elevation is part of how the isometric view shows the land (see Map), so painting needs a way to set it.
- **One tab per map:** a map open in one tab cannot be opened in a second one (Web Locks API), because two copies would save over each other.

## Platform

| Item | Choice | Why |
| --- | --- | --- |
| Stack | React, TypeScript, Vite, Tailwind CSS, vite-plugin-pwa, react-router. Same versions as the Worldbuilding Sandbox. | Same family as the other projects. React is used for the menus and panels only; the map is drawn on a canvas by plain TypeScript. |
| Hosting | GitHub Pages, published by `.github/workflows/deploy.yml` on every push to `main`. | Spec. |
| Map drawing | The browser's 2D canvas, no game engine or WebGL library. | Measured fast enough (below). It keeps the build small: the whole Stage 1 site is about 0.8 MB. |
| Size | GitHub Pages allows a published site of up to 1 GB (GitHub Docs, as checked for the Worldbuilding Sandbox in November 2026; docs.github.com is not reachable from this build environment to re-check). The Stage 1 build is about 0.8 MB, of which 0.36 MB is the app's code. | The simulation is code, not media, so file size is unlikely to be what triggers SPEC 2's Godot rule. Performance at 2,000 individuals is the real test, in Stage 2. |

## Storage

| Item | Choice | Why |
| --- | --- | --- |
| Where maps live | IndexedDB, in this browser on this computer. Two stores: `maps` (the list Home shows, with a small picture) and `mapData` (the whole map). | Home does not have to load whole maps. A 512 map's tiles are 768 KB. |
| Autosave | 0.6 seconds after the last change, and at once when the app is hidden or closed. If the window closes during a save, Chrome asks first. The header shows **Saving** / **Saved**, or **Could not save. Try again**. | Same as the Worldbuilding Sandbox. |
| Keeping the storage | The app asks Chrome for persistent storage once there is a map. Home says in one line whether Chrome agreed and how much space the app uses. | Without it, Chrome may clear a site's storage when the disk runs low. |
| Map file | `<name>.map.json`: JSON with `format`, `version`, the export date, the map's name, size and generator settings, and its three tile layers as Base64 text. A 512 map is about 1 MB; a 256 map about 0.26 MB. | Readable, versioned, one file per map. |
| Reading a file | Checks the format, version and tile data. A file from a newer version is refused with the reason. Unknown tile values are repaired (set to the nearest valid value) rather than refusing the file. An imported map always gets a new ID, so importing the same file twice gives two maps. | |
| Versions | Every stored map and file has a format version (`src/map/format.ts`). When the shape changes, `upgrade()` brings older maps and files forward. | Maps and files made today keep opening. |

## Map (Stage 1)

| Item | Choice |
| --- | --- |
| Sizes | Square: Small 128, Medium 256, Large 384, Titanic 512 tiles a side. Titanic is the default. The spec compares the scale to WorldBox's "Titanic" world, which the WorldBox wiki lists as 512 × 512 tiles. The size is chosen when the map is made and cannot change. |
| Tiles | Each tile has a terrain type, an elevation (0 to 15) and a deposit (or none). |
| Terrain types | Deep water, shallow water, sand, grassland, forest, hills, mountain, snow, desert, swamp. Each has an elevation range (for example, mountains 6 to 14, sand 1 to 4, deep water always 0); painting a type puts the tile inside its range. Water keeps its own level, so rivers and lakes sit in the land instead of cutting down to sea level. |
| Deposits | Stone, iron ore, gold ore, clay, fish (water only) and berries. These are the tile resources of SPEC 3 and 8 ("resources come from map tiles"). Wood comes from forest tiles themselves. Which buildings and jobs use them is decided in Stages 2 and 3. |
| Fixed once used | A setup (Stage 2) keeps its own copy of the map's tiles, so a map can still be edited in Map mode afterwards without changing setups already made from it. Nothing in a run changes terrain or elevation (SPEC 3). |
| Painting | Left drag paints in a round brush, 1 to 16 tiles across (**[** and **]** change it). Each tile changes at most once per stroke, so **Raise** lifts by one level per stroke. Land painted onto the sea rises to level 1. A deposit that does not fit the new terrain (fish on land, ore in water) is removed. |
| Generator | The same seed and settings always give the same map. Settings: shape (one continent, several continents, islands), land share (20–80%), mountains, forests, deserts, rivers (0–40) and resources. The edge of a generated map is always sea. Steps: a height field from noise, a sea level set so the land share matches, mountain ranges along noise ridges (snow on the highest), moisture for deserts, forests and swamps (the sliders set shares of the land: Deserts 25% makes about 7.5% of the land desert), lakes one level below their lowest shore, rivers that follow the downhill direction from high ground to water (wider toward the mouth), beaches beside the sea, then deposits in small patches by terrain (ore in hills and mountains, gold in mountains, clay beside rivers, fish in shallow water, berries in grassland and forest). |
| Speed | Generating a 512 map takes about half a second (measured in headless Chrome); the button shows that it is working. |

## Isometric view (Stage 1)

| Item | Choice | Why |
| --- | --- | --- |
| Look (Caleb's direction: Stickman Arena's look, the scheme's three colors for the environment, navy outlines on everything, a simple environment, objects in their own colors) | **Ground:** each biome is its own shade of the cream, so the ground shows the biome rather than the objects on it (objects will be changed by the simulation). Grassland is the plain cream; forest a light grey-cream; hills a slightly warmer, darker cream; mountains a darker grey-cream; swamp a dull grey-cream; desert a pale peach (cream with a little red); sand and snow near-white. Water is navy (shallow water a lighter navy), and the map's outer edge is a solid navy slab like Stickman Arena's stages. Cliff sides and the shaded side of hills and peaks are blends of navy into the ground color. **Environment marks:** sparse navy line art with round ends: grass tufts (about 1 tile in 8), domed hills, mountain and snowy peaks, dunes, sand dots, reeds, waves. **Objects:** natural colors inside a navy outline: trees (brown trunks, green crowns; pines darker green; about one tree a tile in forests), stone (grey rocks), iron ore (rust flecks), gold ore (a gold glint), clay (an orange-brown pit), fish (silver), berries (a green bush with red berries). People and buildings will follow the same rule (skin tones, colored clothing, navy outline). **Outlines:** navy, thicker than the first draft; steps in the land have outlines too, so terraces read as contour lines. Red in the interface marks the brush. Zoomed far out, one larger drawing stands for a patch of tiles (every 2, 4 or 8 tiles, by zoom). | |
| Drawing | The terrain is drawn in chunks of 16 × 16 tiles, and each chunk is kept as a picture at up to six detail levels; a frame only copies pictures to the screen. Missing pictures are drawn nearest the middle of the screen first, about 10 ms of drawing per frame, while a lower-detail picture stands in. Pictures are dropped least recently used first past about 160 MB. Painting redraws only the chunks it touches. | Keeps frames fast on a 512 map. Measured in headless Chrome (software drawing, no graphics card): copying the whole visible map takes about 4 ms a frame; drawing one chunk takes about 0.15 ms at the lowest detail and 4 ms at the second-highest. A picture on screen is never dropped for memory, so zooming far in never leaves gaps. |
| Camera | Wheel zooms toward the pointer. Right or middle drag pans; so do WASD and the arrow keys (about 900 screen pixels a second). Zoom runs from the whole map to 96 pixels per tile. | Left button is kept for tools, as in WorldBox. |
| Picking | The tile under the pointer is the frontmost tile whose column reaches the pointer, so pointing at a cliff face picks the tile on top of it. | |
| Known limit | Things drawn on top of the terrain later (units, buildings) will be drawn after the terrain, so something standing just behind a tall cliff can show in front of it. Elevation steps are small, so this should be rare; it will be revisited in Stage 2 if it shows. | |

## Look

- The portal's, Synth Studio's, Stickman Arena's and the Worldbuilding Sandbox's style: cream, navy and red; Norwester headings; Archivo body text; staggered stripes; flat cards. Light mode only.
- The map follows Stickman Arena's look (Caleb's direction): the three colors for the environment, natural colors for objects, navy outlines on everything. See "Isometric view".
- Map mode's tool buttons show a single tile drawn the same way, so each button looks like what it paints.
- Logo: the full Croswell Industries logo on Home; the C mark in the gap left of the bottom stripes in Map mode.
- App icon: a cream castle keep flying a red pennant, on navy.
