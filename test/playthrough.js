// Отыгрыш полных партий: от раскладки до конца, через настоящий цикл фаз
// (событие → планирование → фаза АДЕЛЬ → розыгрыш → действия → конец хода).
// Все четыре исхода: обе победы экипажа и обе победы АДЕЛЬ.
//
// В отличие от endings.js, где победа выставляется точечно, здесь партии
// действительно играются: ходы делаются теми же moves, что и в живой игре,
// АДЕЛЬ каждый ход выкладывает фишки и тратит энергию, события разыгрываются.
// Стартовая раскладка задаётся явно — иначе исход зависел бы от того, куда
// случай положил ключевые предметы.
import { Adel } from '../src/game/index.js';
import { HAZARDS, CHARACTERS, ADJ, MARKER_SLOTS, ITEMS } from '../src/game/data.js';
import { botState, planFor, act } from './bot.js';

let failed = 0;
const assert = (cond, msg) => {
  if (cond) return;
  console.error('FAIL:', msg);
  failed += 1;
};

const mv = (name) => Adel.moves[name].move;
const NO_CUBES = { move: 0, search: 0, activate: 0, special: 0, door: 0 };
const plan = (p) => ({ ...NO_CUBES, ...p });

// Скриптованная случайность. Поля d6/d20 меняются по ходу сценария: во время
// раскладки d20 обязан давать разные значения (стартовые позиции экипажа
// подбираются перебросом до свободной локации), а в самой партии его удобно
// зафиксировать, чтобы столкновение всегда било в одну и ту же локацию.
function makeRandom({ d6 = 1, d20 = null } = {}) {
  let s = 1;
  const next = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const r = {
    d6, d20,
    Number: next,
    D6: () => (typeof r.d6 === 'function' ? r.d6() : r.d6),
    Die: (n) => {
      if (r.d20 == null) return 1 + Math.floor(next() * n);
      return typeof r.d20 === 'function' ? r.d20() : r.d20;
    },
    Shuffle: (a) => [...a],
  };
  return r;
}
// Раскладка прошла — дальше броски d20 фиксируем.
const fixDie = (random, value = 7) => { random.d20 = value; return random; };

function clearBoard(G) {
  for (let l = 1; l <= 20; l++) {
    const L = G.board[l];
    L.damage = false; L.computerLocked = false; L.terminalLocked = false;
    L.doors = []; L.hatchClosed = false; L.batteryGuard = false;
    L.items = [];
    for (const h of HAZARDS) L.hazards[h] = false;
  }
}

// Колода событий под сценарий: карты перечисляются по идентификаторам.
function stackEvents(G, ids, color = 'grey') {
  G.eventDeck = ids.map((id, i) => ({ id, color, uid: 100 + i, cancelled: false, panic: false }));
  G.currentEvent = { id: 'silence', color, uid: 99, cancelled: false, panic: false };
  G.eventOngoing = null;
}

const crewOf = (G) => Object.keys(G.players);
const nameOf = (G, pid) => CHARACTERS[G.players[pid].character].name;

// Разбор зависших требований: гипоксия, перегруз, лаборатория, аптечка.
// Ровно то, что делает живой игрок, прежде чем продолжить ход.
function settle(G, pid, random) {
  const P = G.players[pid];
  for (let guard = 0; guard < 12; guard++) {
    if (P.pendingHypoxia) {
      const k = ['door', 'activate', 'special', 'search', 'move']
        .find(a => P.plan && P.plan[a] - P.plan.spent[a] > 0);
      if (!k) break;
      mv('payHypoxia')({ G, playerID: pid }, k);
      continue;
    }
    if (P.pendingDrop) {
      // сбрасываем то, что не нужно миссии
      const i = P.inventory.findIndex(it => !['axe', 'helmet', 'lens', 'blue_card', 'id_badge', 'chipItem', 'toolbox'].includes(it.id));
      mv('dropItem')({ G, playerID: pid, random }, i >= 0 ? i : P.inventory.length - 1);
      continue;
    }
    if (P.pendingLabPick) { mv('pickLab')({ G, playerID: pid }, G.labStack[0]); continue; }
    if (P.pendingMedkit) { mv('applyMedkit')({ G, playerID: pid }, pid, P.pendingMedkit); continue; }
    break;
  }
}

// Один полный ход партии.
// plans(pid) → раскладка кубиков; act(pid) → что игрок делает в фазу действий;
// adel(G) → что делает АДЕЛЬ в свою фазу (кроме завершения).
function playTurn(G, random, { plans, act, adel }) {
  for (const pid of crewOf(G)) {
    if (G.players[pid].dead) continue;
    mv('commitPlan')({ G, playerID: pid, random }, plans(pid, G));
  }
  assert(G.phase === 'adel' || G.winner, `после планирования фаза АДЕЛЬ, а не «${G.phase}»`);
  if (G.winner) return;

  if (adel) adel(G, random);
  mv('adelEndPhase')({ G, playerID: '0', random });
  if (G.winner) return;
  assert(G.phase === 'actions', `после фазы АДЕЛЬ — действия, а не «${G.phase}»`);

  for (const pid of crewOf(G)) {
    if (G.winner) return;
    const P = G.players[pid];
    if (P.dead || P.acted) continue;
    mv('claimActive')({ G, playerID: pid });
    settle(G, pid, random);
    if (act) act(pid, G, random);
    settle(G, pid, random);
    if (!G.winner && !P.dead) mv('finishTurn')({ G, playerID: pid, random });
  }
}

// АДЕЛЬ, играющая всерьёз, но предсказуемо: каждый ход выкладывает фишку
// картой из руки в локацию, не мешающую сценарию (жёлтый сектор пуст).
const adelPlaysCards = (safeLocs) => (G, random) => {
  const card = G.adel.hand.find(c => c.type === 'loc' && c.locs.some(l => safeLocs.includes(l)));
  if (!card) return;
  const l = card.locs.find(x => safeLocs.includes(x));
  const hz = ['spy', 'darkness', 'fire'].find(h => G.adel.console[h]?.length);
  if (!hz) return;
  mv('adelPlayCard')({ G, playerID: '0', random }, card.id, { type: hz, target: { loc: l } });
};

// ============================================================
// ПАРТИЯ 1. Экипаж из двух, синяя миссия — «отключить АДЕЛЬ»
// ============================================================
// Ключевые предметы лежат на поле лицом вниз, как и положено. Экипаж обязан их
// НАЙТИ поиском, а найдя чужой предмет — договориться с напарником о локации.
{
  const random = makeRandom({ d6: 1 });
  const G = Adel.setup({ ctx: { numPlayers: 3 }, random });
  fixDie(random, 7);
  clearBoard(G);
  assert(G.turnNo === 18, `партия на троих идёт 18 ходов, получено ${G.turnNo}`);

  const [a, b] = crewOf(G);
  G.players[a].character = 'mei';        // спец. действие за 2 кубика
  G.players[b].character = 'artem';
  G.players[a].pos = 2; G.players[a].inSpace = null; G.players[a].inventory = [];
  G.players[b].pos = 7; G.players[b].inSpace = null; G.players[b].inventory = [];

  // Раздача: маркеры и предметы. Кто что знает — из таблицы движка:
  // первый знает удостоверение и ящик, второй — синюю карту и чип, линзу оба.
  G.missions.markers.id_badge = { loc: 4, revealed: false };
  G.missions.markers.blue_card = { loc: 6, revealed: false };
  G.missions.markers.lens = { loc: 11, revealed: false };
  G.missions.markers.toolbox = { loc: 14, revealed: false };
  G.missions.markers.chipItem = { loc: 15, revealed: false };
  G.missions.delivered = {};
  const deal = { 2: 'id_badge', 3: 'blue_card', 9: 'lens', 11: 'axe', 16: 'helmet' };
  for (const [l, id] of Object.entries(deal)) G.board[l].items = [{ id, faceUp: false }];
  // Инвариант честного отыгрыша: ключевые предметы лежат на поле лицом вниз,
  // ни один не выдан в инвентарь. Экипаж обязан их найти поиском.
  assert(crewOf(G).every(p => G.players[p].inventory.length === 0),
    'экипаж начинает партию с пустыми руками');
  assert(Object.values(deal).filter(id => ITEMS[id].kind === 'key').length >= 4,
    'ключевые предметы разложены по локациям');

  // Ход 3 — столкновение: жетон повреждения заблокирует синюю миссию, пока
  // экипаж не починит его ремонтным терминалом.
  stackEvents(G, ['silence', 'silence', 'collision', ...Array.from({ length: 16 }, () => 'silence')]);

  assert(G.missions.viewers.lens.length === 2, 'локацию линзы знают оба — состав на двоих');
  assert(G.missions.viewers.blue_card.includes(b) && !G.missions.viewers.blue_card.includes(a),
    'синюю карту знает только второй — первому придётся спросить');

  // Маршруты обхода — план команды, а не подсказка движка: где лежат предметы,
  // бот заранее не знает.
  const S = botState(G, { [a]: [2, 3, 4, 9, 11, 17, 20], [b]: [7, 6, 2, 3, 9, 10, 14] });

  let turns = 0;
  while (!G.winner && turns < 18) {
    turns += 1;
    playTurn(G, random, {
      plans: (pid) => planFor(G, pid, S),
      adel: adelPlaysCards([13, 14, 15, 16]),
      act: (pid) => act(G, pid, S, random),
    });
  }

  assert(G.winner === 'crew', );
  if (process.env.ADEL_VERBOSE) console.log('  синяя миссия: ' + turns + ' ходов');
  // Число ходов зафиксировано намеренно. Это замок на весь ход партии: любое
  // послабление в правилах (доставка без проверки локации, финал без трёх
  // предметов, синяя миссия без чистого поля) укорачивает партию и ломает эту
  // проверку — даже если победа всё равно случается.
  assert(turns === 13, `синяя миссия занимает 13 ходов, вышло ${turns}`);

  // Предметы действительно нашли поиском, а не получили в начале.
  assert(G.missions.delivered.blue_card && G.missions.delivered.id_badge && G.missions.delivered.lens,
    'все три ключевых предмета доставлены');
  for (const l of Object.keys(deal)) {
    assert(!G.board[l].items.some(it => it.id === deal[l] && deal[l] !== 'helmet'),
      `предмет из локации ${l} забран с поля`);
  }
  // Синюю карту нашёл игрок, который НЕ знает её локации: доставить её он смог
  // только после встречи с напарником. Это второй из двух законных путей —
  // «встретиться и узнать», в отличие от «передать предмет».
  assert(!G.missions.viewers.blue_card.includes(a),
    'локацию синей карты первый игрок изначально не знал');
  assert(G.log.some(l => l.includes('показывает свои маркеры')),
    'напарники встретились в одной локации и обменялись сведениями');
  assert(G.missions.delivered.blue_card === true,
    'после встречи синяя карта доставлена, хотя нашедший её сам локации не знал');
  // АДЕЛЬ видит каждую активацию.
  const adelSees = Adel.playerView({ G, playerID: '0' }).log.filter(l => l.includes('доставляет'));
  assert(adelSees.length === 3, `АДЕЛЬ видит все три доставки, видит ${adelSees.length}`);
  assert(G.log.some(l => l.includes('ЭКИПАЖ ПОБЕЖДАЕТ')), 'победа объявлена в журнале');

  // Столкновение по дороге положило жетон повреждения — синяя миссия была
  // заблокирована, пока экипаж не сходил к ремонтному терминалу.
  assert(G.log.some(l => l.includes('Столкновение! Жетон повреждения')),
    'событие «Столкновение» действительно случилось');
  assert(G.log.some(l => l.includes('чинит повреждение')),
    'экипаж чинил повреждение ремонтным терминалом');
  assert(Object.values(G.board).every(L => !L.damage),
    'к моменту победы на корабле нет ни одного жетона повреждения');
}

// ============================================================
// ПАРТИЯ 2. Экипаж из двух, красная миссия — «сбежать с корабля»
// ============================================================
{
  const random = makeRandom({ d6: 1 });
  const G = Adel.setup({ ctx: { numPlayers: 3 }, random });
  fixDie(random, 7);
  clearBoard(G);

  const [a, b] = crewOf(G);
  G.players[a].character = 'mei';
  G.players[b].character = 'artem';
  // Предметы разнесены по разным концам корабля: экипажу придётся пересечь его
  // из конца в конец, а не подобрать всё под ногами.
  G.players[a].pos = 10; G.players[a].inSpace = null; G.players[a].inventory = [];
  G.players[b].pos = 11; G.players[b].inSpace = null; G.players[b].inventory = [];

  G.missions.markers.toolbox = { loc: 10, revealed: false };
  G.missions.markers.chipItem = { loc: 11, revealed: false };
  G.missions.markers.lens = { loc: 13, revealed: false };
  G.missions.markers.id_badge = { loc: 3, revealed: false };
  G.missions.markers.blue_card = { loc: 4, revealed: false };
  G.missions.delivered = {};
  const deal = { 15: 'toolbox', 12: 'chipItem', 9: 'lens', 16: 'helmet', 20: 'axe' };
  for (const [l, id] of Object.entries(deal)) G.board[l].items = [{ id, faceUp: false }];
  // Инвариант честного отыгрыша: ключевые предметы лежат на поле лицом вниз,
  // ни один не выдан в инвентарь. Экипаж обязан их найти поиском.
  assert(crewOf(G).every(p => G.players[p].inventory.length === 0),
    'экипаж начинает партию с пустыми руками');
  assert(Object.values(deal).filter(id => ITEMS[id].kind === 'key').length >= 4,
    'ключевые предметы разложены по локациям');
  G.pointOfNoReturn = 1;
  // «Дрейф» поднимает точку невозврата — красной миссии становится теснее.
  stackEvents(G, ['silence', 'drift', 'silence', 'silence', 'silence', 'silence',
    'silence', 'silence', 'silence', 'silence', 'silence', 'silence',
    'silence', 'silence', 'silence', 'silence', 'silence', 'silence']);

  const S = botState(G, { [a]: [14, 15, 12, 19], [b]: [9, 10, 13, 16] });

  let turns = 0;
  while (!G.winner && turns < 18) {
    turns += 1;
    playTurn(G, random, {
      plans: (pid) => planFor(G, pid, S),
      adel: adelPlaysCards([5, 6, 7, 8]),
      act: (pid) => act(G, pid, S, random),
    });
  }

  assert(G.pointOfNoReturn > 1, `«Дрейф» поднял точку невозврата до ${G.pointOfNoReturn}`);
  assert(G.winner === 'crew', );
  if (process.env.ADEL_VERBOSE) console.log('  красная миссия: ' + turns + ' ходов');
  assert(turns === 9, `красная миссия занимает 9 ходов, вышло ${turns}`);
  assert(G.turnNo >= G.pointOfNoReturn,
    `побег успел до точки невозврата: ход ${G.turnNo}, точка ${G.pointOfNoReturn}`);
  assert(G.missions.delivered.chipItem && G.missions.delivered.toolbox && G.missions.delivered.lens,
    'чип, ящик и линза доставлены');
  assert(G.log.some(l => l.includes('побег удался')), 'в журнале объявлен побег');
}


// ============================================================
// ПАРТИЯ 3. Победа АДЕЛЬ: гибель члена экипажа
// ============================================================
{
  // Проверки духа проваливаются всегда — экипаж ходит через пожары.
  const random = makeRandom({ d6: 6, d20: 7 });
  const G = Adel.setup({ ctx: { numPlayers: 3 }, random });
  fixDie(random);
  clearBoard(G);

  const [a, b] = crewOf(G);
  G.players[a].character = 'artem';
  G.players[b].character = 'emma';
  for (const pid of [a, b]) {
    G.players[pid].pos = 2; G.players[pid].inSpace = null;
    G.players[pid].inventory = []; G.players[pid].health = 0;
  }
  G.board[3].hazards.fire = true;
  G.board[2].hazards.fire = true;
  stackEvents(G, ['silence', 'silence', 'silence', 'silence', 'silence', 'silence']);

  let turns = 0;
  while (!G.winner && turns < 10) {
    turns += 1;
    playTurn(G, random, {
      plans: () => plan({ move: 4 }),
      // курсируем между двумя горящими локациями
      act: (pid, g) => {
        if (pid !== a) return;
        const to = g.players[a].pos === 2 ? 3 : 2;
        mv('actMove')({ G: g, playerID: a, random }, to);
        if (!g.winner) mv('actMove')({ G: g, playerID: a, random }, to === 2 ? 3 : 2);
      },
    });
  }

  assert(G.winner === 'adel', `АДЕЛЬ побеждает гибелью экипажа, winner=${G.winner}`);
  assert(G.players[a].dead === true, `${nameOf(G, a)} погибает`);
  assert(G.players[a].health >= 5, `к гибели набралось ${G.players[a].health} ран`);
  assert(G.log.some(l => l.includes('погибает')), 'гибель объявлена в журнале');
}

// ============================================================
// ПАРТИЯ 4. Победа АДЕЛЬ: время вышло
// ============================================================
{
  const random = makeRandom({ d6: 1, d20: 7 });
  const G = Adel.setup({ ctx: { numPlayers: 3 }, random });
  fixDie(random);
  clearBoard(G);
  const start = G.turnNo;
  assert(start === 18, 'на троих партия начинается с 18 ходов');

  for (const pid of crewOf(G)) {
    G.players[pid].pos = 5; G.players[pid].inSpace = null; G.players[pid].inventory = [];
  }
  stackEvents(G, Array.from({ length: 25 }, () => 'silence'));

  let turns = 0;
  while (!G.winner && turns < 30) {
    turns += 1;
    // экипаж честно программирует кубики, но никуда не ходит
    playTurn(G, random, { plans: () => plan({ move: 4 }), adel: adelPlaysCards([1, 2, 3, 4]) });
  }

  assert(turns === start, `время выходит ровно за ${start} ходов, потребовалось ${turns}`);
  assert(G.winner === 'adel', `АДЕЛЬ побеждает по времени, winner=${G.winner}`);
  assert(G.turnNo === 0, `жетон хода дошёл до нуля, сейчас ${G.turnNo}`);
  assert(crewOf(G).every(p => !G.players[p].dead), 'экипаж проиграл по времени, а не по ранам');
  assert(G.log.some(l => l.includes('Время вышло')), 'конец времени объявлен в журнале');
}

// ============================================================
// ПАРТИЯ 5. Экипаж из трёх, синяя миссия — второй поддерживаемый состав
// ============================================================
// При трёх членах экипажа линзу знает только третий: сведения размазаны тоньше,
// и без встреч миссия не собирается.
{
  const random = makeRandom({ d6: 1 });
  const G = Adel.setup({ ctx: { numPlayers: 4 }, random });
  fixDie(random, 7);
  clearBoard(G);
  assert(G.turnNo === 15, `партия на четверых идёт 15 ходов, получено ${G.turnNo}`);
  assert(crewOf(G).length === 3, 'в экипаже трое');

  const [a, b, c] = crewOf(G);
  G.players[a].character = 'mei';
  G.players[b].character = 'artem';
  G.players[c].character = 'emma';
  const start = { [a]: 2, [b]: 7, [c]: 10 };
  for (const pid of [a, b, c]) {
    G.players[pid].pos = start[pid]; G.players[pid].inSpace = null; G.players[pid].inventory = [];
  }

  // Ни один предмет не лежит там, где он нужен, и ни один — под ногами
  // у того, кто знает его локацию.
  G.missions.markers.id_badge = { loc: 3, revealed: false };
  G.missions.markers.blue_card = { loc: 18, revealed: false };
  G.missions.markers.lens = { loc: 15, revealed: false };
  G.missions.markers.toolbox = { loc: 14, revealed: false };
  G.missions.markers.chipItem = { loc: 12, revealed: false };
  G.missions.delivered = {};
  const deal = { 4: 'id_badge', 9: 'blue_card', 14: 'lens', 17: 'axe', 16: 'helmet' };
  for (const [l, id] of Object.entries(deal)) G.board[l].items = [{ id, faceUp: false }];
  // Инвариант честного отыгрыша: ключевые предметы лежат на поле лицом вниз,
  // ни один не выдан в инвентарь. Экипаж обязан их найти поиском.
  assert(crewOf(G).every(p => G.players[p].inventory.length === 0),
    'экипаж начинает партию с пустыми руками');
  assert(Object.values(deal).filter(id => ITEMS[id].kind === 'key').length >= 4,
    'ключевые предметы разложены по локациям');
  stackEvents(G, Array.from({ length: 16 }, () => 'silence'));

  assert(G.missions.viewers.lens.length === 1,
    'при трёх в экипаже линзу знает только один — в отличие от партии на двоих');

  const S = botState(G, {
    [a]: [3, 4, 9, 11, 17, 20],
    [b]: [8, 9, 11, 18, 19],
    [c]: [14, 15, 12, 19],
  });

  let turns = 0;
  while (!G.winner && turns < 15) {
    turns += 1;
    playTurn(G, random, {
      plans: (pid) => planFor(G, pid, S),
      adel: adelPlaysCards([13, 14, 15, 16]),
      act: (pid) => act(G, pid, S, random),
    });
  }

  assert(G.winner === 'crew', `состав на четверых тоже доводит миссию до победы, winner=${G.winner} за ${turns} ходов`);
  if (process.env.ADEL_VERBOSE) console.log('  синяя миссия втроём: ' + turns + ' ходов');
  assert(turns === 7, `синяя миссия втроём занимает 7 ходов, вышло ${turns}`);
  assert(G.missions.delivered.lens === true, 'линзу доставил тот, кто знал её локацию, или тот, кому сказали');
}

// ============================================================
// Скрытая информация в живой партии: предметы напарника
// ============================================================
{
  const random = makeRandom({ d6: 1, d20: 7 });
  const G = Adel.setup({ ctx: { numPlayers: 3 }, random });
  fixDie(random);
  clearBoard(G);
  const [a, b] = crewOf(G);
  G.players[a].pos = 2; G.players[a].inSpace = null;
  G.players[b].pos = 6; G.players[b].inSpace = null;
  G.players[b].inventory = [{ id: 'axe', faceUp: false }];

  const hiddenFor = (viewer, owner) =>
    Adel.playerView({ G, playerID: viewer }).players[owner].inventory.every(it => it.id === 'hidden');

  assert(hiddenFor(a, b), 'в разных локациях предметы напарника не видны');
  assert(hiddenFor('0', b), 'и АДЕЛЬ их не видит');

  // сходятся в одной локации и показывают инвентарь
  G.players[a].pos = 6;
  assert(hiddenFor(a, b), 'сама по себе встреча инвентарь ещё не раскрывает');
  mv('shareInfo')({ G, playerID: b }, a, true);
  assert(!hiddenFor(a, b), 'после показа напарник видит предметы');
  assert(hiddenFor('0', b), 'АДЕЛЬ показа не подслушивает');

  // расходятся — показ прекращается
  const P = G.players[b];
  G.phase = 'actions'; G.activeCrew = b;
  P.plan = { ...NO_CUBES, move: 4, spent: { ...NO_CUBES } };
  P.acted = false; P.pendingDrop = 0;
  mv('actMove')({ G, playerID: b, random }, 2);
  assert(hiddenFor(a, b), 'после расхождения предметы снова скрыты');
}

if (failed) { console.error(`\nPLAYTHROUGH: провалено проверок — ${failed}`); process.exit(1); }
console.log('PLAYTHROUGH OK ✓');
