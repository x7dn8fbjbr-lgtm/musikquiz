// Songsuche über die öffentliche iTunes Search API: erst direkt per fetch, dann per JSONP.
const ENDPOINT = 'https://itunes.apple.com/search';

const VARIANT_RE = /\b(live|karaoke|instrumental|remix|re-?mix|tribute|cover|made famous|medley|acapella|a cappella|demo|workout|lullaby|piano version|8-bit)\b/i;
const NOISE_PARENS_RE = /\s*[([][^)\]]*\b(remaster(ed)?|version|edit|mono|stereo|single|mix|anniversary|deluxe|bonus|from|soundtrack)\b[^)\]]*[)\]]/gi;
const NOISE_DASH_RE = /\s+-\s+.*\b(remaster(ed)?|version|edit|mono|stereo|single|mix)\b.*$/i;

function jsonp(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const cb = 'itunes_cb_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Zeitüberschreitung'));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
    }
    window[cb] = data => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('Skript blockiert oder umgeleitet'));
    };
    script.src = url + '&callback=' + cb;
    document.head.appendChild(script);
  });
}

async function viaFetch(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Zeitüberschreitung');
    if (e instanceof TypeError) throw new Error('blockiert (Netzwerk/CORS)');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const METHODS = [
  ['Direkt (fetch)', viaFetch],
  ['JSONP', jsonp],
];

async function itunes(url) {
  const errors = [];
  for (const [name, method] of METHODS) {
    try {
      return await method(url);
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  if (navigator.onLine === false) throw new Error('Keine Internetverbindung.');
  throw new Error(`iTunes-Suche nicht erreichbar (${errors.join(' · ')}). Optionen → „Verbindung testen“ zeigt Details.`);
}

// Prüft jeden Verbindungsweg einzeln, damit Fehler auf dem Gerät nachvollziehbar sind.
export async function diagnose() {
  const url = `${ENDPOINT}?term=abba&media=music&entity=song&limit=3&country=DE`;
  const out = [{ name: 'Browser meldet online', ok: navigator.onLine !== false, detail: navigator.userAgent }];
  for (const [name, method] of METHODS) {
    const t0 = performance.now();
    try {
      const d = await method(url);
      const r = d.results?.[0];
      out.push({ name, ok: true, detail: `${d.resultCount ?? 0} Treffer in ${Math.round(performance.now() - t0)} ms${r ? ` (z. B. ${r.trackName} – ${r.previewUrl ? 'mit' : 'ohne'} Hörprobe)` : ''}` });
    } catch (e) {
      out.push({ name, ok: false, detail: e.message });
    }
  }
  return out;
}

export function cleanTitle(t) {
  return t.replace(NOISE_PARENS_RE, '').replace(NOISE_DASH_RE, '').trim();
}

function cleanAlbum(a) {
  return (a || '').replace(/\s+-\s+(single|ep)$/i, '').trim();
}

export function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[([].*?[)\]]/g, ' ')
    .replace(/\b(feat|ft|featuring)\b.*$/, ' ')
    .replace(/&/g, ' und ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/^(the|die|der|das) /, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function searchSongs(term, { attr = 'all', limit = 100, country = 'DE', originalsOnly = true } = {}) {
  const params = new URLSearchParams({
    term,
    media: 'music',
    entity: 'song',
    limit: String(Math.min(200, limit)),
    country,
  });
  if (attr === 'artist') params.set('attribute', 'artistTerm');
  if (attr === 'song') params.set('attribute', 'songTerm');
  const data = await itunes(`${ENDPOINT}?${params}`);

  // Gleicher Song auf mehreren Alben/Compilations -> ältestes Erscheinungsjahr behalten.
  const byKey = new Map();
  for (const r of data.results || []) {
    if (r.kind !== 'song' || !r.previewUrl || !r.trackName || !r.artistName) continue;
    if (originalsOnly && (VARIANT_RE.test(r.trackName) || VARIANT_RE.test(r.collectionName || ''))) continue;
    const year = r.releaseDate ? new Date(r.releaseDate).getFullYear() : null;
    if (!year) continue;
    const song = {
      id: String(r.trackId),
      t: cleanTitle(r.trackName),
      a: r.artistName,
      al: cleanAlbum(r.collectionName),
      y: year,
      g: r.primaryGenreName || '',
      p: r.previewUrl,
      art: (r.artworkUrl100 || '').replace('100x100bb', '300x300bb'),
    };
    const key = normalize(song.t) + '|' + normalize(song.a);
    const prev = byKey.get(key);
    if (!prev || song.y < prev.y) byKey.set(key, song);
  }
  return [...byKey.values()];
}
