# FLOPPY DEFENSE

> A tower defense inside a 90s PC. Made in 48 hours for **Ludum Dare 60** (Compo) — theme **"Old Tech"**.

Viruses crawl out of the serial ports and race along the copper traces of your motherboard towards the CPU.
Insert floppy disks into the free drive bays to stop them, spending your precious kilobytes of memory.
If CPU integrity drops to 0%… **BLUE SCREEN**.

## How to play

- **Click a free drive bay** next to a trace to insert a floppy (costs KB). Deleted viruses pay KB back.
- **Click a floppy** to upgrade it (v1.0 → v2.0 → v3.0), change its targeting or sell it.
- **Between waves a chip overheats**: click the **CPU fan** to cool it down, or nearby floppies fire at half speed.
- Survive **10 waves**. A boss shows up every 5 waves. Beat the campaign to unlock **Endless mode**.

| Floppy | Cost | Role |
|---|---|---|
| ANTIVIRUS (blue) | 64 KB | Fast single-target scan bolts |
| FIREWALL (red) | 128 KB | Burns everything around it, short range |
| DEFRAG (yellow) | 96 KB | Slows viruses in range |

| Virus | Behaviour |
|---|---|
| WORM.EXE | Fast and fragile |
| TROJAN.EXE | Slow and tough — wooden: resists scans, burns well |
| MACRO.DOC | Splits in two when deleted |
| MELISSA.DOC / ILOVEYOU.VBS | Bosses |

### Controls

| Action | Mouse / touch | Keyboard |
|---|---|---|
| Insert floppy | Click/tap a drive bay | `1` `2` `3` on the hovered bay |
| Upgrade / sell | Click/tap a floppy | `U` / `S` |
| Start the wave early (bonus KB) | RUN button | `Space` |
| Speed x1 / x2 | HUD button | `F` |
| Pause | HUD button | `P` / `Esc` |
| Mute | HUD button | `M` |

Desktop and mobile (landscape) are supported. English and Italian.

## Compo notes

Everything you see and hear is **generated in code at runtime**: low-poly geometry, canvas-drawn textures and labels,
shaders, and all sound effects and music synthesized with the Web Audio API (including the dial-up modem handshake and the
floppy drive chatter). There are no image, audio, model or font files in this repository.

Libraries and base code: [three.js](https://threejs.org/) (rendering, plus its `examples/jsm` addons) and
[Vite](https://vitejs.dev/) (build). Some generic helpers (audio voice/envelope helpers, DSP filters, post-processing and
pooling patterns) were adapted from the author's earlier personal projects.

## Development

```bash
npm install
npm run dev      # http://localhost:5180
npm run build    # production build in dist/
npm run zip      # build + floppy-defense-web.zip for itch.io
npm test         # Playwright smoke tests (needs Chrome or Edge installed and the dev server running)
```

Useful URL parameters while developing: `?debug=1` (K = +500 KB, J = kill all, H = overheat, `&wave=N`),
`?autostart=1`, `?autoplay=1` (bot), `?turbo=N`, `?mute=1`, `?seed=N`, `?quality=low`.

Architecture and module contracts: [docs/CONTRACTS.md](docs/CONTRACTS.md).

## Credits

Made by **Andrea — Anathema Studio** for Ludum Dare 60, October 2026.

## License

[MIT](LICENSE)
