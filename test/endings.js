// Проверки концовок партии: обе победы экипажа (синяя и красная миссии)
// и обе победы АДЕЛЬ (смерть члена экипажа и конец времени).
// Движок вызывается напрямую, без boardgame.io: так можно выставить нужное
// состояние (маркеры миссий, инвентарь, жетон хода) и проверить ровно одно
// правило. Случайность полностью скриптована.
import { Adel } from '../src/game/index.js';
import { HAZARDS } from '../src/game/data.js';

let failed = 0;
const assert = (cond, msg) => {
  if (cond) return;
  console.error('FAIL:', msg);
  failed += 1;
};

// Детерминированный источник случайностей в стиле boardgame.io.
// D6=1 — проверки духа всегда успешны (1 по правилам всегда успех),
// Shuffle — тождественный, чтобы раскладка была предсказуемой.
function makeRandom(seed = 1) {
  let s = seed;
  const next = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  return { Number: next, D6: () => 1, Die: (n) => 1 + Math.floor(next() * n), Shuffle: (a) => [...a] };
}

// Чистое поле: стартовое событие может оказаться «Столкновением» и положить
// жетон повреждения куда угодно. Концовки не должны от этого зависеть — пусть
// на поле лежит только то, что тест выставил сам.
function clearBoard(G) {
  for (let l = 1; l <= 20; l++) {
    const L = G.board[l];
    L.damage = false; L.computerLocked = false; L.terminalLocked = false;
    L.doors = []; L.hatchClosed = false; L.batteryGuard = false;
    for (const h of HAZARDS) L.hazards[h] = false;
  }
}

const setupG = () => {
  const G = Adel.setup({ ctx: { numPlayers: 4 }, random: makeRandom() });
  clearBoard(G);
  return G;
};
const mv = (name) => Adel.moves[name].move;
const pidOf = (G, charId) => Object.keys(G.players).find(p => G.players[p].character === charId);
const NO_CUBES = { move: 0, search: 0, activate: 0, special: 0, door: 0 };

// Поставить игрока в фазу действий с заданным набором кубиков.
function readyForAction(G, pid, plan = { ...NO_CUBES, special: 4 }) {
  G.phase = 'actions';
  G.activeCrew = pid;
  const P = G.players[pid];
  P.plan = { ...plan, spent: { ...NO_CUBES } };
  P.acted = false;
  P.bonusCubes = 0;
  P.inSpace = null;
  return P;
}

// Прокрутить фазу конца хода через обычный ход движка.
function endTurn(G, random = makeRandom()) {
  G.phase = 'actions';
  const pids = Object.keys(G.players);
  for (const pid of pids) {
    Object.assign(G.players[pid], { acted: true, pendingLabPick: false, pendingMedkit: 0 });
  }
  const last = pids[0];
  G.players[last].acted = false;
  G.activeCrew = last;
  mv('finishTurn')({ G, playerID: last, random });
}

// Спец. действие «доставка/активация» ключевого предмета.
const deliver = (G, pid, itemId, random = makeRandom()) =>
  mv('actSpecial')({ G, playerID: pid, random }, { kind: 'deliver', itemId });

// --- ПОБЕДА ЭКИПАЖА: СИНЯЯ МИССИЯ ---
// Синяя карта, удостоверение и линза доставлены по своим маркерам, на поле нет
// ни одного жетона повреждения, топор активирован в центральном компьютере (20).
{
  const G = setupG();
  const pid = pidOf(G, 'artem');            // не Мэй: полная цена спец. действия — 3 кубика
  const P = readyForAction(G, pid, { ...NO_CUBES, special: 4 });
  G.eventOngoing = null;                    // «вредоносная программа» добавила бы налог в кубик
  G.winner = null;
  // Раскладка маркеров в setup случайна — задаём её явно.
  G.missions.markers.blue_card = { loc: 2, revealed: false };
  G.missions.markers.id_badge = { loc: 3, revealed: false };
  G.missions.markers.lens = { loc: 4, revealed: false };
  G.missions.delivered = {};
  P.inventory = [
    { id: 'blue_card', faceUp: false },
    { id: 'id_badge', faceUp: false },
    { id: 'lens', faceUp: false },
    { id: 'axe', faceUp: false },
  ];
  // Одна доставка стоит 3 кубика из 4 — перед каждой обновляем план.
  const refill = () => { P.plan.spent.special = 0; };

  // (а) доставка не в локацию своего маркера
  P.pos = 9;
  const wrong = deliver(G, pid, 'blue_card');
  assert(wrong !== 'INVALID_MOVE', 'доставка в неверной локации — не INVALID_MOVE, а отказ в журнале');
  assert(G.missions.markers.blue_card.revealed === false, 'маркер в неверной локации не вскрывается');
  assert(!G.missions.delivered.blue_card, 'доставка в неверной локации не засчитана');
  assert(P.inventory.some(it => it.id === 'blue_card'), 'предмет остаётся в инвентаре');
  assert(P.plan.spent.special === 3, 'кубики за неудачную попытку всё равно потрачены');

  // (б) топор до выполнения условий миссии
  refill(); P.pos = 20;
  deliver(G, pid, 'axe');
  assert(G.winner === null, 'топор без трёх доставок победы не даёт');
  assert(G.privateLog[pid].at(-1).includes('условия синей миссии'),
    'причина отказа ушла в личный журнал игрока');

  // топор не в локации 20 — тоже мягкий отказ
  refill(); P.pos = 17;
  deliver(G, pid, 'axe');
  assert(G.winner === null, 'топор вне локации 20 победы не даёт');
  assert(G.privateLog[pid].at(-1).includes('не та локация'),
    'о неверной локации активации знает только сам игрок');

  // три доставки по своим маркерам
  for (const [itemId, l] of [['blue_card', 2], ['id_badge', 3], ['lens', 4]]) {
    refill(); P.pos = l;
    deliver(G, pid, itemId);
    assert(G.missions.delivered[itemId] === true, `«${itemId}» доставлен в локацию ${l}`);
    assert(G.missions.markers[itemId].revealed === true, `маркер «${itemId}» вскрыт доставкой`);
  }
  assert(P.inventory.length === 1 && P.inventory[0].id === 'axe',
    'доставленные предметы уходят из инвентаря, остаётся топор');

  // (в) жетон повреждения где угодно на поле блокирует финал
  refill(); P.pos = 20;
  G.board[5].damage = true;
  deliver(G, pid, 'axe');
  assert(G.winner === null, 'повреждение в любой локации блокирует синюю миссию');
  assert(G.privateLog[pid].at(-1).includes('условия синей миссии'),
    'отказ из-за повреждения тоже объясняется игроку лично');

  // повреждение убрано — победа
  refill();
  G.board[5].damage = false;
  deliver(G, pid, 'axe');
  assert(G.winner === 'crew', 'экипаж выигрывает синюю миссию');
}

// --- ПОБЕДА ЭКИПАЖА: КРАСНАЯ МИССИЯ ---
// Чип, ящик и линза доставлены, шлем активирован в локации 16 (побег).
// Условие времени: жетон хода не ниже точки невозврата (turnNo >= pointOfNoReturn).
{
  // Готовое к активации шлема состояние с заданными жетоном хода и точкой невозврата.
  const redReady = (turnNo, pointOfNoReturn) => {
    const G = setupG();
    const pid = pidOf(G, 'artem');
    const P = readyForAction(G, pid, { ...NO_CUBES, special: 4 });
    G.eventOngoing = null;
    G.winner = null;
    P.pos = 16;                                   // RED_FINAL_LOC
    P.inventory = [{ id: 'helmet', faceUp: false }];
    G.missions.delivered = { chipItem: true, toolbox: true, lens: true };
    G.turnNo = turnNo;
    G.pointOfNoReturn = pointOfNoReturn;
    return { G, pid, P };
  };

  // жетон хода ниже точки невозврата — победы нет
  {
    const { G, pid, P } = redReady(5, 6);
    const r = deliver(G, pid, 'helmet');
    assert(r !== 'INVALID_MOVE', 'невыполненные условия красной миссии — не INVALID_MOVE');
    assert(G.winner === null, 'жетон хода ниже точки невозврата — побега нет');
    assert(G.privateLog[pid].at(-1).includes('условия красной миссии'),
      'причина отказа ушла в личный журнал игрока');
    assert(G.log.at(-1).includes('не удалось') && !G.log.at(-1).includes('Шлем'),
      'публично видно только что спец. действие не удалось, без названия предмета');
    assert(P.inventory.some(it => it.id === 'helmet'), 'шлем остаётся в инвентаре');
  }

  // равенство — победа: условие включает границу
  {
    const { G, pid } = redReady(5, 5);
    deliver(G, pid, 'helmet');
    assert(G.winner === 'crew', 'жетон хода на точке невозврата — экипаж успевает сбежать');
  }

  // запас по времени — победа
  {
    const { G, pid } = redReady(6, 5);
    deliver(G, pid, 'helmet');
    assert(G.winner === 'crew', 'жетон хода выше точки невозврата — победа');
  }

  // красной миссии повреждения на поле (кроме самой локации 16) не мешают
  {
    const { G, pid } = redReady(5, 5);
    G.board[3].damage = true;
    G.board[7].damage = true;
    deliver(G, pid, 'helmet');
    assert(G.winner === 'crew', 'красная миссия не требует чистого от повреждений поля');
  }

  // без одной из доставок победы нет даже при запасе времени
  {
    const { G, pid } = redReady(6, 5);
    G.missions.delivered = { chipItem: true, toolbox: true };
    deliver(G, pid, 'helmet');
    assert(G.winner === null, 'без линзы красная миссия не выполнена');
  }
}

// --- ПОБЕДА АДЕЛЬ: СМЕРТЬ ЧЛЕНА ЭКИПАЖА ---
// Пятая рана убивает. Раны набираем входом в горящую локацию с заведомо
// проваленной проверкой духа (d6=6 против духа Артёма 4).
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, move: 4 });
  G.winner = null;
  P.health = 0; P.invBlocked = 0; P.dead = false;
  P.pos = 6;
  P.inventory = [];                          // без огнетушителя: гасить пожар нечем
  G.board[6].hazards.fire = true;
  G.board[7].hazards.fire = true;            // 6 и 7 смежны, ходим туда-обратно
  const rnd = makeRandom();
  rnd.D6 = () => 6;                          // проверка духа всегда провалена

  const route = [7, 6, 7, 6, 7];
  route.forEach((dest, i) => {
    P.plan.spent.move = 0;                   // в плане всего 4 кубика — обновляем
    mv('actMove')({ G, playerID: pid, random: rnd }, dest);
    const expected = i + 1;
    assert(P.health === expected, `после ${expected}-го входа в пожар ран ${expected}`);
    if (expected < 5) {
      assert(P.dead === false, `${expected} ран(ы) — экипаж жив`);
      assert(G.winner === null, `${expected} ран(ы) — партия продолжается`);
    }
  });

  assert(P.health === 5, 'набрано ровно пять ран');
  assert(P.dead === true, 'на пятой ране член экипажа погибает');
  assert(G.winner === 'adel', 'смерть члена экипажа — победа АДЕЛЬ');
}

// --- ПОБЕДА АДЕЛЬ: КОНЕЦ ВРЕМЕНИ ---
// Жетон хода уходит ниже единицы — экипаж не успел.
{
  const G = setupG();
  const start = G.turnNo;                    // 15 при составе АДЕЛЬ + 3
  assert(start === 15, 'партия на четверых начинается с 15 ходов');
  const rnd = makeRandom();
  rnd.Die = () => 1;                         // «Столкновение» всегда бьёт в локацию 1
  // Никого не оставляем в локации 1, иначе столкновение начнёт наносить раны.
  for (const p of Object.keys(G.players)) if (G.players[p].pos === 1) G.players[p].pos = 5;

  let turns = 0;
  while (!G.winner && turns < 40) { endTurn(G, rnd); turns += 1; }

  assert(turns === start, `конец времени наступает за ${start} ходов (получено ${turns})`);
  assert(G.turnNo === 0, 'жетон хода доходит до 0');
  assert(G.winner === 'adel', 'при жетоне хода ниже 1 побеждает АДЕЛЬ');
  assert(Object.keys(G.players).every(p => !G.players[p].dead),
    'экипаж проигрывает именно по времени, а не по ранам');
  assert(G.log.at(-1).includes('Время вышло'), 'движок объявляет конец времени');
}

if (failed) { console.error(`\nENDINGS: провалено проверок — ${failed}`); process.exit(1); }
console.log('ENDINGS OK ✓');
