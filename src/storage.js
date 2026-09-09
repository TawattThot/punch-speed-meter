const HISTORY_KEY = 'punch-speed-meter:history:v1';
const HIGH_SCORE_KEY = 'punch-speed-meter:highscore:v1';
const MAX = 30;

export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistory(entries) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX)));
}

export function addResult(result) {
  const entries = loadHistory();
  entries.unshift({
    id: `${result.at}-${Math.random().toString(36).slice(2, 8)}`,
    peakSpeedMph: result.peakSpeedMph,
    peakSpeedKmh: result.peakSpeedKmh,
    peakAccelG: result.peakAccelG,
    power: result.power,
    durationMs: result.durationMs,
    at: result.at,
  });
  saveHistory(entries);
  return entries;
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  return [];
}

/** @returns {{ peakSpeedMph: number, peakSpeedKmh: number, peakAccelG: number, power: number, at: number } | null} */
export function loadHighScore() {
  try {
    const raw = localStorage.getItem(HIGH_SCORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.peakSpeedMph !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persist best punch if this result beats the stored high score (by mph, then power).
 * @returns {{ highScore: object, beat: boolean }}
 */
export function considerHighScore(result) {
  const current = loadHighScore();
  const candidate = {
    peakSpeedMph: result.peakSpeedMph,
    peakSpeedKmh: result.peakSpeedKmh,
    peakAccelG: result.peakAccelG,
    power: result.power,
    at: result.at,
  };

  const beat =
    !current ||
    candidate.peakSpeedMph > current.peakSpeedMph ||
    (candidate.peakSpeedMph === current.peakSpeedMph &&
      candidate.power > (current.power ?? 0));

  if (beat) {
    localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(candidate));
    return { highScore: candidate, beat: true };
  }
  return { highScore: current, beat: false };
}

export function clearHighScore() {
  localStorage.removeItem(HIGH_SCORE_KEY);
  return null;
}
