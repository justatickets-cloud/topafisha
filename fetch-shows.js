'use strict';

/* ==========================================================================
   fetch-shows.js  -  загрузка русского фида Bravo и сохранение в shows.json
   Автоматически запускается в GitHub Actions (.github/workflows/sync-shows.yml)
   Ручной запуск:  node fetch-shows.js   (или: npm run sync)
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');

// Русский фид Bravo (партнёрский фид TopAfisha). Можно переопределить через
// переменную окружения BRAVO_FEED_URL (например, GitHub Secret).
const BRAVO_FEED_URL = process.env.BRAVO_FEED_URL || 'https://top.kassa.co.il/xml/partner/shows.json';
const OUTPUT_FILE = path.resolve('shows.json');

async function syncShows() {
  console.log('🔄 Загрузка данных мероприятий из Bravo…');
  console.log(`   Источник: ${BRAVO_FEED_URL}`);

  try {
    const res = await fetch(BRAVO_FEED_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`Не удалось загрузить фид. HTTP статус: ${res.status}`);
    }

    const data = await res.json();

    if (!data || (!Array.isArray(data) && !Array.isArray(data.Shows))) {
      throw new Error('Получена некорректная структура JSON от поставщика');
    }

    const count = Array.isArray(data) ? data.length : data.Shows.length;
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`✅ shows.json обновлён (${count} мероприятий)`);
  } catch (err) {
    console.error('❌ Ошибка обновления:', err.message);
    process.exit(1);
  }
}

syncShows();
