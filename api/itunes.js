// Vermittler für die iTunes Search API. Manche iPhones erreichen itunes.apple.com
// aus Safari nicht; der Server fragt stellvertretend an und liefert JSON zurück.
const ALLOWED = ['term', 'media', 'entity', 'limit', 'country', 'attribute', 'lang'];

export async function GET(request) {
  const incoming = new URL(request.url).searchParams;
  const params = new URLSearchParams();
  for (const key of ALLOWED) if (incoming.has(key)) params.set(key, incoming.get(key));
  if (!params.get('term')) return Response.json({ error: 'Parameter term fehlt' }, { status: 400 });

  try {
    const res = await fetch(`https://itunes.apple.com/search?${params}`, {
      headers: { 'User-Agent': 'Musikquiz-Trainer/1.0', Accept: 'application/json' },
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': res.ok ? 'public, s-maxage=86400' : 'no-store',
      },
    });
  } catch (e) {
    return Response.json({ error: `iTunes nicht erreichbar: ${e.message}` }, { status: 502 });
  }
}
