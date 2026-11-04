# Notes for Claude Code

`SPEC.md` is Caleb's. It holds what the app does. Follow it and do not add features that are not in it. Items it marks **[Claude's call]** were left to the builder and can be revised.

- The ideas are Caleb's; the design and implementation are the builder's (SPEC 12 leaves implementation, content lists, names, numbers and balance to code). When a question is about *what* the app should do and `SPEC.md` does not answer it, ask Caleb before building it. The builder's choices and Caleb's answers are recorded in `docs/decisions.md`.
- Build in the stages listed in `docs/decisions.md`, macro to micro. Each stage ends at a test checkpoint: Caleb tries it before the next stage starts.
- This project is independent of Caleb's other projects. Nothing carries over from the Worldbuilding Sandbox (SPEC 1). The only links are the workflow and the visual style of the Engineering Management Portal, Synth Studio, Stickman Arena and the Worldbuilding Sandbox (cream, navy and red, Norwester headings, staggered stripes). Light mode only.
- Logo rule (same as the others): the full Croswell Industries logo on Home only; the C mark on every other screen, in the gap left of the bottom stripes.
- Chrome on a computer is the target. Local only: maps (and later setups and saved runs) live in this browser's IndexedDB (`src/lib/db.ts`) and in files Caleb exports. No accounts, no server. Hosting is GitHub Pages.
- SPEC 2: if the web version becomes unplayable (performance) or too big (file size), the plan is to move to Godot. Measure, and tell Caleb before that point is reached; do not switch on your own.
- Every stored map and exported map file carries `format` and `version`. Changing what is saved means raising `FORMAT_VERSION` in `src/map/format.ts` and teaching `upgrade()` to bring older maps forward. Never break old maps or old files.
- A map is fixed once a setup is made from it (SPEC 3): the setup keeps its own copy of the terrain, and nothing in a run changes terrain or elevation.
- The renderer (`src/render/`) reads tiles through `TileSource`; Map mode and, later, a running world both provide one.
- `npm run typecheck` and `npm run build` must pass.
