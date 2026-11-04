# Society Simulation Sandbox — Design Doc (working title)

Status: draft for sign-off, then handoff to code. Items marked **[Claude's call]** were left to Claude at the user's request and can be revised.

## 1. Concept
- Sandbox geared toward society simulation, in a similar vein to WorldBox
- Separate from the Worldbuilding Sandbox; nothing carries over
- Built with the same workflow as the other four projects (Shop Management Portal, Node Based Synthesizer, Stickman Arena, Worldbuilding Sandbox)
- Pure sandbox: no goals or win/lose conditions
- What the user wants from it: watching it unfold, emergent civilizations, and building civilizations then simulating scenarios
- Main fantasy inspiration: large army battles, kingdom exploration and expansion; "exploration" means watching a kingdom grow and develop (no map reveal)
- Systems covered: economy, military and war, culture and rules, environment, survival and settlement
- Everything in the world can be manually modified by the player
- Most automatic sim responses can be disabled by the player (see section 10)

## 2. Platform and presentation
- Web app hosted on GitHub Pages
- Switch to Godot if the web version gets too big, meaning performance is unplayable or the file size is too big
- Angled isometric view; clean flat shapes art style
- Scale: population upwards of ~2,000 (WorldBox "Titanic" size), thousands of buildings, large map
- Every individual is simulated in full at all times, including off-screen
- Time runs in real time with adjustable speed; fast-forward is a modest speed-up
- Theme: Middle Ages throughout, sort of like WorldBox; classic medieval aesthetic, more historical than fantastical, no magic (an occasional dragon is fine)

## 3. World and map
- The map is large, with room for kingdoms to expand
- Maps are created in a separate mode within this app (generated or painted by hand)
- A loaded map cannot be edited; no terrain shaping past startup
- Natural disasters still happen but cannot reshape the land
- Resources come from both map tiles and buildings

## 4. Player role and interface
- The player both seeds a starting setup and intervenes while it runs
- Intervention is realistic, not WorldBox-style wacky powers: placing units and buildings, changing culture and nation rules, initiating actions for people and settlements
- Main screen is the map, identical to WorldBox's, including its toolbar. Instead of god powers the toolbar holds:
  - Unit placements (building placement is under this too; placed buildings appear finished)
  - Disasters and effects (effects are things like status effects and weather)
  - Imperatives (orders to units, settlements, nations, or cultures)
- Imperatives can be given either way: select a target then pick an order, or pick an order then click a target
- Only unit imperatives (not nation or culture ones) can use an area selection to affect a group of units
- Battles use WorldBox-style group orders with individual resolution
- Inspecting an individual shows their stats (health, age, job, culture), their pair, and their current state (needs that need fulfilling, or the task they're doing)

## 5. Time, saving, and scenarios
- Core loop: build a starting setup, save it, then run different scenarios through it (wars, natural disasters, etc.)
- Scenario events can be triggered by the player or by the sim
- Saving covers the starting setup and mid-run states
- Scenario runs from one setup are standalone (not stored for comparison)
- The sim leaves behind a record of events

## 6. Individuals
- Individuals and groups influence each other in both directions
- Mixed population: some individuals are unique (own identity), most are not
  - Unique: rulers, military leaders, player-chosen individuals, and ones that emerge in the sim
  - An emergent individual becomes unique when they are a central figure in a major event or reach a high enough influence
- Needs: food, shelter, rest, safety, and their job
- Jobs: generic tradesman (works at various buildings), soldier (types such as cavalry, artillery, infantry), trader (travels and sells goods), official (government worker)
- An individual can have no job (criminals, generic citizens, or in a settlement at a stage that doesn't require formal jobs)
- Criminals don't live in settlements and only enter to steal or kill
- Full life cycle: individuals are born, age, and die naturally
- Births: specific individuals pair up and have children; children have needs and can hold light jobs
- Pairs, especially high-ranking ones (rank = wealth and influence), influence job choice, households, succession, etc.
- Each individual belongs to exactly one culture once a culture exists (individuals can start with none)
- **[Claude's call]** Wealth and influence: individuals own wealth earned from jobs and trade, passed to their pair and children on death; influence comes from office held, wealth, and family/pair ties

## 7. Society: settlements, cultures, nations
- Settlements are started automatically by individuals
- Culture and political layers work similarly but are fundamentally separate
- **Cultures**
  - Cultures only emerge (the player does not create them), but the player can edit them afterwards
  - Units create their own cultures organically; this is how a setup gets its first cultures
  - A culture forms after a period of having no culture (minimum 1 unit), or through a deliberate break from an old culture; the units, the sim, or the player can decide a break
  - Research is done by the culture, expedited and enhanced by specific buildings
- **Nations** are the political layer
  - Some are placed in setup; others can emerge from settlements
  - A nation can hold several cultures
  - Policies live on the nation, work like WorldBox culture traits (succession, conscription, etc.), and are chosen by the sim as influenced by the dominant culture; the player can edit them
  - Policy changes happen during major events (which don't always correlate with a change) and are rare, depending on how strongly the culture supports the policy
  - **[Claude's call]** Culture support: each culture holds a support value per policy; it is higher when the policy matches the culture's own traits and rises the longer the policy has been in force; the higher it is, the less likely a major event changes that policy
- **Technology**
  - Tracked on cultures; affects what buildings, items, policies, etc. a nation has access to
  - Advances through research and resources
  - A nation's tech comes fully from its dominant culture; non-dominant cultures in the nation contribute some but not all of theirs, decided by random chance and resource availability
  - Covers the Middle Ages with a bit dipping into classical; whatever makes sense to add
- **Diplomacy**: basic relations (e.g. peace, alliance, trade)
- **Major events**: war, disaster, change of ruler, nation formation, and destruction of a nation or culture

## 8. Economy and buildings
- Buildings are functional: they consume and produce resources and employ workers
- Units construct buildings themselves
- Goods are carried physically by individuals
- Resources come from map tiles and buildings (gathered by units as part of their jobs)

## 9. Military and combat
- A nation raises armies; unique military leaders command them
- Army battles involve both individual units and groups
- Combat is resolved by stats and equipment
- Weapons: a suite similar to WorldBox (swords, spears, axes, bows, etc.)

## 10. Automatic behaviors and toggles
Necessary, non-toggleable **[Claude's call]**:
- Individuals meeting needs and carrying out jobs and tasks (including gathering resources, hauling goods, and constructing buildings); death from unmet needs or injury is part of this rule
- Combat resolution by stats and equipment, whenever any fight happens
- Succession when a leader dies or leaves

Everything else can be toggled off by the player (war declarations were the user's example, so nations just grow and never fight):
- Settlement founding by units
- Culture formation
- Nations emerging from settlements
- Nations raising armies; units declaring war
- Diplomatic relation changes
- Nation policy changes during major events
- Culture research and nation tech derivation
- Sim-triggered events (wars and natural disasters; disasters hit individuals, buildings, resources)
- Pairing, births, and aging (turning these off freezes the population)
- Criminals entering settlements
- Emergence of unique individuals
- Writing the record of events

Turning off cultures leaves units without a culture, so there is no culture tech or policy.

## 11. Content
- Only general categories are laid out here; code decides the specifics, and the user will request changes or additions during development
- Categories: buildings; resources and items (raw materials, goods, equipment); technologies; culture traits; nation policies; jobs and unit types; mobs/beasts alongside humans (an occasional dragon is fine); disasters; effects (status effects, weather); imperatives (orders); major events

## 12. Not specified (for code)
- Implementation details beyond the platform (data storage, architecture, how saves are stored) are not specified
- Specific content lists, names, numbers, and balance
