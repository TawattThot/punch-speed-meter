const KEY = 'punch-speed-meter:history:v1';
const MAX = 30;

export function loadHistory() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistory(entries) {
  localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX)));
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
  localStorage.removeItem(KEY);
  return [];
}
