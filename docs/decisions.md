# Decisions made by Claude Code

The spec leaves implementation to Claude Code (SPEC 12: "Implementation details beyond the platform ... are not specified", and specific content, names, numbers and balance are code's). Each choice is written down here so Caleb can read it, test it and change it. Anything about *what* the app does that is not here or in `SPEC.md` is asked first.

## Build stages (proposed after Stage 1; Caleb said to move on with them)

Macro to micro, with a test checkpoint at the end of each stage. Each system's toggles (SPEC 10) and imperatives (SPEC 4) are built in the stage that builds the system, not saved for the end.

1. **Foundation and maps:** Home, Map mode (generate and paint by hand), the isometric view, saving maps in the browser, map files. **(done)**
2. **The main screen and people**, in three steps, each tested on its own:
   - 2a. Setups and saved runs; the main screen (the map with the WorldBox-style toolbar and time controls); placing and removing people; inspecting a person; the simulation running in its own thread; a performance check at 2,000+ individuals, which is the test for SPEC 2's Godot rule. **(done)**
   - 2b. Needs (food, shelter, rest, safety, job) and survival: gathering from tiles, death from unmet needs or injury, the inspect panel showing needs and the current task, editing a person by hand, and the first imperatives (orders to units). **(done)**
   - 2c. The life cycle: aging, pairing, births and children, natural death, with their toggles (SPEC 10). **(done)**
3. **Settlements, buildings and economy**, in three steps:
   - 3a. Settlements founded by people and growing through stages; land with borders; trees and stone as materials; building huts, houses and a storehouse; homes meeting the shelter need; placing buildings; the settlement panel and settlement imperatives; the settlement founding rule. **(done; buildings made bigger afterwards at Caleb's request)**
   - 3b. Jobs and production: farms, woodcutters, quarries, mines, fishing and the like; hauling to the storehouse; children's light jobs; the job need. **(done)**
   - 3c. Goods, coins and trade: workshops, traders between settlements, wages, wealth and inheritance; the town and city stages; fences and gates for towns and above. **(done)**
4. **Cultures, nations and technology**, in three steps:
   - 4a. Cultures: formation, membership, traits, breaks from a culture far from home, editing cultures, the culture map view, the culture formation rule. **(done; settlements spreading added after it)**
   - 4b. Nations: influence, leaders claiming rule, placed nations, settlements joining, rulers and succession, unique individuals, officials and taxes, policies and culture support, unrest, revolts and breaks over policies, nations sending settlers, diplomacy, the nation map view, their rules. (Caleb kept this as one step.) **(done)**
   - 4c. Technology and research: research by cultures at a research building with its own workers, the technologies and what they open up, nations' technology from their cultures, the research rule. **(done)**
5. **Military and war:** soldier types, weapons and equipment, armies and their leaders, battles with group orders and individual resolution, war declarations, sieges, conquest, plunder and tribute, peace. (Caleb kept it as one step.) **(done)**
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

## Questions settled by the builder in Stage 2b (Caleb can change them)

| Question | What 2b does |
| --- | --- |
| How is shelter met before houses exist (Stage 3)? | It is not: the inspect panel shows shelter as unmet ("None yet"), and an unmet shelter does no harm until houses can meet it. |
| What threatens safety before beasts, criminals and war exist? | Nothing yet: safety shows as met. |
| When do imperatives arrive? | With the systems they order (the rule above). 2b gives people tasks, so it brings the first unit orders: Move, Gather food, Rest and Stop. Orders to settlements, nations and cultures come with those. |

## Caleb's answers for Stage 3

| Question | Answer |
| --- | --- |
| How settlements start and grow | Named stages: a pair or family founds a camp (no formal jobs; everyone forages and builds); it becomes a village (houses, storehouse; jobs begin), then a town, then a city. |
| Settlement imperatives | Build here, Set a focus, Send settlers, Abandon. A fifth choice, "something else", was set aside by Caleb after 3b: "I'm not sure what I meant either, so you can just disregard it." |
| Wealth | Coins: goods have prices; people are paid for work and earn by trade. (Step 3c.) |
| Land | Each settlement has land shown with a border; towns and above also get fencing with gates. (Fencing in step 3c, with the town stage.) |

## Caleb's answers for Stage 4

| Question | Answer |
| --- | --- |
| When a nation emerges from settlements (SPEC 7) | A leader claims rule: an individual with high enough influence in a settlement outside any nation declares a nation, becomes its first ruler, and their settlement becomes the capital. (Step 4b.) |
| What officials do (SPEC 6) | They collect taxes for the nation. Research gets its own building and a new kind of worker, separate from officials ("which can come now or later"; it comes with research in step 4c). |
| How cultures and nations show on the map | Switchable views, as WorldBox has: nations (each in its color), cultures (each in its color), or plain. Nations is the default (from 4b, when nations exist). |
| When units decide a break from their culture (SPEC 7) | When a settlement has lived far from the rest of its culture for many years (step 4a), and when a culture's people live under a nation whose policies their culture does not support (step 4b). |
| How settlements outside any nation come to belong to one, before war (Stage 5) | Settlements founded by a nation's own settlers belong to it. Besides that, only "same culture": an independent settlement near a nation joins it only if most of its people hold the nation's main culture; others stay independent. |
| What a revolt does (people unhappy with their nation's policies) | By size: a small revolt sends a group of families away to found a settlement outside the nation; a large one (most of a settlement) makes the settlement break from the nation and stand on its own, possibly as a new nation. (Breaking away from the culture over policies is the other outcome, as answered before 4a.) |
| Whether to split 4b | Keep it as one step. |
| Whether technology locks things that already exist (asked before 4c) | Lock some existing: the advanced buildings already in the game (smithy, mint, townhouse, town fences, market, hall) need their technology first, so growth runs through research. New things are added too. |
| Who decides what a culture researches | The sim picks by the culture's traits; the player can set what a culture researches next (from its panel, or as a culture imperative). |
| How technology is organized | A tree: individual technologies with prerequisites, researched one at a time. |
| Whether grown settlements spread (asked at the 4a checkpoint) | "Grown villages should spread when some sort of expansion threshold is hit, whether it is a small family or group of people striking out, a village exceeds its max population, people are leaving due to a revolt, a nation want to expand more, etc." Families striking out and settlements past their most people (or crowded) came after 4a; revolts and nations wanting land come with nations (4b). |

## Caleb's answers for Stage 5

| Question | Answer |
| --- | --- |
| What winning a war does | All of: conquest (settlements whose defenders are beaten change hands, their people staying), plunder and tribute (winners carry off goods and coins; a beaten nation may pay tribute to make peace), peace when worn out (wars end when one side has lost enough, or after long enough), and destruction (armies can burn buildings and fences in enemy settlements). |
| How nations get soldiers | "Standing armies, but regular citizens can fight if the fight comes to them." |
| Where weapons and armor come from | Made as goods: made at workshops (from iron and wood) and carried to soldiers; a nation short of them fields worse-equipped armies; technology opens better kinds. |
| Whether to split Stage 5 | Keep it as one step. |

## Caleb's comments at the Stage 5 checkpoint, and his answers

His comments from testing: hunger kills too many, and new settlements die out within a decade; rare resources (gold) never reach stores or research; people should be drawn bigger, with animations, especially in combat; mountains cannot be settled but can be crossed, and water cannot be crossed or built on without boats or bridges; one-family branch settlements happen too often and never develop; creatures to hunt, tame or fight, eventually (they come with beasts in Stage 6); towns stall around 250 people with no new building, and growth could be faster; settlement land should follow natural borders and grow where its people go, with a soft limit tied to population; clicking a building should show what it is and does; an imperative to gather resources, not just food; a 5 by 5 castle for nations with a city, where the ruler lives, which must be claimed to take the capital.

| Question | Answer |
| --- | --- |
| How people cross water | Bridges and boats now: settlements build bridges where their paths cross narrow water; a dock's boats carry people across wide water. |
| Where the castle goes | The nation's biggest city builds it once it is a city, and the capital moves there. |
| What settlement land treats as natural borders | Water and mountains: land does not spread across rivers, lakes, coasts or mountains; people can still cross and claim land on the far side by settling there. |
| How much bigger people are drawn | 1.5 times. |

## Caleb's answers for Stage 6

| Question | Answer |
| --- | --- |
| What tamed animals are for | Livestock (kept in pens, giving food and goods) and work animals (making farm work and carrying faster). |
| Where criminals come from | All of: from the people (those who fall on hard times leave and turn to crime, alone or in bands), bandit camps that appear in the wilds and raid settlements nearby, and placed by the player. |
| How much weather and seasons matter | Real effects: rain and snow slow walking and work, winters are harsh, droughts and storms come and go, shown on the map. |
| Whether to split Stage 6 | Keep it as one step. |

## Questions settled by the builder in Stage 5 (Caleb can change them)

| Question | What Stage 5 does |
| --- | --- |
| Where standing armies live | In barracks (3 by 2; 16 wood, 14 stone; 10 soldiers). A nation's capital and its towns and cities build one once they have 30 people, a store and enough food (a city builds two), while the war rule is on. Each barracks has its own army ("First Army of …"). Soldiers the player places serve in an army of their nation without a barracks. |
| How soldiers are raised (the conscription policy from 4b) | A levy fills the barracks first: fit adults (16 to 45) are called up from other work, though not officials, scholars, rulers or traders on a run. Volunteers enlist only while the nation's and their settlement's treasuries hold at least 12 coins between them: the jobless first, and now and then people leave other work for it. Either way, at most 15% of a settlement's people serve, so its work goes on. |
| Soldiers' pay | Each month, a levy is paid half a coin and a volunteer 1 coin, from the nation's treasury, or else from their home settlement's. Unpaid volunteers may leave (1 in 4 a month). In testing, nations' treasuries alone held only a few coins (taxes are 10% to 25% of what settlements hold), so armies paid only from them could not form; settlements' treasuries have real turnover from food sales and rent. |
| Arms (Caleb: made as goods, technology opens better kinds) | An armory (2 by 2; 10 wood, 10 stone; 2 armorers; needs Iron working) makes spears (1 iron ore, 1 wood), swords (2 iron ore), bows (2 wood; Archery), crossbows (2 iron ore, 1 wood; Crossbows), mail (3 iron ore; Mail armor), plate (5 iron ore; Plate armor) and catapults (10 wood, 2 iron ore; Engineering). A stable (3 by 2; 14 wood, 4 stone; 2 grooms; needs Horsemanship) raises horses (4 food each). They are built beside a barracks. Armorers make whatever their settlement's soldiers lack most that the store has the makings of, and carry it to the store; soldiers fetch it from there. Arms are not traded. |
| Kinds of soldier (SPEC 6: types such as cavalry, artillery, infantry) | A soldier's part in their army follows from their number, as their nation's technology allows: 1 in 20 artillery (Engineering), 5 in 20 cavalry (Horsemanship), 6 in 20 archers (Archery), the rest infantry. Each fetches the best arms their part calls for: infantry and cavalry a sword (else a spear) and plate (else mail), archers a crossbow (else a bow) and mail, cavalry a horse, artillery a catapult and a spear. Without arms they fight with what they have. |
| New technologies | Archery (Classical, 70), Horsemanship (Classical, 90), Mail armor (Early Medieval, 120; needs Iron working; 6 iron ore), Engineering (High Medieval, 160; needs Mathematics and Masonry), Crossbows (High Medieval, 150; needs Archery and Engineering), Plate armor (Late Medieval, 220; needs Mail armor and Guilds; 10 iron ore). 23 technologies in all. |
| How a fight is settled (SPEC 9: individual stats and equipment; SPEC 10: always on) | Blow by blow between individuals, each with 100 health. Damage: bare hands or tools 4 (reach 1.1 tiles, a blow every 10 steps), spear 9 (reach 1.5), sword 12, bow 7 (range 7, every 14 steps), crossbow 11 (range 8, every 18), catapult 12 (range 9, every 30). Mail turns aside 35% of each blow, plate 55%. A horse carries its rider 1.6 times as fast and makes melee blows a quarter harder; a catapult moves at 0.6 speed. Soldiers strike half again as hard as townspeople (drill; a levy a little less), 2% harder for each foe they have struck down (at most 30%), and each blow varies by a quarter either way. Someone at 0 health falls ("fell in battle"). |
| Who fights (Caleb: regular citizens fight if the fight comes to them) | Soldiers fight enemy soldiers within 9 tiles, and townspeople who fight them. Grown-ups (14 to 59, awake) fight enemy soldiers who come onto their settlement's land, within 6 tiles of them, and leave the fight and go home below 35 health. Children run home when enemy soldiers are near. Someone the player orders to attack fights like a soldier on the way. |
| Safety (SPEC 6) | Someone is in danger when enemy soldiers are within 10 tiles; the inspect panel shows it as an unmet need. |
| Sieges | A town's fence and gates bar enemy soldiers (its own people pass the gates as before). Soldiers whose way an enemy fence or gate blocks break it: a fence takes 40, a gate 80; melee blows count in full, arrows for 30%, a catapult for four times its blow. A broken stretch is open ground until the town builds it again. |
| Army leaders (SPEC 9: unique leaders; SPEC 10: succession) | The soldier of an army with the most foes struck down (then the most influence) leads it and becomes unique ("leads an army"). When a leader falls or leaves, the next one takes over at the month's turn. Leaders carry their nation's banner. |
| When nations go to war (SPEC 10: units declaring war, a rule) | Once a year, a nation with at least 5 soldiers may declare war on a nation it is at rivalry with: 12% a year, twice that for a martial main culture, half again as likely when it has 1.2 times the other's soldiers and half as likely when not. The other's allies join it. Beginning and ending a war are major events (SPEC 7). While at war, nations do not trade and their relation does not drift. |
| What armies do in a war | Each month: defend one of their nation's settlements where enemy soldiers are (within 90 tiles of home); otherwise, with at least 5 soldiers, march on the nearest enemy settlement within 150 tiles; go home after taking one (for a year), and when fewer than 5 are left. Soldiers marching out take 3 food from the store; more than 20 tiles from home they live off the land and sleep in the open. |
| Conquest, plunder and destruction (Caleb) | An army takes a settlement when at least 3 of its soldiers are within 8 tiles of its middle and no enemy soldier is within 10. The settlement changes hands with its people (its unrest ends). 40% of its treasury and 30% of each good in its store (not arms) are carried off by the soldiers there and handed into their nation's treasury at their barracks. Up to two of its buildings may be set alight (an even chance each, never the campfire); a burning building burns for half a year and is then gone. A nation left with no settlements falls (4b). |
| Peace and tribute (Caleb: peace when worn out) | Once a year, after at least a year of war: each side's weariness is the share of its fighters lost (everyone of the nation who fell, against those lost plus its soldiers now) plus a quarter for each settlement it lost. Peace comes with a chance of the higher weariness less one half, plus 8% for each year past six (at most 90%). The more worn-out side pays 30% of its treasury as tribute. Afterwards they are rivals, or at peace if the war lasted 5 years or more. |
| What the player can do (SPEC 4 and 10) | Declare war or make peace from a nation's panel (Edit, Relations: War; making peace this way has no tribute). Place soldiers of four kinds (Units, Soldier: infantry with a sword and mail, archer with a bow, cavalry with a sword, mail and a horse, artillery with a catapult and a spear) on a nation's land. Order people to attack (Imperatives, Attack): they go to the spot and fight any enemy of their nation on the way. The war rule. |

## Questions settled by the builder in Stage 3c (Caleb can change them)

| Question | What 3c does |
| --- | --- |
| Where do coins come from? | Each settlement has a treasury. A camp has none; when it becomes a village it is given a purse (50 coins plus 3 per person), standing for coins brought in from outside. After that coins only move between people and treasuries, except at a town's mint, which strikes new coins from gold ore. |
| How are people paid? | From their settlement's treasury: workers get 60% of what they bring to the store is worth at its price, builders 1 coin per spell of building work, minters 2 coins per gold ore. When the treasury is empty, nobody is paid until it fills again. |
| How do coins go back to the settlement? | People buy food from the store and pottery for their homes, and adults with a home pay 1 coin a month in rent. Without rent, treasuries emptied within a few years in testing. |
| What do people buy? | Food, when hungry, at the store's price; anyone very hungry (food under 25) who cannot pay is given one. Pottery, the one household good for now: an adult with at least 15 coins more than its price buys one a month, up to 6. Coins and pottery together are a person's wealth. |
| Inheritance (SPEC 6, a [Claude's call] item) | Coins and pottery are shared equally among the pair (if living) and the children. Someone with neither leaves them to their settlement. |
| What does a town have that a village does not? | A mint (gold ore into coins), townhouses (2 by 3, 10 beds, built with stone and tools) and a fence with gates. A city (200 people and 40 homes) has the same for now; nations, officials and armies come in Stages 4 and 5. |
| Fences and gates (Caleb: for towns and above) | A wooden palisade around the town's buildings, planned once a year (see below). People cannot walk through a built fence; gates are open to all. Nothing yet comes to keep out: beasts, criminals and armies come in Stages 5 and 6. |

## Questions settled by the builder in Stage 2c (Caleb can change them)

| Question | What 2c does |
| --- | --- |
| SPEC 10 lists "Pairing, births, and aging (turning these off freezes the population)" as one item. One switch or three? | One switch, as the spec groups them. It can be split into three. |
| Who pairs with whom? | One man and one woman, since pairs are what births come from (SPEC 6: "specific individuals pair up and have children"). Close relatives (parent and child, brothers and sisters, half-siblings) never pair. |
| How do children get fed? | From what a parent nearby carries when there is any; otherwise they forage close by themselves. Households come with houses (Stage 3). |

## Questions settled by the builder in Stage 4c (Caleb can change them)

| Question | What 4c does |
| --- | --- |
| The technologies (SPEC 7: the Middle Ages with a little classical; SPEC 11: the list is code's) | 17, in a tree (Caleb). Classical: Writing, Masonry, Iron working, Commerce (needs Writing), Law (Writing), Mathematics (Writing), Coinage (Commerce, Iron working). Early Medieval: Crop rotation, Administration (Writing, Law), Fortification (Masonry), Heavy plough (Iron working, Crop rotation), Feudalism (Administration). High Medieval: Architecture (Masonry, Mathematics), Guilds (Commerce, Iron working), Scholasticism (Mathematics, Architecture). Late Medieval: Banking (Coinage, Guilds), Printing press (Scholasticism, Guilds). Research costs run from 60 (Writing) to 240 (Printing press). |
| What is locked (Caleb: lock some existing) | Market (Commerce), smithy (Iron working), mint (Coinage), townhouse (Architecture), hall (Administration), town fences and gates (Fortification). A settlement cannot build them by itself or be ordered to until it has the technology; buildings already standing keep working, and the player can still place any building (SPEC 1). |
| New things | Scriptorium (Writing; 2 by 3; 10 wood, 10 stone; 2 scholars) and University (Scholasticism; 3 by 3; 20 wood, 24 stone, 2 tools; 3 scholars; towns and cities): Caleb's research building and worker. Improvements: Masonry (builders a fifth faster), Crop rotation (fields ripen a quarter faster), Heavy plough (harvests 12 food, not 10), Guilds (workshops a fifth faster), Banking (traders carry 15, not 10), Mathematics (research a quarter faster), Printing press (research half again as fast). Policy choices: elective succession needs Law, the levy needs Feudalism (SPEC 7: technology affects policies). |
| Resources (SPEC 7: advances through research and resources) | Some technologies take goods from a store of the culture's settlements once their research is done: Masonry 10 stone, Iron working 6 iron ore, Fortification 10 wood, Coinage 4 gold ore, Heavy plough 6 iron ore, Architecture 20 stone, Banking 6 gold ore, Printing press 6 iron ore. Until the goods are there the technology waits, and the culture researches something else meanwhile. (At first a waiting technology held up all research; a culture with no gold near stood still for decades.) |
| How fast research goes | Every culture with people researches 5 a year plus 0.2 per person by itself. A scholar's spell of study (about 10 seconds at 1x) adds 8 at a scriptorium, 16 at a university; scholars are paid 2 coins a spell from the treasury. Progressive cultures research a fifth faster. In testing (360 people in six groups, cultures forming in year 4), cultures knew 0 to 2 technologies by year 10, and the leading culture or nation knew 15 of 17 by year 30 to 35. |
| What a culture researches next (Caleb: the sim by traits, the player can steer) | Among what it can research now: each technology leans to some traits (Iron working to martial, Commerce to mercantile, Crop rotation to agrarian, Writing to peaceful and progressive, and so on); a technology is picked with weight 1 + 2 per matching trait, cheaper ones a little more often. The player sets it in the culture panel or with the Research order; research done toward a technology is kept if research moves elsewhere. |
| A nation's technology (SPEC 7) | All of its main culture's. Each technology one of its other cultures (5 people or more in the nation) knows is taken up with a 30% chance each year, only while a store of the nation holds the goods it needs; once taken up it stays while that culture lives in the nation. A settlement uses its nation's technology, or its own culture's if it belongs to no nation; without either, nothing locked. |
| Cultures that break away | Keep what their parent culture knew. |

## Builder's additions in Stage 4c (not named in the spec; easy to remove)

- **Technologies it knows** in the culture panel's Edit (SPEC 1: everything can be modified); unticking one also takes away those that need it.
- **Research** as an order to cultures in Imperatives (SPEC 4: imperatives to cultures), besides the choice in the culture panel.

## Questions settled by the builder in Stage 4b (Caleb can change them)

| Question | What 4b does |
| --- | --- |
| Influence (SPEC 6, a [Claude's call] item: office, wealth, family and pair ties) | Office: 50 for a ruler, 10 for an official. Wealth: half of a person's coins and household goods' value, at most 50. Ties: 30% of their pair's own influence, 25 for a ruler's child, 15 for a ruler's parent. Children have none. Shown in the inspect panel. |
| When a leader claims rule (Caleb: high enough influence) | The most influential adult of a village or bigger outside any nation, with influence of 24 or more, claims rule with a 30% chance each year. In testing the first nations formed between years 8 and 15. |
| Policies (SPEC 7: like WorldBox's culture traits; SPEC 11: the list is code's) | Succession (hereditary or elective), taxation (light or heavy), trade (open or closed), expansion (expansionist or settled) and conscription (levy or volunteers, used once armies exist in Stage 5). Each choice fits one culture trait: hereditary and heavy taxes fit hierarchical cultures, elective and light taxes communal ones; open trade fits mercantile, closed agrarian; expansionist fits progressive, settled traditional; levy fits martial, volunteers peaceful. A new nation takes the choices its main culture's traits fit. |
| What policies do now | Succession picks the next ruler. Taxation sets what officials take: a tenth or a quarter of a settlement's treasury a year. Closed trade lets its traders deal only within the nation and with allies. Expansionist nations send a young family out to take land, with a 30% chance each year. |
| Culture support (SPEC 7, a [Claude's call] item) | Each culture holds a support value (0 to 100) for every policy choice: 70 if the choice fits its traits, 25 if not; it rises 3 a year while the choice is in force where the culture lives, and drifts 2 a year back to where it started otherwise. During a major event, a policy whose other choice the main culture supports more changes with a chance of 60% × (1 − support for the current choice / 100), so well-supported policies rarely change. |
| Major events (SPEC 7) | A change of ruler, a settlement breaking away, and a nation falling (for the nations that had relations with it). War and disasters come in Stages 5 and 6. |
| Unrest and revolts (Caleb: by size; and breaks over policies) | A culture group of 4 or more in a settlement of a nation whose policies it supports less than 45 on average is unhappy; unrest grows a month at a time (and falls 2 a month once they are content). After a year of unrest, each month has a 1 in 8 chance of an outcome: the group breaks from its culture and founds one that takes up the policy it disliked most (a 50% chance for progressive cultures, 25% for traditional ones, if culture formation is on), or it revolts. A revolt by most of a settlement other than the capital makes the settlement break away; its leader becomes unique and, with influence of 12 or more and the nations rule on, claims rule of a new nation. Any other revolt sends about a quarter of the group's families away to found a settlement of no nation. |
| Relations (SPEC 7: basic relations) | Alliance, trade, peace (the default) or rivalry, between nations whose settlements come within 120 tiles. Once a year each pair leans toward one by an opinion: +40 for the same main culture (+20 if one broke from the other), +8 per shared trait, +20 if both trade openly, −10 if both are martial (and of different cultures), −15 for close neighbours (under 40 tiles) of different cultures, −35 for two expansionist neighbours (under 70 tiles); then 60 or more is alliance, 30 trade, −15 or less rivalry. A relation changes to what it leans toward with a 50% chance each year. Trade moves under peace only when both trade openly; under trade or alliance always; never under rivalry. Alliances matter in war (Stage 5). |
| Taxes (Caleb: officials collect them) | A nation's capital, and its towns and cities, build a hall (3 by 2; 16 wood, 12 stone; 3 officials). An official walks to the nation's settlement most overdue for taxes (within 100 tiles, at most twice a year each), takes its share from the treasury, carries the coins back (SPEC 8: goods are carried), and the nation's treasury takes 80%: the official keeps 10% and the ruler 10%. The treasury is kept for armies (Stage 5). |
| Rulers and succession (SPEC 10: always happens) | Hereditary: the ruler's eldest grown child in the nation, then their pair, then the most influential grown-up in the capital. Elective: the most influential grown-up in the nation. It happens at once when a ruler dies, and within a month when they leave. Titles: King or Queen (hereditary), Lord or Lady Protector (elective). Nations are named "Kingdom of" or "Commonwealth of" their capital, the word following succession unless the player renames the nation. |
| Unique individuals (SPEC 6) | Rulers, those who lead a revolt, people the player names, and anyone who reaches influence 40 (with the rule on) become unique: they get a medieval English name with their settlement ("Edith of Thornwell") shown in place of their number. |
| A nation that forms before its people have a culture | Its policies are random until its first main culture forms; then it takes up that culture's ways. |
| Falling and capitals | A nation with no settlements left falls (kept for the record). If its capital is lost, the biggest of its settlements becomes the capital. |

## Builder's additions in Stage 4b (not named in the spec; easy to remove)

- **A key** to the nation map view, like the cultures' key.
- **Name** and **Make ruler** in the inspect panel's Edit (SPEC 1: everything can be modified; SPEC 6: player-chosen unique individuals).
- **A crown** on rulers, and **a banner** in the nation's color on its halls, so they can be found on the map.
- **Capital** and **relations** in the nation panel's Edit.

## Questions settled by the builder in Stage 4a (Caleb can change them)

| Question | What 4a does |
| --- | --- |
| What a "period of having no culture" is (SPEC 7) | 3 years for a settlement's people (a year is a minute at 1x). People outside any settlement wait 6 years, and then everyone without a culture within 20 tiles forms one together (without that, every wandering family formed its own tiny culture). |
| What culture traits are (SPEC 11: culture traits; the list is code's) | One side of each of four pairs: temper (martial or peaceful), livelihood (mercantile or agrarian), outlook (traditional or progressive) and order (hierarchical or communal). A new culture's traits are random; a culture that breaks away keeps its parent's traits but one. |
| What traits do now | Mercantile cultures build a market at 15 people (others at 25); agrarian cultures reckon a farm feeds 10 people (others 12), so they keep more fields. Progressive cultures break away more readily when far from home (30% a year) than traditional ones (10%). Temper and order will shape nations' policies and war (4b, Stage 5), and outlook research (4c). |
| How far is "far from home" | A settlement more than 50 tiles from every other settlement of its culture, for 10 years. The settlement where most of the culture's people live is its heartland and never counts as far. |
| A settlement holding several cultures | Its culture is the one most of its people hold; it changes only when another culture is held by more. Newcomers with no culture take up the settlement's culture at once; people whose culture is held by fewer than a quarter of the people there take it up with a 10% chance each year (SPEC 6: groups influence individuals). Children take their mother's culture, or their father's. |

## Builder's additions in Stage 4a (not named in the spec; easy to remove)

- **A key** to the culture map view: each living culture, its color and its people, each opening its panel.
- **Culture** in the inspect panel's Edit (SPEC 1: everything can be modified).
- **Break away** as a settlement order (SPEC 7 lets the player decide a break; SPEC 4 puts orders to settlements in Imperatives).

## Builder's additions in Stage 3c (not named in the spec; easy to remove)

- **Coins** in the inspect panel's Edit (SPEC 1: everything can be modified).
- **Prices** beside each good in the settlement panel's store.
- **Where a trader is going** in the inspect panel ("Taking goods to sell in …", "Bringing goods home").

## Builder's additions in Stage 3b (not named in the spec; easy to remove)

- **Leave job** in the inspect panel's Edit (SPEC 1: everything can be modified).
- **A sack on the back** of anyone carrying goods, so hauling can be seen.
- **Workers stop when the store is full** of what they make (see below), so forests are not cut down for nothing.

## Builder's additions in Stage 3a (not named in the spec; easy to remove)

- **Settlement names on the map**, over each campfire, with the stage and number of people (like place names on WorldBox's map).
- **Placing a campfire** founds an empty camp that unsettled people nearby join (SPEC 1: everything can be modified).
- **Removing a campfire** abandons its settlement.

## Builder's additions in Stage 2c (not named in the spec; easy to remove)

- **End pair** in the inspect panel's Edit (SPEC 1: everything can be modified).
- **Parents and children** on the inspect panel, as links, alongside the pair the spec names.

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
| Look (Caleb's direction: Stickman Arena's look, navy outlines on everything, a simple environment, objects in their own colors; after Stage 3c: each biome in its natural color, drawn in the same style as everything else, unlike the first draft's plain flat colors) | **Ground:** each biome has its natural color: grassland a fresh green, forest a darker green, hills an olive green, mountains grey-brown rock, snow near-white, desert a warm tan, sand a pale yellow, swamp a murky olive; shallow water light blue and deep water a deeper blue. Cliff sides are the ground color darkened (the left side less than the right, as the light falls on buildings), and the map's outer edge is a solid navy slab like Stickman Arena's stages. **Marks on the land:** sparse and flat, in natural colors inside a navy outline, like the trees and buildings: domed hills a lighter olive with a shaded side, mountain peaks of light grey rock with a dark shaded side, snowy peaks with a white cap and a cool shaded side above a jagged snow line, reeds green with brown heads, waves white foam. Small line marks (grass tufts, about 1 tile in 8; dunes; sand dots) are navy, like the outlines. **Objects:** natural colors inside a navy outline: trees (brown trunks, green crowns; pines darker green; about one tree a tile in forests), stone (grey rocks), iron ore (rust flecks), gold ore (a gold glint), clay (an orange-brown pit), fish (silver), berries (a green bush with red berries); people and buildings likewise. **Outlines:** navy; steps in the land have outlines too, so terraces read as contour lines. The app's cream, navy and red stay for the interface; red marks the brush and a settlement's land. Zoomed far out, one larger drawing stands for a patch of tiles (every 2, 4 or 8 tiles, by zoom). Map pictures on Home use the same colors (a map's picture is redrawn when the map is next changed). | |
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
| Toolbar tabs | **Main** (shown first): Play/Pause, 1x 2x 3x, Save setup or Save run, Start again from setup. **Units**: Person (click or drag on land to place adults, one per tile) and Remove (a brush, 1 to 8). **Imperatives** (from 2b): orders to units. **Disasters & effects** is shown but cannot be chosen yet; it comes in Stage 6. |
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

## Needs and survival (Stage 2b)

| Item | Choice |
| --- | --- |
| Needs (SPEC 6) | Each person has **food** and **rest**, 0 to 100, shown as bars on the inspect panel. **Shelter** and **safety** are shown but nothing meets or threatens them yet (see the questions above). **Job** reads None until jobs exist (Stage 3). |
| Food | Lost steadily: from full to hungry (45) in about 45 seconds at 1x, and to empty in about 80 seconds. A hungry person eats food they carry; if they carry none, they go to the nearest berry bush or fish with food left (looking within 14 tiles, then 40, and only when very hungry as far as 90), gather up to 3 food, and eat one. Each food is worth 50. When they are only a little hungry and food is close by, they top up what they carry. |
| Where food comes from | Berry bushes and fish on the map (SPEC 3 and 8: resources from map tiles). A bush holds up to 6 food and fish up to 8; each grows back by one now and then (about 6 times in 10 months for berries, 8 in 10 for fish). A picked bush is drawn without berries and fished-out water without fish until they grow back. Hunting comes with animals (Stage 6) and farming with buildings (Stage 3). |
| Sharing food | People claim a share of a bush on their way to it, so a crowd spreads over several bushes instead of all heading for one. |
| Carrying | The food a person gathers is carried (SPEC 8: goods are carried by individuals); the inspect panel shows it. |
| Rest | Lost while awake (about 95 seconds from full to tired at 1x); a tired person lies down and sleeps where they are until rested (about 12 seconds). At no rest at all they fall asleep wherever they are. |
| Health and death (SPEC 10) | With no food at all, health falls from full to nothing in about 25 seconds at 1x, and at no health the person dies (the inspect panel says what of). Fed and rested people slowly heal. Injury from fighting, beasts and disasters comes with those systems. |
| Living off the land | With foraging only, an area feeds as many people as its bushes and fish grow back for. A crowd placed in one spot eats the area out and many starve; spread out, a Titanic map feeds many thousands. Farming (Stage 3) will raise this. |
| What it looks like | Sleeping people lie down with a small "z"; gathering and eating people reach down and forward in turn. |
| Saving | Needs, carried food, orders and the food left on each tile are saved (world format version 2). Setups and runs saved in 2a open with everyone fed and rested and every bush full. |

## Life cycle (Stage 2c)

| Item | Choice |
| --- | --- |
| Ages | Children under 14 (drawn at half an adult's height under 7, about three quarters from 7 to 13), adults, and elders from 55 (drawn with grey hair). A year is a minute at 1x. |
| Natural death (SPEC 6) | No death of old age before 45; after that the chance each year rises: about 1% at 45, 2.5% at 55, 6% at 65, 15% at 75, 36% at 85. The inspect panel says "died of old age". |
| Pairing | Unpaired adults from 16 who meet an unpaired person of the other sex within 10 tiles and within 12 years of their own age pair up (a 35% chance each month while they are near). Pairs last until one of them dies; the other may pair again. Pairs keep near each other when nothing else needs doing. |
| Births (SPEC 6) | A paired woman aged 16 to 45, fed (food over 50), healthy (over 60) and with her pair nearby (or sharing a home with them, since pairs with jobs are often apart by day) has a 4% chance each month of becoming pregnant (3% until Caleb asked for faster growth after 3c); nine months later she gives birth beside where she is. At least 18 months between births. A child takes skin and hair from either parent and starts fed and rested. In tests this gives about five children per woman over her life when food is plentiful. |
| Children | Have needs like adults (SPEC 6). They keep within a few tiles of their mother (or father), are fed from what a parent nearby carries, and otherwise forage close by. Light jobs come with jobs (Stage 3). |
| Growth | From 100 people placed in five groups on a Titanic map, the population was about 160 after 10 years, 215 after 30 and 300 after 60 (simulated). Food limits it where people crowd: foraging only feeds so many, and the hungry have fewer children. |
| The switch (SPEC 10) | **Rules** in the Main tab: "Pairing, births and aging". Off: nobody pairs, falls pregnant, gives birth, ages or dies of old age (anyone already pregnant stays so until it is turned back on). Needs and death from hunger go on, since SPEC 10 makes those always on. The panel lists what is always on. Saved with the setup or run. |
| Saving | Pairs, parents, pregnancies, the father of an expected child, and the rules are saved (world format version 3). Setups and runs from 2b open with nobody paired and every rule on. |

## Settlements (Stage 3a)

| Item | Choice |
| --- | --- |
| Founding (SPEC 7) | Once a month, an unsettled woman whose pair is unsettled and near her may found a camp where she stands (a 20% chance each month), if no settlement's middle is within 20 tiles and trees are within 30 (there must be wood to build with). The camp is a campfire with land 3 tiles around it. Unsettled people within 12 tiles of a settlement's middle join it, bringing their children. |
| Stages | Camp, village, town, city. A village needs 10 people and 3 homes, a town 60 people and 12 homes, a city 200 and 40. In 3a only villages are reached in practice; towns and cities come into their own in 3c. |
| Land | Grows each month to 3 tiles plus the square root of its people plus one per three buildings (at most 14), taking only land nobody holds. Shown as a light red tint with a dashed navy border. Unowned buildings on newly claimed land become the settlement's. |
| What gets built | Each month a settlement starts homes when it has more homeless than planned beds (huts while a camp, houses once a village if there is stone within 40 tiles), a storehouse once a village, and anything it has been ordered to build, first. A camp works on one site at a time, a village on two (one more with the housing focus, one more while orders wait). |
| Buildings | Campfire (the middle; 1 tile; not built); hut (2 by 2 tiles; 9 wood; 4 beds); house (2 by 3; 12 wood, 6 stone; 6 beds; villages); storehouse (3 by 3; 15 wood, 9 stone; villages; it stores goods from 3b on). Building work takes from about 16 to 34 seconds at 1x for one builder; up to 4 build at once. |
| Size (Caleb's direction after 3a: bigger and more realistic, "like how WorldBox buildings are 2x3 or similar") | Buildings cover several tiles, with walls taller than a person (a house's walls are about 1.4 times a person's height, with a roof as tall again). Huts have woven wattle walls and a tall pointed thatch roof; houses are timber-framed plaster with a thatch gable roof, a chimney, shuttered windows and a door; the storehouse is a plank barn with a shingle roof and big double doors. A house or other long building can be turned (R while placing or ordering it). Ground under a building may be at most one level uneven; it then stands on a stone base. Terrain drawings (grass, hills, deposits) are left off the tiles under a building. |
| Where settlements build | A free spot on their own land as near the middle as possible, with a one-tile lane kept clear around every building so people can walk between them. Land grows faster than before to make room (4 tiles plus 1.3 times the square root of its people plus one per two buildings, at most 22).
| Building work (SPEC 8) | Settled adults with their needs met take building work (three times in four when free): cut a tree (wood 3, about 4 seconds) or break stone (stone 2, about 5 seconds), carry it to the site, and once the materials are all there, put the building up. Cut trees leave stumps and grow back slowly (about one tree per forest tile every two years); a stone deposit holds 20 and does not come back. Builders go up to 60 tiles for wood and 40 for stone. |
| Homes and shelter (SPEC 6) | A finished home takes in a homeless family (a pair and their children) or a single adult. People sleep at home when it is within 40 tiles, and are not drawn while inside. Sleeping at home rests fully; sleeping out in the open rests at 60% of the speed. Newborns live in their mother's settlement and home. |
| The rule (SPEC 10) | "Settlement founding by units" in Rules. Off: nobody founds a settlement by themselves; people still join settlements, and campfires and settlers still work. |
| Saving | Settlements, buildings, land, trees standing and stone left are saved (world format version 4; version 5 adds which way a building is turned). Older setups and runs open with no settlements, every tree standing and every stone deposit full. Buildings saved before buildings grew keep their corner tile and take their new size from there. |

## Jobs and production (Stage 3b)

| Item | Choice |
| --- | --- |
| When jobs start | At the village stage (Caleb: camps have no formal jobs). A camp's people forage and build; once it is a village, its adults take jobs at its workplaces. |
| Jobs (SPEC 6) | Every job is a tradesman's job at a building ("generic tradesman (works at various buildings)"): farmer at a farm, woodcutter at a woodcutter's lodge, quarryman at a quarry, miner at a mine, fisher at a fishing hut. Soldiers, traders and officials come with the stages that need them. Each month a village gives open jobs to adults without one, nearest workplace first. |
| Children's light jobs (SPEC 6) | From age 8, children may take a light job: farm helper (tends at half speed) or fisher's helper (catches less). One light job per farm and per fishing hut. |
| The job need (SPEC 6) | For adults in a village or bigger. The inspect panel shows the job, or "None (no work free)" in red, and lists Job among unmet needs. Like shelter before houses, an unmet job need does no harm yet; it will matter for wages and wealth (3c). |
| Workplaces (SPEC 8) | Farm (3 by 3 field; 4 wood; 2 farmers and a helper; grassland or hills). Woodcutter's lodge (2 by 2; 8 wood; 2 woodcutters). Quarry (2 by 2; 6 wood, 4 stone; 2 quarrymen). Mine (2 by 2; 10 wood, 4 stone; 3 miners; iron or gold ore near). Fishing hut (2 by 2; 8 wood; 2 fishers and a helper; at the water's edge). |
| Farming | Farmers tend their field from March to November; nothing grows in winter, so what is stored carries the village through it. A farmer stays in the field for a spell of up to 20 seconds at 1x, leaving early when it ripens or when very hungry or tired. With two farmers a field ripens about two and a half times a year and each harvest gives 10 food, left in sheaves at the field's corner until a farmer carries the whole harvest to the store in one trip. The field shows bare soil, shoots, green crop and ripe wheat. |
| Gathering jobs | Woodcutters cut trees within 20 tiles of their lodge and carry 6 wood (two trees) at a time; quarrymen break stone within 28 tiles (4 at a time); miners dig iron or gold ore within 28 tiles (2 a dig, 4 at a time); fishers catch fish within 14 tiles (2 a catch). Iron and gold deposits now hold 20 ore each and are used up like stone. |
| The store (SPEC 8: goods are carried by individuals) | Workers carry what they make to their settlement's store: its storehouse, or its campfire while it has none. It holds food, wood, stone, iron ore and gold ore, shown in the settlement panel. When it holds plenty of something (3 food per person plus 30; 80 wood; 60 stone; 40 iron or gold ore), workers who make it stop for now and help build or rest. |
| Using the store | Hungry people in a settlement eat from its store (taking up to 3 food) when it has food and is within 40 tiles, and forage only when it has none. Builders take wood and stone from the store when it has some (up to 4 at a time), and fetch them from the land themselves when it has none. |
| What villages build | After homes and a storehouse: farms (or a fishing hut where there is fish near) while their food does not keep up with their people with a fifth to spare (a farm reckoned to feed 12, a fishing hut 8) and the store holds under 2 food a person, and always while the store holds under 1 food a person, and a woodcutter's lodge, quarry and mine when there are trees, stone and ore near and they have none. A balanced village puts food first when its store is short of it; the food focus always puts food first; the goods focus puts materials first. If there is no room for one workplace, it tries the next. |
| Doors | People go in and out of buildings at the tile in front of their door: to sleep at home, and to the storehouse. |
| Saving | Jobs, stores, crops and ore left are saved (world format version 6). Worlds from 3a open with no jobs, empty stores and iron and gold deposits full. |

## Goods, coins and trade (Stage 3c)

| Item | Choice |
| --- | --- |
| Goods (SPEC 8) | Food, wood, stone, iron ore, gold ore, tools and pottery, kept in each settlement's store. Clay is dug by potters and fired straight into pottery, so it is never stored. Every good is carried by a person (SPEC 8). |
| Prices (Caleb: goods have prices) | Each settlement sets its own. A good's usual price (food 2, wood 1, stone 1, iron ore 3, gold ore 6, tools 10, pottery 5) is multiplied by how far its stock is from what the settlement wants to keep (food: 2 per person plus 10; wood 40; stone 30; iron ore 16; gold ore 8; tools a quarter of its people, at least 4; pottery half its people, at least 4), from half when it has plenty to three times when it has none. The settlement panel shows each price. |
| Workshops | **Smithy** (2 by 2; 8 wood, 8 stone; 2 blacksmiths): takes 2 iron ore from the store and makes a tool. **Pottery** (2 by 2; 8 wood, 4 stone; 2 potters; clay within 22 tiles): potters dig clay (a clay deposit holds 20) and fire one pot from each lump. **Mint** (2 by 2; 8 wood, 14 stone, 2 tools; 1 minter; towns): takes 1 gold ore and strikes 12 coins into the treasury. A piece of work takes about 10 seconds at 1x. |
| Tools | While the store has tools, all its settlement's workers work 1.5 times as fast (farmers tend faster; gatherers and workshops take less time), and each piece of work has a 1 in 30 chance of wearing one out. Mints and townhouses need 2 tools to build. |
| Traders (SPEC 6: "travels and sells goods") | A **market** (3 by 3, with stalls; 12 wood, 4 stone; 2 traders) is built once a village has 25 people and another village or bigger within 90 tiles. A trader picks the run that pays best for the distance: up to 10 of something home has more of than it wants, to the settlement within 90 tiles that pays most more for it. There they sell at its price, buy up to 10 of something it has spare that home pays more for, and on coming home sell that to the store and pay home what the first load cost at home's price. They keep what is left over. |
| Wages and wealth | See the questions above. The inspect panel shows a person's coins and pottery, and their wealth; the settlement panel shows the treasury. |
| What settlements build | Smithies once they have a mine or iron ore in the store; potteries at 20 people with clay near; markets as above; a mint once a town has gold ore stored or near. When at least 4 adults have no work (counting jobs at workplaces already being built), a settlement adds more of what it has: woodcutter's lodges, quarries and mines up to one per 40 people (plus one), smithies and potteries up to one per 80 (plus one), and farms while its food store is not full. |
| Saving | Coins, household goods, prices' stocks, traders' runs, fences and clay left are saved (world format version 7). Older worlds open with every clay deposit full and each village or bigger given the purse a new village gets. |

## Cultures (Stage 4a)

| Item | Choice |
| --- | --- |
| Forming (SPEC 7: cultures only emerge) | A settlement whose people have had no culture for 3 years forms one, and all its people join it; a single person is enough. People outside settlements form one after 6 years, together with everyone without a culture within 20 tiles. Each culture gets a name (made from old-sounding syllables, such as Merese or Thalish) and a color. |
| Belonging (SPEC 6: exactly one culture once one exists) | Everyone holds one culture or none. Newborns take their mother's culture (or their father's). People who join a settlement keep their culture; those without one take up the settlement's. |
| Breaking away (SPEC 7; Caleb: when far from home) | A settlement far from the rest of its culture (see above) may break away: its people of that culture found a new one, keeping the old traits but one. The player can order any settlement to break away (Imperatives, or the settlement panel), whether or not the rule is on. Breaking away over a nation's policies comes with nations (4b). |
| Extinct | A culture whose last member is gone is marked extinct in that year and kept for the record (its panel still opens from the cultures it gave rise to or broke from). |
| Editing (SPEC 7: the player can edit cultures) | The culture panel's Edit changes its name, color and traits. A person's culture can be set by hand in the inspect panel's Edit. |
| What the app shows | The inspect panel and the settlement panel show the culture (with how many other cultures live in the settlement), each a link to the culture's panel: when and where it formed, the culture it broke from and those it gave rise to, people, settlements, traits. |
| Map views (Caleb: switchable views) | **Map: Plain / Cultures** at the top right. Plain shows settlements' land in the light red tint; Cultures shows each settlement's land in its culture's color (settlements with no culture yet in a faint grey), with a key of cultures under the world panel. The nations view comes with nations (4b) and will be the default. Culture colors are given most distinct first (green late, since it is hard to see on grassland). |
| The rule (SPEC 10: culture formation) | "Culture formation" in Rules. Off: no culture forms and none breaks away by itself. Cultures that exist stay, newcomers still take up the culture they live among, and the player can still order a break. |
| Saving | Cultures, people's cultures, and how long a settlement has been without a culture or far from home are saved (world format version 8). Older setups and runs open with no cultures, which form as the run goes on. |
| In testing | From 360 people in six groups on a Titanic map, the first cultures formed in year 4. Before settlements spread, by year 30 there were 12 to 14 living cultures on two maps, most with one settlement each. With spreading (below), by year 40 the larger cultures held 5 to 9 settlements each, and one far-off settlement on each map had broken away. |

## After the post-Stage-5 checkpoint (Caleb's comments while Stage 6 was starting)

| Item | Choice |
| --- | --- |
| Boats (Caleb: nobody ever built a boat; make it a technology to research) | A new technology, **Boatbuilding** (Classical; 70 research; 10 wood; needs nothing first; leans mercantile and progressive). A culture with a settlement on a coast or lakeside is three times as likely to pick it, one with none a third as likely. Docks need it. A coastal settlement of 20 people (was 25) with food for half its people (was all of them) builds one. Settlers head for land across water only when their own land has a dock. In testing on an island map, the first culture learned it in year 14 in one run and year 26 in another and built its dock soon after; six people ordered to the next island all sailed there. Docks already standing in older runs stay. |
| Gates (Caleb: many gates side by side, at right angles) | Cause: the fence's edge is two tiles thick where it runs diagonally, and every edge tile on a line through the middle, or on a path, became a gate. Now gates go only on straight stretches (fence on two opposite sides, so the way through is clear), at least 8 tiles apart, one at each crossing; gates already built stay where they still fit, and the rest are closed up as fence at the yearly look. In testing: gates touching another gate 0 to 1 per town (6 to 13 before); 9 to 26 gates per town (20 to 42 before). |
| Spreading (Caleb: a town of 60 started 5 settlements that outgrew it, and it stalled at 25) | Causes: young families struck out from any settlement of 50 (8% a year); a crowded village sent a quarter of its people out; an expansionist nation sent families from its biggest settlement of 20 or more (30% a year); and groups could leave every year. Now young families leave only a settlement of 100 people or more that is still growing (at least 3 more people, and a twentieth more, than a year before); crowding sends a quarter out only under the same condition; expansionist nations send settlers only from such a settlement; and at least 3 years pass between groups leaving one settlement (was 1). A settlement past what its stage holds (village 120, town 300, city 600) still sends a quarter out. |
| Growth (Caleb: towns need to grow more) | Measured first: a fifth to a quarter of paired women lived in a different home from their pair (they paired after both had a home) and were seldom together, so had few children. Now pairs living apart move in together (one into the other's home where there is a bed, else both into a home with two; up to 6 pairs a month in each settlement), and the chance of a child is 10% a month (was 7%) for a fed, healthy pair. In testing, 30 people grew to 261 to 350 in 40 years (172 to 196 before); the first settlement had 216 to 330 people at year 40 (60 to 127 before) and became a city by year 35 to 40. |
| Coins (Caleb: too sparse; most people hold 0 to 3) | Cause: the coins in the world never grew. Each settlement got 50 plus 3 per person on becoming a village, and only a mint (which needs Coinage and gold ore) made more, so a growing town shared the same coins among more people. Workers were paid only for what they brought, which was less than their rent. Now a village or bigger gets 10 coins in its treasury for each person it gains past its most people so far (and 50 on becoming a village), and tradesmen are paid 2 coins a month from the treasury (1 for a child in a light job) besides their pay for what they bring; soldiers, officials and traders are paid as before. In testing, grown-ups held a median of 9 to 16 coins at years 20 to 30, and the top tenth 34 to 52 (the median was 0 before). Treasuries stay low, since what comes in as rent and sales is paid out as wages. |
| Saving | Settlements' yearly head counts and the most people they have had (world format version 15; new fields only). An older run's villages and towns get coins for all their people in its first month. |

## After Stage 5 (Caleb's checkpoint comments)

| Item | Choice |
| --- | --- |
| Why hunger killed so many (found by tracing each death) | Four faults, all fixed. (1) A claim on a berry bush held 1 berry but the person took up to 3, so those after them found the bush bare and starved walking to the next one; a claim now holds what they will take. (2) Settled people with no coins could only eat from their store once nearly starving, so they walked far to forage and starved on the way, while the store held food; anyone hungry can now eat from their store, paying if they can (treasuries often run dry, so many workers have no coins). (3) Someone walking somewhere (a soldier marching, a worker going to a job) never stopped to eat the food in their hands; now they do, and anyone starving on the way stops to find food. (4) Someone exhausted and starving fell asleep, was woken by hunger, and fell asleep again every step without eating; they now eat first. Hunger still kills: in 60-year test runs, 15 to 60 people every 5 years among 1,000 to 1,800 (a quarter to half a percent of people a year), more in the first few years when groups placed together forage the same ground, and in settlements whose store runs dry. |
| Settlement land (Caleb: natural borders; growth where people go; a soft limit tied to population) | Land never covers water or mountains (snow included). A new settlement holds the land within 4 tiles of its campfire, spread out over land only. After that, a tile of unclaimed land beside its land is taken in at the month's turn once its people have stood on it (working, walking, foraging), freely while it holds less than 80 tiles plus 12 for each of its people, and less and less often beyond that. Unclaimed land mostly surrounded by its own is always taken in, so it has no holes. Buildings it puts up claim the land under and around them, and mines, quarries, woodcutter's lodges and fishing huts go only at resources it can reach without crossing water or mountains. It builds anywhere on its land, as far out as the land reaches (before, land stopped growing at 22 tiles from the campfire, which is why towns ran out of room, stopped building and stalled). Land that older runs held on water or mountains is let go when they open. |
| One-family branches (Caleb: too many, and they never grow) | A group striking out is now two or three young families together with up to three young people not yet paired, at least 6 people; it leaves from settlements of 50 people or more (was 30), with an 8% chance a year (was 15%). A group leaving a crowded or overfull settlement is at least 8 people. A grown-up (17 to 35) with nobody at home they could pair with may move to a settlement within 60 tiles that has someone (a quarter chance a year), preferring their own nation's; so small settlements get newcomers and their children can pair. |
| Faster growth (Caleb) | At least a year between births (was a year and a half), and a 7% chance a month (was 4%) for a fed, healthy pair together. In testing, 360 starting people grew to 1,350 to 1,900 in 60 years depending on the run (about 860 by year 40 before these changes, against 1,000 to 1,180 now), with water now blocking the way. Runs differ a good deal from one to the next. |
| Towns becoming cities (Caleb: towns stalled around 250 with nothing new built) | Three causes, all fixed. Land stopped growing (see above). Homes were planned by who had a home rather than by beds: children born into a home and pairs moving in crowded homes past their beds, so nobody counted as homeless and no more homes were built (a town of 219 had 68 beds); homes are now planned, and crowding judged, by beds. And a stage is now reached with enough people and either enough home buildings or enough beds for the people it needs (townhouses hold ten each, so a big town has fewer, larger homes). In testing, some runs had their first city by year 40 or 50; in others the biggest towns were still 130 to 160 people at year 60. |
| Homes (Caleb after this round: new houses stood empty while huts held 14 of 4) | Children are born into their mother's home and pairs move in, so homes filled past their beds, and nobody already housed ever moved. Now, once a month, in a home with more people than beds the eldest household stays and the other households move out (to homes with room, or counting as homeless so more homes are built); a household too big for its home moves, whole, to one with room for it; and up to three households a month move up from a smaller home to a bigger one with room for them (a hut family into a new house). In testing at year 40, 16 of 135 houses stood empty (48 before) and the empty homes were mostly huts. |
| Things across water | Food, trees, stone, ore and clay are only looked for where people can walk to them (on the same piece of land, joined by bridges, or water beside it); before, people chose food across a river, failed to find a way, and could swap between two such bushes until they starved. Each piece of land is worked out once, and again when a bridge or dock is finished, so a journey between pieces goes straight to a boat (from land with a dock) or fails at once instead of searching far on foot. |
| Rare resources reaching research (Caleb: gold never reached it) | A technology's goods may now come from all the stores of the culture's settlements together (before, one store had to hold them all). Goods the culture's research is waiting for or will need are wanted more: their price rises (traders bring them) and miners dig the ore that is needed (gold when research or a mint wants it, else whichever is shorter; they used to dig only the ore nearest their mine, nearly always iron). A settlement builds a mine at gold once gold is wanted and no mine reaches it. In testing, four of five main cultures had Coinage by year 40 (none could before). A culture none of whose settlements can reach a resource still waits for traders to bring it. |
| Settlements with no stone near | Their campfire serves as their store for workplaces (before, they could never build a storehouse, so never a market, hall, mine or dock), and they build a storehouse and stone houses once their store holds the stone (bought or carried in). |
| Water (Caleb: not crossed or built on without boats or bridges) | Water, shallow included, can no longer be walked. People already standing in it walk out. |
| Bridges | Villages and bigger look once a year at the way to their three nearest neighbours (within 90 tiles) and to the nearest trees, stone and ore (within 40); where one is cut off by water (on another piece of land), they plan a bridge across each stretch of shallow water on the way of at most 4 tiles. Builders build it a tile at a time out from the bank, each tile 2 wood from the store (they fetch it when the store has 4 or more) and a coin's pay. Bridges are walked like ground and drawn as plank decks. |
| Docks and boats | A dock (2 by 2, 16 wood, beside water with deep water within 4 tiles) is built by settlements of 25 people or more whose land has such a shore, once fed. When someone on a long journey (settlers, traders, soldiers, or by order) finds no way on foot and a dock exists, they go by boat: board at any dock, sail over water, and land on any shore. People on open water are drawn in a rowing boat. |
| Mountains (Caleb: crossed but not settled) | As before, they can be walked (slowly) and nothing is built on them; now no settlement's land covers them either. |
| The castle (Caleb: 5 by 5, the ruler's seat; biggest city; capital moves there; taken only by claiming it) | 5 by 5; 40 wood, 80 stone, 4 tools; needs Fortification. A nation's biggest city builds it once it is a city and the nation has none, before other buildings once fed. When it is finished the capital moves there, and the ruler, their pair and young children live in it. An army takes that settlement only by standing at the castle with no defenders near it (the castle's door instead of the campfire). Drawn with a curtain wall, corner towers, a gate and a keep flying the nation's banner. |
| Building info (Caleb: click a building) | Clicking a building opens its panel: what it is and does, its settlement (a link), whether it is built (and materials and builders while it is not), workers and children working there, people living there, a castle's ruler, a field's crop and sheaves waiting, what its workers are making or carrying, and whether it is burning. (Before, a click opened the settlement's panel; the panel links to it.) |
| Gathering resources (Caleb: an imperative for resources, not just food) | Imperatives, Gather resources, with a choice of wood, stone, iron ore, gold ore or clay: the people chosen go to the nearest of it to the spot clicked (within 24 tiles), gather a load of 6 and take it to their settlement's store (someone with no settlement keeps it). |
| People 1.5 times bigger (Caleb) | Drawn half again as tall (about as tall as a house's walls). |
| Animations (Caleb: especially in combat) | People face the way they walk, or the foe they fight (the picture is mirrored). Fighters swing swords up and down, thrust spears and draw bows. Each blow shows: a flash where a swing lands, and arrows, bolts and catapult stones flying in an arc to their mark. The fallen lie where they fell for a few seconds, fading. |
| Finding the way, now that water blocks it | Searches got much costlier once rivers could not be waded (people chose things just across a river, and the search looked a long way round before giving up). Now: short trips with nothing in the way are walked straight with no search, and strolls only go where a straight walk can reach; a search looks at more tiles the further its goal is, so a short trip that needs a long way round is given up quickly and they choose something else; each settlement keeps a map of what its people can walk to within 64 tiles of its middle (made again each month and when a bridge is built), used to leave out what they cannot reach and to give a search room when the way round is long; people remember the last few food tiles they could not reach. |
| Saving | Bridges, planned bridges, docks, castles, builders' bridge work and orders to gather resources (world format version 14; new fields only). |

## Military and war (Stage 5)

| Item | Choice |
| --- | --- |
| Rules | See "Questions settled by the builder in Stage 5" above. The code is in `src/sim/military.ts`; arms and buildings in `buildings.ts`; armorers, grooms and conscription in `economy.ts`; war relations in `nations.ts`. |
| What the app shows | Soldiers wear a tunic in their nation's color and a helmet, with their weapon, mail (grey) or plate (steel), a horse with a saddlecloth, or a catapult beside them; leaders carry a banner. Zoomed far out, soldiers are dots in their nation's color. Burning buildings show flames. New buildings are drawn: barracks (stone, slate roof, the nation's banner), armory (spears and a shield by the wall), stable (a paddock fence and hay). The nation panel shows its soldiers, its armies (leader, soldiers, what each is doing) and its wars (how long, who declared, the fallen on both sides, settlements taken and lost); its relations can be set to War. The settlement panel shows its garrison and when it is under attack; its store lists arms when it holds some. The inspect panel shows a soldier's kind, army, arms and foes struck down, and safety. |
| The rule (SPEC 10: units declaring war; Caleb's armies) | "Nations raising armies; units declaring war." Off: nations build no new barracks and declare no wars by themselves. Armies already raised stay, wars already begun go on until peace, and the player can still declare war and make peace. Fights themselves are always on (SPEC 10). |
| Saving | Armies, wars on relations, soldiers and their arms, arms in stores, buildings burning, armorers' work, the war rule (world format version 13). Older setups and runs open with no armies and the rule on. |

## Fixes found while building Stage 5

- **Halls stood empty.** Jobs went only to people without one, and by the time a settlement's hall was finished everyone already had a job, so in testing no nation had officials and taxes were never collected. A hall, scriptorium or university with open places now draws one worker a month from ordinary work (first from work whose goods the store has plenty of, food last).
- **Chasing round obstacles.** A soldier going round something to reach a foe asked for a new path on every step and never walked it; they now walk the path they get.

## After 4c (Caleb: the rules menu, where workplaces stand, pavement)

| Item | Choice |
| --- | --- |
| The rules menu | It grew upward with each new rule until its title, close button and first rules were hidden under the header with no way to scroll to them. It now stops below the header, shows the rules in two columns where there is room, and scrolls its list when the window is short. |
| Where workplaces stand (Caleb: mines and the like further from the middle, or outside the settlement, as they usually are) | Mines, quarries, woodcutter's lodges and fishing huts go beside the nearest ore, stone, trees or fish within 35 tiles of the settlement's middle that no workplace of their kind already works (within 8 tiles), on the settlement's land or unclaimed land beside it; the settlement then claims the land within 3 tiles of it. Only when no such spot exists do they go as close to the middle as they fit. Fields go at least 6 tiles from the middle where there is room (the outskirts), then closer. (Fields were not named; they are included as the other buildings usually kept outside a village's middle, and can be changed back.) In testing, mines stood about 18 tiles from the middle on average, quarries and woodcutter's lodges about 13, fields about 10, homes 7 to 9. |
| Pavement (Caleb: villages put down pavement) | Villages and bigger plan paths each year from their campfire to the door of each of their buildings within 26 tiles (the corner of a field), along the way people would walk, on their own land and off water. Builders pave a planned tile with 1 stone from the store (paid a coin, as for fence work), when the store holds at least 4 stone; they do not break stone just for paving. Walking on pavement costs 0.6 of the ground's usual cost, so people walk faster on it and prefer it. A town fence gets a gate wherever a path crosses it. Pavement is drawn as pale stone slabs with a navy edge where it meets open ground, without the tile's grass or other drawings. The settlement panel shows how much is laid. In testing, 260 tiles were paved by year 25 (of about 960 planned): paving waits for spare stone. |
| Saving | Pavement and each settlement's planned paths (world format version 12; new fields only). |

## Technology (Stage 4c)

| Item | Choice |
| --- | --- |
| Research (SPEC 7: done by the culture, expedited by buildings) | See above. Settlements build a scriptorium at 25 people once their culture knows Writing, and towns and cities a university once they know Scholasticism. |
| What the app shows | The culture panel's Research: research a year, what it is researching (with a bar, what it opens, and the goods it is waiting for), technologies done but waiting for goods, a choice of what to research next, and what it knows. The nation panel's Technology: what it has. The nation editor marks policy choices that need a technology. A settlement ordered to build something its technology does not allow says so. Scholars and studying show in the inspect panel. |
| The rule (SPEC 10: culture research and nation tech derivation) | Off: cultures stop researching and nations stop taking up technology. What they know stays, and the player can still set it. |
| Saving | Cultures' technologies, research and progress, nations' technologies (world format version 11). Older setups and runs open with cultures knowing nothing; buildings already standing stay and keep working. |

## Nations (Stage 4b)

| Item | Choice |
| --- | --- |
| Forming (SPEC 7; Caleb: a leader claims rule) | See above. The claimant becomes the first ruler and their settlement the capital. |
| Placed nations (SPEC 7: some are placed in setup) | **Units, Nation**: click a settlement outside any nation; it becomes a new nation's capital and its most influential adult its ruler (if nobody lives there yet, the first grown-up to do so). |
| Belonging (Caleb) | A settlement founded by a nation's settlers belongs to it (unless they left in a revolt). An independent settlement within 40 tiles of a nation's settlement, most of whose people hold the nation's main culture, joins it with a 30% chance each year. Nothing else joins a nation before war (Stage 5). |
| Nations sending settlers (Caleb: a nation wanting to expand) | Expansionist nations, and the player's **Expand** order (Imperatives, Nations: click one of its settlements, then where), send settlers whose settlement belongs to the nation. |
| What the app shows | A nation panel (ruler, capital, lands, treasury and officials, unrest, cultures, policies with the main culture's support, relations), opened from the key, from a settlement's or person's panel, or from the culture panel's links. Edit changes its name, color, capital, policies and relations. The settlement panel shows its nation (and whether it is the capital) and any unrest; the inspect panel shows a unique person's name, office, nation and influence. The world panel counts nations. |
| Map views (Caleb) | **Map: Nations / Cultures / Plain**, Nations first and the default: each settlement's land in its nation's color (independent settlements faint grey). |
| The rules (SPEC 10) | "Nations emerging from settlements", "Nation policy changes during major events", "Diplomatic relation changes" and "Emergence of unique individuals" in Rules. Succession always happens (SPEC 10). |
| Saving | Nations, relations, settlements' nation, unrest and taxes, unique people, officials' taxes, cultures' support (world format version 10). Older setups and runs open with no nations and every new rule on. |
| In testing | From 360 people in six groups, 40 years on three maps: 3, 4 and 10 nations; trade relations formed between neighbours with open trade and shared ways. Revolts were rare, since each nation's policies start as its main culture would have them; flipping every policy of every nation against its culture (as a player could) brought unrest within a year, then two settlements breaking away, a small revolt, two culture breaks, and policies changing back at those major events. |

## Spreading (after 4a; Caleb: grown villages spread when an expansion threshold is hit)

| Item | Choice |
| --- | --- |
| A family strikes out | Each year, a village or bigger with at least 30 people has a 15% chance that one young pair (both 16 to 35) and their children leave to found a settlement of their own. |
| Past its most people, or crowded | A settlement with more people than its stage holds (camp 40, village 120, town 300, city 600), or a village or bigger with more than 30% of its people homeless for 2 years, sends about a quarter of its people (whole families) to found a new settlement. |
| Not too often | Nobody leaves a settlement in its first 2 years, and at least a year passes between groups leaving one settlement. Camps never count as crowded, since their people are still building their first homes. |
| Where they go | A spot 25 to 50 tiles away (1 time in 5, 60 to 100 tiles, which in time may make a settlement far from the rest of its culture): free land that can be built on, at least 20 tiles from any settlement's middle, with trees within 30 tiles; open grassland with stone near is preferred. They go as settlers do (with food for the road), keep their culture, and the new settlement's panel says whose settlers founded it. |
| Revolts and nations | People leaving after a revolt, and nations sending settlers to take land, come with nations (4b), through the same way of sending people out. |
| The rule | "Settlement founding by units" covers spreading too: off, grown settlements no longer send people out (the player can still send settlers). |
| In testing | From 360 people in six groups, 40 years on two maps: 38 and 42 settlements (29 founded by settlers), 3 or 4 towns, the rest villages and young camps; population 788 and 663. An earlier try that let crowded camps split broke the start into 22 small settlements in five years and no town formed in 40, so camps do not split for crowding and nobody leaves in a settlement's first 2 years. |
| Saving | Which settlement founded each one, how long it has been crowded, when it last sent people out, and settlers' home settlement (world format version 9; new fields only). |

## Towns, fences and gates (Stage 3c)

| Item | Choice |
| --- | --- |
| Town and city | As set in 3a: a town needs 60 people and 12 homes, a city 200 and 40. In testing, settlements of 60 to 140 people became towns within 6 to 10 years. A town builds townhouses instead of houses once its store has 2 tools and there is stone near. |
| Where the fence goes | Once a year (and when a settlement becomes a town), the town marks its core: every building except farms, mines, quarries, fishing huts and woodcutter's lodges, with 2 tiles around each. Groups of buildings closer than about 6 tiles are joined, holes are filled, and any building the area touches is taken in whole (so the fence never cuts through a field). The fence runs along the edge of that area, on the town's own land, never on water, and along a river or lake only where it leads out of town. Old stretches no longer on the edge are taken down. |
| Gates | Where the fence crosses the lines straight out and diagonally out from the campfire. Any loop of fence that would have no gate gets one at its point nearest the campfire, so nobody is shut in. |
| Building it | In a town, builders put up the fence between building sites: 1 wood a stretch, 3 a gate, from the store or from trees they cut themselves. Trees where a stretch goes are felled, and their wood goes to the store. A builder is paid 1 coin a stretch. The settlement panel shows how many stretches are built. |
| What it looks like | A palisade of pointed navy-outlined stakes with rails, joined to the stretches beside it; gates are two posts with a crossbar. |

## Settlement imperatives (Stage 3a)

| Order | What it does |
| --- | --- |
| Build (any building: homes, storehouse, workplaces) | Click a settlement, then where (the building's middle; R turns it): on its land, or on unclaimed land beside it (it claims the spot). It goes first in what the settlement builds. |
| Focus | Balanced, food, housing or goods. In 3a housing lets it build one more home at a time and goods brings the storehouse forward; food and goods do more once jobs and workshops exist (3b, 3c). |
| Send settlers | About a quarter of its people (whole families) leave and walk to the spot clicked, where the first to arrive founds a new settlement and the rest join it. |
| Abandon | Asks first. Its people leave, its land is given up, its campfire and unfinished buildings go, and its finished buildings stand empty for anyone to take over. |

Either way round, as for units: choose the settlement first (click one of its buildings in Main) and then the order, or pick the order and then click the settlement. Clicking one of a settlement's buildings in Main opens its panel: stage, when it was founded, people, homes, buildings (finished and being built), focus, and shortcuts to the orders.

## Imperatives (Stage 2b, units only)

| Item | Choice |
| --- | --- |
| Orders | **Move** (go to a spot), **Gather food** (gather from the nearest food to a spot), **Rest** (lie down and sleep now) and **Stop** (cancel orders and go back to their own choices). |
| Either way round (SPEC 4) | Choose people first (click one in Main or Imperatives, or drag a box in Imperatives), then pick the order; or pick the order first, then click a person or drag a box. Move and Gather food then ask where (a click on the map). Esc cancels a half-given order. |
| Groups (SPEC 4) | Only unit orders take a box of people, as the spec says; orders to settlements, nations and cultures will not. |
| Obeying | An order comes before what a person would choose for themselves. It wakes a sleeper unless they are worn out. Needs keep running while they obey, so an order cannot keep someone from starving; when an order is done they go back to their own choices. |

## Editing people (Stage 2b, SPEC 1)

The inspect panel's **Edit** opens sliders for health, food and rest, a choice of sex, and the age in years. Changes take effect at once, paused or running.

## Performance (Stage 2b)

Measured as in 2a (512 map, 3x, headless Chrome without a graphics card), with everyone placed in one crowded spot so food runs short (the hardest case for path searches):

| People | Simulation step (average, while food runs short) | Frames a second (whole map / mid zoom / close) |
| --- | --- | --- |
| 2,000 | 1.5 to 11 ms | 59 / 56 / 58 |
| 5,000 | 5 to 11 ms (the crowd starves down to about 4,100) | 52 / 55 / 54 |

Two fixes came out of measuring: picked bushes are redrawn together about once a second rather than on every step, and path searches are held to a firm budget per step (12,000 tiles looked at), so a famine makes people wait a moment for a path instead of slowing the whole world. The slowest single step seen was 24 ms, under the 33 ms a step has at 3x.

## Performance (Stage 2c)

The life cycle adds a monthly check per person and a grid of people rebuilt every 25 steps; measured as in 2b, the numbers did not change: 2,000 people at 55 to 59 frames a second and 2 to 10 ms a step; 5,000 at 48 to 55 frames a second and 6 to 11 ms a step.

## Performance (Stage 3a)

2,000 people placed in 40 groups across a Titanic map founded about 90 settlements in the first year; by year 6 there were 2,360 people, 66 villages, 590 buildings and 1,700 people housed. Simulation step: 2 to 2.7 ms on average, at most 9 ms (Node, same code as the worker). In headless Chrome at 3x, with all of that on screen: 57 frames a second for the whole map and 56 at mid zoom. With the bigger buildings: 2 to 4 ms a step (at most 14 ms in the first busy year) and 51 to 57 frames a second.

## Performance (Stage 3b)

With jobs, hauling and workplaces: 2,000 people placed in 40 groups grew to 2,340 by year 5 with 105 settlements and 54 villages. Simulation step 3 to 3.7 ms on average, at most 18 ms (Node). In headless Chrome at 3x: 52 frames a second for the whole map and 57 at mid zoom. Two fixes came out of measuring: buildings are sent from the simulation only when their drawing changes (not on every bit of building work), and the main screen works out which tiles lie under buildings from the buildings themselves rather than by going over every tile of the map.

## Population (after Stage 3c; Caleb: make growth slightly faster to outpace death)

Measured first: in a 30-year run of 360 people in six groups, most deaths were adults dying of hunger, not old age (about 60 in each of the first five-year spans), and the population fell to 335. The causes found, and what changed:

| Cause | Change |
| --- | --- |
| Tired came before hungry: a starving person who was also tired lay down and starved in their sleep, sometimes with food in hand. | Someone hungry who carries food eats first; someone starving (food under 15) looks for food before sleeping unless they cannot stay awake; a sleeper with no food left wakes once they have had some rest, or at once if they carry food; someone waiting for a path eats meanwhile if they carry food. |
| Walks to a tile under a built fence never found a way, so those people kept trying and gave up. | A walk to a tile that cannot be walked on goes to the tile beside it; trees no longer grow back on fence tiles. |
| Traders starved on long runs. | Traders take up to 3 food from the store for the road. |
| Pairs with jobs were rarely together at the monthly check, so few children were born. | Pairs sharing a home count as together; the chance of pregnancy is 4% a month (was 3%). |
| Towns ran short of food: farmers spent most of their time walking to and from fields (fields lie outside the fence), and farms were planned as if each fed 16. | Longer spells in the field, the whole harvest carried in one trip, and farms planned more cautiously (see Jobs and production). |

Result, 30 years from the same start on three generated maps: 360 grew to 698, 648 and 542. On the third map the population rose to about 560 by year 20 and then eased back slightly: its towns are still short of food at times. On every map growth slows between years 15 and 25, when the people placed at the start grow old before their children are grown; it picks up again after that.

## Performance (Stage 3c)

With coins, workshops, traders and fences: 2,000 people placed in 40 groups across a Titanic map; 2,050 by year 5, with 95 settlements, 59 villages and 818 buildings. Simulation step 2.9 to 4.9 ms on average, at most 15 ms in the first busy year (Node, the same code as the worker). In headless Chrome at 3x with about 1,960 people: 47 frames a second for the whole map and 57 at mid zoom. One fix came out of measuring: the settlement bookkeeping that was being redone several times a step is done once, and housing families no longer compares every person with every other (the slowest step fell from 33 ms to 12 ms). After the population changes and the natural biome colors: 2,000 people grew to 2,500 by year 5 (was 2,050); 2.9 to 4.3 ms a step on average, at most 12 ms; 43 frames a second for the whole map and 56 at mid zoom with about 2,200 people.

## Performance (Stage 4a)

With cultures: 2,000 people placed in 40 groups grew to 2,390 by year 5. Simulation step 3.1 to 3.8 ms on average, at most 15 ms (Node). In headless Chrome at 3x with about 2,200 people: 44 frames a second for the whole map and 56 at mid zoom. The culture map view redraws the land only when a settlement's culture or a culture's color changes.

## Performance (after spreading)

2,000 people placed in 40 groups grew to 2,540 by year 5 with 95 settlements. Simulation step 2.7 to 4 ms on average, at most 23 ms in one busy step (Node). In headless Chrome at 3x with about 2,300 people: 39 to 44 frames a second for the whole map (two runs) and 54 at mid zoom.

## Performance (Stage 4b)

With nations: 2,000 people placed in 40 groups grew to 2,540 by year 5. Simulation step 3.2 to 3.6 ms on average, at most 11 ms (Node). In headless Chrome at 3x with about 2,200 people: 50 frames a second for the whole map and 58 at mid zoom.

## Performance (Stage 4c)

With technology: 2,000 people placed in 40 groups grew to 2,420 by year 5. Simulation step 3 to 3.9 ms on average, at most 18 ms (Node). In headless Chrome at 3x with about 2,200 people: 51 frames a second for the whole map and 49 to 57 at mid zoom. One fix came out of measuring: research progress was sent to the app after every scholar's spell of study, redrawing the panels on almost every update (the whole map fell to 31 to 35 frames a second); it is now sent once a month and when a technology is learned or chosen.

## Performance (Stage 5)

With a war: a run grown for 30 years, with people added to pass 2,000 and two neighbouring nations at war with 142 soldiers between them. Simulation step 4.4 to 5.6 ms on average, at most 14 ms (Node), through the battle (94 fell). In headless Chrome at 3x with 2,100 to 2,600 people and a battle on: 45 to 47 frames a second for the whole map (52 to 53 in the same run before the war; the first reading after zooming out is lower while the terrain is drawn), 46 to 58 at mid zoom at the battle, 51 to 58 close in. One fix came out of measuring: the nation panel's figures were rebuilt each time someone fell, about 2 ms each; they are now counted in one pass and refreshed for losses at most every 25 steps.

## Performance (after Stage 5)

With water blocking the way and settlement land growing, the simulation does more. A run grown for 30 years, with people added to pass 2,000 (1,300 of them outside any settlement) and two neighbouring nations at war with 146 soldiers between them: simulation step 9 to 12.7 ms on average, at most 58 ms (Node), through the battle. At 3x (30 steps a second) that is about a third of one processor core, in the simulation's own worker. In a run left to grow by itself, about 4.9 ms at 1,570 people by year 60. In headless Chrome at 3x with 2,200 to 2,600 people and a battle: 27 to 47 frames a second for the whole map (lower than after Stage 5, mostly while land that changed is drawn again), 37 to 53 at mid zoom at the battle, 50 to 53 close in. Fixes that came out of measuring: see "Finding the way" above; the nations' panel counts were made in one pass over everyone; tiles taken for fences, paving and bridges are counted once a step. Still well short of the point where the web version would be unplayable (SPEC 2), but the step time has roughly doubled; it is the thing to watch as creatures come in Stage 6.

## Fixes found while building 4a

- **Send settlers** (3a) rarely worked over long distances: settlers searched for a way only 8,000 tiles deep and gave up when it was farther, and they walked on while starving because their journey came before their hunger. Settlers now search as far as traders, eat and forage on the way (pressing on when there is no food near), and take up to 3 food each from the store when they set out.

## Look

- The portal's, Synth Studio's, Stickman Arena's and the Worldbuilding Sandbox's style: cream, navy and red; Norwester headings; Archivo body text; staggered stripes; flat cards. Light mode only.
- The map follows Stickman Arena's line art (Caleb's direction): natural colors for the biomes (since Stage 3c) and for objects, flat shading, navy outlines on everything. See "Isometric view".
- Map mode's tool buttons show a single tile drawn the same way, so each button looks like what it paints.
- Logo: the full Croswell Industries logo on Home; the C mark in the gap left of the bottom stripes in Map mode and on the main screen.
- App icon: a cream castle keep flying a red pennant, on navy.
