// WEİZEND — Cloudflare Pages share previews.
// Tournament/team-invite previews are rendered here. Giveaway/product/lobby
// previews are delegated to the existing Worker share implementation so that
// Pages does not shadow the Worker's /paylas/{cekilis,urun,lobi}/:id routes.
// The original site-domain URL remains canonical; the Worker serves preview
// image bytes directly from its workers.dev endpoint to avoid a Pages 404 loop.

const SITE = 'https://www.weizend.com';
const WORKER_SHARE_API = 'https://weizend-botrix.weizendtv.workers.dev';
const TOURNAMENT_API = WORKER_SHARE_API + '/tournaments';
const ARENA_COVER = SITE + '/arena-paylasim.jpg';
const INVITE_COVER = SITE + '/takim-davet-paylasim.jpg';
const ID_PATTERN = /^[A-Za-z0-9_-]{1,110}$/;
const FETCH_TIMEOUT_MS = 3500;
const CACHE_MS = 10 * 60 * 1000;

// Aynı çalışan Pages Function örneğinde 10 dakika veriyi yeniden isteme.
// Örnekler arasında paylaşım garantili değildir; sosyal sayfa cache'lenir.
let catalog = null;
let catalogExpires = 0;
let pendingCatalog = null;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function safeImage(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    if (u.protocol !== 'https:' || u.username || u.password) return '';
    // Yalnızca güvenilir harici görseller veya kendi alan adımız.
    if (u.hostname !== 'www.weizend.com' && u.hostname !== 'i.hizliresim.com') return '';
    return u.href;
  } catch { return ''; }
}
async function getCatalog() {
  if (catalog && Date.now() < catalogExpires) return catalog;
  if (pendingCatalog) return pendingCatalog;
  pendingCatalog = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(TOURNAMENT_API, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
          cf: { cacheTtl: 600, cacheEverything: true }
        });
        if (!response.ok) return catalog || [];
        const data = await response.json();
        if (!data?.success || !Array.isArray(data.tournaments)) return catalog || [];
        catalog = data.tournaments;
        catalogExpires = Date.now() + CACHE_MS;
        return catalog;
      } finally { clearTimeout(timer); }
    } catch {
      return catalog || [];
    } finally { pendingCatalog = null; }
  })();
  return pendingCatalog;
}
function previewHtml({ title, description, image, pageUrl, destination, label }) {
  const safeDestination = JSON.stringify(destination).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="WEİZEND">
<meta property="og:locale" content="tr_TR"><meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}"><meta property="og:image:alt" content="${esc(label)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(image)}">
<link rel="icon" href="/favicon.ico">
<style>body{background:#08090d;color:white;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}main{text-align:center;padding:24px;max-width:580px}h1{color:#f33}a{display:inline-block;background:#cc151c;border-radius:10px;padding:13px 20px;color:white;font-weight:800;text-decoration:none}</style>
<script>window.location.replace(${safeDestination});</script></head>
<body><main><h1>${esc(title)}</h1><p>${esc(description)}</p><p><a href="${esc(destination)}">${esc(label)} — Aç</a></p></main></body></html>`;
}

export async function onRequestGet(context) {
  const kind = String(context.params.tip || '');
  const id = String(context.params.id || '');
  const supportedKinds = ['turnuva', 'davet', 'cekilis', 'urun', 'lobi'];
  if (!supportedKinds.includes(kind) || !ID_PATTERN.test(id)) {
    return new Response('Sayfa bulunamadı.', { status: 404, headers: {'Content-Type':'text/plain; charset=utf-8'} });
  }
  const slug = encodeURIComponent(id);

  // These three routes already have authoritative D1-backed handlers in the
  // Worker. Delegate their HTML to it, but rewrite preview-image URLs to the
  // Worker host: otherwise the same-domain Pages function would receive
  // ?og_image=1 and return 404 instead of image bytes.
  if (['cekilis', 'urun', 'lobi'].includes(kind)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const upstream = await fetch(`${WORKER_SHARE_API}/paylas/${kind}/${slug}`, {
        method: 'GET',
        headers: { Accept: 'text/html' },
        signal: controller.signal,
        redirect: 'manual'
      });
      if (!upstream.ok) {
        return new Response(upstream.status === 404 ? 'Paylaşım içeriği bulunamadı.' : 'Paylaşım önizlemesi şu anda alınamıyor.', {
          status: upstream.status === 404 ? 404 : 502,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
        });
      }
      let html = await upstream.text();
      const sourcePrefix = `${SITE}/paylas/${kind}/${slug}?og_image=1`;
      const workerPrefix = `${WORKER_SHARE_API}/paylas/${kind}/${slug}?og_image=1`;
      html = html.split(sourcePrefix).join(workerPrefix);
      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=120, s-maxage=600',
          'X-Content-Type-Options': 'nosniff',
          'X-Robots-Tag': 'noindex, follow',
          'Referrer-Policy': 'strict-origin-when-cross-origin'
        }
      });
    } catch (error) {
      const timedOut = controller.signal.aborted;
      return new Response(timedOut ? 'Paylaşım önizlemesi zaman aşımına uğradı.' : 'Paylaşım önizlemesi alınamadı.', {
        status: 502,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    } finally {
      clearTimeout(timer);
    }
  }
  const pageUrl = `${SITE}/paylas/${kind}/${slug}`;
  const destination = `${SITE}/?turnuva=${slug}`;
  let name = '';
  let image = kind === 'davet' ? INVITE_COVER : ARENA_COVER;
  // Davet kapak görseli ve başlığı her zaman özel; davet kodu asla URL'ye geçmez.
  // Turnuva görselini sadece açık, genel katalogdan al.
  if (kind === 'turnuva') {
    const items = await getCatalog();
    const item = items.find(x => String(x?.id || '') === id);
    name = String(item?.name || '').trim().slice(0, 95);
    image = safeImage(item?.cardImageUrl) || safeImage(item?.heroImageUrl) || ARENA_COVER;
  }
  const label = kind === 'davet' ? 'Takım davetine git' : 'Turnuvayı görüntüle';
  // "VALORANT" -> "VALORANT TURNUVASI"; isimde TURNUVASI zaten varsa tekrar ekleme.
  const baseTournamentName = name.replace(/\s+turnuvas[ıi]\s*$/iu, '').trim();
  const tournamentTitle = baseTournamentName
    ? `${baseTournamentName.toLocaleUpperCase('tr-TR')} TURNUVASI`
    : 'WEİZEND TURNUVASI';
  const title = kind === 'davet'
    ? 'Takıma Davetlisin! | WEİZEND ARENA'
    : `${tournamentTitle} | WEİZEND ARENA`;
  const description = kind === 'davet'
    ? 'Bir WEİZEND turnuvası takımına davetlisin! Bağlantıyı aç, Kick hesabınla doğrulan ve sana gönderilen özel davet koduyla takıma katıl.'
    : baseTournamentName
      ? `${tournamentTitle} detaylarını ve katılım koşullarını keşfet. Takımını kur, turnuvaya katıl ve WEİZEND ARENA'da mücadele et.`
      : 'WEİZEND turnuva detaylarını görüntüle, takımını kur ve ARENA heyecanına katıl.';
  const html = previewHtml({ title, description, image, pageUrl, destination, label });
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=120, s-maxage=600',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, follow',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    }
  });
}
