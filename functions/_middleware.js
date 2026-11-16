// רשת ביטחון נגד 404 (Cloudflare Pages Function).
// כל בקשה עוברת קודם לקבצים הסטטיים. רק כשהתשובה היא 404:
// 1. הפניה מדויקת מ-/data/redirects-map.json (נבנה ב-build.js מאותן שורות של _redirects, בלי מגבלת 2000)
// 2. כתובת עם .html: מסירים את הסיומת ובודקים שוב
// 3. אחרת עולים בעץ התיקיות עד לתיקייה שקיימת (מופע שהסתיים ב-/plays/... עובר ל-/plays/)
// אם לא נמצא יעד, מחזירים את ה-404 המקורי.

const FALLBACK = {
  artist: '/артисты/',
  venues: '/magazine/гид-по-залам-где-лучше-сидеть/',
};

let MAP = null;

async function loadMap(ctx, origin) {
  if (MAP) return MAP;
  try {
    const r = await ctx.env.ASSETS.fetch(new URL('/data/redirects-map.json', origin));
    MAP = r.ok ? await r.json() : {};
  } catch (e) {
    MAP = {};
  }
  return MAP;
}

async function exists(ctx, origin, p) {
  const r = await ctx.env.ASSETS.fetch(new URL(encodeURI(p), origin), { redirect: 'manual' });
  return r.status === 200;
}

function redirect(origin, to, code, search) {
  const u = new URL(to.startsWith('/') ? to : '/' + to, origin);
  if (search && !u.search) u.search = search;
  return new Response(null, { status: code, headers: { Location: u.toString(), 'Cache-Control': 'public, max-age=3600' } });
}

export async function onRequest(ctx) {
  const res = await ctx.next();
  if (res.status !== 404) return res;
  const method = ctx.request.method;
  if (method !== 'GET' && method !== 'HEAD') return res;

  const url = new URL(ctx.request.url);
  let p;
  try { p = decodeURIComponent(url.pathname); } catch (e) { return res; }

  // 1. הפניה מדויקת (עם ובלי לוכסן בסוף, עם ובלי .html)
  const map = await loadMap(ctx, url.origin);
  const noHtml = p.replace(/\.html$/, '');
  for (const k of [p, noHtml, noHtml.replace(/\/$/, ''), noHtml.replace(/\/?$/, '/')]) {
    const hit = map[k];
    if (hit) return redirect(url.origin, hit[0], hit[1], url.search);
  }

  // 2. .html שלא נמצא: הכתובת הנקייה, אם היא קיימת
  if (noHtml !== p && await exists(ctx, url.origin, noHtml.replace(/\/?$/, '/'))) {
    return redirect(url.origin, noHtml.replace(/\/?$/, '/'), 301, url.search);
  }

  // 3. עולים בעץ התיקיות
  const segs = noHtml.split('/').filter(Boolean);
  for (let i = segs.length - 1; i >= 1; i--) {
    const up = '/' + segs.slice(0, i).join('/') + '/';
    if (await exists(ctx, url.origin, up)) return redirect(url.origin, up, 301, url.search);
  }
  if (segs.length && FALLBACK[segs[0]]) return redirect(url.origin, FALLBACK[segs[0]], 301, url.search);
  return res;
}
