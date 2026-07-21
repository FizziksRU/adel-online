// Проверки отдельных правил. В отличие от smoke.js движок здесь вызывается
// напрямую, без boardgame.io: так можно выставить нужное состояние поля
// (повреждение, батарею, конкретный предмет) и проверить одно правило точечно.
import { Adel, __testing } from '../src/game/index.js';
import {
  SECTORS, HAZARDS, HAZARD_NAMES, BAG_COUNTS, CONSOLE_LAYOUT, CONSOLE_ORDER,
  ANOMALIES, ANOMALY_COST, ITEMS, ITEM_COUNTS, LAB_STACK, CHARACTERS,
  randomPool, BOARD_FIXED, RANDOM_DRAW, EVENTS, EVENT_DECK,
  ADEL_CARDS, ADEL_SPECIALS, SPECIALS_REMOVED, ADEL_HAND_LIMIT,
} from '../src/game/data.js';

const addChip = (G, type) => __testing.consoleAddChip(G, type);

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
// жетон повреждения куда угодно. Точечные проверки не должны от этого зависеть
// — пусть на поле лежит только то, что тест выставил сам.
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
// Локация в секторе цвета текущего события — единственная законная цель «Атаки».
const locOfEventColor = (G) => SECTORS[G.currentEvent.color][0];

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

// Разобрать очередь проверок духа: за живым игроком это делает кнопка «Бросить
// кубик», в тесте — этот помощник. Без него движок стоит и фаза не двигается,
// что само по себе проверяется отдельно.
function rollChecks(G, random = makeRandom(), limit = 20) {
  let n = 0;
  while (G.pendingChecks.length && !G.winner && n < limit) {
    mv('rollSpirit')({ G, playerID: G.pendingChecks[0].pid, random });
    n += 1;
  }
  return n;
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
  rollChecks(G, random);
}

// --- Жетон повреждения выводит из строя компьютер и терминал ---
// «Компьютер и терминал (если есть) в этой локации нельзя использовать,
//  пока не уберёте жетон повреждения» (событие «Столкновение»).
{
  const G = setupG();
  const pid = pidOf(G, 'mei');
  const P = readyForAction(G, pid);
  P.pos = 18; P.health = 2;               // 18 — медицинский терминал
  G.board[18].damage = true;
  const r = mv('actSpecial')({ G, playerID: pid, random: makeRandom() }, { kind: 'terminal' });
  assert(r === 'INVALID_MOVE', 'повреждённый терминал недоступен');
  assert(G.players[pid].health === 2, 'лечения через повреждённый терминал не произошло');
}
{
  // контроль: без повреждения тот же терминал работает
  const G = setupG();
  const pid = pidOf(G, 'mei');
  const P = readyForAction(G, pid);
  P.pos = 18; P.health = 2;
  mv('actSpecial')({ G, playerID: pid, random: makeRandom() }, { kind: 'terminal' });
  assert(G.players[pid].health === 0, 'исправный мед. терминал лечит все раны');
}
{
  const G = setupG();
  const pid = pidOf(G, 'mei');
  const P = readyForAction(G, pid);
  P.pos = 2;
  G.board[2].hazards.darkness = true;
  G.board[2].damage = true;
  const r = mv('actSpecial')({ G, playerID: pid, random: makeRandom() }, { kind: 'clearHazard', hazard: 'darkness', loc: 2 });
  assert(r === 'INVALID_MOVE', 'повреждённый компьютер не убирает опасность');
  assert(G.board[2].hazards.darkness === true, '«тьма» осталась на месте');
}
{
  // контроль: исправный компьютер опасность убирает
  const G = setupG();
  const pid = pidOf(G, 'mei');
  const P = readyForAction(G, pid);
  P.pos = 2;
  G.board[2].hazards.darkness = true;
  mv('actSpecial')({ G, playerID: pid, random: makeRandom() }, { kind: 'clearHazard', hazard: 'darkness', loc: 2 });
  assert(G.board[2].hazards.darkness === false, 'исправный компьютер убирает «тьму»');
}

// --- Батарея защищает локацию от новой блокировки, пока не разрядится ---
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES });
  P.pos = 7;
  P.inventory = [{ id: 'battery', faceUp: true, charge: 2 }];
  G.board[7].computerLocked = true;

  const r = mv('useBattery')({ G, playerID: pid }, 'computer');
  assert(r !== 'INVALID_MOVE', 'батарея снимает блокировку');
  assert(G.board[7].computerLocked === false, 'блокировка снята');
  assert(G.board[7].batteryGuard === true, 'локация под защитой батареи');

  // АДЕЛЬ пытается заблокировать локацию заново
  G.phase = 'adel';
  G.adel.energy = 50;
  G.adel.console.lockdown = [2];
  G.adel.hand = [{ id: 'TEST', type: 'loc', locs: [7, 8] }];
  const r2 = mv('adelPlayCard')({ G, playerID: '0', random: makeRandom() },
    'TEST', { type: 'lockdown', target: { loc: 7, slot: 'computer' } });
  assert(r2 === 'INVALID_MOVE', 'АДЕЛЬ не может заблокировать защищённую батареей локацию');
  assert(G.board[7].computerLocked === false, 'компьютер остался разблокированным');

  // защита держится, пока батарея не разрядится окончательно
  endTurn(G);                                   // заряд 2 → 1
  assert(G.board[7].batteryGuard === true, 'защита держится при заряде 1');
  endTurn(G);                                   // заряд 1 → 0
  assert(G.board[7].batteryGuard === true, 'защита держится при нулевом заряде');
  endTurn(G);                                   // разряжена → сброс
  assert(G.board[7].batteryGuard === false, 'разряженная батарея снимает защиту');
  assert(!G.board[7].items.some(it => it.id === 'battery' && it.faceUp),
    'разряженная батарея убрана из локации');
}

// --- Эмма Рончони (медик): аптечка на 4 заряда лечения вместо 3 ---
{
  const G = setupG();
  const pid = pidOf(G, 'emma');
  const P = readyForAction(G, pid, { ...NO_CUBES, activate: 4 });
  P.pos = 3;
  P.inventory = [{ id: 'medkit', faceUp: false }];
  mv('actActivate')({ G, playerID: pid, random: makeRandom() }, 0);
  assert(G.players[pid].pendingMedkit === 4,
    'у Эммы аптечка на 4 лечения, got ' + G.players[pid].pendingMedkit);
}
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, activate: 4 });
  P.pos = 3;
  P.inventory = [{ id: 'medkit', faceUp: false }];
  mv('actActivate')({ G, playerID: pid, random: makeRandom() }, 0);
  assert(G.players[pid].pendingMedkit === 3,
    'у остальных аптечка на 3 лечения, got ' + G.players[pid].pendingMedkit);
}

// --- Гипоксия: кубик выбирает игрок, до оплаты действовать нельзя ---
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, move: 2, search: 2 });
  P.pos = 2;
  G.board[6].hazards.hypoxia = true;            // 6 — сосед локации 2

  mv('actMove')({ G, playerID: pid, random: makeRandom() }, 6);
  assert(G.players[pid].pos === 6, 'игрок вошёл в локацию с гипоксией');
  assert(G.players[pid].pendingHypoxia === 1, 'гипоксия требует отдать кубик');

  // пока не оплачено — действовать нельзя
  const blocked = mv('actSearch')({ G, playerID: pid }, false);
  assert(blocked === 'INVALID_MOVE', 'до оплаты гипоксии действовать нельзя');
  const noFinish = mv('finishTurn')({ G, playerID: pid, random: makeRandom() });
  assert(noFinish === 'INVALID_MOVE', 'до оплаты гипоксии нельзя завершить ход');

  // отдаём кубик по своему выбору — именно тот, что назвали
  const searchBefore = G.players[pid].plan.search;
  mv('payHypoxia')({ G, playerID: pid }, 'search');
  assert(G.players[pid].plan.search === searchBefore - 1, 'отдан выбранный кубик «Поиск»');
  assert(G.players[pid].pendingHypoxia === 0, 'гипоксия оплачена');
  const ok = mv('actSearch')({ G, playerID: pid }, false);
  assert(ok !== 'INVALID_MOVE', 'после оплаты действия снова доступны');
}
{
  // нельзя отдать кубик действия, которого не осталось
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, move: 4 });
  P.pos = 2;
  P.pendingHypoxia = 1;
  const r = mv('payHypoxia')({ G, playerID: pid }, 'door');
  assert(r === 'INVALID_MOVE', 'нельзя отдать незапрограммированный кубик');
  assert(G.players[pid].pendingHypoxia === 1, 'гипоксия осталась неоплаченной');
}
{
  // свободных кубиков нет — по правилам ничего не происходит
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, move: 1 });
  P.pos = 2;
  P.plan.spent.move = 1;                        // единственный кубик уже потрачен
  G.board[6].hazards.hypoxia = true;
  P.pos = 6;
  mv('actSearch')({ G, playerID: pid }, false); // любой ход прогоняет settleHypoxia
  assert(!G.players[pid].pendingHypoxia, 'без свободных кубиков гипоксия не копится');
}

// --- Аномалия «Атака» разыгрывается в фазе событий, до планирования ---
// По правилам фишка ложится ДО того, как экипаж тайно распределит кубики, —
// иначе она становится сюрпризом уже после фиксации планов.
{
  const G = setupG();
  G.anomaliesActive.push('attack');
  G.adel.energy = 50;
  G.adel.console.fire = [2];
  const target = locOfEventColor(G);

  for (const phase of ['adel', 'actions', 'planning']) {
    G.phase = phase;
    const r = mv('adelAttack')({ G, playerID: '0' }, 'fire', { loc: target });
    assert(r === 'INVALID_MOVE', `в фазу «${phase}» атаковать нельзя`);
  }
  assert(G.board[target].hazards.fire === false, 'фишка не выложена');

  G.phase = 'event';
  const r2 = mv('adelAttack')({ G, playerID: '0' }, 'fire', { loc: target });
  assert(r2 !== 'INVALID_MOVE', 'в окно фазы событий атака проходит');
  assert(G.board[target].hazards.fire === true, 'фишка выложена в сектор цвета события');

  // второй раз за тот же ход — нельзя
  G.adel.console.fire = [2];
  const r3 = mv('adelAttack')({ G, playerID: '0' }, 'fire', { loc: SECTORS[G.currentEvent.color][1] });
  assert(r3 === 'INVALID_MOVE', 'атака доступна один раз за ход');

  // окно закрывается вручную, после чего экипаж планирует
  mv('adelEndEvent')({ G, playerID: '0' });
  assert(G.phase === 'planning', 'после окна атаки начинается планирование');
}
{
  // Пока аномалия не активирована, лишней фазы в ходу не появляется.
  const G = setupG();
  assert(G.phase === 'planning', 'без «Атаки» ход сразу начинается с планирования');
  const r = mv('adelEndEvent')({ G, playerID: '0' });
  assert(r === 'INVALID_MOVE', 'закрывать нечего — окна нет');
}
{
  // С активной аномалией окно открывается в начале каждого хода.
  const G = setupG();
  G.anomaliesActive.push('attack');
  endTurn(G);
  assert(G.phase === 'event', `после конца хода открылось окно «Атаки», а не «${G.phase}»`);
  const blocked = mv('commitPlan')({ G, playerID: '1', random: makeRandom() },
    { move: 4, search: 0, activate: 0, special: 0, door: 0 });
  assert(blocked === 'INVALID_MOVE', 'экипаж не планирует, пока окно «Атаки» открыто');
  mv('adelEndEvent')({ G, playerID: '0' });
  assert(G.phase === 'planning', 'АДЕЛЬ закрыла окно — экипаж планирует');
}

// --- Открытый космос: выход в люк, переход между секциями, ремонт снаружи ---
{
  const G = setupG();
  const pid = pidOf(G, 'mei');                  // у Мэй спец. действие за 2 кубика
  const P = readyForAction(G, pid, { ...NO_CUBES, move: 2, special: 2 });
  P.pos = 13;                                   // люк 13 ведёт в две секции: A и B
  P.inventory = [{ id: 'suit', faceUp: true, charge: 2 }];
  const ctx = { G, playerID: pid, random: makeRandom() };

  const wrongSect = mv('actMove')(ctx, 'C');
  assert(wrongSect === 'INVALID_MOVE', 'через люк 13 нельзя выйти в секцию C');

  mv('actMove')(ctx, 'A');
  assert(G.players[pid].inSpace === 'A', 'выход в открытый космос через люк 13');

  mv('actMove')(ctx, 'B');
  assert(G.players[pid].inSpace === 'B', 'переход в соседнюю секцию');

  G.board[16].damage = true;                    // 16 примыкает к секции B
  mv('actSpecial')(ctx, { kind: 'repairFromSpace', loc: 16 });
  assert(G.board[16].damage === false, 'снаружи убрано повреждение примыкающей локации');
}
{
  // без активированного скафандра в космос не выйти
  const G = setupG();
  const pid = pidOf(G, 'mei');
  const P = readyForAction(G, pid, { ...NO_CUBES, move: 2 });
  P.pos = 13;
  P.inventory = [{ id: 'suit', faceUp: false }];
  const r = mv('actMove')({ G, playerID: pid, random: makeRandom() }, 'A');
  assert(r === 'INVALID_MOVE', 'без активированного скафандра выход запрещён');
  assert(G.players[pid].inSpace === null, 'игрок остался на корабле');
}
{
  // из космоса нельзя чинить локацию, не примыкающую к своей секции
  const G = setupG();
  const pid = pidOf(G, 'mei');
  const P = readyForAction(G, pid, { ...NO_CUBES, special: 2 });
  P.inSpace = 'A';                              // A примыкает к 1, 3, 4, 13
  P.inventory = [{ id: 'suit', faceUp: true, charge: 2 }];
  G.board[20].damage = true;                    // 20 — это секция C
  const r = mv('actSpecial')({ G, playerID: pid, random: makeRandom() },
    { kind: 'repairFromSpace', loc: 20 });
  assert(r === 'INVALID_MOVE', 'нельзя чинить локацию чужой секции');
  assert(G.board[20].damage === true, 'повреждение осталось');
}

// --- Консоль АДЕЛЬ: ячейки, цены и порядок ---
{
  // На каждую фишку из мешочка есть ровно одна ячейка своего вида.
  const cells = {};
  let total = 0;
  for (const col of Object.values(CONSOLE_LAYOUT)) {
    for (const [h, n] of Object.entries(col)) { cells[h] = (cells[h] || 0) + n; total += n; }
  }
  for (const h of HAZARDS) {
    assert(cells[h] === BAG_COUNTS[h],
      `ячеек «${HAZARD_NAMES[h]}» на консоли ${cells[h] || 0}, а фишек в мешочке ${BAG_COUNTS[h]}`);
  }
  const bagTotal = Object.values(BAG_COUNTS).reduce((a, b) => a + b, 0);
  assert(total === 52, `ячеек на консоли ${total}, должно быть 52`);
  assert(bagTotal === 52, `фишек в мешочке ${bagTotal}, должно быть 52`);
  assert(CONSOLE_ORDER.length === HAZARDS.length, 'в порядке колонки перечислены не все виды фишек');
}
{
  // Пополнение занимает самые дешёвые ячейки, выкладывание снимает самые дорогие.
  const G = setupG();
  G.adel.console = Object.fromEntries(HAZARDS.map(h => [h, []]));

  // у «шпионажа» ячейки: 3 по 2⚡, 2 по 3⚡, 1 по 4⚡
  for (let i = 0; i < 4; i++) assert(addChip(G, 'spy'), `фишка шпионажа №${i + 1} влезла на консоль`);
  assert(JSON.stringify(G.adel.console.spy) === '[2,2,2,3]',
    'первые фишки занимают дешёвые ячейки, got ' + JSON.stringify(G.adel.console.spy));

  // всего ячеек шпионажа шесть — седьмая уже не влезает
  addChip(G, 'spy'); addChip(G, 'spy');
  assert(G.adel.console.spy.length === 6, 'на консоли ровно 6 ячеек шпионажа');
  assert(!addChip(G, 'spy'), 'седьмая фишка шпионажа на консоль не помещается');

  // выкладывается всегда самая дорогая
  G.phase = 'adel';
  G.adel.energy = 50;
  G.adel.hand = [{ id: 'T1', type: 'loc', locs: [2, 3] }];
  const before = G.adel.energy;
  mv('adelPlayCard')({ G, playerID: '0', random: makeRandom() },
    'T1', { type: 'spy', target: { loc: 2 } });
  assert(before - G.adel.energy === 4, `снята самая дорогая фишка (4⚡), списано ${before - G.adel.energy}`);
  assert(G.board[2].hazards.spy === true, 'шпионаж выложен в локацию 2');
  assert(!G.adel.console.spy.includes(4), 'ячейка на 4⚡ освободилась');
}

// --- Аномалии: оплата фишками нужных цветов ---
// Готовит фазу АДЕЛЬ с нужной аномалией и энергией.
function adelReady(G, key) {
  G.phase = 'adel';
  G.adel.energy = ANOMALY_COST;
  G.adel.anomalies = [key];
  G.anomaliesActive = [];
  return { G, playerID: '0', random: makeRandom() };
}
const locIn = (color, n = 0) => SECTORS[color][n];

{
  // «Разряженные батареи» требует зелёный и красный — ровно две фишки
  const G = setupG();
  const ctx = adelReady(G, 'drained');
  const g = locIn('green'), r = locIn('red');
  G.board[g].hazards.fire = true;
  G.board[r].hazards.spy = true;

  const short = mv('adelActivateAnomaly')(ctx, 'drained', [{ loc: g, type: 'fire' }]);
  assert(short === 'INVALID_MOVE', 'одной фишки для двухцветной аномалии мало');

  mv('adelActivateAnomaly')(ctx, 'drained',
    [{ loc: g, type: 'fire' }, { loc: r, type: 'spy' }]);
  assert(G.anomaliesActive.includes('drained'), 'аномалия активирована');
  assert(G.board[g].hazards.fire === false && G.board[r].hazards.spy === false,
    'обе фишки сняты с поля');
  assert(G.adel.energy === 0, `списано ${ANOMALY_COST}⚡`);
  assert(G.adel.chipDiscard.length === 2, 'снятые фишки ушли в сброс');
}
{
  // цвет не тот — оплата не проходит
  const G = setupG();
  const ctx = adelReady(G, 'drained');
  const g = locIn('green'), y = locIn('yellow');
  G.board[g].hazards.fire = true;
  G.board[y].hazards.fire = true;
  const r = mv('adelActivateAnomaly')(ctx, 'drained',
    [{ loc: g, type: 'fire' }, { loc: y, type: 'fire' }]);
  assert(r === 'INVALID_MOVE', 'жёлтая фишка не закрывает красный цвет');
  assert(G.board[g].hazards.fire === true, 'поле не тронуто при отказе');
  assert(G.adel.energy === ANOMALY_COST, 'энергия не списана при отказе');
}
{
  // одну и ту же фишку нельзя засчитать дважды
  const G = setupG();
  const ctx = adelReady(G, 'drained');
  const g = locIn('green');
  G.board[g].hazards.fire = true;
  const r = mv('adelActivateAnomaly')(ctx, 'drained',
    [{ loc: g, type: 'fire' }, { loc: g, type: 'fire' }]);
  assert(r === 'INVALID_MOVE', 'одна фишка не может оплатить два цвета');
}
{
  // Дверь на стыке секторов годится за любой из двух цветов, и подбор не должен
  // «съедать» цвет, который больше нечем закрыть. Здесь «Деактивированные
  // терминалы» требуют синий и серый; дверь 11↔17 подходит под оба, а вторая
  // фишка — только серая. Жадный выбор отдал бы двери серый и застрял.
  const G = setupG();
  const ctx = adelReady(G, 'kill_terminals');
  G.board[11].doors.push(17);                    // 11 серый ↔ 17 синий
  G.board[9].hazards.fire = true;                // 9 — серый

  mv('adelActivateAnomaly')(ctx, 'kill_terminals',
    [{ loc: 11, type: 'door', door: 17 }, { loc: 9, type: 'fire' }]);
  assert(G.anomaliesActive.includes('kill_terminals'),
    'дверь засчитана за синий, серый закрыт фишкой');
  assert(!G.board[11].doors.includes(17), 'дверь разблокирована');
  assert(G.board[9].hazards.fire === false, 'серая фишка снята');
  assert(G.alarmOff.length === 2, 'аномалия отключила оба жетона терминала тревоги');
}
{
  // «Паника» требует четыре разных цвета
  const G = setupG();
  const ctx = adelReady(G, 'panic');
  const pays = [];
  for (const color of ANOMALIES.panic.colors) {
    const l = locIn(color);
    G.board[l].hazards.fire = true;
    pays.push({ loc: l, type: 'fire' });
  }
  assert(pays.length === 4, 'у «Паники» четыре цвета');
  mv('adelActivateAnomaly')(ctx, 'panic', pays);
  assert(G.anomaliesActive.includes('panic'), 'четырёхцветная аномалия активируется');
}
{
  // цвета аномалий — существующие секторы, без повторов внутри жетона
  for (const [key, a] of Object.entries(ANOMALIES)) {
    assert(a.colors.length >= 2 && a.colors.length <= 4,
      `у аномалии «${a.name}» ${a.colors.length} цветов — ожидалось 2–4`);
    for (const c of a.colors) {
      assert(SECTORS[c], `аномалия «${a.name}» требует неизвестный цвет ${c}`);
    }
    assert(new Set(a.colors).size === a.colors.length,
      `у аномалии «${a.name}» повторяется цвет — сверьтесь с жетоном (${key})`);
  }
}

// --- Жетоны предметов: состав коробки и раскладка ---
{
  const total = Object.values(ITEM_COUNTS).reduce((a, b) => a + b, 0);
  assert(total === 32, `жетонов предметов ${total}, в коробке должно быть 32`);

  const keys = Object.keys(ITEMS).filter(id => ITEMS[id].kind === 'key');
  assert(keys.length === 7, `ключевых предметов ${keys.length}, должно быть 7`);
  for (const id of keys) assert(ITEM_COUNTS[id] === 1, `ключевой «${id}» должен быть в одном экземпляре`);
  for (const id of Object.keys(ITEM_COUNTS)) assert(ITEMS[id], `в составе есть неизвестный предмет ${id}`);
  for (const id of Object.keys(ITEMS)) assert(ITEM_COUNTS[id] > 0, `для предмета ${id} не указано количество`);

  // Пул — это честный остаток кучи, из него хватает на раскладку.
  const pool = randomPool();
  const used = LAB_STACK.length + keys.length + BOARD_FIXED.length + Object.keys(CHARACTERS).length;
  assert(pool.length === total - used,
    `в пуле ${pool.length} жетонов, а по остатку кучи должно быть ${total - used}`);
  assert(pool.length >= RANDOM_DRAW,
    `из пула тянут ${RANDOM_DRAW} жетонов, а в нём всего ${pool.length}`);
  assert(!pool.some(id => ITEMS[id].kind === 'key'), 'ключевые предметы не должны попадать в случайный пул');
  assert(pool.filter(id => id === 'battery').length === 1,
    'батарей в пуле должно остаться ровно одна (4 минус лаборатория, поле и Артём)');
}
{
  // На поле ровно 20 жетонов — по одному в локацию, все ключевые в игре.
  const G = setupG();
  let onBoard = 0;
  for (let l = 1; l <= 20; l++) {
    assert(G.board[l].items.length === 1, `в локации ${l} должен лежать ровно один предмет`);
    onBoard += G.board[l].items.length;
  }
  assert(onBoard === 20, `на поле ${onBoard} предметов, должно быть 20`);
  const ids = Object.values(G.board).flatMap(L => L.items.map(it => it.id));
  for (const id of Object.keys(ITEMS)) {
    if (ITEMS[id].kind === 'key') assert(ids.includes(id), `ключевой предмет «${ITEMS[id].name}» не попал на поле`);
  }
  assert(ids.filter(id => id === 'parts').length >= 2, 'обе детали должны лежать на поле');
  assert(G.labStack.length === 5, 'в лаборатории пять предметов');
}

// --- Колода событий: состав, цвета, паника ---
{
  assert(EVENT_DECK.length === 25, `карт событий ${EVENT_DECK.length}, должно быть 25`);

  const byType = {}, byColor = {};
  for (const c of EVENT_DECK) {
    assert(EVENTS[c.id], `карта ссылается на неизвестное событие ${c.id}`);
    assert(SECTORS[c.color], `у карты «${c.id}» неизвестный цвет ${c.color}`);
    byType[c.id] = (byType[c.id] || 0) + 1;
    byColor[c.color] = (byColor[c.color] || 0) + 1;
  }
  for (const id of Object.keys(EVENTS)) {
    assert(byType[id] > 0, `события «${EVENTS[id].name}» нет в колоде`);
  }
  assert(byType.silence === 5, `карт «Тишина» ${byType.silence}, должно быть 5`);
  // цвета разложены поровну — по пять на каждый сектор
  for (const color of Object.keys(SECTORS)) {
    assert(byColor[color] === 5, `карт цвета ${color} — ${byColor[color]}, должно быть 5`);
  }
  // паника привязана к карте: у одного события есть карты и со значком, и без
  const stressPanic = EVENT_DECK.filter(c => c.id === 'stress' && c.panic).length;
  assert(stressPanic === 2 && byType.stress === 4,
    'у «Стресса» две карты из четырёх со значком паники');
}
{
  // При игре вчетвером «Тишина» уходит из колоды, цвета карт сохраняются.
  const G = setupG();
  const inPlay = [...G.eventDeck, G.currentEvent];
  assert(inPlay.length === 20, `в игре ${inPlay.length} карт событий, ожидалось 20 без «Тишины»`);
  assert(!inPlay.some(c => c.id === 'silence'), '«Тишина» убрана при трёх членах экипажа');
  for (const c of inPlay) {
    assert(SECTORS[c.color], `у карты в колоде потерялся цвет: ${JSON.stringify(c)}`);
  }
}
{
  // Аномалия «Паника» срабатывает по значку на карте, а не по типу события.
  const G = setupG();
  G.anomaliesActive = ['panic'];
  // подкладываем карту «Тишина» со значком паники: сам эффект события пустой,
  // так что рана может прийти только от аномалии
  G.eventDeck.unshift({ id: 'silence', color: 'grey', panic: true, uid: 999, cancelled: false });
  const before = Object.keys(G.players).map(p => G.players[p].health);
  const rnd = makeRandom();
  rnd.D6 = () => 6;                              // провал проверки духа
  endTurn(G, rnd);
  const after = Object.keys(G.players).map(p => G.players[p].health);
  assert(after.some((h, i) => h > before[i]), 'по значку паники экипаж получает раны');
}

// --- Колода АДЕЛЬ: пары локаций и специальные карты ---
{
  const seen = new Set();
  const hits = {};
  for (const card of ADEL_CARDS) {
    assert(card.type === 'loc', `карта ${card.id} должна быть картой локаций`);
    assert(card.locs.length === 2, `на карте ${card.id} должно быть две локации`);
    const [a, b] = card.locs;
    assert(a !== b, `на карте ${card.id} локация повторяется`);
    for (const l of card.locs) {
      assert(l >= 1 && l <= 20, `карта ${card.id} ссылается на локацию ${l}`);
      hits[l] = (hits[l] || 0) + 1;
    }
    const key = [a, b].sort((x, y) => x - y).join('-');
    assert(!seen.has(key), `пара локаций ${key} встречается дважды`);
    seen.add(key);
  }
  // каждую локацию АДЕЛЬ может накрыть ровно двумя картами
  for (let l = 1; l <= 20; l++) {
    assert(hits[l] === 2, `локация ${l} встречается на ${hits[l] || 0} картах, должно быть 2`);
  }
  const ids = new Set(ADEL_CARDS.map(c => c.id));
  assert(ids.size === ADEL_CARDS.length, 'идентификаторы карт АДЕЛЬ должны быть уникальны');

  // Состав колоды АДЕЛЬ по коробке: 20 карт локаций + 7 специальных = 27.
  assert(ADEL_CARDS.length === 20, `карт локаций ${ADEL_CARDS.length}, должно быть 20`);
  assert(ADEL_SPECIALS.length === 7, `специальных карт ${ADEL_SPECIALS.length}, должно быть 7`);
  assert(ADEL_CARDS.length + ADEL_SPECIALS.length === 27,
    `всего карт АДЕЛЬ ${ADEL_CARDS.length + ADEL_SPECIALS.length}, в коробке 27`);

  const specIds = new Set(ADEL_SPECIALS.map(c => c.id));
  assert(specIds.size === ADEL_SPECIALS.length, 'специальные карты не должны повторяться');
  for (const c of ADEL_SPECIALS) {
    assert(c.type === 'special', `карта ${c.id} должна быть специальной`);
    assert(typeof c.name === 'string' && c.name, `у карты ${c.id} нет названия`);
    assert(typeof c.text === 'string' && c.text, `у карты ${c.id} нет описания`);
    assert(Number.isInteger(c.cost) && c.cost >= 0, `у карты ${c.id} неверная цена`);
    assert(!ids.has(c.id), `идентификатор ${c.id} занят картой локаций`);
  }

  // Специальные карты замешаны в общую колоду, отдельной зоны для них нет.
  const G = setupG();
  assert(G.adel.specials === undefined, 'отдельной выкладки специальных карт быть не должно');
  assert(G.adel.hand.length === ADEL_HAND_LIMIT, 'рука АДЕЛЬ — четыре карты');
  const inPlay = ADEL_CARDS.length + ADEL_SPECIALS.length - SPECIALS_REMOVED;
  assert(G.adel.hand.length + G.adel.deck.length === inPlay,
    `по руке и остатку разошлось ${G.adel.hand.length + G.adel.deck.length} карт, ожидалось ${inPlay}`);
  const dealt = [...G.adel.hand, ...G.adel.deck];
  assert(dealt.filter(c => c.type === 'special').length === ADEL_SPECIALS.length - SPECIALS_REMOVED,
    'в колоду попали все специальные карты, оставшиеся в игре');
  assert(new Set(dealt.map(c => c.id)).size === dealt.length, 'карты в колоде не дублируются');
}

// --- Смертельная рана ---
// Убивает ШЕСТАЯ рана: пять ран персонаж переживает. Числа здесь записаны
// прямо, а не выведены из HEALTH_DEATH: тест, повторяющий за константой,
// не заметил бы, если её сдвинуть, — а сдвиг на единицу меняет всю партию.
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, move: 4 });
  P.pos = 2; P.health = 0; P.invBlocked = 0; P.dead = false; P.inventory = [];
  G.board[2].hazards.fire = true;
  G.board[3].hazards.fire = true;          // ходим туда-обратно между двумя пожарами
  const rnd = makeRandom(); rnd.D6 = () => 6;   // проверка духа всегда провалена

  const step = () => {
    P.plan.spent.move = 0;                 // в плане всего 4 кубика — обновляем
    mv('actMove')({ G, playerID: pid, random: rnd }, P.pos === 2 ? 3 : 2);
    mv('rollSpirit')({ G, playerID: pid, random: rnd });
  };

  for (const n of [1, 2, 3, 4, 5]) {
    step();
    assert(P.health === n, `после ${n}-го входа в пожар ран ${n}, а не ${P.health}`);
    assert(P.dead === false, `${n} ран(ы) — член экипажа жив`);
    assert(G.winner === null, `${n} ран(ы) — партия продолжается`);
  }
  step();
  assert(P.health === 6, `набралось шесть ран, а не ${P.health}`);
  assert(P.dead === true, 'шестая рана убивает');
  assert(G.winner === 'adel', 'гибель члена экипажа — победа АДЕЛЬ');
}

// --- playerView: скрытая информация ---
const view = (G, pid) => Adel.playerView({ G, playerID: pid });
{
  // Колода событий закрыта для всех: по правилам открыта только верхняя карта.
  const G = setupG();
  for (const pid of ['0', '1']) {
    assert(typeof view(G, pid).eventDeck === 'number',
      `колода событий скрыта от игрока ${pid}`);
  }
  assert(view(G, '1').nextEvent && view(G, '1').nextEvent.id,
    'следующее событие при этом видно — оно лежит лицом вверх');
}
{
  // Состав лаборатории виден только тому, кто прямо сейчас из неё выбирает:
  // иначе по исчезнувшему предмету вычисляется чужой тайный выбор.
  const G = setupG();
  assert(typeof view(G, '0').labStack === 'number', 'стопка лаборатории скрыта от АДЕЛЬ');
  assert(typeof view(G, '1').labStack === 'number', 'стопка скрыта и от постороннего игрока');
  G.players['1'].pendingLabPick = true;
  assert(Array.isArray(view(G, '1').labStack), 'выбирающий видит состав стопки');
  assert(typeof view(G, '0').labStack === 'number', 'АДЕЛЬ состав не видит и в этот момент');
}
{
  // Шпионаж раскрывает инвентарь, но не карту находок игрока по всему кораблю.
  const G = setupG();
  const pid = '1';
  G.players[pid].knownItems = { 5: 'axe', 9: 'helmet' };
  G.board[G.players[pid].pos].hazards.spy = true;
  const adelV = view(G, '0');
  assert(Object.keys(adelV.players[pid].knownItems).length === 0,
    'шпионаж не раскрывает чужие knownItems');
  assert(adelV.players[pid].inventory.some(it => it.id !== 'hidden'),
    'шпионаж при этом раскрывает инвентарь');
}
{
  // Свои данные игрок видит полностью.
  const G = setupG();
  G.players['2'].knownItems = { 7: 'axe' };
  assert(view(G, '2').players['2'].knownItems['7'] === 'axe', 'свои knownItems видны');
  assert(view(G, '2').players['2'].inventory.every(it => it.id !== 'hidden'), 'свой инвентарь виден');
}
{
  // Здоровье публично: по правилам раны отмечаются кубиком на открытом
  // планшете, поэтому playerView их не прячет ни от кого — ни от напарника,
  // ни от АДЕЛЬ, ни от зрителя.
  const G = setupG();
  const crew = Object.keys(G.players);
  crew.forEach((pid, i) => {
    G.players[pid].health = i + 1;
    G.players[pid].invBlocked = i % 2;
  });
  for (const viewer of [...crew, '0', '9']) {
    const V = view(G, viewer);
    for (const pid of crew) {
      assert(V.players[pid].health === G.players[pid].health,
        `раны игрока ${pid} видны наблюдателю ${viewer}`);
      assert(V.players[pid].invBlocked === G.players[pid].invBlocked,
        `заблокированные ячейки игрока ${pid} видны наблюдателю ${viewer}`);
      assert(V.players[pid].character === G.players[pid].character,
        `персонаж игрока ${pid} виден наблюдателю ${viewer} — без него шкалу не построить`);
    }
  }
}

if (failed) { console.error(`\nRULES: провалено проверок — ${failed}`); process.exit(1); }
console.log('RULES OK ✓');
