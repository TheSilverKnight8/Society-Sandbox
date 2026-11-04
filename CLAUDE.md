# Notes for Claude Code

`SPEC.md` is Caleb's. It holds what the app does. Follow it and do not add features that are not in it. Items it marks **[Claude's call]** were left to the builder and can be revised.

- The ideas are Caleb's; the design and implementation are the builder's (SPEC 12 leaves implementation, content lists, names, numbers and balance to code). When a question is about *what* the app should do and `SPEC.md` does not answer it, ask Caleb before building it. The builder's choices and Caleb's answers are recorded in `docs/decisions.md`.
- Build in the stages listed in `docs/decisions.md`, macro to micro. Each stage ends at a test checkpoint: Caleb tries it before the next stage starts.
- This project is independent of Caleb's other projects. Nothing carries over from the Worldbuilding Sandbox (SPEC 1). The only links are the workflow and the visual style of the Engineering Management Portal, Synth Studio, Stickman Arena and the Worldbuilding Sandbox (cream, navy and red, Norwester headings, staggered stripes). Light mode only.
- Logo rule (same as the others): the full Croswell Industries logo on Home only; the C mark on every other screen, in the gap left of the bottom stripes.
- Chrome on a computer is the target. Local only: maps, setups and saved runs live in this browser's IndexedDB (`src/lib/db.ts`) and in files Caleb exports. No accounts, no server. Hosting is GitHub Pages.
- SPEC 2: if the web version becomes unplayable (performance) or too big (file size), the plan is to move to Godot. Measure, and tell Caleb before that point is reached; do not switch on your own.
- Every stored map and exported map file carries `format` and `version`. Changing what is saved means raising `FORMAT_VERSION` in `src/map/format.ts` and teaching `upgrade()` to bring older maps forward. Never break old maps or old files.
- A map is fixed once a setup is made from it (SPEC 3): the setup keeps its own copy of the terrain, and nothing in a run changes terrain or elevation.
- Setups and saved runs carry a format version too: changing what is saved means raising `WORLD_FORMAT_VERSION` in `src/world/format.ts` and teaching `upgradeWorld()` to bring older ones forward.
- The simulation runs in a Web Worker (`src/sim/worker.ts`, `src/sim/world.ts`) and owns the running world. The app talks to it only through `SimClient` (`src/sim/client.ts`) with the messages in `src/sim/types.ts`. Every individual is simulated in full each step, on screen or not (SPEC 2).
- Settlements, building work and town fences are in `src/sim/towns.ts`; jobs, workplaces, the store, coins, prices, traders and what settlements build are in `src/sim/economy.ts`; building kinds, sizes, goods, prices and jobs are defined in `src/sim/buildings.ts`; cultures (forming, belonging, breaking away, traits, colors) are in `src/sim/cultures.ts`.
- Measure simulation step time and frame rate at 2,000+ people at the end of each step of a stage, and record it in `docs/decisions.md`.
- The renderer (`src/render/`) reads tiles through `TileSource`; Map mode and the main screen both provide one.
- Look (Caleb's direction): each biome has its natural color and objects (trees, deposits, people, buildings) have natural colors, all drawn in the same flat style with a navy outline on everything (`src/render/style.ts`). Cream, navy and red are the interface's colors.
- `npm run typecheck` and `npm run build` must pass.
