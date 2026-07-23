// Тест ассетов: полнота манифеста, наличие и размеры файлов на диске, свежесть
// самого манифеста. Пиксели не сравниваем — только метаданные (быстро).
//
// Три страховки:
//   1. каждый id из ITEMS/HAZARDS либо имеет ассет, либо явно внесён в MISSING
//      (новый предмет без решения уронит тест — это нарочно);
//   2. все файлы из манифеста существуют и имеют ожидаемые размеры;
//   3. manifest.js совпадает с тем, что сгенерировал бы скрипт (не устарел).
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { ITEMS, HAZARDS } from '../src/game/data.js';
import { SIZES, ITEM_FILES, HAZARD_FILES, MISSING, manifestSource } from '../scripts/prepare-assets.mjs';

let failed = 0;
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); failed += 1; } };

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'src', 'client', 'assets');

const itemIdsWithFile = new Set(Object.values(ITEM_FILES));
const hazIdsWithFile = new Set(Object.values(HAZARD_FILES));

// 1. Полнота: каждый id покрыт ассетом или явно исключён.
for (const id of Object.keys(ITEMS)) {
  assert(itemIdsWithFile.has(id) || MISSING.items.includes(id),
    `предмет «${id}» без ассета и не в списке исключений MISSING.items`);
}
for (const id of HAZARDS) {
  assert(hazIdsWithFile.has(id) || MISSING.hazards.includes(id),
    `опасность «${id}» без ассета и не в списке исключений MISSING.hazards`);
}
// MISSING не должен прятать id, у которого на самом деле есть исходник —
// иначе исключение молча замолчало бы реальную поломку.
for (const id of MISSING.items) {
  assert(!itemIdsWithFile.has(id), `MISSING.items зря прячет «${id}»: у него есть исходник`);
}
for (const id of MISSING.hazards) {
  assert(!hazIdsWithFile.has(id), `MISSING.hazards зря прячет «${id}»: у него есть исходник`);
}
// Каждая строка карты имён указывает на реальный id из data.js.
for (const id of itemIdsWithFile) assert(ITEMS[id], `карта имён предметов ссылается на неизвестный id «${id}»`);
for (const id of hazIdsWithFile) assert(HAZARDS.includes(id), `карта имён фишек ссылается на неизвестный id «${id}»`);

// 2. Файлы существуют и имеют ожидаемые размеры (метаданные, без пикселей).
async function checkDims(path, w, h, label) {
  if (!existsSync(path)) { assert(false, `нет файла ассета: ${label} (${path})`); return; }
  const m = await sharp(path).metadata();
  assert(m.format === 'webp', `${label}: формат ${m.format}, ожидался webp`);
  assert(m.width === w && m.height === h, `${label}: размер ${m.width}×${m.height}, ожидался ${w}×${h}`);
}

for (const id of itemIdsWithFile) {
  await checkDims(join(OUT, 'items', `${id}.webp`), SIZES.card, SIZES.card, `предмет ${id} (card)`);
  await checkDims(join(OUT, 'items', `${id}.thumb.webp`), SIZES.thumb, SIZES.thumb, `предмет ${id} (thumb)`);
}
for (const id of hazIdsWithFile) {
  await checkDims(join(OUT, 'hazards', `${id}.webp`), SIZES.chip, SIZES.chip, `фишка ${id} (chip)`);
  await checkDims(join(OUT, 'hazards', `${id}.small.webp`), SIZES.chipSmall, SIZES.chipSmall, `фишка ${id} (chipSmall)`);
}

// 3. Свежесть манифеста: committed manifest.js === то, что даёт скрипт сейчас.
// Переводы строк нормализуем: git на Windows может подменить LF на CRLF.
const norm = (s) => s.replace(/\r\n/g, '\n');
const onDisk = existsSync(join(OUT, 'manifest.js')) ? await readFile(join(OUT, 'manifest.js'), 'utf8') : '';
assert(norm(onDisk) === norm(manifestSource()),
  'manifest.js устарел или отсутствует — перегенерируйте: npm run assets');

if (failed) { console.error(`\nASSETS: провалено проверок — ${failed}`); process.exit(1); }
console.log('ASSETS OK ✓');
