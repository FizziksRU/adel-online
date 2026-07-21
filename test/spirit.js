// Проверка духа как отдельное действие игрока: очередь G.pendingChecks,
// ход rollSpirit, блокировка всего остального на время броска и разбиение
// рискованного спец. действия на два шага.
//
// Главное, что здесь проверяется, — движок больше НИГДЕ не бросает кубик
// молча: любая проверка становится в очередь и ждёт игрока.
import { Adel } from '../src/game/index.js';
import { HAZARDS, CHARACTERS, SPIRIT_REASONS } from '../src/game/data.js';

let failed = 0;
const assert = (cond, msg) => {
  if (cond) return;
  console.error('FAIL:', msg);
  failed += 1;
};

function makeRandom(seed = 1) {
  let s = seed;
  const next = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  return { Number: next, D6: () => 1, Die: (n) => 1 + Math.floor(next() * n), Shuffle: (a) => [...a] };
}
// Кубик с заданным значением: успех/провал проверки задаётся тестом, а не
// случаем.
const dice = (value, seed = 1) => { const r = makeRandom(seed); r.D6 = () => value; return r; };

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
  // Стартовое событие могло поставить свои проверки — точечным тестам они мешают.
  G.pendingChecks = []; G.steps = []; G.lastRoll = null; G.rollSeq = 0;
  return G;
};
const mv = (name) => Adel.moves[name].move;
const pidOf = (G, charId) => Object.keys(G.players).find(p => G.players[p].character === charId);
const NO_CUBES = { move: 0, search: 0, activate: 0, special: 0, door: 0 };

function readyForAction(G, pid, plan = { ...NO_CUBES, move: 4 }) {
  G.phase = 'actions';
  G.activeCrew = pid;
  const P = G.players[pid];
  P.plan = { ...plan, spent: { ...NO_CUBES } };
  P.acted = false; P.bonusCubes = 0; P.dead = false;
  P.health = 0; P.invBlocked = 0; P.pendingDrop = 0; P.pendingHypoxia = 0;
  P.inventory = []; P.inSpace = null;
  return P;
}
const spentAll = (P) => Object.values(P.plan.spent).reduce((a, b) => a + b, 0);

// ============================================================
// Движок ставит проверку в очередь, а не бросает кубик сам
// ============================================================
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid);
  P.pos = 2;
  G.board[3].hazards.fire = true;
  const rnd = dice(6);                        // выпал бы провал — но бросать некому

  mv('actMove')({ G, playerID: pid, random: rnd }, 3);
  assert(G.pendingChecks.length === 1, 'вход в пожар ставит одну проверку в очередь');
  assert(G.pendingChecks[0].pid === pid, 'проверка адресована вошедшему');
  assert(G.pendingChecks[0].reason === 'fire', 'причина проверки — пожар');
  assert(G.pendingChecks[0].context.loc === 3, 'в проверке названа локация пожара');
  assert(P.health === 0, 'до броска раны нет: движок не бросает кубик за игрока');
  assert(G.lastRoll === null, 'до броска показывать нечего');
}

// ============================================================
// Пока очередь не пуста — ход не заканчивается и действовать нельзя
// ============================================================
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid);
  P.pos = 2;
  G.board[3].hazards.fire = true;
  // остальные уже отходили: без очереди finishTurn закрыл бы ход целиком
  for (const p of Object.keys(G.players)) if (p !== pid) Object.assign(G.players[p], { acted: true, pendingDrop: 0 });
  const turnBefore = G.turnNo;
  const rnd = dice(1);

  mv('actMove')({ G, playerID: pid, random: rnd }, 3);
  assert(G.pendingChecks.length === 1, 'проверка в очереди');

  assert(mv('finishTurn')({ G, playerID: pid, random: rnd }) === 'INVALID_MOVE',
    'завершить действия до броска нельзя');
  assert(G.turnNo === turnBefore, 'жетон хода не сдвинулся');
  assert(mv('actMove')({ G, playerID: pid, random: rnd }, 2) === 'INVALID_MOVE',
    'ходить до броска нельзя');
  assert(P.pos === 3, 'игрок остался там, где его застала проверка');
  assert(mv('actSearch')({ G, playerID: pid }, false) === 'INVALID_MOVE', 'искать до броска нельзя');
  assert(mv('adelEndPhase')({ G, playerID: '0', random: rnd }) === 'INVALID_MOVE',
    'и АДЕЛЬ свою фазу до броска не закрывает');

  mv('rollSpirit')({ G, playerID: pid, random: rnd });
  assert(G.pendingChecks.length === 0, 'после броска очередь пуста');
  assert(mv('finishTurn')({ G, playerID: pid, random: rnd }) !== 'INVALID_MOVE',
    'после броска ход завершается как обычно');
  assert(G.turnNo === turnBefore - 1, 'ход перещёлкнулся');
}

// ============================================================
// Фаза розыгрыша не двигается дальше, пока экипаж не бросил
// ============================================================
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  // Остальных уводим из огня: проверка в этом тесте должна быть ровно одна.
  Object.keys(G.players).forEach((p, i) => {
    Object.assign(G.players[p], { pos: 10 + i, inSpace: null, inventory: [], health: 0 });
  });
  const P = G.players[pid];
  P.pos = 4;
  G.board[4].hazards.fire = true;
  G.phase = 'adel';
  const rnd = dice(1);

  mv('adelEndPhase')({ G, playerID: '0', random: rnd });
  assert(G.phase === 'reveal', `до броска фаза остаётся розыгрышем, а не «${G.phase}»`);
  assert(G.pendingChecks.length === 1, 'опасность поставила проверку');
  assert(mv('claimActive')({ G, playerID: pid }) === 'INVALID_MOVE',
    'начать ход до броска нельзя — фазы действий ещё нет');

  mv('rollSpirit')({ G, playerID: pid, random: rnd });
  assert(G.phase === 'actions', `после броска фаза действий, а не «${G.phase}»`);
}

// ============================================================
// Бросать может только тот, чья проверка первая
// ============================================================
{
  const G = setupG();
  const [a, b] = Object.keys(G.players);
  const P = readyForAction(G, a);
  P.pos = 2;
  G.board[3].hazards.fire = true;
  const rnd = dice(6);
  mv('actMove')({ G, playerID: a, random: rnd }, 3);

  assert(mv('rollSpirit')({ G, playerID: b, random: rnd }) === 'INVALID_MOVE',
    'чужую проверку бросить нельзя');
  assert(mv('rollSpirit')({ G, playerID: '0', random: rnd }) === 'INVALID_MOVE',
    'и АДЕЛЬ за экипаж не бросает');
  assert(G.pendingChecks.length === 1, 'отклонённые попытки очередь не тронули');
  assert(G.players[a].health === 0, 'и последствий не наступило');

  mv('rollSpirit')({ G, playerID: a, random: rnd });
  assert(G.players[a].health === 1, 'свой бросок провален — рана получена');
}

// ============================================================
// Результат броска виден всем и годится для анимации
// ============================================================
{
  const G = setupG();
  const pid = pidOf(G, 'artem');           // дух 4
  const P = readyForAction(G, pid);
  P.pos = 2;
  G.board[3].hazards.fire = true;
  mv('actMove')({ G, playerID: pid, random: dice(5) }, 3);
  mv('rollSpirit')({ G, playerID: pid, random: dice(5) });

  const R = G.lastRoll;
  assert(R.pid === pid && R.die === 5 && R.target === 4, 'в результате есть игрок, грань и порог');
  assert(R.ok === false, '5 против 4 — провал');
  assert(R.seq === 1, 'у первого броска порядковый номер 1');
  assert(SPIRIT_REASONS[R.reason] === 'Пожар', 'причина расшифровывается для подписи');

  // Второй бросок обязан отличаться номером, иначе одинаковые результаты
  // подряд клиент примет за уже показанный и анимацию не проиграет.
  G.board[2].hazards.fire = true;
  P.plan.spent.move = 0;
  mv('actMove')({ G, playerID: pid, random: dice(5) }, 2);
  mv('rollSpirit')({ G, playerID: pid, random: dice(5) });
  assert(G.lastRoll.seq === 2, 'номер броска растёт');

  const view = Adel.playerView({ G, playerID: '0' });
  assert(view.lastRoll?.seq === 2, 'бросок виден и АДЕЛЬ — анимацию смотрят все');
  const spectator = Adel.playerView({ G, playerID: '9' });
  assert(spectator.lastRoll?.die === 5, 'и зрителю тоже');
}

// ============================================================
// Модификаторы порога — по одному на проверку
// ============================================================
const targetOf = (G, pid) => G.pendingChecks.find(c => c.pid === pid)?.target;
const modsOf = (G, pid) => (G.pendingChecks.find(c => c.pid === pid)?.modifiers || []).map(m => m.key);

// Порог без модификаторов — просто дух персонажа.
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid);
  P.pos = 2;
  G.board[3].hazards.fire = true;
  mv('actMove')({ G, playerID: pid, random: dice(1) }, 3);
  assert(targetOf(G, pid) === CHARACTERS.artem.spirit, 'без модификаторов порог равен духу');
  assert(modsOf(G, pid).length === 0, 'и расшифровывать нечего');
}
// Плюшевый мишка: +1.
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid);
  P.pos = 2; P.inventory = [{ id: 'teddy', faceUp: true }];
  G.board[3].hazards.fire = true;
  mv('actMove')({ G, playerID: pid, random: dice(1) }, 3);
  assert(targetOf(G, pid) === CHARACTERS.artem.spirit + 1, 'мишка поднимает порог на 1');
  assert(modsOf(G, pid).includes('teddy'), 'мишка назван в расшифровке');
}
// Неактивированный мишка не считается.
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid);
  P.pos = 2; P.inventory = [{ id: 'teddy', faceUp: false }];
  G.board[3].hazards.fire = true;
  mv('actMove')({ G, playerID: pid, random: dice(1) }, 3);
  assert(targetOf(G, pid) === CHARACTERS.artem.spirit, 'мишка лицом вниз не работает');
}
// Стресс: −1.
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid);
  P.pos = 2;
  G.eventOngoing = 'stress';
  G.board[3].hazards.fire = true;
  mv('actMove')({ G, playerID: pid, random: dice(1) }, 3);
  assert(targetOf(G, pid) === CHARACTERS.artem.spirit - 1, 'стресс опускает порог на 1');
  assert(modsOf(G, pid).includes('stress'), 'стресс назван в расшифровке');
}
// «Взрывы»: −2, и только против пожара.
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid);
  P.pos = 2;
  G.anomaliesActive = ['explosions'];
  G.board[3].hazards.fire = true;
  mv('actMove')({ G, playerID: pid, random: dice(1) }, 3);
  assert(targetOf(G, pid) === CHARACTERS.artem.spirit - 2, '«Взрывы» опускают порог на 2');
  assert(modsOf(G, pid).includes('explosions'), '«Взрывы» названы в расшифровке');
}
{
  // «Манёвр уклонения» — не пожар, и «Взрывы» на него не действуют.
  const G = setupG();
  G.anomaliesActive = ['explosions'];
  G.eventDeck.unshift({ id: 'maneuver', color: 'grey', uid: 990, cancelled: false });
  G.phase = 'actions';
  for (const p of Object.keys(G.players)) Object.assign(G.players[p], { acted: true, pendingDrop: 0 });
  const last = Object.keys(G.players)[0];
  G.players[last].acted = false; G.activeCrew = last;
  mv('finishTurn')({ G, playerID: last, random: dice(1) });

  const chk = G.pendingChecks.find(c => c.pid === last);
  assert(chk?.reason === 'maneuver', '«Манёвр уклонения» ставит проверку каждому');
  assert(!chk.modifiers.some(m => m.key === 'explosions'),
    '«Взрывы» не приплюсовываются к проверке, не связанной с пожаром');
  assert(chk.target === CHARACTERS[G.players[last].character].spirit,
    'порог «Манёвра» — чистый дух');
}
// Модификаторы складываются: мишка + стресс + взрывы.
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid);
  P.pos = 2; P.inventory = [{ id: 'teddy', faceUp: true }];
  G.eventOngoing = 'stress';
  G.anomaliesActive = ['explosions'];
  G.board[3].hazards.fire = true;
  mv('actMove')({ G, playerID: pid, random: dice(1) }, 3);
  assert(targetOf(G, pid) === CHARACTERS.artem.spirit + 1 - 1 - 2,
    `порог складывается из всех модификаторов, получено ${targetOf(G, pid)}`);
  assert(modsOf(G, pid).length === 3, 'в расшифровке все три источника');
}

// ============================================================
// «Манёвр уклонения»: очередь на всех, фаза стоит до последнего броска
// ============================================================
{
  const G = setupG();
  G.eventDeck.unshift({ id: 'maneuver', color: 'grey', uid: 991, cancelled: false });
  G.phase = 'actions';
  const crew = Object.keys(G.players);
  for (const p of crew) Object.assign(G.players[p], { acted: true, pendingDrop: 0, health: 0 });
  const last = crew[0];
  G.players[last].acted = false; G.activeCrew = last;
  const rnd = dice(6);

  mv('finishTurn')({ G, playerID: last, random: rnd });
  assert(G.pendingChecks.length === crew.length, 'проверку получает весь живой экипаж');
  assert(G.pendingChecks.map(c => c.pid).join(',') === crew.join(','),
    'порядок очереди — порядок игроков за столом, а не случайный');
  assert(G.phase !== 'planning', 'до бросков планирование не начинается');

  // бросаем не все — фаза обязана стоять
  mv('rollSpirit')({ G, playerID: G.pendingChecks[0].pid, random: rnd });
  assert(G.pendingChecks.length === crew.length - 1, 'очередь укоротилась на одну проверку');
  assert(G.phase !== 'planning', 'с непустой очередью фаза всё ещё стоит');

  for (let guard = 0; G.pendingChecks.length && !G.winner && guard < 10; guard++) {
    mv('rollSpirit')({ G, playerID: G.pendingChecks[0].pid, random: rnd });
  }
  assert(G.winner || G.phase === 'planning',
    `после последнего броска фаза двинулась дальше, а не «${G.phase}»`);
}

// ============================================================
// Рискованное спец. действие — два шага
// ============================================================
{
  // провал: кубики списаны, эффекта нет
  const G = setupG();
  const pid = pidOf(G, 'artem');           // дух 4, не Мэй — значит риск доступен
  const P = readyForAction(G, pid, { ...NO_CUBES, special: 4 });
  P.pos = 5;
  G.board[5].hazards.spy = true;
  const rnd = dice(6);                     // 6 против 4 — провал

  mv('actSpecial')({ G, playerID: pid, random: rnd }, { kind: 'clearHazard', hazard: 'spy', loc: 5, risky: true });
  assert(spentAll(P) === 2, `рискованный вариант стоит 2 кубика, потрачено ${spentAll(P)}`);
  assert(G.pendingChecks[0]?.reason === 'risky_special', 'проверка встала в очередь');
  assert(G.board[5].hazards.spy === true, 'до броска эффект не наступил');

  mv('rollSpirit')({ G, playerID: pid, random: rnd });
  assert(G.board[5].hazards.spy === true, 'при провале эффекта нет');
  assert(spentAll(P) === 2, 'кубики при провале не возвращаются');
  assert(G.pendingSpecial == null, 'отложенное действие снято');
  assert(G.log.some(l => l.includes('Спец. действие сорвалось')), 'провал объявлен в журнале');
}
{
  // успех: тот же ход доигрывается полностью
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, special: 4 });
  P.pos = 5;
  G.board[5].hazards.spy = true;
  const rnd = dice(3);                     // 3 против 4 — успех

  mv('actSpecial')({ G, playerID: pid, random: rnd }, { kind: 'clearHazard', hazard: 'spy', loc: 5, risky: true });
  assert(G.board[5].hazards.spy === true, 'эффект отложен до броска');
  mv('rollSpirit')({ G, playerID: pid, random: rnd });
  assert(G.board[5].hazards.spy === false, 'при успехе действие доигрывается');
  assert(spentAll(P) === 2, 'успех стоит те же 2 кубика');
}
{
  // незаконное действие отклоняется сразу: ни кубиков, ни броска
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, special: 4 });
  P.pos = 5;                               // фишки шпионажа здесь нет
  const r = mv('actSpecial')({ G, playerID: pid, random: dice(1) },
    { kind: 'clearHazard', hazard: 'spy', loc: 5, risky: true });
  assert(r === 'INVALID_MOVE', 'незаконное спец. действие отклонено');
  assert(spentAll(P) === 0, 'кубики за отклонённый ход не списаны');
  assert(G.pendingChecks.length === 0, 'и проверка не поставлена');
}
{
  // Мэй платит 2 кубика без проверки — риск ей не нужен
  const G = setupG();
  const pid = pidOf(G, 'mei');
  const P = readyForAction(G, pid, { ...NO_CUBES, special: 4 });
  P.pos = 5;
  G.board[5].hazards.spy = true;
  mv('actSpecial')({ G, playerID: pid, random: dice(6) }, { kind: 'clearHazard', hazard: 'spy', loc: 5 });
  assert(G.pendingChecks.length === 0, 'у Мэй спец. действие без проверки духа');
  assert(G.board[5].hazards.spy === false, 'и срабатывает сразу');
  assert(spentAll(P) === 2, 'Мэй платит 2 кубика');
}

// ============================================================
// Скрытая информация: что за действие отложено — тайна игрока
// ============================================================
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, special: 4 });
  P.pos = 5;
  P.inventory = [{ id: 'axe', faceUp: false }];
  G.missions.markers.blue_card = { loc: 5, revealed: false };
  mv('actSpecial')({ G, playerID: pid, random: dice(1) },
    { kind: 'deliver', itemId: 'axe', risky: true });
  assert(G.pendingSpecial?.payload.itemId === 'axe', 'движок помнит, что именно отложено');

  const adelView = Adel.playerView({ G, playerID: '0' });
  assert(adelView.pendingChecks.length === 1, 'сама проверка видна всем: понятно, чей бросок');
  assert(adelView.pendingChecks[0].context.itemId === undefined,
    'но в проверке нет ни предмета, ни локации');
  assert(adelView.pendingSpecial?.payload === undefined,
    'АДЕЛЬ не видит, подо что игрок бросает: неудачная доставка не разглашается');
  assert(JSON.stringify(adelView).includes('axe') === false,
    'название предмета не утекает через состояние целиком');

  const mine = Adel.playerView({ G, playerID: pid });
  assert(mine.pendingSpecial?.payload.itemId === 'axe', 'себе игрок видит, что он отложил');
}

// ============================================================
// Партия, сохранённая до появления очереди, не должна быть мёртвой
// ============================================================
// Сервер поднимает партии с диска. У сохранённых раньше нет ни pendingChecks,
// ни steps — и без дописывания этих полей падал ЛЮБОЙ ход: кнопки нажимаются,
// на экране ничего не происходит, причины не видно. Проверено на живой партии.
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  readyForAction(G, pid, { ...NO_CUBES, move: 4 });
  G.players[pid].pos = 2;
  // Ровно то, что лежит в файле старой партии.
  delete G.pendingChecks; delete G.steps; delete G.rollSeq;
  delete G.lastRoll; delete G.pendingSpecial;

  const r = mv('actMove')({ G, playerID: pid, random: dice(1) }, 3);
  assert(r !== 'INVALID_MOVE', 'ход в старой партии проходит, а не отклоняется');
  assert(G.players[pid].pos === 3, 'и действительно исполняется');
  assert(Array.isArray(G.pendingChecks) && Array.isArray(G.steps),
    'недостающие поля дописаны на месте');
  assert(G.rollSeq === 0 && G.lastRoll === null, 'счётчик бросков начат с нуля');

  // И проверка духа в такой партии работает как обычно.
  const G2 = setupG();
  const pid2 = pidOf(G2, 'artem');
  readyForAction(G2, pid2, { ...NO_CUBES, move: 4 });
  G2.players[pid2].pos = 2;
  G2.board[3].hazards.fire = true;
  delete G2.pendingChecks; delete G2.steps; delete G2.rollSeq;
  mv('actMove')({ G: G2, playerID: pid2, random: dice(6) }, 3);
  assert(G2.pendingChecks.length === 1, 'пожар ставит проверку и в поднятой с диска партии');
  mv('rollSpirit')({ G: G2, playerID: pid2, random: dice(6) });
  assert(G2.players[pid2].health === 1, 'бросок разыгрывается, рана приходит');
  assert(G2.lastRoll?.seq === 1, 'и результат готов к показу');
}

if (failed) { console.error(`\nSPIRIT: провалено проверок — ${failed}`); process.exit(1); }
console.log('SPIRIT OK ✓');
