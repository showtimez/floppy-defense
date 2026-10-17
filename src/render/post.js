// Post-processing chain: HDR scene target -> threshold bloom (dual Kawase, half/quarter res) with optional
// phosphor persistence -> final composite to screen: CRT curvature + black bezel, chromatic offset, grain,
// vignette, flash overlay, glitch (tearing / block displacement / colour bleed), degauss wobble, power-on
// squeeze, then three's own tone mapping + sRGB output (renderer.toneMapping applies to the composite only).
// No scanlines here: the UI owns a CSS scanline overlay (CONTRACTS section 9).
// adapted from tempesta-fixart/src/game/post.js (fullscreen triangle, dual-Kawase down/up chain, HalfFloat fallback)
import * as THREE from 'three';

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// 4 bilinear taps one source texel off the centre = 4x4 box (works for half and quarter res), then a
// soft-knee threshold so only emissive / very bright pixels bloom. Values are clamped to kill fireflies.
const PREFILTER_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
vec3 tap(vec2 o) { return min(texture2D(tSrc, vUv + o * uTexel).rgb, vec3(16.0)); }
void main() {
  vec3 s = (tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0))) * 0.25;
  float br = max(s.r, max(s.g, s.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float c = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(s * c, 1.0);
}`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 h = uTexel;
  vec4 s = texture2D(tSrc, vUv) * 4.0;
  s += texture2D(tSrc, vUv - h);
  s += texture2D(tSrc, vUv + h);
  s += texture2D(tSrc, vUv + vec2(h.x, -h.y));
  s += texture2D(tSrc, vUv - vec2(h.x, -h.y));
  gl_FragColor = s * 0.125;
}`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tAdd;
uniform vec2 uTexel;
uniform float uAdd;
varying vec2 vUv;
void main() {
  vec2 h = uTexel;
  vec4 s = texture2D(tSrc, vUv + vec2(-h.x * 2.0, 0.0));
  s += texture2D(tSrc, vUv + vec2(-h.x, h.y)) * 2.0;
  s += texture2D(tSrc, vUv + vec2(0.0, h.y * 2.0));
  s += texture2D(tSrc, vUv + vec2(h.x, h.y)) * 2.0;
  s += texture2D(tSrc, vUv + vec2(h.x * 2.0, 0.0));
  s += texture2D(tSrc, vUv + vec2(h.x, -h.y)) * 2.0;
  s += texture2D(tSrc, vUv + vec2(0.0, -h.y * 2.0));
  s += texture2D(tSrc, vUv + vec2(-h.x, -h.y)) * 2.0;
  gl_FragColor = s / 12.0 + texture2D(tAdd, vUv) * uAdd;
}`;

// phosphor persistence: bright things leave a short decaying trail (max of current and faded history)
const PERSIST_FRAG = /* glsl */ `
uniform sampler2D tCur;
uniform sampler2D tPrev;
uniform float uDecay;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tCur, vUv).rgb;
  vec3 p = texture2D(tPrev, vUv).rgb * uDecay;
  gl_FragColor = vec4(max(c, p), 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uCurv;
uniform float uCA;
uniform float uGrain;
uniform float uVig;
uniform vec3 uFlashColor;
uniform float uFlash;
uniform float uGlitch;
uniform float uDegauss;
uniform float uPower;
uniform float uSat;
uniform float uDim;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = vUv;
#if CRT
  // power-on: the picture grows from a bright horizontal line
  if (uPower < 1.0) {
    float sy = max(smoothstep(0.12, 1.0, uPower), 0.003);
    float sx = max(smoothstep(0.0, 0.14, uPower), 0.002);
    uv = (uv - 0.5) / vec2(sx, sy) + 0.5;
  }
  if (uGlitch > 0.001) {
    float tq = floor(uTime * 24.0);
    float row = floor(vUv.y * 46.0);
    // light (combat) glitches tear only the outer bands so the central playfield stays readable;
    // heavy ones (game over / BSOD transition) take the whole picture
    float full = smoothstep(0.6, 1.2, uGlitch);
    float rowW = mix(smoothstep(0.18, 0.34, abs((row + 0.5) / 46.0 - 0.5)), 1.0, full);
    float n = hash12(vec2(row, tq));
    float tear = step(1.0 - 0.22 * uGlitch, n) * (hash12(vec2(row + 7.0, tq)) - 0.5) * 0.09 * uGlitch * rowW;
    vec2 cell = floor(vUv * vec2(9.0, 16.0));
    float cellW = mix(smoothstep(0.18, 0.34, abs((cell.y + 0.5) / 16.0 - 0.5)), 1.0, full);
    float bn = hash12(cell + tq * 1.37);
    vec2 boff = step(1.0 - 0.06 * uGlitch, bn) * (vec2(hash12(cell + 3.1), hash12(cell + 9.7)) - 0.5) * vec2(0.12, 0.04) * uGlitch * cellW;
    // occasional vertical roll (heavy glitches only: it shifts the whole playfield)
    float roll = step(0.93, hash12(vec2(tq, 5.0))) * uGlitch * 0.04 * smoothstep(0.45, 0.9, uGlitch);
    uv += vec2(tear, roll) + boff;
  }
  if (uDegauss > 0.001) {
    uv.x += sin(uv.y * 38.0 + uTime * 47.0) * 0.006 * uDegauss;
    uv.y += sin(uv.x * 23.0 - uTime * 31.0) * 0.003 * uDegauss;
  }
  vec2 p = uv * 2.0 - 1.0;
  p.x *= 1.0 + uCurv.x * p.y * p.y;
  p.y *= 1.0 + uCurv.y * p.x * p.x;
  vec2 suv = p * 0.5 + 0.5;
  vec2 dc = suv - 0.5;
  float r2 = dot(dc, dc);
  vec2 ca = dc * (uCA * (0.3 + r2 * 3.2)) + vec2(uGlitch * 0.007 + uDegauss * 0.005, 0.0);
  #if HQ
  vec3 col = vec3(texture2D(tScene, suv + ca).r, texture2D(tScene, suv).g, texture2D(tScene, suv - ca).b);
  #else
  vec3 col = texture2D(tScene, suv).rgb;
  if (uGlitch + uDegauss > 0.001) {
    col.r = texture2D(tScene, suv + ca).r;
    col.b = texture2D(tScene, suv - ca).b;
  }
  #endif
#else
  vec2 suv = uv;
  vec3 col = texture2D(tScene, suv).rgb;
#endif
  col += texture2D(tBloom, suv).rgb * uBloom;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(lum), col, uSat), 0.0) * uDim;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 c = gl_FragColor.rgb;

#if CRT
  if (uDegauss > 0.001) {
    float a = suv.x * 7.0 + suv.y * 4.0 + uTime * 9.0;
    c *= 1.0 + uDegauss * 0.55 * vec3(sin(a), sin(a + 2.094), sin(a + 4.188));
  }
  vec2 vq = suv * (1.0 - suv.yx);
  c *= pow(clamp(vq.x * vq.y * 16.0, 0.0, 1.0), uVig);
  if (uGlitch > 0.001) {
    float ln = hash12(vec2(floor(vUv.y * 140.0), floor(uTime * 30.0)));
    c += step(0.99 - 0.035 * uGlitch, ln) * vec3(0.3, 1.0, 0.45) * uGlitch * 0.35;
    float sw = step(0.965, hash12(floor(vUv * vec2(7.0, 13.0)) + floor(uTime * 15.0)));
    c = mix(c, c.brg * vec3(1.2, 0.6, 1.4), sw * clamp(uGlitch - 0.45, 0.0, 1.0) * 0.9);
  }
  if (uPower < 1.0) c += (1.0 - smoothstep(0.0, 0.6, uPower)) * vec3(0.55, 0.75, 0.6);
  // curved-glass sheen (top-left) and a faint mains-hum bar rolling down the tube
  vec2 sh = (suv - vec2(0.22, 0.86)) * vec2(1.0, 1.6);
  c += vec3(0.75, 0.85, 0.8) * 0.035 * (1.0 - smoothstep(0.0, 0.32, length(sh)));
  float hum = fract(suv.y * 0.6 - uTime * 0.055);
  c *= 1.0 + 0.028 * smoothstep(0.0, 0.08, hum) * (1.0 - smoothstep(0.08, 0.3, hum));
  float edge = smoothstep(0.12, 0.72, length(dc) * 1.45);
  c += uFlashColor * uFlash * (0.3 + 0.7 * edge);
  c += (hash12(gl_FragCoord.xy + fract(uTime * 13.37) * 311.0) - 0.5) * uGrain;
  vec2 px = 2.0 / uRes;
  vec2 bz = smoothstep(vec2(0.0), px, suv) * smoothstep(vec2(0.0), px, 1.0 - suv);
  c *= bz.x * bz.y;
#else
  c += uFlashColor * uFlash * 0.45;
#endif
  gl_FragColor = vec4(max(c, 0.0), 1.0);
}`;

export function fsTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  return g;
}

function fsMaterial(frag, uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: FS_VERT,
    fragmentShader: frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
  });
}

function makeRT(w, h, type, extra = {}) {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    ...extra,
  });
}

// Display NDC -> scene NDC, identical to the shader (x first, then y uses the bent x).
export function distortNDC(x, y, curv, out) {
  const bx = x * (1 + curv.x * y * y);
  out.x = bx;
  out.y = y * (1 + curv.y * bx * bx);
  return out;
}

// Scene NDC -> display NDC (exact inverse of distortNDC).
export function undistortNDC(x, y, curv, out) {
  const dy = y / (1 + curv.y * x * x);
  out.x = x / (1 + curv.x * dy * dy);
  out.y = dy;
  return out;
}

export function createPost(renderer, { mobile = false } = {}) {
  const gl = renderer;
  const ext = gl.extensions;
  const halfFloat = !!(ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
  const type = halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const caps = gl.capabilities;
  const maxSamples = caps.isWebGL2 === false ? 0 : (caps.maxSamples || 4);

  const fsMesh = new THREE.Mesh(fsTriangle(), null);
  fsMesh.frustumCulled = false;
  const fsScene = new THREE.Scene();
  fsScene.add(fsMesh);
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const draw = (material, target) => {
    fsMesh.material = material;
    gl.setRenderTarget(target);
    gl.render(fsScene, fsCam);
  };

  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;

  const cfg = { samples: mobile ? 0 : 4, bloomScale: 0.5, bloomLevels: 5, hq: true, persist: true };
  const state = {
    crt: true,
    bloom: 0.65,
    threshold: 1.0,
    knee: 0.55,
    curvature: 1,
    ca: 0.0032,
    grain: 0.035,
    vignette: 0.22,
    sat: 1.06,
    dim: 1,
    persistence: 0.075, // seconds (e-fold) for the bloom trail
  };
  const sizePx = new THREE.Vector2(1, 1);

  let sceneRT = null;
  let rts = [];
  let ups = [];
  let persistRT = [null, null];
  let persistIdx = 0;
  let persistValid = false;
  let bloomOut = null;
  let sizeKey = '';

  const prefilter = fsMaterial(PREFILTER_FRAG, {
    tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uKnee: { value: 0.5 },
  });
  const down = fsMaterial(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const up = fsMaterial(UP_FRAG, {
    tSrc: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() }, uAdd: { value: 0.6 },
  });
  const persist = fsMaterial(PERSIST_FRAG, { tCur: { value: null }, tPrev: { value: null }, uDecay: { value: 0.8 } });

  // composite uniforms are shared by every variant (CRT on/off x HQ/LQ), so switching costs nothing
  const U = {
    tScene: { value: null },
    tBloom: { value: black },
    uBloom: { value: 0.75 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uCurv: { value: new THREE.Vector2(0.03, 0.042) },
    uCA: { value: 0.003 },
    uGrain: { value: 0.035 },
    uVig: { value: 0.22 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uFlash: { value: 0 },
    uGlitch: { value: 0 },
    uDegauss: { value: 0 },
    uPower: { value: 1 },
    uSat: { value: 1.06 },
    uDim: { value: 1 },
  };
  const composites = new Map();
  let compositeMat = null;
  let compositeKey = -1;
  function getComposite(crt, hq) {
    const key = (crt ? 1 : 0) + (hq ? 2 : 0);
    let m = composites.get(key);
    if (!m) {
      m = new THREE.ShaderMaterial({
        vertexShader: FS_VERT,
        fragmentShader: COMPOSITE_FRAG,
        uniforms: U,
        defines: { CRT: crt ? 1 : 0, HQ: hq ? 1 : 0 },
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
      });
      composites.set(key, m);
    }
    return m;
  }
  function composite() {
    const key = (state.crt ? 1 : 0) + (cfg.hq ? 2 : 0);
    if (key === compositeKey && compositeMat) return compositeMat;
    compositeKey = key;
    compositeMat = getComposite(state.crt, cfg.hq);
    return compositeMat;
  }

  // Precompile every post program without drawing: the bloom chain (keyed for an offscreen target) and all
  // four composite variants (CRT on/off x HQ/LQ, keyed for the canvas), so neither the first frame nor a
  // later CRT / quality toggle blocks on a shader compile. Issues the compiles only (the caller waits for
  // the driver, e.g. by polling renderer.info.programs[i].isReady()).
  function warm() {
    if (typeof gl.compile !== 'function' || !sceneRT) return;
    const group = (mats) => {
      const s = new THREE.Scene();
      for (const m of mats) {
        const mesh = new THREE.Mesh(fsMesh.geometry, m);
        mesh.frustumCulled = false;
        s.add(mesh);
      }
      return s;
    };
    const comps = [getComposite(false, false), getComposite(true, false), getComposite(false, true), getComposite(true, true)];
    const prev = gl.getRenderTarget();
    try {
      gl.setRenderTarget(rts[0] || sceneRT);
      gl.compile(group([prefilter, down, up, persist]), fsCam);
      gl.setRenderTarget(null);
      gl.compile(group(comps), fsCam);
    } finally {
      gl.setRenderTarget(prev);
    }
  }

  // Curvature actually applied (0 when CRT is off): the renderer mirrors it for picking / UI anchoring.
  const curv = new THREE.Vector2();
  function currentCurv() {
    const k = state.crt ? state.curvature : 0;
    return curv.set(0.03 * k, 0.042 * k);
  }

  function disposeTargets() {
    sceneRT?.dispose();
    sceneRT = null;
    for (const rt of rts) rt.dispose();
    for (const rt of ups) rt.dispose();
    persistRT[0]?.dispose();
    persistRT[1]?.dispose();
    rts = [];
    ups = [];
    persistRT = [null, null];
    persistValid = false;
    sizeKey = '';
  }

  function setSize(w, h) {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    const samples = Math.min(cfg.samples, maxSamples);
    const key = `${w}x${h}x${samples}x${cfg.bloomScale}x${cfg.bloomLevels}x${cfg.persist}`;
    if (key === sizeKey) return;
    disposeTargets();
    sizeKey = key;
    sizePx.set(w, h);
    U.uRes.value.set(w, h);
    sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type,
      samples,
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    const bw = Math.max(8, Math.round(w * cfg.bloomScale));
    const bh = Math.max(8, Math.round(h * cfg.bloomScale));
    const L = cfg.bloomLevels;
    for (let i = 0; i <= L; i++) {
      const d = 2 ** i;
      rts.push(makeRT(Math.max(2, Math.round(bw / d)), Math.max(2, Math.round(bh / d)), type));
    }
    for (let i = 0; i < L; i++) ups.push(makeRT(rts[i].width, rts[i].height, type));
    if (cfg.persist) {
      persistRT = [makeRT(rts[0].width, rts[0].height, type), makeRT(rts[0].width, rts[0].height, type)];
    }
  }

  function configure(opts) {
    Object.assign(cfg, opts);
    if (sizePx.x > 1) {
      sizeKey = '';
      setSize(sizePx.x, sizePx.y);
    }
  }

  function renderBloom(dt) {
    const L = cfg.bloomLevels;
    const P = prefilter.uniforms;
    P.tSrc.value = sceneRT.texture;
    P.uTexel.value.set(1 / sceneRT.width, 1 / sceneRT.height);
    P.uThreshold.value = state.threshold;
    P.uKnee.value = state.knee;
    draw(prefilter, rts[0]);
    const D = down.uniforms;
    for (let i = 1; i <= L; i++) {
      const src = rts[i - 1];
      D.tSrc.value = src.texture;
      D.uTexel.value.set(1 / src.width, 1 / src.height);
      draw(down, rts[i]);
    }
    const UP = up.uniforms;
    let src = rts[L];
    for (let i = L - 1; i >= 0; i--) {
      UP.tSrc.value = src.texture;
      UP.tAdd.value = rts[i].texture;
      UP.uAdd.value = i === 0 ? 0.3 : 0.65;
      UP.uTexel.value.set(1 / src.width, 1 / src.height);
      draw(up, ups[i]);
      src = ups[i];
    }
    bloomOut = src;
    if (cfg.persist && persistRT[0]) {
      const prev = persistRT[persistIdx];
      const next = persistRT[1 - persistIdx];
      const S = persist.uniforms;
      S.tCur.value = src.texture;
      S.tPrev.value = prev.texture;
      S.uDecay.value = persistValid ? Math.exp(-Math.min(dt, 0.1) / Math.max(0.001, state.persistence)) : 0;
      draw(persist, next);
      persistIdx = 1 - persistIdx;
      persistValid = true;
      bloomOut = next;
    }
  }

  const prevClear = new THREE.Color();
  function render(scene, camera, dt, time, clearColor) {
    if (!sceneRT) return;
    const prevAlpha = gl.getClearAlpha();
    gl.getClearColor(prevClear);
    gl.setRenderTarget(sceneRT);
    if (clearColor !== undefined) gl.setClearColor(clearColor, 1);
    gl.clear(true, true, false);
    gl.render(scene, camera);
    if (state.bloom > 0 && cfg.bloomLevels > 0) {
      renderBloom(dt);
      U.tBloom.value = bloomOut.texture;
      U.uBloom.value = state.bloom;
    } else {
      U.tBloom.value = black;
      U.uBloom.value = 0;
    }
    U.tScene.value = sceneRT.texture;
    U.uTime.value = time;
    const c = currentCurv();
    U.uCurv.value.copy(c);
    U.uCA.value = state.ca;
    U.uGrain.value = state.grain;
    U.uVig.value = state.vignette;
    U.uSat.value = state.sat;
    U.uDim.value = state.dim;
    draw(composite(), null);
    gl.setClearColor(prevClear, prevAlpha);
  }

  function resetHistory() {
    persistValid = false;
  }

  return {
    state,
    uniforms: U,
    cfg,
    halfFloat,
    get sceneTarget() { return sceneRT; },
    setSize,
    configure,
    render,
    warm,
    resetHistory,
    currentCurv,
    setCRT(on) { state.crt = !!on; },
    dispose() {
      disposeTargets();
      for (const m of composites.values()) m.dispose();
      composites.clear();
      prefilter.dispose(); down.dispose(); up.dispose(); persist.dispose();
      black.dispose();
      fsMesh.geometry.dispose();
    },
  };
}
