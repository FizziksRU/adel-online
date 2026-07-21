const INVALID_MOVE = 'INVALID_MOVE'; // значение из boardgame.io/core (без импорта — для чистого Node ESM)
import {
  ADJ, SECTOR_OF, TERMINALS, LAB_LOC, BLUE_FINAL_LOC, RED_FINAL_LOC, ALARM_START,
  HATCHES, SPACE_ADJ, SPACE_NEAR, CHARACTERS, ITEMS, LAB_STACK,
  randomPool, BOARD_FIXED, RANDOM_DRAW,
  HAZARDS, HAZARD_NAMES, BAG_COUNTS, CONSOLE_COSTS, CONSOLE_LAYOUT,
  CUBE_ACTIONS, ACTION_NAMES,
  EVENTS, EVENT_DECK,
  ADEL_CARDS, ADEL_SPECIALS, ANOMALIES, ANOMALY_COST, MARKER_SLOTS, MARKER_LOC_POOL,
  markerAssignments, turnsFor, energyFor, chipsPerTurn, ENERGY_MAX, MIN_TABLE, MAX_TABLE,
  SPECIALS_REMOVED, ADEL_HAND_LIMIT, SPECIAL_ENERGY_GAIN, SPECIAL_REDRAW_MAX,
  SPECIAL_RECHIP_MAX, SPREAD_HAZARDS, DAMAGE_TOKENS,
} from './data.js';

// Фазы, в которых АДЕЛЬ может подглядеть маркер через «шпионаж»: подглядывание
// привязано к тому, что член экипажа вошёл в локацию или начал в ней розыгрыш.
const SPY_PHASES = ['reveal', 'actions'];

// Псевдокарта для аномалии «Атака»: у неё нет карты, но выбор цели в интерфейсе
// устроен так же, поэтому она проходит через общий подбор законных локаций.
export const ATTACK_CARD = '__attack';

// ---------- helpers ----------
const log = (G, msg) => { G.log.push(msg); if (G.log.length > 300) G.log.shift(); };
// Личный журнал: то, что видит только сам игрок. Нужен там, где публичная
// строка выдала бы скрытую информацию, — например, при неудачной доставке
// ключевого предмета АДЕЛЬ не должна узнать ни предмет, ни локацию.
const logTo = (G, pid, msg) => {
  if (!G.privateLog[pid]) G.privateLog[pid] = [];
  G.privateLog[pid].push(msg);
  if (G.privateLog[pid].length > 100) G.privateLog[pid].shift();
};
const crewIds = (G) => Object.keys(G.players);
const alive = (G) => crewIds(G).filter(p => !G.players[p].dead);
const isAdel = (pid) => pid === '0';

function spiritCheck(G, random, pid, { fireCheck = false } = {}) {
  const P = G.players[pid];
  let spirit = CHARACTERS[P.character].spirit;
  if (P.inventory.some(it => it.id === 'teddy' && it.faceUp)) spirit += 1;
  if (G.eventOngoing === 'stress') spirit -= 1;
  if (fireCheck && G.anomaliesActive.includes('explosions')) spirit -= 2;
  const roll = random.D6();
  const ok = roll === 1 || roll <= spirit;
  log(G, `${CHARACTERS[P.character].name}: проверка духа — d6=${roll} против ${spirit} → ${ok ? 'успех' : 'провал'}`);
  return ok;
}

function wound(G, pid, n = 1) {
  const P = G.players[pid];
  const ch = CHARACTERS[P.character];
  for (let i = 0; i < n; i++) {
    P.health += 1;
    log(G, `${ch.name} получает рану (${P.health}/5).`);
    if (ch.invLoss.includes(P.health) && P.invBlocked < 3) {
      P.invBlocked += 1;
      enforceCapacity(G, pid);
      log(G, `${ch.name}: ячейка инвентаря заблокирована.`);
    }
    if (P.health >= 5) {
      P.dead = true;
      G.winner = 'adel';
      log(G, `☠ ${ch.name} погибает. АДЕЛЬ побеждает.`);
      return;
    }
  }
}

function capacity(G, pid) { return 4 - G.players[pid].invBlocked; }
// Перегруз инвентаря не разбирается сам: по правилам лишние предметы игрок
// сбрасывает «на ваш выбор». Поэтому здесь только выставляется долг, а сам
// сброс делается ходом dropItem — до тех пор игрок не может ни действовать,
// ни завершить ход.
function enforceCapacity(G, pid) {
  const P = G.players[pid];
  if (P.dead) return;
  const over = P.inventory.length - capacity(G, pid);
  P.pendingDrop = over > 0 ? over : 0;
  if (P.pendingDrop) {
    log(G, `${CHARACTERS[P.character].name}: перегруз инвентаря — нужно сбросить ${P.pendingDrop}.`);
  }
}
function dropItemAt(G, loc, it) {
  if (loc == null) return; // предметы, сброшенные в космосе, пропадают
  G.board[loc].items.push({ id: it.id, faceUp: false });
}

function loc(G, l) { return G.board[l]; }
// Жетон повреждения («Столкновение») выводит из строя и компьютер, и терминал
// локации, пока его не уберут. Остальное в локации работает как обычно.
function computerUsable(L) { return !L.computerLocked && !L.damage; }
function terminalUsable(L) { return !L.terminalLocked && !L.damage; }
function doorBlocked(G, a, b) {
  return loc(G, a).doors.includes(b) || loc(G, b).doors.includes(a);
}
function heal(G, pid, n) {
  const P = G.players[pid];
  P.health = Math.max(0, P.health - n);
  P.invBlocked = 0; // лечение восстанавливает грузоподъёмность
  log(G, `${CHARACTERS[P.character].name} лечится: раны ${P.health}/5, инвентарь восстановлен.`);
}

function hazardEnter(G, random, pid) {
  // пожар и гипоксия при входе / начале фазы розыгрыша
  const P = G.players[pid];
  if (P.inSpace || P.dead) return;
  const L = loc(G, P.pos);
  if (L.hazards.fire) {
    const ext = P.inventory.find(it => it.id === 'extinguisher' && it.faceUp && (it.uses ?? 3) > 0);
    if (ext && P.enteredThisAction) {
      ext.uses = (ext.uses ?? 3) - 1;
      L.hazards.fire = false; G.adel.chipDiscard.push('fire');
      log(G, `Огнетушитель гасит пожар в локации ${P.pos}.`);
    } else {
      if (!spiritCheck(G, random, pid, { fireCheck: true })) wound(G, pid);
    }
  }
  if (G.winner) return;
  if (L.hazards.hypoxia) {
    // Кубик отдаёт сам игрок (ход payHypoxia). «Неиспользованный кубик» — это
    // выложенный в планировании, но ещё не потраченный в этот ход. Если таких
    // нет — по правилам ничего не происходит.
    if (hasFreeCube(P)) {
      P.pendingHypoxia = (P.pendingHypoxia || 0) + 1;
      log(G, `Гипоксия в локации ${P.pos}: ${CHARACTERS[P.character].name} отдаёт кубик действия — выберите какой.`);
    }
  }
}

function hasFreeCube(P) {
  return !!P.plan && CUBE_ACTIONS.some(k => P.plan[k] > P.plan.spent[k]);
}
// Снимает зависшую гипоксию, если отдавать уже нечего (например, игрок словил
// две гипоксии подряд, а свободный кубик остался один).
function settleHypoxia(G, pid) {
  const P = G.players[pid];
  if (P.pendingHypoxia && !hasFreeCube(P)) P.pendingHypoxia = 0;
}
// Игрок может действовать. Заодно разбирает зависшую гипоксию: пока она не
// оплачена, действовать нельзя — иначе можно было бы сперва потратить кубики,
// а отдать уже несуществующий. Долг по перегрузу инвентаря блокирует так же.
function canAct(G, playerID) {
  if (G.phase !== 'actions' || G.activeCrew !== playerID) return false;
  settleHypoxia(G, playerID);
  const P = G.players[playerID];
  return !P.pendingHypoxia && !P.pendingDrop;
}

// Конец хода наступает, когда все живые отходили и ни у кого не осталось
// несброшенных лишних предметов: сброс мог свалиться на игрока, который уже
// завершил действия (например, ему передали предмет через терминал доставки).
function maybeEndTurn(G, random) {
  const crew = alive(G);
  if (crew.every(p => G.players[p].acted && !G.players[p].pendingDrop)) endTurnPhase(G, random);
}

// Показ маркеров и предметов действует, только пока игроки стоят в одной
// локации. Стоит кому-то уйти — показ прекращается, и после новой встречи его
// нужно объявить заново (правило 7.2).
function clearShares(G, pid) {
  for (const key of Object.keys(G.missions.shares)) {
    const [from, to] = key.split('->');
    if (from === pid || to === pid) delete G.missions.shares[key];
  }
}

function markerFor(G, itemId) { return G.missions.markers[itemId]; }

// Хватает ли выбранных фишек на требуемые цвета аномалии. Каждая фишка даёт
// один цвет, а дверь на стыке секторов — любой из двух, поэтому назначение
// ищем перебором: жадный выбор мог бы отвергнуть законную оплату (например,
// когда дверь заняла цвет, который больше нечем закрыть).
function matchColors(candidates, need) {
  const used = new Array(need.length).fill(false);
  const walk = (i) => {
    if (i === candidates.length) return true;
    for (const c of candidates[i]) {
      const j = need.findIndex((n, k) => !used[k] && n === c);
      if (j < 0) continue;
      used[j] = true;
      if (walk(i + 1)) return true;
      used[j] = false;
    }
    return false;
  };
  return walk(0);
}

// Тьма делает любое действие в локации дороже на кубик. Она не работает, если
// в той же локации горит пожар, и не работает вовсе, пока у игрока включён
// фонарь.
function darkAt(G, pid, l) {
  const P = G.players[pid];
  if (P.inventory.some(it => it.id === 'flashlight' && it.faceUp)) return 0;
  const L = loc(G, l);
  return L.hazards.darkness && !L.hazards.fire ? 1 : 0;
}
function darknessTax(G, pid) {
  const P = G.players[pid];
  return P.inSpace ? 0 : darkAt(G, pid, P.pos);
}
// Движение — тот случай, где правило говорит «включая вход и выход»: тьма
// считается и там, откуда игрок уходит, и там, куда входит. Каждая фишка
// действует сама по себе, поэтому переход между двумя тёмными локациями
// стоит двух лишних кубиков.
function moveTax(G, pid, dest) {
  const P = G.players[pid];
  const from = P.inSpace ? 0 : darkAt(G, pid, P.pos);
  const to = typeof dest === 'number' ? darkAt(G, pid, dest) : 0;
  return from + to;
}
function spendCubes(G, pid, action, n, extraFromAny = 0) {
  const P = G.players[pid];
  const plan = P.plan;
  const avail = (k) => plan[k] - plan.spent[k] + (k === action ? P.bonusCubes : 0);
  if (avail(action) + P.bonusCubes < n) { /* fallthrough, checked below */ }
  // тратим с самого действия, потом бонусные (стимуляторы)
  let need = n;
  const fromAction = Math.min(need, plan[action] - plan.spent[action]);
  plan.spent[action] += fromAction; need -= fromAction;
  const fromBonus = Math.min(need, P.bonusCubes);
  P.bonusCubes -= fromBonus; need -= fromBonus;
  if (need > 0) return false;
  // дополнительный налог (тьма/вредоносная программа) — с любого действия
  let tax = extraFromAny;
  for (const k of CUBE_ACTIONS) {
    while (tax > 0 && plan[k] - plan.spent[k] > 0) { plan.spent[k] += 1; tax -= 1; }
  }
  while (tax > 0 && P.bonusCubes > 0) { P.bonusCubes -= 1; tax -= 1; }
  return tax === 0;
}
function canSpend(G, pid, action, n, extraFromAny = 0) {
  const P = G.players[pid]; const plan = P.plan;
  if (!plan) return false;
  const free = (k) => plan[k] - plan.spent[k];
  if (free(action) + P.bonusCubes < n) return false;
  const totalFree = CUBE_ACTIONS.reduce((s, k) => s + free(k), 0) + P.bonusCubes;
  return totalFree >= n + extraFromAny;
}

// ---------- консоль АДЕЛЬ ----------
// Сколько ячеек данного вида есть в колонке этой цены.
function consoleCells(type, cost) { return CONSOLE_LAYOUT[cost]?.[type] || 0; }
// Новая фишка занимает самую дешёвую свободную ячейку своего вида.
function consoleAddChip(G, type) {
  const row = G.adel.console[type];
  for (const c of CONSOLE_COSTS) {
    const used = row.filter(x => x === c).length;
    if (used < consoleCells(type, c)) { row.push(c); row.sort((a, b) => a - b); return true; }
  }
  return false; // все ячейки этого вида заняты
}
function consoleTopCost(G, type) {
  const row = G.adel.console[type];
  return row.length ? row[row.length - 1] : null;
}
function consoleTakeChip(G, type) {
  const row = G.adel.console[type];
  return row.length ? row.pop() : null;
}
// Сколько ещё фишек этого вида примет консоль. Нужно и движку («Дефрагментация»),
// и интерфейсу, чтобы он не предлагал заведомо отклоняемый возврат.
function consoleFree(G, type) {
  const used = (G.adel.console[type] || []).length;
  const total = CONSOLE_COSTS.reduce((s, c) => s + consoleCells(type, c), 0);
  return total - used;
}
function bagDraw(G, random) {
  const bag = G.adel.bag;
  const pool = [];
  for (const h of HAZARDS) for (let i = 0; i < bag[h]; i++) pool.push(h);
  if (!pool.length) return null;
  const pick = pool[Math.floor(random.Number() * pool.length)];
  bag[pick] -= 1;
  return pick;
}
function placeHazard(G, type, target) {
  // target: { loc, door?, slot?('computer'|'terminal') }
  const L = loc(G, target.loc);
  if (type === 'door') {
    if (!ADJ[target.loc].includes(target.door)) return 'нет такого проёма';
    if (doorBlocked(G, target.loc, target.door)) return 'проём уже заблокирован';
    L.doors.push(target.door);
  } else if (type === 'lockdown') {
    const slot = target.slot === 'terminal' ? 'terminal' : 'computer';
    if (slot === 'terminal' && !TERMINALS[target.loc]) return 'здесь нет терминала';
    // Оставленная в локации батарея защищает компьютер и терминал от новой
    // блокировки, пока не разрядится (справочник предметов, «Батарея»).
    if (L.batteryGuard) return 'локация защищена батареей';
    if (slot === 'terminal' ? L.terminalLocked : L.computerLocked) return 'уже заблокировано';
    if (slot === 'terminal') L.terminalLocked = true; else L.computerLocked = true;
  } else {
    if (L.hazards[type]) return 'такая фишка тут уже есть';
    L.hazards[type] = true;
  }
  return null;
}

// ---------- карты АДЕЛЬ ----------
// Добор карт; когда колода кончилась, в дело идёт перетасованный сброс.
function adelDraw(G, random, n) {
  const A = G.adel;
  for (let i = 0; i < n; i++) {
    if (!A.deck.length) {
      if (!A.discard.length) return;
      A.deck = random.Shuffle(A.discard);
      A.discard = [];
    }
    A.hand.push(A.deck.shift());
  }
}

// Карты, кладущие фишку с консоли: карта локаций, «Перегрузка сектора» и
// «Распространение». Отличаются только тем, какие цели законны и какие виды
// фишек разрешены. Для карт, которые фишку не кладут, возвращается null.
// payConsole — списывается ли сверх собственной цены карты ещё и цена фишки
// с консоли. У карт локаций, «Перегрузки сектора» и «Атаки» вся цена и есть
// консольная. У «Распространения» — наоборот: своя цена вместо консольной,
// иначе выкладывание обходилось бы в 8–11⚡ и картой никто не пользовался бы.
function hazardCardRules(G, card) {
  if (card.type === 'loc') {
    return { types: HAZARDS, payConsole: true, allowed: (l) => card.locs.includes(l) };
  }
  if (card.id === 'S_color') {
    return { types: HAZARDS, payConsole: true, allowed: (l) => SECTOR_OF[l] === G.currentEvent?.color };
  }
  if (card.id === 'S_spread') {
    return {
      types: SPREAD_HAZARDS, payConsole: false,
      allowed: (l, hz) => ADJ[l].some(nb => loc(G, nb).hazards[hz]),
    };
  }
  // Аномалия «Атака» — не карта, но цели у неё считаются так же, поэтому
  // интерфейс использует тот же подбор законных локаций.
  if (card.id === ATTACK_CARD) {
    return { types: HAZARDS, payConsole: true, allowed: (l) => SECTOR_OF[l] === G.currentEvent?.color };
  }
  return null;
}

// Цена фишки на картах не печатается — она считывается с консоли (самая
// дорогая фишка нужного вида). Собственная цена карты платится сверх неё.
function playHazardCard(G, card, rules, payload) {
  const { type: hz, target } = payload || {};
  if (!rules.types.includes(hz)) return 'этой карте такой вид фишки не положен';
  if (!target || !ADJ[target.loc]) return 'нет такой локации';
  if (!rules.allowed(target.loc, hz)) return 'локация не подходит под условие карты';
  // Фишка обязана быть на консоли в любом случае — а вот платится ли её
  // консольная цена, решает сама карта.
  const chipCost = consoleTopCost(G, hz);
  if (chipCost == null) return 'на консоли нет фишки этого вида';
  const total = (rules.payConsole ? chipCost : 0) + (card.cost || 0);
  if (G.adel.energy < total) return 'не хватает энергии';
  const err = placeHazard(G, hz, target);
  if (err) return err;
  consoleTakeChip(G, hz);
  G.adel.energy -= total;
  log(G, `АДЕЛЬ выкладывает «${HAZARD_NAMES[hz]}» в локацию ${target.loc} (−${total}⚡).`);
  return null;
}

// Специальные карты, не кладущие фишку. Каждая возвращает { error } либо {};
// drawAfter — сколько карт добрать ПОСЛЕ того, как сыгранная карта уйдёт в
// сброс (иначе при пустой колоде она не попала бы в перетасовку).
// Ни один обработчик не должен менять состояние до последней проверки: при
// прямом вызове хода (тесты) отката, в отличие от boardgame.io, не будет.
const SPECIAL_EFFECTS = {
  S_energy: ({ G }) => {
    G.adel.energy = Math.min(ENERGY_MAX, G.adel.energy + SPECIAL_ENERGY_GAIN);
    log(G, `АДЕЛЬ подзаряжается: +${SPECIAL_ENERGY_GAIN}⚡ (запас ${G.adel.energy}).`);
    return {};
  },

  S_recall: ({ G, card, payload }) => {
    const A = G.adel;
    const i = A.discard.findIndex(c => c.id === payload?.cardId);
    if (i < 0) return { error: 'такой карты нет в сбросе' };
    const [back] = A.discard.splice(i, 1);
    A.deck.unshift(back);
    // Какую именно карту вернули — экипажу знать не положено: сброс АДЕЛЬ от
    // него закрыт, а по названию читались бы её ближайшие возможности.
    log(G, `АДЕЛЬ восстанавливает карту из сброса на верх колоды (−${card.cost}⚡).`);
    return {};
  },

  S_redraw: ({ G, card, payload }) => {
    const A = G.adel;
    const ids = [...new Set(payload?.cardIds || [])].filter(id => id !== card.id);
    if (ids.length > SPECIAL_REDRAW_MAX) return { error: 'больше трёх карт с руки не сбросить' };
    const drop = [];
    for (const id of ids) {
      const c = A.hand.find(x => x.id === id);
      if (!c) return { error: 'этой карты нет на руке' };
      drop.push(c);
    }
    A.hand = A.hand.filter(c => !drop.includes(c));
    A.discard.push(...drop);
    const n = drop.length + 1; // вместе с самой картой
    log(G, `АДЕЛЬ пересобирает руку: сброшено карт — ${n}, столько же будет взято (−${card.cost}⚡).`);
    return { drawAfter: n };
  },

  S_rechip: ({ G, card, payload }) => {
    const A = G.adel;
    const chips = payload?.chips || [];
    if (!chips.length || chips.length > SPECIAL_RECHIP_MAX) {
      return { error: 'вернуть можно от одной до трёх фишек' };
    }
    // Заявку сверяем со сбросом по количеству: фишек каждого вида должно
    // хватить на все указанные.
    const left = [...A.chipDiscard];
    for (const t of chips) {
      if (!HAZARDS.includes(t)) return { error: 'неизвестный вид фишки' };
      const i = left.indexOf(t);
      if (i < 0) return { error: 'в сбросе нет столько фишек этого вида' };
      left.splice(i, 1);
    }
    // Вместимость проверяем на копии консоли тем же правилом, что и при
    // обычном пополнении: если ячеек не хватит, ход отклоняется целиком,
    // а не выкладывает часть фишек молча.
    const probe = { adel: { console: JSON.parse(JSON.stringify(A.console)) } };
    for (const t of chips) {
      if (!consoleAddChip(probe, t)) return { error: 'на консоли нет свободных ячеек' };
    }
    A.chipDiscard = left;
    for (const t of chips) consoleAddChip(G, t);
    log(G, `АДЕЛЬ возвращает на консоль фишки: ${chips.map(t => HAZARD_NAMES[t]).join(', ')} (−${card.cost}⚡).`);
    return {};
  },

  S_reshuffle: ({ G, card, random }) => {
    if (!G.eventDeck.length) return { error: 'колода событий пуста' };
    // Отмена от терминала тревоги привязана к конкретной карте: перетасовка
    // уносит её вглубь колоды, и отмена пропадает вместе с порядком карт.
    const hadCancel = G.eventDeck.some(c => c.cancelled);
    for (const c of G.eventDeck) c.cancelled = false;
    G.eventDeck = random.Shuffle(G.eventDeck);
    log(G, `АДЕЛЬ пересчитывает вероятности: колода событий перетасована, следующее событие — «${EVENTS[G.eventDeck[0].id].name}» (−${card.cost}⚡).`
      + (hadCancel ? ' Отмена события пропала.' : ''));
    return {};
  },
};

// ---------- события ----------
function runEventPhase(G, random) {
  // Колода событий длиннее партии, так что до перетасовки сброса дело дойти не
  // должно. Но если дойдёт — в сброс кладутся сами карты, а не их названия:
  // иначе на следующем круге у «карты» не окажется ни цвета, ни значка паники.
  // Отметку об отмене при этом снимаем — она относилась к прошлому кругу.
  if (G.eventDeck.length === 0) {
    G.eventDeck = G.eventDiscard.map(c => ({ ...c, cancelled: false }));
    G.eventDiscard = [];
  }
  const card = G.eventDeck.shift();
  G.eventDiscard.push({ ...card });
  G.currentEvent = card;
  G.eventOngoing = null;
  const cancelled = card.cancelled;
  log(G, `— ХОД ${G.turnNo}: событие «${EVENTS[card.id].name}»${cancelled ? ' (ОТМЕНЕНО терминалом тревоги)' : ''} —`);
  if (!cancelled) {
    if (card.id === 'stress' || card.id === 'malware') G.eventOngoing = card.id;
    // «Дрейф» добавляет деление сверх обычного шага конца хода — в сумме
    // на таком ходу точка невозврата уходит на два.
    if (card.id === 'drift') { G.pointOfNoReturn += 1; log(G, `Дрейф: точка невозврата → ${G.pointOfNoReturn}.`); }
    if (card.id === 'maneuver') for (const p of alive(G)) { if (!spiritCheck(G, random, p)) wound(G, p); if (G.winner) return; }
    if (card.id === 'collision') {
      // Жетонов повреждений в коробке всего четыре: когда все на поле, новое
      // столкновение жетона не добавляет.
      const onBoard = Object.values(G.board).filter(L => L.damage).length;
      let l; let guard = 0;
      do { l = random.Die(20); guard++; } while (loc(G, l).damage && guard < 50);
      if (onBoard >= DAMAGE_TOKENS) {
        log(G, 'Столкновение! Но жетонов повреждений на поле уже нет в запасе.');
      } else if (!loc(G, l).damage) {
        loc(G, l).damage = true;
        log(G, `Столкновение! Жетон повреждения в локации ${l}.`);
        for (const p of alive(G)) if (!G.players[p].inSpace && G.players[p].pos === l) { wound(G, p); if (G.winner) return; }
      }
    }
  }
  // аномалия «паника» срабатывает даже на отменённом событии
  if (G.anomaliesActive.includes('panic') && card.panic) {
    log(G, 'Аномалия «Паника»: все проходят проверку духа!');
    for (const p of alive(G)) { if (!spiritCheck(G, random, p)) wound(G, p); if (G.winner) return; }
  }
  G.attackUsedThisTurn = false;
}

// Между событием и планированием у АДЕЛЬ есть окно на аномалию «Атака»:
// по правилам она выкладывает фишку в фазе событий, то есть ДО того, как
// экипаж тайно распределит кубики. Иначе фишка становится сюрпризом уже
// после фиксации планов, и аномалия сильнее, чем задумано.
// Окно открывается, только если аномалия активна, — лишней фазы в обычном
// ходу не появляется.
function afterEvent(G) {
  if (!G.winner && G.anomaliesActive.includes('attack')) {
    G.phase = 'event';
    log(G, 'Фаза событий: АДЕЛЬ может провести «Атаку» до планирования экипажа.');
    return;
  }
  startPlanning(G);
}

function startPlanning(G) {
  G.phase = 'planning';
  G.adel.spiedThisTurn = []; // подглядывание маркера — раз за ход на игрока
  for (const p of alive(G)) {
    const P = G.players[p];
    P.plan = null; P.committed = false; P.acted = false; P.bonusCubes = 0;
    P.enteredThisAction = false; P.pendingHypoxia = 0;
    // «Один раз за ход» у дрона считается по ходу партии, а не по тому,
    // сколько раз игрок объявлял себя активным.
    for (const it of P.inventory) delete it.usedThisTurn;
  }
  log(G, 'Фаза планирования: экипаж программирует действия за ширмами.');
}

function startAdelPhase(G, random) {
  G.phase = 'adel';
  if (G.adel.refilled) {           // фишки уже выданы при раскладке
    G.adel.refilled = false;
    log(G, `Фаза АДЕЛЬ. Энергия: ${G.adel.energy}.`);
    return;
  }
  const n = chipsPerTurn(G.numPlayers);
  const got = [];
  for (let i = 0; i < n; i++) {
    const c = bagDraw(G, random);
    if (!c) break;
    if (consoleAddChip(G, c)) got.push(HAZARD_NAMES[c]); else { G.adel.bag[c] += 1; }
  }
  log(G, `Фаза АДЕЛЬ. Пополнение фишек: ${got.length ? got.join(', ') : 'мешочек пуст / консоль полна'}. Энергия: ${G.adel.energy}.`);
}

function startReveal(G, random) {
  G.phase = 'reveal';
  log(G, 'Фаза розыгрыша: планы раскрыты. Срабатывают опасности.');
  for (const p of alive(G)) { hazardEnter(G, random, p); if (G.winner) return; }
  G.phase = 'actions';
  G.activeCrew = null;
  log(G, 'Фаза действий: экипаж решает, кто ходит первым.');
}

function endTurnPhase(G, random) {
  G.phase = 'endturn';
  for (const p of crewIds(G)) {
    const P = G.players[p];
    P.inventory = P.inventory.filter(it => {
      if (it.faceUp && ITEMS[it.id].kind === 'charged') {
        if (it.charge <= 0) { log(G, `${ITEMS[it.id].name} разрядился и сброшен.`); if (P.inSpace && it.id === 'suit') { P.dead = true; G.winner = 'adel'; log(G, '☠ Скафандр разрядился в открытом космосе.'); } return false; }
        it.charge -= 1;
      }
      if (it.faceUp && ITEMS[it.id].kind === 'oneshot' && it.used) return false;
      return true;
    });
    if (G.winner) return;
  }
  // Батареи, оставленные в локациях, разряжаются по общим правилам; с потерей
  // последнего заряда локация перестаёт быть защищённой от «блокировки».
  for (let l = 1; l <= 20; l++) {
    const L = G.board[l];
    if (!L.batteryGuard) continue;
    const bat = L.items.find(it => it.id === 'battery' && it.faceUp);
    if (!bat) { L.batteryGuard = false; continue; }
    if (bat.charge <= 0) {
      L.items = L.items.filter(it => it !== bat);
      L.batteryGuard = false;
      log(G, `Батарея в локации ${l} разрядилась — защита от блокировки снята.`);
    } else bat.charge -= 1;
  }
  G.turnNo -= 1;
  // Точка невозврата подбирается к жетону хода каждый ход. Они идут
  // навстречу друг другу, поэтому окно красной миссии закрывается вдвое
  // быстрее, чем кончается время: когда точка обгонит жетон хода, побег
  // становится невозможен.
  G.pointOfNoReturn += 1;
  log(G, `Конец хода. Жетон хода → ${G.turnNo}, точка невозврата → ${G.pointOfNoReturn}.`);
  if (G.turnNo < 1) { G.winner = 'adel'; log(G, '⏱ Время вышло. АДЕЛЬ побеждает.'); return; }
  runEventPhase(G, random);
  if (G.winner) return;
  afterEvent(G);
}

// Красная миссия закрыта навсегда, если точка невозврата обогнала жетон
// хода: сбежать уже не успеть. Командный терминал может отыграть деление
// назад, поэтому проверка динамическая, а не «однажды и навсегда».
export function redBlocked(G) { return G.turnNo < G.pointOfNoReturn; }

function checkMissionWin(G, mission) {
  const M = G.missions;
  if (mission === 'blue') {
    const pre = M.delivered.blue_card && M.delivered.id_badge && M.delivered.lens;
    const noDamage = Object.values(G.board).every(L => !L.damage);
    return pre && noDamage;
  }
  const pre = M.delivered.chipItem && M.delivered.toolbox && M.delivered.lens;
  return pre && !redBlocked(G);
}

// ---------- setup ----------
function setup({ ctx, random }) {
  const numPlayers = ctx.numPlayers;
  const nCrew = numPlayers - 1;
  const G = {
    numPlayers, log: [], privateLog: {}, winner: null, phase: 'planning',
    turnNo: turnsFor(numPlayers), pointOfNoReturn: 1,
    // nextEvent здесь не хранится: верхняя карта колоды и есть «следующее
    // событие», и второй её экземпляр немедленно расходился бы с оригиналом
    // (терминал тревоги правит именно карту в колоде). Значение выводится
    // в playerView из eventDeck[0].
    eventDeck: [], eventDiscard: [], currentEvent: null, eventOngoing: null,
    anomaliesActive: [], attackUsedThisTurn: false,
    board: {}, labStack: [...LAB_STACK],
    // Жетонов терминала тревоги два, и чинятся они поштучно: здесь лежат
    // локации тех, что перевёрнуты на красную сторону.
    alarmTerminals: [...ALARM_START], alarmOff: [],
    players: {}, activeCrew: null,
    adel: {
      energy: energyFor(numPlayers), hand: [], deck: [], discard: [],
      console: {}, bag: { ...BAG_COUNTS }, chipDiscard: [],
      spyNotes: [], anomalies: [], spiedThisTurn: [],
    },
    missions: { markers: {}, viewers: {}, delivered: {}, shares: {} },
  };
  for (const h of HAZARDS) G.adel.console[h] = [];

  // поле
  for (let l = 1; l <= 20; l++) {
    G.board[l] = { items: [], hazards: { fire: false, hypoxia: false, darkness: false, spy: false }, doors: [], computerLocked: false, terminalLocked: false, damage: false, hatchClosed: false };
  }
  // Персонажей выбираем до раскладки: их стартовые предметы уходят из общей
  // кучи, а значит влияют на то, из чего тянутся случайные жетоны поля.
  const chars = random.Shuffle(Object.keys(CHARACTERS)).slice(0, nCrew);

  // предметы на поле: 7 ключевых + 2 детали + 1 батарея + 10 случайных = 20
  const keyItems = Object.keys(ITEMS).filter(id => ITEMS[id].kind === 'key');
  const tokens = [...keyItems, ...BOARD_FIXED,
    ...random.Shuffle(randomPool(chars)).slice(0, RANDOM_DRAW)];
  const shuffled = random.Shuffle(tokens);
  for (let l = 1; l <= 20; l++) G.board[l].items.push({ id: shuffled[l - 1], faceUp: false });

  // маркеры миссий
  const locPool = random.Shuffle([...MARKER_LOC_POOL]);
  MARKER_SLOTS.forEach((slot, i) => { G.missions.markers[slot] = { loc: locPool[i], revealed: false }; });
  const crewOrder = [];
  for (let i = 1; i < numPlayers; i++) crewOrder.push(String(i));
  const assign = markerAssignments(nCrew);
  for (const slot of MARKER_SLOTS) G.missions.viewers[slot] = assign[slot].map(idx => crewOrder[idx]);

  // позиции экипажа
  const taken = new Set();
  crewOrder.forEach((pid, i) => {
    // Бросаем d20, пока не выпадет свободная локация. Ограничитель обязателен:
    // без него вырожденный генератор (в тестах он бывает детерминированным)
    // подвешивает setup намертво — а это серверный код, встанет весь процесс.
    let pos = random.Die(20);
    for (let guard = 0; taken.has(pos) && guard < 100; guard++) pos = random.Die(20);
    if (taken.has(pos)) {
      for (let l = 1; l <= 20; l++) if (!taken.has(l)) { pos = l; break; }
    }
    taken.add(pos);
    const ch = chars[i];
    G.players[pid] = {
      character: ch, pos, inSpace: null, health: 0, invBlocked: 0, dead: false,
      inventory: [{ id: CHARACTERS[ch].start, faceUp: false }],
      plan: null, committed: false, acted: false, bonusCubes: 0,
      knownItems: {}, enteredThisAction: false,
    };
  });

  // АДЕЛЬ: специальные карты замешиваются в общую колоду наравне с локациями,
  // отдельной выкладки у них нет. Сколько их в игре — считается от длины
  // массива, чтобы правило «уберите две для первой партии» включалось одной
  // константой, а не переписыванием раздачи.
  const specialsInPlay = random.Shuffle(ADEL_SPECIALS.map(c => ({ ...c })))
    .slice(0, ADEL_SPECIALS.length - SPECIALS_REMOVED);
  G.adel.deck = random.Shuffle([...ADEL_CARDS.map(c => ({ ...c })), ...specialsInPlay]);
  G.adel.hand = G.adel.deck.splice(0, ADEL_HAND_LIMIT);
  G.adel.anomalies = random.Shuffle(Object.keys(ANOMALIES)).slice(0, 4);
  // Стартовые фишки на консоли — это и есть запас первого хода, а не добавка
  // к нему: иначе к своей первой фазе АДЕЛЬ приходила бы с шестью фишками
  // вместо трёх. Поэтому первое пополнение пропускается.
  const startChips = chipsPerTurn(numPlayers);
  for (let i = 0; i < startChips; i++) { const c = bagDraw(G, random); if (c) consoleAddChip(G, c); }
  G.adel.refilled = true;

  // колода событий
  let deck = EVENT_DECK.map(c => ({ ...c }));
  if (nCrew >= 3) deck = deck.filter(c => c.id !== 'silence'); // 4-5 игроков всего
  G.eventDeck = random.Shuffle(deck).map((c, i) => ({ ...c, uid: i, cancelled: false }));

  runEventPhase(G, random);
  afterEvent(G);
  return G;
}

// ---------- moves ----------
const moves = {
  // === ЭКИПАЖ: планирование ===
  commitPlan: ({ G, playerID, random }, plan) => {
    if (G.phase !== 'planning' || isAdel(playerID) || G.players[playerID]?.dead) return INVALID_MOVE;
    const P = G.players[playerID];
    if (P.committed) return INVALID_MOVE;
    const keys = CUBE_ACTIONS;
    const total = keys.reduce((s, k) => s + (plan[k] | 0), 0);
    if (total !== 4 || keys.some(k => (plan[k] | 0) < 0)) return INVALID_MOVE;
    P.plan = { ...Object.fromEntries(keys.map(k => [k, plan[k] | 0])), spent: Object.fromEntries(keys.map(k => [k, 0])) };
    P.committed = true;
    log(G, `${CHARACTERS[P.character].name} закончил(а) планирование.`);
    if (alive(G).every(p => G.players[p].committed)) startAdelPhase(G, random);
  },

  // === АДЕЛЬ ===
  // Карты (в том числе специальные) лежат в руке; сыгранная уходит в сброс.
  // payload зависит от карты: для выкладывания фишки — { type, target },
  // для специальных — своё поле (cardId, cardIds, chips) либо ничего.
  adelPlayCard: ({ G, playerID, random }, cardId, payload) => {
    if (G.phase !== 'adel' || !isAdel(playerID)) return INVALID_MOVE;
    const A = G.adel;
    const card = A.hand.find(c => c.id === cardId);
    if (!card) return INVALID_MOVE;

    let drawAfter = 0;
    const rules = hazardCardRules(G, card);
    if (rules) {
      if (playHazardCard(G, card, rules, payload)) return INVALID_MOVE;
    } else {
      const effect = SPECIAL_EFFECTS[card.id];
      if (!effect) return INVALID_MOVE;
      if (A.energy < (card.cost || 0)) return INVALID_MOVE;
      const res = effect({ G, card, payload, random });
      if (res.error) return INVALID_MOVE;
      A.energy -= card.cost || 0;
      drawAfter = res.drawAfter || 0;
    }

    A.hand = A.hand.filter(c => c.id !== cardId);
    A.discard.push(card);
    // Добор — только после того, как карта легла в сброс: иначе при пустой
    // колоде она не попала бы в перетасовку и «взять столько же» соврало бы.
    if (drawAfter) adelDraw(G, random, drawAfter);
  },

  adelDiscard: ({ G, playerID }, cardIds) => {
    if (G.phase !== 'adel' || !isAdel(playerID)) return INVALID_MOVE;
    const A = G.adel;
    for (const id of cardIds) {
      const c = A.hand.find(x => x.id === id);
      if (c) { A.hand = A.hand.filter(x => x.id !== id); A.discard.push(c); }
    }
  },

  adelActivateAnomaly: ({ G, playerID }, key, payments) => {
    // payments: [{loc, type, door?, slot?}] — фишки, которые АДЕЛЬ снимает с поля
    if (G.phase !== 'adel' || !isAdel(playerID)) return INVALID_MOVE;
    const A = G.adel;
    if (!A.anomalies.includes(key) || G.anomaliesActive.includes(key)) return INVALID_MOVE;
    if (A.energy < ANOMALY_COST) return INVALID_MOVE;
    const need = ANOMALIES[key].colors;
    if (!payments || payments.length !== need.length) return INVALID_MOVE;

    // Разбираем оплату: каждая указанная фишка должна реально лежать на поле,
    // и дважды одну и ту же засчитывать нельзя.
    const picked = [];
    const seen = new Set();
    for (const pay of payments) {
      const L = loc(G, pay.loc);
      if (!L) return INVALID_MOVE;
      let entry;
      if (pay.type === 'door') {
        const d = pay.door;
        if (d == null || !ADJ[pay.loc]?.includes(d) || !doorBlocked(G, pay.loc, d)) return INVALID_MOVE;
        // дверь на стыке секторов засчитывается за любой из двух цветов
        entry = {
          id: `door:${Math.min(pay.loc, d)}-${Math.max(pay.loc, d)}`,
          colors: [SECTOR_OF[pay.loc], SECTOR_OF[d]], type: 'door',
          remove: () => {
            loc(G, pay.loc).doors = loc(G, pay.loc).doors.filter(x => x !== d);
            loc(G, d).doors = loc(G, d).doors.filter(x => x !== pay.loc);
          },
        };
      } else if (pay.type === 'lockdown') {
        const slot = pay.slot === 'terminal' ? 'terminal' : 'computer';
        if (slot === 'terminal' ? !L.terminalLocked : !L.computerLocked) return INVALID_MOVE;
        entry = {
          id: `lockdown:${pay.loc}:${slot}`, colors: [SECTOR_OF[pay.loc]], type: 'lockdown',
          remove: () => { if (slot === 'terminal') L.terminalLocked = false; else L.computerLocked = false; },
        };
      } else {
        if (!HAZARDS.includes(pay.type) || !L.hazards[pay.type]) return INVALID_MOVE;
        entry = {
          id: `${pay.type}:${pay.loc}`, colors: [SECTOR_OF[pay.loc]], type: pay.type,
          remove: () => { L.hazards[pay.type] = false; },
        };
      }
      if (seen.has(entry.id)) return INVALID_MOVE;
      seen.add(entry.id);
      picked.push(entry);
    }
    if (!matchColors(picked.map(p => p.colors), need)) return INVALID_MOVE;

    for (const p of picked) { p.remove(); A.chipDiscard.push(p.type); }
    A.energy -= ANOMALY_COST;
    G.anomaliesActive.push(key);
    if (key === 'close_hatches') for (const l of Object.keys(HATCHES)) loc(G, +l).hatchClosed = true;
    if (key === 'kill_terminals') G.alarmOff = [...G.alarmTerminals];
    log(G, `⚠ АДЕЛЬ активирует аномалию «${ANOMALIES[key].name}» (−5⚡).`);
  },

  adelAttack: ({ G, playerID }, type, target) => {
    // Аномалия «Атака»: раз за ход, в фазу событий — до планирования экипажа.
    // Локация должна быть цвета текущего события.
    if (G.phase !== 'event' || !isAdel(playerID)) return INVALID_MOVE;
    if (!G.anomaliesActive.includes('attack') || G.attackUsedThisTurn) return INVALID_MOVE;
    if (SECTOR_OF[target.loc] !== G.currentEvent.color) return INVALID_MOVE;
    const cost = consoleTopCost(G, type);
    if (cost == null || G.adel.energy < cost) return INVALID_MOVE;
    if (placeHazard(G, type, target)) return INVALID_MOVE;
    consoleTakeChip(G, type);
    G.adel.energy -= cost;
    G.attackUsedThisTurn = true;
    log(G, `Аномалия «Атака»: «${HAZARD_NAMES[type]}» в локацию ${target.loc} (−${cost}⚡).`);
  },

  adelSpyMarker: ({ G, playerID, random }, targetPid, slot) => {
    if (!isAdel(playerID)) return INVALID_MOVE;
    // По правилам подглядывание случается, когда член экипажа входит в локацию
    // со шпионажем или начинает в ней фазу розыгрыша, — то есть уже после
    // раскрытия планов и ровно один раз за ход на игрока. Без этого предела
    // повторные вызовы превращают честные 50/50 в достоверный ответ.
    if (!SPY_PHASES.includes(G.phase)) return INVALID_MOVE;
    if (G.adel.spiedThisTurn.includes(targetPid)) return INVALID_MOVE;
    const P = G.players[targetPid];
    if (!P || P.dead || P.inSpace || !loc(G, P.pos).hazards.spy) return INVALID_MOVE;
    if (!G.missions.viewers[slot]?.includes(targetPid)) return INVALID_MOVE;
    const real = G.missions.markers[slot].loc;
    const showReal = random.Number() < 0.5;
    G.adel.spyNotes.push({ slot, targetPid, value: showReal ? real : 'X', turn: G.turnNo });
    G.adel.spiedThisTurn.push(targetPid);
    log(G, `АДЕЛЬ шпионит за ${CHARACTERS[P.character].name}: тайно смотрит один из двух перемешанных маркеров.`);
  },

  // Закрыть окно «Атаки» и пустить экипаж планировать.
  adelEndEvent: ({ G, playerID }) => {
    if (G.phase !== 'event' || !isAdel(playerID)) return INVALID_MOVE;
    startPlanning(G);
  },

  adelEndPhase: ({ G, playerID, random }) => {
    if (G.phase !== 'adel' || !isAdel(playerID)) return INVALID_MOVE;
    const A = G.adel;
    adelDraw(G, random, Math.max(0, ADEL_HAND_LIMIT - A.hand.length));
    A.energy = Math.min(ENERGY_MAX, A.energy + energyFor(G.numPlayers));
    log(G, `АДЕЛЬ завершает ход. Энергия пополнена до ${A.energy}.`);
    startReveal(G, random);
  },

  // === ЭКИПАЖ: фаза действий ===
  claimActive: ({ G, playerID }) => {
    if (G.phase !== 'actions' || isAdel(playerID) || G.activeCrew) return INVALID_MOVE;
    const P = G.players[playerID];
    if (!P || P.dead || P.acted) return INVALID_MOVE;
    G.activeCrew = playerID;
    log(G, `${CHARACTERS[P.character].name} действует.`);
  },

  // Гипоксия: игрок сам решает, какой неиспользованный кубик отдать в запас.
  payHypoxia: ({ G, playerID }, action) => {
    if (isAdel(playerID)) return INVALID_MOVE;
    const P = G.players[playerID];
    if (!P?.pendingHypoxia || !CUBE_ACTIONS.includes(action)) return INVALID_MOVE;
    if (!P.plan || P.plan[action] - P.plan.spent[action] < 1) return INVALID_MOVE;
    P.plan[action] -= 1;
    P.pendingHypoxia -= 1;
    log(G, `${CHARACTERS[P.character].name} теряет из-за гипоксии кубик «${ACTION_NAMES[action]}».`);
    settleHypoxia(G, playerID);
  },

  actMove: ({ G, playerID, random }, dest) => {
    if (!canAct(G, playerID)) return INVALID_MOVE;
    const P = G.players[playerID];
    const tax = moveTax(G, playerID, dest);
    if (!canSpend(G, playerID, 'move', 1, tax)) return INVALID_MOVE;
    if (P.inSpace) {
      // движение в космосе: в соседнюю секцию или на корабль через люк
      if (typeof dest === 'string') {
        if (!SPACE_ADJ[P.inSpace].includes(dest)) return INVALID_MOVE;
        spendCubes(G, playerID, 'move', 1, 0);
        P.inSpace = dest;
        clearShares(G, playerID);
        log(G, `${CHARACTERS[P.character].name} перемещается в секцию космоса ${dest}.`);
      } else {
        const sects = HATCHES[dest];
        if (!sects || !sects.includes(P.inSpace)) return INVALID_MOVE;
        if (loc(G, dest).hatchClosed) return INVALID_MOVE;
        spendCubes(G, playerID, 'move', 1, 0);
        P.inSpace = null; P.pos = dest; P.enteredThisAction = true;
        clearShares(G, playerID);
        hazardEnter(G, random, playerID); P.enteredThisAction = false;
        log(G, `${CHARACTERS[P.character].name} возвращается на корабль в локацию ${dest}.`);
      }
      return;
    }
    if (typeof dest === 'string') {
      // выход в космос через люк
      const sects = HATCHES[P.pos];
      if (!sects || !sects.includes(dest)) return INVALID_MOVE;
      if (loc(G, P.pos).hatchClosed) return INVALID_MOVE;
      if (!P.inventory.some(it => it.id === 'suit' && it.faceUp)) return INVALID_MOVE;
      if (!spendCubes(G, playerID, 'move', 1, tax)) return INVALID_MOVE;
      P.inSpace = dest;
      clearShares(G, playerID);
      log(G, `${CHARACTERS[P.character].name} выходит в открытый космос (секция ${dest}).`);
      return;
    }
    if (!ADJ[P.pos].includes(dest) || doorBlocked(G, P.pos, dest)) return INVALID_MOVE;
    if (!spendCubes(G, playerID, 'move', 1, tax)) return INVALID_MOVE;
    P.pos = dest; P.enteredThisAction = true;
    P.pendingTake = null;   // ушли — предложение взять предмет пропало
    clearShares(G, playerID);
    hazardEnter(G, random, playerID);
    P.enteredThisAction = false;
    if (!G.winner) log(G, `${CHARACTERS[P.character].name} переходит в локацию ${dest}.`);
  },

  actSearch: ({ G, playerID }, take) => {
    if (!canAct(G, playerID)) return INVALID_MOVE;
    const P = G.players[playerID];
    if (P.inSpace) return INVALID_MOVE;
    const L = loc(G, P.pos);
    if (!L.items.length) return INVALID_MOVE;
    // take: false — только осмотреть, true — забрать верхний, число — забрать
    // предмет с этим номером в стопке локации.
    const idx = take === true ? L.items.length - 1 : (typeof take === 'number' ? take : null);
    if (idx != null && !L.items[idx]) return INVALID_MOVE;
    // «Поиск» — ОДНО действие: посмотрели жетон и решаете, брать его или нет.
    // Поэтому взятие сразу после осмотра той же локации кубика уже не стоит,
    // иначе игрок платил бы дважды за одно действие правил.
    const alreadyLooked = P.pendingTake === P.pos;
    const tax = darknessTax(G, playerID);
    if (!alreadyLooked && !spendCubes(G, playerID, 'search', 1, tax)) return INVALID_MOVE;
    if (alreadyLooked && idx == null) return INVALID_MOVE; // осматривать нечего, уже осмотрено
    // Осмотр показывает всю стопку: предметов в локации может накопиться
    // сколько угодно, и «посмотреть только верхний» правилам не соответствует.
    P.knownItems[P.pos] = L.items.map(x => x.id);
    if (idx != null) {
      const [it] = L.items.splice(idx, 1);
      P.inventory.push({
        id: it.id, faceUp: it.faceUp,
        ...(ITEMS[it.id].kind === 'charged' ? { charge: it.charge ?? 0 } : {}),
      });
      if (L.items.length) P.knownItems[P.pos] = L.items.map(x => x.id);
      else delete P.knownItems[P.pos];
      enforceCapacity(G, playerID);
      P.pendingTake = null;   // предложение использовано
      log(G, `${CHARACTERS[P.character].name} обыскивает локацию ${P.pos} и забирает предмет.`);
    } else {
      // Жетон осмотрен: теперь игрок решает, брать его или оставить, и это
      // решение входит в то же действие поиска.
      P.pendingTake = P.pos;
      log(G, `${CHARACTERS[P.character].name} осматривает локацию ${P.pos}.`);
    }
  },

  // Оставить осмотренный предмет на месте. Отдельный ход нужен затем, чтобы
  // интерфейс мог закрыть предложение, не тратя кубик и ничего не подбирая.
  leaveItem: ({ G, playerID }) => {
    const P = G.players[playerID];
    if (!P || P.pendingTake == null) return INVALID_MOVE;
    P.pendingTake = null;
    log(G, `${CHARACTERS[P.character].name} оставляет осмотренное на месте.`);
  },

  // Сброс лишнего при перегрузе: какой именно предмет уйдёт, решает игрок.
  dropItem: ({ G, playerID, random }, invIndex) => {
    const P = G.players[playerID];
    if (!P?.pendingDrop) return INVALID_MOVE;
    const it = P.inventory[invIndex];
    if (!it) return INVALID_MOVE;
    P.inventory.splice(invIndex, 1);
    P.pendingDrop -= 1;
    if (P.inSpace && it.id === 'suit' && it.faceUp) {
      P.dead = true; G.winner = 'adel';
      log(G, `☠ ${CHARACTERS[P.character].name} остаётся без скафандра в открытом космосе. АДЕЛЬ побеждает.`);
      return;
    }
    dropItemAt(G, P.inSpace ? null : P.pos, it); // сброшенное в космосе пропадает
    log(G, `${CHARACTERS[P.character].name} сбрасывает лишний предмет${P.inSpace ? ' в космосе' : ` в локации ${P.pos}`}.`);
    if (!P.pendingDrop && P.acted) maybeEndTurn(G, random);
  },

  actActivate: ({ G, playerID, random }, invIndex) => {
    if (!canAct(G, playerID)) return INVALID_MOVE;
    const P = G.players[playerID];
    const it = P.inventory[invIndex];
    if (!it || it.faceUp) return INVALID_MOVE;
    const item = ITEMS[it.id];
    if (item.kind === 'key') return INVALID_MOVE;
    const tax = darknessTax(G, playerID);

    // детали: нужны две, активируются одним действием
    if (it.id === 'parts') {
      const partIdx = P.inventory.map((x, i) => (x.id === 'parts' && !x.faceUp ? i : -1)).filter(i => i >= 0);
      if (partIdx.length < 2) return INVALID_MOVE;
      if (!G.labStack.length) return INVALID_MOVE;
      if (!spendCubes(G, playerID, 'activate', 1, tax)) return INVALID_MOVE;
      P.inventory = P.inventory.filter((_, i) => !partIdx.slice(0, 2).includes(i));
      P.pendingLabPick = true; // выбор предмета отдельным ходом pickLab
      log(G, `${CHARACTERS[P.character].name} собирает предмет из деталей.`);
      return;
    }
    if (!spendCubes(G, playerID, 'activate', 1, tax)) return INVALID_MOVE;
    it.faceUp = true;
    if (item.kind === 'charged') {
      const roll = random.D6();
      let charge = roll <= 2 ? 1 : roll <= 4 ? 2 : 3;
      if (G.anomaliesActive.includes('drained')) charge = Math.max(0, charge - 1);
      it.charge = charge;
      if (it.id === 'extinguisher') it.uses = 3;
      log(G, `${CHARACTERS[P.character].name} активирует «${item.name}» (заряд ${charge}).`);
    } else if (it.id === 'stims') {
      P.bonusCubes += 3; it.used = true;
      log(G, `${CHARACTERS[P.character].name} использует стимуляторы: +3 кубика на этот ход.`);
    } else if (it.id === 'medkit') {
      // Эмма Рончони — медик: её аптечка даёт 4 заряда лечения вместо 3.
      const charges = CHARACTERS[P.character].special === 'medic' ? 4 : 3;
      P.pendingMedkit = charges; it.used = true;
      log(G, `${CHARACTERS[P.character].name} вскрывает аптечку (${charges} лечения — распределите).`);
    } else if (it.id === 'extinguisher') {
      // «Убирайте фишки пожар из локаций, в которые зайдёте в этот ход
      // (включая текущую)»: если игрок уже стоит в огне, огнетушитель тушит
      // его сразу же, тратя один заряд. Проверку духа за начало хода в огне
      // он при этом не отменяет — она прошла раньше, в фазе розыгрыша.
      it.uses = 3;
      it.used = true; // одноразовый: списывается в конце хода
      const L = loc(G, P.pos);
      if (!P.inSpace && L.hazards.fire) {
        L.hazards.fire = false; it.uses -= 1; G.adel.chipDiscard.push('fire');
        log(G, `${CHARACTERS[P.character].name} гасит пожар в локации ${P.pos} (осталось зарядов: ${it.uses}).`);
      } else {
        log(G, `${CHARACTERS[P.character].name} активирует огнетушитель (до 3 пожаров до конца хода).`);
      }
    } else {
      log(G, `${CHARACTERS[P.character].name} активирует «${item.name}».`);
    }
  },

  pickLab: ({ G, playerID }, itemId) => {
    const P = G.players[playerID];
    if (!P?.pendingLabPick) return INVALID_MOVE;
    const i = G.labStack.indexOf(itemId);
    if (i < 0) return INVALID_MOVE;
    G.labStack.splice(i, 1);
    P.inventory.push({ id: itemId, faceUp: false, ...(ITEMS[itemId].kind === 'charged' ? { charge: 0 } : {}) });
    P.pendingLabPick = false;
    enforceCapacity(G, playerID);
    log(G, `${CHARACTERS[P.character].name} тайно берёт предмет из лаборатории.`);
  },

  applyMedkit: ({ G, playerID }, targetPid, n) => {
    const P = G.players[playerID];
    if (!P?.pendingMedkit || n < 1 || n > P.pendingMedkit) return INVALID_MOVE;
    const T = G.players[targetPid];
    if (!T || T.dead) return INVALID_MOVE;
    const samePlace = targetPid === playerID || (T.pos === P.pos && !T.inSpace && !P.inSpace);
    if (!samePlace) return INVALID_MOVE;
    heal(G, targetPid, n);
    P.pendingMedkit -= n;
    if (P.pendingMedkit <= 0) P.pendingMedkit = 0;
  },

  actOpenDoor: ({ G, playerID }, neighbor) => {
    if (!canAct(G, playerID)) return INVALID_MOVE;
    const P = G.players[playerID];
    if (P.inSpace) return INVALID_MOVE;
    if (!doorBlocked(G, P.pos, neighbor)) return INVALID_MOVE;
    const tax = darknessTax(G, playerID);
    if (!spendCubes(G, playerID, 'door', 1, tax)) return INVALID_MOVE;
    loc(G, P.pos).doors = loc(G, P.pos).doors.filter(d => d !== neighbor);
    loc(G, neighbor).doors = loc(G, neighbor).doors.filter(d => d !== P.pos);
    G.adel.chipDiscard.push('door');
    log(G, `${CHARACTERS[P.character].name} разблокирует дверь ${P.pos}↔${neighbor}.`);
  },

  // payload.kind: deliver | terminal | clearHazard | openHatch | repairFromSpace
  actSpecial: ({ G, playerID, random }, payload) => {
    if (!canAct(G, playerID)) return INVALID_MOVE;
    const P = G.players[playerID];
    const ch = CHARACTERS[P.character];
    const tax = (P.inSpace ? 0 : darknessTax(G, playerID)) + (G.eventOngoing === 'malware' ? 1 : 0);
    // стоимость: 3 кубика; или 2 + проверка духа; Мэй — всегда 2 без проверки
    let cost = 3, needCheck = false;
    if (ch.special === 'cheap_special') { cost = 2; }
    else if (payload.risky) { cost = 2; needCheck = true; }
    if (!canSpend(G, playerID, 'special', cost, tax)) return INVALID_MOVE;
    if (!spendCubes(G, playerID, 'special', cost, tax)) return INVALID_MOVE;
    if (needCheck && !spiritCheck(G, random, playerID)) { log(G, 'Спец. действие сорвалось (провал проверки духа), кубики потрачены.'); return; }
    if (G.winner) return;

    const kind = payload.kind;
    const L = P.inSpace ? null : loc(G, P.pos);

    if (kind === 'repairFromSpace') {
      if (!P.inSpace) return INVALID_MOVE;
      const near = SPACE_NEAR[P.inSpace] || [];
      if (!near.includes(payload.loc) || !loc(G, payload.loc).damage) return INVALID_MOVE;
      loc(G, payload.loc).damage = false;
      log(G, `${ch.name} снаружи корабля убирает повреждение в локации ${payload.loc}.`);
      return;
    }
    if (kind === 'openHatch') {
      if (P.inSpace) {
        const l = payload.loc;
        if (!HATCHES[l] || !HATCHES[l].includes(P.inSpace) || !loc(G, l).hatchClosed) return INVALID_MOVE;
        loc(G, l).hatchClosed = false;
      } else {
        if (!HATCHES[P.pos] || !L.hatchClosed) return INVALID_MOVE;
        if (!computerUsable(L)) return INVALID_MOVE;
        L.hatchClosed = false;
      }
      log(G, `${ch.name} открывает люк.`);
      return;
    }
    if (P.inSpace) return INVALID_MOVE;

    if (kind === 'deliver') {
      const idx = P.inventory.findIndex(x => x.id === payload.itemId);
      if (idx < 0) return INVALID_MOVE;
      const item = ITEMS[payload.itemId];
      if (item.kind !== 'key') return INVALID_MOVE;
      if (!computerUsable(L)) return INVALID_MOVE;
      // Удача публична: по правилам игрок показывает предмет и вскрывает
      // маркер как доказательство. А вот неудача публично не разбирается —
      // иначе АДЕЛЬ бесплатно узнавала бы, у кого какой ключевой предмет и
      // какая локация уже проверена. Подробность уходит в личный журнал.
      const failed = (why) => {
        log(G, `${ch.name}: специальное действие не удалось.`);
        logTo(G, playerID, `«${item.name}» в локации ${P.pos}: ${why}`);
      };
      if (item.final) {
        const mission = item.mission;
        const targetLoc = mission === 'blue' ? BLUE_FINAL_LOC : RED_FINAL_LOC;
        if (P.pos !== targetLoc) { failed('не та локация для финальной активации'); return; }
        if (!checkMissionWin(G, mission)) {
          failed(`условия ${mission === 'blue' ? 'синей' : 'красной'} миссии ещё не выполнены`);
          return;
        }
        G.winner = 'crew';
        log(G, `🎉 «${item.name}» активирован в локации ${targetLoc}. ЭКИПАЖ ПОБЕЖДАЕТ (${mission === 'blue' ? 'АДЕЛЬ отключена' : 'побег удался'})!`);
        return;
      }
      const marker = markerFor(G, payload.itemId);
      if (marker.loc === P.pos) {
        marker.revealed = true;
        G.missions.delivered[payload.itemId] = true;
        P.inventory.splice(idx, 1);
        log(G, `✅ ${ch.name} доставляет «${item.name}» в локацию ${P.pos}! Маркер вскрыт.`);
      } else {
        failed('неверная локация, предмет остаётся в инвентаре');
      }
      return;
    }

    if (kind === 'clearHazard') {
      // через компьютер: шпионаж/гипоксия/тьма в своей или соседней (через проём) локации
      if (!computerUsable(L)) return INVALID_MOVE;
      const t = payload.hazard, tl = payload.loc;
      if (!['spy', 'hypoxia', 'darkness'].includes(t)) return INVALID_MOVE;
      const okLoc = tl === P.pos || ADJ[P.pos].includes(tl);
      if (!okLoc || !loc(G, tl).hazards[t]) return INVALID_MOVE;
      loc(G, tl).hazards[t] = false;
      G.adel.chipDiscard.push(t);
      log(G, `${ch.name} через компьютер убирает «${HAZARD_NAMES[t]}» из локации ${tl}.`);
      return;
    }

    if (kind === 'terminal') {
      const term = TERMINALS[P.pos];
      const isAlarm = G.alarmTerminals.includes(P.pos);
      if (payload.alarm && isAlarm) {
        // терминал тревоги лежит на компьютере локации — зависит от компьютера
        if (G.alarmOff.includes(P.pos) || !computerUsable(L)) return INVALID_MOVE;
        if (!G.eventDeck.length) return INVALID_MOVE;
        G.eventDeck[0].cancelled = true;
        // переместить терминал тревоги
        let nl; let guard = 0;
        do { nl = random.Die(20); guard++; } while (G.alarmTerminals.includes(nl) && guard < 50);
        G.alarmTerminals = G.alarmTerminals.map(x => (x === P.pos ? nl : x));
        G.alarmOff = G.alarmOff.map(x => (x === P.pos ? nl : x));
        log(G, `${ch.name} активирует терминал тревоги: следующее событие отменено. Терминал переносится в локацию ${nl}.`);
        return;
      }
      if (!term || !terminalUsable(L)) return INVALID_MOVE;
      switch (term) {
        case 'medical': {
          const t = payload.targetPid ?? playerID;
          const T = G.players[t];
          if (!T || (t !== playerID && (T.pos !== P.pos || T.inSpace))) return INVALID_MOVE;
          heal(G, t, 5);
          break;
        }
        case 'command':
          G.pointOfNoReturn = Math.max(1, G.pointOfNoReturn - 1);
          log(G, `Точка невозврата → ${G.pointOfNoReturn}.`);
          break;
        case 'repair': {
          const dl = payload.loc;
          if (!loc(G, dl)?.damage) return INVALID_MOVE;
          loc(G, dl).damage = false;
          log(G, `${ch.name} чинит повреждение в локации ${dl}.`);
          break;
        }
        case 'central': {
          if (payload.fixAlarm) {
            // Центральный терминал чинит ОДИН жетон: по правилам он снимает
            // одну «блокировку», а жетонов тревоги на корабле два.
            const fix = G.alarmOff.includes(payload.loc) ? payload.loc : G.alarmOff[0];
            if (fix == null) return INVALID_MOVE;
            G.alarmOff = G.alarmOff.filter(l => l !== fix);
            log(G, `${ch.name} восстанавливает терминал тревоги в локации ${fix}.`);
            break;
          }
          const dl = payload.loc;
          const DL = loc(G, dl);
          if (!DL || (!DL.computerLocked && !DL.terminalLocked)) return INVALID_MOVE;
          if (payload.slot === 'terminal' && DL.terminalLocked) DL.terminalLocked = false;
          else if (DL.computerLocked) DL.computerLocked = false;
          else DL.terminalLocked = false;
          G.adel.chipDiscard.push('lockdown');
          log(G, `${ch.name} перезагружает системы в локации ${dl}.`);
          break;
        }
        case 'engineering': {
          if (!G.labStack.length) return INVALID_MOVE;
          P.pendingLabPick = true;
          log(G, `${ch.name} использует инженерный терминал.`);
          break;
        }
        case 'delivery': {
          const t = payload.targetPid;
          const T = G.players[t];
          if (!T || T.dead || T.inSpace) return INVALID_MOVE;
          const idx = payload.invIndex | 0;
          if (payload.direction === 'take') {
            if (!payload.consented) return INVALID_MOVE; // согласие подтверждает второй игрок в чате
            const it2 = T.inventory[idx]; if (!it2) return INVALID_MOVE;
            T.inventory.splice(idx, 1); P.inventory.push(it2); enforceCapacity(G, playerID);
          } else {
            const it2 = P.inventory[idx]; if (!it2) return INVALID_MOVE;
            P.inventory.splice(idx, 1); T.inventory.push(it2); enforceCapacity(G, t);
          }
          log(G, `${ch.name} использует терминал доставки: предмет телепортирован.`);
          break;
        }
        default: return INVALID_MOVE;
      }
      return;
    }
    return INVALID_MOVE;
  },

  // батарея: убрать блокировку в своей локации (одноразовое применение заряда предмета)
  useBattery: ({ G, playerID }, slot) => {
    if (!canAct(G, playerID)) return INVALID_MOVE;
    const P = G.players[playerID];
    if (P.inSpace) return INVALID_MOVE;
    const idx = P.inventory.findIndex(x => x.id === 'battery' && x.faceUp);
    if (idx < 0) return INVALID_MOVE;
    const L = loc(G, P.pos);
    if (slot === 'alarmFix') {
      if (!G.alarmOff.includes(P.pos)) return INVALID_MOVE;
      G.alarmOff = G.alarmOff.filter(l => l !== P.pos);
    }
    else if (slot === 'terminal') { if (!L.terminalLocked) return INVALID_MOVE; L.terminalLocked = false; G.adel.chipDiscard.push('lockdown'); }
    else { if (!L.computerLocked) return INVALID_MOVE; L.computerLocked = false; G.adel.chipDiscard.push('lockdown'); }
    // батарея остаётся в локации
    const [b] = P.inventory.splice(idx, 1);
    L.batteryGuard = true; L.items.push({ id: 'battery', faceUp: true, charge: b.charge });
    log(G, `${CHARACTERS[P.character].name} применяет батарею: блокировка снята, батарея остаётся в локации ${P.pos}.`);
  },

  droneLook: ({ G, playerID }, targetLoc) => {
    if (G.phase !== 'actions') return INVALID_MOVE;
    const P = G.players[playerID];
    if (!P || isAdel(playerID)) return INVALID_MOVE;
    const d = P.inventory.find(x => x.id === 'drone' && x.faceUp && !x.usedThisTurn);
    if (!d) return INVALID_MOVE;
    const L = loc(G, targetLoc);
    if (!L.items.length) return INVALID_MOVE;
    d.usedThisTurn = true;
    P.knownItems[targetLoc] = L.items.map(x => x.id);
    log(G, `${CHARACTERS[P.character].name} направляет дрон в локацию ${targetLoc}.`);
  },

  giveItem: ({ G, playerID }, targetPid, invIndex) => {
    if (G.phase !== 'actions' || isAdel(playerID)) return INVALID_MOVE;
    const P = G.players[playerID], T = G.players[targetPid];
    if (!T || T.dead || P.dead) return INVALID_MOVE;
    if (P.inSpace || T.inSpace || P.pos !== T.pos) return INVALID_MOVE;
    const it = P.inventory[invIndex];
    if (!it) return INVALID_MOVE;
    P.inventory.splice(invIndex, 1);
    T.inventory.push(it);
    enforceCapacity(G, targetPid);
    log(G, `${CHARACTERS[P.character].name} передаёт предмет ${CHARACTERS[T.character].name} (лицом вниз).`);
  },

  shareInfo: ({ G, playerID }, targetPid, on) => {
    // показать колокейтед-союзнику свои маркеры и предметы
    if (isAdel(playerID)) return INVALID_MOVE;
    const P = G.players[playerID], T = G.players[targetPid];
    if (!T || P.inSpace || T.inSpace || P.pos !== T.pos) return INVALID_MOVE;
    G.missions.shares[`${playerID}->${targetPid}`] = on ? P.pos : null;
    log(G, on ? `${CHARACTERS[P.character].name} показывает свои маркеры и предметы ${CHARACTERS[T.character].name}.` : 'Показ прекращён.');
  },

  finishTurn: ({ G, playerID, random }) => {
    if (!canAct(G, playerID)) return INVALID_MOVE;
    const P = G.players[playerID];
    if (P.pendingLabPick || P.pendingMedkit) return INVALID_MOVE;
    P.acted = true;
    P.pendingTake = null;
    G.activeCrew = null;
    log(G, `${CHARACTERS[P.character].name} завершает действия.`);
    maybeEndTurn(G, random);
  },
};

// ---------- playerView: скрытая информация ----------
// Фазы, в которых ширмы уже открыты и планы экипажа видны всем.
const PLANS_OPEN_PHASES = ['reveal', 'actions', 'endturn'];

function playerView({ G, playerID }) {
  const V = JSON.parse(JSON.stringify(G));
  const me = playerID;
  const adel = isAdel(me);

  // Личный журнал — только свой. Иначе через него утекало бы ровно то, ради
  // сокрытия чего он и заведён.
  V.privateLog = me && G.privateLog[me] ? [...G.privateLog[me]] : [];

  // предметы на поле: скрыты; видны — вскрытые, известные игроку, шпионаж для АДЕЛЬ
  for (let l = 1; l <= 20; l++) {
    const L = V.board[l];
    const known = (!adel && me && G.players[me]?.knownItems[l]) || [];
    L.items = L.items.map(it => {
      if (it.faceUp) return it;
      const knownToMe = known.includes(it.id);
      const spyVision = adel && G.board[l].hazards.spy;
      return (knownToMe || spyVision) ? { ...it, known: true } : { id: 'hidden', faceUp: false };
    });
  }

  // инвентари
  for (const pid of Object.keys(V.players)) {
    const P = V.players[pid];
    const real = G.players[pid];
    const sharedToMe = me && G.missions.shares[`${pid}->${me}`] != null &&
      G.missions.shares[`${pid}->${me}`] === real.pos && G.players[me] && G.players[me].pos === real.pos && !G.players[me].inSpace;
    const spyVision = adel && !real.inSpace && G.board[real.pos]?.hazards.spy;
    if (pid !== me && !sharedToMe && !spyVision) {
      P.inventory = real.inventory.map(it => (it.faceUp ? it : { id: 'hidden', faceUp: false }));
    }
    // Знание игрока о предметах на корабле — всегда только его: ни шпионаж, ни
    // обмен в локации не раскрывают чужую карту находок, только инвентарь.
    if (pid !== me) P.knownItems = {};
    // Планы лежат за ширмами до фазы розыгрыша: их не видит никто, включая
    // АДЕЛЬ (она выкладывает фишки вслепую, до того как ширмы открылись).
    if (pid !== me) P.plan = PLANS_OPEN_PHASES.includes(G.phase) ? real.plan : null;
  }

  // маркеры миссий
  for (const slot of Object.keys(V.missions.markers)) {
    const m = V.missions.markers[slot];
    const viewers = G.missions.viewers[slot];
    const sharedToMe = viewers.some(v => {
      const key = `${v}->${me}`;
      return G.missions.shares[key] != null && G.players[v] && G.players[me] &&
        G.players[v].pos === G.players[me].pos && !G.players[v].inSpace && !G.players[me].inSpace;
    });
    if (!m.revealed && !(viewers.includes(me) || sharedToMe)) m.loc = null;
  }

  // АДЕЛЬ: рука, колода, мешочек, заметки шпионажа, аномалии лицом вниз
  if (!adel) {
    V.adel.hand = G.adel.hand.map(() => ({ id: 'hidden' }));
    V.adel.deck = G.adel.deck.length;
    V.adel.discard = G.adel.discard.length;
    V.adel.bag = Object.values(G.adel.bag).reduce((a, b) => a + b, 0);
    V.adel.spyNotes = [];
    V.adel.anomalies = G.adel.anomalies.map(a => (G.anomaliesActive.includes(a) ? a : 'hidden'));
  } else {
    V.adel.deck = G.adel.deck.length;
  }

  // Колода событий: по правилам открыта только верхняя карта. Она не хранится
  // отдельным полем, а выводится здесь — единственный источник истины — иначе
  // правки карты в колоде (отмена терминалом тревоги, перетасовка спецкартой)
  // расходились бы с показанной копией. Остальную колоду не видит никто, иначе
  // обе стороны планируют, зная порядок событий на много ходов вперёд.
  V.nextEvent = G.eventDeck.length ? { ...G.eventDeck[0] } : null;
  V.eventDeck = G.eventDeck.length;

  // Стопка лаборатории: состав видит только тот, кто прямо сейчас из неё
  // выбирает. Иначе по тому, какой предмет исчез, вычисляется чужой тайный
  // выбор — а он по правилам тайный.
  if (!(me && G.players[me]?.pendingLabPick)) V.labStack = G.labStack.length;

  return V;
}

// Внутренние помощники консоли — открыты только для тестов.
export const __testing = { consoleAddChip, consoleTopCost, consoleTakeChip };

// Правила выкладывания фишки картой открыты интерфейсу намеренно: подсказки
// в панели АДЕЛЬ должны считать законные цели ровно тем же кодом, которым ход
// потом проверит движок. Иначе интерфейс предлагает то, что будет отклонено.
export { hazardCardRules, consoleFree };

export const Adel = {
  name: 'adel',
  minPlayers: MIN_TABLE,
  maxPlayers: MAX_TABLE,
  setup,
  playerView,
  turn: { activePlayers: { all: 'main' }, minMoves: 0, maxMoves: 1e9 },
  // client: false — ходы исполняются только на сервере: клиентское состояние
  // отфильтровано playerView и не годится для вычисления скрытой информации
  // redact: true — аргументы хода вырезаются из журнала, который boardgame.io
  // рассылает остальным клиентам. Без этого playerView бесполезен: АДЕЛЬ
  // читала бы планы экипажа прямо из лога commitPlan.
  moves: Object.fromEntries(Object.entries(moves).map(([k, f]) => [k, { move: f, client: false, redact: true }])),
  endIf: ({ G }) => (G.winner ? { winner: G.winner } : undefined),
  disableUndo: true,
};
