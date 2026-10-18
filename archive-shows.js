'use strict';
/* ארכיון מופעים עם תוכן ייחודי: שומר צילום אחרון של כל מופע מועשר, כדי שכשהוא יוצא מהפיד
   העמוד שלו יישאר באתר (עמוד "הסתיים" + מופעים דומים) ולא יקבל 404.
   רץ אחרי כל סנכרון פיד (GitHub Action) ובבנייה מקומית.
   שימוש: node archive-shows.js [--seed]   (--seed: משחזר מהיסטוריית git מופעים מועשרים שכבר יצאו מהפיד) */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIR = __dirname;
const ENR = JSON.parse(fs.readFileSync(path.join(DIR, 'content', 'enrichments', fs.readdirSync(path.join(DIR, 'content', 'enrichments')).find(f => f.endsWith('.json'))), 'utf8'));
const AFILE = path.join(DIR, 'content', 'archive', 'shows-archive.json');
const listOf = raw => Array.isArray(raw) ? raw : (raw.Shows || raw.shows || raw.data || []);
const today = new Date().toISOString().slice(0, 10);

const archive = fs.existsSync(AFILE) ? JSON.parse(fs.readFileSync(AFILE, 'utf8')) : {};
const live = listOf(JSON.parse(fs.readFileSync(path.join(DIR, 'shows.json'), 'utf8')));
let added = 0, updated = 0;
for (const s of live) {
  const id = String(s.id);
  if (!ENR[id] || !ENR[id].paragraph) continue;
  if (!archive[id]) added++; else updated++;
  archive[id] = { lastSeen: today, show: s };
}

if (process.argv.includes('--seed')) {
  const missing = Object.keys(ENR).filter(id => ENR[id].paragraph && !archive[id]);
  if (missing.length) {
    const commits = execSync('git log --format=%H -n 120 -- shows.json', { cwd: DIR }).toString().trim().split('\n');
    for (const c of commits) {
      if (!missing.some(id => !archive[id])) break;
      let old; try { old = listOf(JSON.parse(execSync(`git show ${c}:shows.json`, { cwd: DIR, maxBuffer: 1 << 28 }).toString())); } catch (e) { continue; }
      const date = execSync(`git show -s --format=%cs ${c}`, { cwd: DIR }).toString().trim();
      for (const s of old) { const id = String(s.id); if (missing.includes(id) && !archive[id]) { archive[id] = { lastSeen: date, show: s }; added++; } }
    }
  }
}

// כל מופע שהופיע באתר (גם בלי תוכן ייחודי): כשהוא יוצא מהפיד, הכתובת שלו מקבלת הפניית 301 לקטגוריה במקום 404
const PFILE = path.join(DIR, 'content', 'archive', 'past-shows.json');
const past = fs.existsSync(PFILE) ? JSON.parse(fs.readFileSync(PFILE, 'utf8')) : {};
for (const s of live) past[String(s.id)] = { name: s.name, section: s.section, lastSeen: today };
if (process.argv.includes('--seed-past')) {
  const commits = execSync('git log --format=%H -- shows.json', { cwd: DIR }).toString().trim().split('\n');
  for (const c of commits) {
    let old; try { old = listOf(JSON.parse(execSync(`git show ${c}:shows.json`, { cwd: DIR, maxBuffer: 1 << 28 }).toString())); } catch (e) { continue; }
    const date = execSync(`git show -s --format=%cs ${c}`, { cwd: DIR }).toString().trim();
    for (const s of old) { const id = String(s.id); if (!past[id] || past[id].lastSeen < date) past[id] = { name: s.name, section: s.section, lastSeen: date }; }
  }
}
fs.mkdirSync(path.dirname(PFILE), { recursive: true });
fs.writeFileSync(PFILE, JSON.stringify(past), 'utf8');
fs.mkdirSync(path.dirname(AFILE), { recursive: true });
fs.writeFileSync(AFILE, JSON.stringify(archive), 'utf8');
const liveIds = new Set(live.map(s => String(s.id)));
console.log(`ארכיון: ${Object.keys(archive).length} מופעים מועשרים (${added} חדשים, ${updated} עודכנו) · מתוכם הסתיימו: ${Object.keys(archive).filter(id => !liveIds.has(id)).length}`);
