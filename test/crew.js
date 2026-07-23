// Правила экипажа, сверенные с буклетом: тьма — налог только внутри локации
// (решение владельца, отличается от буклета), огнетушитель, перегруз инвентаря
// с выбором предмета, показ маркеров только при встрече, предел подглядываний
// АДЕЛЬ, стопка предметов в локации, запас жетонов повреждений и состав партии
// на двух членов экипажа.
import { Adel, redBlocked } from '../src/game/index.js';
import {
  HAZARDS, CHARACTERS, DAMAGE_TOKENS, CREW_SIZES, MIN_TABLE, MAX_TABLE,
  markerAssignments, turnsFor, MARKER_SLOTS, chipsPerTurn,
} from '../src/game/data.js';

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

function clearBoard(G) {
  for (let l = 1; l <= 20; l++) {
    const L = G.board[l];
    L.damage = false; L.computerLocked = false; L.terminalLocked = false;
    L.doors = []; L.hatchClosed = false; L.batteryGuard = false;
    for (const h of HAZARDS) L.hazards[h] = false;
  }
}

// Тихая колода событий: точечные проверки не должны зависеть от того, какое
// событие вытянулось в конце хода.
function stackSilence(G, n) {
  G.eventDeck = Array.from({ length: n }, (_, i) =>
    ({ id: 'silence', color: 'grey', uid: 800 + i, cancelled: false }));
}

const setupG = (numPlayers = 4) => {
  const G = Adel.setup({ ctx: { numPlayers }, random: makeRandom() });
  clearBoard(G);
  return G;
};
const mv = (name) => Adel.moves[name].move;
const pidOf = (G, charId) => Object.keys(G.players).find(p => G.players[p].character === charId);
const NO_CUBES = { move: 0, search: 0, activate: 0, special: 0, door: 0 };

function readyForAction(G, pid, plan = { ...NO_CUBES, special: 4 }) {
  G.phase = 'actions';
  G.activeCrew = pid;
  const P = G.players[pid];
  P.plan = { ...plan, spent: { ...NO_CUBES } };
  P.acted = false; P.bonusCubes = 0; P.inSpace = null; P.pendingDrop = 0;
  return P;
}
const spent = (P) => Object.values(P.plan.spent).reduce((a, b) => a + b, 0);

// Прокрутить фазу конца хода через обычный ход движка.
function endTurn(G, random = makeRandom()) {
  G.phase = 'actions';
  const pids = Object.keys(G.players);
  for (const pid of pids) {
    Object.assign(G.players[pid], { acted: true, pendingLabPick: false, pendingMedkit: 0, pendingDrop: 0 });
  }
  const last = pids[0];
  G.players[last].acted = false;
  G.activeCrew = last;
  mv('finishTurn')({ G, playerID: last, random });
}

// ============================================================
// Тьма: налог только внутри локации (решение владельца, отличается от буклета).
// +1 кубик стоят действия СТОЯ в тьме и движение ИЗ неё. ВХОД в тёмную локацию
// снаружи — обычная цена, 1 кубик.
// ============================================================
{
  // выход из тёмной локации — один лишний кубик
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, move: 4 });
  P.pos = 2;
  G.board[2].hazards.darkness = true;
  mv('actMove')({ G, playerID: pid, random: makeRandom() }, 3);
  assert(P.pos === 3, 'игрок вышел из тёмной локации');
  assert(spent(P) === 2, `выход из тьмы стоит 2 кубика, потрачено ${spent(P)}`);
}
{
  // вход в тёмную локацию снаружи — обычная цена, налога нет
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, move: 4 });
  P.pos = 2;
  G.board[3].hazards.darkness = true;
  mv('actMove')({ G, playerID: pid, random: makeRandom() }, 3);
  assert(P.pos === 3, 'игрок вошёл в тёмную локацию');
  assert(spent(P) === 1, `вход во тьму — обычная цена 1 кубик, потрачено ${spent(P)}`);
}
{
  // из тьмы во тьму: выход из первой +1, вход во вторую без налога → всего 2
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, move: 4 });
  P.pos = 2;
  G.board[2].hazards.darkness = true;
  G.board[3].hazards.darkness = true;
  mv('actMove')({ G, playerID: pid, random: makeRandom() }, 3);
  assert(P.pos === 3, 'переход между двумя тёмными локациями состоялся');
  assert(spent(P) === 2, `переход тьма→тьма стоит 2 кубика (выход +1, вход без налога), потрачено ${spent(P)}`);
}
{
  // одного кубика на ВЫХОД из тьмы не хватает (а на вход — хватило бы)
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, move: 1 });
  P.pos = 2;
  G.board[2].hazards.darkness = true;   // стоим в тьме — выход стоит 2
  const r = mv('actMove')({ G, playerID: pid, random: makeRandom() }, 3);
  assert(r === 'INVALID_MOVE', 'без лишнего кубика из тьмы не выйти');
  assert(P.pos === 2, 'игрок остался на месте');
}
{
  // одного кубика хватает на ВХОД в тьму — налога на входе нет
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, move: 1 });
  P.pos = 2;
  G.board[3].hazards.darkness = true;   // тьма только в цели
  mv('actMove')({ G, playerID: pid, random: makeRandom() }, 3);
  assert(P.pos === 3, 'на вход в тьму хватает одного кубика');
  assert(spent(P) === 1, `вход во тьму стоит 1 кубик, потрачено ${spent(P)}`);
}
{
  // пожар в локации, где СТОИТ игрок, отменяет тьму — выход не дорожает
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, move: 4 });
  P.pos = 2;
  P.inventory = [];
  G.board[2].hazards.darkness = true;
  G.board[2].hazards.fire = true;
  mv('actMove')({ G, playerID: pid, random: makeRandom() }, 3);
  assert(spent(P) === 1, `при пожаре в своей локации тьма не работает, потрачено ${spent(P)}`);
}
{
  // фонарь снимает тьму — выход из тёмной локации не дорожает
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, move: 4 });
  P.pos = 2;
  P.inventory = [{ id: 'flashlight', faceUp: true, charge: 2 }];
  G.board[2].hazards.darkness = true;
  G.board[3].hazards.darkness = true;
  mv('actMove')({ G, playerID: pid, random: makeRandom() }, 3);
  assert(spent(P) === 1, `с фонарём переход стоит 1 кубик, потрачено ${spent(P)}`);
}

// ============================================================
// Передача предметов — только через терминал доставки (решение владельца,
// отличается от буклета). Передачи при встрече в одной локации больше нет;
// показ маркеров и предметов (shareInfo) остаётся.
// ============================================================
{
  // giveItem удалён из движка: колокация предметы не передаёт
  assert(!Adel.moves.giveItem, 'ход giveItem удалён — передачи при встрече нет');
}
{
  // единственный способ передать — спец. действие на терминале доставки (лок. 5)
  const G = setupG();
  const [a, b] = Object.keys(G.players);
  const Pa = readyForAction(G, a, { ...NO_CUBES, special: 4 });
  Pa.pos = 5; Pa.inventory = [{ id: 'lens', faceUp: false }];
  const Pb = G.players[b]; Pb.pos = 5; Pb.inSpace = null; Pb.inventory = [];
  const r = mv('actSpecial')({ G, playerID: a, random: makeRandom() },
    { kind: 'terminal', targetPid: b, invIndex: 0, direction: 'give' });
  assert(r !== 'INVALID_MOVE', 'терминал доставки передаёт предмет');
  assert(Pb.inventory.some(it => it.id === 'lens'), 'предмет у получателя');
  assert(!Pa.inventory.some(it => it.id === 'lens'), 'предмет ушёл от отправителя');
}
{
  // shareInfo при встрече по-прежнему работает — показ, а не передача
  const G = setupG();
  const [a, b] = Object.keys(G.players);
  const Pa = readyForAction(G, a, { ...NO_CUBES, move: 4 });
  Pa.pos = 7; const Pb = G.players[b]; Pb.pos = 7; Pb.inSpace = null;
  const r = mv('shareInfo')({ G, playerID: a }, b, true);
  assert(r !== 'INVALID_MOVE', 'показ маркеров/предметов при встрече остался');
  assert(G.missions.shares[`${a}->${b}`] === 7, 'показ зафиксирован');
}

// ============================================================
// Огнетушитель
// ============================================================
{
  // активация в горящей локации тушит пожар сразу же
  const G = setupG();
  const pid = pidOf(G, 'mei');
  const P = readyForAction(G, pid, { ...NO_CUBES, activate: 4 });
  P.pos = 7;
  P.inventory = [{ id: 'extinguisher', faceUp: false }];
  G.board[7].hazards.fire = true;
  mv('actActivate')({ G, playerID: pid, random: makeRandom() }, 0);
  assert(G.board[7].hazards.fire === false, 'огнетушитель гасит пожар в своей локации');
  assert(P.inventory[0].uses === 2, `истрачен один заряд, осталось ${P.inventory[0].uses}`);
  assert(G.adel.chipDiscard.includes('fire'), 'снятая фишка ушла в сброс АДЕЛЬ');
}
{
  // огнетушитель действует до конца хода, а не вечно
  const G = setupG();
  const pid = pidOf(G, 'mei');
  const P = readyForAction(G, pid, { ...NO_CUBES, activate: 4 });
  P.pos = 7;
  P.inventory = [{ id: 'extinguisher', faceUp: false }];
  mv('actActivate')({ G, playerID: pid, random: makeRandom() }, 0);
  assert(P.inventory[0].used === true, 'активированный огнетушитель помечен как истраченный за ход');

  for (const p of Object.keys(G.players)) Object.assign(G.players[p], { acted: true, pendingDrop: 0 });
  G.players[pid].acted = false;
  G.activeCrew = pid;
  mv('finishTurn')({ G, playerID: pid, random: makeRandom() });
  assert(!G.players[pid].inventory.some(it => it.id === 'extinguisher'),
    'в конце хода огнетушитель сброшен');
}
{
  // при входе в пожар огнетушитель срабатывает раньше проверки духа
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, move: 4 });
  P.pos = 2; P.health = 0;
  P.inventory = [{ id: 'extinguisher', faceUp: true, uses: 3 }];
  G.board[3].hazards.fire = true;
  const rnd = makeRandom(); rnd.D6 = () => 6;   // проверка духа была бы провалена
  mv('actMove')({ G, playerID: pid, random: rnd }, 3);
  assert(G.board[3].hazards.fire === false, 'пожар потушен при входе');
  assert(G.players[pid].health === 0, 'раны нет: до проверки духа дело не дошло');
}

// ============================================================
// Перегруз инвентаря: предмет выбирает игрок
// ============================================================
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, search: 4 });
  P.pos = 5;
  P.inventory = ['teddy', 'medkit', 'parts', 'stims'].map(id => ({ id, faceUp: false }));
  G.board[5].items = [{ id: 'axe', faceUp: false }];

  mv('actSearch')({ G, playerID: pid }, true);
  assert(P.inventory.length === 5, 'предмет взят сверх грузоподъёмности');
  assert(P.pendingDrop === 1, 'движок требует сбросить один предмет');

  const blocked = mv('actSearch')({ G, playerID: pid }, false);
  assert(blocked === 'INVALID_MOVE', 'до сброса лишнего действовать нельзя');
  const noFinish = mv('finishTurn')({ G, playerID: pid, random: makeRandom() });
  assert(noFinish === 'INVALID_MOVE', 'до сброса лишнего нельзя завершить ход');

  // сбрасываем именно тот предмет, который назвали
  const idx = P.inventory.findIndex(it => it.id === 'stims');
  mv('dropItem')({ G, playerID: pid, random: makeRandom() }, idx);
  assert(P.pendingDrop === 0, 'перегруз разобран');
  assert(!P.inventory.some(it => it.id === 'stims'), 'сброшен выбранный предмет');
  assert(P.inventory.some(it => it.id === 'axe'), 'нужный предмет остался в инвентаре');
  assert(G.board[5].items.some(it => it.id === 'stims'), 'сброшенное лежит в локации');
  assert(mv('actSearch')({ G, playerID: pid }, false) !== 'INVALID_MOVE',
    'после сброса действия снова доступны');
}
{
  // рана, отнимающая ячейку, тоже создаёт долг по сбросу
  const G = setupG();
  const pid = pidOf(G, 'artem');           // теряет ячейку на 2-й ране
  const P = readyForAction(G, pid, { ...NO_CUBES, move: 4 });
  P.pos = 2; P.health = 1; P.invBlocked = 0;
  P.inventory = ['teddy', 'medkit', 'parts', 'stims'].map(id => ({ id, faceUp: false }));
  G.board[3].hazards.fire = true;
  const rnd = makeRandom(); rnd.D6 = () => 6;
  mv('actMove')({ G, playerID: pid, random: rnd }, 3);
  mv('rollSpirit')({ G, playerID: pid, random: rnd });   // проверку бросает сам игрок
  assert(P.health === 2, 'рана получена');
  assert(P.invBlocked === 1, 'ячейка инвентаря заблокирована');
  assert(P.pendingDrop === 1, 'из-за раны надо сбросить предмет');
}
{
  // сбросить скафандр в открытом космосе — смерть
  const G = setupG();
  const pid = pidOf(G, 'mei');
  const P = readyForAction(G, pid, { ...NO_CUBES });
  P.inSpace = 'A';
  P.inventory = [{ id: 'suit', faceUp: true, charge: 2 }, { id: 'teddy', faceUp: false }];
  P.pendingDrop = 1;
  mv('dropItem')({ G, playerID: pid, random: makeRandom() }, 0);
  assert(P.dead === true, 'без скафандра в космосе член экипажа погибает');
  assert(G.winner === 'adel', 'это победа АДЕЛЬ');
}

// ============================================================
// Показ маркеров и предметов — только при встрече
// ============================================================
{
  const G = setupG();
  const [a, b] = Object.keys(G.players);
  const P = readyForAction(G, a, { ...NO_CUBES, move: 4 });
  P.pos = 2;
  G.players[b].pos = 2; G.players[b].inSpace = null;

  mv('shareInfo')({ G, playerID: a }, b, true);
  assert(G.missions.shares[`${a}->${b}`] === 2, 'показ объявлен');

  mv('actMove')({ G, playerID: a, random: makeRandom() }, 3);
  assert(G.missions.shares[`${a}->${b}`] === undefined,
    'уход из локации прекращает показ — после новой встречи его объявляют заново');
}
{
  // показать маркеры можно только тому, кто стоит рядом
  const G = setupG();
  const [a, b] = Object.keys(G.players);
  const P = readyForAction(G, a, { ...NO_CUBES, move: 4 });
  P.pos = 2;
  G.players[b].pos = 9; G.players[b].inSpace = null;

  const far = mv('shareInfo')({ G, playerID: a }, b, true);
  assert(far === 'INVALID_MOVE', 'из другой локации показать маркеры нельзя');
  assert(G.missions.shares[`${a}->${b}`] === undefined, 'показ не записан');

  // и тому, кто вышел в открытый космос, — тоже нельзя
  G.players[b].pos = 2; G.players[b].inSpace = 'A';
  const space = mv('shareInfo')({ G, playerID: a }, b, true);
  assert(space === 'INVALID_MOVE', 'показать маркеры ушедшему в космос нельзя');

  // а рядом — можно
  G.players[b].inSpace = null;
  const near = mv('shareInfo')({ G, playerID: a }, b, true);
  assert(near !== 'INVALID_MOVE', 'в одной локации показ разрешён');
  assert(G.missions.shares[`${a}->${b}`] === 2, 'показ записан с локацией встречи');
}
{
  // выход в космос тоже прекращает показ
  const G = setupG();
  const [a, b] = Object.keys(G.players);
  const P = readyForAction(G, a, { ...NO_CUBES, move: 4 });
  P.pos = 13;
  P.inventory = [{ id: 'suit', faceUp: true, charge: 2 }];
  G.players[b].pos = 13; G.players[b].inSpace = null;
  mv('shareInfo')({ G, playerID: a }, b, true);
  mv('actMove')({ G, playerID: a, random: makeRandom() }, 'A');
  assert(G.players[a].inSpace === 'A', 'игрок вышел в космос');
  assert(G.missions.shares[`${a}->${b}`] === undefined, 'показ прекращён выходом в космос');
}

// ============================================================
// Шпионаж: одно подглядывание за ход на игрока
// ============================================================
{
  const G = setupG();
  const target = Object.keys(G.players)[0];
  const slot = MARKER_SLOTS.find(s => G.missions.viewers[s].includes(target));
  G.players[target].inSpace = null;
  G.board[G.players[target].pos].hazards.spy = true;

  G.phase = 'adel';
  const early = mv('adelSpyMarker')({ G, playerID: '0', random: makeRandom() }, target, slot);
  assert(early === 'INVALID_MOVE', 'до раскрытия планов подглядывать нечего');

  G.phase = 'actions';
  const first = mv('adelSpyMarker')({ G, playerID: '0', random: makeRandom() }, target, slot);
  assert(first !== 'INVALID_MOVE', 'первое подглядывание проходит');
  assert(G.adel.spyNotes.length === 1, 'заметка записана');

  const second = mv('adelSpyMarker')({ G, playerID: '0', random: makeRandom() }, target, slot);
  assert(second === 'INVALID_MOVE', 'второе подглядывание за тот же ход отклонено');
  assert(G.adel.spyNotes.length === 1, 'вторая заметка не появилась');

  // новый ход — снова можно
  G.adel.spiedThisTurn = [];
  const nextTurn = mv('adelSpyMarker')({ G, playerID: '0', random: makeRandom() }, target, slot);
  assert(nextTurn !== 'INVALID_MOVE', 'в новом ходу подглядывание снова доступно');
}
{
  // без фишки шпионажа в локации подглядывать нельзя
  const G = setupG();
  const target = Object.keys(G.players)[0];
  const slot = MARKER_SLOTS.find(s => G.missions.viewers[s].includes(target));
  G.phase = 'actions';
  G.players[target].inSpace = null;
  const r = mv('adelSpyMarker')({ G, playerID: '0', random: makeRandom() }, target, slot);
  assert(r === 'INVALID_MOVE', 'без фишки «шпионаж» подглядывание невозможно');
}

// ============================================================
// Стопка предметов в локации
// ============================================================
{
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, search: 4 });
  P.pos = 5;
  P.inventory = [];
  G.board[5].items = [{ id: 'axe', faceUp: false }, { id: 'lens', faceUp: false }, { id: 'teddy', faceUp: false }];

  mv('actSearch')({ G, playerID: pid }, false);
  assert(Array.isArray(P.knownItems[5]) && P.knownItems[5].length === 3,
    'осмотр показывает всю стопку локации');
  assert(G.board[5].items.length === 3, 'осмотр ничего не забирает');

  // забрать можно любой предмет стопки, не только верхний
  mv('actSearch')({ G, playerID: pid }, 0);
  assert(P.inventory.length === 1 && P.inventory[0].id === 'axe', 'забран выбранный предмет');
  assert(G.board[5].items.length === 2, 'в локации осталось два предмета');
  assert(!G.board[5].items.some(it => it.id === 'axe'), 'забранного предмета в локации нет');

  const bad = mv('actSearch')({ G, playerID: pid }, 9);
  assert(bad === 'INVALID_MOVE', 'номер за пределами стопки отклоняется');
}
{
  // «Поиск» — одно действие: посмотрел жетон и решил, брать его или нет.
  // Взятие сразу после осмотра второго кубика стоить не должно.
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, search: 4 });
  P.pos = 5; P.inventory = [];
  G.board[5].items = [{ id: 'axe', faceUp: false }, { id: 'teddy', faceUp: false }];

  mv('actSearch')({ G, playerID: pid }, false);
  assert(spent(P) === 1, `осмотр стоит один кубик, потрачено ${spent(P)}`);
  assert(P.pendingTake === 5, 'движок ждёт решения — брать или оставить');

  mv('actSearch')({ G, playerID: pid }, 0);
  assert(spent(P) === 1, `взятие после осмотра бесплатно, всего потрачено ${spent(P)}`);
  assert(P.inventory.length === 1 && P.inventory[0].id === 'axe', 'забран выбранный предмет');
  assert(P.pendingTake === null, 'предложение использовано');

  // второй предмет из той же стопки — уже новый поиск
  mv('actSearch')({ G, playerID: pid }, 0);
  assert(spent(P) === 2, `следующее взятие — это новый поиск, потрачено ${spent(P)}`);
}
{
  // От находки можно отказаться, и это ничего не стоит
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, search: 4 });
  P.pos = 5; P.inventory = [];
  G.board[5].items = [{ id: 'teddy', faceUp: false }];

  mv('actSearch')({ G, playerID: pid }, false);
  mv('leaveItem')({ G, playerID: pid });
  assert(spent(P) === 1, `отказ ничего не стоит, потрачено ${spent(P)}`);
  assert(P.inventory.length === 0, 'предмет не взят');
  assert(G.board[5].items.length === 1, 'предмет остался в локации');
  assert(P.pendingTake === null, 'предложение закрыто');
  assert(Array.isArray(P.knownItems[5]), 'но осмотренное игрок помнит');

  // отказываться нечего — ход отклоняется
  const again = mv('leaveItem')({ G, playerID: pid });
  assert(again === 'INVALID_MOVE', 'без осмотренной находки отказываться не от чего');
}
{
  // Предложение живёт «здесь и сейчас»: ушёл — и оно пропало.
  const G = setupG();
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, search: 2, move: 2 });
  P.pos = 2; P.inventory = [];
  G.board[2].items = [{ id: 'teddy', faceUp: false }];
  G.board[3].items = [{ id: 'axe', faceUp: false }];

  mv('actSearch')({ G, playerID: pid }, false);
  assert(P.pendingTake === 2, 'локация осмотрена');
  mv('actMove')({ G, playerID: pid, random: makeRandom() }, 3);
  assert(P.pendingTake === null, 'после ухода бесплатно взять уже нечего');

  mv('actSearch')({ G, playerID: pid }, 0);
  assert(spent(P) === 3, `в новой локации поиск снова стоит кубик, потрачено ${spent(P)}`);
  assert(P.inventory[0].id === 'axe', 'взят предмет новой локации');
}
{
  // чужая карта находок остаётся чужой, а своя видна
  const G = setupG();
  const [a, b] = Object.keys(G.players);
  G.players[a].knownItems = { 5: ['axe', 'lens'] };
  const own = Adel.playerView({ G, playerID: a });
  assert(own.players[a].knownItems['5'].length === 2, 'свою карту находок игрок видит');
  const other = Adel.playerView({ G, playerID: b });
  assert(Object.keys(other.players[a].knownItems).length === 0, 'чужая карта находок закрыта');
}

// ============================================================
// Запас жетонов повреждений
// ============================================================
{
  const G = setupG();
  for (const l of [1, 2, 3, 4]) G.board[l].damage = true;
  const before = Object.values(G.board).filter(L => L.damage).length;
  assert(before === DAMAGE_TOKENS, 'на поле все четыре жетона повреждений');

  G.eventDeck.unshift({ id: 'collision', color: 'green', uid: 999, cancelled: false });
  for (const p of Object.keys(G.players)) {
    Object.assign(G.players[p], { acted: true, pendingLabPick: false, pendingMedkit: 0, pendingDrop: 0 });
  }
  const last = Object.keys(G.players)[0];
  G.players[last].acted = false;
  G.phase = 'actions'; G.activeCrew = last;
  mv('finishTurn')({ G, playerID: last, random: makeRandom() });

  const after = Object.values(G.board).filter(L => L.damage).length;
  assert(after === DAMAGE_TOKENS, `жетонов повреждений ${after}, больше ${DAMAGE_TOKENS} быть не может`);
}

// ============================================================
// Запас фишек АДЕЛЬ
// ============================================================
{
  // Фишки, выданные при раскладке, — это запас первого хода, а не добавка
  // к нему: к своей первой фазе АДЕЛЬ должна прийти с тремя фишками, а не с
  // шестью. Пополнение начинается со второго хода.
  const G = setupG(3);
  const onConsole = () => Object.values(G.adel.console).reduce((s, r) => s + r.length, 0);
  const perTurn = chipsPerTurn(3);
  assert(onConsole() === perTurn, `после раскладки на консоли ${onConsole()} фишек, ожидалось ${perTurn}`);

  const random = makeRandom();
  for (const pid of Object.keys(G.players)) {
    mv('commitPlan')({ G, playerID: pid, random }, { ...NO_CUBES, move: 4 });
  }
  assert(G.phase === 'adel', 'началась фаза АДЕЛЬ');
  assert(onConsole() === perTurn,
    `к первой фазе АДЕЛЬ на консоли ${onConsole()} фишек, ожидалось ${perTurn}`);

  // Второй ход — уже с пополнением.
  mv('adelEndPhase')({ G, playerID: '0', random });
  endTurn(G, random);
  for (const pid of Object.keys(G.players)) {
    if (G.players[pid].dead) continue;
    mv('commitPlan')({ G, playerID: pid, random }, { ...NO_CUBES, move: 4 });
  }
  assert(onConsole() > perTurn,
    `на втором ходу консоль пополняется, фишек ${onConsole()}`);
}

// ============================================================
// Точка невозврата и окно красной миссии
// ============================================================
{
  // Точка невозврата двигается ТОЛЬКО событием «Дрейф» (решение владельца,
  // возврат к буклету): ежеходного сдвига больше нет.
  const G = setupG(3);
  assert(G.pointOfNoReturn === 1, 'партия начинается с первого деления');
  const turn0 = G.turnNo;

  stackSilence(G, 6);
  endTurn(G);
  assert(G.turnNo === turn0 - 1, 'жетон хода сдвинулся на одно деление');
  assert(G.pointOfNoReturn === 1, `обычный ход точку не двигает, осталось ${G.pointOfNoReturn}`);

  G.eventDeck.unshift({ id: 'drift', color: 'grey', uid: 900, cancelled: false });
  endTurn(G);
  assert(G.pointOfNoReturn === 2, `«Дрейф» двигает точку на 1, стало ${G.pointOfNoReturn}`);

  // Отменённый терминалом тревоги «Дрейф» точку не двигает.
  G.eventDeck.unshift({ id: 'drift', color: 'grey', uid: 901, cancelled: true });
  endTurn(G);
  assert(G.pointOfNoReturn === 2, `отменённый «Дрейф» точку не двигает, осталось ${G.pointOfNoReturn}`);
}
{
  // Когда точка невозврата обгоняет жетон хода, красная миссия закрыта:
  // сбежать уже не успеть, даже если все предметы доставлены.
  const G = setupG();                          // состав на четверых: в игре все трое
  const pid = pidOf(G, 'artem');
  const P = readyForAction(G, pid, { ...NO_CUBES, special: 4 });
  P.pos = 16;                                  // финал красной миссии
  P.inventory = [{ id: 'helmet', faceUp: false }];
  G.missions.delivered = { chipItem: true, toolbox: true, lens: true };
  G.eventOngoing = null;

  G.turnNo = 5; G.pointOfNoReturn = 6;
  assert(redBlocked(G) === true, 'точка обогнала жетон хода — миссия закрыта');
  mv('actSpecial')({ G, playerID: pid, random: makeRandom() }, { kind: 'deliver', itemId: 'helmet' });
  assert(G.winner === null, 'побег не удался: точка невозврата пройдена');
  assert(G.privateLog[pid].at(-1).includes('условия красной миссии'),
    'игроку объяснили причину лично');

  // Командный терминал отыгрывает одно деление назад — и побег снова возможен.
  P.plan.spent.special = 0;
  G.pointOfNoReturn = 6;
  P.pos = 1;                                   // командный терминал
  mv('actSpecial')({ G, playerID: pid, random: makeRandom() }, { kind: 'terminal' });
  assert(G.pointOfNoReturn === 5, `командный терминал вернул точку на ${G.pointOfNoReturn}`);
  assert(redBlocked(G) === false, 'равенство — миссия снова открыта');

  P.plan.spent.special = 0;
  P.pos = 16;
  mv('actSpecial')({ G, playerID: pid, random: makeRandom() }, { kind: 'deliver', itemId: 'helmet' });
  assert(G.winner === 'crew', 'на равенстве побег удаётся');
}

// ============================================================
// Состав партии: АДЕЛЬ + 2 и АДЕЛЬ + 3
// ============================================================
{
  assert(CREW_SIZES.join(',') === '2,3', `поддержаны составы экипажа ${CREW_SIZES.join(', ')}`);
  assert(MIN_TABLE === 3 && MAX_TABLE === 4, 'за столом от трёх до четырёх игроков');
  assert(Adel.minPlayers === MIN_TABLE && Adel.maxPlayers === MAX_TABLE,
    'движок объявляет тот же диапазон игроков');
  assert(turnsFor(3) === 18, 'на троих даётся 18 ходов');
  assert(turnsFor(4) === 15, 'на четверых — 15 ходов');
}
{
  // Партия на двух членов экипажа: каждый знает по одному предмету синей и
  // красной миссии, локацию линзы знают оба.
  const G = setupG(3);
  assert(Object.keys(G.players).length === 2, 'в экипаже двое');
  assert(G.turnNo === 18, `на двоих в экипаже 18 ходов, получено ${G.turnNo}`);

  const v = G.missions.viewers;
  assert(v.lens.length === 2, 'локацию линзы знают оба члена экипажа');
  for (const slot of ['blue_card', 'id_badge', 'chipItem', 'toolbox']) {
    assert(v[slot].length === 1, `«${slot}» известен ровно одному игроку`);
  }
  const [a, b] = Object.keys(G.players);
  const blueOf = (pid) => ['blue_card', 'id_badge'].filter(s => v[s].includes(pid)).length;
  const redOf = (pid) => ['chipItem', 'toolbox'].filter(s => v[s].includes(pid)).length;
  assert(blueOf(a) === 1 && redOf(a) === 1, 'первый знает по одному предмету каждой миссии');
  assert(blueOf(b) === 1 && redOf(b) === 1, 'второй знает по одному предмету каждой миссии');

  // «Тишина» остаётся в колоде: её убирают только при игре вчетвером и впятером
  const inPlay = [...G.eventDeck, G.currentEvent];
  assert(inPlay.some(c => c.id === 'silence'), 'при трёх игроках «Тишина» остаётся в колоде');
  assert(inPlay.length === 25, `в игре ${inPlay.length} карт событий, ожидалось 25`);
}
{
  // Локацию линзы видят оба, а чужие маркеры — нет
  const G = setupG(3);
  const [a, b] = Object.keys(G.players);
  for (const pid of [a, b]) {
    const V = Adel.playerView({ G, playerID: pid });
    assert(V.missions.markers.lens.loc != null, `игрок ${pid} видит локацию линзы`);
  }
  const va = Adel.playerView({ G, playerID: a });
  const hidden = MARKER_SLOTS.filter(s => va.missions.markers[s].loc == null).length;
  assert(hidden === 2, `от игрока скрыты два чужих маркера, скрыто ${hidden}`);
  const adelView = Adel.playerView({ G, playerID: '0' });
  assert(MARKER_SLOTS.every(s => adelView.missions.markers[s].loc == null),
    'АДЕЛЬ не видит ни одного маркера');
}
{
  // Стартовые позиции: d20 перебрасывается до свободной локации, но цикл
  // обязан быть ограничен. Это серверный код: вырожденный генератор (а такой
  // легко получить и в тестах, и при неудачной замене random) подвесил бы
  // не партию, а весь процесс.
  const stuck = { Number: () => 0.5, D6: () => 1, Die: () => 7, Shuffle: (a) => [...a] };
  const started = Date.now();
  const G = Adel.setup({ ctx: { numPlayers: 4 }, random: stuck });
  assert(Date.now() - started < 2000, 'раскладка не зависает на вырожденном генераторе');

  const positions = Object.values(G.players).map(p => p.pos);
  assert(positions.length === 3, 'все трое расставлены');
  assert(new Set(positions).size === positions.length,
    `стартовые локации различны, получено ${positions.join(', ')}`);
  assert(positions.every(l => l >= 1 && l <= 20), 'все позиции — настоящие локации');
}
{
  // таблицы маркеров есть только для поддержанных составов
  for (const n of CREW_SIZES) assert(markerAssignments(n), `таблица для ${n} членов экипажа есть`);
  let threw = false;
  try { markerAssignments(4); } catch { threw = true; }
  assert(threw, 'для неподдержанного состава движок падает понятной ошибкой');
}

if (failed) { console.error(`\nCREW: провалено проверок — ${failed}`); process.exit(1); }
console.log('CREW OK ✓');
