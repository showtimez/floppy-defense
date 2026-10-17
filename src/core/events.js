// Tiny event bus. Listener errors are isolated so one buggy subscriber cannot break the game loop.
// Event names and payloads are documented in docs/CONTRACTS.md (section "Events").

const listeners = new Map();

export const events = {
  on(name, fn) {
    let set = listeners.get(name);
    if (!set) listeners.set(name, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  },
  once(name, fn) {
    const off = this.on(name, (p) => { off(); fn(p); });
    return off;
  },
  off(name, fn) {
    listeners.get(name)?.delete(fn);
  },
  emit(name, payload = {}) {
    const set = listeners.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); }
      catch (err) { console.error(`[events] listener for "${name}" failed`, err); }
    }
  },
};
