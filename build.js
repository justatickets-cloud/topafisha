/* ==========================================================================
   ТОП Афиша | TopAfisha  -  build.js
   Русскоязычный сайт мероприятий в Израиле (Cloudflare Pages)
   Читает shows.json (русский фид Bravo) и генерирует статический сайт в dist/
   Запуск:  node build.js
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

/* ----------------------------- Настройки бренда ------------------------------ */
const BRAND = {
  nameHe: 'ТОП Афиша',                 // основное отображаемое имя (кириллица)
  nameEn: 'TopAfisha',
  domain: 'https://topafisha.co.il',   // основной домен
  affiliateBase: 'https://top.kassa.co.il', // база покупки (партнёр Bravo)
  tagline: 'Все мероприятия в одном месте',
  altSite: 'https://idir.co.il',       // сайт на иврите (переключатель языка)
  email: 'contact@topafisha.co.il',
  outDir: path.join(__dirname, 'dist'),
  dataFile: path.join(__dirname, 'shows.json'),
  limit: 0, // 0 = все мероприятия ; положительное число = лимит
  adsenseClient: 'ca-pub-0718695615942520',
  adsTxt: 'google.com, pub-0718695615942520, DIRECT, f08c47fec0942fa0',
  ga4: 'G-M38QT7FEQL',
};

/* ------------------------------ Текстовые помощники ------------------------------- */
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

// escaping полный — для значений атрибутов (включая кавычки)
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// escaping для видимого текста: оставляет кавычки как есть (чистый вывод)
function escText(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// оставляет базовые теги описания, убирает скрипты и опасные атрибуты
function safeHtml(html) {
  return String(html || '')
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '');
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(iso) {
  // "2026-12-26" -> "суббота, 26 декабря 2026"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return esc(iso);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${DAYS[d.getDay()]}, ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

function formatTime(t) {
  const m = /^(\d{2}):(\d{2})/.exec(String(t || ''));
  return m ? `${m[1]}:${m[2]}` : esc(t);
}

// Цена: одна цена => "X ₪" ; диапазон => "от X ₪"
function priceLabel(min, max) {
  const a = Number(min), b = Number(max);
  if (!a && !b) return 'Цена уточняется';
  if (!b || a === b) return `${a} ₪`;
  return `от ${a} ₪`;
}

function affiliateUrl(link) {
  const l = String(link || '');
  return BRAND.affiliateBase + (l.startsWith('/') ? l : '/' + l);
}

// Доступность: сеанс распродан, если нет билетов (tickets===0) или нет ссылки покупки
function seanceSoldOut(s) { return Number(s.tickets) === 0 || !s.link; }
// Мероприятие полностью распродано, если все сеансы распроданы
function showSoldOut(show) {
  const ses = show.Seances || [];
  return ses.length > 0 && ses.every(seanceSoldOut);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/* ---- Помощники дат на сервере (часовой пояс Израиля, устойчиво к DST) ---- */
function pad2(n) { return String(n).padStart(2, '0'); }
function ymdStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function addDays(base, n) { const x = new Date(base); x.setDate(x.getDate() + n); return x; }

function israelToday() {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/* ---- Иерархические URL: категория + слаг мероприятия ---- */
const CATEGORY_SLUGS = {
  'Концерты в Израиле': 'concerts',
  'Джаз концерты': 'jazz',
  'Концерты классической музыки': 'classical',
  'Спектакли': 'plays',
  'Балет и танец': 'ballet-dance',
  'Спектакли для детей': 'kids-plays',
  'Стенд ап': 'standup',
  'Опера': 'opera',
  'Цирк': 'circus',
  'Лекции и Мастер-классы': 'lectures',
  'Кино': 'cinema',
  'Выставки': 'exhibitions',
  'Мюзиклы': 'musicals',
  'Музыка для детей': 'kids-music',
  'Парки и аттракции': 'attractions',
  'Час рассказа': 'story-time',
};
function categorySlug(section) { return CATEGORY_SLUGS[section] || 'events'; }

// Слаг из названия: оставляет буквы/цифры, пробелы и дефисы -> один дефис
function slugify(str) {
  return String(str || '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Ограничение длины сегмента пути по БАЙТАМ (Linux/ext4 лимит имени папки — 255 байт;
// кириллица в UTF-8 = 2 байта на символ). Обрезаем по границе символа, без разрыва.
function capSlugBytes(str, maxBytes) {
  if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str;
  let out = '', bytes = 0;
  for (const ch of str) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > maxBytes) break;
    out += ch; bytes += b;
  }
  return out.replace(/-+$/, '');
}

// Назначает каждому мероприятию путь (_dir) и URL (_url)
function assignShowUrls(shows) {
  const used = new Set();
  const SUFFIX = 'билеты-и-расписание';
  for (const s of shows) {
    const cat = categorySlug(s.section);
    // ограничиваем имя до 150 байт, чтобы весь сегмент (имя + суффикс + id) не превысил лимит ФС
    const nameSlug = capSlugBytes(slugify(s.name) || String(s.id), 150);
    let rel = `${cat}/${nameSlug}-${SUFFIX}`;
    if (used.has(rel)) rel = `${cat}/${nameSlug}-${s.id}-${SUFFIX}`;
    used.add(rel);
    s._dir = rel;
    s._url = `/${rel}/`;
  }
}

/* --------------------------- Загрузка данных ----------------------------- */
// Декодирование HTML-сущностей из фида (&nbsp; &mdash; и т.д.) для названий
function decodeEntities(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&hellip;/g, '…')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeShows(shows) {
  const clean = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v);
  shows.forEach(show => {
    show.name = decodeEntities(show.name);
    show.announce = decodeEntities(show.announce);
    (show.Seances || []).forEach(se => {
      se.city = clean(se.city);
      se.hall = decodeEntities(se.hall);
    });
  });
  return shows;
}

function loadShows() {
  const raw = JSON.parse(fs.readFileSync(BRAND.dataFile, 'utf8'));
  const all = Array.isArray(raw) ? raw : (raw.Shows || raw.shows || raw.data || []);
  const selected = BRAND.limit > 0 ? all.slice(0, BRAND.limit) : all;
  return normalizeShows(selected);
}

/* ------------------------------ Шаблон страницы ------------------------------ */
function page({ title, description, canonical, head = '', body }) {
  const gtag = BRAND.ga4 ? `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${BRAND.ga4}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${BRAND.ga4}');
</script>` : '';
  return `<!doctype html>
<html lang="ru" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${gtag}
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="${esc(BRAND.nameHe)}">
<meta name="theme-color" content="#6d1f4b">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${BRAND.adsenseClient}" crossorigin="anonymous"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700;800&display=swap">
<link rel="stylesheet" href="/assets/styles.css">
<script>try{var _s=JSON.parse(localStorage.getItem('topafisha-a11y')||'{}'),_r=document.documentElement;if(_s.font)_r.style.zoom=(1+Math.max(-2,Math.min(6,_s.font))*0.1).toFixed(2);if(_s.contrast==='high')_r.classList.add('a11y-contrast-high');if(_s.contrast==='inverted')_r.classList.add('a11y-invert');if(_s.underline)_r.classList.add('a11y-underline');if(_s.readable)_r.classList.add('a11y-readable');}catch(e){}</script>
${head}
</head>
<body>
${siteHeader()}
${body}
${siteFooter()}
${a11yWidget()}
<script src="/assets/accessibility.js" defer></script>
</body>
</html>`;
}

function siteHeader() {
  return `<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/" aria-label="${esc(BRAND.nameHe)}">
      <img src="/assets/logo.svg" alt="${esc(BRAND.nameHe)}" class="site-logo" width="188" height="40">
    </a>
    <nav class="top-nav">
      <a href="/">Все мероприятия</a>
      <a href="/артисты/">Артисты</a>
      <a href="/magazine/">Журнал</a>
      <a href="${esc(BRAND.altSite)}" class="lang-switch" hreflang="he" title="עברית">עברית</a>
    </nav>
  </div>
</header>`;
}

function siteFooter() {
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
  <div class="wrap footer-grid">

    <div class="footer-col footer-about">
      <div class="foot-brand">${escText(BRAND.nameHe)} · ${escText(BRAND.nameEn)}</div>
      <p class="foot-desc">
        Портал культуры и событий Израиля. У нас вы найдёте билеты на концерты, театральные спектакли, стендап, фестивали и детские представления по всей стране — с актуальным расписанием в реальном времени и безопасной покупкой.
      </p>
    </div>

    <div class="footer-col">
      <h3 class="footer-title">Мероприятия и культура</h3>
      <ul class="footer-links">
        <li><a href="/артисты/">Артисты и мероприятия</a></li>
        <li><a href="/#section=Концерты в Израиле">Живые концерты</a></li>
        <li><a href="/#section=Спектакли">Театральные спектакли</a></li>
        <li><a href="/#section=Стенд ап">Стендап и юмор</a></li>
        <li><a href="/#section=Спектакли для детей">Детские представления</a></li>
        <li><a href="/#section=Концерты классической музыки">Классическая музыка</a></li>
      </ul>
    </div>

    <div class="footer-col">
      <h3 class="footer-title">Билеты по городам</h3>
      <ul class="footer-links">
        <li><a href="/афиша-тель-авив/">Мероприятия в Тель-Авиве и центре</a></li>
        <li><a href="/афиша-иерусалим/">Концерты и спектакли в Иерусалиме</a></li>
        <li><a href="/афиша-хайфа/">События в Хайфе и на севере</a></li>
        <li><a href="/афиша-беэр-шева/">Мероприятия в Беэр-Шеве и на юге</a></li>
        <li><a href="/#city=Ашдод">Концерты в Ашдоде</a></li>
      </ul>
    </div>

    <div class="footer-col">
      <h3 class="footer-title">Ведущие залы</h3>
      <ul class="footer-links">
        <li><span>Дворец культуры Тель-Авив</span></li>
        <li><span>Театры Габима и Камери</span></li>
        <li><span>Заппа и Менора Мивтахим</span></li>
        <li><span>Центр сценических искусств</span></li>
        <li><span>Амфитеатр Кейсария</span></li>
      </ul>
    </div>

  </div>

  <div class="wrap footer-timing">
    <span class="footer-timing-label">По дате:</span>
    <a href="/афиша-сегодня.html">Афиша на сегодня</a>
    <a href="/афиша-на-выходные.html">На выходные</a>
    <a href="/афиша-на-неделю.html">На неделю</a>
    <a href="/афиша-на-месяц.html">На месяц</a>
    <a href="/афиша-2026.html">Афиша 2026</a>
    <a href="/афиша-2027.html">Афиша 2027</a>
  </div>

  <div class="footer-bottom wrap">
    <div class="foot-copy">© ${year} ${escText(BRAND.nameHe)} (topafisha.co.il). Все права защищены.</div>
    <div class="footer-legal-links">
      <a href="/privacy.html">Политика конфиденциальности</a> ·
      <a href="/terms.html">Условия использования</a> ·
      <a href="/magazine/${encodeURI('частые-вопросы-о-покупке-билетов')}/">Вопросы и помощь</a> ·
      <a href="/contact.html">Контакты</a>
    </div>
    <div class="foot-disclaimer">Покупка билетов | Информация, расписание и билеты регулярно обновляются.</div>
  </div>
</footer>`;
}

/* --------------------------- Виджет доступности ------------------------------- */
function a11yWidget() {
  return `<!-- Виджет доступности -->
<div id="a11y-widget" class="a11y-widget">
  <button id="a11y-trigger" class="a11y-btn" aria-label="Открыть меню доступности" aria-expanded="false">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm9 7h-6v13h-2v-6h-2v6H9V9H3V7h18v2z"/>
    </svg>
  </button>

  <div id="a11y-modal" class="a11y-menu" role="dialog" aria-modal="false" aria-label="Меню доступности" hidden>
    <div class="a11y-header">
      <h3>Доступность</h3>
      <button id="a11y-close" class="a11y-close-btn" aria-label="Закрыть меню доступности">&times;</button>
    </div>
    <div class="a11y-tools">
      <button class="a11y-tool" data-action="font-plus">Увеличить текст (+)</button>
      <button class="a11y-tool" data-action="font-minus">Уменьшить текст (−)</button>
      <button class="a11y-tool" data-action="contrast-high" aria-pressed="false">Высокий контраст</button>
      <button class="a11y-tool" data-action="contrast-inverted" aria-pressed="false">Оттенки серого / инверсия</button>
      <button class="a11y-tool" data-action="underline-links" aria-pressed="false">Подчеркнуть ссылки</button>
      <button class="a11y-tool" data-action="readable-font" aria-pressed="false">Читаемый шрифт</button>
      <button class="a11y-tool a11y-reset" data-action="reset">Сбросить настройки</button>
    </div>
    <div class="a11y-footer">
      <small>Сайт адаптирован по стандарту IS 5568, уровень AA</small>
    </div>
  </div>
</div>`;
}

/* --------------------------- Карточка мероприятия -------------------------- */
function showCard(show) {
  const cities = [...new Set((show.Seances || []).map(s => s.city).filter(Boolean))];
  const cityText = cities.slice(0, 2).join(' · ') + (cities.length > 2 ? ' и др.' : '');
  const dates = [...new Set((show.Seances || []).map(s => s.date).filter(Boolean))];
  const halls = [...new Set((show.Seances || []).map(s => s.hall).filter(Boolean))];
  const nextDate = dates[0] || show.dateFrom;
  const sold = showSoldOut(show);
  return `<article class="card${sold ? ' is-soldout' : ''}"
    data-name="${esc(show.name)}"
    data-section="${esc(show.section)}"
    data-city="${esc(cities.join('|'))}"
    data-venue="${esc(halls.join('|'))}"
    data-date-from="${esc(show.dateFrom || dates[0] || '')}"
    data-dates="${esc(dates.join(','))}">
    <a class="card-media" href="${esc(show._url)}" aria-label="${esc(show.name)}">
      <img loading="lazy" src="${esc(show.image)}" alt="${esc(show.name)}">
      <span class="card-badge">${escText(show.section)}</span>
    </a>
    <div class="card-body">
      <h3 class="card-title"><a href="${esc(show._url)}">${escText(show.name)}</a></h3>
      <p class="card-meta">
        <span class="ico-cal">${formatDate(nextDate)}</span>
        ${cityText ? `<span class="ico-pin">${escText(cityText)}</span>` : ''}
      </p>
      <p class="card-announce">${escText(stripTags(show.announce || show.description))}</p>
      <div class="card-foot">
        <span class="card-price">${sold ? '<span class="soldout">Билеты распроданы</span>' : priceLabel(show.priceMin, show.priceMax)}</span>
        ${sold ? `<a class="btn btn-soldout" href="${esc(show._url)}">Распродано</a>` : `<a class="btn btn-primary" href="${esc(show._url)}">Подробнее и билеты</a>`}
      </div>
    </div>
  </article>`;
}

/* --------------------- Страницы (правовые / о нас) --------------------- */
const STATIC_SLUGS = ['privacy', 'terms', 'contact'];

function staticPage(slug, title, metaDesc, h1, contentHtml) {
  const canonical = `${BRAND.domain}/${slug}.html`;
  const body = `
<article class="static">
  <div class="wrap static-inner">
    <nav class="breadcrumb"><a href="/">Главная</a> <span>›</span> <span class="current">${escText(h1)}</span></nav>
    <h1 class="static-title">${escText(h1)}</h1>
    <div class="rte static-body">${contentHtml}</div>
  </div>
</article>`;
  const html = page({ title, description: metaDesc, canonical, body });
  fs.writeFileSync(path.join(BRAND.outDir, `${slug}.html`), html, 'utf8');
}

function buildStaticPages() {
  // ----- Политика конфиденциальности -----
  staticPage('privacy',
    'Политика конфиденциальности | ТОП Афиша',
    'Политика конфиденциальности ТОП Афиша: сбор данных, использование файлов cookie и реклама Google AdSense.',
    'Политика конфиденциальности',
    `<p class="static-updated">Последнее обновление: август 2026</p>

<h2>Общие положения</h2>
<p>Мы в ТОП Афиша уважаем вашу конфиденциальность. Эта политика объясняет, какая информация собирается при использовании сайта topafisha.co.il, как она используется и как на сайте показывается реклама.</p>

<h2>Какие данные собираются</h2>
<p>Сайт является информационным порталом и не требует регистрации. Мы не собираем персональные данные по своей инициативе. Во время посещения собирается анонимная техническая информация — тип браузера, устройство, IP-адрес и просмотренные страницы — для работы сайта, безопасности и улучшения удобства пользования.</p>

<h2>Файлы cookie</h2>
<p>Сайт и сторонние сервисы используют файлы cookie. Cookie — это небольшие текстовые файлы, сохраняемые в браузере; они помогают работе сайта, сохранению настроек (например, настроек доступности) и показу релевантной рекламы. Вы можете блокировать или удалять cookie в настройках браузера, но это может ограничить часть функций.</p>

<h2>Реклама Google AdSense и сторонние поставщики</h2>
<p>На сайте показывается реклама через сервис Google AdSense. Google и сторонние поставщики используют cookie для показа рекламы с учётом ваших предыдущих посещений этого и других сайтов. Использование Google рекламного cookie позволяет Google и партнёрам показывать персонализированную рекламу.</p>
<p>Отключить персонализированную рекламу можно в <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener">настройках рекламы Google</a>. Подробнее об использовании данных — в <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener">рекламной политике Google</a>.</p>

<h2>Ссылки на внешние сайты</h2>
<p>Покупка билетов осуществляется на внешнем защищённом сайте продаж. Мы не несём ответственности за политику конфиденциальности внешних сайтов и рекомендуем ознакомиться с ней при покупке.</p>

<h2>Права пользователя</h2>
<p>Вы можете управлять настройками cookie через браузер и обращаться к нам по любым вопросам конфиденциальности по адресу ${BRAND.email}.</p>

<h2>Изменения политики</h2>
<p>Мы можем время от времени обновлять эту политику. Рекомендуем периодически просматривать эту страницу. Продолжение использования сайта означает согласие с обновлённой политикой.</p>`);

  // ----- Условия использования -----
  staticPage('terms',
    'Условия использования | ТОП Афиша',
    'Условия использования портала ТОП Афиша, ответственность за даты и цены, а также раскрытие информации о ссылках на покупку.',
    'Условия использования',
    `<p class="static-updated">Последнее обновление: август 2026</p>

<h2>Общие положения</h2>
<p>Добро пожаловать на ТОП Афиша. Использование сайта topafisha.co.il регулируется приведёнными ниже условиями. Просмотр и использование сайта означают согласие с этими условиями.</p>

<h2>Суть сервиса</h2>
<p>ТОП Афиша — это информационный портал и афиша событий, объединяющий концерты, спектакли и мероприятия, проходящие в Израиле. Сайт показывает информацию о событиях, датах и ценах и перенаправляет пользователя к покупке билетов на внешнем защищённом сайте продаж.</p>

<h2>Ответственность за информацию и даты</h2>
<p>Данные о мероприятиях, датах и ценах поступают от внешнего поставщика и регулярно обновляются. Возможны изменения, отмены или неточности. Мы не несём ответственности за изменения дат, состава артистов или цен. Пользователь обязан проверить полные данные на сайте продаж при покупке.</p>

<h2>Раскрытие информации и ссылки на покупку</h2>
<p>Сайт содержит ссылки на покупку билетов у внешнего поставщика. Покупка, оплата, доставка билетов и обслуживание предоставляются сайтом продаж, и его условия и политика применяются к сделке. ТОП Афиша может получать вознаграждение за переходы к покупке.</p>

<h2>Интеллектуальная собственность</h2>
<p>Содержание, дизайн и бренд сайта защищены авторским правом. Запрещается копировать, воспроизводить или использовать материалы сайта в коммерческих целях без предварительного письменного разрешения.</p>

<h2>Изменения условий</h2>
<p>Мы можем время от времени обновлять эти условия. Обновлённая версия публикуется на этой странице, и продолжение использования означает согласие.</p>

<h2>Контакты</h2>
<p>По вопросам условий использования обращайтесь по адресу ${BRAND.email}.</p>`);

  // ----- О нас и контакты -----
  staticPage('contact',
    'Контакты и о нас | ТОП Афиша',
    'О портале ТОП Афиша и способы связи по вопросам, предложениям и обращениям.',
    'Контакты и о нас',
    `<h2>О ТОП Афиша</h2>
<p>ТОП Афиша — это портал культуры и событий, объединяющий в одном месте ведущие концерты, спектакли и мероприятия Израиля. Наша цель — помочь пользователям найти подходящее событие, увидеть актуальные даты и цены и легко перейти к покупке билетов на защищённом сайте продаж.</p>
<p>Портал регулярно обновляется новыми мероприятиями и дополнительными датами, чтобы вы всегда находили актуальную информацию.</p>

<h2>Связаться с нами</h2>
<p>Будем рады вопросам, предложениям и обращениям. Напишите нам по электронной почте:</p>
<p><a href="mailto:${BRAND.email}">${BRAND.email}</a></p>
<p>Мы постараемся ответить на каждое обращение как можно скорее.</p>`);
}

/* ------------------- Тематические лендинги по времени (Hub SEO) ---------------- */
const TLV = 'Тель-Авив-Яффо';
const HUB_PAGES = [
  {
    slug: 'афиша-сегодня', when: 'today',
    title: 'Афиша на сегодня в Израиле | Билеты на концерты и спектакли сегодня - ТОП Афиша',
    desc: 'Все концерты, спектакли и мероприятия, которые проходят сегодня в Израиле, в одном месте. Актуальные даты и безопасная покупка билетов.',
    h1: 'Билеты на концерты и спектакли сегодня 2026',
    intro: 'Мы собрали для вас все мероприятия, спектакли и концерты, которые проходят сегодня по всей стране. Выберите событие и легко купите билеты.',
  },
  {
    slug: 'афиша-на-выходные', when: 'weekend',
    title: 'Афиша на ближайшие выходные | Билеты на выходные - ТОП Афиша',
    desc: 'Чем заняться на выходных? Все концерты и спектакли на ближайшие четверг, пятницу и субботу, с актуальными датами и ценами.',
    h1: 'Билеты на концерты и спектакли в выходные 2026',
    intro: 'Все мероприятия и события ближайших выходных — четверг, пятница и суббота. Найдите идеальный вариант для досуга.',
  },
  {
    slug: 'афиша-на-неделю', when: 'next-7',
    title: 'Афиша на неделю в Израиле | События ближайшей недели - ТОП Афиша',
    desc: 'Полная афиша на ближайшую неделю: концерты, спектакли и мероприятия в течение следующих 7 дней по всему Израилю.',
    h1: 'Билеты на концерты и спектакли на неделю 2026',
    intro: 'Все мероприятия ближайших семи дней. Планируйте заранее и покупайте билеты на самые близкие события.',
  },
  {
    slug: 'афиша-на-месяц', when: 'this-month',
    title: 'Афиша на месяц | Билеты на мероприятия ближайшего месяца - ТОП Афиша',
    desc: 'Все концерты и спектакли ближайшего месяца в Израиле, с актуальными датами и безопасной покупкой билетов.',
    h1: 'Билеты на концерты и спектакли в этом месяце 2026',
    intro: 'Полная афиша на ближайшие 30 дней. Большой выбор концертов, спектаклей и мероприятий по всей стране.',
  },
  {
    slug: 'афиша-2026', when: 'year-2026',
    title: 'Афиша 2026 в Израиле | Концерты, спектакли и мероприятия 2026 - ТОП Афиша',
    desc: 'Полная афиша на 2026 год: концерты, спектакли, мероприятия и культурные события по всему Израилю, обновляется в реальном времени.',
    h1: 'Билеты на концерты, спектакли и мероприятия 2026',
    intro: 'Все концерты, спектакли и мероприятия 2026 года по всему Израилю. Обширная афиша, которая регулярно обновляется.',
  },
  {
    slug: 'афиша-2027', when: 'year-2027',
    title: 'Афиша 2027 в Израиле | Концерты, спектакли и мероприятия 2027 - ТОП Афиша',
    desc: 'Полная афиша на 2027 год: концерты, спектакли, мероприятия и культурные события по всему Израилю. Бронируйте билеты заранее.',
    h1: 'Билеты на концерты, спектакли и мероприятия 2027',
    intro: 'Все концерты, спектакли и мероприятия, запланированные на 2027 год по всему Израилю. Успейте забронировать билеты на главные события следующего года.',
  },
  {
    slug: 'афиша-тель-авив-сегодня', when: 'today', city: TLV,
    title: 'Афиша Тель-Авив на сегодня | Билеты на мероприятия сегодня в Тель-Авиве - ТОП Афиша',
    desc: 'Все концерты и спектакли, которые проходят сегодня в Тель-Авиве-Яффо. Актуальные даты и безопасная покупка билетов.',
    h1: 'Мероприятия сегодня в Тель-Авиве',
    intro: 'Мероприятия и события, которые проходят сегодня в Тель-Авиве-Яффо. Найдите идеальный досуг в городе, который не спит.',
  },
  {
    slug: 'афиша-тель-авив-выходные', when: 'weekend', city: TLV,
    title: 'Афиша Тель-Авив на выходные | Билеты на выходные в Тель-Авиве - ТОП Афиша',
    desc: 'Все концерты и спектакли в Тель-Авиве на ближайшие выходные — четверг, пятница, суббота. Актуальные даты и билеты.',
    h1: 'Мероприятия в Тель-Авиве в выходные',
    intro: 'Все мероприятия в Тель-Авиве-Яффо на ближайшие выходные. Идеальный досуг на выходные в городе.',
  },
];

function breadcrumbSchema(items) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem', position: i + 1, name: it.name, item: it.url,
    })),
  };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

function hubEmpty() {
  return `<div class="hub-empty">
    <p>Сейчас в этой категории нет доступных мероприятий. Загляните позже или посмотрите другие варианты:</p>
    <ul class="hub-empty-links">
      <li><a href="/">Все мероприятия</a></li>
      <li><a href="/афиша-на-неделю.html">Афиша на неделю</a></li>
      <li><a href="/афиша-на-месяц.html">Афиша на месяц</a></li>
      <li><a href="/афиша-2026.html">Все мероприятия 2026</a></li>
    </ul>
  </div>`;
}

function buildHubPages(shows) {
  const now = israelToday();
  const todayStr = ymdStr(now);
  const plus6 = ymdStr(addDays(now, 6));
  const plus29 = ymdStr(addDays(now, 29));
  const day = now.getDay();
  const toThu = (day >= 4) ? -(day - 4) : (4 - day);
  const thu = addDays(now, toThu);
  const weekend = new Set([ymdStr(thu), ymdStr(addDays(thu, 1)), ymdStr(addDays(thu, 2))]);

  function matchWhen(dateStr, when) {
    switch (when) {
      case 'today': return dateStr === todayStr;
      case 'weekend': return weekend.has(dateStr);
      case 'next-7': return dateStr >= todayStr && dateStr <= plus6;
      case 'this-month': return dateStr >= todayStr && dateStr <= plus29;
      case 'year-2026': return dateStr.slice(0, 4) === '2026';
      case 'year-2027': return dateStr.slice(0, 4) === '2027';
      default: return false;
    }
  }

  const results = {};
  HUB_PAGES.forEach(cfg => {
    const matched = shows.filter(show =>
      (show.Seances || []).some(s =>
        (!cfg.city || s.city === cfg.city) && matchWhen(s.date, cfg.when)));

    const canonical = `${BRAND.domain}/${cfg.slug}.html`;
    const crumb = breadcrumbSchema([
      { name: 'Главная', url: BRAND.domain + '/' },
      { name: cfg.h1, url: canonical },
    ]);
    const cards = matched.map(showCard).join('\n');

    const body = `
<article class="hub">
  <div class="wrap">
    <nav class="breadcrumb"><a href="/">Главная</a> <span>›</span> <span class="current">${escText(cfg.h1)}</span></nav>
    <h1 class="hub-title">${escText(cfg.h1)}</h1>
    <p class="hub-intro">${escText(cfg.intro)}</p>
    <div class="results-head">
      <span class="results-count">Найдено: ${matched.length}</span>
    </div>
    ${matched.length ? `<div class="grid">\n${cards}\n</div>` : hubEmpty()}
  </div>
</article>`;

    const html = page({ title: cfg.title, description: cfg.desc, canonical, head: crumb, body });
    fs.writeFileSync(path.join(BRAND.outDir, `${cfg.slug}.html`), html, 'utf8');
    results[cfg.slug] = matched.length;
  });
  return results;
}

/* ------------------- Статические лендинги по городам (City SEO) ------------- */
const CITY_PAGES = [
  {
    slug: 'афиша-тель-авив', city: 'Тель-Авив-Яффо',
    title: 'Концерты и спектакли в Тель-Авиве | Билеты на мероприятия - ТОП Афиша',
    desc: 'Все концерты, спектакли и мероприятия в Тель-Авиве-Яффо в одном месте. Актуальные даты и безопасная покупка билетов.',
    h1: 'Билеты на концерты, спектакли и мероприятия в Тель-Авиве-Яффо',
    intro: 'Все концерты, спектакли и мероприятия, которые проходят в Тель-Авиве-Яффо. Крупнейший культурный город Израиля с событиями на любой вкус круглый год.',
  },
  {
    slug: 'афиша-иерусалим', city: 'Иерусалим',
    title: 'Концерты и спектакли в Иерусалиме | Билеты на мероприятия - ТОП Афиша',
    desc: 'Все концерты, спектакли и мероприятия в Иерусалиме в одном месте. Актуальные даты и безопасная покупка билетов.',
    h1: 'Билеты на концерты, спектакли и мероприятия в Иерусалиме',
    intro: 'Все концерты, спектакли и мероприятия, которые проходят в Иерусалиме. Столица предлагает богатый выбор культурных и развлекательных событий.',
  },
  {
    slug: 'афиша-хайфа', city: 'Хайфа',
    title: 'Концерты и спектакли в Хайфе | Билеты на мероприятия - ТОП Афиша',
    desc: 'Все концерты, спектакли и мероприятия в Хайфе и на севере в одном месте. Актуальные даты и безопасная покупка билетов.',
    h1: 'Билеты на концерты, спектакли и мероприятия в Хайфе',
    intro: 'Все концерты, спектакли и мероприятия, которые проходят в Хайфе и на севере страны. Найдите идеальный досуг в столице севера.',
  },
  {
    slug: 'афиша-беэр-шева', city: 'Беэр-Шева',
    title: 'Концерты и спектакли в Беэр-Шеве | Билеты на мероприятия - ТОП Афиша',
    desc: 'Все концерты, спектакли и мероприятия в Беэр-Шеве и на юге в одном месте. Актуальные даты и безопасная покупка билетов.',
    h1: 'Билеты на концерты, спектакли и мероприятия в Беэр-Шеве',
    intro: 'Все концерты, спектакли и мероприятия, которые проходят в Беэр-Шеве и на юге страны. Разнообразный культурный досуг в столице Негева.',
  },
];

function buildCityPages(shows) {
  const results = {};
  CITY_PAGES.forEach(cfg => {
    const matched = shows.filter(show =>
      (show.Seances || []).some(s => s.city === cfg.city));

    const canonical = `${BRAND.domain}/${cfg.slug}/`;
    const crumb = breadcrumbSchema([
      { name: 'Главная', url: BRAND.domain + '/' },
      { name: cfg.h1, url: canonical },
    ]);
    const cards = matched.map(showCard).join('\n');

    const body = `
<article class="hub">
  <div class="wrap">
    <nav class="breadcrumb"><a href="/">Главная</a> <span>›</span> <span class="current">${escText(cfg.h1)}</span></nav>
    <h1 class="hub-title">${escText(cfg.h1)}</h1>
    <p class="hub-intro">${escText(cfg.intro)}</p>
    <div class="results-head">
      <span class="results-count">Найдено: ${matched.length}</span>
    </div>
    ${matched.length ? `<div class="grid">\n${cards}\n</div>` : hubEmpty()}
  </div>
</article>`;

    const html = page({ title: cfg.title, description: cfg.desc, canonical, head: crumb, body });
    const dir = path.join(BRAND.outDir, cfg.slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    results[cfg.slug] = matched.length;
  });
  return results;
}

/* ---------------------- Индекс артистов (Artists Hub) -------------------- */
// Оставляем только "чистые" названия, похожие на имя артиста/группы
const ARTIST_DESC_MARKERS = ['концерт', 'фестиваль', 'шоу', 'спектакль', 'мюзикл', 'вечер',
  'программа', 'посвящается', 'посвящённый', 'трибьют', 'оркестр', 'для детей',
  'мастер-класс', 'лекция', 'выставка', 'в Израиле'];

function isCleanArtist(name) {
  const n = (name || '').trim();
  if (!n) return false;
  if (/[|\-–—:,]/.test(n)) return false;   // разделители / пунктуация
  if (/[A-Za-z]/.test(n)) return false;    // латиница
  if (/[0-9]/.test(n)) return false;       // цифры
  if (n.split(/\s+/).length > 4) return false;
  const low = n.toLowerCase();
  return !ARTIST_DESC_MARKERS.some(d => low.includes(d));
}

function buildArtistsIndex(shows) {
  const artistShows = shows
    .filter(s => isCleanArtist(s.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const slug = 'артисты';
  const canonical = `${BRAND.domain}/${slug}/`;
  const crumb = breadcrumbSchema([
    { name: 'Главная', url: BRAND.domain + '/' },
    { name: 'Артисты и мероприятия', url: canonical },
  ]);

  const cards = artistShows.map(showCard).join('\n');
  const quickList = artistShows.map(s =>
    `<li><a href="${esc(artistUrlByName[s.name] || s._url)}">${escText(s.name)} — билеты</a></li>`).join('');

  const body = `
<article class="hub">
  <div class="wrap">
    <nav class="breadcrumb"><a href="/">Главная</a> <span>›</span> <span class="current">Артисты и мероприятия</span></nav>
    <h1 class="hub-title">Артисты и мероприятия 2026</h1>
    <p class="hub-intro">Мы собрали для вас ведущих артистов и мероприятия, проходящие в Израиле. Выберите артиста, посмотрите даты, города и цены и легко купите билеты в одном месте.</p>
    <div class="results-head"><span class="results-count">Найдено: ${artistShows.length}</span></div>
    <div class="grid">
${cards}
</div>
    <section class="artist-list-section">
      <h2>Список артистов по алфавиту</h2>
      <ul class="artist-list">${quickList}</ul>
    </section>
  </div>
</article>`;

  const html = page({
    title: 'Артисты и ведущие мероприятия в Израиле | ТОП Афиша',
    description: 'Список артистов и ведущих мероприятий в Израиле. Найдите любимого артиста, посмотрите даты и цены и легко купите билеты.',
    canonical,
    head: crumb,
    body,
  });

  const dir = path.join(BRAND.outDir, slug);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
  return artistShows.length;
}

/* ============ Evergreen: постоянные страницы артистов и залов + перелинковка ============ */
let ARTIST_REGISTRY = [];
let VENUE_REGISTRY = [];
let MAGAZINE_REDIRECTS = [];
const artistUrlByName = {};
const venueUrlByHall = {};

function assignHubs(shows) {
  const byArtist = {};
  shows.forEach(s => { if (isCleanArtist(s.name)) (byArtist[s.name] = byArtist[s.name] || []).push(s); });
  const aUsed = new Set();
  ARTIST_REGISTRY = Object.keys(byArtist).sort((a, b) => a.localeCompare(b, 'ru')).map(name => {
    let slug = capSlugBytes(slugify(name) || 'artist', 150);
    if (aUsed.has(slug)) slug += '-' + byArtist[name][0].id;
    aUsed.add(slug);
    const url = `/artist/${slug}/`;
    artistUrlByName[name] = url;
    return { name, slug, url, shows: byArtist[name] };
  });

  const byHall = {};
  shows.forEach(s => [...new Set((s.Seances || []).map(z => z.hall).filter(Boolean))]
    .forEach(h => (byHall[h] = byHall[h] || []).push(s)));
  const vUsed = new Set();
  VENUE_REGISTRY = Object.keys(byHall).filter(h => byHall[h].length >= 2)
    .sort((a, b) => a.localeCompare(b, 'ru')).map(hall => {
      let slug = capSlugBytes(slugify(hall) || 'venue', 150);
      if (vUsed.has(slug)) slug += '-' + byHall[hall][0].id;
      vUsed.add(slug);
      const url = `/venues/${slug}/`;
      venueUrlByHall[hall] = url;
      let city = '', address = '';
      for (const s of byHall[hall]) {
        const se = (s.Seances || []).find(z => z.hall === hall);
        if (se) { city = se.city || city; address = se.address || address; if (city) break; }
      }
      return { hall, slug, url, shows: byHall[hall], city, address };
    });
}

function buildArtistPages() {
  ARTIST_REGISTRY.forEach(a => {
    const canonical = `${BRAND.domain}${a.url}`;
    const image = (a.shows.find(s => s.image) || {}).image || '';
    const cards = a.shows.map(showCard).join('\n');
    const crumb = breadcrumbSchema([
      { name: 'Главная', url: BRAND.domain + '/' },
      { name: 'Артисты', url: BRAND.domain + '/артисты/' },
      { name: a.name, url: canonical },
    ]);
    const profile = {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      mainEntity: { '@type': 'MusicGroup', name: a.name, url: canonical, image: image || undefined },
    };
    const empty = `<div class="hub-empty">
      <p>Сейчас нет ближайших мероприятий ${escText(a.name)}. Артист скоро вернётся — загляните позже.</p>
      <ul class="hub-empty-links"><li><a href="/">Все мероприятия</a></li><li><a href="/артисты/">Все артисты</a></li></ul>
    </div>`;
    const body = `
<article class="hub">
  <div class="wrap">
    <nav class="breadcrumb"><a href="/">Главная</a> <span>›</span> <a href="/артисты/">Артисты</a> <span>›</span> <span class="current">${escText(a.name)}</span></nav>
    <h1 class="hub-title">${escText(a.name)} — билеты и концерты</h1>
    <p class="hub-intro">Все ближайшие концерты и мероприятия ${escText(a.name)} в Израиле. Актуальные даты, города и цены, безопасная покупка билетов в одном месте.</p>
    <div class="results-head"><span class="results-count">Найдено: ${a.shows.length}</span></div>
    ${a.shows.length ? `<div class="grid">\n${cards}\n</div>` : empty}
  </div>
</article>`;
    const html = page({
      title: `${a.name} — билеты на концерты и мероприятия | ТОП Афиша`,
      description: `Все ближайшие концерты и мероприятия ${a.name} в Израиле. Актуальные даты, цены и безопасная покупка билетов.`,
      canonical,
      head: crumb + `\n<script type="application/ld+json">${JSON.stringify(profile)}</script>` + (image ? `\n<meta property="og:image" content="${esc(image)}">` : ''),
      body,
    });
    const dir = path.join(BRAND.outDir, 'artist', a.slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
  });
  return ARTIST_REGISTRY.length;
}

function buildVenuePages() {
  VENUE_REGISTRY.forEach(v => {
    const canonical = `${BRAND.domain}${v.url}`;
    const cards = v.shows.map(showCard).join('\n');
    const crumb = breadcrumbSchema([
      { name: 'Главная', url: BRAND.domain + '/' },
      { name: v.hall, url: canonical },
    ]);
    const placeSchema = {
      '@context': 'https://schema.org',
      '@type': 'Place',
      name: v.hall,
      url: canonical,
      address: {
        '@type': 'PostalAddress',
        streetAddress: v.address || v.hall,
        addressLocality: v.city || undefined,
        addressCountry: 'IL',
      },
    };
    const loc = [v.address, v.city].filter(Boolean).join(', ');
    const body = `
<article class="hub">
  <div class="wrap">
    <nav class="breadcrumb"><a href="/">Главная</a> <span>›</span> <span>Залы</span> <span>›</span> <span class="current">${escText(v.hall)}</span></nav>
    <h1 class="hub-title">${escText(v.hall)}</h1>
    <p class="hub-intro">Афиша ближайших мероприятий в зале ${escText(v.hall)}${loc ? ' · ' + escText(loc) : ''}. Актуальные даты, цены и билеты в реальном времени.</p>
    <div class="results-head"><span class="results-count">Найдено: ${v.shows.length}</span></div>
    ${v.shows.length ? `<div class="grid">\n${cards}\n</div>` : hubEmpty()}
  </div>
</article>`;
    const html = page({
      title: `${v.hall} — афиша и билеты | ТОП Афиша`,
      description: `Все ближайшие мероприятия в зале ${v.hall}${v.city ? ', ' + v.city : ''}. Актуальные даты, цены и безопасная покупка билетов.`,
      canonical,
      head: crumb + `\n<script type="application/ld+json">${JSON.stringify(placeSchema)}</script>`,
      body,
    });
    const dir = path.join(BRAND.outDir, 'venues', v.slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
  });
  return VENUE_REGISTRY.length;
}

/* ==================================================================== */
/* ========= Журнал культуры и досуга — независимая система ========= */
/* ==== новый слой рядом с сайтом билетов; не трогает существующее ==== */
/* ==================================================================== */
let MAGAZINE_ARTICLES = [];
let NEWS_ARTICLES = [];
let LANDING_PAGES = [];
let LANDING_REDIRECTS = [];

function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  m[1].split(/\r?\n/).forEach(line => {
    const i = line.indexOf(':');
    if (i > -1) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  });
  return { meta, body: m[2] };
}

function mdToHtml(md) {
  const e = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = s => e(s)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return md.trim().split(/\r?\n\r?\n+/).map(b => {
    b = b.trim();
    if (/^### /.test(b)) return `<h3>${inline(b.slice(4))}</h3>`;
    if (/^## /.test(b)) return `<h2>${inline(b.slice(3))}</h2>`;
    if (/^# /.test(b)) return `<h2>${inline(b.slice(2))}</h2>`;
    if (/^> /.test(b)) return `<blockquote>${inline(b.replace(/^> ?/gm, ''))}</blockquote>`;
    if (/^([-*]) /.test(b)) return `<ul>${b.split(/\r?\n/).map(li => `<li>${inline(li.replace(/^[-*] /, ''))}</li>`).join('')}</ul>`;
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(b)) return `<figure>${inline(b)}</figure>`;
    return `<p>${inline(b)}</p>`;
  }).join('\n');
}

function loadMdArticles() {
  const dir = path.join(__dirname, 'content', 'magazine');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
    const bodyHtml = mdToHtml(body);
    return {
      slug: meta.slug || slugify(meta.title || f.replace(/\.md$/, '')),
      title: meta.title || 'Без названия',
      description: meta.description || stripTags(bodyHtml).slice(0, 155),
      date: meta.date || new Date().toISOString().slice(0, 10),
      author: meta.author || BRAND.nameHe,
      image: meta.image || '',
      bodyHtml,
    };
  });
}

function weekendArticle(shows) {
  const now = israelToday();
  const day = now.getDay();
  const toThu = (day >= 4) ? -(day - 4) : (4 - day);
  const thu = addDays(now, toThu);
  const wk = [ymdStr(thu), ymdStr(addDays(thu, 1)), ymdStr(addDays(thu, 2))];
  const wkSet = new Set(wk);
  const picks = shows.filter(s => (s.Seances || []).some(z => wkSet.has(z.date))).slice(0, 12);
  if (!picks.length) return null;
  const range = `${formatDate(wk[0])} — ${formatDate(wk[2])}`;
  const items = picks.map(s => {
    const se = (s.Seances || []).find(z => wkSet.has(z.date)) || {};
    const buy = seanceSoldOut(se) ? ' <span class="soldout">Билеты распроданы</span>'
      : ` <a class="mag-buy" href="${esc(affiliateUrl(se.link))}" target="_blank" rel="noopener sponsored">Заказать билеты ›</a>`;
    return `<li><a href="${esc(s._url)}"><strong>${escText(s.name)}</strong></a> — ${formatDate(se.date)}${se.city ? ', ' + escText(se.city) : ''}${se.hall ? ' · ' + escText(se.hall) : ''}.${buy}</li>`;
  }).join('\n');
  return {
    slug: 'куда-пойти-на-выходных',
    title: `Куда пойти на выходных? Гид по мероприятиям ${range}`,
    description: `Лучшие концерты, спектакли и мероприятия на ближайшие выходные в Израиле (${range}). Актуальные даты и билеты.`,
    date: ymdStr(now),
    author: BRAND.nameHe,
    image: (picks.find(s => s.image) || {}).image || '',
    bodyHtml: `<p>Выходные уже близко, и мы собрали для вас лучшие концерты, спектакли и мероприятия, которые проходят ${range}. Выбирайте идеальный вариант досуга и легко покупайте билеты.</p>
<h2>Рекомендуем на выходные</h2>
<ul class="mag-picks">${items}</ul>
<p>Полный список всех мероприятий выходных смотрите на <a href="/афиша-на-выходные.html">странице афиши на выходные</a>.</p>`,
  };
}

// Гид для детей и семьи на выходные (авто, с разбивкой по городам)
const KIDS_SECTIONS = new Set(['Спектакли для детей', 'Музыка для детей', 'Час рассказа', 'Цирк', 'Парки и аттракции']);
function familyWeekendArticle(shows) {
  const now = israelToday();
  const day = now.getDay();
  const toThu = (day >= 4) ? -(day - 4) : (4 - day);
  const thu = addDays(now, toThu);
  const wk = [ymdStr(thu), ymdStr(addDays(thu, 1)), ymdStr(addDays(thu, 2))];
  const wkSet = new Set(wk);
  const picks = shows.filter(s => KIDS_SECTIONS.has(s.section) && (s.Seances || []).some(z => wkSet.has(z.date)));
  if (!picks.length) return null;
  const byCity = {};
  picks.forEach(s => {
    const se = (s.Seances || []).find(z => wkSet.has(z.date)) || {};
    const city = se.city || 'Другое';
    (byCity[city] = byCity[city] || []).push({ s, se });
  });
  const range = `${formatDate(wk[0])} — ${formatDate(wk[2])}`;
  const sections = Object.keys(byCity).sort((a, b) => a.localeCompare(b, 'ru')).map(city => {
    const items = byCity[city].map(({ s, se }) => {
      const buy = seanceSoldOut(se) ? ' <span class="soldout">Билеты распроданы</span>'
        : ` <a class="mag-buy" href="${esc(affiliateUrl(se.link))}" target="_blank" rel="noopener sponsored">Заказать билеты ›</a>`;
      const when = `${formatDate(se.date)}${se.time ? ` в ${formatTime(se.time)}` : ''}`;
      return `<li><a href="${esc(s._url)}"><strong>${escText(s.name)}</strong></a> — <span class="mag-sect">${escText(s.section)}</span> · ${when}${se.hall ? ' · ' + escText(se.hall) : ''}.${buy}</li>`;
    }).join('\n');
    return `<h2>${escText(city)}</h2>\n<ul class="mag-picks">${items}</ul>`;
  }).join('\n');
  return {
    slug: 'детские-спектакли-на-выходные',
    redirectFrom: 'family-events-weekend',
    title: `Гид для детей и семьи на выходные — ${range}`,
    description: `Все детские и семейные мероприятия на ближайшие выходные в Израиле (${range}), с разбивкой по городам. Актуальные даты и билеты.`,
    date: ymdStr(now),
    author: BRAND.nameHe,
    image: (picks.find(s => s.image) || {}).image || '',
    bodyHtml: `<p>Выходные — идеальное время для семейного досуга, и ничто не радует детей так, как живое представление. Ищете ли вы классический детский спектакль, яркий цирк, волшебный час рассказа или впечатляющий аттракцион — мы собрали для вас все подходящие для всей семьи мероприятия, которые проходят ${range}. Всё удобно разбито по городам, чтобы вы быстро нашли лучший вариант рядом с домом и заказали билеты в один клик.</p>\n${sections}\n<p>Полный список мероприятий выходных для всех возрастов смотрите на <a href="/афиша-на-выходные.html">странице афиши на выходные</a>. Ищете досуг в конкретном городе? Перейдите на <a href="/">главную страницу</a> и отфильтруйте по категории и городу.</p>`,
  };
}

// Вечнозелёный гид по залам — со ссылками на страницы залов
function venuesSeatingGuide() {
  const top = [...VENUE_REGISTRY].sort((a, b) => b.shows.length - a.shows.length).slice(0, 10);
  const venueLinks = top.map(v =>
    `<li><a href="${esc(v.url)}"><strong>${escText(v.hall)}</strong></a>${v.city ? ' — ' + escText(v.city) : ''} · ${v.shows.length} ближайших мероприятий</li>`).join('\n');
  const image = (top[0] && (top[0].shows.find(s => s.image) || {}).image) || '';
  // Динамическая проверка доступности: если в зале есть активные мероприятия — ссылка; иначе — чистая вечнозелёная заметка
  const venueCTA = (kw, name) => {
    const v = VENUE_REGISTRY.find(x => x.hall.includes(kw) && x.shows.length > 0);
    return v
      ? ` <a class="mag-buy" href="${esc(v.url)}">Смотреть все ближайшие мероприятия в ${escText(name)} (${v.shows.length}) ›</a>`
      : ` <span class="mag-note">В данный момент активных мероприятий в этом зале нет, но рекомендуем следить за анонсами предстоящих событий или посмотреть мероприятия в других центральных залах.</span>`;
  };
  const bodyHtml = `<p>Правильный выбор места может полностью изменить впечатление от концерта или спектакля. Мы подготовили профессиональный гид, который поможет выбрать удачные места в ведущих залах и дворцах культуры Израиля.</p>

<h2>Принципы выбора места</h2>

<h3>Близко к сцене (первые ряды)</h3>
<p>Передние ряды дают камерное впечатление и максимальную близость к артисту, особенно подходят для сольных концертов, стендапа и танцевальных шоу. Минус: иногда крутой угол обзора, а в больших залах сложно охватить всю картину.</p>

<h3>Центр зала (средние ряды)</h3>
<p>Как правило, лучший баланс: удобный угол обзора, оптимальное расстояние до сцены, а на концертах — лучшее качество звука, так как система обычно настроена на центр. Рекомендуемый выбор для большинства мероприятий.</p>

<h3>Балкон и задние ряды</h3>
<p>Дают общий широкий обзор сцены по более доступной цене и отлично подходят для мюзиклов, оперы и масштабных визуальных шоу, где важно видеть всю картину. В залах с амфитеатром видно прекрасно и сверху.</p>

<h2>Советы по конкретным площадкам</h2>

<h3>Дворец культуры Тель-Авив</h3>
<p>Один из центральных залов Израиля, принимающий классические концерты, музыкальные шоу и крупные мюзиклы. Зал состоит из двух основных ярусов: <strong>партер</strong> и <strong>балкон</strong>. В партере средние ряды дают лучший баланс между близостью к сцене и сбалансированной акустикой, так как звуковая система настроена на центр. Балкон предлагает отличный панорамный обзор и открытое звучание по более доступной цене, что особенно хорошо для мюзиклов и визуальных шоу.${venueCTA('культуры', 'Дворце культуры Тель-Авив')}</p>

<h3>Амфитеатр Кейсарии</h3>
<p>Впечатляющий открытый амфитеатр на берегу моря с волшебной атмосферой на закате. <strong>Ряды VIP</strong> у сцены дают максимальную близость к артисту, <strong>центральный блок</strong> — идеальный выбор с приятным расстоянием и сбалансированным звуком, а <strong>верхние ярусы</strong> открывают захватывающий вид на сцену и море. Важный совет: приходите заранее, возьмите тёплую одежду на вечер, а подушка для сидения повысит комфорт на каменных скамьях.${venueCTA('Кейсари', 'амфитеатре Кейсарии')}</p>

<h3>Клубы Заппа (Тель-Авив, Герцлия и Иерусалим)</h3>
<p>Ведущая сеть клубов живой музыки в Израиле с камерной и близкой атмосферой. В большинстве филиалов посадка <strong>за столиками</strong>, поэтому ранний приход критически важен: вход обычно по порядку прибытия внутри купленной ценовой зоны, и кто приходит раньше — занимает лучшие столики у сцены. Зона бара и задние столики удобнее для тех, кто любит более свободную атмосферу. Уточняйте заранее, сидячее это мероприятие или стоячее.${venueCTA('Заппа', 'клубах Заппа')}</p>

<h2>Ведущие залы у нас</h2>
<p>Нажмите на любой зал, чтобы увидеть его полную ближайшую афишу:</p>
<ul class="mag-picks">${venueLinks}</ul>
<p>Ищете конкретное мероприятие? Зайдите на <a href="/">главную страницу</a> и отфильтруйте по залу, городу или дате. Есть вопросы об отмене, ценах или получении билетов? Все ответы — в <a href="/magazine/${encodeURI('частые-вопросы-о-покупке-билетов')}/">гиде по частым вопросам</a>.</p>`;
  return {
    slug: 'гид-по-залам-где-лучше-сидеть',
    redirectFrom: 'venues-seating-guide',
    schemaType: 'Article',
    title: 'Гид по залам: как выбрать места в ведущих залах Израиля',
    description: 'Профессиональный гид по выбору мест в ведущих залах и дворцах культуры Израиля, с советами по типам площадок и ссылками на афиши.',
    date: '2026-08-15',
    author: BRAND.nameHe,
    image,
    bodyHtml,
  };
}

function magArticlePage(a) {
  const canonical = `${BRAND.domain}${a.url}`;
  const crumb = breadcrumbSchema([
    { name: 'Главная', url: BRAND.domain + '/' },
    { name: 'Журнал', url: BRAND.domain + '/magazine/' },
    { name: a.title, url: canonical },
  ]);
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': a.schemaType || 'NewsArticle',
    headline: a.title,
    description: a.description,
    datePublished: a.date,
    dateModified: a.date,
    image: a.image || undefined,
    author: { '@type': 'Organization', name: BRAND.nameHe, url: BRAND.domain },
    publisher: { '@type': 'Organization', name: BRAND.nameHe, url: BRAND.domain, logo: { '@type': 'ImageObject', url: BRAND.domain + '/assets/logo.svg' } },
    mainEntityOfPage: canonical,
  };
  // Схема FAQPage для страниц вопросов и ответов (Rich Snippets)
  const faqSchema = (a.faq && a.faq.length) ? {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: a.faq.map(f => ({
      '@type': 'Question', name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.aText || String(f.a || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() },
    })),
  } : null;
  const body = `
<article class="mag-article">
  <div class="wrap mag-wrap">
    <nav class="breadcrumb"><a href="/">Главная</a> <span>›</span> <a href="/magazine/">Журнал</a> <span>›</span> <span class="current">${escText(a.title)}</span></nav>
    <h1 class="mag-title">${escText(a.title)}</h1>
    <p class="mag-byline">${escText(a.author)} · ${formatDate(a.date)}</p>
    ${a.image ? `<figure class="mag-hero"><img src="${esc(a.image)}" alt="${esc(a.title)}"></figure>` : ''}
    <div class="mag-body rte">${a.bodyHtml}</div>
    <p class="mag-back"><a href="/magazine/">‹ Назад в журнал</a></p>
  </div>
</article>`;
  const html = page({
    title: `${a.title} | Журнал ТОП Афиша`,
    description: a.description,
    canonical,
    head: crumb + `\n<script type="application/ld+json">${JSON.stringify(articleSchema)}</script>` + (faqSchema ? `\n<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>` : '') + (a.image ? `\n<meta property="og:image" content="${esc(a.image)}">` : ''),
    body,
  });
  const dir = path.join(BRAND.outDir, 'magazine', a.slug);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
}

// Вечнозелёный лонгрид: фестивали и главные события 2027 (First-mover SEO)
function festivals2027Article() {
  const linkV = (kw, label) => {
    const v = VENUE_REGISTRY.find(x => x.hall.includes(kw) && x.shows.length > 0);
    return v ? `<a href="${esc(v.url)}">${escText(label)}</a>` : `<strong>${escText(label)}</strong>`;
  };
  const image = (VENUE_REGISTRY.flatMap(v => v.shows).find(s => s.image) || {}).image || '';
  const bodyHtml = `<p>2027 год уже сейчас обещает стать одним из самых насыщенных и увлекательных культурных сезонов, которые видел Израиль. Крупные международные артисты отмечают возвращение на местные сцены, гигантские открытые фестивали продолжают набирать обороты, а спрос на билеты на самые ожидаемые мероприятия будет высоким как никогда. Кто знаком с миром живых выступлений, знает: ранняя подготовка — это разница между местом в первом ряду и надписью «билеты распроданы». Мы подготовили для вас подробный гид по всему, что ожидается в 2027 году, по сезонам и жанрам, вместе с выигрышными советами по умной и заблаговременной покупке билетов.</p>

<h2>Весенние и пасхальные фестивали 2027</h2>
<p>Весенний сезон открывает год особой энергией. Пасхальные каникулы приносят множество открытых мероприятий для всей семьи, музыкальных фестивалей на природе и представлений на объектах наследия по всей стране. Это время, когда открытые амфитеатры и исторические места превращаются в волшебные сцены, а приятная погода позволяет проводить вечера под открытым небом. Весенние фестивали раскупаются особенно быстро, ведь они объединяют отдых, природу и культуру в одном месте.</p>
<p>Помимо крупных шоу, весна — это ещё и сезон общинных и региональных фестивалей, которые приносят культуру в самое сердце городов. Это события, сочетающие музыку, еду, уличное искусство и активности для детей, и в последние годы они стали неотъемлемой частью израильской афиши.</p>
<h3>Что стоит спланировать заранее</h3>
<p>Если вы планируете семейный отдых на Песах, бронируйте даты заранее и регулярно проверяйте <a href="/">общую афишу событий</a>. Многие праздничные мероприятия анонсируются за месяцы вперёд, и тот, кто бронирует рано, получает и цены Early Bird, и лучшие места.</p>

<h2>Летний сезон и большие парки</h2>
<p>Израильское лето — пик сезона выступлений под открытым небом. Гигантские шоу переезжают в парки и открытые пространства, где тысячи зрителей наслаждаются незабываемыми концертами под звёздным небом. ${linkV('Кейсари', 'Амфитеатр Кейсарии')} на берегу моря остаётся одной из самых престижных и востребованных площадок Израиля, наряду с большими пространствами парка Яркон в Тель-Авиве и бассейна Султана в Иерусалиме. Парк Яркон вмещает десятки тысяч зрителей и идеально подходит для крупнейших международных шоу, тогда как бассейн Султана у стен Старого города предлагает уникальную историческую атмосферу.</p>
<h3>Совет по выбору места на летних концертах</h3>
<p>На открытых площадках центральный блок обычно предлагает лучший баланс между близостью к сцене и качеством звука. Перед покупкой стоит прочитать наш <a href="/magazine/${encodeURI('гид-по-залам-где-лучше-сидеть')}/">полный гид по залам</a>, где подробно описано, где лучше сидеть на каждой площадке.</p>

<h2>Жанровые фестивали: джаз, рок, электроника и театр</h2>
<p>Наряду с массовыми мероприятиями, 2027 год богат и ежегодными бутик-событиями для любителей жанра. Джазовый фестиваль в Эйлате продолжает привлекать лучших артистов Израиля и мира, наряду с рок-фестивалями, электронными шоу и ведущими событиями танца и театра. Эти мероприятия предлагают более камерное и качественное впечатление, а билеты на них часто ограничены и раскупаются очень быстро. Бутик-фестивали выделяются ещё и тем, что собирают сплочённую аудиторию ценителей жанра, что делает атмосферу на них по-настоящему особенной.</p>
<p>Вместе с этим 2027 год приносит и ведущие фестивали танца и театра, представляющие оригинальные постановки наряду с международными гостями, — редкая возможность увидеть современные и новаторские работы.</p>
<p>Поклонники конкретного артиста могут следить за полной афишей через <a href="/артисты/">список артистов</a> на сайте и узнавать о новых датах в течение года.</p>

<h2>Выигрышный гид по покупке билетов на 2027</h2>
<ul class="mag-picks">
  <li><strong>Бронируйте как можно раньше:</strong> на востребованные шоу лучшие места разбирают первыми, а цены растут ближе к дате события.</li>
  <li><strong>Используйте продажи Early Bird:</strong> в начале продаж обычно предлагают ограниченное количество мест по сниженной цене — лучший шанс совместить хорошую цену и отличное место.</li>
  <li><strong>Задайте бюджет и гибкие даты:</strong> иногда одно и то же шоу проходит в нескольких городах и датах по разным ценам. Небольшое сравнение может неплохо сэкономить.</li>
  <li><strong>Изучите карту зала:</strong> познакомьтесь со схемой площадки перед покупкой, чтобы забронировать лучшие ряды.</li>
</ul>

<p>2027 год обещает особенно богатый культурный сезон, и подготовка начинается уже сейчас. Следите за нашей <a href="/">обновляемой афишей</a>, изучайте страницы залов и артистов и бронируйте билеты заранее, чтобы гарантировать себе идеальное впечатление.</p>`;
  return {
    slug: 'фестивали-и-главные-события-2027',
    schemaType: 'Article',
    title: 'Фестивали и главные события 2027 года: календарь, билеты и всё, что нужно знать',
    description: 'Подробный гид по фестивалям и главным событиям 2027 года в Израиле, по сезонам и жанрам, с советами по ранней покупке билетов и ссылками на афиши.',
    date: '2026-08-31',
    author: BRAND.nameHe,
    image,
    bodyHtml,
  };
}

// Редакторский лонгрид на основе данных: обязательные концерты 2027 из текущей афиши
function mustSee2027Article(shows) {
  const itemLi = (s) => {
    const se = [...(s.Seances || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || {};
    const buy = seanceSoldOut(se) ? ' <span class="soldout">Билеты распроданы</span>'
      : (se.link ? ` <a class="mag-buy" href="${esc(affiliateUrl(se.link))}" target="_blank" rel="noopener sponsored">Заказать билеты ›</a>` : '');
    const when = se.date ? ` · ${formatDate(se.date)}` : '';
    return `<li><a href="${esc(s._url)}"><strong>${escText(s.name)}</strong></a>${se.hall ? ' · ' + escText(se.hall) : ''}${when}.${buy}</li>`;
  };
  const byName = (kws) => {
    const seen = new Set(); const out = [];
    for (const s of shows) {
      const n = (s.name || '');
      if (kws.some(k => n.includes(k)) && !seen.has(s._url)) { seen.add(s._url); out.push(s); }
    }
    return out;
  };
  const bySection = (kws, limit) => {
    const out = shows.filter(s => kws.some(k => (s.section || '').includes(k)));
    out.sort((a, b) => String((a.Seances && a.Seances[0] && a.Seances[0].date) || '').localeCompare(String((b.Seances && b.Seances[0] && b.Seances[0].date) || '')));
    return out.slice(0, limit);
  };
  const list = (arr) => arr.length
    ? `<ul class="mag-picks">${arr.map(itemLi).join('\n')}</ul>`
    : `<p>Полный список постоянно обновляется. Перейдите на <a href="/афиша-2027.html">афишу 2027</a>, чтобы увидеть все мероприятия этой категории.</p>`;

  const giants = byName(['Эйфман', 'Жизель', 'Malevo', 'Малево', 'Beatles', 'Битлз', 'балет']);
  const theater = bySection(['театр', 'мюзикл', 'комеди', 'эстрад', 'спектакл'], 8);
  const music = byName(['Саранга', 'джаз', 'Буэна', 'свинг', 'Берлин', 'барокко', 'оркестр', 'классик', 'симфони']);

  const bodyHtml = `<p>2027 год станет беспрецедентным для мира культуры в Израиле. Артисты мирового уровня возвращаются на местные сцены, международные фестивали приходят к нам, а впечатляющие оригинальные постановки соседствуют с любимой классикой. Мы тщательно отобрали для вас лучшие концерты и события из афиши 2027, которая уже открыта для бронирования в нашей системе, разбив их по категориям, чтобы вы могли спланировать свой культурный год и успеть купить билеты вовремя.</p>

<h2>Главные шоу и международные премьеры</h2>
<p>Это события, вокруг которых больше всего ажиотажа. Во главе списка — впечатляющие балетные постановки Бориса Эйфмана, включая премьеру «Красной Жизели», ожидаемую в сентябре 2027, наряду с аргентинской танцевальной сенсацией «Malevo», сочетающей ритм, огонь и захватывающую энергию, и большими трибьют-концертами «The Beatles legend». Это постановки международного уровня, билеты на которые разбирают очень быстро.</p>
${list(giants)}

<h2>Театр, мюзикл и развлечения</h2>
<p>Сезон 2027 приносит флагманские постановки израильского театра, хитовые комедии, возвращающиеся на сцену после оглушительного успеха, и захватывающие мюзиклы, которые сопровождают нас весь год. Любите ли вы драму, комедию или классический мюзикл — здесь множество качественных сценических впечатлений.</p>
${list(theater)}

<h2>Живая музыка, джаз и особая классика</h2>
<p>Для любителей живой музыки 2027 год особенно богат. Шломи Саранга выходит на большое шоу, серии «Горячий джаз» продолжают увлекать трогательными трибьют-вечерами, такими как дань «Buena Vista Social Club» и берлинскому свингу, а рядом — концерты барокко и ведущие оркестры Израиля. Это разнообразие сочетает энергию, ностальгию и редкое качество.</p>
${list(music)}

<h2>Почему стоит бронировать билеты уже сейчас</h2>
<p>Сезон 2027 уже открыт для бронирования, и ранняя подготовка окупается. На востребованные шоу лучшие места разбирают первыми, а цены растут ближе к дате события. Ранняя покупка гарантирует вам не просто билет, а правильное место: центр зала для лучшего баланса звука или передние ряды для камерного впечатления. Перед покупкой стоит заглянуть в наш <a href="/magazine/${encodeURI('гид-по-залам-где-лучше-сидеть')}/">гид по залам</a>, чтобы выбрать, где именно сидеть.</p>
<p>Полный и обновляемый список всех событий смотрите в <a href="/афиша-2027.html">афише 2027</a> или перейдите на <a href="/">главную страницу</a> и отфильтруйте по артисту, залу, городу и дате. Перед покупкой стоит заглянуть в <a href="/magazine/${encodeURI('частые-вопросы-о-покупке-билетов')}/">частые вопросы о покупке билетов</a>.</p>`;

  return {
    slug: 'лучшие-концерты-и-события-2027',
    schemaType: 'Article',
    title: 'Лучшие концерты и события 2027 года: полный гид по культурному сезону',
    description: 'Редакторский обзор обязательных событий 2027 в Израиле: международные балетные премьеры, мюзиклы, джаз и большие концерты, со ссылками на билеты.',
    date: '2026-08-31',
    author: BRAND.nameHe,
    image: (giants.concat(music, theater).find(s => s.image) || {}).image || '',
    bodyHtml,
  };
}

// Вечнозелёная страница вопросов и ответов (FAQ) — на основе официальных правил кассы
function faqArticle() {
  const faq = [
    { q: 'Когда и как я получу билеты после заказа?', a: `На большинство мероприятий билеты электронные, со штрихкодом. Сразу после оплаты на указанный email приходит подтверждение заказа с кнопкой «Ваши билеты», при этом сами штрихкоды открываются в день мероприятия. Кроме того, за день до мероприятия ссылка на электронные билеты приходит SMS-сообщением на телефон, указанный в заказе. В любой момент билеты можно открыть и в разделе «Мои заказы» на сайте кассы. Физический самовывоз не требуется.` },
    { q: 'Как заказать и оплатить, можно ли разбить на платежи?', a: `На странице мероприятия нажмите «Купить билеты». Есть два вида билетов: с местами, где вы выбираете кресло на схеме зала, или свободные, где вы выбираете количество билетов. Оплата возможна кредитной картой на сайте или по телефону, а также наличными в банке или банковским переводом. Страница оплаты надёжно защищена и зашифрована, а данные карты не сохраняются в системе. Оплату кредитной картой можно разбить на беспроцентные платежи.` },
    { q: 'Какова политика отмены и возврата средств?', a: `Отменить заказ по собственной инициативе можно не позднее чем за <strong>8 календарных дней</strong> до даты мероприятия. Например, если мероприятие состоится 9-го числа, последний день отмены — 1-е число. При возврате денег удерживается комиссия за отмену в размере <strong>5% стоимости заказа, но не более 100 шекелей</strong>. Изменение даты, количества билетов или мест выполняется через полную отмену прежнего заказа и оформление нового.` },
    { q: 'Что будет с билетами, если мероприятие отменили или перенесли?', a: `Касса уведомит вас по контактным данным, указанным в заказе. В разделе «Мои заказы» можно согласиться с изменениями или отменить заказ. При отмене или изменении мероприятия организатором <strong>полная сумма заказа возвращается</strong>.` },
    { q: 'Я не смог попасть на мероприятие. Вернут ли мне деньги?', a: `Если мероприятие состоялось по плану, а вы не посетили его по собственной инициативе, стоимость неиспользованных билетов не возвращается.` },
    { q: 'Есть ли скидки для военных, студентов или пенсионеров?', a: `Все виды билетов и цены, включая льготные категории, когда они предлагаются на конкретное мероприятие, показаны прямо на странице покупки билетов этого мероприятия. Информация на сайте едина для всех покупателей, поэтому рекомендуем проверить нужную страницу мероприятия в <a href="/">афише</a> — там отображаются все актуальные варианты билетов и цен.` },
    { q: 'Я сделал заказ, но не получил подтверждение на email, что делать?', a: `Подтверждение отправляется автоматически сразу после оплаты. Если вы его не видите во «Входящих», проверьте папку «Спам» или «Нежелательная почта». Возможно также, что при оформлении был указан неверный адрес — в этом случае зайдите в раздел «Мои заказы» и вышлите купон себе повторно.` },
    { q: 'Можно ли внести изменения в заказ?', a: `Данные получателя билетов можно изменить не позднее чем за <strong>24 часа</strong> до начала мероприятия — через раздел «Мои заказы», либо просто переслать подтверждение заказа другому человеку. Смена мест в уже оплаченном заказе выполняется через отмену прежнего заказа и оформление нового.` },
    { q: 'По каким вопросам стоит звонить в службу поддержки?', a: `Вся информация о мероприятиях и билетах доступна на сайте в режиме реального времени: даты, места проведения, цены и наличие. Операторы не являются справочной службой — телефон предназначен в первую очередь для оплаты уже оформленного заказа или для его отмены. Перед звонком рекомендуем изучить страницу мероприятия, <a href="/артисты/">список артистов</a> или <a href="/">полную афишу</a>.` },
  ];
  const bodyHtml = `<p>Мы собрали для вас ответы на самые частые вопросы о покупке билетов, их получении, отменах и возвратах — на основе официальных правил системы бронирования. Так вы сможете заказывать с уверенностью и точно знать, чего ожидать на каждом этапе.</p>
${faq.map(f => `<details class="faq-item"><summary>${escText(f.q)}</summary><div class="faq-answer">${f.a}</div></details>`).join('\n')}
<p class="faq-foot">Не нашли ответ на свой вопрос? Вся актуальная информация по каждому мероприятию, включая цены, даты и наличие, находится на странице самого мероприятия в <a href="/">афише</a>.</p>`;
  return {
    slug: 'частые-вопросы-о-покупке-билетов',
    schemaType: 'Article',
    faq,
    title: 'Частые вопросы о покупке билетов на мероприятия',
    description: 'Всё, что нужно знать о покупке билетов, их получении, политике отмен и возвратов, скидках и связи со службой поддержки — по официальным правилам кассы.',
    date: '2026-08-20',
    author: BRAND.nameHe,
    image: '',
    bodyHtml,
  };
}

function buildMagazine(shows) {
  const mdArticles = loadMdArticles();
  const generated = [weekendArticle(shows), familyWeekendArticle(shows), venuesSeatingGuide(), festivals2027Article(), mustSee2027Article(shows), faqArticle()].filter(Boolean);
  const genSlugs = new Set(generated.map(a => a.slug));
  let articles = [...generated, ...mdArticles.filter(a => !genSlugs.has(a.slug))];
  articles.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const used = new Set();
  articles.forEach(a => {
    let s = a.slug || 'article';
    if (used.has(s)) s += '-2';
    used.add(s);
    a.slug = s;
    a.url = `/magazine/${s}/`;
  });

  MAGAZINE_REDIRECTS = articles.filter(a => a.redirectFrom).map(a => ({ from: a.redirectFrom, to: a.slug }));

  articles.forEach(magArticlePage);

  const cardsHtml = articles.map(a => `
    <article class="mag-card">
      <a class="mag-card-media" href="${esc(a.url)}">${a.image ? `<img loading="lazy" src="${esc(a.image)}" alt="${esc(a.title)}">` : ''}</a>
      <div class="mag-card-body">
        <span class="mag-card-date">${formatDate(a.date)}</span>
        <h3 class="mag-card-title"><a href="${esc(a.url)}">${escText(a.title)}</a></h3>
        <p class="mag-card-desc">${escText(a.description)}</p>
        <a class="mag-card-link" href="${esc(a.url)}">Читать далее ›</a>
      </div>
    </article>`).join('\n');
  const idxBody = `
<article class="hub mag-index">
  <div class="wrap">
    <nav class="breadcrumb"><a href="/">Главная</a> <span>›</span> <span class="current">Журнал</span></nav>
    <h1 class="hub-title">Журнал культуры и досуга</h1>
    <p class="hub-intro">Гиды по досугу, рекомендации на выходные и статьи о культуре от ТОП Афиша. Всё самое интересное о концертах, спектаклях и культурной жизни Израиля.</p>
    ${LANDING_PAGES.length ? `<h2 class="mag-section-title">Популярные подборки</h2>
    <div class="mag-grid">${LANDING_PAGES.map(p => `
      <article class="mag-card">
        <a class="mag-card-media" href="${esc(p.url)}">${p.image ? `<img loading="lazy" src="${esc(p.image)}" alt="${esc(p.title)}">` : ''}</a>
        <div class="mag-card-body">
          <span class="mag-card-date">${formatDate(ymdStr(israelToday()))}</span>
          <h3 class="mag-card-title"><a href="${esc(p.url)}">${escText(p.title)}</a></h3>
          <p class="mag-card-desc">${escText(p.description)}</p>
          <a class="mag-card-link" href="${esc(p.url)}">Читать далее ›</a>
        </div>
      </article>`).join('\n')}</div>` : ''}
    <nav class="mag-subnav"><a class="mag-subnav-link" href="/magazine/news/">📰 Новости и обновления ›</a></nav>
    <h2 class="mag-section-title">Статьи и гиды</h2>
    <div class="mag-grid">${cardsHtml}</div>
  </div>
</article>`;
  const idxHtml = page({
    title: 'Журнал культуры и досуга | ТОП Афиша',
    description: 'Гиды по досугу, рекомендации на выходные и статьи о культуре. Журнал ТОП Афиша.',
    canonical: BRAND.domain + '/magazine/',
    head: breadcrumbSchema([{ name: 'Главная', url: BRAND.domain + '/' }, { name: 'Журнал', url: BRAND.domain + '/magazine/' }]),
    body: idxBody,
  });
  const md = path.join(BRAND.outDir, 'magazine');
  ensureDir(md);
  fs.writeFileSync(path.join(md, 'index.html'), idxHtml, 'utf8');

  MAGAZINE_ARTICLES = articles;
  return articles.length;
}

/* ===================== Движок новостей и обновлений (News Engine) =====================
   Независимый слой: короткие редакторские новостные заметки о культурной сцене,
   привязанные к данным фида, чтобы ссылки были живыми, а информация — настоящей. */

function newsPubDay(s) { return String(s.pubDate || '').slice(0, 10); }
function firstSentenceRu(txt) {
  const t = String(txt || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = t.match(/^(.{30,190}?[.!?…])(\s|$)/);
  return m ? m[1].trim() : (t.length > 170 ? t.slice(0, 167).trim() + '…' : t);
}
function newsKicker(section) {
  const s = section || '';
  if (/дет|цирк|сказ|семь/i.test(s)) return 'Новости для детей и семьи';
  if (/стендап|развлеч|комеди/i.test(s)) return 'Новости эстрады';
  if (/танц|балет/i.test(s)) return 'Новости танца';
  if (/классич|оркестр|опер|барокко/i.test(s)) return 'Новости классической музыки';
  if (/мюзикл|театр|спектакл|пьес/i.test(s)) return 'Новости театра';
  return 'Новости музыки';
}
function firstUpcomingSeance(s) {
  const today = ymdStr(israelToday());
  const list = [...(s.Seances || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return list.find(z => String(z.date) >= today && z.link) || list.find(z => z.link) || list[0] || {};
}

function newsItems(shows) {
  const items = [];
  const withPub = shows.filter(s => s.pubDate && s.image && (s.Seances || []).length);
  if (!withPub.length) return items;
  const maxPub = withPub.reduce((m, s) => newsPubDay(s) > m ? newsPubDay(s) : m, '0000-00-00');
  const thr = new Date(maxPub + 'T00:00:00'); thr.setDate(thr.getDate() - 21);
  const thrStr = ymdStr(thr);
  const fresh = withPub
    .filter(s => newsPubDay(s) >= thrStr)
    .sort((a, b) => String(b.pubDate).localeCompare(String(a.pubDate)))
    .slice(0, 12);

  for (const s of fresh) {
    const se = firstUpcomingSeance(s);
    const kicker = newsKicker(s.section);
    const city = se.city ? ` в ${se.city}` : '';
    const tpls = [
      `${s.name} выходит на сцену${city}: билеты уже в продаже`,
      `Анонс: ${s.name} приезжает${city}`,
      `${s.name} — старт продаж билетов${city}`,
    ];
    const title = tpls[Number(s.id || 0) % tpls.length];
    const lede = firstSentenceRu(s.announce || s.description) || `${s.name} присоединяется к нашей обновляемой афише.`;
    const when = se.date ? `${formatDate(se.date)}${se.time ? ` в ${formatTime(se.time)}` : ''}` : '';
    const venue = se.hall ? escText(se.hall + (se.city ? `, ${se.city}` : '')) : (se.city ? escText(se.city) : '');
    const v = VENUE_REGISTRY.find(x => se.hall && x.hall === se.hall && x.shows.length > 0);
    const venueHtml = v ? `<a href="${esc(v.url)}">${venue}</a>` : venue;
    const buy = seanceSoldOut(se) ? '<span class="soldout">Билеты распроданы</span>'
      : (se.link ? `<a class="news-cta" href="${esc(affiliateUrl(se.link))}" target="_blank" rel="noopener sponsored">Заказать билеты ›</a>` : '');
    const bodyHtml = `<p class="news-lede">${escText(lede)}</p>
<p>${venueHtml ? `Мероприятие пройдёт в ${venueHtml}` : 'Мероприятие'}${when ? ` — ${escText(when)}` : ''}, и билеты уже открыты для бронирования. Все даты, цены и выбор мест — на полной странице мероприятия: <a href="${esc(s._url)}"><strong>${escText(s.name)}</strong></a>.</p>
<p>${buy}</p>
<p class="news-related">Ещё по теме: <a href="/">полная афиша</a> · <a href="/magazine/">все статьи журнала</a></p>`;
    items.push({
      slug: capSlugBytes(slugify(s.name), 150),
      kicker,
      title,
      date: newsPubDay(s),
      description: `${kicker}: ${lede}`.slice(0, 155),
      image: s.image,
      bodyHtml,
    });
  }

  const c2027 = shows.filter(s => (s.Seances || []).some(z => String(z.date).startsWith('2027'))).length;
  if (c2027 >= 3) {
    items.unshift({
      slug: 'афиша-2027-открыта',
      kicker: 'Горячая тема',
      title: `Афиша 2027 набирает обороты: ${c2027} мероприятий уже открыты для брони`,
      date: maxPub,
      description: `Культурный сезон 2027 уже здесь: ${c2027} мероприятий и событий открыты для раннего бронирования.`,
      image: (shows.find(s => (s.Seances || []).some(z => String(z.date).startsWith('2027')) && s.image) || {}).image || '',
      bodyHtml: `<p class="news-lede">Культурный сезон 2027 уже начинает наполняться, и те, кто любит планировать заранее, уже могут занять места. ${c2027} мероприятий и событий открыты для раннего бронирования в нашей системе.</p>
<p>От международных балетных премьер до гигантских концертов, фестивалей и оригинальных постановок — предложение на следующий год растёт каждую неделю. Ранняя подготовка окупается: лучшие места и привлекательные цены разбирают первыми.</p>
<p>Полный обзор читайте в статьях <a href="/magazine/${encodeURI('лучшие-концерты-и-события-2027')}/">Лучшие концерты 2027</a> и <a href="/magazine/${encodeURI('фестивали-и-главные-события-2027')}/">Гид по фестивалям</a>, или переходите прямо к <a href="/афиша-2027.html"><strong>афише 2027</strong></a>.</p>
<p class="news-related"><a href="/magazine/">все статьи журнала</a></p>`,
    });
  }
  return items;
}

function newsArticlePage(a) {
  const canonical = `${BRAND.domain}${a.url}`;
  const crumb = breadcrumbSchema([
    { name: 'Главная', url: BRAND.domain + '/' },
    { name: 'Журнал', url: BRAND.domain + '/magazine/' },
    { name: 'Новости', url: BRAND.domain + '/magazine/news/' },
    { name: a.title, url: canonical },
  ]);
  const schema = {
    '@context': 'https://schema.org', '@type': 'NewsArticle',
    headline: a.title, description: a.description,
    datePublished: a.date, dateModified: a.date,
    image: a.image || undefined,
    author: { '@type': 'Organization', name: BRAND.nameHe, url: BRAND.domain },
    publisher: { '@type': 'Organization', name: BRAND.nameHe, url: BRAND.domain, logo: { '@type': 'ImageObject', url: BRAND.domain + '/assets/logo.svg' } },
    mainEntityOfPage: canonical,
  };
  const body = `
<article class="news-article">
  <div class="wrap news-wrap">
    <nav class="breadcrumb"><a href="/">Главная</a> <span>›</span> <a href="/magazine/">Журнал</a> <span>›</span> <a href="/magazine/news/">Новости</a> <span>›</span> <span class="current">${escText(a.title)}</span></nav>
    <span class="news-kicker">${escText(a.kicker || 'Новости')}</span>
    <h1 class="news-headline">${escText(a.title)}</h1>
    <p class="news-dateline">Обновлено ${formatDate(a.date)} · ${escText(BRAND.nameHe)}</p>
    ${a.image ? `<figure class="news-hero"><img src="${esc(a.image)}" alt="${esc(a.title)}"></figure>` : ''}
    <div class="news-body rte">${a.bodyHtml}</div>
    <p class="news-back"><a href="/magazine/news/">‹ ко всем новостям</a></p>
  </div>
</article>`;
  const html = page({
    title: `${a.title} | Новости ${BRAND.nameHe}`,
    description: a.description,
    canonical,
    head: crumb + `\n<script type="application/ld+json">${JSON.stringify(schema)}</script>` + (a.image ? `\n<meta property="og:image" content="${esc(a.image)}">` : ''),
    body,
  });
  const dir = path.join(BRAND.outDir, 'magazine', 'news', a.slug);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
}

function buildNews(shows) {
  const items = newsItems(shows);
  const used = new Set();
  items.forEach(a => {
    let s = a.slug || 'news';
    if (used.has(s)) s += '-' + (used.size);
    used.add(s);
    a.slug = s;
    a.url = `/magazine/news/${s}/`;
  });
  items.forEach(newsArticlePage);

  const cardsHtml = items.map(a => `
    <article class="news-card">
      <a class="news-card-media" href="${esc(a.url)}">${a.image ? `<img loading="lazy" src="${esc(a.image)}" alt="${esc(a.title)}">` : ''}</a>
      <div class="news-card-body">
        <span class="news-card-kicker">${escText(a.kicker || 'Новости')}</span>
        <h3 class="news-card-title"><a href="${esc(a.url)}">${escText(a.title)}</a></h3>
        <span class="news-card-date">${formatDate(a.date)}</span>
      </div>
    </article>`).join('\n');
  const idxBody = `
<article class="hub news-hub">
  <div class="wrap">
    <nav class="breadcrumb"><a href="/">Главная</a> <span>›</span> <a href="/magazine/">Журнал</a> <span>›</span> <span class="current">Новости</span></nav>
    <h1 class="hub-title">Новости и обновления</h1>
    <p class="hub-intro">Все горячие новости мира концертов, спектаклей и культуры в Израиле: анонсы новых мероприятий, старты продаж билетов и обновления афиши. Обновляется регулярно.</p>
    <div class="news-grid">${cardsHtml || '<p>Сейчас нет свежих обновлений. Загляните позже.</p>'}</div>
  </div>
</article>`;
  const idxHtml = page({
    title: `Новости и обновления | ${BRAND.nameHe}`,
    description: 'Новости и регулярные обновления из мира концертов и культуры в Израиле: анонсы мероприятий, старты продаж билетов и обновления афиши.',
    canonical: BRAND.domain + '/magazine/news/',
    head: breadcrumbSchema([{ name: 'Главная', url: BRAND.domain + '/' }, { name: 'Журнал', url: BRAND.domain + '/magazine/' }, { name: 'Новости', url: BRAND.domain + '/magazine/news/' }]),
    body: idxBody,
  });
  const nd = path.join(BRAND.outDir, 'magazine', 'news');
  ensureDir(nd);
  fs.writeFileSync(path.join(nd, 'index.html'), idxHtml, 'utf8');

  NEWS_ARTICLES = items;
  return items.length;
}

/* ===================== SEO-лендинги внутри журнала =====================
   8 целевых страниц под точные поисковые запросы, с автофильтрацией из фида. */
const TLV_RE = /Тель-Авив/;
function landingContext() {
  const t = israelToday();
  const day = t.getDay(); // 0=вс … 6=сб
  const untilSat = (6 - day + 7) % 7;
  return { today: ymdStr(t), tomorrow: ymdStr(addDays(t, 1)), saturday: ymdStr(addDays(t, untilSat)) };
}
function landingMatch(shows, { sectionRe, cityRe, dateTest }, ctx) {
  const out = [];
  for (const s of shows) {
    if (sectionRe && !sectionRe.test(s.section || '')) continue;
    let nd = null;
    for (const z of (s.Seances || [])) {
      if (cityRe && !cityRe.test(z.city || '')) continue;
      if (!dateTest(String(z.date || ''), ctx)) continue;
      if (nd === null || String(z.date) < nd) nd = String(z.date);
    }
    if (nd !== null) out.push({ s, nd });
  }
  out.sort((a, b) => a.nd.localeCompare(b.nd));
  return out.map(x => x.s);
}
function buildLandingPages(shows) {
  const ctx = landingContext();
  const CONCERT = /Концерт|Джаз|Мюзикл/i;
  const defs = [
    { slug: 'Концерты-Тель-Авив-2026', from: 'koncerty-tel-aviv-2026', h1: 'Концерты в Тель-Авиве 2026',
      title: 'Концерты Тель-Авив 2026 — афиша и билеты',
      desc: 'Полная афиша концертов в Тель-Авиве на 2026 год: актуальные даты, залы и цены. Покупка билетов онлайн в одном месте.',
      intro: 'Все музыкальные концерты, которые пройдут в Тель-Авиве в 2026 году. Выбирайте дату, зал и цену и заказывайте билеты онлайн.',
      f: { sectionRe: CONCERT, cityRe: TLV_RE, dateTest: d => d.startsWith('2026') } },
    { slug: 'Музыкальные-концерты-в-Израиле-2026', from: 'muzykalnye-koncerty-v-izraile-2026', h1: 'Музыкальные концерты в Израиле 2026',
      title: 'Музыкальные концерты в Израиле 2026 — афиша',
      desc: 'Афиша музыкальных концертов по всему Израилю на 2026 год: поп, рок, классика, джаз и мюзиклы. Актуальные даты и билеты.',
      intro: 'Лучшие музыкальные концерты по всему Израилю в 2026 году — от классики и джаза до больших эстрадных шоу и мюзиклов.',
      f: { sectionRe: CONCERT, dateTest: d => d.startsWith('2026') } },
    { slug: 'Афиша-Тель-Авив', from: 'afisha-tel-aviv', h1: 'Афиша Тель-Авив: концерты и мероприятия',
      title: 'Афиша Тель-Авив — концерты, спектакли, мероприятия',
      desc: 'Полная афиша Тель-Авива: концерты, спектакли, детские шоу и мероприятия. Ближайшие даты, залы и билеты онлайн.',
      intro: 'Полная афиша Тель-Авива на ближайшее время — концерты, спектакли, детские шоу и другие мероприятия города.',
      f: { cityRe: TLV_RE, dateTest: (d, c) => d >= c.today } },
    { slug: 'Концерт-в-Тель-Авиве-сегодня', from: 'koncert-v-tel-avive-segodnya', h1: 'Концерт в Тель-Авиве сегодня',
      title: 'Концерт в Тель-Авиве сегодня — афиша на сегодня',
      desc: 'Какие концерты проходят в Тель-Авиве сегодня: актуальный список на сегодняшний день с залами, ценами и билетами.',
      intro: 'Концерты, которые проходят в Тель-Авиве сегодня. Список обновляется автоматически каждый день.',
      f: { sectionRe: CONCERT, cityRe: TLV_RE, dateTest: (d, c) => d === c.today } },
    { slug: 'Мероприятия-в-Тель-Авиве-сегодня', from: 'meropriyatiya-v-tel-avive-segodnya', h1: 'Мероприятия в Тель-Авиве сегодня',
      title: 'Мероприятия в Тель-Авиве сегодня — что происходит',
      desc: 'Все мероприятия в Тель-Авиве сегодня: концерты, спектакли и шоу на сегодняшний день, с актуальными билетами.',
      intro: 'Все мероприятия Тель-Авива на сегодня — концерты, спектакли и шоу. Список обновляется автоматически.',
      f: { cityRe: TLV_RE, dateTest: (d, c) => d === c.today } },
    { slug: 'Мероприятия-в-Тель-Авиве-завтра', from: 'meropriyatiya-v-tel-avive-zavtra', h1: 'Мероприятия в Тель-Авиве завтра',
      title: 'Мероприятия в Тель-Авиве завтра — афиша на завтра',
      desc: 'Афиша Тель-Авива на завтра: концерты, спектакли и мероприятия следующего дня, с залами, ценами и билетами.',
      intro: 'Все мероприятия Тель-Авива на завтра — планируйте вечер заранее и заказывайте билеты онлайн.',
      f: { cityRe: TLV_RE, dateTest: (d, c) => d === c.tomorrow } },
    { slug: 'Куда-пойти-в-Тель-Авиве-в-субботу', from: 'kuda-poyti-v-tel-avive-v-subbotu', h1: 'Куда пойти в Тель-Авиве в субботу',
      title: 'Куда пойти в Тель-Авиве в субботу — афиша выходных',
      desc: 'Идеи, куда пойти в Тель-Авиве в субботу: концерты, спектакли и мероприятия ближайшей субботы с билетами онлайн.',
      intro: 'Лучшие идеи, куда пойти в Тель-Авиве в ближайшую субботу — концерты, спектакли и семейные шоу на выходные.',
      f: { cityRe: TLV_RE, dateTest: (d, c) => d === c.saturday } },
    { slug: 'Билеты-на-концерты-в-Израиле', from: 'bilety-na-koncerty-v-izraile', h1: 'Билеты на концерты в Израиле',
      title: 'Билеты на концерты в Израиле — афиша и покупка',
      desc: 'Билеты на концерты в Израиле: полная афиша ближайших музыкальных событий по всей стране, безопасная покупка онлайн.',
      intro: 'Билеты на ближайшие концерты по всему Израилю — классика, джаз, эстрада и мюзиклы. Актуальные даты и безопасная покупка.',
      f: { sectionRe: CONCERT, dateTest: (d, c) => d >= c.today } },
  ];

  const results = [];
  for (const def of defs) {
    let matched = landingMatch(shows, def.f, ctx).slice(0, 60);
    let fallbackNote = '';
    if (!matched.length) {
      // вечнозелёный запас: ближайшие события в Тель-Авиве (или в Израиле)
      const fb = landingMatch(shows, { cityRe: def.f.cityRe || null, dateTest: (d, c) => d >= c.today }, ctx);
      matched = fb.slice(0, 12);
      fallbackNote = `<p class="landing-empty">На выбранную дату мероприятий пока не найдено. Ниже — ближайшие события, которые не стоит пропустить.</p>`;
    }
    const url = `/magazine/${def.slug}/`;
    const canonical = BRAND.domain + url;
    const heroImage = (matched.find(s => s.image) || {}).image || '';
    const cards = matched.map(showCard).join('\n');
    const itemList = {
      '@context': 'https://schema.org', '@type': 'ItemList',
      itemListElement: matched.slice(0, 15).map((s, i) => ({
        '@type': 'ListItem', position: i + 1, url: BRAND.domain + s._url, name: s.name,
      })),
    };
    const crumb = breadcrumbSchema([
      { name: 'Главная', url: BRAND.domain + '/' },
      { name: 'Журнал', url: BRAND.domain + '/magazine/' },
      { name: def.h1, url: canonical },
    ]);
    const body = `
<article class="hub landing-page">
  <div class="wrap">
    <nav class="breadcrumb"><a href="/">Главная</a> <span>›</span> <a href="/magazine/">Журнал</a> <span>›</span> <span class="current">${escText(def.h1)}</span></nav>
    <h1 class="hub-title">${escText(def.h1)}</h1>
    <p class="hub-intro">${escText(def.intro)}</p>
    <p class="landing-count">Найдено мероприятий: <strong>${matched.length}</strong></p>
    ${fallbackNote}
    <div class="grid card-grid">${cards || '<p>Скоро здесь появятся мероприятия. Загляните позже.</p>'}</div>
    <p class="landing-related">Смотрите также: <a href="/">полную афишу</a> · <a href="/афиша-2027.html">афишу 2027</a> · <a href="/magazine/">журнал</a> · <a href="/magazine/${encodeURI('частые-вопросы-о-покупке-билетов')}/">частые вопросы о билетах</a></p>
  </div>
</article>`;
    const html = page({
      title: def.title + ' | ТОП Афиша',
      description: def.desc,
      canonical,
      head: crumb + `\n<script type="application/ld+json">${JSON.stringify(itemList)}</script>`,
      body,
    });
    const dir = path.join(BRAND.outDir, 'magazine', def.slug);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    results.push({ slug: def.slug, url, title: def.h1, description: def.desc, image: heroImage, count: matched.length });
  }
  LANDING_PAGES = results;
  LANDING_REDIRECTS = defs.filter(d => d.from).map(d => ({ from: d.from, to: d.slug }));
  return results.length;
}

/* ------------------------------ Главная страница -------------------------------- */
function buildIndex(shows) {
  const sections = [...new Set(shows.map(s => s.section).filter(Boolean))];
  const cities = [...new Set(shows.flatMap(s => (s.Seances || []).map(z => z.city)).filter(Boolean))];

  const cards = shows.map(showCard).join('\n');

  const sectionChips = sections.map(s =>
    `<button class="chip" data-filter="section" data-value="${esc(s)}">${escText(s)}</button>`).join('');

  const TOP_CITIES = ['Тель-Авив-Яффо', 'Иерусалим', 'Хайфа', 'Беэр-Шева', 'Ришон ле-Цион', 'Ашдод', 'Нетания'];
  const citySet = new Set(cities);
  const topCities = TOP_CITIES.filter(c => citySet.has(c));
  const citiesSorted = [...cities].sort((a, b) => a.localeCompare(b, 'ru'));
  const topCityChips = topCities.map(c =>
    `<button class="chip" data-filter="city" data-value="${esc(c)}">${escText(c)}</button>`).join('');
  const cityOptions = citiesSorted.map(c =>
    `<option value="${esc(c)}">${escText(c)}</option>`).join('');

  // Залы: 8 самых частых (чипы, короткие названия) + выпадающий список всех залов
  const hallCount = {};
  shows.forEach(s => [...new Set((s.Seances || []).map(z => z.hall).filter(Boolean))]
    .forEach(h => { hallCount[h] = (hallCount[h] || 0) + 1; }));
  const topVenues = Object.entries(hallCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]);
  const venueLabel = h => h.split(/\s[-–—]\s|,/)[0].trim();
  const venueChips = topVenues.map(h =>
    `<button class="chip" data-filter="venue" data-value="${esc(h)}" title="${esc(h)}">${escText(venueLabel(h))}</button>`).join('');
  const allVenues = Object.keys(hallCount).sort((a, b) => a.localeCompare(b, 'ru'));
  const venueOptions = allVenues.map(h =>
    `<option value="${esc(h)}">${escText(h)}</option>`).join('');

  const body = `
<section class="hero">
  <div class="wrap hero-inner">
    <p class="hero-eyebrow">${esc(BRAND.tagline)}</p>
    <h1 class="hero-title">Билеты на концерты и спектакли: сегодня, на неделе и по датам 2026</h1>
    <p class="hero-sub">Мы собираем для вас все ведущие концерты, спектакли и мероприятия Израиля. Выбирайте по дате, городу или категории и покупайте билеты быстро и безопасно.</p>
    <div class="search-box">
      <input id="q" type="search" placeholder="Поиск мероприятия, артиста или категории…" autocomplete="off" aria-label="Поиск мероприятия">
    </div>
  </div>
</section>

<main class="wrap main">
  <div class="filters">
    <div class="filter-row">
      <span class="filter-label">Категории</span>
      <div class="chips">
        <button class="chip is-active" data-filter="section" data-value="">Все</button>
        ${sectionChips}
      </div>
    </div>
    <div class="filter-row">
      <span class="filter-label">Города</span>
      <div class="chips city-chips">
        <button class="chip is-active" data-filter="city" data-value="">Все</button>
        ${topCityChips}
        <select id="city-select" class="city-select" aria-label="Выбор города из всех городов">
          <option value="">Все остальные города…</option>
          ${cityOptions}
        </select>
      </div>
    </div>
    <div class="filter-row">
      <span class="filter-label">Когда?</span>
      <div class="chips" id="date-chips">
        <button class="chip is-active" data-filter="date" data-value="all">Все</button>
        <button class="chip" data-filter="date" data-value="today">Сегодня</button>
        <button class="chip" data-filter="date" data-value="weekend">Ближайшие выходные (чт–сб)</button>
        <button class="chip" data-filter="date" data-value="next-7">Ближайшие 7 дней</button>
        <button class="chip" data-filter="date" data-value="this-month">Ближайший месяц</button>
      </div>
    </div>
    <div class="filter-row">
      <span class="filter-label">Залы и театры</span>
      <div class="chips venue-chips">
        <button class="chip is-active" data-filter="venue" data-value="">Все</button>
        ${venueChips}
        <select id="venue-select" class="city-select venue-select" aria-label="Выбор зала из всех залов">
          <option value="">Все остальные залы…</option>
          ${venueOptions}
        </select>
      </div>
    </div>
  </div>

  <div class="results-head">
    <h2 class="section-title">Ближайшие мероприятия</h2>
    <span id="count" class="results-count">Найдено: ${shows.length}</span>
  </div>

  <div id="grid" class="grid">
    ${cards}
  </div>
  <p id="empty" class="empty" hidden>По вашему запросу мероприятий не найдено.</p>
  <div id="load-more-wrap" class="load-more-wrap">
    <button id="load-more" class="btn btn-primary load-more-btn" type="button">Показать ещё</button>
  </div>
</main>

<script src="/assets/app.js" defer></script>`;

  const siteSchema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': BRAND.domain + '/#website',
        url: BRAND.domain + '/',
        name: BRAND.nameHe,
        description: 'Портал ведущих концертов, спектаклей и мероприятий в Израиле',
        inLanguage: 'ru',
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: BRAND.domain + '/?q={search_term_string}',
          },
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'Organization',
        '@id': BRAND.domain + '/#organization',
        name: BRAND.nameHe,
        url: BRAND.domain + '/',
        logo: BRAND.domain + '/assets/logo.svg',
      },
    ],
  };

  const html = page({
    title: `${BRAND.nameHe} | Билеты на концерты, спектакли и мероприятия в Израиле`,
    description: 'ТОП Афиша собирает для вас ведущие концерты, спектакли и мероприятия Израиля. Быстрый поиск, актуальные даты и безопасная покупка билетов.',
    canonical: BRAND.domain + '/',
    head: `<script type="application/ld+json">${JSON.stringify(siteSchema)}</script>`,
    body,
  });

  fs.writeFileSync(path.join(BRAND.outDir, 'index.html'), html, 'utf8');
}

/* ----------------------------- Страница мероприятия ---------------------------- */
function seanceRow(show, s) {
  return `<tr>
    <td data-th="Дата">${formatDate(s.date)}</td>
    <td data-th="Время">${formatTime(s.time)}</td>
    <td data-th="Город">${escText(s.city)}</td>
    <td data-th="Зал">${venueUrlByHall[s.hall] ? `<a href="${esc(venueUrlByHall[s.hall])}">${escText(s.hall)}</a>` : escText(s.hall)}</td>
    <td data-th="Цена">${priceLabel(s.priceMin, s.priceMax)}</td>
    <td data-th="Заказ">${seanceSoldOut(s) ? `<span class="soldout">Билеты распроданы</span>` : `<a class="btn btn-primary btn-sm" href="${esc(affiliateUrl(s.link))}" target="_blank" rel="noopener sponsored">Заказать билеты</a>`}</td>
  </tr>`;
}

// Точный подтип Schema.org по категории
const EVENT_TYPES = {
  'Концерты в Израиле': 'MusicEvent',
  'Джаз концерты': 'MusicEvent',
  'Концерты классической музыки': 'MusicEvent',
  'Музыка для детей': 'MusicEvent',
  'Опера': 'MusicEvent',
  'Спектакли': 'TheaterEvent',
  'Спектакли для детей': 'TheaterEvent',
  'Мюзиклы': 'TheaterEvent',
  'Стенд ап': 'ComedyEvent',
  'Балет и танец': 'DanceEvent',
};
function eventType(section) { return EVENT_TYPES[section] || 'Event'; }

// Смещение часового пояса Израиля для конкретной даты (устойчиво к переходу на летнее время)
function israelOffset(dateStr) {
  try {
    const utc = new Date(`${dateStr}T12:00:00Z`);
    const s = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'longOffset' }).format(utc);
    const m = s.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
    if (!m) return '+02:00';
    const sign = m[1][0];
    const hh = String(Math.abs(parseInt(m[1], 10))).padStart(2, '0');
    const mm = m[2] || '00';
    return `${sign}${hh}:${mm}`;
  } catch (e) { return '+02:00'; }
}

// Ориентировочное время окончания: +3 часа после начала, ISO 8601 с часовым поясом
function endDateTime(dateStr, timeStr) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  const [hh, mm, ss] = String(timeStr || '20:00:00').split(':').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss || 0));
  dt.setUTCHours(dt.getUTCHours() + 3);
  const p = n => String(n).padStart(2, '0');
  const eyd = `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
  return `${eyd}T${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}${israelOffset(eyd)}`;
}

function eventSchema(show) {
  const type = eventType(show.section);
  const events = (show.Seances || []).map(s => ({
    '@context': 'https://schema.org',
    '@type': type,
    name: show.name,
    url: `${BRAND.domain}${show._url}`,
    description: stripTags(show.description).slice(0, 300),
    image: show.image,
    startDate: `${s.date}T${(s.time || '20:00:00')}${israelOffset(s.date)}`,
    endDate: endDateTime(s.date, s.time),
    performer: { '@type': 'PerformingGroup', name: show.name },
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: s.hall,
      address: {
        '@type': 'PostalAddress',
        streetAddress: s.address || s.hall,
        addressLocality: s.city,
        addressCountry: 'IL',
      },
    },
    offers: {
      '@type': 'Offer',
      url: affiliateUrl(s.link),
      price: s.priceMin,
      priceCurrency: 'ILS',
      availability: seanceSoldOut(s) ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      validFrom: show.pubDate ? show.pubDate.replace(' ', 'T') : undefined,
    },
    organizer: { '@type': 'Organization', name: BRAND.nameHe, url: BRAND.domain },
  }));
  if (!events.length) return '';
  const payload = events.length === 1 ? events[0] : events;
  return `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;
}

function buildShow(show) {
  const cities = [...new Set((show.Seances || []).map(s => s.city).filter(Boolean))];
  const rows = (show.Seances || []).map(s => seanceRow(show, s)).join('\n');
  const canonical = `${BRAND.domain}${show._url}`;
  const metaDesc = stripTags(show.description).slice(0, 155);
  const sold = showSoldOut(show);

  // Вступительный фактический абзац для AI Overviews (динамически из фида)
  const se0 = firstUpcomingSeance(show);
  const leadDate = (se0.date || show.dateFrom) ? formatDate(se0.date || show.dateFrom) : '';
  const leadTime = se0.time ? formatTime(se0.time) : '';
  const leadVenue = se0.hall ? escText(se0.hall) : '';
  const leadCity = se0.city ? escText(se0.city) : (cities[0] ? escText(cities[0]) : '');
  const leadPrice = Number(show.priceMin) ? `${Number(show.priceMin)}` : '';
  const aiLede = sold
    ? `${escText(show.name)}${leadVenue ? ` — площадка ${leadVenue}` : ''}${leadCity ? `, ${leadCity}` : ''}. Билеты на данный момент распроданы.`
    : `${escText(show.name)} состоится${leadDate ? ` ${leadDate}` : ''}${leadTime ? ` в ${leadTime}` : ''}${leadVenue ? ` в ${leadVenue}` : ''}${leadCity ? `, ${leadCity}` : ''}. Билеты можно заказать на сайте${leadPrice ? ` по цене от ${leadPrice} шекелей` : ''}.`;

  const body = `
<nav class="breadcrumb wrap">
  <a href="/">Главная</a> <span>›</span> <span>${escText(show.section)}</span> <span>›</span> <span class="current">${escText(show.name)}</span>
</nav>

<article class="show">
  <div class="show-hero">
    <div class="wrap show-hero-inner">
      <div class="show-cover">
        <img src="${esc(show.image)}" alt="${esc(show.name)}">
      </div>
      <div class="show-head">
        <span class="pill">${escText(show.section)}</span>
        <h1 class="show-title">${escText(show.name)}</h1>
        <p class="show-announce">${escText(show.announce || '')}</p>
        ${artistUrlByName[show.name] ? `<p class="show-artist-link"><a href="${esc(artistUrlByName[show.name])}">Все концерты ${escText(show.name)} ›</a></p>` : ''}
        <div class="show-facts">
          <div class="fact"><span class="fact-k">Даты</span><span class="fact-v">${formatDate(show.dateFrom)}</span></div>
          <div class="fact"><span class="fact-k">Место</span><span class="fact-v">${escText(cities.join(' · ') || 'уточняется')}</span></div>
          <div class="fact"><span class="fact-k">Цена</span><span class="fact-v">${priceLabel(show.priceMin, show.priceMax)}</span></div>
        </div>
        ${sold ? `<span class="btn btn-soldout btn-lg">Билеты распроданы</span>` : `<a class="btn btn-primary btn-lg" href="#seances">Заказать билеты</a>`}
      </div>
    </div>
  </div>

  <div class="wrap show-grid">
    <section class="show-desc">
      <p class="show-lead">${aiLede}</p>
      <h2>О мероприятии</h2>
      <div class="rte">${safeHtml(show.description)}</div>
    </section>

    <aside class="show-aside">
      <div class="aside-card">
        <span class="aside-price-k">Цена билета</span>
        <span class="aside-price-v${sold ? ' soldout' : ''}">${sold ? 'Билеты распроданы' : priceLabel(show.priceMin, show.priceMax)}</span>
        ${sold ? `<span class="btn btn-soldout btn-block">Билеты распроданы</span>` : `<a class="btn btn-primary btn-block" href="#seances">Выбрать дату</a>`}
        <p class="aside-note">${sold ? 'Мероприятие распродано' : 'Покупка билетов'}</p>
        <p class="faq-hint">Вопросы об отмене или получении билетов? <a href="/magazine/${encodeURI('частые-вопросы-о-покупке-билетов')}/">Гид по частым вопросам ›</a></p>
      </div>
    </aside>
  </div>

  <section id="seances" class="wrap seances">
    <h2>Даты и билеты</h2>
    <div class="table-wrap">
      <table class="seance-table">
        <thead>
          <tr><th>Дата</th><th>Время</th><th>Город</th><th>Зал</th><th>Цена</th><th></th></tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    <p class="faq-hint faq-hint-center">Вопросы об отмене или получении билетов? <a href="/magazine/${encodeURI('частые-вопросы-о-покупке-билетов')}/">Читайте гид по частым вопросам ›</a></p>
  </section>
  ${sold ? '' : `<div class="mobile-cta"><a class="mobile-cta-btn" href="#seances">Купить билеты ›</a></div>`}
</article>`;

  const html = page({
    title: `${show.name} | Билеты 2026`,
    description: metaDesc,
    canonical,
    head: eventSchema(show) +
      `\n<meta property="og:image" content="${esc(show.image)}">`,
    body,
  });

  const dir = path.join(BRAND.outDir, ...show._dir.split('/'));
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
}

/* --------------------------- Индекс поиска ------------------------------ */
function buildSearchIndex(shows) {
  const index = shows.map(s => {
    const cities = [...new Set((s.Seances || []).map(z => z.city).filter(Boolean))];
    return {
      id: s.id,
      name: s.name,
      section: s.section,
      image: s.image,
      priceMin: s.priceMin,
      priceMax: s.priceMax,
      dateFrom: s.dateFrom,
      dateTo: s.dateTo,
      dates: [...new Set((s.Seances || []).map(z => z.date).filter(Boolean))],
      cities,
      url: s._url,
      announce: stripTags(s.announce || s.description).slice(0, 120),
    };
  });
  ensureDir(path.join(BRAND.outDir, 'data'));
  fs.writeFileSync(path.join(BRAND.outDir, 'data', 'search-index.json'),
    JSON.stringify(index, null, 2), 'utf8');
}

/* --------------------------- Карта сайта и robots --------------------------- */
function buildSitemap(shows) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: BRAND.domain + '/', pri: '1.0' },
    ...HUB_PAGES.map(p => ({ loc: `${BRAND.domain}/${p.slug}.html`, pri: '0.9' })),
    ...CITY_PAGES.map(p => ({ loc: `${BRAND.domain}/${p.slug}/`, pri: '0.9' })),
    { loc: `${BRAND.domain}/артисты/`, pri: '0.7' },
    ...ARTIST_REGISTRY.map(a => ({ loc: `${BRAND.domain}${a.url}`, pri: '0.7' })),
    ...VENUE_REGISTRY.map(v => ({ loc: `${BRAND.domain}${v.url}`, pri: '0.7' })),
    { loc: `${BRAND.domain}/magazine/`, pri: '0.7' },
    ...MAGAZINE_ARTICLES.map(a => ({ loc: `${BRAND.domain}${a.url}`, pri: '0.6' })),
    ...LANDING_PAGES.map(a => ({ loc: `${BRAND.domain}${a.url}`, pri: '0.8' })),
    { loc: `${BRAND.domain}/magazine/news/`, pri: '0.7' },
    ...NEWS_ARTICLES.map(a => ({ loc: `${BRAND.domain}${a.url}`, pri: '0.6' })),
    ...shows.map(s => ({ loc: `${BRAND.domain}${s._url}`, pri: '0.8' })),
    ...STATIC_SLUGS.map(slug => ({ loc: `${BRAND.domain}/${slug}.html`, pri: '0.4' })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc.startsWith('http') ? encodeURI(u.loc).replace(/&/g, '&amp;') : u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>${u.pri}</priority>
  </url>`).join('\n')}
</urlset>`;
  fs.writeFileSync(path.join(BRAND.outDir, 'sitemap.xml'), xml, 'utf8');

  const robots = `User-agent: *
Allow: /

Sitemap: ${BRAND.domain}/sitemap.xml
`;
  fs.writeFileSync(path.join(BRAND.outDir, 'robots.txt'), robots, 'utf8');
}

/* ------------------------------ ads.txt (AdSense) --------------------- */
function buildAdsTxt() {
  fs.writeFileSync(path.join(BRAND.outDir, 'ads.txt'), BRAND.adsTxt + '\n', 'utf8');
}

/* ------------------------------ Ассеты (CSS/JS) ------------------------- */
function buildAssets() {
  const outAssets = path.join(BRAND.outDir, 'assets');
  ensureDir(outAssets);
  fs.writeFileSync(path.join(outAssets, 'styles.css'), STYLES, 'utf8');
  fs.writeFileSync(path.join(outAssets, 'app.js'), APP_JS, 'utf8');
  fs.writeFileSync(path.join(outAssets, 'accessibility.js'), A11Y_JS, 'utf8');
  const srcAssets = path.join(__dirname, 'assets');
  if (fs.existsSync(srcAssets)) {
    for (const f of fs.readdirSync(srcAssets)) {
      fs.copyFileSync(path.join(srcAssets, f), path.join(outAssets, f));
    }
  }
}

const STYLES = `:root{
  --bg:#f7f4f0; --card:#ffffff; --ink:#181320; --muted:#7a7385;
  --line:#ece7e1; --plum:#6d1f4b; --plum-d:#57173b; --gold:#bf9b48; --gold-d:#a07f2e;
  --accent:linear-gradient(135deg,#6d1f4b 0%,#a63a63 55%,#bf9b48 130%);
  --shadow:0 10px 30px rgba(24,19,32,.08); --shadow-sm:0 4px 14px rgba(24,19,32,.06);
  --radius:18px; --wrap:1160px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:'Rubik',system-ui,'Segoe UI',Arial,sans-serif;
  font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
img{max-width:100%;display:block}
.wrap{max-width:var(--wrap);margin-inline:auto;padding-inline:20px;width:100%}

/* header */
.site-header{position:sticky;top:0;z-index:50;background:rgba(247,244,240,.85);
  backdrop-filter:saturate(140%) blur(10px);border-bottom:1px solid var(--line)}
.header-inner{display:flex;align-items:center;justify-content:space-between;height:68px}
.brand{display:flex;align-items:center;gap:10px}
.site-logo{height:40px;width:auto;max-width:100%;display:block}
@media(max-width:560px){.site-logo{height:34px}}
.top-nav{display:flex;gap:20px;align-items:center}
.top-nav a{color:var(--muted);font-weight:600}
.top-nav a:hover{color:var(--plum)}
.lang-switch{border:1px solid var(--line);border-radius:999px;padding:5px 12px;font-size:13px;color:var(--plum)}
.lang-switch:hover{background:var(--plum);color:#fff;border-color:var(--plum)}

/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
  border:0;cursor:pointer;font-family:inherit;font-weight:700;border-radius:12px;
  padding:12px 20px;font-size:15px;transition:transform .12s ease,box-shadow .2s ease;white-space:nowrap}
.btn-primary{background:var(--accent);color:#fff;box-shadow:0 8px 20px rgba(109,31,75,.28)}
.btn-primary:hover{transform:translateY(-2px);box-shadow:0 12px 26px rgba(109,31,75,.35)}
.btn-sm{padding:9px 14px;font-size:14px;border-radius:10px}
.btn-lg{padding:15px 30px;font-size:17px}
.btn-block{width:100%}

/* hero */
.hero{background:
  radial-gradient(1200px 400px at 90% -10%,rgba(191,155,72,.16),transparent 60%),
  radial-gradient(900px 380px at 0% 0%,rgba(109,31,75,.14),transparent 55%);
  border-bottom:1px solid var(--line)}
.hero-inner{padding:64px 20px 54px;text-align:center}
.hero-eyebrow{color:var(--gold-d);font-weight:700;letter-spacing:.5px;margin:0 0 10px;text-transform:uppercase;font-size:13px}
.hero-title{font-size:clamp(28px,5vw,46px);line-height:1.15;margin:0 0 14px;font-weight:800}
.hero-sub{color:var(--muted);max-width:620px;margin:0 auto 26px;font-size:18px}
.search-box{max-width:560px;margin-inline:auto}
.search-box input{width:100%;padding:16px 20px;border-radius:16px;border:1px solid var(--line);
  background:var(--card);font-family:inherit;font-size:17px;box-shadow:var(--shadow-sm);outline:none}
.search-box input:focus{border-color:var(--plum);box-shadow:0 0 0 4px rgba(109,31,75,.12)}

/* filters */
.main{padding-block:34px 60px}
.filters{display:flex;flex-direction:column;gap:14px;margin-bottom:26px}
.filter-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.filter-label{font-weight:700;color:var(--muted);min-width:70px;font-size:14px}
.chips{display:flex;gap:9px;flex-wrap:wrap}
.chip{border:1px solid var(--line);background:var(--card);color:var(--ink);
  padding:8px 15px;border-radius:999px;cursor:pointer;font-family:inherit;font-weight:600;
  font-size:14px;transition:all .15s ease}
.chip:hover{border-color:var(--plum);color:var(--plum)}
.chip.is-active{background:var(--plum);border-color:var(--plum);color:#fff}
.venue-chips .chip{max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.results-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:18px;gap:12px;flex-wrap:wrap}
.section-title{font-size:24px;margin:0;font-weight:800}
.results-count{color:var(--muted);font-weight:600}

/* grid + cards */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--shadow-sm);
  transition:transform .15s ease,box-shadow .2s ease}
.card:hover{transform:translateY(-4px);box-shadow:var(--shadow)}
.card-media{position:relative;aspect-ratio:16/10;overflow:hidden;background:#efe9e2}
.card-media img{width:100%;height:100%;object-fit:cover;transition:transform .4s ease}
.card:hover .card-media img{transform:scale(1.05)}
.card-badge{position:absolute;top:12px;inset-inline-start:12px;background:rgba(24,19,32,.72);
  color:#fff;padding:5px 12px;border-radius:999px;font-size:12px;font-weight:600;backdrop-filter:blur(4px)}
.card-body{padding:16px 18px 18px;display:flex;flex-direction:column;gap:9px;flex:1}
.card-title{font-size:18px;margin:0;line-height:1.3;font-weight:700}
.card-title a:hover{color:var(--plum)}
.card-meta{display:flex;flex-wrap:wrap;gap:6px 14px;color:var(--muted);font-size:13.5px;margin:0}
.card-meta .ico-cal::before{content:"📅 "}
.card-meta .ico-pin::before{content:"📍 "}
.card-announce{color:var(--muted);font-size:14px;margin:0;
  display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:4px}
.card-price{font-weight:800;color:var(--plum);font-size:16px}
.soldout{color:#c0392b;font-weight:800}
.btn-soldout{background:#ece5dd;color:#8a7f72;box-shadow:none}
.btn-soldout:hover{transform:none;box-shadow:none}
span.btn-soldout{cursor:default}
.aside-price-v.soldout{color:#c0392b}
.empty{text-align:center;color:var(--muted);padding:40px;font-size:18px}

/* city select + load more */
.city-select{border:1px solid var(--line);background:var(--card);color:var(--ink);
  padding:8px 15px;border-radius:999px;cursor:pointer;font-family:inherit;font-weight:600;
  font-size:14px;transition:all .15s ease;max-width:230px;
  appearance:none;-webkit-appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236d1f4b' stroke-width='3'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 12px center;padding-inline-end:30px}
.city-select:hover{border-color:var(--plum);color:var(--plum)}
.city-select:focus-visible{outline:2px solid var(--plum);outline-offset:1px}
.load-more-wrap{display:flex;justify-content:center;margin-top:34px}
.load-more-wrap[hidden]{display:none}
.load-more-btn{padding:14px 40px;font-size:16px}

/* breadcrumb */
.breadcrumb{padding-block:18px 4px;color:var(--muted);font-size:14px;display:flex;gap:8px;flex-wrap:wrap}
.breadcrumb a:hover{color:var(--plum)}
.breadcrumb .current{color:var(--ink);font-weight:600}

/* show page */
.show-hero{padding-block:20px 28px}
.show-hero-inner{display:grid;grid-template-columns:minmax(0,420px) 1fr;gap:34px;align-items:start}
.show-cover{border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow);background:#efe9e2;aspect-ratio:16/10}
.show-cover img{width:100%;height:100%;object-fit:cover}
.pill{display:inline-block;background:rgba(109,31,75,.1);color:var(--plum);font-weight:700;
  padding:6px 14px;border-radius:999px;font-size:13px;margin-bottom:12px}
.show-title{font-size:clamp(24px,4vw,36px);margin:0 0 10px;line-height:1.2;font-weight:800}
.show-lead{font-size:17px;line-height:1.7;font-weight:600;color:var(--ink);background:var(--bg);border-radius:10px;padding:14px 16px;margin:0 0 18px;border-inline-start:3px solid var(--plum)}
/* Mobile sticky CTA — изолированный блок, легко отключить (удалить блок и .mobile-cta в шаблоне) */
.mobile-cta{display:none}
@media(max-width:767px){
  .mobile-cta{display:block;position:fixed;inset-inline:0;bottom:0;z-index:80;background:#fff;box-shadow:0 -2px 16px rgba(0,0,0,.14);padding:10px 14px calc(10px + env(safe-area-inset-bottom))}
  .mobile-cta-btn{display:block;text-align:center;background:#16a34a;color:#fff;font-weight:800;font-size:17px;padding:15px;border-radius:12px;text-decoration:none;box-shadow:0 2px 8px rgba(22,163,74,.35)}
  .mobile-cta-btn:active{background:#12833c}
  body:has(.mobile-cta){padding-bottom:84px}
}
.show-announce{color:var(--muted);font-size:18px;margin:0 0 12px}
.show-artist-link{margin:0 0 18px}
.show-artist-link a{color:var(--plum);font-weight:700;font-size:15px}
.show-artist-link a:hover{text-decoration:underline}
.show-facts{display:flex;gap:26px;flex-wrap:wrap;margin-bottom:22px}
.fact{display:flex;flex-direction:column;gap:2px}
.fact-k{color:var(--muted);font-size:13px;font-weight:600}
.fact-v{font-weight:700;font-size:15px}

.show-grid{display:grid;grid-template-columns:1fr 320px;gap:34px;padding-block:20px 10px;align-items:start}
.show-desc h2,.seances h2{font-size:22px;font-weight:800;margin:0 0 14px}
.rte{color:#312a3a;font-size:16.5px;line-height:1.85}
.rte strong{color:var(--ink)}
.show-aside{position:sticky;top:88px}
.aside-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:22px;box-shadow:var(--shadow-sm);display:flex;flex-direction:column;gap:10px;text-align:center}
.aside-price-k{color:var(--muted);font-size:13px;font-weight:600}
.aside-price-v{font-size:26px;font-weight:800;color:var(--plum)}
.aside-note{color:var(--muted);font-size:12.5px;margin:4px 0 0}

/* seance table */
.seances{padding-block:26px 60px}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);box-shadow:var(--shadow-sm)}
.seance-table{width:100%;border-collapse:collapse;min-width:640px}
.seance-table th,.seance-table td{padding:15px 16px;text-align:start;border-bottom:1px solid var(--line);font-size:15px}
.seance-table thead th{background:#faf7f3;font-weight:700;color:var(--muted);font-size:13.5px}
.seance-table tbody tr:last-child td{border-bottom:0}
.seance-table tbody tr:hover{background:#fbf8f4}

/* footer */
.site-footer{background:#211a2b;color:#cfc7d6;padding-block:50px 22px;margin-top:24px}
.footer-grid{display:grid;grid-template-columns:1.7fr 1fr 1fr 1fr;gap:36px}
.footer-col{min-width:0}
.foot-brand{font-weight:800;color:#fff;font-size:19px;margin-bottom:12px}
.foot-desc{max-width:360px;margin:0;font-size:14px;line-height:1.85;color:#a99fb4}
.footer-title{color:#fff;font-size:15px;font-weight:700;margin:0 0 15px;padding-bottom:9px;
  border-bottom:1px solid rgba(255,255,255,.12)}
.footer-links{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.footer-links a,.footer-links span{color:#b4aabf;font-size:14px;transition:color .15s ease}
.footer-links a:hover{color:var(--gold)}
.footer-links span{cursor:default}
.footer-bottom{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;
  margin-top:36px;padding-top:20px;border-top:1px solid rgba(255,255,255,.1)}
.foot-copy,.foot-disclaimer{font-size:13px;color:#8b8199}
.footer-legal-links{font-size:13px;color:#8b8199;display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:center}
.footer-legal-links a{color:#cfc7d6;font-weight:600}
.footer-legal-links a:hover{color:var(--gold)}

/* footer timing links row */
.footer-timing{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;
  margin-top:30px;padding-top:20px;border-top:1px solid rgba(255,255,255,.1)}
.footer-timing-label{color:#8b8199;font-weight:700;font-size:13px}
.footer-timing a{color:#cfc7d6;font-size:14px;font-weight:600}
.footer-timing a:hover{color:var(--gold)}

/* hub (timing) landing pages */
.hub{padding-block:6px 50px}
.hub .breadcrumb{padding-block:18px 2px}
.hub-title{font-size:clamp(26px,4vw,38px);font-weight:800;margin:8px 0 10px;line-height:1.2}
.hub-intro{color:var(--muted);font-size:17px;max-width:760px;margin:0 0 22px;line-height:1.7}
.hub .results-head{margin-bottom:18px}
.hub-empty{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:28px;box-shadow:var(--shadow-sm);text-align:center;color:var(--muted)}
.hub-empty p{margin:0 0 16px;font-size:17px}
.hub-empty-links{list-style:none;margin:0;padding:0;display:flex;gap:10px 18px;flex-wrap:wrap;justify-content:center}
.hub-empty-links a{color:var(--plum);font-weight:700;text-decoration:underline}
.artist-list-section{margin-top:40px;border-top:1px solid var(--line);padding-top:26px}
.artist-list-section h2{font-size:20px;font-weight:800;margin:0 0 16px}
.artist-list{list-style:none;margin:0;padding:0;columns:3;column-gap:28px}
.artist-list li{margin:0 0 9px;break-inside:avoid}
.artist-list a{color:var(--ink);font-size:14.5px}
.artist-list a:hover{color:var(--plum);text-decoration:underline}
@media(max-width:780px){.artist-list{columns:2}}
@media(max-width:480px){.artist-list{columns:1}}

/* static / legal pages */
.static{padding-block:6px 46px}
.static-inner{max-width:820px}
.static .breadcrumb{padding-block:18px 2px}
.static-title{font-size:clamp(26px,4vw,38px);font-weight:800;margin:8px 0 16px;line-height:1.2}
.static-updated{color:var(--muted);font-size:14px;margin:0 0 22px}
.static-body h2{font-size:20px;font-weight:800;margin:26px 0 10px}
.static-body p{margin:0 0 14px}
.static-body a{color:var(--plum);text-decoration:underline}

/* ===== magazine (editorial layout) ===== */
.mag-index{padding-block:6px 50px}
.mag-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:26px;margin-top:8px}
.mag-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;
  display:flex;flex-direction:column;box-shadow:var(--shadow-sm);transition:transform .15s ease,box-shadow .2s ease}
.mag-card:hover{transform:translateY(-4px);box-shadow:var(--shadow)}
.mag-card-media{display:block;aspect-ratio:16/9;overflow:hidden;background:#efe9e2}
.mag-card-media img{width:100%;height:100%;object-fit:cover}
.mag-card-body{padding:16px 18px 18px;display:flex;flex-direction:column;gap:8px;flex:1}
.mag-card-date{color:var(--gold-d);font-size:12.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}
.mag-card-title{font-size:19px;margin:0;line-height:1.3;font-weight:800}
.mag-card-title a:hover{color:var(--plum)}
.mag-card-desc{color:var(--muted);font-size:14px;margin:0;flex:1;
  display:-webkit-box;-webkit-line-clamp:3;line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.mag-card-link{color:var(--plum);font-weight:700;font-size:14px;margin-top:2px}
.mag-subnav{margin:-6px 0 22px}
.mag-subnav-link{display:inline-block;background:var(--plum);color:#fff;font-weight:700;font-size:15px;padding:9px 18px;border-radius:999px;text-decoration:none;box-shadow:var(--shadow-sm)}
.mag-subnav-link:hover{background:var(--plum-d)}
.mag-section-title{font-size:22px;font-weight:800;margin:26px 0 16px}
.mag-index .mag-section-title:first-of-type{margin-top:8px}
.landing-page{padding-block:6px 50px}
.landing-count{color:var(--muted);font-size:15px;margin:4px 0 18px}
.landing-empty{background:var(--bg);border-left:3px solid var(--gold);border-radius:6px;padding:10px 14px;color:var(--muted);font-style:italic;font-size:14px;margin:0 0 18px}
.landing-related{margin-top:26px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}

/* News Layout — раздел новостей */
.news-hub{padding-block:6px 50px}
.news-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:22px;margin-top:10px}
.news-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--shadow-sm);transition:transform .15s ease,box-shadow .2s ease}
.news-card:hover{transform:translateY(-4px);box-shadow:var(--shadow)}
.news-card-media{display:block;aspect-ratio:16/9;overflow:hidden;background:#efe9e2}
.news-card-media img{width:100%;height:100%;object-fit:cover}
.news-card-body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:7px;flex:1}
.news-card-kicker{color:var(--gold-d);font-size:11.5px;font-weight:800;letter-spacing:.5px}
.news-card-title{font-size:17px;line-height:1.35;margin:0;flex:1}
.news-card-title a{color:var(--ink);text-decoration:none}
.news-card-title a:hover{color:var(--plum)}
.news-card-date{color:var(--muted);font-size:12.5px;font-weight:600}
.news-article{padding-block:6px 56px}
.news-wrap{max-width:720px}
.news-article .breadcrumb{padding-block:18px 2px}
.news-kicker{display:inline-block;background:var(--gold);color:#fff;font-size:12.5px;font-weight:800;letter-spacing:.5px;padding:4px 12px;border-radius:999px;margin-bottom:8px}
.news-headline{font-size:clamp(26px,4.5vw,38px);font-weight:800;line-height:1.22;margin:6px 0 8px}
.news-dateline{color:var(--muted);font-size:14px;font-weight:600;margin:0 0 18px}
.news-hero{margin:0 0 22px;border-radius:var(--radius);overflow:hidden}
.news-hero img{width:100%;height:auto;display:block}
.news-lede{font-size:19px;line-height:1.6;font-weight:600;color:var(--ink)}
.news-body.rte p{margin:0 0 14px;line-height:1.75}
.news-cta{display:inline-block;background:var(--plum);color:#fff;font-weight:800;padding:11px 22px;border-radius:999px;text-decoration:none;box-shadow:var(--shadow-sm)}
.news-cta:hover{background:var(--plum-d)}
.news-related{font-size:14px;color:var(--muted);border-top:1px solid var(--line);padding-top:14px;margin-top:20px}
.news-back{margin-top:22px}
.news-back a{color:var(--plum);font-weight:700;text-decoration:none}

.mag-article{padding-block:6px 56px}
.mag-wrap{max-width:760px}
.mag-article .breadcrumb{padding-block:18px 2px}
.mag-title{font-size:clamp(28px,5vw,42px);font-weight:800;line-height:1.2;margin:8px 0 10px}
.mag-byline{color:var(--muted);font-size:14.5px;margin:0 0 22px}
.mag-hero{margin:0 0 26px;border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow)}
.mag-hero img{width:100%;height:auto;display:block}
.mag-body{font-size:18px;line-height:1.9;color:#2c2536}
.mag-body h2{font-size:24px;font-weight:800;margin:32px 0 12px;color:var(--ink);line-height:1.25}
.mag-body h3{font-size:20px;font-weight:700;margin:24px 0 10px}
.mag-body p{margin:0 0 18px}
.mag-body a{color:var(--plum);text-decoration:underline}
.mag-body ul{margin:0 0 18px;padding-inline-start:22px;display:flex;flex-direction:column;gap:10px}
.mag-body blockquote{margin:0 0 18px;padding:12px 18px;border-inline-start:4px solid var(--gold);
  background:#faf7f3;border-radius:0 10px 10px 0;color:#4a4356}
.mag-body figure{margin:0 0 22px}
.mag-body figure img{width:100%;border-radius:var(--radius)}
.mag-picks li{line-height:1.7}
.mag-buy{white-space:nowrap;font-weight:700}
.faq-item{border:1px solid var(--line);border-radius:12px;background:var(--card);margin:0 0 12px;overflow:hidden;box-shadow:var(--shadow-sm)}
.faq-item summary{cursor:pointer;list-style:none;padding:16px 20px;font-weight:700;font-size:17px;color:var(--ink);position:relative;padding-inline-start:46px}
.faq-item summary::-webkit-details-marker{display:none}
.faq-item summary::before{content:"+";position:absolute;inset-inline-start:18px;top:50%;transform:translateY(-50%);width:22px;height:22px;line-height:22px;text-align:center;background:var(--plum);color:#fff;border-radius:50%;font-weight:800;font-size:16px}
.faq-item[open] summary::before{content:"–"}
.faq-item[open] summary{color:var(--plum)}
.faq-answer{padding:0 20px 18px 20px;line-height:1.75;color:var(--ink)}
.faq-answer a{color:var(--plum);font-weight:700}
.faq-foot{margin-top:22px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:15px}
.faq-hint{font-size:13px;color:var(--muted);margin:10px 0 0;line-height:1.5;opacity:.85}
.faq-hint a{color:var(--muted);text-decoration:underline;font-weight:600}
.faq-hint a:hover{color:var(--plum);opacity:1}
.faq-hint-center{text-align:center;margin-top:18px}
.mag-sect{color:var(--gold-d);font-weight:700;font-size:13px}
.mag-note{display:block;margin-top:10px;padding:10px 14px;background:var(--bg);border-left:3px solid var(--gold);border-radius:6px;color:var(--muted);font-style:italic;font-size:14px}
.mag-picks li{line-height:1.7;margin-bottom:4px}
.mag-back{margin-top:30px;padding-top:20px;border-top:1px solid var(--line)}
.mag-back a{color:var(--plum);font-weight:700}
@media(max-width:860px){
  .footer-grid{grid-template-columns:1fr 1fr;gap:30px}
  .foot-desc{max-width:none}
}
@media(max-width:560px){
  .footer-grid{grid-template-columns:1fr;gap:26px}
  .footer-bottom{flex-direction:column;align-items:flex-start;gap:8px}
}

/* responsive */
@media(max-width:860px){
  .show-hero-inner{grid-template-columns:1fr}
  .show-grid{grid-template-columns:1fr}
  .show-aside{position:static}
  .seance-table{min-width:0}
  .seance-table thead{display:none}
  .seance-table,.seance-table tbody,.seance-table tr,.seance-table td{display:block;width:100%}
  .seance-table tr{border-bottom:1px solid var(--line);padding:8px 0}
  .seance-table td{border:0;padding:7px 16px;display:flex;justify-content:space-between;gap:12px;align-items:center}
  .seance-table td::before{content:attr(data-th);color:var(--muted);font-weight:700;font-size:13px}
  .seance-table td:last-child{justify-content:flex-start}
  .seance-table td:last-child .btn{width:100%}
}
@media(max-width:560px){
  .hero-inner{padding:44px 20px 38px}
  .grid{grid-template-columns:1fr;gap:18px}
  .header-inner{height:60px}
}

/* ===== accessibility widget ===== */
.a11y-widget{position:fixed;bottom:20px;left:20px;z-index:1000;font-family:'Rubik',Arial,sans-serif}
.a11y-btn{width:54px;height:54px;border-radius:50%;border:0;cursor:pointer;background:var(--plum);color:#fff;
  display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.28);transition:transform .15s ease}
.a11y-btn:hover{transform:scale(1.07)}
.a11y-btn:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.a11y-menu{position:absolute;bottom:66px;left:0;width:280px;max-width:calc(100vw - 40px);background:#fff;color:#181320;
  border-radius:16px;box-shadow:0 18px 44px rgba(0,0,0,.3);border:1px solid #e5e0da;overflow:hidden}
.a11y-menu[hidden]{display:none}
.a11y-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--plum);color:#fff}
.a11y-header h3{margin:0;font-size:16px;font-weight:700}
.a11y-close-btn{background:transparent;border:0;color:#fff;font-size:26px;line-height:1;cursor:pointer;padding:0 4px}
.a11y-close-btn:focus-visible{outline:2px solid var(--gold);outline-offset:2px;border-radius:4px}
.a11y-tools{padding:12px;display:flex;flex-direction:column;gap:8px}
.a11y-tool{text-align:start;padding:11px 14px;border:1px solid #e5e0da;background:#faf7f3;border-radius:10px;
  font-family:inherit;font-size:14.5px;font-weight:600;color:#181320;cursor:pointer;transition:all .12s ease}
.a11y-tool:hover{border-color:var(--plum);background:#fff}
.a11y-tool:focus-visible{outline:2px solid var(--plum);outline-offset:1px}
.a11y-tool[aria-pressed="true"]{background:var(--plum);border-color:var(--plum);color:#fff}
.a11y-reset{background:#fff;border-color:#d9b3c2;color:var(--plum)}
.a11y-reset:hover{background:#fbf1f5;border-color:var(--plum)}
.a11y-footer{padding:10px 16px 14px;border-top:1px solid #eee;color:#7a7385;text-align:center;font-size:12px}

/* ===== accessibility states (applied on <html>) ===== */
html.a11y-underline a{text-decoration:underline !important}
html.a11y-readable, html.a11y-readable body, html.a11y-readable :not(.a11y-btn):not(.a11y-btn *){
  font-family:'Arial',sans-serif !important}
html.a11y-readable p,html.a11y-readable li,html.a11y-readable .rte{line-height:1.95 !important;letter-spacing:.02em}
html.a11y-invert{filter:invert(1) hue-rotate(180deg)}
html.a11y-invert img{filter:invert(1) hue-rotate(180deg)}
html.a11y-contrast-high,html.a11y-contrast-high body{background:#000 !important}
html.a11y-contrast-high .card,html.a11y-contrast-high .aside-card,html.a11y-contrast-high .table-wrap,
html.a11y-contrast-high .search-box input,html.a11y-contrast-high .chip,html.a11y-contrast-high .seance-table thead th{
  background:#000 !important;border-color:#fff !important}
html.a11y-contrast-high h1,html.a11y-contrast-high h2,html.a11y-contrast-high h3,html.a11y-contrast-high p,
html.a11y-contrast-high span,html.a11y-contrast-high li,html.a11y-contrast-high td,html.a11y-contrast-high th,
html.a11y-contrast-high .card-title,html.a11y-contrast-high .hero-title,html.a11y-contrast-high label{color:#fff !important}
html.a11y-contrast-high a,html.a11y-contrast-high .card-price,html.a11y-contrast-high .aside-price-v{color:#ffe14d !important}
html.a11y-contrast-high .btn,html.a11y-contrast-high .btn-primary{background:#ffe14d !important;color:#000 !important;box-shadow:none !important}
html.a11y-contrast-high .card-badge,html.a11y-contrast-high .pill{background:#ffe14d !important;color:#000 !important}
@media(max-width:560px){
  .a11y-widget{bottom:14px;left:14px}
}`;

const APP_JS = `(function(){
  var grid=document.getElementById('grid');
  if(!grid) return;
  var cards=[].slice.call(grid.querySelectorAll('.card'));
  var q=document.getElementById('q');
  var countEl=document.getElementById('count');
  var emptyEl=document.getElementById('empty');
  var citySelect=document.getElementById('city-select');
  var venueSelect=document.getElementById('venue-select');
  var loadMoreWrap=document.getElementById('load-more-wrap');
  var loadMoreBtn=document.getElementById('load-more');
  var state={text:'',section:'',city:'',venue:'',date:'all'};
  var PAGE=24, shownLimit=PAGE;

  function pad(n){return (n<10?'0':'')+n;}
  function ymd(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
  function addDays(base,n){var d=new Date(base);d.setDate(d.getDate()+n);return d;}

  function matchDate(datesStr,mode){
    if(!mode||mode==='all') return true;
    var dates=(datesStr||'').split(',').filter(Boolean);
    if(!dates.length) return false;
    var now=new Date(); now.setHours(0,0,0,0);
    var today=ymd(now);
    if(mode==='today') return dates.indexOf(today)>-1;
    if(mode==='next-7'||mode==='this-month'){
      var end=ymd(addDays(now, mode==='next-7'?6:29));
      return dates.some(function(d){return d>=today && d<=end;});
    }
    if(mode==='weekend'){
      var day=now.getDay();
      var toThu=(day>=4)? -(day-4) : (4-day);
      var thu=addDays(now,toThu);
      var wk=[ymd(thu),ymd(addDays(thu,1)),ymd(addDays(thu,2))];
      return dates.some(function(d){return wk.indexOf(d)>-1;});
    }
    return true;
  }

  function render(){
    var t=state.text.trim().toLowerCase();
    var matched=0, rendered=0;
    cards.forEach(function(card){
      var name=(card.getAttribute('data-name')||'').toLowerCase();
      var section=card.getAttribute('data-section')||'';
      var cities=(card.getAttribute('data-city')||'').split('|');
      var okText=!t || name.indexOf(t)>-1 || section.toLowerCase().indexOf(t)>-1 || cities.join(' ').toLowerCase().indexOf(t)>-1;
      var okSection=!state.section || section===state.section;
      var okCity=!state.city || cities.indexOf(state.city)>-1;
      var venues=(card.getAttribute('data-venue')||'').split('|');
      var okVenue=!state.venue || venues.indexOf(state.venue)>-1;
      var okDate=matchDate(card.getAttribute('data-dates'), state.date);
      if(okText&&okSection&&okCity&&okVenue&&okDate){
        matched++;
        if(rendered<shownLimit){ card.style.display=''; rendered++; }
        else { card.style.display='none'; }
      } else {
        card.style.display='none';
      }
    });
    if(countEl) countEl.textContent='Найдено: '+matched;
    if(emptyEl) emptyEl.hidden=matched>0;
    if(loadMoreWrap){
      var more=matched-rendered;
      loadMoreWrap.hidden=!(more>0);
      if(loadMoreBtn && more>0) loadMoreBtn.textContent='Показать ещё (осталось '+more+')';
    }
  }

  function apply(){ shownLimit=PAGE; render(); }
  function loadMore(){ shownLimit+=PAGE; render(); }

  function syncCityUI(v){
    var chipMatch=false;
    [].forEach.call(document.querySelectorAll('.chip[data-filter="city"]'),function(c){
      var on=c.getAttribute('data-value')===v;
      if(on && v) chipMatch=true;
      c.classList.toggle('is-active', on);
    });
    if(citySelect) citySelect.value = chipMatch ? '' : (v || '');
  }

  function syncVenueUI(v){
    var chipMatch=false;
    [].forEach.call(document.querySelectorAll('.chip[data-filter="venue"]'),function(c){
      var on=c.getAttribute('data-value')===v;
      if(on && v) chipMatch=true;
      c.classList.toggle('is-active', on);
    });
    if(venueSelect) venueSelect.value = chipMatch ? '' : (v || '');
  }

  if(q) q.addEventListener('input',function(){state.text=q.value;apply();});

  try{
    var initial=new URLSearchParams(location.search).get('q');
    if(initial && q){q.value=initial;state.text=initial;}
  }catch(e){}

  [].slice.call(document.querySelectorAll('.chip')).forEach(function(chip){
    chip.addEventListener('click',function(){
      var f=chip.getAttribute('data-filter');
      var v=chip.getAttribute('data-value');
      state[f]=v;
      if(f==='city'){
        syncCityUI(v);
      } else if(f==='venue'){
        syncVenueUI(v);
      } else {
        [].slice.call(document.querySelectorAll('.chip[data-filter="'+f+'"]')).forEach(function(c){
          c.classList.toggle('is-active', c===chip);
        });
      }
      apply();
    });
  });

  if(citySelect) citySelect.addEventListener('change',function(){
    state.city=citySelect.value;
    syncCityUI(citySelect.value);
    apply();
  });

  if(venueSelect) venueSelect.addEventListener('change',function(){
    state.venue=venueSelect.value;
    syncVenueUI(venueSelect.value);
    apply();
  });

  if(loadMoreBtn) loadMoreBtn.addEventListener('click', loadMore);

  function applyHash(){
    var h=(location.hash||'').replace(/^#/,'');
    if(!h) return;
    var m=/^(section|city)=(.*)$/.exec(decodeURIComponent(h));
    if(!m) return;
    var f=m[1], v=m[2];
    state[f]=v;
    if(f==='city'){
      syncCityUI(v);
    } else {
      [].forEach.call(document.querySelectorAll('.chip[data-filter="'+f+'"]'),function(c){
        c.classList.toggle('is-active', c.getAttribute('data-value')===v);
      });
    }
    apply();
  }
  window.addEventListener('hashchange',applyHash);
  applyHash();

  apply();
})();`;

const A11Y_JS = `(function(){
  var KEY='topafisha-a11y';
  var root=document.documentElement;
  var widget=document.getElementById('a11y-widget');
  if(!widget) return;
  var trigger=document.getElementById('a11y-trigger');
  var modal=document.getElementById('a11y-modal');
  var closeBtn=document.getElementById('a11y-close');
  var tools=[].slice.call(widget.querySelectorAll('.a11y-tool'));

  function load(){ try{ return JSON.parse(localStorage.getItem(KEY))||{}; }catch(e){ return {}; } }
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){} }
  function clampFont(v){ return Math.max(-2, Math.min(6, v||0)); }

  var state=load();

  function apply(){
    var step=clampFont(state.font);
    root.style.zoom = step ? (1 + step*0.1).toFixed(2) : '';
    root.classList.toggle('a11y-contrast-high', state.contrast==='high');
    root.classList.toggle('a11y-invert', state.contrast==='inverted');
    root.classList.toggle('a11y-underline', !!state.underline);
    root.classList.toggle('a11y-readable', !!state.readable);
    tools.forEach(function(b){
      var a=b.getAttribute('data-action'), on=false;
      if(a==='contrast-high') on=state.contrast==='high';
      else if(a==='contrast-inverted') on=state.contrast==='inverted';
      else if(a==='underline-links') on=!!state.underline;
      else if(a==='readable-font') on=!!state.readable;
      else return;
      b.setAttribute('aria-pressed', on?'true':'false');
    });
  }

  function doAction(a){
    switch(a){
      case 'font-plus': state.font=clampFont((state.font||0)+1); break;
      case 'font-minus': state.font=clampFont((state.font||0)-1); break;
      case 'contrast-high': state.contrast=(state.contrast==='high')?null:'high'; break;
      case 'contrast-inverted': state.contrast=(state.contrast==='inverted')?null:'inverted'; break;
      case 'underline-links': state.underline=!state.underline; break;
      case 'readable-font': state.readable=!state.readable; break;
      case 'reset': state={}; break;
    }
    save(); apply();
  }

  function openMenu(){ modal.hidden=false; trigger.setAttribute('aria-expanded','true'); }
  function closeMenu(){ modal.hidden=true; trigger.setAttribute('aria-expanded','false'); }

  trigger.addEventListener('click', function(){ modal.hidden?openMenu():closeMenu(); });
  closeBtn.addEventListener('click', function(){ closeMenu(); trigger.focus(); });
  tools.forEach(function(b){ b.addEventListener('click', function(){ doAction(b.getAttribute('data-action')); }); });
  document.addEventListener('keydown', function(e){ if(e.key==='Escape' && !modal.hidden){ closeMenu(); trigger.focus(); } });
  document.addEventListener('click', function(e){ if(!modal.hidden && !widget.contains(e.target)) closeMenu(); });

  apply();
})();`;

/* -------------------------------- Запуск --------------------------------- */
// Файл _redirects для Cloudflare Pages: 301 со старых английских слагов магазина на новые
function buildRedirects() {
  const lines = [];
  for (const m of [...MAGAZINE_REDIRECTS, ...LANDING_REDIRECTS]) {
    const dest = `/magazine/${encodeURI(m.to)}/`;
    lines.push(`/magazine/${m.from} ${dest} 301`);
    lines.push(`/magazine/${m.from}/ ${dest} 301`);
  }
  if (lines.length) {
    fs.writeFileSync(path.join(BRAND.outDir, '_redirects'), lines.join('\n') + '\n', 'utf8');
  }
}

function run() {
  const t0 = Date.now();
  console.log('· Загрузка shows.json…');
  const shows = loadShows();
  console.log(`· К обработке: ${shows.length} мероприятий`);
  assignShowUrls(shows);
  assignHubs(shows);

  if (fs.existsSync(BRAND.outDir)) {
    fs.rmSync(BRAND.outDir, { recursive: true, force: true });
  }
  ensureDir(BRAND.outDir);

  buildAssets();
  buildSearchIndex(shows);
  shows.forEach(buildShow);
  buildIndex(shows);
  buildStaticPages();
  const hubCounts = buildHubPages(shows);
  const cityCounts = buildCityPages(shows);
  const artistCount = buildArtistsIndex(shows);
  const artistPageCount = buildArtistPages();
  const venuePageCount = buildVenuePages();
  const landingCount = buildLandingPages(shows);
  const magazineCount = buildMagazine(shows);
  const newsCount = buildNews(shows);
  buildRedirects();
  buildSitemap(shows);
  buildAdsTxt();

  const totalSeances = shows.reduce((n, s) => n + ((s.Seances || []).length), 0);
  const secs = ((Date.now() - t0) / 1000).toFixed(2);
  const totalHtml = shows.length + 2 + STATIC_SLUGS.length + HUB_PAGES.length + CITY_PAGES.length + artistPageCount + venuePageCount;

  console.log('· Созданные файлы:');
  console.log('  - dist/index.html  (главная)');
  console.log(`  - dist/[category]/[slug]-билеты-и-расписание/index.html  (${shows.length} страниц)`);
  console.log(`  - dist/data/search-index.json  (${shows.length} записей)`);
  console.log('  - dist/privacy.html, terms.html, contact.html');
  console.log(`  - Hub-страницы (${HUB_PAGES.length}):`);
  HUB_PAGES.forEach(p => console.log(`      ${p.slug}  (${hubCounts[p.slug]})`));
  console.log(`  - Страницы городов (${CITY_PAGES.length}):`);
  CITY_PAGES.forEach(p => console.log(`      ${p.slug}/  (${cityCounts[p.slug]})`));
  console.log(`  - dist/артисты/index.html  (${artistCount} артистов)`);
  console.log(`  - dist/artist/[slug]/  (${artistPageCount} страниц артистов)`);
  console.log(`  - dist/venues/[slug]/  (${venuePageCount} страниц залов)`);
  console.log(`  - dist/sitemap.xml  (${totalHtml} URL), robots.txt, ads.txt`);
  console.log('────────────────────────────────────────');
  console.log(`  Мероприятий:   ${shows.length}`);
  console.log(`  Сеансов:       ${totalSeances}`);
  console.log(`  HTML-страниц:  ${totalHtml}`);
  console.log(`  Время сборки:  ${secs} сек`);
  console.log('✓ Сборка завершена.');
}

run();
