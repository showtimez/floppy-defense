// Fixed-timestep simulation with a speed multiplier, plus a per-frame render callback.
// step(dt) runs 0..N times per frame (dt = fixed); render(realDt, t) runs once per frame.
export function createLoop({ step, render, getSpeed, fixed = 1 / 60, maxSteps = 12 }) {
  let acc = 0;
  let last = 0;
  let running = true;

  function tick(now) {
    if (!running) return;
    requestAnimationFrame(tick);
    const t = now / 1000;
    let dt = last ? t - last : fixed;
    last = t;
    if (dt > 0.1) dt = 0.1; // tab switch / hitch guard
    acc += dt * getSpeed();
    let n = 0;
    while (acc >= fixed && n < maxSteps) {
      step(fixed);
      acc -= fixed;
      n++;
      if (getSpeed() <= 0) { acc = 0; break; } // the step paused/ended the game: drop the rest of the frame
    }
    if (n >= maxSteps) acc = 0;
    render(dt, t);
  }

  requestAnimationFrame(tick);
  return {
    stop() { running = false; },
  };
}
