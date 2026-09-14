export interface Preferences { sound: boolean; haptics: boolean; reducedMotion: boolean; name: string; serverUrl: string }
export interface MatchRecord { id: string; date: string; mode: string; score: number; correct: number; rounds: number; won: boolean; draw: boolean; averageMs: number }
const defaults: Preferences = { sound: true, haptics: true, reducedMotion: false, name: 'Player 1', serverUrl: '' };
export function createMatchId(source: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = globalThis.crypto): string {
  if (typeof source.randomUUID === 'function') return source.randomUUID();
  return Array.from(source.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('-');
}
export function getPreferences(): Preferences {
  try {
    const p = JSON.parse(localStorage.getItem('brainrivals:settings') ?? '{}');
    return { ...defaults, ...Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, typeof p?.[key] === typeof value ? p[key] : value])) };
  } catch { return { ...defaults }; }
}
export function savePreferences(p: Preferences) { try { localStorage.setItem('brainrivals:settings', JSON.stringify(p)); } catch { /* Private/storage-full browsers can still play. */ } }
export function getHistory(): MatchRecord[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('brainrivals:history') ?? '[]');
    return Array.isArray(value) ? value.filter((r): r is MatchRecord => r && typeof r.id === 'string' && typeof r.date === 'string' && Number.isFinite(r.score) && Number.isFinite(r.correct) && Number.isFinite(r.rounds) && Number.isFinite(r.averageMs) && ['bot', 'local', 'online'].includes(r.mode) && typeof r.won === 'boolean' && typeof r.draw === 'boolean').slice(0, 50) : [];
  } catch { return []; }
}
export function saveMatch(record: MatchRecord) {
  const current = getHistory();
  if (current.some(r => r.id === record.id)) return;
  try { localStorage.setItem('brainrivals:history', JSON.stringify([record, ...current].slice(0, 50))); } catch { /* Match play does not depend on storage. */ }
}
export function clearHistory() { try { localStorage.removeItem('brainrivals:history'); } catch { /* optional storage */ } }