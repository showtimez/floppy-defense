// Persistent settings + local leaderboard in localStorage (all access guarded: private mode / iframes can throw).
const KEY = 'floppy-defense:v1';

const DEFAULTS = {
  muted: false,
  musicVolume: 0.55,
  sfxVolume: 0.8,
  lang: 'en',          // English by default; Italian only if the player picks it in Settings
  langChosen: false,   // true once the player explicitly picked a language
  crt: true,
  quality: 'auto',     // 'auto' | 'high' | 'low'
  tutorialDone: false,
  bestWave: 0,
  endlessUnlocked: false,
  leaderboard: [],     // [{ name, score, wave, mode, date }]
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) { /* ignore */ }
  return { ...DEFAULTS };
}

export const settings = load();
// The game ships in English: ignore any language that was auto-detected by older builds.
if (!settings.langChosen || (settings.lang !== 'en' && settings.lang !== 'it')) settings.lang = 'en';

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

export function getLeaderboard(mode = 'campaign') {
  return settings.leaderboard.filter((e) => e.mode === mode).sort((a, b) => b.score - a.score).slice(0, 10);
}

// Returns the 1-based rank of the new entry within its mode (or 0 if it did not make the top 10).
export function addScore({ name, score, wave, mode }) {
  const entry = { name: String(name || 'AAA').slice(0, 8).toUpperCase(), score: Math.round(score), wave, mode, date: Date.now() };
  settings.leaderboard.push(entry);
  const board = getLeaderboard(mode);
  const keep = new Set(board);
  settings.leaderboard = settings.leaderboard.filter((e) => e.mode !== mode || keep.has(e));
  saveSettings();
  const rank = board.indexOf(entry);
  return rank === -1 ? 0 : rank + 1;
}

export function isHighScore(score, mode = 'campaign') {
  const board = getLeaderboard(mode);
  return board.length < 10 || score > board[board.length - 1].score;
}
