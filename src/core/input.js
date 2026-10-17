// Pointer (mouse / touch / pen) + keyboard input. Turns raw DOM input into the game commands of CONTRACTS §5.9.
// Extra keys: T = OVERCLOCK (cmd:overclock), R = cycle the selected floppy's targeting mode, arrows = move a keyboard
// hover between drive bays (Enter opens the hovered bay; 1/2/3, U and S then act on it), so the game plays mouse-free.
// Tap-vs-drag and pointer-ownership patterns adapted from moon-zombies/touch-controls.js; ground picking adapted
// from Giocomobile/src/royale/ui.js (groundAt).
import * as THREE from 'three';

const TAP_SLOP = 10;        // px a pointer may travel and still count as a tap
const TAP_TIME = 500;       // ms max press duration for a tap
const SNAP_MOUSE = 0.55;    // world units: fallback slot snapping when map.pick misses (mouse)
const SNAP_TOUCH = 0.95;    // fat-finger tolerance on touch / pen
const TOWER_PICK_HEIGHTS = [0, 0.45, 0.9]; // tall floppies are pickable along their body, not only at the base
const QUICKBUILD = { 1: 'antivirus', 2: 'firewall', 3: 'defrag' };
const TARGETING = ['first', 'last', 'strong', 'close'];

const inPlayPhase = (p) => p === 'prep' || p === 'wave';

function isTypingTarget(el) {
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

function isButtonTarget(el) {
  if (!el || !el.closest) return false;
  return !!el.closest('button, a[href], [role="button"], [role="menuitem"], summary');
}

export function createInput(ctx) {
  const { events, game } = ctx;
  const el = ctx.view && ctx.view.renderer && ctx.view.renderer.domElement;

  const pointers = new Map(); // pointerId -> { x, y, t, moved, type, button }
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  let hoveredSlot = null;
  let hoveredKind = null;     // 'slot' | 'fan' | 'cpu' | null
  let hoverX = 0;
  let hoverY = 0;
  let hoverPending = false;
  let hasMouse = false;       // a mouse pointer is currently over the canvas
  let kbHover = false;        // the hover was set by the arrow keys (a mouse move hands it back to the pointer)
  let enabled = true;
  const disposers = [];

  const listen = (target, name, fn, opts) => {
    if (!target || !target.addEventListener) return;
    target.addEventListener(name, fn, opts);
    disposers.push(() => target.removeEventListener(name, fn, opts));
  };

  // ------------------------------------------------------------------------------------------
  // Picking
  // ------------------------------------------------------------------------------------------
  function raycaster(clientX, clientY) {
    try { return ctx.view.raycasterFromClient(clientX, clientY) || null; } catch (err) { return null; }
  }

  // Nearest slot to the ray, testing the board plane and (for occupied slots) the floppy body height.
  function snapSlot(ray, tolerance) {
    const slots = ctx.map && ctx.map.slots;
    if (!ray || !slots || !slots.length) return null;
    let best = null;
    let bestD = tolerance * tolerance;
    for (let i = 0; i < TOWER_PICK_HEIGHTS.length; i++) {
      const h = TOWER_PICK_HEIGHTS[i];
      plane.constant = -h;
      if (!ray.intersectPlane(plane, hit)) continue;
      for (let j = 0; j < slots.length; j++) {
        const s = slots[j];
        if (!s || !s.pos || (h > 0 && !s.tower)) continue;
        const dx = s.pos.x - hit.x;
        const dz = s.pos.z - hit.z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = s; }
      }
    }
    plane.constant = 0;
    return best;
  }

  function nearFan(ray, scale) {
    const fan = ctx.map && ctx.map.fan;
    if (!ray || !fan || !fan.pos) return false;
    plane.constant = -(fan.pos.y || 0);
    const ok = ray.intersectPlane(plane, hit);
    plane.constant = 0;
    if (!ok) return false;
    const r = (fan.radius || 0.8) * scale;
    const dx = fan.pos.x - hit.x;
    const dz = fan.pos.z - hit.z;
    return dx * dx + dz * dz <= r * r;
  }

  // -> { kind: 'slot', slot } | { kind: 'fan' } | { kind: 'cpu' } | null
  function pickAt(clientX, clientY, pointerType = 'mouse') {
    const rc = raycaster(clientX, clientY);
    if (!rc) return null;
    let res = null;
    try { res = ctx.map.pick(rc) || null; } catch (err) { res = null; }
    if (res && res.kind === 'slot' && res.slot) return res;
    if (res && res.kind === 'fan') return res;
    const touchy = pointerType !== 'mouse';
    const ray = rc.ray;
    // Fat-finger assist: the fan is the most important tap target during overheat.
    if (nearFan(ray, touchy ? 1.35 : 1.0)) return { kind: 'fan' };
    const slot = snapSlot(ray, touchy ? SNAP_TOUCH : SNAP_MOUSE);
    if (slot) return { kind: 'slot', slot };
    return res; // { kind: 'cpu' } or null
  }

  // ------------------------------------------------------------------------------------------
  // Hover (mouse only)
  // ------------------------------------------------------------------------------------------
  function setHover(slot, kind) {
    if (slot !== hoveredSlot) {
      hoveredSlot = slot;
      try { ctx.map.setHover(slot); } catch (err) { /* stub */ }
      events.emit('hover:change', { slot, kind });
    }
    hoveredKind = kind;
    if (el) el.style.cursor = kind === 'slot' || kind === 'fan' ? 'pointer' : '';
  }

  function clearHover() {
    hoverPending = false;
    kbHover = false;
    if (hoveredSlot || hoveredKind) setHover(null, null);
  }

  function refreshHover() {
    hoverPending = false;
    if (kbHover && enabled && inPlayPhase(game.phase)) return; // keep the keyboard's bay until the mouse moves
    if (!enabled || !hasMouse || !inPlayPhase(game.phase)) { clearHover(); return; }
    const res = pickAt(hoverX, hoverY, 'mouse');
    if (res && res.kind === 'slot') setHover(res.slot, 'slot');
    else setHover(null, res ? res.kind : null);
  }

  function scheduleHover() {
    if (hoverPending) return;
    hoverPending = true;
    // Coalesce pointermove bursts into one raycast per frame.
    (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : setTimeout)(refreshHover);
  }

  // ------------------------------------------------------------------------------------------
  // Tap
  // ------------------------------------------------------------------------------------------
  function tap(clientX, clientY, pointerType = 'mouse') {
    if (!enabled || !inPlayPhase(game.phase)) return null;
    const res = pickAt(clientX, clientY, pointerType);
    if (res && res.kind === 'slot') events.emit('select:slot', { slot: res.slot });
    else if (res && res.kind === 'fan') events.emit('fan:click', {});
    else events.emit('select:none', {});
    return res;
  }

  function onPointerDown(e) {
    if (!enabled) return;
    if (e.pointerType === 'mouse') {
      hasMouse = true;
      hoverX = e.clientX; hoverY = e.clientY;
      if (e.button === 2) { // right click = cancel selection
        if (inPlayPhase(game.phase) && game.selected) events.emit('select:none', {});
        return;
      }
      if (e.button !== 0) return;
    }
    // A second finger turns the gesture into a pinch/pan: no taps from any finger.
    if (pointers.size > 0) for (const p of pointers.values()) p.moved = true;
    pointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY, t: performance.now(), moved: pointers.size > 0, type: e.pointerType || 'mouse',
    });
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (e.pointerType !== 'mouse' && e.cancelable) e.preventDefault();
  }

  function onPointerMove(e) {
    const p = pointers.get(e.pointerId);
    if (p && !p.moved) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (dx * dx + dy * dy > TAP_SLOP * TAP_SLOP) p.moved = true;
    }
    if (e.pointerType === 'mouse') {
      hasMouse = true;
      kbHover = false;
      hoverX = e.clientX; hoverY = e.clientY;
      scheduleHover();
    }
  }

  function onPointerUp(e) {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    try { if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (!p || p.moved) return;
    if (performance.now() - p.t > TAP_TIME) return;
    tap(e.clientX, e.clientY, p.type);
    if (p.type === 'mouse') scheduleHover();
  }

  function onPointerCancel(e) {
    pointers.delete(e.pointerId);
  }

  function onPointerLeave(e) {
    if (e.pointerType === 'mouse') { hasMouse = false; clearHover(); }
  }

  // ------------------------------------------------------------------------------------------
  // Keyboard
  // ------------------------------------------------------------------------------------------
  function selectedTower() {
    const s = game.selected;
    return s && s.kind === 'tower' ? s.tower : null;
  }

  function slotScreen(slot) {
    try { return ctx.view.worldToScreen(slot.pos); } catch (err) { return null; }
  }

  // Arrow keys: hop to the nearest bay in that screen direction (perpendicular offset counts double). Starts from
  // the hovered / selected bay, else from the bay nearest the screen centre. An open popup follows the hop.
  function navSlot(dx, dy) {
    const slots = ctx.map && ctx.map.slots;
    if (!slots || !slots.length) return;
    const sel = game.selected;
    const from = hoveredSlot || (sel && sel.kind === 'slot' ? sel.slot : sel && sel.kind === 'tower' ? sel.tower.slot : null);
    let best = null;
    let bestScore = Infinity;
    const p0 = from ? slotScreen(from) : null;
    if (!p0) {
      const r = ctx.container && ctx.container.getBoundingClientRect ? ctx.container.getBoundingClientRect() : null;
      const cx = r ? r.width / 2 : 0;
      const cy = r ? r.height / 2 : 0;
      for (const s of slots) {
        const p = slotScreen(s);
        if (!p || p.visible === false) continue;
        const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
        if (d < bestScore) { bestScore = d; best = s; }
      }
    } else {
      for (const s of slots) {
        if (s === from) continue;
        const p = slotScreen(s);
        if (!p || p.visible === false) continue;
        const ox = p.x - p0.x;
        const oy = p.y - p0.y;
        const along = ox * dx + oy * dy;
        if (along <= 4) continue;
        const score = along + 2 * Math.abs(ox * dy - oy * dx);
        if (score < bestScore) { bestScore = score; best = s; }
      }
    }
    if (!best) return;
    kbHover = true;
    setHover(best, 'slot');
    if (sel) events.emit('select:slot', { slot: best });
  }

  function onKeyDown(e) {
    if (!enabled || e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
    const phase = game.phase;
    const play = inPlayPhase(phase);
    const live = play || phase === 'paused';
    const key = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let handled = true;

    switch (key) {
      case ' ':
      case 'Spacebar':
        if (!play) { handled = false; break; }
        // Space is the "RUN" hotkey even if a HUD button kept focus after a click.
        if (isButtonTarget(e.target) && e.target.blur) e.target.blur();
        if (!e.repeat) events.emit('cmd:nextWave', {});
        break;
      case 'Enter':
        if (!play || isButtonTarget(e.target)) { handled = false; break; }
        if (e.repeat) break;
        // a bay picked with the arrows opens its build popup / floppy panel; otherwise Enter runs the wave
        if (kbHover && hoveredSlot) events.emit('select:slot', { slot: hoveredSlot });
        else events.emit('cmd:nextWave', {});
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        if (!play) { handled = false; break; }
        navSlot(key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0, key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0);
        break;
      case 'Escape':
      case 'Esc':
        if (!live) { handled = false; break; }
        if (play && game.selected) events.emit('select:none', {});
        else if (play && kbHover) { kbHover = false; clearHover(); }
        else events.emit('cmd:pause', {});
        break;
      case 'p':
        if (!live) { handled = false; break; }
        if (!e.repeat) events.emit('cmd:pause', {});
        break;
      case 'f':
        if (!live) { handled = false; break; }
        if (!e.repeat) events.emit('cmd:speed', {});
        break;
      case 'm':
        // Not on boot / BSOD / victory screens, where letters may be typed (initials entry).
        if (!live && phase !== 'menu') { handled = false; break; }
        if (!e.repeat) events.emit('cmd:mute', {});
        break;
      case '1':
      case '2':
      case '3': {
        if (!play) { handled = false; break; }
        if (e.repeat) break;
        const slot = hoveredSlot && !hoveredSlot.tower ? hoveredSlot : null;
        events.emit('cmd:quickbuild', { type: QUICKBUILD[key], slotId: slot ? slot.id : undefined });
        break;
      }
      case 'u': {
        if (!play) { handled = false; break; }
        if (e.repeat) break;
        // Selected tower first; otherwise the tower under the mouse.
        const tower = selectedTower() || (hoveredSlot && hoveredSlot.tower) || null;
        events.emit('cmd:upgrade', tower ? { towerId: tower.id } : {});
        break;
      }
      case 's':
      case 'Delete':
      case 'Backspace':
        if (!play) { handled = false; break; }
        if (!e.repeat) events.emit('cmd:sell', {});
        break;
      case 't':
        // OVERCLOCK (heat.js decides whether it can fire: waves only, 30 s cooldown).
        if (!play) { handled = false; break; }
        if (!e.repeat) events.emit('cmd:overclock', {});
        break;
      case 'r': {
        // Cycle the selected floppy's targeting mode (same as the tower panel button).
        if (!play) { handled = false; break; }
        const tower = selectedTower();
        if (!tower || e.repeat) break;
        const i = TARGETING.indexOf(tower.targeting || 'first');
        events.emit('cmd:setTargeting', { towerId: tower.id, mode: TARGETING[(i + 1) % TARGETING.length] });
        break;
      }
      default:
        handled = false;
    }
    if (handled && e.cancelable) e.preventDefault();
  }

  // ------------------------------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------------------------------
  if (el) {
    el.style.touchAction = 'none';
    el.style.webkitTapHighlightColor = 'transparent';
    listen(el, 'pointerdown', onPointerDown);
    listen(el, 'pointermove', onPointerMove);
    listen(el, 'pointerup', onPointerUp);
    listen(el, 'pointercancel', onPointerCancel);
    listen(el, 'lostpointercapture', onPointerCancel);
    listen(el, 'pointerleave', onPointerLeave);
    listen(el, 'contextmenu', (e) => e.preventDefault());
    listen(el, 'dblclick', (e) => e.preventDefault());
    listen(el, 'selectstart', (e) => e.preventDefault());
    // iOS Safari ignores user-scalable=no: swallow the touchend that would trigger double-tap zoom.
    listen(el, 'touchend', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  }
  if (typeof document !== 'undefined') {
    listen(document, 'gesturestart', (e) => e.preventDefault(), { passive: false });
  }
  if (typeof window !== 'undefined') {
    listen(window, 'keydown', onKeyDown);
    listen(window, 'blur', () => { pointers.clear(); clearHover(); });
    listen(window, 'resize', () => pointers.clear());
    if (window.visualViewport) listen(window.visualViewport, 'resize', () => pointers.clear());
  }

  events.on('phase:change', ({ to }) => {
    pointers.clear();
    if (inPlayPhase(to)) { if (hasMouse) scheduleHover(); } else clearHover();
  });
  events.on('game:new', () => { hoveredSlot = null; hoveredKind = null; if (hasMouse) scheduleHover(); });
  // The thing under the cursor changed (built / sold): refresh cursor + highlight.
  events.on('tower:placed', () => { if (hasMouse) scheduleHover(); });
  events.on('tower:sold', () => { if (hasMouse) scheduleHover(); });

  return {
    get hoveredSlot() { return hoveredSlot; },
    get hoveredKind() { return hoveredKind; },
    get enabled() { return enabled; },
    setEnabled(v) { enabled = !!v; if (!enabled) { pointers.clear(); clearHover(); } },
    pickAt,   // (clientX, clientY, pointerType?) -> pick result (tests / tools)
    tap,      // (clientX, clientY, pointerType?) -> simulate a tap
    reset() { pointers.clear(); clearHover(); },
    dispose() { for (const d of disposers.splice(0)) d(); clearHover(); },
  };
}
