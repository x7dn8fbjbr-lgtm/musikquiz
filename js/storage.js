// Persistenz in localStorage: Song-Pool, Quellen, Lernstand und Statistik.
const KEY = 'musikquiz.v1';

const DEFAULTS = {
  songs: {},     // id -> Song
  sources: [],   // { id, term, attr, songIds: [] }
  items: {},     // `${mode}:${songId}` -> { c, w, box, last }
  rounds: [],    // { ts, mode, score, correct, total }
  settings: {
    count: 10,
    timer: 20,
    answerMode: 'mc',
    originalsOnly: true,
    country: 'DE',
    limit: 100,
  },
};

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return { ...clone(DEFAULTS), ...d, settings: { ...DEFAULTS.settings, ...d.settings } };
    }
  } catch (e) {
    console.warn('Speicher konnte nicht gelesen werden', e);
  }
  return clone(DEFAULTS);
}

export const store = load();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('Speichern fehlgeschlagen', e);
  }
}

export function pool() {
  return Object.values(store.songs);
}

export function addSource(term, attr, songs) {
  const existing = store.sources.find(s => s.term.toLowerCase() === term.toLowerCase() && s.attr === attr);
  const src = existing || { id: Date.now().toString(36), term, attr, songIds: [] };
  let added = 0;
  for (const song of songs) {
    if (!store.songs[song.id]) added++;
    store.songs[song.id] = song;
    if (!src.songIds.includes(song.id)) src.songIds.push(song.id);
  }
  if (!existing) store.sources.push(src);
  save();
  return added;
}

export function removeSource(id) {
  const src = store.sources.find(s => s.id === id);
  if (!src) return;
  store.sources = store.sources.filter(s => s !== src);
  const stillUsed = new Set(store.sources.flatMap(s => s.songIds));
  for (const sid of src.songIds) if (!stillUsed.has(sid)) delete store.songs[sid];
  save();
}

export function removeSong(id) {
  delete store.songs[id];
  for (const s of store.sources) s.songIds = s.songIds.filter(x => x !== id);
  save();
}

// Leitner-Box: richtig -> eine Box höher (max. 5), falsch -> zurück auf 0.
export function recordAnswer(mode, songId, correct) {
  const key = `${mode}:${songId}`;
  const it = store.items[key] || { c: 0, w: 0, box: 0, last: 0 };
  if (correct) {
    it.c++;
    it.box = Math.min(5, it.box + 1);
  } else {
    it.w++;
    it.box = 0;
  }
  it.last = Date.now();
  store.items[key] = it;
}

export function itemFor(mode, songId) {
  return store.items[`${mode}:${songId}`];
}

export function recordRound(round) {
  store.rounds.push(round);
  if (store.rounds.length > 300) store.rounds = store.rounds.slice(-300);
  save();
}

export function resetStats() {
  store.items = {};
  store.rounds = [];
  save();
}

export function exportData() {
  return JSON.stringify(store, null, 1);
}

export function importData(json) {
  const d = JSON.parse(json);
  if (!d || typeof d !== 'object' || !d.songs || !Array.isArray(d.sources)) {
    throw new Error('Keine gültige Musikquiz-Sicherung');
  }
  Object.assign(store, clone(DEFAULTS), d, { settings: { ...DEFAULTS.settings, ...d.settings } });
  save();
}
