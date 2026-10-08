import { store, save, pool, addSource, removeSource, setPackMisses, removeSong, recordAnswer, recordRound, resetStats, exportData, importData } from './storage.js';
import { searchSongs, diagnose, proxiedPreview } from './api.js';
import { PACKS, packKey, lookupPackSong } from './packs.js';
import { MODES, DECADES, decadeLabel, inDecade, buildRound, evaluate, weakItems } from './questions.js';

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
const audio = new Audio();
audio.preload = 'auto';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

let currentTab = 'home';
let quiz = null;
let deferredInstall = null;

// ---------- Hilfen ----------
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

function setTab(tab) {
  currentTab = tab;
  for (const b of tabbar.querySelectorAll('button')) b.classList.toggle('active', b.dataset.tab === tab);
  stopAudio();
  render();
  window.scrollTo(0, 0);
}

function render() {
  document.body.classList.toggle('in-quiz', !!quiz);
  if (quiz) return renderQuiz();
  ({ home: renderHome, songs: renderSongs, stats: renderStats, settings: renderSettings })[currentTab]();
}

// Lädt die Hörprobe; schlägt das fehl, einmal über den Vermittler versuchen.
function loadPreview(song) {
  audio.src = song.p;
  audio.dataset.song = song.id;
  audio.addEventListener('error', function retry() {
    if (audio.dataset.song !== song.id || audio.src !== song.p) return;
    const wasPlaying = audio.dataset.wantPlay === '1';
    audio.src = proxiedPreview(song.p);
    if (wasPlaying) audio.play().catch(() => {});
  }, { once: true });
}

function playAudio() {
  audio.dataset.wantPlay = '1';
  return audio.play();
}

audio.addEventListener('pause', () => (audio.dataset.wantPlay = ''));

function stopAudio() {
  audio.dataset.song = '';
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

tabbar.addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (b) setTab(b.dataset.tab);
});

// ---------- Training (Start) ----------
// Song-Pool fürs Training, eingeschränkt auf das gewählte Jahrzehnt.
function trainingPool() {
  return pool().filter(song => inDecade(song, store.settings.decade));
}

function decadeChips() {
  const all = pool();
  const counts = Object.fromEntries(DECADES.map(d => [d, all.filter(song => inDecade(song, d)).length]));
  const cur = store.settings.decade;
  const chip = (d, n) => `<button class="chip${d === cur ? ' active' : ''}" data-decade="${d}" aria-pressed="${d === cur}">${decadeLabel(d)} <span class="muted small">${n}</span></button>`;
  return `<div class="chips" role="group" aria-label="Jahrzehnt">
    ${chip('', all.length)}
    ${DECADES.filter(d => counts[d] || d === cur).map(d => chip(d, counts[d])).join('')}
  </div>`;
}

function renderHome() {
  const songs = trainingPool();
  const weakCount = weakItems(songs).length;
  const s = store.settings;
  if (pool().length < 4) {
    view.innerHTML = `
      <div class="card hero stack">
        <h1>Willkommen!</h1>
        <p class="muted">Stell dir zuerst deinen Song-Pool zusammen – Interpreten, Genres oder Stichworte, ganz wie dein Quiz es verlangt. Danach kannst du sofort loslegen.</p>
        <button class="btn btn-block" id="go-songs">🎵 Songs hinzufügen</button>
      </div>`;
    view.querySelector('#go-songs').onclick = () => setTab('songs');
    return;
  }
  view.innerHTML = `
    <h1>Training</h1>
    <p class="muted small">${songs.length} Songs${s.decade ? ` aus den ${decadeLabel(s.decade)}n` : ' im Pool'} · ${s.count} Fragen pro Runde · ${s.timer ? `${s.timer} s Countdown` : 'ohne Countdown'}</p>
    <h2 style="margin-top:16px">Jahrzehnt</h2>
    ${decadeChips()}
    ${songs.length < 4 ? `<p class="muted small" style="margin-top:8px">Für die ${decadeLabel(s.decade)} sind zu wenige Songs im Pool. Füge unter „Songs“ welche hinzu (mit Jahrzehnt ${decadeLabel(s.decade)}).</p>` : ''}
    <div class="modes" style="margin-top:16px">
      ${Object.entries(MODES).map(([key, m]) => `
        <button class="mode" data-mode="${key}" ${(key === 'weak' && !weakCount) || songs.length < 4 ? 'disabled' : ''}>
          <span class="icon" aria-hidden="true">${m.icon}</span>
          <strong>${m.name}</strong>
          <span class="muted">${m.desc}</span>
          ${key === 'weak' ? `<span class="badge">${weakCount ? `${weakCount} offen` : 'Nichts offen 🎉'}</span>` : ''}
        </button>`).join('')}
    </div>
    ${deferredInstall ? '<button class="btn btn-block" id="install" style="margin-top:16px">📲 App installieren</button>' : ''}`;
  view.querySelectorAll('[data-mode]').forEach(b => (b.onclick = () => startQuiz(b.dataset.mode)));
  view.querySelectorAll('[data-decade]').forEach(b => (b.onclick = () => {
    store.settings.decade = b.dataset.decade;
    save();
    renderHome();
  }));
  view.querySelector('#install')?.addEventListener('click', install);
}

// ---------- Quiz ----------
function startQuiz(mode) {
  const questions = buildRound(mode, trainingPool(), store.settings.count);
  if (!questions.length) {
    toast('Zu wenige passende Songs – füge mehr hinzu.');
    return;
  }
  quiz = { mode, questions, i: 0, score: 0, results: [], answered: false, timer: null };
  showQuestion();
}

function showQuestion() {
  quiz.answered = false;
  quiz.yearGuess = null;
  render();
  const q = quiz.questions[quiz.i];
  if (q.audio) {
    playSong(q.song, true);
  } else {
    stopAudio();
    startTimer();
  }
}

function playSong(song, withTimer) {
  stopAudio();
  loadPreview(song);
  const run = quiz, idx = quiz?.i;
  const begin = () => {
    if (withTimer && quiz && quiz === run && quiz.i === idx && !quiz.answered && !quiz.timer) startTimer();
  };
  audio.addEventListener('playing', begin, { once: true });
  // Falls die Vorschau hängt, startet der Countdown trotzdem nach 5 s.
  if (withTimer) setTimeout(begin, 5000);
  // Blockiert der Browser Autoplay, startet der Play-Button die Hörprobe.
  playAudio().catch(() => {});
}

function startTimer() {
  const total = store.settings.timer;
  if (!total || !quiz) return;
  const started = performance.now();
  const t = { total, started, raf: 0 };
  quiz.timer = t;
  const tick = now => {
    if (!quiz || quiz.timer !== t || quiz.answered) return;
    const left = Math.max(0, total - (now - started) / 1000);
    const bar = view.querySelector('.timer');
    if (bar) {
      bar.firstElementChild.style.transform = `scaleX(${left / total})`;
      bar.classList.toggle('low', left <= 5);
    }
    const lbl = view.querySelector('.timer-label');
    if (lbl) lbl.textContent = `${Math.ceil(left)} s`;
    if (left <= 0) return submitAnswer({ timeout: true });
    t.raf = requestAnimationFrame(tick);
  };
  t.raf = requestAnimationFrame(tick);
}

function remainingShare() {
  const t = quiz.timer;
  if (!store.settings.timer) return null;
  if (!t) return 1; // Audio lief noch nicht -> volle Zeit
  return Math.max(0, 1 - (performance.now() - t.started) / 1000 / t.total);
}

function submitAnswer(answer) {
  if (!quiz || quiz.answered) return;
  const q = quiz.questions[quiz.i];
  const speed = remainingShare();
  if (quiz.timer) cancelAnimationFrame(quiz.timer.raf);
  quiz.answered = true;
  const res = evaluate(q, answer, speed);
  quiz.score += res.points;
  quiz.results.push({ q, answer, ...res });
  recordAnswer(q.mode, q.song.id, res.correct);
  save();
  renderQuiz();
  // Nach der Antwort läuft die Hörprobe zum Nachhören weiter.
  if (q.audio && audio.paused && audio.src) playAudio().catch(() => {});
}

function nextQuestion() {
  if (!quiz) return;
  quiz.i++;
  quiz.timer = null;
  if (quiz.i >= quiz.questions.length) return finishQuiz();
  showQuestion();
  window.scrollTo(0, 0);
}

function quitQuiz() {
  if (quiz.results.length && !confirm('Runde abbrechen? Bisherige Antworten bleiben in der Statistik.')) return;
  if (quiz.timer) cancelAnimationFrame(quiz.timer.raf);
  quiz = null;
  stopAudio();
  render();
}

function finishQuiz() {
  stopAudio();
  const correct = quiz.results.filter(r => r.correct).length;
  recordRound({ ts: Date.now(), mode: quiz.mode, score: quiz.score, correct, total: quiz.results.length });
  const done = quiz;
  quiz = null;
  renderResult(done);
}

function songCard(song) {
  return `
    <div class="songcard">
      ${song.art ? `<img src="${esc(song.art)}" alt="Cover von ${esc(song.al || song.t)}" loading="lazy">` : ''}
      <div>
        <div class="t">${esc(song.t)}</div>
        <div>${esc(song.a)}</div>
        <div class="muted small">${esc(song.al)}${song.al ? ' · ' : ''}${song.y}${song.g ? ' · ' + esc(song.g) : ''}</div>
      </div>
    </div>`;
}

function renderQuiz() {
  const q = quiz.questions[quiz.i];
  const last = quiz.answered ? quiz.results[quiz.results.length - 1] : null;
  const timerOn = !!store.settings.timer;
  const modeName = MODES[q.mode].name;

  let body = '';
  if (q.answerType === 'mc') {
    body = `<div class="options">${q.options.map((o, i) => {
      let cls = '';
      if (last) cls = o.correct ? 'correct' : last.answer.index === i ? 'wrong' : '';
      return `<button class="option ${cls}" data-opt="${i}" ${last ? 'disabled' : ''}><span class="key">${i + 1}</span><span>${esc(o.label)}</span></button>`;
    }).join('')}</div>`;
  } else if (q.answerType === 'text') {
    body = `
      <form id="text-form" class="stack" autocomplete="off">
        <label class="field"><span>Titel</span><input type="text" name="title" ${last ? 'disabled' : ''} value="${esc(last?.answer.title)}" autocapitalize="off"></label>
        <label class="field"><span>Interpret (Bonus)</span><input type="text" name="artist" ${last ? 'disabled' : ''} value="${esc(last?.answer.artist)}" autocapitalize="off"></label>
        ${last ? '' : '<div class="row"><button class="btn btn-primary grow" type="submit">Prüfen</button><button class="btn" type="button" id="skip">Weiß nicht</button></div>'}
      </form>`;
  } else {
    const now = new Date().getFullYear();
    const min = Math.min(1950, q.song.y - 10);
    const guess = last ? last.answer.year : (quiz.yearGuess ?? Math.round((min + now) / 2));
    quiz.yearGuess = guess;
    body = `
      <div class="card stack">
        <div class="year-display" id="year-val">${guess}</div>
        <input type="range" id="year" min="${min}" max="${now}" value="${guess}" ${last ? 'disabled' : ''} aria-label="Jahr">
        ${last ? '' : `<div class="steps">
          <button class="btn" data-step="-5">−5</button><button class="btn" data-step="-1">−1</button>
          <button class="btn" data-step="1">+1</button><button class="btn" data-step="5">+5</button>
        </div>
        <button class="btn btn-primary btn-block" id="year-submit">Tippen</button>`}
      </div>`;
  }

  let feedback = '';
  if (last) {
    const cls = last.correct ? 'ok' : last.partial ? 'partial' : 'bad';
    const verdict = last.correct ? 'Richtig!' : last.partial ? 'Fast!' : 'Leider falsch';
    feedback = `
      <div class="card feedback ${cls} stack">
        <div class="row"><span class="verdict grow">${verdict}</span><span class="badge">+${last.points} Punkte</span></div>
        ${last.detail ? `<p class="muted small">${esc(last.detail)}</p>` : ''}
        ${songCard(q.song)}
        <button class="btn btn-primary btn-block" id="next">${quiz.i + 1 < quiz.questions.length ? 'Weiter' : 'Auswertung'} <span class="muted small">(Enter)</span></button>
      </div>`;
  }

  view.innerHTML = `
    <div class="quiz-head">
      <button class="btn btn-ghost" id="quit" aria-label="Runde abbrechen">✕</button>
      <span class="muted small">${MODES[quiz.mode].icon} ${quiz.mode === 'weak' ? MODES.weak.name + ' · ' : ''}${modeName} · Frage ${quiz.i + 1}/${quiz.questions.length}</span>
      <span class="score">${quiz.score}</span>
    </div>
    ${timerOn ? `<div class="row" style="gap:8px;margin-bottom:6px"><div class="timer grow" style="margin:0"><div style="transform:scaleX(${last ? 0 : 1})"></div></div><span class="timer-label">${last ? '' : store.settings.timer + ' s'}</span></div>` : ''}
    ${q.audio ? `
      <div class="player">
        <button class="play-btn" id="play" aria-label="Hörprobe abspielen oder pausieren">▶</button>
        <div class="eq" id="eq" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
      </div>` : ''}
    <div class="prompt">${esc(q.prompt)}</div>
    ${body}
    ${feedback}`;

  wireQuiz(q, last);
  syncPlayer();
}

function wireQuiz(q, last) {
  view.querySelector('#quit').onclick = quitQuiz;
  view.querySelector('#next')?.addEventListener('click', nextQuestion);
  view.querySelector('#next')?.focus();
  view.querySelector('#play')?.addEventListener('click', () => {
    if (!audio.src) playSong(q.song, !last);
    else if (audio.paused) playAudio().catch(() => toast('Wiedergabe nicht möglich'));
    else audio.pause();
  });
  if (last) return;
  view.querySelectorAll('[data-opt]').forEach(b => (b.onclick = () => submitAnswer({ index: +b.dataset.opt })));
  const form = view.querySelector('#text-form');
  if (form) {
    form.onsubmit = e => {
      e.preventDefault();
      submitAnswer({ title: form.title.value, artist: form.artist.value });
    };
    form.querySelector('#skip').onclick = () => submitAnswer({ title: '', artist: '' });
    form.title.focus();
  }
  const range = view.querySelector('#year');
  if (range) {
    const setYear = y => {
      y = Math.max(+range.min, Math.min(+range.max, y));
      range.value = y;
      quiz.yearGuess = y;
      view.querySelector('#year-val').textContent = y;
    };
    range.oninput = () => setYear(+range.value);
    view.querySelectorAll('[data-step]').forEach(b => (b.onclick = () => setYear(quiz.yearGuess + +b.dataset.step)));
    view.querySelector('#year-submit').onclick = () => submitAnswer({ year: quiz.yearGuess });
  }
}

function syncPlayer() {
  const btn = view.querySelector('#play');
  const eq = view.querySelector('#eq');
  if (!btn) return;
  const playing = !audio.paused && !audio.ended;
  btn.textContent = playing ? '❚❚' : '▶';
  eq.classList.toggle('playing', playing);
}
['play', 'playing', 'pause', 'ended'].forEach(ev => audio.addEventListener(ev, syncPlayer));

document.addEventListener('keydown', e => {
  if (!quiz || e.target.matches('input, textarea, select')) return;
  const q = quiz.questions[quiz.i];
  if (!quiz.answered && q.answerType === 'mc' && /^[1-4]$/.test(e.key)) {
    submitAnswer({ index: +e.key - 1 });
  } else if (quiz.answered && e.key === 'Enter') {
    e.preventDefault();
    nextQuestion();
  } else if (e.key === ' ' && q.audio) {
    e.preventDefault();
    view.querySelector('#play')?.click();
  }
});

function renderResult(done) {
  document.body.classList.remove('in-quiz');
  const total = done.results.length;
  const correct = done.results.filter(r => r.correct).length;
  const best = Math.max(0, ...store.rounds.filter(r => r.mode === done.mode).slice(0, -1).map(r => r.score));
  const isRecord = done.score > best && store.rounds.filter(r => r.mode === done.mode).length > 1;
  view.innerHTML = `
    <div class="card hero stack" style="text-align:center">
      <div>${MODES[done.mode].icon} ${MODES[done.mode].name}</div>
      <div class="result-score">${done.score}</div>
      <div>${correct} von ${total} richtig (${pct(correct, total)} %)${isRecord ? ' · 🏆 Neuer Bestwert!' : ''}</div>
    </div>
    <div class="row" style="margin-top:12px">
      <button class="btn btn-primary grow" id="again">Nochmal</button>
      <button class="btn grow" id="weak" ${weakItems(trainingPool()).length ? '' : 'disabled'}>Schwächen üben</button>
      <button class="btn grow" id="home">Übersicht</button>
    </div>
    <h2>Deine Antworten</h2>
    <div class="card"><ul class="list result-list">
      ${done.results.map(r => `
        <li>
          <span class="mark ${r.correct ? 'ok' : r.partial ? 'partial' : 'bad'}">${r.correct ? '✓' : r.partial ? '~' : '✗'}</span>
          <div class="grow">
            <div class="ellipsis"><strong>${esc(r.q.song.t)}</strong> — ${esc(r.q.song.a)}</div>
            <div class="muted small ellipsis">${esc(r.q.prompt)} ${r.q.song.y ? '· ' + r.q.song.y : ''}</div>
          </div>
          <span class="badge">+${r.points}</span>
        </li>`).join('')}
    </ul></div>`;
  view.querySelector('#again').onclick = () => startQuiz(done.mode);
  view.querySelector('#weak').onclick = () => startQuiz('weak');
  view.querySelector('#home').onclick = () => setTab('home');
}

// ---------- Songs ----------
const SUGGESTIONS = [
  ['ABBA', 'artist'], ['Queen', 'artist'], ['The Beatles', 'artist'], ['Michael Jackson', 'artist'],
  ['Neue Deutsche Welle', 'all'], ['Schlager', 'all'], ['80s Hits', 'all'], ['Rock Classics', 'all'],
  ['Helene Fischer', 'artist'], ['Die Ärzte', 'artist'], ['Eurovision', 'all'], ['Disco', 'all'],
];

function renderSongs() {
  const songs = pool().sort((a, b) => a.a.localeCompare(b.a) || a.t.localeCompare(b.t));
  const attrLabel = { artist: 'Interpret', song: 'Songtitel', all: 'Alles', pack: 'Themenpaket' };
  view.innerHTML = `
    <h1>Songs</h1>
    <h2>Themenpakete</h2>
    <div class="stack" id="packs">${PACKS.map(packCard).join('')}</div>
    <h2>Eigene Suche</h2>
    <p class="muted small">Such nach Interpreten, Genres oder Stichworten. Die Treffer (mit 30-Sekunden-Hörprobe) landen in deinem Song-Pool.</p>
    <form class="card stack" id="search-form">
      <label class="field"><span>Suchbegriff</span><input type="search" name="term" placeholder="z. B. Queen, Schlager, 80s Hits …" required enterkeyhint="search"></label>
      <div class="row">
        <label class="field grow"><span>Suchen in</span>
          <select name="attr"><option value="artist">Interpret</option><option value="all">Alles (Titel, Album, Genre …)</option><option value="song">Songtitel</option></select>
        </label>
        <label class="field grow"><span>Jahrzehnt</span>
          <select name="decade">${['', ...DECADES].map(d => `<option value="${d}" ${d === store.settings.searchDecade ? 'selected' : ''}>${d ? decadeLabel(d) : 'Alle Jahrzehnte'}</option>`).join('')}</select>
        </label>
        <label class="field grow"><span>Max. Treffer</span>
          <select name="limit">${[25, 50, 100, 200].map(n => `<option ${n === store.settings.limit ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </label>
      </div>
      <button class="btn btn-primary btn-block" type="submit" id="search-btn">Hinzufügen</button>
    </form>
    <h2>Ideen</h2>
    <div class="chips">${SUGGESTIONS.map(([t, a]) => `<button class="chip" data-term="${esc(t)}" data-attr="${a}">${esc(t)}</button>`).join('')}</div>
    <h2>Deine Quellen <span class="badge">${songs.length} Songs</span></h2>
    ${store.sources.length ? `<div class="card"><ul class="list">
      ${store.sources.map(s => `
        <li><div class="grow"><strong>${esc(s.term)}</strong><div class="muted small">${attrLabel[s.attr] || s.attr} · ${s.songIds.filter(id => store.songs[id]).length} Songs</div></div>
        <button class="btn btn-ghost btn-danger icon-btn" data-del-src="${s.id}" aria-label="${esc(s.term)} entfernen">🗑</button></li>`).join('')}
    </ul></div>` : '<div class="card empty"><div class="big">🎶</div><p class="muted">Noch keine Songs. Probier eine der Ideen oben!</p></div>'}
    ${songs.length ? `
      <details style="margin-top:16px">
        <summary>Alle Songs anzeigen</summary>
        <input type="search" id="filter" placeholder="Filtern …" style="margin:8px 0">
        <div class="card"><ul class="list" id="song-list">
          ${songs.map(s => `
            <li data-q="${esc((s.t + ' ' + s.a).toLowerCase())}">
              <button class="btn btn-ghost icon-btn" data-preview="${s.id}" aria-label="Hörprobe">▶</button>
              <div class="grow"><div class="ellipsis"><strong>${esc(s.t)}</strong></div><div class="muted small ellipsis">${esc(s.a)} · ${s.y}</div></div>
              <button class="btn btn-ghost btn-danger icon-btn" data-del-song="${s.id}" aria-label="Song entfernen">✕</button>
            </li>`).join('')}
        </ul></div>
      </details>` : ''}`;

  const form = view.querySelector('#search-form');
  form.onsubmit = e => {
    e.preventDefault();
    doSearch(form.term.value.trim(), form.attr.value, +form.limit.value, form.decade.value);
  };
  view.querySelectorAll('[data-term]').forEach(b => (b.onclick = () => doSearch(b.dataset.term, b.dataset.attr, +form.limit.value, form.decade.value)));
  wirePacks();
  view.querySelectorAll('[data-del-src]').forEach(b => (b.onclick = () => {
    removeSource(b.dataset.delSrc);
    renderSongs();
  }));
  view.querySelectorAll('[data-del-song]').forEach(b => (b.onclick = () => {
    removeSong(b.dataset.delSong);
    b.closest('li').remove();
  }));
  view.querySelectorAll('[data-preview]').forEach(b => (b.onclick = () => togglePreview(b)));
  view.querySelector('#filter')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    view.querySelectorAll('#song-list li').forEach(li => (li.hidden = !li.dataset.q.includes(q)));
  });
}

// ---------- Themenpakete ----------
let packLoad = null; // { id, done, total, found, stop }

function packStatus(pack) {
  const loaded = new Set(pool().filter(song => song.pack === pack.id).map(song => song.pk));
  const missing = new Set(store.packMisses[pack.id] || []);
  const open = pack.songs.filter(([a, t]) => !loaded.has(packKey(a, t)) && !missing.has(packKey(a, t)));
  return { loaded: loaded.size, missing: missing.size, open };
}

function packCard(pack) {
  const st = packStatus(pack);
  const running = packLoad?.id === pack.id;
  const total = pack.songs.length;
  let action;
  if (running) {
    const pct = Math.round((packLoad.done / packLoad.total) * 100);
    action = `
      <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%"></div></div>
      <div class="row"><span class="muted small grow" data-pack-msg>${packProgressText()}</span>
      <button class="btn btn-ghost" data-pack-stop>Anhalten</button></div>`;
  } else if (st.open.length) {
    action = `<button class="btn btn-primary btn-block" data-pack-load="${pack.id}">${st.loaded ? `Weiterladen (${st.open.length} offen)` : `Paket laden (${total} Songs)`}</button>`;
  } else {
    action = `<div class="row"><span class="badge grow" style="text-align:center">✓ Vollständig geladen</span>
      ${st.missing ? `<button class="btn btn-ghost" data-pack-retry="${pack.id}">Fehlende erneut suchen</button>` : ''}</div>`;
  }
  return `
    <div class="card stack" data-pack="${pack.id}">
      <div class="row"><span style="font-size:1.8rem" aria-hidden="true">${pack.icon}</span>
        <div class="grow"><strong>${esc(pack.name)}</strong><div class="muted small">${esc(pack.desc)}</div></div></div>
      <p class="muted small" data-pack-info>${packInfoText(pack)}</p>
      ${action}
    </div>`;
}

function packInfoText(pack) {
  const st = packStatus(pack);
  return `${st.loaded} von ${pack.songs.length} geladen${st.missing ? ` · ${st.missing} bei iTunes nicht gefunden` : ''} · Erscheinungsjahr aus der Hitliste`;
}

function packProgressText() {
  return packLoad.wait ? 'Kurze Pause (iTunes bremst) …' : `Lade ${packLoad.done} von ${packLoad.total} …`;
}

// Während des Ladens nur Balken und Texte anpassen, damit „Anhalten“ antippbar bleibt.
function updatePackProgress(pack) {
  const el = view.querySelector(`[data-pack="${pack.id}"]`);
  if (!el || !packLoad) return;
  const pct = Math.round((packLoad.done / packLoad.total) * 100);
  const bar = el.querySelector('.progress');
  if (bar) {
    bar.setAttribute('aria-valuenow', pct);
    bar.firstElementChild.style.width = pct + '%';
  }
  const msg = el.querySelector('[data-pack-msg]');
  if (msg) msg.textContent = packProgressText();
  el.querySelector('[data-pack-info]').textContent = packInfoText(pack);
}

function refreshPackCard(pack) {
  const el = view.querySelector(`[data-pack="${pack.id}"]`);
  if (!el) return;
  el.outerHTML = packCard(pack);
  wirePacks();
}

function wirePacks() {
  view.querySelectorAll('[data-pack-load]').forEach(b => (b.onclick = () => loadPack(PACKS.find(p => p.id === b.dataset.packLoad))));
  view.querySelectorAll('[data-pack-retry]').forEach(b => (b.onclick = () => {
    const pack = PACKS.find(p => p.id === b.dataset.packRetry);
    setPackMisses(pack.id, []);
    loadPack(pack);
  }));
  view.querySelectorAll('[data-pack-stop]').forEach(b => (b.onclick = () => packLoad && (packLoad.stop = true)));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Lädt die offenen Titel eines Pakets nacheinander (iTunes erlaubt nur ~20 Anfragen/Minute).
// Gefundene Songs landen sofort im Pool, Abbrechen und Weiterladen ist jederzeit möglich.
async function loadPack(pack) {
  if (packLoad) return;
  const todo = packStatus(pack).open;
  packLoad = { id: pack.id, done: 0, total: todo.length, found: 0, stop: false, wait: false };
  refreshPackCard(pack);
  const misses = new Set(store.packMisses[pack.id] || []);
  const backoff = window.__mqPackBackoff ?? 20000;
  let failures = 0;
  for (let i = 0; i < todo.length && !packLoad.stop; ) {
    const entry = todo[i];
    try {
      const song = await lookupPackSong(entry, { country: store.settings.country });
      if (song) {
        addSource(pack.name, 'pack', [{ ...song, pack: pack.id }], { packId: pack.id });
        packLoad.found++;
      } else {
        misses.add(packKey(entry[0], entry[1]));
        setPackMisses(pack.id, [...misses]);
      }
      failures = 0;
      i++;
      packLoad.done = i;
    } catch (err) {
      // Meist Drosselung durch iTunes: kurz warten und denselben Titel erneut versuchen.
      if (++failures > 4) {
        toast(`Laden unterbrochen: ${err.message}`);
        break;
      }
      packLoad.wait = true;
      updatePackProgress(pack);
      await sleep(backoff * failures);
      packLoad.wait = false;
    }
    if (currentTab === 'songs' && !quiz) updatePackProgress(pack);
    await sleep(window.__mqPackDelay ?? 400);
  }
  const { found } = packLoad;
  packLoad = null;
  toast(`${pack.name}: ${found} Songs hinzugefügt.`);
  if (currentTab === 'songs' && !quiz) renderSongs();
}

function togglePreview(btn) {
  const song = store.songs[btn.dataset.preview];
  if (!song) return;
  const isThis = audio.dataset.song === song.id && !audio.paused;
  view.querySelectorAll('[data-preview]').forEach(b => (b.textContent = '▶'));
  if (isThis) return audio.pause();
  loadPreview(song);
  playAudio().then(() => (btn.textContent = '❚❚')).catch(() => {});
}

async function doSearch(term, attr, limit, decade = '') {
  if (!term) return;
  const btn = view.querySelector('#search-btn');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Suche „${esc(term)}“ …`;
  store.settings.limit = limit;
  store.settings.searchDecade = decade;
  save();
  try {
    const { country, originalsOnly } = store.settings;
    // Mit Jahrzehnt-Filter so viele Treffer wie möglich holen, danach filtern.
    const found = await searchSongs(term, { attr, limit: decade ? 200 : limit, country, originalsOnly });
    const songs = found.filter(song => inDecade(song, decade)).slice(0, limit);
    const where = decade ? ` aus den ${decadeLabel(decade)}n` : '';
    if (!songs.length) {
      toast(`Keine Songs${where} mit Hörprobe für „${term}“ gefunden.`);
    } else {
      const added = addSource(decade ? `${term} · ${decadeLabel(decade)}` : term, attr, songs);
      toast(`${added} neue Songs${where} hinzugefügt (${songs.length} gefunden).`);
    }
  } catch (err) {
    toast(err.message);
  }
  if (currentTab === 'songs' && !quiz) renderSongs();
}

// ---------- Statistik ----------
function accuracyChart(rounds) {
  if (rounds.length < 2) return '<p class="muted small">Nach zwei Runden siehst du hier deinen Verlauf.</p>';
  const W = 320, H = 140, P = 22;
  const xs = i => P + (i * (W - 2 * P)) / (rounds.length - 1);
  const ys = v => H - P - (v / 100) * (H - 2 * P);
  const pts = rounds.map((r, i) => `${xs(i).toFixed(1)},${ys(pct(r.correct, r.total)).toFixed(1)}`);
  return `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Trefferquote der letzten ${rounds.length} Runden">
      ${[0, 50, 100].map(v => `<line class="grid" x1="${P}" x2="${W - P}" y1="${ys(v)}" y2="${ys(v)}"/><text x="2" y="${ys(v) + 3}">${v}%</text>`).join('')}
      <polygon class="area" points="${xs(0)},${ys(0)} ${pts.join(' ')} ${xs(rounds.length - 1)},${ys(0)}"/>
      <polyline class="line" points="${pts.join(' ')}"/>
    </svg>`;
}

function renderStats() {
  const rounds = store.rounds;
  const q = rounds.reduce((s, r) => s + r.total, 0);
  const c = rounds.reduce((s, r) => s + r.correct, 0);
  const songs = store.songs;
  const problem = {};
  for (const [key, it] of Object.entries(store.items)) {
    const id = key.split(':')[1];
    if (!songs[id] || !it.w) continue;
    problem[id] = problem[id] || { song: songs[id], w: 0, c: 0 };
    problem[id].w += it.w;
    problem[id].c += it.c;
  }
  const problems = Object.values(problem).sort((a, b) => b.w - b.c - (a.w - a.c) || b.w - a.w).slice(0, 10);

  if (!rounds.length) {
    view.innerHTML = `<h1>Statistik</h1><div class="card empty"><div class="big">📊</div><p class="muted">Spiel deine erste Runde – dann siehst du hier deinen Fortschritt.</p></div>`;
    return;
  }
  view.innerHTML = `
    <h1>Statistik</h1>
    <div class="kpis" style="margin-top:12px">
      <div class="card kpi"><div class="v">${rounds.length}</div><div class="l">Runden</div></div>
      <div class="card kpi"><div class="v">${q}</div><div class="l">Fragen</div></div>
      <div class="card kpi"><div class="v">${pct(c, q)} %</div><div class="l">Trefferquote</div></div>
    </div>
    <h2>Trefferquote im Verlauf</h2>
    <div class="card chart">${accuracyChart(rounds.slice(-30))}</div>
    <h2>Nach Modus</h2>
    <div class="card"><table>
      <thead><tr><th>Modus</th><th class="num">Runden</th><th class="num">Quote</th><th class="num">Bestwert</th></tr></thead>
      <tbody>${Object.entries(MODES).map(([k, m]) => {
        const rs = rounds.filter(r => r.mode === k);
        if (!rs.length) return '';
        const t = rs.reduce((s, r) => s + r.total, 0), cc = rs.reduce((s, r) => s + r.correct, 0);
        return `<tr><td>${m.icon} ${m.name}</td><td class="num">${rs.length}</td><td class="num">${pct(cc, t)} %</td><td class="num">${Math.max(...rs.map(r => r.score))}</td></tr>`;
      }).join('')}</tbody>
    </table></div>
    <h2>Deine Problem-Songs</h2>
    ${problems.length ? `<div class="card"><ul class="list">${problems.map(p => `
      <li>
        <button class="btn btn-ghost icon-btn" data-preview="${p.song.id}" aria-label="Hörprobe">▶</button>
        <div class="grow"><div class="ellipsis"><strong>${esc(p.song.t)}</strong> — ${esc(p.song.a)}</div><div class="muted small">${p.song.y} · ${p.w}× falsch, ${p.c}× richtig</div></div>
      </li>`).join('')}</ul></div>` : '<p class="muted">Keine – stark! 💪</p>'}
    <button class="btn btn-ghost btn-danger btn-block" id="reset" style="margin-top:20px">Statistik zurücksetzen</button>`;
  view.querySelectorAll('[data-preview]').forEach(b => (b.onclick = () => togglePreview(b)));
  view.querySelector('#reset').onclick = () => {
    if (confirm('Statistik und Lernstand wirklich löschen? Deine Songs bleiben erhalten.')) {
      resetStats();
      renderStats();
    }
  };
}

// ---------- Optionen ----------
function renderSettings() {
  const s = store.settings;
  const opt = (vals, cur, label = v => v) => vals.map(v => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${label(v)}</option>`).join('');
  view.innerHTML = `
    <h1>Optionen</h1>
    <div class="card stack" style="margin-top:12px">
      <label class="field"><span>Fragen pro Runde</span><select data-set="count">${opt([5, 10, 15, 20, 30], s.count)}</select></label>
      <label class="field"><span>Countdown pro Frage</span><select data-set="timer">${opt([0, 10, 15, 20, 30, 45, 60], s.timer, v => (v ? `${v} Sekunden` : 'Aus'))}</select></label>
      <label class="field"><span>Antwort bei „Song erkennen“</span><select data-set="answerMode">${opt(['mc', 'text'], s.answerMode, v => (v === 'mc' ? 'Multiple Choice (4 Optionen)' : 'Freitext (wie im echten Quiz)'))}</select></label>
      <p class="muted small">Mit Countdown gibt es Punkte für Schnelligkeit: sofort geantwortet = 100 %, kurz vor Ablauf = 50 %.</p>
    </div>
    <h2>Songsuche</h2>
    <div class="card stack">
      <label class="field"><span>iTunes-Store-Land</span><select data-set="country">${opt(['DE', 'AT', 'CH', 'US', 'GB'], s.country)}</select></label>
      <label class="row"><input type="checkbox" data-set="originalsOnly" ${s.originalsOnly ? 'checked' : ''} style="width:20px;height:20px"> <span>Live-, Karaoke-, Remix- und Cover-Versionen ausblenden</span></label>
      <button class="btn btn-block" id="diagnose">🔌 Verbindung testen</button>
      <ul class="list small" id="diag-out"></ul>
      <p class="muted small">Hinweis: Das Erscheinungsjahr stammt aus dem iTunes-Katalog. Bei Neuauflagen kann es vom Original abweichen – die App nimmt deshalb immer das früheste gefundene Jahr.</p>
    </div>
    <h2>App & Daten</h2>
    <div class="card stack">
      ${deferredInstall ? '<button class="btn btn-primary btn-block" id="install">📲 App installieren</button>' : `<p class="muted small">${matchMedia('(display-mode: standalone)').matches ? '✅ Die App ist installiert.' : 'Installieren: im Browsermenü „Zum Startbildschirm hinzufügen“ bzw. „App installieren“ wählen (iPhone: Teilen → Zum Home-Bildschirm).'}</p>`}
      <div class="row">
        <button class="btn grow" id="export">Sicherung exportieren</button>
        <button class="btn grow" id="import">Sicherung importieren</button>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </div>
    </div>`;
  view.querySelectorAll('[data-set]').forEach(el => (el.onchange = () => {
    const k = el.dataset.set;
    s[k] = el.type === 'checkbox' ? el.checked : /^\d+$/.test(el.value) ? +el.value : el.value;
    save();
    toast('Gespeichert');
  }));
  view.querySelector('#install')?.addEventListener('click', install);
  view.querySelector('#diagnose').onclick = async e => {
    const btn = e.currentTarget, list = view.querySelector('#diag-out');
    btn.disabled = true;
    list.innerHTML = '<li><span class="spinner"></span> Teste …</li>';
    const rows = await diagnose();
    list.innerHTML = rows.map(r => `<li><span class="mark ${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'}</span><div class="grow"><strong>${esc(r.name)}</strong><div class="muted" style="overflow-wrap:anywhere">${esc(r.detail)}</div></div></li>`).join('');
    btn.disabled = false;
  };
  view.querySelector('#export').onclick = () => {
    const url = URL.createObjectURL(new Blob([exportData()], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `musikquiz-sicherung-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const file = view.querySelector('#import-file');
  view.querySelector('#import').onclick = () => file.click();
  file.onchange = async () => {
    try {
      importData(await file.files[0].text());
      toast('Sicherung geladen');
      renderSettings();
    } catch (e) {
      toast(e.message);
    }
  };
}

// ---------- PWA ----------
async function install() {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  render();
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  if (!quiz && (currentTab === 'home' || currentTab === 'settings')) render();
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker nicht registriert', err));
}

render();
