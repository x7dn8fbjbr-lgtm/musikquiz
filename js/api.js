// Songsuche über die öffentliche iTunes Search API (JSONP, da CORS nicht garantiert ist).
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
      reject(new Error('Zeitüberschreitung bei der Songsuche'));
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
      reject(new Error('Songsuche nicht erreichbar – bist du online?'));
    };
    script.src = url + '&callback=' + cb;
    document.head.appendChild(script);
  });
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
  const data = await jsonp(`${ENDPOINT}?${params}`);

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
