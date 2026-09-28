# RIFTFALL: Command Theater

A modern real-time strategy game in the spirit of the classic *Command & Conquer* series, built to run in **Chrome on your Mac**. No installs, no plug-ins, no downloads beyond the game itself. Every model, texture, sound effect, music track and voice line is generated in code.

> A meteor storm, **the Riftfall**, seeded Earth with **Riftite**: a glowing crystal that is both a miracle fuel and a spreading plague. The **Aegis Coalition** fights to contain it. The **Rift Covenant** worships it.

## How to play on a Mac

**Option A: one file, no setup**
1. Download [`release/RIFTFALL.html`](release/RIFTFALL.html). On GitHub, open the file and click **Download raw file**.
2. Double-click it. It opens in your browser. Chrome is recommended; Safari works too.

**Option B: run from source (for developers)**
```bash
npm install
npm run dev        # then open http://localhost:5173 in Chrome
npm run build:single   # rebuilds release-style single file into dist-single/index.html
```

**Option C: GitHub Pages.** The repo includes `.github/workflows/pages.yml`. Turn it on under *Settings → Pages → Source: GitHub Actions*, and every push to `main` publishes the game at your Pages URL.

## Game modes
- **Campaign.** Two story campaigns, one for each faction, with briefings, radio dialogue, scripted twists and a tutorial-style opening mission.
- **Skirmish.** Battle 1 to 3 computer opponents (Easy, Normal, Hard or Brutal) on 6 maps across 4 theaters (temperate, desert, winter, wasteland), with teams, starting credits and fog-of-war options.

## Controls (MacBook-friendly)

| Action | Input |
|---|---|
| Select / box-select | Left click / drag |
| Select all of a type on screen | Double-click |
| Move, attack, harvest, capture | **Right click**: a two-finger tap on the trackpad, or **Ctrl+click** |
| Force fire | Alt+right click |
| Queue waypoints | Shift+right click |
| Attack-move | `A`, then click |
| Stop / Scatter | `S` / `X` |
| Hold ground / Hold fire | `G` / `F` (toggle) |
| Deploy MCV | `D`, or double-click the MCV |
| Control groups | ⌘ or Ctrl + `1`–`9` to assign, `1`–`9` to select (double tap to jump) |
| Select army on screen / everywhere | `Q` / `E` |
| Scroll | Two-finger swipe (trackpad mode), arrow keys, screen edges, or middle-drag |
| Zoom | Pinch (or mouse wheel with trackpad mode off in Options) |
| Jump to last alert / base | `Space` / `H` |
| Sell / Repair mode | `Z` / `R` |
| Cycle build tabs | `Tab` |
| Pause menu | `Esc` or `P` |
| Transmission log | `L` |
| Objectives | `O` (click an objective to jump to it) |
| Game speed | `+` / `-` |

## Playing tips
1. Deploy your MCV, build a **Power Plant**, then a **Refinery** (it comes with a free Harvester).
2. Watch the power bar. Low power slows production and shuts down advanced defences.
3. Build a radar structure to bring the minimap online.
4. Counter your enemy. Rifles beat infantry. Rockets, cannons and flame beat armour. SAMs, Flak and rocket infantry beat aircraft.
5. Engineers capture neutral **Oil Derricks** for steady income, and capture enemy buildings once they are below half health.
6. Units gain veterancy (chevrons) from kills.
7. Build your faction's superweapon (Ion Uplink or Rift Missile Silo) to end stalemates.

## Factions

| | Aegis Coalition | Rift Covenant |
|---|---|---|
| Style | Heavy armour, precision, air power | Speed, stealth, fire and lasers |
| Signature units | Guardian MBT, Titan Assault Tank, Tempest MLRS, Hawk VTOL, Ghost Marksman | Raider Bike, Shade Stealth Tank, Inferno Tank, Rift Prism Tank, Wraith Gunship |
| Signature defence | Rail Spire | Obelisk of the Rift |
| Superweapon | Ion Strike | Rift Missile |

## Technology
TypeScript, [Three.js](https://threejs.org) (WebGL 2), Web Audio and Web Speech, bundled with Vite. The simulation runs at a fixed 30 Hz and never touches the DOM, so the AI and missions can be tested headless:

```bash
npx tsx scripts/aitest.ts        # AI vs AI matches
npx tsx scripts/missiontest.ts   # campaign mission checks
npx tsx scripts/perftest.ts      # 250-unit battle benchmark
```

### Project layout
```
src/data/        units, buildings, weapons, factions (balance lives here)
src/game/        simulation: World, Unit, Building, Player, pathfinding, fog, map generator
src/game/ai/     computer opponent
src/game/mission/ campaign framework + missions
src/render/      Three.js renderer, terrain, effects, procedural models
src/audio/       synthesized SFX, procedural music, voices
src/ui/          HUD, sidebar, minimap, menus, briefings
```

*Inspired by the Command & Conquer series. Not affiliated with or endorsed by Electronic Arts.*
