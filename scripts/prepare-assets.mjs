// ============================================================
// Конвейер нормализации графических ассетов А.Д.Е.Л.Ь.
//
// Исходники (кириллические имена, разные размеры и пропорции) лежат в
//   ассеты/предметы/*.jpg — жетоны предметов экипажа (квадратные тайлы);
//   ассеты/адель/*.png    — фишки опасностей (круглые жетоны).
// Скрипт приводит их к единому виду и кладёт webp в src/client/assets/:
//   • предмет  → КВАДРАТ, два размера (card / thumb), все одного размера;
//   • фишка    → КРУГ с прозрачными углами (маска), два размера (chip / small).
// Плюс автогенерируемый манифест src/client/assets/manifest.js: id → пути.
//
// Идемпотентно: каждый запуск перезаписывает вывод. Запуск — `npm run assets`.
// В прод-сборку (`vite build`) НЕ входит: сгенерированные webp коммитятся,
// а тест test/assets.js стережёт их наличие, размеры и свежесть манифеста.
// Исходники из ассеты/ в бандл не попадают — их читает только этот скрипт.
// ============================================================
import sharp from 'sharp';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ITEMS, HAZARDS } from '../src/game/data.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC_ITEMS = join(ROOT, 'ассеты', 'предметы');
const SRC_HAZ = join(ROOT, 'ассеты', 'адель');
const OUT = join(ROOT, 'src', 'client', 'assets');
const OUT_ITEMS = join(OUT, 'items');
const OUT_HAZ = join(OUT, 'hazards');

// Размеры вывода в пикселях — единый источник правды для скрипта, манифеста и
// теста. Фишки рендерятся в 2× их экранного размера (~48px карта / ~28px
// консоль): карта масштабируется по ширине окна, и запас разрешения бережёт
// чёткость. Предметы — квадрат, все одного размера (решение владельца).
export const SIZES = { card: 360, thumb: 96, chip: 96, chipSmall: 56 };

// Имя файла → id. Держим явной картой, а не угадыванием: имена кириллические и
// с опечатками («сечатка», «огетушитель»). Новый id из ITEMS/HAZARDS, которого
// нет ни здесь, ни в MISSING, уронит generate() и тест — это нарочно.
export const ITEM_FILES = {
  'синяя карта.jpg': 'blue_card',
  'удостоверение.jpg': 'id_badge',
  'топор.jpg': 'axe',
  'чип.jpg': 'chipItem',
  'ящик с инструментами.jpg': 'toolbox',
  'шлем.jpg': 'helmet',
  'линза-сечатка.jpg': 'lens',
  'стимуляторы.jpg': 'stims',
  'дрон.jpg': 'drone',
  'аптечка.jpg': 'medkit',
  'огетушитель.jpg': 'extinguisher',
  'батарея.jpg': 'battery',
  'мишка.jpg': 'teddy',
  'деталь.jpg': 'parts',
  'скафандр.jpg': 'suit',
  'фонарь.jpg': 'flashlight',
};
export const HAZARD_FILES = {
  'огонь.png': 'fire',
  'гипоксия.png': 'hypoxia',
  'тьма.png': 'darkness',
  'компьютер.png': 'lockdown',
  'шпионаж.png': 'spy',
  'дверь.png': 'door',
};

// id из ITEMS/HAZARDS без ассета — интерфейс оставляет им текстовый/эмодзи
// фолбэк. Сейчас пусто: покрыты все 16 предметов и 6 опасностей.
export const MISSING = { items: [], hazards: [] };

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

// Предмет: обрезать поля, вписать в квадрат (contain, прозрачная подложка),
// два размера. Все выходы строго size×size, поэтому карточки одного размера.
async function makeItem(srcPath, id) {
  const trimmed = await sharp(srcPath).trim({ threshold: 12 }).toBuffer();
  for (const [size, name] of [[SIZES.card, `${id}.webp`], [SIZES.thumb, `${id}.thumb.webp`]]) {
    await sharp(trimmed)
      .resize(size, size, { fit: 'contain', background: TRANSPARENT })
      .webp({ quality: 82 })
      .toFile(join(OUT_ITEMS, name));
  }
}

// Круглая маска: белый диск на прозрачном фоне. blend:'dest-in' оставляет
// картинку только внутри круга — углы становятся прозрачными одинаково для всех
// фишек, независимо от фона исходника (у «огня» он белый, у «тьмы» прозрачный).
// Радиус чуть меньше вписанной окружности — съедает тонкий ореол фона у дисков,
// снятых на белом, ценой незаметного среза кромки на маленькой фишке.
function circleMask(size) {
  const r = (size / 2) * 0.98;
  return Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="#fff"/></svg>`);
}

// Фишка: обрезать поля до диска, вписать в квадрат, замаскировать в круг.
async function makeChip(srcPath, id) {
  const trimmed = await sharp(srcPath).trim({ threshold: 20 }).png().toBuffer();
  for (const [size, name] of [[SIZES.chip, `${id}.webp`], [SIZES.chipSmall, `${id}.small.webp`]]) {
    await sharp(trimmed)
      .resize(size, size, { fit: 'contain', background: TRANSPARENT })
      .composite([{ input: circleMask(size), blend: 'dest-in' }])
      .webp({ quality: 88 })
      .toFile(join(OUT_HAZ, name));
  }
}

// Идентификаторы всех id — валидные JS-имена, поэтому в манифесте они идут
// ключами без кавычек, а импорты именуются по схеме i_<id>_<size> / h_<id>_<size>.
const iv = (id, s) => `i_${id}_${s}`;
const hv = (id, s) => `h_${id}_${s}`;

// Строка манифеста — детерминированная: тем же текстом её пишет generate() и
// сверяет тест на свежесть. Порядок — как в data.js (ITEMS / HAZARDS).
export function manifestSource() {
  const itemIds = Object.keys(ITEMS).filter(id => !MISSING.items.includes(id));
  const hazIds = HAZARDS.filter(id => !MISSING.hazards.includes(id));
  const L = [];
  L.push('// АВТОГЕНЕРАЦИЯ — не править руками. Источник: scripts/prepare-assets.mjs.');
  L.push('// Перегенерировать: npm run assets. Свежесть стережёт тест test/assets.js.');
  L.push('//');
  L.push('// id → пути к webp. Предмет: { card, thumb }. Фишка: { chip, chipSmall }.');
  L.push('// id из ITEMS/HAZARDS без ассета — в MISSING: им остаётся текстовый фолбэк.');
  L.push('');
  for (const id of itemIds) {
    L.push(`import ${iv(id, 'card')} from './items/${id}.webp';`);
    L.push(`import ${iv(id, 'thumb')} from './items/${id}.thumb.webp';`);
  }
  for (const id of hazIds) {
    L.push(`import ${hv(id, 'chip')} from './hazards/${id}.webp';`);
    L.push(`import ${hv(id, 'small')} from './hazards/${id}.small.webp';`);
  }
  L.push('');
  L.push('export const ITEM_ART = {');
  for (const id of itemIds) L.push(`  ${id}: { card: ${iv(id, 'card')}, thumb: ${iv(id, 'thumb')} },`);
  L.push('};');
  L.push('');
  L.push('export const CHIP_ART = {');
  for (const id of hazIds) L.push(`  ${id}: { chip: ${hv(id, 'chip')}, chipSmall: ${hv(id, 'small')} },`);
  L.push('};');
  L.push('');
  L.push(`export const ASSET_SIZES = ${JSON.stringify(SIZES)};`);
  L.push(`export const MISSING = ${JSON.stringify(MISSING)};`);
  L.push('');
  return L.join('\n');
}

// Каждый id из ITEMS/HAZARDS обязан иметь либо исходник, либо строку в MISSING.
// Иначе — падение: новый предмет молча без картинки не проскочит.
function assertCoverage() {
  const itemIds = new Set(Object.values(ITEM_FILES));
  for (const id of Object.keys(ITEMS)) {
    if (!itemIds.has(id) && !MISSING.items.includes(id)) {
      throw new Error(`предмет «${id}» без ассета и не в MISSING — добавьте файл или внесите в исключения`);
    }
  }
  const hazIds = new Set(Object.values(HAZARD_FILES));
  for (const id of HAZARDS) {
    if (!hazIds.has(id) && !MISSING.hazards.includes(id)) {
      throw new Error(`опасность «${id}» без ассета и не в MISSING — добавьте файл или внесите в исключения`);
    }
  }
}

export async function generate() {
  assertCoverage();
  await mkdir(OUT_ITEMS, { recursive: true });
  await mkdir(OUT_HAZ, { recursive: true });
  for (const [file, id] of Object.entries(ITEM_FILES)) {
    const p = join(SRC_ITEMS, file);
    if (!existsSync(p)) throw new Error(`нет исходника предмета: ${p}`);
    await makeItem(p, id);
  }
  for (const [file, id] of Object.entries(HAZARD_FILES)) {
    const p = join(SRC_HAZ, file);
    if (!existsSync(p)) throw new Error(`нет исходника опасности: ${p}`);
    await makeChip(p, id);
  }
  await writeFile(join(OUT, 'manifest.js'), manifestSource(), 'utf8');
  console.log(`assets: ${Object.keys(ITEM_FILES).length} предметов + ${Object.keys(HAZARD_FILES).length} фишек → src/client/assets/`);
}

// Запуск напрямую (node scripts/prepare-assets.mjs) — генерируем. Импорт из
// теста — только функции, без побочных эффектов.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  generate().catch(e => { console.error(e); process.exit(1); });
}
