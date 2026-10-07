// Leitet Hörproben von Apple durch, falls das Gerät sie nicht direkt laden kann.
// Nur Apple-Hosts sind erlaubt, damit das kein offener Proxy wird.
const ALLOWED_HOSTS = /(^|\.)(apple\.com|mzstatic\.com)$/;
const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

export async function GET(request) {
  let target;
  try {
    target = new URL(new URL(request.url).searchParams.get('u') || '');
  } catch {
    return new Response('Ungültige Adresse', { status: 400 });
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.test(target.hostname)) {
    return new Response('Adresse nicht erlaubt', { status: 403 });
  }

  // Safari spielt Audio nur mit Byte-Range-Unterstützung ab, daher Range durchreichen.
  const headers = { 'User-Agent': 'Musikquiz-Trainer/1.0' };
  const range = request.headers.get('range');
  if (range) headers.Range = range;

  try {
    const res = await fetch(target, { headers });
    const out = new Headers({ 'Cache-Control': 'public, max-age=86400' });
    for (const h of PASS_HEADERS) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(res.body, { status: res.status, headers: out });
  } catch (e) {
    return new Response(`Hörprobe nicht erreichbar: ${e.message}`, { status: 502 });
  }
}
