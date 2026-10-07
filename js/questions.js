// Erzeugt Quizfragen aus dem Song-Pool und bewertet Antworten.
import { normalize } from './api.js';
import { store, itemFor } from './storage.js';

export const MODES = {
  recognize: { name: 'Song erkennen', icon: '🎧', desc: 'Hörprobe hören, Titel und Interpret erkennen.' },
  knowledge: { name: 'Wissensfragen', icon: '💡', desc: 'Interpret, Album, Jahr, Genre – Fragen zu deinen Songs.' },
  year: { name: 'Jahr schätzen', icon: '📅', desc: 'Hörprobe hören und das Erscheinungsjahr tippen.' },
  weak: { name: 'Schwächen trainieren', icon: '🔁', desc: 'Nur Songs, die du zuletzt falsch hattest.' },
};

const BOX_WEIGHT = [8, 5, 3, 2, 1, 1];
const UNSEEN_WEIGHT = 4;

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedSample(arr, n, weightFn) {
  const rest = arr.map(x => ({ x, w: weightFn(x) }));
  const out = [];
  while (out.length < n && rest.length) {
    let r = Math.random() * rest.reduce((s, p) => s + p.w, 0);
    let i = 0;
    for (; i < rest.length - 1; i++) {
      r -= rest[i].w;
      if (r <= 0) break;
    }
    out.push(rest.splice(i, 1)[0].x);
  }
  return out;
}

function songWeight(mode, song) {
  const it = itemFor(mode, song.id);
  return it ? BOX_WEIGHT[it.box] : UNSEEN_WEIGHT;
}

// Bis zu n Elemente aus candidates, deren key(x) eindeutig ist und nicht in exclude liegt.
function distinct(candidates, n, key, exclude = []) {
  const seen = new Set(exclude.map(key));
  const out = [];
  for (const c of shuffle(candidates)) {
    const k = key(c);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length === n) break;
  }
  return out;
}

const songLabel = s => `${s.t} — ${s.a}`;

function mcOptions(correctLabel, wrongLabels) {
  return shuffle([{ label: correctLabel, correct: true }, ...wrongLabels.map(l => ({ label: l, correct: false }))]);
}

// ---------- Song erkennen ----------
function recognizeQuestion(song, pool) {
  const base = { mode: 'recognize', song, audio: true, prompt: 'Welcher Song läuft hier?' };
  if (store.settings.answerMode === 'text') return { ...base, answerType: 'text' };
  // Ähnliche Ablenker bevorzugen: gleiches Genre zuerst.
  const others = pool.filter(s => s.id !== song.id);
  const sameGenre = others.filter(s => s.g === song.g);
  const key = s => normalize(s.t) + '|' + normalize(s.a);
  let wrong = distinct(sameGenre, 3, key, [song]);
  if (wrong.length < 3) wrong = wrong.concat(distinct(others, 3 - wrong.length, key, [song, ...wrong]));
  if (wrong.length < 3) return null;
  return { ...base, answerType: 'mc', options: mcOptions(songLabel(song), wrong.map(songLabel)) };
}

// ---------- Jahr schätzen ----------
function yearQuestion(song) {
  return { mode: 'year', song, audio: true, answerType: 'year', prompt: 'Aus welchem Jahr stammt dieser Song?' };
}

// ---------- Wissensfragen ----------
const KNOWLEDGE_KINDS = {
  artist(song, pool) {
    const wrong = distinct(pool.map(s => s.a), 3, normalize, [song.a]);
    if (wrong.length < 3) return null;
    return { prompt: `Wer singt bzw. spielt „${song.t}“?`, options: mcOptions(song.a, wrong) };
  },
  album(song, pool) {
    if (!song.al || normalize(song.al).includes(normalize(song.t))) return null;
    const isAlbum = a => a && !normalize(a).includes('greatest hits');
    const sameArtist = pool.filter(s => s.a === song.a).map(s => s.al).filter(isAlbum);
    let wrong = distinct(sameArtist, 3, normalize, [song.al]);
    if (wrong.length < 3) wrong = wrong.concat(distinct(pool.map(s => s.al).filter(isAlbum), 3 - wrong.length, normalize, [song.al, ...wrong]));
    if (wrong.length < 3) return null;
    return { prompt: `Auf welchem Album erschien „${song.t}“ von ${song.a}?`, options: mcOptions(song.al, wrong) };
  },
  year(song) {
    const now = new Date().getFullYear();
    const offsets = shuffle([-7, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 7]);
    const wrong = [];
    for (const o of offsets) {
      const y = song.y + o;
      if (y <= now && y > 1900) wrong.push(String(y));
      if (wrong.length === 3) break;
    }
    return { prompt: `In welchem Jahr erschien „${song.t}“ von ${song.a}?`, options: mcOptions(String(song.y), wrong) };
  },
  songByArtist(song, pool) {
    const others = pool.filter(s => normalize(s.a) !== normalize(song.a));
    const wrong = distinct(others, 3, s => normalize(s.t), [song]);
    if (wrong.length < 3) return null;
    return { prompt: `Welcher dieser Songs ist von ${song.a}?`, options: mcOptions(song.t, wrong.map(s => s.t)) };
  },
  genre(song, pool) {
    if (!song.g) return null;
    const wrong = distinct(pool.map(s => s.g), 3, normalize, [song.g]);
    if (wrong.length < 3) return null;
    return { prompt: `Welchem Genre wird „${song.t}“ von ${song.a} zugeordnet?`, options: mcOptions(song.g, wrong) };
  },
  oldest(song, pool) {
    const others = distinct(pool.filter(s => s.y !== song.y), 3, s => String(s.y));
    if (others.length < 3) return null;
    const four = [song, ...others];
    const oldest = four.reduce((a, b) => (b.y < a.y ? b : a));
    return {
      prompt: 'Welcher dieser Songs ist der älteste?',
      song: oldest,
      options: shuffle(four.map(s => ({ label: songLabel(s), correct: s === oldest }))),
    };
  },
};

function knowledgeQuestion(song, pool) {
  for (const kind of shuffle(Object.keys(KNOWLEDGE_KINDS))) {
    const q = KNOWLEDGE_KINDS[kind](song, pool);
    if (q) return { mode: 'knowledge', kind, song, audio: false, answerType: 'mc', ...q };
  }
  return null;
}

function makeQuestion(mode, song, pool) {
  if (mode === 'recognize') return recognizeQuestion(song, pool);
  if (mode === 'year') return yearQuestion(song);
  return knowledgeQuestion(song, pool);
}

export function weakItems(pool) {
  const byId = new Map(pool.map(s => [s.id, s]));
  return Object.entries(store.items)
    .map(([key, it]) => {
      const [mode, songId] = key.split(':');
      return { mode, song: byId.get(songId), ...it };
    })
    .filter(x => x.song && x.w > 0 && x.box <= 1 && MODES[x.mode])
    .sort((a, b) => a.box - b.box || b.w - a.w || a.last - b.last);
}

export function buildRound(mode, pool, n) {
  const questions = [];
  if (mode === 'weak') {
    for (const it of shuffle(weakItems(pool).slice(0, n * 2)).slice(0, n)) {
      const q = makeQuestion(it.mode, it.song, pool);
      if (q) questions.push(q);
    }
    return questions;
  }
  const songs = weightedSample(pool, Math.min(pool.length, n * 2), s => songWeight(mode, s));
  for (const s of songs) {
    const q = makeQuestion(mode, s, pool);
    if (q) questions.push(q);
    if (questions.length === n) break;
  }
  return questions;
}

// ---------- Bewertung ----------
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

export function textMatches(input, answer) {
  const a = normalize(input), b = normalize(answer);
  if (!a || !b) return false;
  return similarity(a, b) >= 0.8 || (a.length >= 4 && b.length > a.length && b.startsWith(a) && a.length / b.length >= 0.6);
}

export function yearPoints(diff) {
  return [100, 75, 50, 30, 10, 10][diff] ?? 0;
}

// Liefert { correct, points, detail } – speed ist 0..1 (Restzeit-Anteil) oder null ohne Countdown.
export function evaluate(q, answer, speed) {
  const factor = speed == null ? 1 : 0.5 + 0.5 * speed;
  if (answer.timeout) return { correct: false, points: 0, detail: 'Zeit abgelaufen' };
  if (q.answerType === 'mc') {
    const correct = !!q.options[answer.index]?.correct;
    return { correct, points: correct ? Math.round(100 * factor) : 0 };
  }
  if (q.answerType === 'text') {
    const titleOk = textMatches(answer.title, q.song.t);
    const artistOk = textMatches(answer.artist, q.song.a);
    const raw = (titleOk ? 100 : 0) + (artistOk ? 50 : 0);
    const detail = titleOk && artistOk ? 'Titel und Interpret richtig' : titleOk ? 'Titel richtig' : artistOk ? 'Nur Interpret richtig' : '';
    return { correct: titleOk, partial: !titleOk && artistOk, points: Math.round(raw * factor), detail };
  }
  const diff = Math.abs(answer.year - q.song.y);
  return {
    correct: diff <= 1,
    partial: diff > 1 && diff <= 3,
    points: Math.round(yearPoints(diff) * factor),
    detail: diff === 0 ? 'Genau getroffen!' : `${diff} Jahr${diff === 1 ? '' : 'e'} daneben`,
  };
}
