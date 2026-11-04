# Decisions made by Claude Code

The spec leaves implementation to Claude Code (SPEC 12: "Implementation details beyond the platform ... are not specified", and specific content, names, numbers and balance are code's). Each choice is written down here so Caleb can read it, test it and change it. Anything about *what* the app does that is not here or in `SPEC.md` is asked first.

## Build stages (proposed after Stage 1; Caleb said to move on with them)

Macro to micro, with a test checkpoint at the end of each stage. Each system's toggles (SPEC 10) and imperatives (SPEC 4) are built in the stage that builds the system, not saved for the end.

1. **Foundation and maps:** Home, Map mode (generate and paint by hand), the isometric view, saving maps in the browser, map files. **(done)**
2. **The main screen and people**, in three steps, each tested on its own:
   - 2a. Setups and saved runs; the main screen (the map with the WorldBox-style toolbar and time controls); placing and removing people; inspecting a person; the simulation running in its own thread; a performance check at 2,000+ individuals, which is the test for SPEC 2's Godot rule. **(this step)**
   - 2b. Needs (food, shelter, rest, safety, job) and survival: gathering from tiles, death from unmet needs or injury, the inspect panel showing needs and the current task, editing a person by hand.
   - 2c. The life cycle: aging, pairing, births and children, natural death, with their toggles (SPEC 10).
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
| SPEC 4 asks for the main screen to be identical to WorldBox's, toolbar included. | What could be confirmed in writing (WorldBox wiki, Main tab page): powers are grouped in a row of tabs; the Main tab shows when no other tab is chosen and holds Pause and the speed control (1x, 2x, 3x, 5x). Where things sit on screen could not be confirmed. Stage 2a puts the toolbar along the bottom of the map with a Main tab holding the time controls, then Units, Disasters & effects and Imperatives. A screenshot of the WorldBox screen as Caleb wants it copied would settle the rest. |

## Builder's additions in Stage 1 (not named in the spec; easy to remove)

- **Undo and redo** in Map mode (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y), up to 60 steps. Painting without it is hard to correct.
- **Delete a map**, with a confirmation.
- **Map files** (export and import). The spec says saving covers setups and runs; files are the only copy that survives Chrome's site data being cleared.
- **Height tools** (raise, lower, flatten, smooth). Elevation is part of how the isometric view shows the land (see Map), so painting needs a way to set it.
- **One tab per map:** a map open in one tab cannot be opened in a second one (Web Locks API), because two copies would save over each other.

## Builder's additions in Stage 2a (not named in the spec; easy to remove)

- **Remove** tool in Units (a brush), and a **Remove** button on the inspect panel. SPEC 1 says everything can be modified by hand; editing a person's details comes in 2b.
- **Start again from setup**: reloads the setup's saved starting point (asks first if there are unsaved changes).
- **Leaving with unsaved changes asks first**, and the header shows Saved or Not saved.
- **One tab per world**, as for maps.

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

## Setups and saved runs (Stage 2a)

| Item | Choice |
| --- | --- |
| Setup | Made from a map on Home (New setup: a name and a map). It keeps its own copy of the map's tiles, so the map can still be edited in Map mode without changing setups already made from it (SPEC 3). |
| Building a setup | Opening a setup shows its starting point, paused. Place people in Units, then **Save setup**. Saving is by hand, not automatic, because a setup is a deliberate starting point (SPEC 5: "build a starting setup, save it"). |
| Running | **Play** starts time. From then on the button is **Save run…**: it asks for a name and keeps that moment as a saved run; the setup stays as it was. Saving again updates the same saved run. **Start again from setup** goes back to the setup's starting point. |
| Saved runs | Listed on Home under Saved runs, each standing on its own (SPEC 5: runs are not stored for comparison). Opening one carries on from where it was saved. |
| What is saved | The world's tiles (deposits included, since runs will use them up), the simulation's state (time, people, the random number generator's state), and a format version, so setups and runs saved today keep opening (`src/world/format.ts`). Paths people were walking are not saved; anyone walking starts again from standing. |
| Storage | IndexedDB, stores `worlds` (Home's list) and `worldData` (the whole setup or run). A Titanic setup is a little under 1 MB plus its people. |

## Time (Stage 2a)

| Item | Choice | Why |
| --- | --- | --- |
| Steps | 10 simulation steps a second at 1x. | Smooth enough for walking and, later, fighting; cheap enough for thousands of people. |
| Speeds | Paused, 1x, 2x, 3x (SPEC 2: fast-forward is a modest speed-up). Space pauses and plays; 1, 2 and 3 set the speed. | WorldBox's speed control goes to 5x; the spec asks for modest. |
| Calendar | A month is 5 seconds at 1x and a year is 12 months, so a year passes in a minute at 1x (20 seconds at 3x). The date shows the month and year. | A lifetime of about 60 years then takes about an hour at 1x, so generations and kingdoms change within an evening. The numbers are easy to change once the life cycle (2c) shows how it feels. |

## Simulation (Stage 2a)

| Item | Choice | Why |
| --- | --- | --- |
| Where it runs | In a Web Worker (its own thread). The worker owns the world; the app sends it commands (place, remove, speed, save) and gets a snapshot of everyone's position after each batch of steps. The app draws people moving smoothly between the last two snapshots. | Drawing stays smooth however busy the world is, and every individual is simulated in full each step, on screen or not (SPEC 2). |
| Falling behind | If a step ever takes longer than the time it has, the world slows down rather than trying to catch up all at once. | |
| Paths | A* search over the tiles in 8 directions. Walking costs: grassland 1, sand 1.2, desert 1.3, forest 1.5, hills 1.6, swamp 2.5, shallow water and mountains 3, snow 4; deep water cannot be crossed; climbing a level costs 0.4 more. Searches share a budget of tiles looked at per step, so a crowd asking for paths at once waits a step or two instead of slowing the world. | |
| Walking speed | 1.5 tiles a second on open ground at 1x, slower on costly ground. | |
| What people do in 2a | Stand, then walk to a nearby spot, then stand again. This is a stand-in so movement and speed can be tested; needs and tasks replace it in 2b. | |
| People placed by hand | Adults aged 16 to 36, either sex at random, with a random skin tone, hair color and clothing color. Not unique and not named (SPEC 6: most individuals are not unique). | |

## Main screen (Stage 2a)

| Item | Choice |
| --- | --- |
| Layout | The map fills the screen. Top left: the setup or run's name, the date, the number of people and whether time is running. Top right: zoom buttons. Along the bottom: the toolbar (see the WorldBox question above). Right side: the inspect panel when a person is chosen. |
| Toolbar tabs | **Main** (shown first): Play/Pause, 1x 2x 3x, Save setup or Save run, Start again from setup. **Units**: Person (click or drag on land to place adults, one per tile) and Remove (a brush, 1 to 8). **Disasters & effects** and **Imperatives** are shown but cannot be chosen yet; they come in the stages that build what they act on. |
| Inspecting | In the Main tab, clicking a person chooses them (a red ring at their feet) and opens the panel: number, sex, age, health, job, culture, pair and what they are doing (SPEC 4). Job, culture and pair read None until those systems exist. Esc closes it. |

## People (Stage 2a)

| Item | Choice |
| --- | --- |
| Look | Stick figures in Stickman Arena's style, as Caleb asked: a round head in one of 8 skin tones with hair in one of 6 colors, a tunic (men) or a long dress (women) in one of 10 dyed or undyed cloth colors (madder red, woad blue, green, undyed tan, purple, saffron, brown, grey, dark teal, rust), skin-colored arms and brown legs, all inside a navy outline. Walking people swing their arms and legs. |
| Size | About 0.42 of a tile tall, a little taller than a tree, so they read on the busy ground. Zoomed far out, a person is a dot in their clothing color with a navy outline. |
| Drawing | Each look, pose and size is drawn once into a small picture and reused. The terrain is kept as one picture of the screen while the camera is still, so frames where only people move just copy it. |
| Known limit | People are drawn after the terrain, so someone just behind a tall cliff can show in front of it. |

## Performance (Stage 2a)

Measured on a 512 × 512 map at 3x speed, in headless Chrome without a graphics card (a slow case; a normal Chrome with a graphics card should do at least as well):

| People | Simulation step | Frames a second (whole map / mid zoom / close) |
| --- | --- | --- |
| 2,000 | about 0.8 ms | 60 / 60 / 60 |
| 5,000 | about 2 ms | 53 / 55 / 60 |

A step has 33 ms at 3x, so there is plenty of room for now. People only walk in 2a; needs, jobs and buildings will cost more per step, so this is measured again at the end of each step of Stage 2. Nothing so far points toward the Godot rule (SPEC 2).

## Look

- The portal's, Synth Studio's, Stickman Arena's and the Worldbuilding Sandbox's style: cream, navy and red; Norwester headings; Archivo body text; staggered stripes; flat cards. Light mode only.
- The map follows Stickman Arena's look (Caleb's direction): the three colors for the environment, natural colors for objects, navy outlines on everything. See "Isometric view".
- Map mode's tool buttons show a single tile drawn the same way, so each button looks like what it paints.
- Logo: the full Croswell Industries logo on Home; the C mark in the gap left of the bottom stripes in Map mode and on the main screen.
- App icon: a cream castle keep flying a red pennant, on navy.
