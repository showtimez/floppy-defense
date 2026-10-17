// Generic object pool. create() builds a new item; reset(item) prepares a released item for reuse.
export function createPool(create, reset = () => {}) {
  const free = [];
  const active = [];
  return {
    active,
    acquire() {
      const item = free.pop() ?? create();
      active.push(item);
      return item;
    },
    release(item) {
      const i = active.indexOf(item);
      if (i !== -1) {
        active[i] = active[active.length - 1];
        active.pop();
      }
      reset(item);
      free.push(item);
    },
    releaseAll() {
      while (active.length) {
        const item = active.pop();
        reset(item);
        free.push(item);
      }
    },
    get size() { return active.length; },
  };
}
