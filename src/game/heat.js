// Overheat mechanic (CONTRACTS §5.8). A board component heats up; clicking the CPU fan cools it.
// Overheated spot -> floppies within spot.radius fire at x0.5 rate (towers read heat.fireRateMul(pos)).
// Timing: wave 2 heats up 3 s into its prep (tutorial moment); from wave 3 heat strikes MID-WAVE (6-12 s after the
// wave starts), so the fan competes for attention with building. OVERCLOCK (key T / HUD button, waves only): every
// floppy fires x1.5 for 8 s, but the board takes +50 % heat on the spot that covers the most floppies.
import * as THREE from 'three';

export const HEAT = {
  RISE_TIME: 8,         // seconds (sim) from 0 to 1
  WARN_AT: 0.5,         // heat:warning threshold
  REARM_BELOW: 0.35,    // warning can fire again after cooling below this
  COOL_PER_CLICK: 0.25, // 4 clicks clear a full overheat
  CLICK_COOLDOWN: 0.06, // seconds (sim) between effective clicks (only swallows double-fires: 10 Hz mashing all counts)
  FAN_HOLD: 0.6,        // seconds (sim) after an effective click during which the spot does not heat up (airflow)
  PENALTY: 0.5,         // fire-rate multiplier inside an overheated spot
  FAN_BOOST: 3.5,       // fan speed added per click
  FAN_MAX: 8,
  FAN_DECAY: 1.6,       // exponential decay rate back to 1
  SMOKE_EVERY: 0.4,     // seconds between smoke puffs when overheated
  WISP_EVERY: 1.1,      // light wisps when getting hot (level > 0.7)
  FIRST_WAVE: 2,        // first heat: during the prep of this wave...
  FIRST_DELAY: 3,       // ...this many sim seconds in (after the WAVE CLEARED banner)
  MID_WAVE_FROM: 3,     // from this wave on, heat starts during the wave...
  MID_DELAY: 6,         // ...MID_DELAY + rnd * MID_DELAY_RND sim seconds after wave:start
  MID_DELAY_RND: 6,
};

// OVERCLOCK ability (cmd:overclock).
export const OC = {
  MUL: 1.5,        // fire-rate multiplier for every floppy
  TIME: 8,         // seconds (sim) of overclock
  COOLDOWN: 30,    // seconds (sim) from activation until it can be used again
  HEAT: 0.5,       // heat level added to the hot spot
  COLOR: 0xff6a2a, // FX colour (activation rings, sparks on the floppies)
  SPARK_EVERY: 0.12,
};

export function createHeat(ctx) {
  const { events, game } = ctx;
  const rnd = () => (ctx.rng && ctx.rng.next ? ctx.rng.next() : Math.random());

  let active = null;      // { spot, level, overheated }
  let lastSpotId = null;
  let warned = false;
  let lastClickTime = -1e9;
  let fanSpeed = 1;
  let smokeTimer = 0;
  let wispTimer = 0;
  let fallbackSpot = null;
  let pendingStart = 0;   // sim seconds until the scheduled heat starts (0 = none); paused while a spot is hot
  let ocT = 0;            // overclock time left
  let ocCd = 0;           // overclock cooldown left
  let ocSpark = 0;
  let ocSparkIdx = 0;
  const smokePos = new THREE.Vector3();
  const fxPos = new THREE.Vector3();
  const ocState = { active: false, t: 0, tMax: OC.TIME, cd: 0, cdMax: OC.COOLDOWN, ready: true };

  const map = () => ctx.map || {};

  function spots() {
    const list = map().heatSpots;
    if (Array.isArray(list) && list.length) return list;
    // No heat spots (map stub): fall back to the CPU so the mechanic stays testable.
    const cpu = map().cpu;
    if (!cpu || !cpu.pos) return [];
    if (!fallbackSpot) fallbackSpot = { id: 'cpu', name: 'CPU', pos: cpu.pos, radius: Math.max(2.5, (cpu.radius || 1) * 2.5) };
    return [fallbackSpot];
  }

  function inside(spot, pos) {
    if (!spot || !spot.pos || !pos) return false;
    const dx = pos.x - spot.pos.x;
    const dz = pos.z - spot.pos.z;
    const r = spot.radius || 0;
    return dx * dx + dz * dz <= r * r;
  }

  function towerList() {
    const list = ctx.towers && ctx.towers.list;
    return Array.isArray(list) ? list : [];
  }

  // The spot whose radius covers the most floppies (overclock heats where it hurts); ties broken at random.
  function busiestSpot() {
    const list = spots();
    const towers = towerList();
    let best = null;
    let bestN = -1;
    let ties = 0;
    for (const s of list) {
      let n = 0;
      for (const t of towers) if (t && inside(s, t.pos)) n++;
      if (n > bestN) { bestN = n; best = s; ties = 1; }
      else if (n === bestN && rnd() * ++ties < 1) best = s;
    }
    return best;
  }

  function setVisual(spot, level, overheated) {
    if (!spot) return;
    try { map().setHeatVisual(spot.id, level, overheated); } catch (err) { /* stub */ }
  }

  function setFan(mult) {
    fanSpeed = mult;
    try { map().setFanSpeed(mult); } catch (err) { /* stub */ }
  }

  function puff(spot, heavy) {
    const fx = ctx.fx;
    if (!fx || typeof fx.smoke !== 'function' || !spot || !spot.pos) return;
    const r = Math.min(spot.radius || 1, 1.6) * 0.45;
    const a = rnd() * Math.PI * 2;
    smokePos.set(spot.pos.x + Math.cos(a) * r * rnd(), (spot.pos.y || 0) + 0.35, spot.pos.z + Math.sin(a) * r * rnd());
    try {
      fx.smoke(smokePos, heavy ? { color: 0x3a3a3a, count: 5 } : { color: 0x8a8a8a, count: 2 });
    } catch (err) { /* stub */ }
  }

  // Overclock FX: a ring under every floppy on activation, then sparks hopping across the floppies' tops.
  function ocRings() {
    const fx = ctx.fx;
    if (!fx || typeof fx.ring !== 'function') return;
    try {
      for (const t of towerList()) {
        if (!t || !t.pos) continue;
        fxPos.set(t.pos.x, 0.02, t.pos.z);
        fx.ring(fxPos, 0.85, OC.COLOR, { life: 0.5, width: 0.07 });
      }
    } catch (err) { /* stub */ }
  }

  function ocSparks(dt) {
    const fx = ctx.fx;
    const towers = towerList();
    if (!fx || typeof fx.spark !== 'function' || !towers.length) return;
    ocSpark -= dt;
    if (ocSpark > 0) return;
    ocSpark += OC.SPARK_EVERY;
    ocSparkIdx = (ocSparkIdx + 1) % towers.length;
    const t = towers[ocSparkIdx];
    if (!t || !t.pos) return;
    fxPos.set(t.pos.x + (rnd() - 0.5) * 0.3, 0.95 + rnd() * 0.15, t.pos.z + (rnd() - 0.5) * 0.3);
    try { fx.spark(fxPos, OC.COLOR); } catch (err) { /* stub */ }
  }

  function cool() {
    const spot = active.spot;
    active = null;
    warned = false;
    setVisual(spot, 0, false);
    events.emit('heat:cooled', { spot });
  }

  const heat = {
    get active() { return active; },
    get fanSpeed() { return fanSpeed; },
    // Display temperature for the UI banner ("RAM 92°C"): 40 °C idle .. 95 °C overheated.
    get temperature() { return active ? Math.round(40 + active.level * 55) : 40; },
    // Seconds until overheat at the current rate (Infinity if not heating / already overheated).
    get timeToOverheat() {
      if (!active || active.overheated) return active ? 0 : Infinity;
      return (1 - active.level) * HEAT.RISE_TIME;
    },
    // Sim seconds until the scheduled heat starts (0 = nothing scheduled). Read-only, for UI/tests.
    get pendingStart() { return pendingStart; },
    // { active, t, tMax, cd, cdMax, ready } - one reused object (read it, don't keep it).
    get overclockState() {
      ocState.active = ocT > 0;
      ocState.t = ocT;
      ocState.cd = ocCd;
      ocState.ready = ocCd <= 0;
      return ocState;
    },

    start(spotId) {
      const list = spots();
      if (!list.length) return null;
      let spot = spotId != null ? list.find((s) => s.id === spotId) : null;
      if (!spot) {
        const pool = list.length > 1 ? list.filter((s) => s.id !== lastSpotId) : list;
        spot = pool[Math.floor(rnd() * pool.length) % pool.length];
      }
      if (active && active.spot !== spot) setVisual(active.spot, 0, false);
      active = { spot, level: 0, overheated: false };
      lastSpotId = spot.id;
      warned = false;
      smokeTimer = 0;
      wispTimer = 0;
      setVisual(spot, 0, false);
      events.emit('heat:start', { spot });
      return active;
    },

    coolClick() {
      const now = game.time || 0;
      if (now - lastClickTime < HEAT.CLICK_COOLDOWN) return false;
      lastClickTime = now;
      setFan(Math.min(HEAT.FAN_MAX, fanSpeed + HEAT.FAN_BOOST));
      let level = 0;
      if (active) {
        active.level = Math.max(0, active.level - HEAT.COOL_PER_CLICK);
        level = active.level;
        if (active.level < HEAT.REARM_BELOW) warned = false;
        if (active.level <= 1e-6) cool();
        else setVisual(active.spot, active.level, active.overheated);
      }
      events.emit('fan:cool', { level });
      return true;
    },

    // OVERCLOCK: only during a wave and off cooldown. Returns true when it fired.
    overclock() {
      if (game.phase !== 'wave' || ocCd > 0) {
        events.emit('overclock:denied', { reason: game.phase !== 'wave' ? 'phase' : 'cooldown', cd: ocCd });
        return false;
      }
      ocT = OC.TIME;
      ocCd = OC.COOLDOWN;
      ocSpark = 0;
      if (!active) {
        const spot = busiestSpot();
        heat.start(spot ? spot.id : undefined);
      }
      if (active && !active.overheated) {
        // update() raises heat:warning / heat:overheat on the next step if this crosses a threshold.
        active.level = Math.min(1, active.level + OC.HEAT);
        setVisual(active.spot, active.level, active.overheated);
      }
      ocRings();
      events.emit('overclock:on', { spot: active ? active.spot : null, time: OC.TIME, mul: OC.MUL });
      return true;
    },

    fireRateMul(pos) {
      const oc = ocT > 0 ? OC.MUL : 1;
      if (!active || !active.overheated || !pos) return oc;
      return inside(active.spot, pos) ? oc * HEAT.PENALTY : oc;
    },

    // True if pos would be penalised by the current hot spot once it overheats (UI warning on towers in the zone).
    inHotZone(pos) {
      if (!active || !pos) return false;
      return inside(active.spot, pos);
    },

    update(dt) {
      if (fanSpeed !== 1) {
        const next = 1 + (fanSpeed - 1) * Math.exp(-dt * HEAT.FAN_DECAY);
        setFan(Math.abs(next - 1) < 0.05 ? 1 : next);
      }
      if (ocT > 0) {
        ocT -= dt;
        ocSparks(dt);
        if (ocT <= 0) {
          ocT = 0;
          events.emit('overclock:off', {});
        }
      }
      if (ocCd > 0) ocCd = Math.max(0, ocCd - dt);
      if (pendingStart > 0 && !active) {
        pendingStart -= dt;
        if (pendingStart <= 0) { pendingStart = 0; heat.start(); }
      }
      if (!active) return;
      const a = active;
      // While the player keeps clicking, the airflow holds the temperature: 4 quick clicks always clear an overheat.
      const rise = (game.time || 0) - lastClickTime < HEAT.FAN_HOLD ? 0 : dt / HEAT.RISE_TIME;
      if (!a.overheated) {
        a.level = Math.min(1, a.level + rise);
        if (!warned && a.level >= HEAT.WARN_AT) {
          warned = true;
          events.emit('heat:warning', { spot: a.spot, level: a.level });
        }
        if (a.level >= 1) {
          a.overheated = true;
          smokeTimer = 0;
          events.emit('heat:overheat', { spot: a.spot });
        }
      } else {
        // Stays overheated until fully cooled; partially cooled spots creep back up.
        a.level = Math.min(1, a.level + rise);
      }
      setVisual(a.spot, a.level, a.overheated);

      if (a.overheated) {
        smokeTimer -= dt;
        if (smokeTimer <= 0) { smokeTimer += HEAT.SMOKE_EVERY; puff(a.spot, true); }
      } else if (a.level > 0.7) {
        wispTimer -= dt;
        if (wispTimer <= 0) { wispTimer += HEAT.WISP_EVERY; puff(a.spot, false); }
      }
    },

    reset() {
      if (active) setVisual(active.spot, 0, false);
      for (const s of spots()) setVisual(s, 0, false);
      active = null;
      lastSpotId = null;
      warned = false;
      lastClickTime = -1e9;
      fallbackSpot = null;
      pendingStart = 0;
      ocT = 0;
      ocCd = 0;
      ocSpark = 0;
      ocSparkIdx = 0;
      setFan(1);
    },
  };

  // Wave 2: the first heat comes 3 s into the prep, after the WAVE CLEARED banner (tutorial tip 3 hooks heat:start).
  events.on('wave:prep', ({ wave } = {}) => {
    if (wave !== HEAT.FIRST_WAVE || active) return;
    if (game.phase !== 'prep') return;
    pendingStart = HEAT.FIRST_DELAY;
  });
  // Wave 3+: heat strikes mid-wave, while the player is busy. One hot spot at a time.
  events.on('wave:start', ({ wave } = {}) => {
    if (!(wave >= HEAT.MID_WAVE_FROM) || active) return;
    pendingStart = HEAT.MID_DELAY + rnd() * HEAT.MID_DELAY_RND;
  });
  events.on('cmd:overclock', () => { heat.overclock(); });

  return heat;
}
