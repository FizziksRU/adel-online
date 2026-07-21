// Проверка схемы карты. Ошибка в раскладке не ломает движок, но врёт игроку:
// линия перехода, прошедшая сквозь чужую локацию, читается как связь, которой
// на самом деле нет. Именно так «4↔9» выглядело как цепочка 4-8-9.
import {
  ADJ, SECTOR_OF, HATCHES, SPACE_SECTIONS, SPACE_ADJ, SPACE_NEAR,
} from '../src/game/data.js';
import { POS, BOX_W, BOX_H, xy, center } from '../src/client/layout.js';

let failed = 0;
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); failed += 1; } };

// Пересекает ли отрезок p→q прямоугольник? Метод слэбов.
function segmentHitsBox(p, q, [bx, by, bw, bh]) {
  const d = [q[0] - p[0], q[1] - p[1]];
  const lo = [bx, by], hi = [bx + bw, by + bh];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 2; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (p[i] < lo[i] || p[i] > hi[i]) return false;
      continue;
    }
    let a = (lo[i] - p[i]) / d[i];
    let b = (hi[i] - p[i]) / d[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

const boxOf = (l) => { const [x, y] = xy(l); return [x, y, BOX_W, BOX_H]; };
const LOCS = Array.from({ length: 20 }, (_, i) => i + 1);

// у каждой локации есть место на схеме
for (const l of LOCS) assert(POS[l], `локация ${l} отсутствует в раскладке карты`);

// коробки не налезают друг на друга
for (const a of LOCS) {
  for (const b of LOCS) {
    if (a >= b) continue;
    const [ax, ay] = xy(a), [bx, by] = xy(b);
    const overlap = Math.abs(ax - bx) < BOX_W && Math.abs(ay - by) < BOX_H;
    assert(!overlap, `локации ${a} и ${b} перекрываются на схеме`);
  }
}

// линия перехода не должна задевать посторонние локации
for (const [a, nbs] of Object.entries(ADJ)) {
  for (const b of nbs) {
    if (+a >= b) continue;
    const p = center(+a), q = center(b);
    for (const c of LOCS) {
      if (c === +a || c === b) continue;
      assert(!segmentHitsBox(p, q, boxOf(c)),
        `переход ${a}↔${b} проходит сквозь локацию ${c} — на схеме выглядит как связь с ${c}`);
    }
  }
}

// Карта развёрнута на 90° против часовой, поэтому пары секторов легли по
// горизонтали: зелёный с красным сверху, жёлтый с синим снизу.
const midY = (Math.min(...LOCS.map(l => POS[l][1])) + Math.max(...LOCS.map(l => POS[l][1]))) / 2;
const half = (color) => LOCS.filter(l => SECTOR_OF[l] === color).map(l => POS[l][1] < midY ? 'T' : 'B');
for (const color of ['green', 'red']) {
  assert(half(color).every(s => s === 'T'), `сектор ${color} должен быть в верхней половине схемы`);
}
for (const color of ['yellow', 'blue']) {
  assert(half(color).every(s => s === 'B'), `сектор ${color} должен быть в нижней половине схемы`);
}

// --- Открытый космос: секции, люки и примыкания ---
const SECT = new Set(SPACE_SECTIONS);
assert(SPACE_SECTIONS.length === 4, 'секций открытого космоса должно быть четыре');

for (const [l, sects] of Object.entries(HATCHES)) {
  assert(LOCS.includes(+l), `люк указан в несуществующей локации ${l}`);
  assert(sects.length > 0, `люк в локации ${l} никуда не ведёт`);
  for (const s of sects) assert(SECT.has(s), `люк в локации ${l} ведёт в неизвестную секцию ${s}`);
}
assert(Object.keys(HATCHES).length === 6, 'люков должно быть шесть — по числу жетонов закрытых люков');

// в каждую секцию должен вести хотя бы один люк, иначе туда не попасть
for (const s of SPACE_SECTIONS) {
  const ways = Object.entries(HATCHES).filter(([, ss]) => ss.includes(s));
  assert(ways.length > 0, `в секцию ${s} не ведёт ни один люк`);
}

// соседство секций симметрично и образует кольцо
for (const [s, nbs] of Object.entries(SPACE_ADJ)) {
  assert(SECT.has(s), `SPACE_ADJ описывает неизвестную секцию ${s}`);
  for (const n of nbs) {
    assert(SECT.has(n), `секция ${s} соседствует с неизвестной ${n}`);
    assert(SPACE_ADJ[n]?.includes(s), `соседство ${s}↔${n} не симметрично`);
  }
  assert(nbs.length === 2, `в кольце у секции ${s} должно быть ровно два соседа`);
}

// примыкающие локации существуют, и у каждой секции они есть
for (const s of SPACE_SECTIONS) {
  const near = SPACE_NEAR[s] || [];
  assert(near.length > 0, `у секции ${s} не указаны примыкающие локации`);
  for (const l of near) assert(LOCS.includes(l), `секция ${s} примыкает к несуществующей локации ${l}`);
}

// локация с люком обязана примыкать к секции, куда этот люк ведёт
for (const [l, sects] of Object.entries(HATCHES)) {
  for (const s of sects) {
    assert(SPACE_NEAR[s].includes(+l),
      `люк ${l} ведёт в секцию ${s}, но локация ${l} не указана среди примыкающих к ней`);
  }
}

if (failed) { console.error(`\nLAYOUT: провалено проверок — ${failed}`); process.exit(1); }
console.log('LAYOUT OK ✓');
