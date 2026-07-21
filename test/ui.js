// Дымовой тест интерфейса: настоящий компонент Board рендерится в строку.
// Ловит то, что не видно ни движковым тестам, ни сборке: падения на реальном
// состоянии, обращения к полям, которых больше нет, и предупреждения React
// вроде обновления состояния прямо во время рендера.
//
// JSX превращает в модуль сам Vite (ssrLoadModule) — отдельной сборки и новых
// зависимостей для этого не нужно.
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { Adel } from '../src/game/index.js';
import { ADEL_SPECIALS, HAZARDS, SECTORS, SECTOR_NAMES, SPACE_ADJ, SPACE_NAMES } from '../src/game/data.js';

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

// Любой вызов moves в тесте — заглушка: мы проверяем рендер, а не ходы.
const movesStub = new Proxy({}, { get: () => () => {} });

// Предупреждения React (в том числе «обновление состояния во время рендера»)
// уходят в console.error — перехватываем и считаем провалом.
const reactWarnings = [];
const realError = console.error;
console.error = (...args) => {
  const text = args.map(a => (a && a.stack) || String(a)).join(' ');
  if (text.startsWith('FAIL:')) { realError(...args); return; }
  reactWarnings.push(text);
};

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const { Board } = await vite.ssrLoadModule('/src/client/Board.jsx');
const { AdelCardPicker } = await vite.ssrLoadModule('/src/client/AdelCards.jsx');

// React разделяет соседние текстовые узлы комментариями <!-- -->, из-за чего
// «Локация {l}» приезжает как «Локация <!-- -->4». Для проверок это шум.
const strip = (html) => html.split('<!-- -->').join('');

const render = (G, playerID) =>
  strip(renderToString(React.createElement(Board, { G, ctx: {}, moves: movesStub, playerID })));
const viewFor = (G, pid) => Adel.playerView({ G, playerID: pid });

// Кнопка с заданной подписью целиком — чтобы проверять именно её атрибуты,
// а не наличие слова disabled где-то на всей странице.
const buttonWith = (html, text) => {
  const end = html.indexOf('>' + text + '</button>');
  if (end < 0) return null;
  return html.slice(html.lastIndexOf('<button', end), end + 1);
};

const baseG = () => {
  const G = Adel.setup({ ctx: { numPlayers: 4 }, random: makeRandom() });
  for (let l = 1; l <= 20; l++) {
    const L = G.board[l];
    L.damage = false; L.computerLocked = false; L.terminalLocked = false;
    L.doors = []; L.hatchClosed = false;
    for (const h of HAZARDS) L.hazards[h] = false;
  }
  return G;
};

// --- панель АДЕЛЬ: на руке все семь специальных карт ---
{
  const G = baseG();
  G.phase = 'adel';
  G.adel.hand = ADEL_SPECIALS.map(c => ({ ...c }));
  G.adel.discard = [{ id: 'D1', type: 'loc', locs: [1, 6] }];
  G.adel.chipDiscard = ['fire', 'spy'];
  const html = render(viewFor(G, '0'), '0');

  for (const c of ADEL_SPECIALS) {
    assert(html.includes(c.name), `в руке АДЕЛЬ показана карта «${c.name}»`);
  }
  assert(html.includes('Консоль АДЕЛЬ'), 'панель консоли на месте');
  assert(!html.includes('undefined'), 'в разметке нет undefined — значит, все поля состояния существуют');

  const btn = buttonWith(html, `★ ${ADEL_SPECIALS[0].name}`);
  assert(btn && !btn.includes('disabled'), 'в свою фазу АДЕЛЬ карты на руке доступны');
}

// --- панель АДЕЛЬ вне своей фазы: карты видны, но заблокированы ---
{
  const G = baseG();
  G.phase = 'actions';
  G.adel.hand = ADEL_SPECIALS.map(c => ({ ...c }));
  const html = render(viewFor(G, '0'), '0');
  assert(html.includes('Рука'), 'рука АДЕЛЬ отображается и вне её фазы');
  const btn = buttonWith(html, `★ ${ADEL_SPECIALS[0].name}`);
  assert(btn && btn.includes('disabled'), 'вне фазы АДЕЛЬ кнопка карты заблокирована');
}

// --- вид экипажа: карты АДЕЛЬ не раскрываются ---
{
  const G = baseG();
  G.phase = 'planning';
  G.adel.hand = ADEL_SPECIALS.map(c => ({ ...c }));
  const html = render(viewFor(G, '1'), '1');
  assert(html.includes('Планирование'), 'экипажу показана панель планирования');
  for (const c of ADEL_SPECIALS) {
    assert(!html.includes(c.name), `экипаж не видит названия карты «${c.name}»`);
  }
  assert(!html.includes('undefined'),
    'у экипажа не отрисовываются закрытые карты АДЕЛЬ (иначе в разметке был бы undefined)');
}

// ============================================================
// Панель выбранной карты — по каждому состоянию выбора
// ============================================================
const picker = (G, sel) =>
  strip(renderToString(React.createElement(AdelCardPicker, { G, sel, setSel: () => {}, moves: movesStub })));

const adelView = (mutate) => {
  const G = baseG();
  G.phase = 'adel';
  mutate(G);
  return viewFor(G, '0');
};
const specialCard = (id) => ({ ...ADEL_SPECIALS.find(c => c.id === id) });

// Каждая из семи карт открывает свою панель и ничем не падает.
{
  for (const c of ADEL_SPECIALS) {
    const V = adelView(G => {
      G.adel.hand = [{ ...c }, { id: 'H1', type: 'loc', locs: [1, 6] }];
      G.adel.discard = [{ id: 'D1', type: 'loc', locs: [2, 7] }];
      G.adel.chipDiscard = ['fire', 'spy'];
      G.adel.console.fire = [5];
      G.board[2].hazards.fire = true;
    });
    const html = picker(V, { kind: 'adelCard', card: { ...c } });
    assert(html.includes(c.name), `панель карты «${c.name}» открывается`);
    assert(!html.includes('интерфейсу неизвестна'), `карта «${c.name}» интерфейсу известна`);
    assert(!html.includes('undefined'), `в панели карты «${c.name}» нет undefined`);
  }
}

// Карта локаций: предлагаются только две её локации.
{
  const V = adelView(G => { G.adel.console.fire = [5]; });
  const card = { id: 'L1', type: 'loc', locs: [4, 9] };
  const html = picker(V, { kind: 'adelCard', card, hz: 'fire' });
  assert(html.includes('Локация 4') && html.includes('Локация 9'), 'предложены обе локации карты');
  assert(!html.includes('Локация 5'), 'чужие локации не предлагаются');
}

// «Распространение»: цена — только своя (консольная не платится), цели только
// рядом с такой же фишкой, и только пожар с гипоксией.
{
  const card = specialCard('S_spread');
  const V = adelView(G => {
    G.adel.console.fire = [5];
    G.adel.console.darkness = [6];
    G.board[2].hazards.fire = true;             // 2 соседствует с 1, 3, 6
    G.board[2].hazards.darkness = true;
  });
  const types = picker(V, { kind: 'adelCard', card });
  // У этой карты своя цена ВМЕСТО консольной: фишка на консоли стоит 5⚡, но
  // в подсказке должны быть только 3⚡ самой карты.
  assert(types.includes(`(−${card.cost}⚡)`),
    `в подсказке цена ${card.cost}⚡ — только своя, без консольной`);
  assert(!types.includes('(−8⚡)'), 'консольная цена сверх своей не приплюсована');
  assert(!types.includes('Тьма'), 'тьму эта карта не расселяет');

  const locs = picker(V, { kind: 'adelCard', card, hz: 'fire' });
  for (const l of [1, 3, 6]) assert(locs.includes(`Локация ${l}`), `соседняя локация ${l} предложена`);
  assert(!locs.includes('Локация 9'), 'локация без соседнего пожара не предложена');
}

// «Перегрузка сектора»: цели — только сектор цвета текущего события.
{
  const V = adelView(G => {
    G.adel.console.fire = [5];
    G.currentEvent = { id: 'silence', color: 'green', uid: 1, cancelled: false };
  });
  const html = picker(V, { kind: 'adelCard', card: specialCard('S_color'), hz: 'fire' });
  for (const l of SECTORS.green) assert(html.includes(`Локация ${l}`), `зелёная локация ${l} предложена`);
  for (const l of SECTORS.blue) assert(!html.includes(`Локация ${l}`), `синяя локация ${l} не предложена`);
}

// «Восстановление данных»: перечислен сброс; при пустом сбросе — понятный отказ.
{
  const V = adelView(G => { G.adel.discard = [{ id: 'D1', type: 'loc', locs: [2, 7] }]; });
  const html = picker(V, { kind: 'adelCard', card: specialCard('S_recall') });
  assert(html.includes('Локации 2 / 7'), 'карта из сброса предложена к возврату');

  const empty = picker(adelView(G => { G.adel.discard = []; }), { kind: 'adelCard', card: specialCard('S_recall') });
  assert(empty.includes('Сброс пуст'), 'при пустом сбросе объяснено, почему выбирать нечего');
}

// «Пересборка руки»: предлагаются прочие карты руки, отметить можно не больше трёх.
{
  const card = specialCard('S_redraw');
  const V = adelView(G => {
    G.adel.hand = [{ ...card }, ...[1, 2, 3, 4].map(i => ({ id: `H${i}`, type: 'loc', locs: [i, i + 5] }))];
  });
  const html = picker(V, { kind: 'adelCard', card });
  assert(!html.includes(`★ ${card.name}</button>`), 'сама карта в списке на сброс не предлагается');
  assert(html.includes('Локации 1 / 6') && html.includes('Локации 4 / 9'), 'предложены прочие карты руки');

  const full = picker(V, { kind: 'adelCard', card, picked: ['H1', 'H2', 'H3'] });
  const btn = buttonWith(full, 'Локации 4 / 9');
  assert(btn && btn.includes('disabled'), 'четвёртую карту отметить уже нельзя');
  assert(full.includes('Сбросить 4 и взять столько же'), 'посчитано, сколько карт уйдёт и придёт');
}

// «Дефрагментация»: видно и запас в сбросе, и свободные ячейки консоли.
{
  const card = specialCard('S_rechip');
  const V = adelView(G => { G.adel.chipDiscard = ['fire', 'fire', 'spy']; });
  const html = picker(V, { kind: 'adelCard', card });
  assert(html.includes('Пожар') && html.includes('Шпионаж'), 'перечислены виды фишек из сброса');

  // консоль забита: возвращать некуда, кнопка вида должна быть заблокирована
  const full = adelView(G => {
    G.adel.chipDiscard = ['spy'];
    G.adel.console.spy = [2, 2, 2, 3, 3, 4];
  });
  const btn = buttonWith(picker(full, { kind: 'adelCard', card }), '+ Шпионаж · в сбросе 1, свободных ячеек 0');
  assert(btn && btn.includes('disabled'), 'при забитой консоли возврат фишки заблокирован');
}

// --- наблюдатель: экран не падает без своего игрока ---
{
  const G = baseG();
  G.phase = 'actions';
  // playerID, которого нет за столом (наблюдатель или чужая ссылка)
  const html = render(viewFor(G, '9'), '9');
  assert(html.includes('Консоль АДЕЛЬ'), 'наблюдателю показывается поле, а не белый экран');
  assert(!html.includes('Ваш ход'), 'панели хода у наблюдателя нет');
}

// --- перегруз инвентаря: панель сброса ---
{
  const G = baseG();
  G.phase = 'actions';
  const pid = Object.keys(G.players)[0];
  G.activeCrew = pid;
  const P = G.players[pid];
  P.plan = { move: 4, search: 0, activate: 0, special: 0, door: 0, spent: { move: 0, search: 0, activate: 0, special: 0, door: 0 } };
  P.inventory = ['teddy', 'medkit', 'parts', 'stims', 'axe'].map(id => ({ id, faceUp: false }));
  P.pendingDrop = 1;
  const html = render(viewFor(G, pid), pid);
  assert(html.includes('Перегруз'), 'игроку объяснили, что инвентарь перегружен');
  assert(buttonWith(html, 'Сбросить: Плюшевый мишка'), 'предметы предложены к сбросу поимённо');
  assert(buttonWith(html, 'Сбросить: Топор'), 'ключевой предмет тоже можно выбрать — решает игрок');
}

// --- поиск: осмотр, затем выбор «взять или оставить» ---
{
  const G = baseG();
  G.phase = 'actions';
  const pid = Object.keys(G.players)[0];
  G.activeCrew = pid;
  const P = G.players[pid];
  P.pos = 5; P.inSpace = null; P.inventory = []; P.pendingDrop = 0; P.pendingTake = null;
  P.plan = { move: 0, search: 4, activate: 0, special: 0, door: 0, spent: { move: 0, search: 0, activate: 0, special: 0, door: 0 } };
  G.board[5].items = [{ id: 'extinguisher', faceUp: false }];

  const before = render(viewFor(G, pid), pid);
  assert(before.includes('▩ не осмотрено'), 'до осмотра предмет закрыт');
  assert(!before.includes('Взять:'), 'до осмотра выбора «взять» нет');
  const searchBtn = buttonWith(before, '🔍 Поиск (осмотреть локацию)');
  assert(searchBtn && !searchBtn.includes('disabled'), 'поиск доступен');

  // движок отработал осмотр
  Adel.moves.actSearch.move({ G, playerID: pid }, false);
  const after = render(viewFor(G, pid), pid);
  assert(after.includes('Забрать предмет?'), 'после осмотра предложено решение');
  assert(buttonWith(after, 'Взять: Огнетушитель'), 'предмет назван и предложен к взятию');
  assert(buttonWith(after, 'Оставить на месте'), 'от находки можно отказаться');
  assert(after.includes('Кубик уже потрачен'),
    'игроку сказано, что решение входит в то же действие');
  const again = buttonWith(after, '🔍 Поиск (осмотреть локацию)');
  assert(again && again.includes('disabled'), 'повторно осматривать ту же локацию нечего');
}

// --- личный журнал виден только своему игроку ---
{
  const G = baseG();
  G.phase = 'actions';
  const [pid, other] = Object.keys(G.players);
  G.privateLog = { [pid]: ['«Топор» в локации 5: неверная локация'] };
  const mine = render(viewFor(G, pid), pid);
  assert(mine.includes('Только вам'), 'панель личного журнала показана');
  assert(mine.includes('неверная локация'), 'своя запись видна');
  const theirs = render(viewFor(G, other), other);
  assert(!theirs.includes('неверная локация'), 'чужая запись не видна напарнику');
  const adel = render(viewFor(G, '0'), '0');
  assert(!adel.includes('неверная локация'), 'и АДЕЛЬ её не видит');
}

// --- окно «Атаки» в фазе событий ---
{
  const G = baseG();
  G.phase = 'event';
  G.anomaliesActive = ['attack'];
  G.attackUsedThisTurn = false;
  const html = render(viewFor(G, '0'), '0');
  const btn = buttonWith(html, `⚔ Атака: фишка в сектор цвета события (${SECTOR_NAMES[G.currentEvent.color]})`);
  assert(btn && !btn.includes('disabled'), 'в окне фазы событий «Атака» доступна');
  assert(html.includes('Закрыть окно атаки'), 'есть кнопка закрыть окно и пустить экипаж планировать');

  G.phase = 'adel';
  const later = render(viewFor(G, '0'), '0');
  const btn2 = buttonWith(later, `⚔ Атака: фишка в сектор цвета события (${SECTOR_NAMES[G.currentEvent.color]})`);
  assert(btn2 && btn2.includes('disabled'), 'вне окна «Атака» заблокирована');
  assert(!later.includes('Закрыть окно атаки'), 'кнопки закрытия окна вне фазы событий нет');
}

// --- открытый космос: переход в соседнюю секцию ---
{
  const G = baseG();
  G.phase = 'actions';
  const pid = Object.keys(G.players)[0];
  G.activeCrew = pid;
  const P = G.players[pid];
  P.inSpace = 'A';
  P.inventory = [{ id: 'suit', faceUp: true, charge: 2 }];
  P.plan = { move: 4, search: 0, activate: 0, special: 0, door: 0, spent: { move: 0, search: 0, activate: 0, special: 0, door: 0 } };
  const html = render(viewFor(G, pid), pid);
  for (const sec of SPACE_ADJ.A) {
    assert(html.includes(`Соседняя секция → ${SPACE_NAMES[sec]}`), `предложен переход в секцию ${sec}`);
  }
  assert(html.includes('Вернуться в локацию'), 'возврат на корабль через люк тоже предложен');
}

// --- фаза действий у экипажа: панель хода не падает ---
{
  const G = baseG();
  G.phase = 'actions';
  const pid = Object.keys(G.players)[0];
  G.activeCrew = pid;
  G.players[pid].plan = {
    move: 2, search: 1, activate: 0, special: 1, door: 0,
    spent: { move: 0, search: 0, activate: 0, special: 0, door: 0 },
  };
  const html = render(viewFor(G, pid), pid);
  assert(html.includes('Ваш ход'), 'панель хода отрисована');
}

console.error = realError;
if (reactWarnings.length) {
  console.error('FAIL: React ругается при рендере:');
  for (const w of reactWarnings.slice(0, 5)) console.error('  ' + w.split('\n')[0]);
  failed += reactWarnings.length;
}

await vite.close();
if (failed) { console.error(`\nUI: провалено проверок — ${failed}`); process.exit(1); }
console.log('UI OK ✓');
