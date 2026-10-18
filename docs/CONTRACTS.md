# FLOPPY DEFENSE — Module contracts (source of truth)

Ludum Dare 60, theme **Old Tech**, **Compo** rules: every asset (models, textures, sounds, music) must be **generated in code**
during the jam. No image/audio/model files, no external fonts, no CDN. Libraries (three.js and its `examples/jsm` addons) are fine.

Stack: Vite 7 + three 0.186 (npm, `import * as THREE from 'three'`), plain JavaScript ES modules, no TypeScript, no frameworks.
Target: itch.io HTML embed 960x600 + fullscreen, desktop (mouse+keyboard) **and** mobile (touch, landscape). 60 fps on a mid laptop,
playable on a mid phone.

## 1. Concept recap

Top-down (slightly tilted perspective) view of a 90s PC motherboard. Viruses enter from the serial ports (COM1, COM2) and follow
copper traces to the CPU. The player inserts floppy-disk turrets into free drive slots, paying **KB** of memory. A virus that
reaches the CPU removes **CPU integrity %**. At 0 % → **Blue Screen Of Death** (game over). Between waves a component overheats:
clicking the fan cools it, otherwise nearby floppies fire slower. Bosses on waves 5 and 10. 10 waves = victory
("It's now safe to turn off your computer"); its **KEEP GOING** button continues the same run as endless from wave 11.
**ENDLESS** in the menu (unlocked after a victory) starts a fresh, fully generated endless run. A BSOD offers
**RESTORE LAST KNOWN GOOD CONFIGURATION** (replay the lost wave from its start, score ×0.8 per restore), RETRY and MENU.

Loop: `prep` (15 s, 25 s before wave 1; place/upgrade/sell; SPACE/"RUN" starts early for bonus KB) → `wave` (spawn, fight) →
wave cleared (bonus KB) → `prep` … Speed toggle x1/x2. Pause (P/Esc, auto-pause on tab hide and on window blur mid-wave,
e.g. clicking the itch.io page around the iframe). First game only (`!settings.tutorialDone`, campaign): the wave-1
countdown holds (`game.prepHold`) until the first floppy is inserted; SPACE/RUN still start the wave.

## 2. File ownership (one owner per file — never edit files you don't own)

| Owner | Files |
|---|---|
| **core (integration)** | `index.html`, `src/main.js`, `src/config.js`, `src/style.css`, `src/core/{events,state,loop,pool,collision,rng,i18n,save}.js`, `docs/CONTRACTS.md`, `package.json`, `vite.config.js`, `tools/**` |
| **world** | `src/world/**` (`map.js` + any helpers e.g. `board.js`, `labels.js`, `components.js`), `src/data/map.js` |
| **enemies** | `src/game/enemies.js`, `src/game/waves.js`, `src/game/enemyModels.js`, `src/data/enemies.js`, `src/data/waves.json` |
| **towers** | `src/game/towers.js`, `src/game/projectiles.js`, `src/game/towerModels.js`, `src/data/towers.js` |
| **audio** | `src/audio/**` |
| **ui** | `src/ui/**` (entry `src/ui/ui.js`, styles `src/ui/ui.css`), `src/data/strings.js` |
| **render** | `src/render/**` (`renderer.js`, `post.js`, `fx.js`, helpers) |
| **systems** | `src/core/input.js`, `src/core/autoplay.js`, `src/game/economy.js`, `src/game/heat.js`, `tests/**` |

If you need something from a module you don't own, use its documented API or an event. If the API is missing something,
work around it defensively (optional chaining) and list the request under "Integration notes" in your final report.

## 3. Shared context object `ctx`

Created in `src/main.js`, passed to every `createX(ctx)` factory. Factories run in this order, so **at creation time** you may
only rely on modules created before you; at runtime (methods/update) everything exists.

```
ctx = {
  THREE, events, game, settings, audio, rng, params (URLSearchParams), debug (bool), container (#game div),
  view,        // render/renderer.js   (1)
  map,         // world/map.js         (2)
  fx,          // render/fx.js         (3)
  enemies,     // game/enemies.js      (4)
  projectiles, // game/projectiles.js  (5)
  towers,      // game/towers.js       (6)
  economy,     // game/economy.js      (7)
  heat,        // game/heat.js         (8)
  waves,       // game/waves.js        (9)
  input,       // core/input.js        (10)
  ui,          // ui/ui.js             (11)
  computeScore(), loop, bootErrors[]
}
```
`window.__FD === ctx` (debug/test hook). Every factory must tolerate being called once and `reset()` many times.
A factory that throws is replaced by a no-op stub (see `safeCreate` in main.js) — but don't rely on that.

**Simulation vs frame**: `main.js` calls, per fixed step (dt = 1/60 s × speed, only in `prep`/`wave`; the menu's attract demo
steps only enemies/towers/projectiles/fx, see §7):
`waves.update` (wave only) → `heat.update` → `enemies.update` → `towers.update` → `projectiles.update` → `economy.update` → `fx.update`.
Per rendered frame (real dt, always, including menu/pause/gameover): `map.update(dt, t)` → `ui.update(dt, t)` → `view.render(dt, t)`.
So: gameplay + gameplay FX freeze on pause; ambient board animation, UI and post-processing keep running.
A step that ends or pauses the game (BSOD, victory) is the last one: `step()` returns at once outside `prep`/`wave` and the
loop drops the rest of that frame's steps, so nothing leaks, kills or earns after `gameover`/`victory`.
**Hit-stop** (main.js): the sim speed is scaled ×0.12 for 0.15 s (real time) on `boss:killed` and ×0.35 for 0.2 s on the
last kill of a wave (`wave:cleared`), then eased back to ×1 over ~0.4 s; UI/camera/post keep real time. Off at `?turbo>1`.
Exception: once the opaque full-screen UI covers the canvas (`boot` after 1.5 s, `gameover`/`victory` after 1.6 s) main.js skips
`view.render` to save GPU/battery (the BSOD lets the crash glitch play for ~0.85 s before going black, then blue).

## 4. Coordinates & board

- `BOARD = { W: 24, H: 15, CELL: 1 }` (src/config.js). X right, Z toward the bottom of the screen, Y up, board plane `y = 0`.
- Cell `(c, r)`, `c ∈ [0,23]`, `r ∈ [0,14]`, centre = `(c + 0.5 - 12, 0, r + 0.5 - 7.5)`.
- Board occupies x ∈ [-12, 12], z ∈ [-7.5, 7.5]. The world module may add a beige case rim / decorations outside that area.
- Gameplay entities move at `y ≈ 0.25–0.6` above the board. Floppy turret bodies ~0.9 tall.
- Camera (render module): perspective, fov ≈ 40°, looking at the board centre from above and slightly south
  (≈ 60–70° pitch). It must keep the whole board visible at any aspect ratio (960x600, 16:9, phone landscape ~2.1:1,
  and degrade gracefully on portrait).

## 5. Module APIs

### 5.1 `render/renderer.js` → `createRenderer(ctx, container)` → `view`
```
view.renderer  THREE.WebGLRenderer (canvas appended to container, before #ui)
view.scene     THREE.Scene
view.camera    THREE.PerspectiveCamera
view.render(dt, t)                    // post-processing chain; called every frame by main
view.resize()                         // auto on window resize / fullscreenchange / orientation
view.worldToScreen(vec3) -> { x, y, visible }   // CSS px relative to #game top-left (for UI popups)
view.raycasterFromClient(clientX, clientY) -> THREE.Raycaster  // configured for the pick layer too
view.shake(intensity = 0.3, duration = 0.25)
view.flash(color = 0xffffff, strength = 0.5)    // brief post-processing flash (CPU hit = red)
view.glitch(strength = 1, duration = 0.3)        // CRT glitch burst (boss spawn, CPU hit, BSOD transition)
view.setCRT(bool), view.setQuality('auto'|'high'|'low')
view.isMobile (bool), view.quality ('high'|'low')
view.ready (bool), view.warmupMs   // shader warm-up: the canvas stays black until ready (~1 s GPU, 4-8 s software GL)
view.stats() -> { ..., ready, warmupMs, pendingLow }   // pendingLow: auto-quality drop deferred to the next prep
```
Responsibilities: renderer (sRGB output, ACES or AgX tone mapping, shadows on high quality), lights (warm key light + cool fill,
hemisphere), scene background/fog, camera fit, post-processing (`post.js`: bloom for emissive phosphor/LEDs + CRT pass:
scanlines, slight barrel curvature, vignette, RGB shift, noise, flicker; toggleable; cheaper on mobile), DPR cap (2 desktop,
1.5 mobile, auto-drop to low quality if fps < 40 for 3 s). Camera behaviour: subtle idle drift in `menu` (attract mode),
locked during play, shake on CPU damage. Listens to: `phase:change`, `cpu:damage` (shake+red flash+glitch), `boss:spawn`
(glitch), `gameover` (heavy glitch), `settings:change`.

### 5.2 `render/fx.js` → `createFx(ctx)` → `fx`
```
fx.burst(pos, color, count = 16, { speed = 3, size = 0.08, life = 0.6, gravity = -6, cubes = true })  // voxel/pixel debris
fx.text(pos, string, color = '#39ff6a', { size = 0.5, life = 0.9, rise = 1.2, delay = 0, outline = null /*glow colour*/ })
fx.ring(pos, radius, color, { life = 0.4, width = 0.08 })   // expanding ground ring (defrag pulse, AoE)
fx.beam(from, to, color, { life = 0.12, width = 0.05 })     // instant line (laser / zap)
fx.spark(pos, color)                                          // small muzzle spark
fx.smoke(pos, { color = 0x555555, count = 4 })               // overheat smoke puffs
fx.update(dt)   // simulation dt (frozen on pause)
fx.reset()
```
Pooled/instanced, zero allocations per frame in steady state. Listens itself to: `enemy:killed` (burst in enemy colour + "+N KB"
text), `enemy:hit` (tiny spark), `cpu:damage` (red burst at CPU), `tower:placed` (dust ring), `enemy:split`, `boss:killed`
(huge burst).

### 5.3 `world/map.js` → `createMap(ctx)` → `map`
```
map.grid = { w, h, cell }
map.cellToWorld(c, r, out = new Vector3()) -> Vector3
map.worldToCell(x, z) -> { c, r } | null
map.paths: [{ id: 'COM1', name: 'COM1', points: Vector3[] /* world, y=0 */, length }]
map.samplePath(pathIndex, dist, outPos, outDir?) -> outPos   // clamped to [0, length]; outDir = normalized tangent (XZ)
map.slots: [{ id /* int, stable */, c, r, pos: Vector3 /* y=0 */, tower: null | Tower }]
map.cpu = { pos, radius }        map.fan = { pos, radius }
map.ports: [{ id, name, pos }]   // entry points, pathIndex == index
map.livePorts                    // Uint8Array, one per port: 1 if the next (prep) / current (wave) wave spawns there
map.viewBounds = { minX, maxX, minZ, maxZ }   // board extents the renderer frames (rim included)
map.heatSpots: [{ id: 'ram', name: 'RAM', pos, radius /* tower-penalty radius */ }]
map.pick(raycaster) -> { kind: 'slot', slot } | { kind: 'fan' } | { kind: 'cpu' } | null
map.setHover(slot | null)        // desktop hover highlight
map.setSelected(slot | null)     // selection highlight
map.showRange(pos | null, radius, color)    // translucent range disc + ring on the board
map.setHeatVisual(spotId, level /*0..1*/, overheated /*bool*/)   // glow red, shimmer, smoke is fx's job
map.setFanSpeed(mult)            // visual rotation speed multiplier (1 idle … 8 boosted)
map.setCpuIntegrity(frac /*0..1*/)          // CPU die colour green→amber→red, cracks/flicker below 0.3
map.pulseCpuHit()                // short red pulse on the CPU
map.update(dt, t)                // ambient animation: data pulses travelling along the traces toward the CPU, LEDs, fan
map.reset()
```
Owns the whole static board look: green PCB with silkscreen, glowing copper traces for the virus paths (clearly readable),
serial port connectors (DB-9) at the path entries, the CPU (big, centre-right, socket + heatsink look, integrity glow), the CPU fan
(clickable, spinning), RAM sticks, chipset, BIOS chip, CMOS battery, capacitors, ISA/PCI slots, jumpers, beige case rim. Drive
**slots** (where floppies go) are visible "floppy drive bay" sockets with a status LED next to the path; 20–28 slots,
none on the path, all within reach of the path. Two paths (COM1 top-left, COM2 bottom-left) that wind and merge before reaching the
CPU; each path length ≈ 40–60 units. Path traces are flat on the board; enemies walk on them.
Raycast targets: invisible hit meshes on `LAYERS.PICK` (see config) with `userData = { kind, slotId }`.

### 5.4 `game/enemies.js` → `createEnemies(ctx)` → `enemies`
```
Enemy = { id, type, def, name, hp, maxHp, speed /* current units/s */, baseSpeed, pathIndex, dist, pos: Vector3,
          dir: Vector3, radius, alive, slowMul /*1 = none*/, slowTime, reward /*KB*/, cpuDamage /*%*/, isBoss, mesh, color }
enemies.list                                   // ALIVE enemies (array, mutated in place; dead ones removed during update)
enemies.spawn(type, pathIndex, { dist = 0, hpMul = 1, speedMul = 1, offset } = {}) -> Enemy
enemies.damage(enemy, amount, sourceTower = null) -> killed (bool)   // emits enemy:hit / enemy:killed; handles splitting
enemies.slow(enemy, mul /*e.g. 0.5*/, duration)  // strongest slow wins, duration refreshes
enemies.queryRadius(pos, radius, out = []) -> out   // alive enemies whose centre is within radius + enemy.radius (XZ)
enemies.pickTarget(pos, radius, mode = 'first')     // 'first' (least distance to CPU) | 'last' | 'strong' (max hp) | 'close'
enemies.remaining(enemy) -> distance to CPU
enemies.aliveCount()
enemies.update(dt)   // movement along map.samplePath, slow decay, animation, leak detection
enemies.reset()
```
Type matchups: `def.vs = { <towerType>: mul }` scales damage from that floppy type inside `enemies.damage` (TROJAN:
antivirus ×0.6, firewall ×1.5 — "wooden horse: shrugs off scans, burns well"). `enemy.mesh` is an invisible stand-in
(enemies are drawn instanced). Extra event `boss:summon { enemy, children }` (ILOVEYOU mails worms). Mass-mail rule: with
`def.bossSpawn.allPorts` (ILOVEYOU) every other summon batch enters through the other COM port (normal port spawn, dist 0), so
both traces need defence; MELISSA enters via COM2 (wave 5 boss group `path: 1`). Boss leaks scale with remaining hp:
CPU damage = `cpuDamage × (leakMin + (1 - leakMin) × hp/maxHp)` (`leakMin` 0.4), so chip damage counts.
Types (stats in `src/data/enemies.js`): `worm` (fast, low hp, segmented low-poly worm), `trojan` (slow, tanky, low-poly
wooden horse), `macro` (medium; on death splits into 2 `macro_mini`; looks like a floating document page with a "W"-ish glyph),
`macro_mini`, bosses `boss_melissa` (wave 5, macro boss: splits into macros at hp thresholds) and `boss_iloveyou`
(wave 10, giant pink heart/love-letter, spawns worms periodically). Bosses have names shown in UI: `MELISSA.DOC`, `ILOVEYOU.VBS`.
Enemies show a small hp bar (billboard) when damaged, a colour-coded ground halo, a short hit flash (with a lockout, so focus
fire never turns them into white silhouettes) and an icy cyan rim when slowed (they keep their own colour).
Reaching the end of the path: emit `enemy:leak { enemy, damage: enemy.cpuDamage }`, remove (no reward).
Death: emit `enemy:killed { enemy, reward, by }` (economy pays), for bosses also `boss:killed { enemy }`.

### 5.5 `game/waves.js` → `createWaves(ctx)` → `waves`
```
waves.total                // 10
waves.info(n) -> { wave: n, isBoss, bossName, bossType, bonus, groups: [{ type, count, name, isBoss }], threat /*0..1*/,
                   name /*'GIFT HORSE' | generated*/, endless /*bool*/, hpMul, total } | null   // cached; for UI previews
waves.def(n) -> { wave, name, bonus, hpMul, rewardMul, endless, groups: [{ type, count, interval, delay, path, hpMul,
                   speedMul, rewardMul }] }   // raw normalised definition (keeps `path`: the UI reads entry ports from it)
waves.start(n)             // begin spawning wave n (campaign table from src/data/waves.json; n > 10 or endless → generated)
waves.update(dt)
waves.isDone() -> bool     // all groups spawned AND enemies.aliveCount() === 0
waves.reset()              // also clears the def/info caches (endless fresh vs continued runs generate different waves)
```
`waves.json` shape: `{ "waves": [ { "name": "HELLO.WORLD", "bonus": 20, "hpMul": 1, "groups": [ { "type": "worm", "count": 8,
"interval": 0.7, "delay": 0, "path": 0, "hpMul": 1, "speedMul": 1, "rewardMul": 1 } ] } ] }`
(`path`: 0, 1, or `"alt"` = alternate per spawn, `"both"` = spawn on every path). Boss waves emit `boss:spawn { enemy }` when the
boss appears.
**Endless** (`game.mode === 'endless'`), two ways in:
- *Continued* (victory → KEEP GOING → `cmd:continueEndless`): the same run goes on (wave 10, KB, CPU, floppies and stats kept),
  `game.endlessFresh === false`; waves 1-10 were the campaign table, every n > 10 is generated.
- *Fresh* (menu ENDLESS → `cmd:newGame { mode: 'endless' }`): `game.endlessFresh === true` (set by main before
  `resetWorld()`), so waves.js generates every wave from 1 (fresh hp curve `ENDLESS.freshGrowth`^(n-1) = 1.25^(n-1) up to
  wave 10, continuous with the n > 10 curve; names `ENDLESS 01`…`10`).
Generated waves: deterministic per n (and `?seed`), 3-5 mixed groups, hp ×`ENDLESS.base` × `ENDLESS.growth`^(n-10), boss every
5 waves (alternating MELISSA / ILOVEYOU, boss group hp ×`ENDLESS.bossHp`, never below the boss's base hp; from wave 20 on both
bosses, one per port), names counting down the months to the millennium (`04/1999` … `12/1999`, wave 20 = `Y2K.BUG`,
then `Y2K+1` …). `waves.tuning` exposes the constants at runtime for balance probes. Constants live at the top of `src/game/waves.js` (see §9).

### 5.6 `game/towers.js` → `createTowers(ctx)` → `towers`  /  `game/projectiles.js`
```
Tower = { id, type, level /*1..3*/, slot, pos, def /*current level stats*/, range, color, cooldown, target, targeting /*'first'*/,
          kills, damageDealt, invested /*KB*/, mesh, fireRateMul /*heat penalty, read from heat.fireRateMul(pos)*/ }
towers.list
towers.getDef(type, level = 1) -> { name, cost, range, color, ... }  // merged base+level stats
towers.canPlace(type, slot) -> { ok, reason /* 'kb' | 'occupied' | 'invalid' */ }
towers.place(type, slot) -> Tower | null     // economy.spend(cost); sets slot.tower; insertion animation; emits tower:placed
towers.upgradeCost(tower) -> number | null   // null = max level (v3.0)
towers.upgrade(tower) -> bool                // emits tower:upgraded
towers.sellValue(tower) -> number            // floor(invested * GAME.SELL_REFUND)
towers.sell(tower)                           // economy.earn(value,'sell'); frees slot; emits tower:sold
towers.select(tower | null)                  // visual highlight
towers.update(dt)                            // targeting, cooldown (× heat.fireRateMul(pos)), firing, idle animation
towers.reset()

projectiles.fire({ kind, from: Vector3, target /*Enemy|null*/, targetPos /*Vector3, for ground AoE*/, speed, damage,
                   splash /*radius, 0 = single target*/, color, source /*Tower*/, onHit /*(enemy|null, pos) => void*/ })
projectiles.update(dt)    projectiles.reset()
```
`fire` also takes kinds `'burst'` (FIREWALL ring) and `'pulse'` (DEFRAG) and fields `pierce, slow, slowTime, burnDps, burnTime`.
`tower.mesh` is an invisible helper (towers are instanced): never add it to the scene; use `tower.pos`. The `tower:fire`
payload object is reused: read it immediately.
Floppies (stats in `src/data/towers.js`, versions shown as v1.0/v2.0/v3.0):
- **ANTIVIRUS** (blue, 64 KB): single-target, medium range, fast "scan bolt" projectiles. v3: projectile pierces 2 enemies.
- **FIREWALL** (red, 128 KB): short range, area damage burst (flame wall / ring) hitting everything in a radius. v3: burn DoT.
- **DEFRAG** (yellow, 96 KB): pulse every ~0.6 s that slows every virus in range (blocks reshuffle visual). v3: also small damage.
Floppy model: low-poly 3.5" floppy (body in tower colour, metal shutter, label with version text via CanvasTexture) that stands
upright in a drive-bay socket and rotates/aims toward its target; insertion animation (slides down into the slot with click).
Upgrades change the label (v2.0, v3.0) and add visual details (e.g. second disk, antenna, glow).

### 5.7 `game/economy.js` → `createEconomy(ctx)` → `economy`
```
economy.kb (getter = game.kb)
economy.canAfford(n) -> bool
economy.spend(n, reason) -> bool        // fails (false) if not enough; emits kb:change; game.stats.kbSpent
economy.earn(n, reason)                 // emits kb:change; game.stats.kbEarned (not for 'sell'/'debug')
economy.update(dt)                      economy.reset()  // game.kb = GAME.START_KB
economy.onStep(fn) -> off               // fn(dt) once per sim step (autoplay bot); lastInterest / lastBonus / lastEarly
```
Listens: `enemy:killed` → earn(reward,'kill'); `wave:cleared` → earn(bonus,'wave') (+ "interest": 5 % of current KB, max 25, on
cleared waves — shown in UI); `wave:start` → earn(earlySeconds × GAME.EARLY_CALL_KB_PER_SEC, 'early') if > 0.
Kill chains ("CACHE HIT"): 3+ kills each within 0.6 s (sim) of the previous one pay `earn(n - 2, 'combo')`, emit
`combo { n, kb, pos }` and show `fx.text('CACHE HIT xN +MKB')`. Reasons `'sell'`, `'debug'`, `'reset'` never count as earned.

### 5.8 `game/heat.js` → `createHeat(ctx)` → `heat`
```
heat.active -> { spot, level /*0..1*/, overheated } | null
heat.start(spotId?)        // begin heating a random (or given) map.heatSpots entry
heat.coolClick()           // fan clicked: fan spins up (map.setFanSpeed), heat level -= COOL_PER_CLICK, emits fan:cool
heat.fireRateMul(pos) -> number   // (×1.5 while overclocked) × (×0.5 within the overheated spot's radius)
heat.timeToOverheat  heat.pendingStart   // read-only getters (UI / tests)
heat.overclock() -> bool   // OVERCLOCK (cmd:overclock, key T, HUD OC button): waves only, off cooldown
heat.overclockState -> { active, t, tMax, cd, cdMax, ready }   // one reused object: read it, don't keep it
heat.update(dt)            heat.reset()
```
Rules (constants `HEAT` / `OC` at the top of heat.js): wave 2 heats up `FIRST_DELAY` = 3 s into its prep (after the WAVE CLEARED
banner; tutorial tip 3 hooks `heat:start`). From wave 3 heat strikes **mid-wave**, 6-12 s (sim) after `wave:start`. Random spot,
never the same twice in a row, one hot spot at a time. Level rises 0→1 in `RISE_TIME` = 8 s. Warning event at 50 %. At level 1
→ overheated (`heat:overheat`): towers within `spot.radius` get ×0.5 fire rate, smoke (fx.smoke) + red glow
(map.setHeatVisual). Each effective fan click cools `COOL_PER_CLICK` = 0.25 (4 clicks clear a full overheat);
`CLICK_COOLDOWN` = 0.06 s only swallows double-fires (10 Hz mashing all counts). For `FAN_HOLD` = 0.6 s after an
effective click the spot does not heat up (airflow), so 4 clicks always clear it. Cooling to 0 → `heat:cooled`.
OVERCLOCK: every floppy fires ×1.5 for 8 s, cooldown 30 s (from activation); it adds +0.5 heat to the active spot, or starts
one on the spot covering the most floppies. Emits `overclock:on` / `overclock:off` / `overclock:denied`. The bots never use it.

### 5.9 `core/input.js` → `createInput(ctx)` → `input`
Pointer events on `view.renderer.domElement`: hover → `map.setHover(slot)` (mouse only) + cursor style; tap/click (not a drag,
< 10 px, < 500 ms) → `view.raycasterFromClient` → `map.pick`:
slot → `select:slot { slot }`; fan → `fan:click`; nothing → `select:none`. Only active in `prep`/`wave`.
Keyboard: Space/Enter → `cmd:nextWave`, P/Escape → `cmd:pause` (Esc first closes a popup via `select:none` if something is selected,
then drops a keyboard hover), arrows → keyboard hover hops to the nearest bay in that screen direction (perpendicular offset
counts double; an open popup follows via `select:slot`), Enter on a keyboard hover → `select:slot` instead of `cmd:nextWave`,
a mouse move hands the hover back to the pointer,
F → `cmd:speed`, M → `cmd:mute`, 1/2/3 → `cmd:quickbuild { type: 'antivirus'|'firewall'|'defrag', slotId: hoveredSlotId }`,
U → `cmd:upgrade`, S/Delete/Backspace → `cmd:sell`, T → `cmd:overclock`, R → `cmd:setTargeting` (cycle the selected
floppy's mode). Ignore keys while typing in an input element.
`input.hoveredSlot` (getter).

### 5.10 `ui/ui.js` → `createUI(ctx)` → `ui`
DOM overlay inside `#ui` (`pointer-events: none` by default; interactive elements need class `ui-hit` or their own
`pointer-events: auto`). Imports `./ui.css`. All text via `t()` from `core/i18n.js` with strings in `src/data/strings.js`
(EN + IT). DOS look: monospace, phosphor green on black, box-drawing borders, blinking cursor; Win9x touches for errors.
```
ui.update(dt, t)    // per frame: HUD values, popup positions (view.worldToScreen), countdown
```
Screens & widgets:
- **Boot** (on `boot`): BIOS POST text animation (memory count, drive detection), "Press any key"; first key/tap calls
  `audio.unlock()` then shows **Menu** (emit `cmd:menu`).
- **Menu** (on `menu`): DOS prompt `C:\> FLOPPY.EXE`, items: START (`cmd:newGame {mode:'campaign'}`), ENDLESS (locked until
  `settings.endlessUnlocked`), HOW TO PLAY, HIGH SCORES (core/save.js), SETTINGS (sound, music/sfx volume, language EN/IT, CRT,
  quality → `cmd:setting { key, value }`), CREDITS. Board visible behind (attract mode).
- **HUD** (prep/wave): top bar `C:\> WAVE 03/10  MEM 512KB  CPU 87%` + buttons [RUN ▶ / next wave countdown] [OC [T]
  overclock, waves only, cooldown fill] [x1/x2] [II] [♪] [⛶ fullscreen]. CPU % colour shifts amber/red; KB flashes on change;
  bottom hint line. Next-wave preview (prep): `NEXT: WAVE 03 · GIFT HORSE`, entry ports `VIA ▶ COM1 + COM2` (from
  `waves.def(n).groups[].path`), NEW badges for first-seen ports/viruses and a NEW VIRUS banner from wave 2.
- **Build popup** (on `selection:change` with slot): three floppy cards (name, cost, one-line desc, key 1/2/3), disabled when
  unaffordable; hover → `ui:previewRange { slotId, type }`; click → `cmd:build { type, slotId }`. Anchored to the slot.
- **Tower panel** (selection is a tower): name + version, stats, kills, targeting mode cycle (`cmd:setTargeting`), UPGRADE
  (cost; `cmd:upgrade { towerId }`), SELL (value; `cmd:sell { towerId }`).
- **Banners**: wave start (`wave:start`; boss variant with boss name), wave cleared (+bonus), heat warning (`heat:start`,
  `heat:overheat`: "WARNING: RAM 92°C — CLICK THE FAN!"), `build:failed` (reason 'kb' → DOS error "Not enough memory"),
  next-wave preview in prep (`waves.info`).
- **Tutorial**: 3 short hints on the first game (`settings.tutorialDone`); not restarted by a restored run
  (`game:new { restored: true }`). While `game.prepHold` is true the countdown blinks and the hint line says
  'Insert a floppy to start the countdown'.
- **Pause** overlay (on `pause`/`resume`): RESUME, RESTART (`cmd:newGame`), QUIT TO MENU (`cmd:menu`), settings.
- **Game over** (on `gameover`): full-screen BSOD ("A fatal exception 0E has occurred at 0028:C0011E36…", waves survived =
  `payload.survived`, score, stats, a matchup tip for the virus type that dealt the last CPU hit, initials entry for the local
  leaderboard if high score; skipped with a 'DEBUG RUN' tag when `payload.tainted`). Then a row of buttons (no 'any key'):
  **[R] RESTORE LAST KNOWN GOOD CONFIGURATION (WAVE nn)** → `cmd:restoreLKG` (only when `game.lkg`; default focus),
  **[ENTER] RETRY** → `cmd:newGame { mode }`, **[ESC] MENU** → `cmd:menu`. A restore shows the banner
  'LAST KNOWN GOOD CONFIGURATION RESTORED'.
- **Victory** (on `victory`): Win9x shutdown style (black, orange "It's now safe to turn off your computer."), stats, score,
  leaderboard, buttons: **KEEP GOING: ENDLESS MODE** (`cmd:continueEndless`: the same run continues at wave 11), MENU.

### 5.11 `audio/audio.js` → `export const audio`
Everything synthesized with WebAudio (oscillators, noise buffers, filters, FM). No audio files.
```
audio.unlock()                 // resume/create AudioContext on a user gesture (safe to call repeatedly)
audio.sfx(name, { volume = 1, pitch = 1, pan = 0 } = {})   // throttled per name
audio.music(track | null)      // 'menu' | 'prep' | 'wave' | 'boss' | 'victory' | 'gameover' | null; crossfades
audio.setMuted(bool)  audio.muted  audio.setVolumes(music, sfx)
audio.bindEvents(events, ctx)  // subscribe to game events and play the right sounds/music (central sound mapping)
```
SFX names: `boot` (POST beep), `click`, `hover`, `error` (PC speaker double beep), `floppyInsert` (mechanical clunk + motor +
seek grind), `upgrade`, `sell`, `shootAntivirus`, `shootFirewall`, `defragPulse`, `hit`, `kill`, `split`, `leak`, `cpuHit`,
`bossSpawn`, `bossKill`, `modem` (dial-up handshake, 1.5–2.5 s, plays at `wave:start`), `modemBlip` (short modem chirp),
`mailChime` (ILOVEYOU mails a batch of worms), `waveClear`, `overheat`, `fanSpin`, `bsod`, `victory`, `tick` (last 3 s of
prep), `kbGain`. `audio.music(track, { transpose /*semitones*/, level /*skips song sections with a higher minLevel*/ })`.
Music: tracker-style chiptune / AdLib-FM flavoured loops per track, tempo increases for boss.

## 6. Events (name → payload)

Gameplay (emitted by the owning module):
```
boot {}                         menu {}                          game:new { mode, restored? /*true after cmd:restoreLKG*/ }
phase:change { from, to }       pause {}   resume {}             speed:change { speed }
wave:prep { wave, duration, info }        wave:start { wave, isBoss, info, earlySeconds }
wave:cleared { wave, bonus, perfect }
victory  { wave, mode, stats, score, survived, tainted }
gameover { wave, mode, stats, score, survived, tainted }
   // survived = waves cleared (victory: wave, BSOD: wave - 1) - use it for 'waves survived' and the leaderboard;
   // tainted = ?debug / ?turbo>1 / ?autoplay run: main skips bestWave/endlessUnlocked, the UI skips the leaderboard
enemy:spawn { enemy }           enemy:hit { enemy, damage, by }  enemy:killed { enemy, reward, by }
enemy:split { parent, children } enemy:leak { enemy, damage }    boss:spawn { enemy }   boss:killed { enemy }
cpu:damage { amount, cpu, enemy }   boss:summon { enemy, children }   hover:change { slot }
tower:placed { tower }  tower:upgraded { tower }  tower:sold { tower, refund }  tower:fire { tower, target }
tower:targeting { tower, mode }
kb:change { kb, delta, reason }
heat:start { spot }  heat:warning { spot, level }  heat:overheat { spot }  heat:cooled { spot }  fan:cool { level }
overclock:on { spot, time, mul }   overclock:off {}   overclock:denied { reason /*'phase'|'cooldown'*/, cd }
combo { n, kb, pos }            // CACHE HIT: >= 3 kills within 0.6 s of each other pays n - 2 KB (pos is reused: read it now)
build:failed { type, slot, reason }      upgrade:failed { tower, reason }
selection:change { selected }   // { kind:'slot', slot } | { kind:'tower', tower } | null
settings:change { key, value }
```
Commands (UI/input → main):
```
cmd:menu  cmd:newGame { mode }  cmd:nextWave  cmd:pause  cmd:speed  cmd:mute
cmd:continueEndless             // victory only: same run, mode -> 'endless', endlessFresh false, prep for wave 11
cmd:restoreLKG                  // gameover only: rebuild the Last Known Good snapshot and replay that wave's prep
cmd:overclock                   // heat.overclock() (waves only, 30 s cooldown)
cmd:build { type, slotId }  cmd:quickbuild { type, slotId? }  cmd:upgrade { towerId? }  cmd:sell { towerId? }
cmd:setTargeting { towerId, mode }   cmd:setting { key, value /* key 'toggleMute' flips settings.muted */ }
select:slot { slot }  select:tower { tower }  select:none  fan:click  ui:previewRange { slotId, type|null }
```
Game-state fields owned by main.js (read-only for everyone else): `game.mode`, `game.endlessFresh` (fresh endless run from
the menu), `game.lkg` (`{ wave }` = the wave a RESTORE replays, or null), `game.prepHold` (first-game wave-1 countdown on hold),
`game.stats.restores` (score ×0.8 each).
**Last Known Good Configuration**: main snapshots `{ mode, endlessFresh, wave, kb, cpu, stats, towers: [{ type, level, slotId,
targeting }] }` in `startWave()` before `game.wave += 1`. `cmd:restoreLKG` resets the world, emits `game:new { restored: true }`,
re-places/upgrades the floppies through `towers.place/upgrade` (KB settled through `economy.earn/spend(…, 'debug')`, so stats
are untouched), restores CPU, wave and stats, increments `stats.restores` and enters prep. The snapshot is kept, so the same wave
can be restored again; `cmd:newGame` / `cmd:menu` clear it.

## 7. URL parameters (testing)
`?debug=1` (K +500KB, J kill all, H overheat, `?wave=N` start at wave N), `?autostart=1` (skip boot/menu), `?mode=endless`,
`?speed=2`, `?turbo=N` (test-only sim speed-up, max 20), `?mute=1` (mutes this session only, never saved), `?seed=N`,
`?autoplay=1|greedy|idle` (bot that builds and calls waves — `src/core/autoplay.js`; greedy = antivirus only, idle = never
builds), `?quiet=1` (no bot logging), `?quality=low|high`, `?noattract=1` (static board behind the menu: no attract demo).
Attract demo (main.js): on every menu entry 5 floppies (v1-v3) fire at a trickle of worms / macros / trojans (one every 1.1 s,
at most 14, hp ×0.8, no reward); only enemies, towers, projectiles and fx step, kills / leaks count for nothing and audio keeps
tower/enemy/boss/kb/... events silent while `game.phase === 'menu'`; `newGame()` clears it. `?debug=1&photo=1`: showcase board for the cover/GIF (implies
autostart; HUD hidden, 9 floppies v1-v3, every virus + both bosses with hp ×2000 / speed ×0.15 walking forever, no CPU damage,
P freezes the sim while rendering continues). Runs with `?debug`, `?turbo>1` or `?autoplay` are **tainted**: no bestWave /
endless unlock / leaderboard entry. Without WebGL the page shows a BIOS-blue 'VGA ADAPTER NOT FOUND' message
(`t('boot.noWebgl')`) and nothing else boots.
Balance: `node tests/balance.mjs --seeds 1,2,3 --mode normal|greedy|idle` (against a `vite preview` copy via `BASE_URL`).
Cover art: `node tools/cover.mjs <baseUrl>` renders photo mode on the real GPU with the menu title over it →
`docs/media/cover.png` (1260x1000) + `cover-630x500.png` (itch.io).

## 8. Quality bar
- No per-frame allocations in hot paths (reuse vectors), pool meshes, share geometries/materials, dispose on reset when needed.
- Every visual must read clearly at 960x600: high contrast silhouettes, emissive accents for bloom, consistent palette (config.js).
- Never block on audio; never throw on missing optional APIs; guard localStorage; handle WebGL context loss gracefully.
- Mobile: tap targets ≥ 40 px, no hover dependency, landscape layout, `touch-action: none` on canvas.
- Code style: ES modules, 2-space indent, single quotes, semicolons, small comments only where useful.

## 9. Cross-module decisions (binding)
- **CRT look is split**: the UI module owns a full-screen CSS overlay `.crt-overlay` (fine scanlines, faint RGB mask, subtle
  flicker, rounded dark corners) that sits above canvas **and** HUD so DOS text looks CRT too; toggled by `settings.crt`
  (listen to `settings:change`). The render module's post chain does bloom, slight barrel curvature, chromatic RGB shift,
  noise grain, vignette, flash/glitch — **no scanlines in WebGL** (avoids double scanlines).
- **Balance (tuned at integration with the autoplay bots — source of truth is the data files)**:
  - Towers v1: ANTIVIRUS 64 KB, dmg 10, 1.5 shots/s, range 3.0. FIREWALL 128 KB, dmg 20 to all within radius 2.2,
    0.85 bursts/s (v3 burn 8 dps × 2 s). DEFRAG 96 KB, pulse every 0.6 s, slow ×0.5 for 1.0 s, range 2.6 (v3: 8 dmg/pulse).
    Upgrades: v2 cost ≈ 0.65× base (AV 42, FW 84, DF 62: a cheap, tempting first step), v3 cost ≈ 1.5× base.
    v2 highlights: FIREWALL dmg 28; DEFRAG slow ×0.38, range 3.0.
  - Viruses: worm hp 26 spd 2.4 reward 4 (×1.25 in waves 1-5) cpu 4 · trojan hp 150 spd 0.85 reward 15 cpu 12, vs antivirus
    ×0.6 / firewall ×1.5 · macro hp 60 spd 1.4 reward 7 cpu 7 (splits into 2× macro_mini hp 22 reward 3 cpu 3) ·
    boss_melissa hp 1150 spd 0.55 reward 150 cpu 40 (COM2; splits 3 macros at 66 % / 33 %) · boss_iloveyou hp 4200
    (wave 10: ×3.75 × group ×0.62 ≈ 9765) spd 0.45 reward 400 cpu 45, mails 2 worms every 3.5 s alternating COM1/COM2
    (`allPorts`); both bosses `leakMin` 0.4. Start KB 200.
    Wave hp multipliers 1 / 1 / 1.1 / 1.3 / 1.0 / 3.6 / 4.5 / 6.85 / 7.2 / 3.75 (wave 3: 3 trojans every 4 s; wave 7: 24 worms
    ×1.1 speed; wave 8: trojans every 1.8 s). Wave names (HELLO.WORLD … ILOVEYOU) live in waves.json.
  - Targets (bots, `tests/balance.mjs`): normal bot wins on >= 2/3 seeds with CPU ≈ 45-75 % and wave 10 as the hardest
    wave, greedy (antivirus only) BSODs at waves 6-8, idle BSODs by wave 3.
  - Endless (`ENDLESS` at the top of `src/game/waves.js`): continued runs n > 10: hp ×`base` (6.4) × `growth` (1.27)^(n-10);
    fresh runs (menu) also generate waves 1-10 with hp ×`freshGrowth` (1.25)^(n-1); boss every 5 waves with group hp
    ×`bossHp` (0.25, never below the boss's base hp), both bosses from wave 20 (`Y2K.BUG`) on. Bots: a fresh endless run
    dies around waves 16-18, a continued one around 17-19.
- **1999 campaign (waves 11-20, `GAME.TOTAL_WAVES` = 20)**: SCANDISK (long-range heavy bolt, pierce at v3) and FORMAT C:
  (slow purple area blast) have `unlockWave: 11` (`towers.isLocked`, `canPlace` reason `'locked'`; hotkeys 4/5). New viruses:
  MICHELANGELO (`dormant`: slow until first hit or 45 % of the path, then ×3.4 speed, `enemy:wake`), HAPPY99 (splits into 3
  worms), CIH (`armor` 5: flat reduction per hit before `vs`), boss Y2K.BUG (wave 20, splitAt drops CIH, summons HAPPY99).
  Wave hp ×6.75 … ×12.5 for waves 11-19, MAILBOMB (15) brings MELISSA + ILOVEYOU, Y2K.BUG group ×0.36. Bots: normal wins
  3/3 seeds at 36-61 % CPU with wave 20 the hardest. Endless continues from wave 21 (`ENDLESS.base` 14.5).
- **Heights**: board y=0, traces y≈0.01, slots/sockets top ≈ 0.15, floppy turret top ≈ 1.0, enemies centre y≈0.35 (bosses ≈0.8),
  projectiles y≈0.6, floating text y≈1.2.
- **Selection/hover colours**: hover = phosphor green outline, selected = bright phosphor + animated brackets, invalid = red.
