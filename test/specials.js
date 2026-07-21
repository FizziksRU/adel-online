// Специальные карты АДЕЛЬ — семь штук, замешанных в общую колоду.
// Каждая проверяется точечно: что валидирует движок, сколько списывается
// энергии и что попадает в журнал. Движок вызывается напрямую, без
// boardgame.io, случайность скриптована.
import { Adel } from '../src/game/index.js';
import {
  HAZARDS, HAZARD_NAMES, ADEL_SPECIALS, SPECIAL_ENERGY_GAIN, SPECIAL_REDRAW_MAX,
  SPECIAL_RECHIP_MAX, SPREAD_HAZARDS, ENERGY_MAX, SECTOR_OF, SECTORS, EVENTS,
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

const mv = (name) => Adel.moves[name].move;
const spec = (id) => {
  const c = ADEL_SPECIALS.find(x => x.id === id);
  if (!c) throw new Error(`в наборе нет специальной карты ${id}`);
  return { ...c };
};

// Фаза АДЕЛЬ с заданной картой на руке, чистым полем и пустой консолью.
function adelReady(cardId, { energy = 50 } = {}) {
  const G = Adel.setup({ ctx: { numPlayers: 4 }, random: makeRandom() });
  clearBoard(G);
  G.phase = 'adel';
  G.adel.energy = energy;
  G.adel.console = Object.fromEntries(HAZARDS.map(h => [h, []]));
  G.adel.chipDiscard = [];
  G.adel.hand = [spec(cardId)];
  G.adel.discard = [];
  return G;
}
const play = (G, cardId, payload, random = makeRandom()) =>
  mv('adelPlayCard')({ G, playerID: '0', random }, cardId, payload);

// ============================================================
// Общее для всех карт: фаза, роль, уход карты в сброс
// ============================================================
{
  const G = adelReady('S_energy');
  G.phase = 'actions';
  const r = play(G, 'S_energy', {});
  assert(r === 'INVALID_MOVE', 'вне фазы АДЕЛЬ специальная карта не играется');
  assert(G.adel.hand.length === 1, 'карта осталась на руке');

  G.phase = 'adel';
  const r2 = mv('adelPlayCard')({ G, playerID: '1', random: makeRandom() }, 'S_energy', {});
  assert(r2 === 'INVALID_MOVE', 'член экипажа не может играть карты АДЕЛЬ');
}
{
  // набор карт: семь штук, идентификаторы известны движку
  assert(ADEL_SPECIALS.length === 7, `специальных карт ${ADEL_SPECIALS.length}, должно быть 7`);
  for (const c of ADEL_SPECIALS) {
    const G = adelReady(c.id, { energy: 0 });
    const r = play(G, c.id, {});
    assert(r === 'INVALID_MOVE' || G.adel.hand.length === 0,
      `карта «${c.name}» неизвестна движку — ход ни отклонён, ни исполнен`);
  }
}

// ============================================================
// 1. «Подзарядка» — прибавить 5 энергии
// ============================================================
{
  const G = adelReady('S_energy', { energy: 10 });
  play(G, 'S_energy', {});
  assert(G.adel.energy === 10 + SPECIAL_ENERGY_GAIN, `энергия ${G.adel.energy}, ожидалось 15`);
  assert(G.adel.hand.length === 0 && G.adel.discard.length === 1, 'сыгранная карта ушла в сброс');
  assert(G.adel.discard[0].id === 'S_energy', 'в сбросе именно сыгранная карта');
}
{
  // предел энергии не перепрыгивается
  const G = adelReady('S_energy', { energy: ENERGY_MAX - 2 });
  play(G, 'S_energy', {});
  assert(G.adel.energy === ENERGY_MAX, `энергия ${G.adel.energy}, потолок ${ENERGY_MAX}`);
}

// ============================================================
// 2. «Перегрузка сектора» — фишка в сектор цвета текущего события
// ============================================================
{
  const G = adelReady('S_color');
  G.currentEvent = { id: 'silence', color: 'green', uid: 1, cancelled: false };
  G.adel.console.fire = [5];
  const wrong = SECTORS.blue[0];
  const r = play(G, 'S_color', { type: 'fire', target: { loc: wrong } });
  assert(r === 'INVALID_MOVE', 'локация чужого цвета отклоняется');
  assert(G.board[wrong].hazards.fire === false, 'фишка не выложена');
  assert(G.adel.energy === 50, 'энергия при отказе не списана');

  const right = SECTORS.green[0];
  play(G, 'S_color', { type: 'fire', target: { loc: right } });
  assert(G.board[right].hazards.fire === true, 'фишка выложена в сектор цвета события');
  assert(SECTOR_OF[right] === G.currentEvent.color, 'цвет локации совпал с цветом события');
  assert(G.adel.energy === 45, `списана только консольная цена 5⚡, осталось ${G.adel.energy}`);
  assert(G.adel.console.fire.length === 0, 'фишка снята с консоли');
}

// ============================================================
// 3. «Восстановление данных» — карта из сброса на верх колоды
// ============================================================
{
  const G = adelReady('S_recall');
  const card = spec('S_recall');
  G.adel.discard = [
    { id: 'D1', type: 'loc', locs: [1, 6] },
    { id: 'D2', type: 'loc', locs: [2, 7] },
  ];
  G.adel.deck = [{ id: 'D3', type: 'loc', locs: [3, 8] }];

  const bad = play(G, 'S_recall', { cardId: 'НЕТ_ТАКОЙ' });
  assert(bad === 'INVALID_MOVE', 'карты, которой нет в сбросе, не вернуть');
  assert(G.adel.energy === 50, 'энергия при отказе не списана');

  play(G, 'S_recall', { cardId: 'D2' });
  assert(G.adel.deck[0].id === 'D2', 'выбранная карта легла на верх колоды');
  assert(G.adel.deck[1].id === 'D3', 'остальная колода не перемешана');
  assert(!G.adel.discard.some(c => c.id === 'D2'), 'карта ушла из сброса');
  assert(G.adel.discard.some(c => c.id === 'S_recall'), 'сама карта легла в сброс');
  assert(G.adel.energy === 50 - card.cost, `списано ${card.cost}⚡, осталось ${G.adel.energy}`);
  assert(!G.log.at(-1).includes('D2'), 'журнал не называет восстановленную карту');
}

// ============================================================
// 4. «Распространение» — пожар/гипоксия рядом с такой же фишкой,
//    за свою цену вместо консольной
// ============================================================
{
  const G = adelReady('S_spread');
  const card = spec('S_spread');
  G.adel.console.fire = [5];
  G.board[2].hazards.fire = true;               // 2 соседствует с 1, 3, 6

  const far = play(G, 'S_spread', { type: 'fire', target: { loc: 9 } });
  assert(far === 'INVALID_MOVE', 'локация без соседнего пожара отклоняется');
  assert(G.board[9].hazards.fire === false, 'фишка не выложена');

  play(G, 'S_spread', { type: 'fire', target: { loc: 3 } });
  assert(G.board[3].hazards.fire === true, 'пожар распространился в соседнюю локацию');
  // Своя цена ВМЕСТО консольной: с консоли снимается самая дорогая фишка вида,
  // но её цена не списывается — иначе выкладывание стоило бы 8⚡ и картой никто
  // не пользовался бы.
  assert(G.adel.energy === 50 - card.cost,
    `списана только своя цена ${card.cost}⚡, осталось ${G.adel.energy}`);
  assert(G.adel.console.fire.length === 0, 'фишка всё равно снята с консоли');
}
{
  // Фишка обязана лежать на консоли, даже когда её цена не платится: иначе
  // «Распространение» выкладывало бы опасности из воздуха.
  const G = adelReady('S_spread');
  G.adel.console.fire = [];                     // на консоли пожара нет
  G.board[2].hazards.fire = true;
  const r = play(G, 'S_spread', { type: 'fire', target: { loc: 3 } });
  assert(r === 'INVALID_MOVE', 'без фишки на консоли расселять нечего');
  assert(G.board[3].hazards.fire === false, 'фишка не выложена');
  assert(G.adel.energy === 50, 'энергия не списана');
}
{
  // Расселять можно только пожар и гипоксию. Проверяем на случае, где все
  // остальные условия выполнены: тьма лежит рядом и есть на консоли, — иначе
  // отказ нельзя отличить от отказа по соседству.
  const G = adelReady('S_spread');
  G.adel.console.darkness = [6];
  G.board[2].hazards.darkness = true;           // 2 соседствует с 3
  const r = play(G, 'S_spread', { type: 'darkness', target: { loc: 3 } });
  assert(r === 'INVALID_MOVE', 'карта расселяет только пожар и гипоксию');
  assert(G.board[3].hazards.darkness === false, 'чужая фишка не выложена');
  assert(G.adel.energy === 50, 'энергия при отказе не списана');
  assert(!SPREAD_HAZARDS.includes('darkness'), 'тьма не числится расселяемой');
}
{
  // гипоксия работает так же, и вид фишки берётся свой, а не «какой лежит»
  const G = adelReady('S_spread');
  G.adel.console.hypoxia = [7];
  G.board[6].hazards.hypoxia = true;            // 6 соседствует с 2, 5, 7
  play(G, 'S_spread', { type: 'hypoxia', target: { loc: 7 } });
  assert(G.board[7].hazards.hypoxia === true, 'гипоксия распространилась');
  assert(SPREAD_HAZARDS.includes('hypoxia'), 'гипоксия числится расселяемой');
}
{
  // соседство считается по своему виду: рядом пожар, а кладём гипоксию
  const G = adelReady('S_spread');
  G.adel.console.hypoxia = [7];
  G.board[2].hazards.fire = true;
  const r = play(G, 'S_spread', { type: 'hypoxia', target: { loc: 3 } });
  assert(r === 'INVALID_MOVE', 'соседний пожар не разрешает выложить гипоксию');
  assert(G.board[3].hazards.hypoxia === false, 'фишка не выложена');
}

// ============================================================
// 5. «Пересборка руки» — сбросить эту карту и до трёх других
// ============================================================
{
  const G = adelReady('S_redraw');
  const card = spec('S_redraw');
  G.adel.hand = [spec('S_redraw'),
    { id: 'H1', type: 'loc', locs: [1, 6] },
    { id: 'H2', type: 'loc', locs: [2, 7] },
    { id: 'H3', type: 'loc', locs: [3, 8] }];
  G.adel.deck = [1, 2, 3, 4, 5].map(i => ({ id: `N${i}`, type: 'loc', locs: [i, i + 5] }));

  const tooMany = play(G, 'S_redraw', { cardIds: ['H1', 'H2', 'H3', 'S_redraw'] });
  assert(tooMany !== 'INVALID_MOVE',
    'сама карта в списке не считается лишней — она сбрасывается в любом случае');
  assert(G.adel.hand.length === 4, 'рука прежнего размера: сброшено четыре, взято четыре');
  assert(G.adel.hand.every(c => c.id.startsWith('N')), 'на руке только свежие карты');
  assert(G.adel.deck.length === 1, 'из колоды взято четыре карты');
  assert(G.adel.discard.length === 4, 'в сбросе сама карта и три с руки');
  assert(G.adel.energy === 50 - card.cost, `списано ${card.cost}⚡`);
}
{
  // карты, которой нет на руке, не сбросить
  const G = adelReady('S_redraw');
  G.adel.hand = [spec('S_redraw'), { id: 'H1', type: 'loc', locs: [1, 6] }];
  G.adel.deck = [{ id: 'N1', type: 'loc', locs: [2, 7] }];
  const r = play(G, 'S_redraw', { cardIds: ['ЧУЖАЯ'] });
  assert(r === 'INVALID_MOVE', 'нельзя сбросить карту, которой нет на руке');
  assert(G.adel.hand.length === 2, 'рука не тронута');
  assert(G.adel.energy === 50, 'энергия при отказе не списана');
}
{
  // больше трёх карт сверх самой сбрасываемой — отказ
  const G = adelReady('S_redraw');
  G.adel.hand = [spec('S_redraw'),
    { id: 'H1', type: 'loc', locs: [1, 6] }, { id: 'H2', type: 'loc', locs: [2, 7] },
    { id: 'H3', type: 'loc', locs: [3, 8] }, { id: 'H4', type: 'loc', locs: [4, 9] }];
  const r = play(G, 'S_redraw', { cardIds: ['H1', 'H2', 'H3', 'H4'] });
  assert(r === 'INVALID_MOVE', `сверх самой карты сбрасывается не больше ${SPECIAL_REDRAW_MAX}`);
  assert(G.adel.hand.length === 5, 'рука не тронута');
}
{
  // можно сыграть и в одиночку: сбрасывается только сама карта
  const G = adelReady('S_redraw');
  G.adel.hand = [spec('S_redraw'), { id: 'H1', type: 'loc', locs: [1, 6] }];
  G.adel.deck = [{ id: 'N1', type: 'loc', locs: [2, 7] }];
  play(G, 'S_redraw', { cardIds: [] });
  assert(G.adel.hand.length === 2, 'сброшена одна карта, взята одна');
  assert(G.adel.hand.some(c => c.id === 'N1'), 'добрана карта из колоды');
  assert(G.adel.hand.some(c => c.id === 'H1'), 'прочие карты руки остались');
}
{
  // колода кончилась — в дело идёт перетасованный сброс, включая только что
  // сброшенные карты
  const G = adelReady('S_redraw');
  G.adel.hand = [spec('S_redraw'), { id: 'H1', type: 'loc', locs: [1, 6] }];
  G.adel.deck = [];
  G.adel.discard = [];
  play(G, 'S_redraw', { cardIds: ['H1'] });
  assert(G.adel.hand.length === 2, 'взято столько же, сколько сброшено');
  assert(G.adel.deck.length + G.adel.discard.length === 0,
    'обе сброшенные карты вернулись в руку через перетасовку');
}

// ============================================================
// 6. «Дефрагментация» — до трёх фишек из сброса обратно на консоль
// ============================================================
{
  const G = adelReady('S_rechip');
  const card = spec('S_rechip');
  G.adel.chipDiscard = ['fire', 'fire', 'spy', 'darkness'];

  const tooMany = play(G, 'S_rechip', { chips: ['fire', 'fire', 'spy', 'darkness'] });
  assert(tooMany === 'INVALID_MOVE', `за раз возвращается не больше ${SPECIAL_RECHIP_MAX} фишек`);

  const none = play(G, 'S_rechip', { chips: [] });
  assert(none === 'INVALID_MOVE', 'пустая заявка отклоняется');

  const notInDiscard = play(G, 'S_rechip', { chips: ['hypoxia'] });
  assert(notInDiscard === 'INVALID_MOVE', 'фишки, которой нет в сбросе, не вернуть');

  const tooManyOfKind = play(G, 'S_rechip', { chips: ['spy', 'spy'] });
  assert(tooManyOfKind === 'INVALID_MOVE', 'в сбросе только одна фишка шпионажа');
  assert(G.adel.energy === 50, 'энергия при отказах не списана');
  assert(G.adel.chipDiscard.length === 4, 'сброс фишек при отказах не тронут');

  play(G, 'S_rechip', { chips: ['fire', 'spy', 'darkness'] });
  assert(G.adel.console.fire.length === 1, 'пожар вернулся на консоль');
  assert(G.adel.console.spy.length === 1, 'шпионаж вернулся на консоль');
  assert(G.adel.console.darkness.length === 1, 'тьма вернулась на консоль');
  assert(G.adel.chipDiscard.length === 1 && G.adel.chipDiscard[0] === 'fire',
    'в сбросе остался лишний пожар');
  assert(G.adel.energy === 50 - card.cost, `списано ${card.cost}⚡`);
  // фишки ложатся по обычному правилу — в самые дешёвые свободные ячейки
  assert(G.adel.console.spy[0] === 2, `шпионаж занял ячейку ${G.adel.console.spy[0]}, ожидалась 2⚡`);
  assert(G.adel.console.fire[0] === 3, `пожар занял ячейку ${G.adel.console.fire[0]}, ожидалась 3⚡`);
}
{
  // ячеек не хватает — ход отклоняется целиком, а не выкладывает часть
  const G = adelReady('S_rechip');
  G.adel.console.spy = [2, 2, 2, 3, 3, 4];       // все шесть ячеек шпионажа заняты
  G.adel.chipDiscard = ['spy', 'fire'];
  const r = play(G, 'S_rechip', { chips: ['fire', 'spy'] });
  assert(r === 'INVALID_MOVE', 'при нехватке ячеек ход отклоняется');
  assert(G.adel.console.fire.length === 0, 'ни одна фишка из заявки не выложена');
  assert(G.adel.chipDiscard.length === 2, 'сброс фишек не тронут');
}

// ============================================================
// 7. «Пересчёт вероятностей» — перетасовать колоду событий
// ============================================================
{
  const G = adelReady('S_reshuffle');
  const card = spec('S_reshuffle');
  G.eventDeck = ['collision', 'stress', 'drift', 'maneuver'].map((id, i) =>
    ({ id, color: 'green', uid: i, cancelled: false }));
  G.eventDeck[0].cancelled = true;               // экипаж успел включить терминал тревоги
  const before = G.eventDeck.map(c => c.uid).join(',');

  const rnd = makeRandom();
  rnd.Shuffle = (a) => [...a].reverse();         // видимая перетасовка
  play(G, 'S_reshuffle', {}, rnd);

  assert(G.eventDeck.map(c => c.uid).join(',') !== before, 'колода событий перетасована');
  assert(G.eventDeck.length === 4, 'ни одна карта событий не потерялась');
  assert(G.eventDeck.every(c => !c.cancelled), 'отмена от терминала тревоги пропала');
  assert(G.adel.energy === 50 - card.cost, `списано ${card.cost}⚡`);
  assert(G.log.at(-1).includes(EVENTS[G.eventDeck[0].id].name),
    'журнал объявляет новое следующее событие');
  assert(G.log.at(-1).includes('Отмена события пропала'), 'журнал сообщает о потере отмены');
}
{
  // без отмены отдельной строки в журнале нет
  const G = adelReady('S_reshuffle');
  G.eventDeck = [{ id: 'stress', color: 'green', uid: 0, cancelled: false }];
  play(G, 'S_reshuffle', {});
  assert(!G.log.at(-1).includes('Отмена события пропала'),
    'когда отменять было нечего, о потере отмены не сообщается');
}
{
  // пустая колода событий — отказ
  const G = adelReady('S_reshuffle');
  G.eventDeck = [];
  const r = play(G, 'S_reshuffle', {});
  assert(r === 'INVALID_MOVE', 'пустую колоду событий не перетасовать');
  assert(G.adel.energy === 50, 'энергия при отказе не списана');
}

// ============================================================
// Нехватка энергии и скрытая информация
// ============================================================
{
  for (const c of ADEL_SPECIALS.filter(x => x.cost > 0)) {
    const G = adelReady(c.id, { energy: c.cost - 1 });
    G.adel.discard = [{ id: 'D1', type: 'loc', locs: [1, 6] }];
    G.eventDeck = [{ id: 'stress', color: 'green', uid: 0, cancelled: false }];
    G.adel.chipDiscard = ['fire'];
    const r = play(G, c.id, { cardId: 'D1', cardIds: [], chips: ['fire'] });
    assert(r === 'INVALID_MOVE', `«${c.name}» без ${c.cost}⚡ не играется`);
    assert(G.adel.hand.length === 1, `«${c.name}» осталась на руке`);
  }
}
{
  // Специальные карты лежат в общей руке — экипаж не должен видеть, какие
  // именно карты у АДЕЛЬ и что лежит в её сбросе.
  const G = Adel.setup({ ctx: { numPlayers: 4 }, random: makeRandom() });
  G.adel.hand = [spec('S_reshuffle'), spec('S_energy')];
  G.adel.discard = [spec('S_recall')];
  const crew = Adel.playerView({ G, playerID: '1' });
  assert(crew.adel.hand.every(c => c.id === 'hidden'),
    'экипаж не видит специальных карт в руке АДЕЛЬ');
  assert(typeof crew.adel.discard === 'number', 'состав сброса АДЕЛЬ скрыт от экипажа');
  assert(crew.adel.specials === undefined, 'отдельной выкладки специальных карт нет и в виде');

  const own = Adel.playerView({ G, playerID: '0' });
  assert(own.adel.hand.some(c => c.id === 'S_reshuffle'), 'свою руку АДЕЛЬ видит');
  assert(own.adel.discard.some(c => c.id === 'S_recall'), 'свой сброс АДЕЛЬ видит');
}
{
  // Следующее событие выводится из колоды, а не хранится копией: правка
  // верхней карты видна сразу и обеим сторонам.
  const G = Adel.setup({ ctx: { numPlayers: 4 }, random: makeRandom() });
  assert(G.nextEvent === undefined, 'отдельного поля nextEvent в состоянии нет');
  G.eventDeck[0].cancelled = true;
  for (const pid of ['0', '1']) {
    const V = Adel.playerView({ G, playerID: pid });
    assert(V.nextEvent && V.nextEvent.id === G.eventDeck[0].id,
      `игрок ${pid} видит верхнюю карту колоды событий`);
    assert(V.nextEvent.cancelled === true, `отмена события видна игроку ${pid}`);
  }
  G.eventDeck = [];
  assert(Adel.playerView({ G, playerID: '0' }).nextEvent === null,
    'при пустой колоде следующего события нет');
}
{
  // Виды фишек в названиях: журнал «Дефрагментации» пишет русские имена.
  const G = adelReady('S_rechip');
  G.adel.chipDiscard = ['lockdown'];
  play(G, 'S_rechip', { chips: ['lockdown'] });
  assert(G.log.at(-1).includes(HAZARD_NAMES.lockdown), 'журнал называет фишку по-русски');
}

if (failed) { console.error(`\nSPECIALS: провалено проверок — ${failed}`); process.exit(1); }
console.log('SPECIALS OK ✓');
