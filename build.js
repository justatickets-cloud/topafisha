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

// Назначает каждому мероприятию путь (_dir) и URL (_url)
function assignShowUrls(shows) {
  const used = new Set();
  const SUFFIX = 'билеты-и-расписание';
  for (const s of shows) {
    const cat = categorySlug(s.section);
    const nameSlug = slugify(s.name) || String(s.id);
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
  </div>

  <div class="footer-bottom wrap">
    <div class="foot-copy">© ${year} ${escText(BRAND.nameHe)} (topafisha.co.il). Все права защищены.</div>
    <div class="footer-legal-links">
      <a href="/privacy.html">Политика конфиденциальности</a> ·
      <a href="/terms.html">Условия использования</a> ·
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
  const nextDate = dates[0] || show.dateFrom;
  return `<article class="card"
    data-name="${esc(show.name)}"
    data-section="${esc(show.section)}"
    data-city="${esc(cities.join('|'))}"
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
        <span class="card-price">${priceLabel(show.priceMin, show.priceMax)}</span>
        <a class="btn btn-primary" href="${esc(show._url)}">Подробнее и билеты</a>
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
    `<li><a href="${esc(s._url)}">${escText(s.name)} — билеты</a></li>`).join('');

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
    <td data-th="Зал">${escText(s.hall)}</td>
    <td data-th="Цена">${priceLabel(s.priceMin, s.priceMax)}</td>
    <td data-th="Заказ"><a class="btn btn-primary btn-sm" href="${esc(affiliateUrl(s.link))}" target="_blank" rel="noopener sponsored">Заказать билеты</a></td>
  </tr>`;
}

function eventSchema(show) {
  const events = (show.Seances || []).map(s => ({
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: show.name,
    url: `${BRAND.domain}${show._url}`,
    description: stripTags(show.description).slice(0, 300),
    image: show.image,
    startDate: `${s.date}T${(s.time || '20:00:00')}`,
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
      availability: 'https://schema.org/InStock',
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
        <div class="show-facts">
          <div class="fact"><span class="fact-k">Даты</span><span class="fact-v">${formatDate(show.dateFrom)}</span></div>
          <div class="fact"><span class="fact-k">Место</span><span class="fact-v">${escText(cities.join(' · ') || 'уточняется')}</span></div>
          <div class="fact"><span class="fact-k">Цена</span><span class="fact-v">${priceLabel(show.priceMin, show.priceMax)}</span></div>
        </div>
        <a class="btn btn-primary btn-lg" href="#seances">Заказать билеты</a>
      </div>
    </div>
  </div>

  <div class="wrap show-grid">
    <section class="show-desc">
      <h2>О мероприятии</h2>
      <div class="rte">${safeHtml(show.description)}</div>
    </section>

    <aside class="show-aside">
      <div class="aside-card">
        <span class="aside-price-k">Цена билета</span>
        <span class="aside-price-v">${priceLabel(show.priceMin, show.priceMax)}</span>
        <a class="btn btn-primary btn-block" href="#seances">Выбрать дату</a>
        <p class="aside-note">Покупка билетов</p>
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
  </section>
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
    ...shows.map(s => ({ loc: `${BRAND.domain}${encodeURI(s._url)}`, pri: '0.8' })),
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
.show-announce{color:var(--muted);font-size:18px;margin:0 0 20px}
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
  var loadMoreWrap=document.getElementById('load-more-wrap');
  var loadMoreBtn=document.getElementById('load-more');
  var state={text:'',section:'',city:'',date:'all'};
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
      var okDate=matchDate(card.getAttribute('data-dates'), state.date);
      if(okText&&okSection&&okCity&&okDate){
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
function run() {
  const t0 = Date.now();
  console.log('· Загрузка shows.json…');
  const shows = loadShows();
  console.log(`· К обработке: ${shows.length} мероприятий`);
  assignShowUrls(shows);

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
  buildSitemap(shows);
  buildAdsTxt();

  const totalSeances = shows.reduce((n, s) => n + ((s.Seances || []).length), 0);
  const secs = ((Date.now() - t0) / 1000).toFixed(2);
  const totalHtml = shows.length + 2 + STATIC_SLUGS.length + HUB_PAGES.length + CITY_PAGES.length;

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
  console.log(`  - dist/sitemap.xml  (${totalHtml} URL), robots.txt, ads.txt`);
  console.log('────────────────────────────────────────');
  console.log(`  Мероприятий:   ${shows.length}`);
  console.log(`  Сеансов:       ${totalSeances}`);
  console.log(`  HTML-страниц:  ${totalHtml}`);
  console.log(`  Время сборки:  ${secs} сек`);
  console.log('✓ Сборка завершена.');
}

run();
