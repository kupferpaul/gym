// Einmalig: lädt free-exercise-db (Public Domain) und schreibt eine reduzierte Fassung nach data/.
// Aufruf: node tools/build-exercise-db.mjs
import https from 'https';
import { writeFileSync } from 'fs';

const SRC = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

const all = JSON.parse(await get(SRC));
const slim = all
  .map((e) => ({
    id: e.id,
    name: e.name,
    muscle: (e.primaryMuscles && e.primaryMuscles[0]) || null,
    equipment: e.equipment || null,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

writeFileSync(new URL('../data/exercises.json', import.meta.url), JSON.stringify(slim));
console.log(slim.length + ' Übungen geschrieben');
