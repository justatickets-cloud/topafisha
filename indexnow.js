'use strict';
/* IndexNow: מודיע ל-Bing ול-Yandex על עמודים חדשים, כדי שיסרקו אותם תוך שעות במקום שבועות
   (החיפוש של ChatGPT נשען על האינדקס של Bing). גוגל לא משתתף ב-IndexNow.
   רץ מ-GitHub Actions אחרי שהאתר נפרס: קורא את ה-sitemap החי, ושולח רק כתובות שלא נשלחו קודם,
   ובנוסף את עמודי הלוח הראשיים (priority >= 0.9) שמשתנים כל יום.
   שימוש: node indexnow.js https://idir.co.il [state-file] */
const fs = require('fs');
const path = require('path');

const site = (process.argv[2] || '').replace(/\/$/, '');
const stateFile = process.argv[3] || path.join(__dirname, '.indexnow-state.json');
const key = fs.readFileSync(path.join(__dirname, 'indexnow-key.txt'), 'utf8').trim();

async function main() {
  if (!/^https:\/\//.test(site)) throw new Error('usage: node indexnow.js https://site');
  const host = new URL(site).host;
  const keyLocation = `${site}/${key}.txt`;
  // המפתח חייב להיות באוויר, אחרת Bing דוחה את הבקשה
  const k = await fetch(keyLocation);
  if (!k.ok || (await k.text()).trim() !== key) { console.log(`key file not live yet (${k.status}), skipping`); return; }

  const xml = await (await fetch(`${site}/sitemap.xml`)).text();
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => ({
    loc: (m[1].match(/<loc>([^<]+)<\/loc>/) || [])[1],
    priority: +((m[1].match(/<priority>([^<]+)<\/priority>/) || [])[1] || 0),
  })).filter(e => e.loc);
  let sent = {};
  try { sent = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) {}
  const urls = entries.filter(e => !sent[e.loc] || e.priority >= 0.9).map(e => e.loc);
  console.log(`sitemap ${entries.length}, previously sent ${Object.keys(sent).length}, sending ${urls.length}`);

  for (let i = 0; i < urls.length; i += 10000) {
    const urlList = urls.slice(i, i + 10000);
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, keyLocation, urlList }),
    });
    console.log(`IndexNow ${res.status} ${res.statusText} (${urlList.length} urls)`);
    if (res.status >= 300) throw new Error(await res.text());
  }
  const now = new Date().toISOString().slice(0, 10);
  for (const e of entries) sent[e.loc] = sent[e.loc] || now;
  fs.writeFileSync(stateFile, JSON.stringify(sent), 'utf8');
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
