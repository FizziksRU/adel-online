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
import { Adel, actionCost } from '../src/game/index.js';
import {
  ADEL_SPECIALS, HAZARDS, SECTORS, SECTOR_NAMES, SPACE_ADJ, SPACE_NAMES, CHARACTERS,
  HAZARD_NAMES, HAZARD_ICON, CONSOLE_COSTS, CONSOLE_LAYOUT, ANOMALIES, ANOMALY_COST,
  ENERGY_MAX, ADEL_HAND_LIMIT, HEALTH_DEATH, chipsPerTurn, energyFor,
  ITEMS, ITEM_EFFECTS, MARKER_SLOTS,
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
const { RollOverlay, rollShowPlan, SPIN_MS, ROLL_HOLD_MS } = await vite.ssrLoadModule('/src/client/SpiritRoll.jsx');
const { HealthTrack } = await vite.ssrLoadModule('/src/client/Health.jsx');
const { AdelConsole } = await vite.ssrLoadModule('/src/client/Console.jsx');
const { ItemCard } = await vite.ssrLoadModule('/src/client/ItemCard.jsx');

// React разделяет соседние текстовые узлы комментариями <!-- -->, из-за чего
// «Локация {l}» приезжает как «Локация <!-- -->4». Для проверок это шум.
const strip = (html) => html.split('<!-- -->').join('');

const render = (G, playerID, matchData) =>
  strip(renderToString(React.createElement(Board, { G, ctx: {}, moves: movesStub, playerID, matchData })));
const viewFor = (G, pid) => Adel.playerView({ G, playerID: pid });

// Кнопка с заданной подписью целиком — чтобы проверять именно её атрибуты,
// а не наличие слова disabled где-то на всей странице.
const buttonWith = (html, text) => {
  const end = html.indexOf('>' + text + '</button>');
  if (end < 0) return null;
  return html.slice(html.lastIndexOf('<button', end), end + 1);
};

// То же, но по видимому тексту: подписи локаций теперь содержат цветные
// номера в тегах, и сравнивать голую строку уже нельзя.
const allButtons = (html) => {
  const out = [];
  for (let i = html.indexOf('<button'); i >= 0; i = html.indexOf('<button', i + 1)) {
    const end = html.indexOf('</button>', i);
    if (end < 0) break;
    out.push(html.slice(i, end + 9));
  }
  return out;
};
const textOf = (frag) => frag.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const buttonByText = (html, text) => allButtons(html).find(b => textOf(b) === text.trim()) || null;
// Кнопка, содержащая подстроку: подписи действий теперь несут ценник («2⬛»)
// после текста, поэтому точное совпадение всей подписи уже не годится.
const btnContaining = (html, sub) => {
  const i = html.indexOf(sub);
  if (i < 0) return null;
  const j = html.lastIndexOf('<button', i);
  const k = html.indexOf('</button>', i);
  return (j < 0 || k < 0) ? null : html.slice(j, k + 9);
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

// --- вид экипажа: рука АДЕЛЬ ЗАКРЫТА — виден счёт и рубашки, не карты ---
{
  const G = baseG();
  G.phase = 'planning';
  G.adel.hand = ADEL_SPECIALS.map(c => ({ ...c }));
  const html = render(viewFor(G, '1'), '1');   // viewFor применяет playerView
  assert(html.includes('Планирование'), 'экипажу показана панель планирования');
  assert(html.includes('Рука АДЕЛЬ'), 'рука АДЕЛЬ подписана экипажу (со счётом)');
  for (const c of ADEL_SPECIALS) {
    assert(!html.includes(c.name), `экипаж НЕ видит название карты «${c.name}»`);
    assert(!buttonWith(html, `★ ${c.name}`), `карта «${c.name}» экипажу не кликабельна`);
  }
  assert(html.includes('handcard'), 'карты руки нарисованы как список, а не как пульт');
  assert(html.includes('закрытая карта'), 'карты руки показаны рубашкой, а не поимённо');
  assert(!html.includes('Завершить фазу АДЕЛЬ'), 'кнопок фазы АДЕЛЬ у экипажа нет');
  // Ищем именно заголовок раздела: слово «Шпионаж» есть и в подсказках ячеек
  // консоли, поэтому поиск по всей странице был бы бутафорским.
  assert(!html.includes('>Шпионаж</h4>'), 'пульта шпионажа у экипажа нет');
  assert(render(viewFor(G, '0'), '0').includes('>Шпионаж</h4>'),
    'а у самой АДЕЛЬ он на месте — проверка не пустая');
  assert(!html.includes('undefined'), 'в разметке нет undefined');

  // Порядок колоды и состав сброса остаются закрытыми.
  const V = viewFor(G, '1');
  assert(typeof V.adel.deck === 'number' && typeof V.adel.discard === 'number',
    'колода и сброс АДЕЛЬ приходят экипажу числами, а не составом');
}

// --- B7: шпионаж — АДЕЛЬ видит предметы локации и инвентарь попавшего игрока ---
{
  const G = baseG();
  G.phase = 'actions';
  const crewPid = Object.keys(G.players)[0];
  const P = G.players[crewPid];
  P.pos = 7; P.inSpace = null;
  P.inventory = [{ id: 'flashlight', faceUp: true, charge: 2 }, { id: 'axe', faceUp: false }];
  G.board[7].hazards.spy = true;                 // фишка шпионажа в локации 7
  G.board[7].items = [{ id: 'helmet', faceUp: false }];
  const html = render(viewFor(G, '0'), '0');     // смотрит сама АДЕЛЬ

  // panel «под наблюдением» с инвентарями попавших игроков
  assert(html.includes('Под наблюдением'), 'у АДЕЛЬ есть панель «под наблюдением»');
  assert(html.includes('Фонарь'), 'АДЕЛЬ видит предмет из инвентаря игрока на фишке шпионажа');
  assert(html.includes('Топор'), 'и закрытый ключевой предмет в его инвентаре тоже');
  // раскрытые названия предметов локации на карте (helmet = Шлем)
  assert(html.includes('Шлем'), 'предмет в локации со шпионажем раскрыт для АДЕЛЬ');

  // контроль: без фишки шпионажа ни панели, ни инвентаря, ни предмета локации
  const G2 = baseG();
  G2.phase = 'actions';
  const p2 = Object.keys(G2.players)[0];
  G2.players[p2].pos = 7; G2.players[p2].inSpace = null;
  G2.players[p2].inventory = [{ id: 'flashlight', faceUp: false, charge: 2 }];
  G2.board[7].items = [{ id: 'helmet', faceUp: false }];
  const v2 = viewFor(G2, '0');
  const html2 = render(v2, '0');
  assert(!html2.includes('Под наблюдением'), 'без шпионажа панели наблюдения нет');
  assert(!html2.includes('Фонарь'), 'без шпионажа инвентарь игрока закрыт от АДЕЛЬ');
  // Предмет на поле скрыт от АДЕЛЬ без шпионажа: проверяем сам playerView, а не
  // строку — «Шлем» теперь публично стоит в шапке красной миссии (финал), и это
  // не утечка. Утечкой был бы раскрытый жетон на поле.
  assert(v2.board[7].items[0].id === 'hidden' && !v2.board[7].items[0].known,
    'без шпионажа предмет локации закрыт от АДЕЛЬ (playerView отдаёт рубашку)');
  // Инвентарь p2 тоже приходит рубашкой (без шпионажа и не в одной локации).
  assert(v2.players[p2].inventory.every(it => it.id === 'hidden'),
    'без шпионажа инвентарь игрока закрыт от АДЕЛЬ (playerView)');
}

// --- C9: ники игроков из лобби рядом с именем персонажа и в журнале ---
{
  const G = baseG();
  G.phase = 'planning';
  const crew = Object.keys(G.players);            // ['1','2','3']
  const matchData = [
    { id: 0, name: 'АДЕЛЬ-бот' }, { id: 1, name: 'Алиса' },
    { id: 2, name: 'Боря' }, { id: 3, name: 'Вика' },
  ];
  const nickOf = (pid) => matchData.find(p => String(p.id) === pid).name;
  const nm1 = CHARACTERS[G.players[crew[0]].character].name;
  // два упоминания одного персонажа в одном ходе
  G.log = ['— ХОД 5: событие «Тишина» —', `${nm1} действует.`, `${nm1} осматривает локацию 4.`];
  const html = render(viewFor(G, crew[0]), crew[0], matchData);

  // ник рядом с именем персонажа в списке экипажа
  for (const pid of crew) {
    assert(html.includes(nickOf(pid)), `ник «${nickOf(pid)}» показан в списке экипажа`);
  }
  assert(html.includes('pnick'), 'ник у имени персонажа в отдельном теге');

  // журнал: первое упоминание в ходе несёт ник, второе — нет
  const nickA = nickOf(crew[0]);
  assert(html.includes(`${nm1} (${nickA}) действует`), 'первое упоминание в ходе несёт ник');
  assert(html.includes(`${nm1} осматривает`) && !html.includes(`${nm1} (${nickA}) осматривает`),
    'второе упоминание того же персонажа в ходе ник не повторяет');

  // без matchData (наблюдатель/реконнект) — только имя персонажа, без «undefined»
  const htmlNo = render(viewFor(G, crew[0]), crew[0]);
  assert(htmlNo.includes(nm1), 'без matchData имя персонажа на месте');
  assert(!htmlNo.includes('undefined'), 'без ников нет «undefined»');
  assert(!htmlNo.includes('pnick'), 'без ников тега ника нет');
}

// --- C8: инвентарь всегда под рукой — панель видна во всех фазах ---
{
  const mkG = (phase, active) => {
    const G = baseG();
    G.phase = phase;
    const pid = Object.keys(G.players)[0];
    const P = G.players[pid];
    P.pos = 2; P.inSpace = null; P.acted = false; P.bonusCubes = 0;
    P.pendingHypoxia = 0; P.pendingDrop = 0;
    P.inventory = [{ id: 'flashlight', faceUp: false }, { id: 'medkit', faceUp: false }];
    P.plan = { move: 1, search: 1, activate: 1, special: 0, door: 1,
      spent: { move: 0, search: 0, activate: 0, special: 0, door: 0 } };
    if (active) G.activeCrew = pid;
    return { G, pid };
  };
  // фаза планирования (не свой ход по действиям) — панель инвентаря всё равно видна
  {
    const { G, pid } = mkG('planning', false);
    const html = render(viewFor(G, pid), pid);
    assert(html.includes('Фонарь') && html.includes('Аптечка'),
      'инвентарь виден в фазе планирования');
    // но кнопок действий с предметами нет — панель информационная
    assert(!btnContaining(html, 'Активировать'), 'вне своего хода активировать нельзя — кнопки нет');
  }
  // свой ход в фазе действий — та же панель, но с рабочей кнопкой
  {
    const { G, pid } = mkG('actions', true);
    const html = render(viewFor(G, pid), pid);
    assert(html.includes('Фонарь') && html.includes('Аптечка'), 'инвентарь виден и в фазе действий');
    const b = btnContaining(html, 'Активировать');
    assert(b && !b.includes('disabled'), 'в свой ход предмет можно активировать');
  }
}

// --- номера локаций покрашены цветом своего сектора ---
// По цифре на карте должно быть видно, куда она бьёт, без сверки с картой
// корабля. Цвет берётся из разбиения на секторы, а не вписан руками.
{
  const G = baseG();
  G.phase = 'adel';
  // Карты руки перекрывают все пять секторов: 2 и 6 зелёный/жёлтый и т.д.
  G.adel.hand = [
    { id: 'L1', type: 'loc', locs: [2, 6] },
    { id: 'L2', type: 'loc', locs: [11, 14] },
    { id: 'L3', type: 'loc', locs: [19, 3] },
  ];
  // Смотрит сама АДЕЛЬ: её рука закрыта от экипажа, номера локаций на картах
  // руки видит только она (у экипажа — рубашки).
  {
    const html = render(viewFor(G, '0'), '0');
    for (const [loc, sector] of [[2, 'green'], [6, 'yellow'], [11, 'grey'], [14, 'red'], [19, 'blue']]) {
      assert(html.includes(`<b class="sect ${sector}">${loc}</b>`),
        `номер ${loc} покрашен в ${sector} — сектор своей локации`);
    }
    assert(!html.includes('class="sect undefined"'), 'нераспознанных секторов нет');
  }

  // Цвет соответствует именно секторам из данных, по всем двадцати локациям.
  for (const [sector, locs] of Object.entries(SECTORS)) {
    for (const l of locs) {
      const G2 = baseG();
      G2.phase = 'adel';
      G2.adel.hand = [{ id: 'L', type: 'loc', locs: [l, l === 1 ? 2 : 1] }];
      assert(render(viewFor(G2, '0'), '0').includes(`<b class="sect ${sector}">${l}</b>`),
        `локация ${l} относится к сектору ${sector}`);
    }
  }
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
  assert(buttonByText(html, 'Локация 4') && buttonByText(html, 'Локация 9'), 'предложены обе локации карты');
  assert(!buttonByText(html, 'Локация 5'), 'чужие локации не предлагаются');
  // Номер локации покрашен и в выборе цели, а не только на карте в руке.
  assert(html.includes('<b class="sect green">4</b>') && html.includes('<b class="sect grey">9</b>'),
    'в выборе локации номера покрашены цветом своего сектора');
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
  for (const l of [1, 3, 6]) assert(buttonByText(locs, `Локация ${l}`), `соседняя локация ${l} предложена`);
  assert(!buttonByText(locs, 'Локация 9'), 'локация без соседнего пожара не предложена');
}

// «Перегрузка сектора»: цели — только сектор цвета текущего события.
{
  const V = adelView(G => {
    G.adel.console.fire = [5];
    G.currentEvent = { id: 'silence', color: 'green', uid: 1, cancelled: false };
  });
  const html = picker(V, { kind: 'adelCard', card: specialCard('S_color'), hz: 'fire' });
  for (const l of SECTORS.green) assert(buttonByText(html, `Локация ${l}`), `зелёная локация ${l} предложена`);
  for (const l of SECTORS.blue) assert(!buttonByText(html, `Локация ${l}`), `синяя локация ${l} не предложена`);
}

// «Восстановление данных»: перечислен сброс; при пустом сбросе — понятный отказ.
{
  const V = adelView(G => { G.adel.discard = [{ id: 'D1', type: 'loc', locs: [2, 7] }]; });
  const html = picker(V, { kind: 'adelCard', card: specialCard('S_recall') });
  assert(buttonByText(html, 'Локации 2 / 7'), 'карта из сброса предложена к возврату');

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
  assert(buttonByText(html, 'Локации 1 / 6') && buttonByText(html, 'Локации 4 / 9'),
    'предложены прочие карты руки');

  const full = picker(V, { kind: 'adelCard', card, picked: ['H1', 'H2', 'H3'] });
  const btn = buttonByText(full, 'Локации 4 / 9');
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
  // До осмотра предмет в локации показан рубашкой, а название скрыто.
  assert(before.includes('itemcard back'), 'до осмотра предмет закрыт (рубашка)');
  assert(!before.includes('Огнетушитель'), 'до осмотра название предмета не показано');
  assert(!before.includes('Забрать предмет?'), 'до осмотра выбора «взять» нет');
  const searchBtn = btnContaining(before, 'осмотреть локацию');
  assert(searchBtn && !searchBtn.includes('disabled'), 'поиск доступен');
  assert(searchBtn.includes('1⬛'), 'на кнопке поиска показана цена (1 кубик)');

  // движок отработал осмотр
  Adel.moves.actSearch.move({ G, playerID: pid }, false);
  const after = render(viewFor(G, pid), pid);
  assert(after.includes('Забрать предмет?'), 'после осмотра предложено решение');
  // Найденное — кликабельной полной карточкой с названием (не текстовой кнопкой).
  assert(after.includes('itemcard full pickable') && after.includes('Огнетушитель'),
    'найденный предмет показан полной карточкой и назван');
  assert(buttonWith(after, 'Оставить на месте'), 'от находки можно отказаться');
  assert(after.includes('Кубик уже потрачен'),
    'игроку сказано, что решение входит в то же действие');
  const again = btnContaining(after, 'осмотреть локацию');
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

// ============================================================
// Консоль АДЕЛЬ: раскладка физического планшета
// ============================================================
// Планшет устроен колонками: метка цены сверху, ячейки вниз. Колонки режем
// по разметке — каждая начинается с class="concol".
const conCols = (html) => {
  const parts = html.split('class="concol"').slice(1);
  return parts.map(s => {
    const next = s.indexOf('class="concol"');
    return next < 0 ? s.slice(0, s.indexOf('class="remind"')) : s.slice(0, next);
  });
};
const cellsOf = (col, type, cost) =>
  (col.match(new RegExp(`title="${HAZARD_NAMES[type]} — ${cost}⚡`, 'g')) || []).length;

// Консоль лежит под картой и открыта всем — в жизни планшет тоже лицом вверх.
{
  const G = baseG();
  G.phase = 'actions';
  for (const viewer of [Object.keys(G.players)[0], '0', '9']) {
    const html = render(viewFor(G, viewer), viewer);
    assert(html.includes('Консоль АДЕЛЬ'), `консоль видна наблюдателю ${viewer}`);
    assert(html.indexOf('panel console') > html.indexOf('class="map"'),
      `консоль идёт после карты корабля (смотрит ${viewer})`);
    assert(html.indexOf('panel console') < html.indexOf('class="side"'),
      `консоль стоит под картой, а не в сайдбаре (смотрит ${viewer})`);
    // Без выбранной карты ячейки — не кнопки: это показ состояния, а не пульт.
    assert(!html.includes('chip on pick') && !html.includes('chip off pick'),
      `у наблюдателя ${viewer} ячейки консоли не кликабельны`);
  }
}

// Колонки идут по цене слева направо, метка цены — над колонкой, состав ячеек
// в колонке совпадает с раскладкой планшета.
{
  const G = baseG();
  const html = render(viewFor(G, '0'), '0');
  const cols = conCols(html);
  assert(cols.length === CONSOLE_COSTS.length,
    `колонок столько же, сколько цен: ${CONSOLE_COSTS.length}, найдено ${cols.length}`);

  let total = 0;
  CONSOLE_COSTS.forEach((cost, i) => {
    assert(cols[i].includes(`>−${cost}<i>⚡</i></span>`),
      `${i + 1}-я колонка слева подписана ценой −${cost}⚡`);
    for (const [type, n] of Object.entries(CONSOLE_LAYOUT[cost])) {
      assert(cellsOf(cols[i], type, cost) === n,
        `в колонке −${cost}⚡ ячеек «${HAZARD_NAMES[type]}» должно быть ${n}, нарисовано ${cellsOf(cols[i], type, cost)}`);
      total += n;
    }
    // Чужих видов в колонке нет.
    for (const type of HAZARDS) {
      if (CONSOLE_LAYOUT[cost][type]) continue;
      assert(cellsOf(cols[i], type, cost) === 0,
        `в колонке −${cost}⚡ не должно быть ячеек «${HAZARD_NAMES[type]}»`);
    }
  });
  assert(total === 52, `на консоли 52 ячейки — по одной на фишку в мешочке, вышло ${total}`);

  // Метка цены стоит ВЫШЕ своих ячеек: на планшете колонка читается сверху вниз.
  const first = cols[0];
  assert(first.indexOf('conprice') < first.indexOf('class="chip'),
    'метка цены напечатана над колонкой, а не под ней');

  // Колонки делят ширину планшета пропорционально числу подколонок: колонка на
  // 10 ячеек вдвое шире колонки на 5. Без этого сетка жалась бы к левому краю,
  // оставляя половину планшета пустой.
  CONSOLE_COSTS.forEach((cost, i) => {
    const cells = Object.values(CONSOLE_LAYOUT[cost]).reduce((a, b) => a + b, 0);
    const want = Math.ceil(cells / 5);
    assert(cols[i].includes(`--w:${want}`),
      `колонка −${cost}⚡ (${cells} ячеек) занимает ${want} подколонки по ширине`);
  });
}

// Пустая ячейка — контур, занятая — яркая фишка тем же значком, что на карте.
{
  const G = baseG();
  G.adel.console = { fire: [], hypoxia: [], darkness: [], lockdown: [], spy: [], door: [] };
  const empty = render(viewFor(G, '0'), '0');
  assert(!empty.includes('class="chip on'), 'на пустой консоли занятых ячеек нет');
  assert((empty.match(/class="chip off/g) || []).length === 52, 'все 52 ячейки пустые');

  G.adel.console.fire = [3, 5, 5];
  const html = render(viewFor(G, '0'), '0');
  assert((html.match(/class="chip on/g) || []).length === 3, 'занятых ячеек ровно три');
  // Фишки — ассетами из манифеста. На ячейке пожара тот же значок «Пожар», что
  // рисует ChipIcon и на карте корабля; проверяем сам факт картинки-фишки.
  assert(html.includes('alt="Пожар"'), 'на ячейке пожара — значок «Пожар» ассетом, единый с картой');
  assert(html.includes('.webp'), 'фишки отрисованы картинками (webp), а не эмодзи');

  // «Самая дорогая фишка вида» — её АДЕЛЬ обязана снять следующей.
  const cols = conCols(html);
  const colOf = (cost) => cols[CONSOLE_COSTS.indexOf(cost)];
  assert((html.match(/chip on next/g) || []).length === 1,
    'подсвечена ровно одна фишка — та, что снимется следующей');
  assert(colOf(5).includes('chip on next'), 'подсветка стоит в самой дорогой занятой колонке (−5⚡)');
  assert(!colOf(3).includes('next'), 'в дешёвой колонке подсветки нет');
}

// Шкала энергии идёт по ПЕРИМЕТРУ планшета: слева снизу вверх, поверху
// направо, справа сверху вниз — 0…50, маркер-цилиндр и засечка пополнения.
{
  const G = baseG();
  G.adel.energy = 12;                                 // пополнение +10 → засечка на 22
  const html = render(viewFor(G, '0'), '0');
  const side = (cls) => {
    const i = html.indexOf(cls);
    return html.slice(i, html.indexOf('</div>', i));
  };
  const left = side('enside enleft'), top = side('class="entop"'), right = side('enside enright');
  const ticks = (s) => (s.match(/class="entick/g) || []).length;

  assert(ticks(left) + ticks(top) + ticks(right) === ENERGY_MAX + 1,
    `на треке ${ENERGY_MAX + 1} делений — от 0 до ${ENERGY_MAX}, вышло ${ticks(left) + ticks(top) + ticks(right)}`);
  assert(left.includes('title="0⚡"'), 'трек начинается с нуля на левой стороне планшета');
  assert(right.includes(`title="${ENERGY_MAX}⚡"`), 'и кончается пределом на правой');
  assert(ticks(top) > ticks(left) && ticks(top) > ticks(right),
    'верхняя сторона планшета длиннее боковых');
  assert(left.includes('>10</b>') && right.includes('>45</b>'),
    'кратные пяти подписаны числами прямо на делениях');

  assert((html.match(/class="encyl"/g) || []).length === 1, 'маркер-цилиндр один');
  assert(html.includes('title="Текущий запас: 12⚡"'), 'деление под маркером подписано текущим запасом');
  assert(html.includes('title="После пополнения: 22⚡"'), 'засечка показывает, куда доедет маркер');
  // Место маркера считаем по числу делений перед ним: подпись сама по себе
  // ещё не значит, что цилиндр нарисован именно там. Счёт идёт от деления «0».
  const track = html.slice(html.indexOf('enside enleft'));
  const before = (track.slice(0, track.indexOf('class="encyl"')).match(/class="entick/g) || []).length;
  assert(before === 13, `перед цилиндром 13 делений (0…12), а насчитано ${before}`);
  // Классы делений разбираем словами, без регулярок с экранированием:
  // так проверка не зависит от порядка классов в атрибуте.
  const tickCls = (html.match(/class="entick[^"]*"/g) || []).map(s => s.slice(7, -1).split(" "));
  assert(tickCls.filter(c => c.includes("here")).length === 1,
    "текущее деление помечено ровно одно");
  assert(tickCls.filter(c => c.includes("full")).length === 13,
    "закрашены деления 0…12 включительно");

  // У потолка засечка упирается в предел, а не уезжает за шкалу.
  G.adel.energy = ENERGY_MAX - 3;
  const near = render(viewFor(G, '0'), '0');
  assert(!near.includes(`title="После пополнения: ${ENERGY_MAX + 1}⚡"`),
    'делений сверх предела энергии не появляется');
  assert(near.includes(`title="Текущий запас: ${ENERGY_MAX - 3}⚡"`),
    'маркер стоит на своём делении и у потолка');
}

// Полоса аномалий: четыре ячейки, цена по краям, на каждом жетоне — цвета
// секторов, из которых придётся снять по фишке. Жетоны открыты всем.
{
  const G = baseG();
  const crewPid = Object.keys(G.players)[0];
  // Ячейки режем по их открывающим тегам. Простое деление по `class="anom`
  // не годится: под него попадают и обёртка anomslots, и подпись цены, и
  // блок цветов anomhex.
  const anomSlots = (html) => {
    const bar = html.slice(html.indexOf('class="anomslots"'), html.indexOf('class="congrid"'))
      .split('<button class="anom').join('<i class="anom');
    return bar.split('<i class="anom').slice(1);
  };

  for (const viewer of [crewPid, '0', '9']) {
    const html = render(viewFor(G, viewer), viewer);
    assert((html.match(new RegExp(`class="anomcost"[^>]*>−${ANOMALY_COST}`, 'g')) || []).length === 2,
      `цена активации напечатана по обоим краям полосы (смотрит ${viewer})`);
    assert(html.indexOf('class="anombar"') < html.indexOf('class="congrid"'),
      `полоса аномалий стоит над сеткой ячеек (смотрит ${viewer})`);
    const slots = anomSlots(html);
    assert(slots.length === 4, `на планшете четыре ячейки аномалий (смотрит ${viewer}), найдено ${slots.length}`);
    // Аномалии открыты всем — рубашек на планшете не осталось.
    assert(!html.includes('жетон лицом вниз'), `у наблюдателя ${viewer} жетоны не закрыты`);
    for (const key of G.adel.anomalies) {
      assert(html.includes(ANOMALIES[key].name), `аномалия «${ANOMALIES[key].name}» названа (смотрит ${viewer})`);
    }
    // Главное на жетоне — чем за него платить: цвета секторов шестиугольниками.
    G.adel.anomalies.forEach((key, i) => {
      const need = ANOMALIES[key].colors;
      for (const c of need) {
        assert(slots[i].includes(`class="hex ${c}"`),
          `на жетоне «${ANOMALIES[key].name}» есть ${c} сектор (смотрит ${viewer})`);
      }
      const hexes = (slots[i].match(/class="hex /g) || []).length;
      assert(hexes === need.length,
        `у «${ANOMALIES[key].name}» ровно ${need.length} цвет(а), нарисовано ${hexes}`);
    });
  }

  // Активированный жетон помечен отдельно.
  const key = G.adel.anomalies[0];
  G.anomaliesActive = [key];
  const after = render(viewFor(G, crewPid), crewPid);
  assert(after.includes('anom on'), 'активированный жетон помечен');
  assert((after.match(/class="anom on"/g) || []).length === 1, 'помечен ровно один');
}

// Полоса памятки внизу планшета.
{
  const G = baseG();                                   // стол на четверых
  const html = render(viewFor(G, '0'), '0');
  const strip = html.slice(html.indexOf('class="remind"'));
  assert(strip.includes(`<b>${chipsPerTurn(4)}</b> фишки за ход`), 'напоминание про фишки за ход');
  assert(strip.includes(`↑⚡<b>${energyFor(4)}</b>`), 'напоминание про пополнение энергии');
  assert(strip.includes(`не выше ${ENERGY_MAX}`), 'назван предел энергии');
  assert(strip.includes(`рука <b>${ADEL_HAND_LIMIT}</b>`), 'напоминание про предел руки');
  assert(html.indexOf('class="congrid"') < html.indexOf('class="remind"'),
    'памятка идёт полосой под сеткой');
}

// Выбор вида фишки = клик по занятой ячейке её ряда.
{
  const G = baseG();
  G.adel.console = { fire: [5], hypoxia: [], darkness: [7], lockdown: [], spy: [], door: [] };
  const V = viewFor(G, '0');
  const conHtml = (props) => strip(renderToString(React.createElement(AdelConsole,
    { G: V, numPlayers: 4, onPickType: () => {}, ...props })));

  // Карта разрешает только пожар: кнопкой становится ячейка пожара, и только занятая.
  const picking = conHtml({ canPickType: (hz) => hz === 'fire' });
  assert(picking.includes('Выберите вид фишки'), 'сказано, что вид выбирается кликом по ячейке');
  const buttons = picking.match(/<button class="chip[^"]*"/g) || [];
  assert(buttons.length === 1, `кликабельна ровно одна ячейка, найдено ${buttons.length}`);
  assert(buttons[0].includes('on') && buttons[0].includes('pick'), 'кликабельна именно занятая ячейка');
  assert(!picking.includes('<button class="chip off'), 'пустую ячейку выбрать нельзя');
  const darkCell = picking.slice(picking.indexOf(`title="${HAZARD_NAMES.darkness} — 7⚡`) - 60,
    picking.indexOf(`title="${HAZARD_NAMES.darkness} — 7⚡`));
  assert(!darkCell.includes('<button'), 'занятая ячейка запрещённого картой вида кнопкой не становится');

  // Без выбранной карты консоль просто показывает состояние.
  const idle = conHtml({ canPickType: null });
  assert(!idle.includes('<button class="chip'), 'без выбранной карты ячейки не кликабельны');
  assert(!idle.includes('Выберите вид фишки'), 'и подсказки о выборе нет');
}

// ОГРАНИЧЕНИЕ ОБВЯЗКИ: серверный рендер не ругается на одинаковые ключи React
// (проверено — renderToString молчит), поэтому склейку карт с одинаковым id
// здесь поймать нечем. Ключи руки нарочно взяты по номеру в руке, а не по id,
// но проверяется это только глазами в браузере.
//
// Устаревшее состояние не должно ронять экран. Сервер держит движок в памяти,
// поэтому после правки playerView он какое-то время отдаёт старую форму —
// закрытые карты и жетоны. Клиент обязан это пережить, а не показать чёрный
// экран: ровно так экипаж и остался без интерфейса при живой проверке.
{
  const G = baseG();
  G.phase = 'planning';
  const pid = Object.keys(G.players)[0];
  const V = viewFor(G, pid);
  V.adel.anomalies = ['hidden', 'hidden', 'hidden', 'hidden'];   // как отдавал старый сервер
  V.adel.hand = [{ id: 'hidden' }, { id: 'hidden' }];
  let html = '';
  try { html = render(V, pid); } catch (e) { html = 'ПАДЕНИЕ: ' + e.message; }
  assert(!html.startsWith('ПАДЕНИЕ'), `экран не падает на закрытых данных — ${html.slice(0, 120)}`);
  assert(html.includes('Консоль АДЕЛЬ'), 'консоль всё равно отрисована');
  assert(html.includes('жетон лицом вниз'), 'непонятный жетон нарисован рубашкой');
  assert(html.includes('закрытая карта'), 'закрытая карта подписана рубашкой, а не «undefined»');
  assert(!html.includes('undefined'), 'в разметке нет undefined');
}

// ============================================================
// Шкала здоровья: клетки, маркер-кубик, отметки потери ячейки инвентаря
// ============================================================
{
  const G = baseG();
  G.phase = 'actions';
  const crew = Object.keys(G.players);
  // Раны раздаём разные, чтобы маркеры стояли на разных клетках.
  crew.forEach((pid, i) => { G.players[pid].health = i; G.players[pid].dead = false; });
  const emma = crew.find(p => G.players[p].character === 'emma');
  if (emma) G.players[emma].health = 2;             // как раз клетка потери ячейки

  // Одна шкала со страницы: на экране их несколько (своя и по одной на
  // каждого в списке экипажа), считать надо по одной.
  const firstTrack = (html) => {
    const t = html.slice(html.indexOf('htrack'));
    return t.slice(0, t.indexOf('</div>'));
  };
  const cells = (html) => (firstTrack(html).match(/class="hcell/g) || []).length;
  // Шесть клеток ран (0…5) плюс череп. Число записано прямо, а не выведено из
  // HEALTH_DEATH: иначе шкала подстроилась бы под любое значение константы и
  // тест не заметил бы, что правило «убивает шестая рана» уехало.
  const cellCount = 7;

  for (const viewer of [...crew, '0', '9']) {
    const html = render(viewFor(G, viewer), viewer);
    assert(html.includes('Экипаж'), `панель экипажа показана зрителю ${viewer}`);
    // Здоровье публично: каждую шкалу видят все, включая АДЕЛЬ и зрителя.
    for (const pid of crew) {
      assert(html.includes(CHARACTERS[G.players[pid].character].name),
        `в списке экипажа есть ${CHARACTERS[G.players[pid].character].name} (смотрит ${viewer})`);
    }
    // Дух персонажа стоит в скобках у имени — порог проверки виден сразу.
    for (const pid of crew) {
      const ch = CHARACTERS[G.players[pid].character];
      assert(html.includes(`>(${ch.spirit})</b>`),
        `у ${ch.name} дух ${ch.spirit} подписан в скобках (смотрит ${viewer})`);
    }
    const tracks = (html.match(/class="htrack"/g) || []).length;
    assert(tracks >= crew.length, `шкал не меньше, чем членов экипажа (смотрит ${viewer}): ${tracks}`);
    assert(cells(html) === cellCount,
      `на шкале ${cellCount} клеток — 0…${HEALTH_DEATH - 1} и череп (смотрит ${viewer}), нарисовано ${cells(html)}`);
    const marks = (html.match(/hcell here/g) || []).length;
    assert(marks >= crew.length, `у каждого ровно один маркер-кубик (смотрит ${viewer}): ${marks}`);
    assert(html.includes('☠'), 'на шкале есть череп');
  }

  // Маркер едет вправо: с ростом ран меняется клетка, а не подпись.
  const pid = crew[0];
  const at = (html) => html.slice(html.indexOf('htrack')).indexOf('hcell here');
  G.players[pid].health = 0;
  const zero = at(render(viewFor(G, pid), pid));
  G.players[pid].health = 3;
  const three = at(render(viewFor(G, pid), pid));
  assert(three > zero, 'с ранами маркер сдвигается вправо по шкале');

  // Пять ран персонаж переживает: маркер стоит на предпоследней клетке,
  // черепа он ещё не достиг.
  G.players[pid].health = HEALTH_DEATH - 1; G.players[pid].dead = false;
  const hurt = render(viewFor(G, pid), pid);
  assert(!hurt.includes('hcell skull here') && !hurt.includes('hcell here skull'),
    `${HEALTH_DEATH - 1} ран(ы) — маркер ещё не на черепе, персонаж жив`);

  // Череп — крайняя клетка, и на ней маркер стоит у погибшего.
  G.players[pid].health = HEALTH_DEATH; G.players[pid].dead = true;
  const dead = render(viewFor(G, pid), pid);
  assert(dead.includes('hcell skull here') || dead.includes('hcell here skull'),
    'у погибшего маркер стоит на черепе');
  assert((firstTrack(dead).match(/hcell[^"]*\bhere\b/g) || []).length === 1,
    'маркер на шкале погибшего один — на черепе, а не два');
}

// Отметки потери ячейки инвентаря — на самих клетках шкалы, а не только
// в подсказке под ней: по ним видно, ДО чего осталось сколько ран.
{
  const track = (character, health = 0) =>
    strip(renderToString(React.createElement(HealthTrack, { character, health, dead: false })));
  for (const id of Object.keys(CHARACTERS)) {
    const html = track(id);
    const marked = html.match(/class="hcell[^"]*\bloss\b[^"]*"/g) || [];
    assert(marked.length === CHARACTERS[id].invLoss.length,
      `у ${CHARACTERS[id].name} помечено ${CHARACTERS[id].invLoss.length} клет(ки) потери ячейки, найдено ${marked.length}`);
    for (const n of CHARACTERS[id].invLoss) {
      assert(html.includes(`${n}-я рана: теряется ячейка инвентаря`),
        `у ${CHARACTERS[id].name} помечена именно ${n}-я рана`);
    }
    assert(html.includes('🎒'), `значок инвентаря стоит на шкале ${CHARACTERS[id].name}`);
  }
  // Отметки не зависят от того, дошёл до них маркер или нет.
  const emma = track('emma', 4);
  assert((emma.match(/\bloss\b/g) || []).length === CHARACTERS.emma.invLoss.length,
    'пройденные клетки потери ячейки остаются помеченными');
}

// ============================================================
// Проверка духа: обязательная плашка и общая анимация кубика
// ============================================================
// Плашка того, чей бросок: причина, расшифровка порога, кнопка.
{
  const G = baseG();
  G.phase = 'reveal';
  const [pid, other] = Object.keys(G.players);
  const P = G.players[pid];
  P.pos = 13; P.inSpace = null; P.inventory = [];
  G.eventOngoing = 'stress';
  G.board[13].hazards.fire = true;
  const spirit = CHARACTERS[P.character].spirit;
  G.pendingChecks = [{
    pid, reason: 'fire', context: { loc: 13 },
    base: spirit, modifiers: [{ key: 'stress', delta: -1 }], target: spirit - 1,
  }];

  const mine = render(viewFor(G, pid), pid);
  assert(mine.includes('Пожар в локации 13'), 'названа причина проверки');
  assert(mine.includes(`дух ${spirit} − 1 стресс = ${spirit - 1}`),
    'порог расшифрован по слагаемым, а не показан одним числом');
  const btn = buttonWith(mine, '🎲 Бросить кубик');
  assert(btn && !btn.includes('disabled'), 'кнопка броска доступна тому, чья проверка');
  assert(mine.includes('обязательный ход'), 'сказано, что остальные действия недоступны');

  // Напарник, АДЕЛЬ и зритель видят, кого ждут, но кнопки у них нет.
  for (const [viewer, кто] of [[other, 'напарник'], ['0', 'АДЕЛЬ'], ['9', 'зритель']]) {
    const html = render(viewFor(G, viewer), viewer);
    assert(!buttonWith(html, '🎲 Бросить кубик'), `${кто} за чужую проверку не бросает`);
    assert(html.includes('Ждём бросок'), `${кто} видит, чьего броска ждут`);
    assert(html.includes(CHARACTERS[P.character].name), `${кто} видит имя бросающего`);
  }
}

// Решение «показывать оверлей или нет» — проверяем напрямую. Сам эффект React
// живёт только в браузере (серверный рендер эффекты не выполняет), поэтому
// логика вынесена в чистую функцию: иначе она осталась бы вовсе непокрытой.
{
  const roll = (seq) => ({ pid: '1', reason: 'fire', die: 4, target: 2, ok: false, seq });

  assert(rollShowPlan(null, 0) === null, 'без броска показывать нечего');
  assert(rollShowPlan(roll(1), 0) !== null, 'новый бросок показывается');
  assert(rollShowPlan(roll(1), 1) === null, 'уже показанный бросок не проигрывается заново');
  assert(rollShowPlan(roll(1), 5) === null, 'бросок старее показанного тоже пропускается');
  assert(rollShowPlan(roll(2), 1).seq === 2, 'в плане запоминается номер броска');

  // Две одинаковые грани подряд — разные броски: отличаются номером.
  assert(rollShowPlan({ ...roll(2), die: 4 }, 1) !== null,
    'повтор той же грани показывается — считаем по номеру, а не по грани');

  const normal = rollShowPlan(roll(1), 0, false);
  assert(normal.spin === SPIN_MS, 'обычно кубик крутится');
  assert(normal.hold === SPIN_MS + ROLL_HOLD_MS, 'и результат висит после вращения');

  const reduced = rollShowPlan(roll(1), 0, true);
  assert(reduced.spin === 0, 'при prefers-reduced-motion вращения нет вовсе');
  assert(reduced.hold === ROLL_HOLD_MS, 'а результат всё равно показывается');
}

// След от броска остаётся в панели фазы: анимацию можно и не застать.
{
  const G = baseG();
  G.phase = 'actions';
  const crew = Object.keys(G.players);
  const pid = crew[0];
  const name = CHARACTERS[G.players[pid].character].name;

  const before = render(viewFor(G, pid), pid);
  assert(!before.includes('lastroll'), 'до первого броска следа нет');

  G.lastRoll = { pid, reason: 'fire', context: { loc: 13 }, base: 3, modifiers: [], die: 4, target: 2, ok: false, seq: 1 };
  for (const viewer of [...crew, '0', '9']) {
    const html = render(viewFor(G, viewer), viewer);
    assert(html.includes('lastroll bad'), `итог последнего броска виден наблюдателю ${viewer}`);
    assert(html.includes(`${name} против пожара: 4 &gt; 2`), `в следе те же числа (смотрит ${viewer})`);
    assert(html.includes('провал'), `исход назван словом (смотрит ${viewer})`);
    assert(html.includes('⚃'), 'выпавшая грань нарисована и в следе');
  }
  G.lastRoll = { ...G.lastRoll, die: 1, ok: true, seq: 2 };
  assert(render(viewFor(G, pid), pid).includes('lastroll ok'), 'успех помечен своим цветом');
}

// Отдельной панели «мой персонаж» нет — она повторяла список экипажа.
{
  const G = baseG();
  G.phase = 'actions';
  const pid = Object.keys(G.players)[0];
  const P = G.players[pid];
  P.pos = 8; P.inSpace = null;
  const html = render(viewFor(G, pid), pid);
  assert(!html.includes('panel me'), 'дублирующей панели персонажа больше нет');
  // При этом ничего не потеряно: имя, дух, шкала и своё положение — в списке.
  assert(html.includes(CHARACTERS[P.character].name), 'имя есть в списке экипажа');
  assert(html.includes(`>(${CHARACTERS[P.character].spirit})</b>`), 'дух там же');
  assert(html.includes('локация 8'), 'своё положение подписано словами');
  assert(html.includes('class="htrack"'), 'шкала ран на месте');
}

// Оверлей с результатом — один и тот же для всех, включая АДЕЛЬ и зрителя.
// Компонент проверяется напрямую: показ привязан к появлению нового seq, а
// эффекты в серверном рендере не выполняются.
{
  const G = baseG();
  const pid = Object.keys(G.players)[0];
  const name = CHARACTERS[G.players[pid].character].name;
  const roll = { pid, reason: 'fire', context: { loc: 13 }, base: 3, modifiers: [], die: 4, target: 2, ok: false, seq: 1 };
  const overlay = (props) => strip(renderToString(React.createElement(RollOverlay, { G, ...props })));

  const spinning = overlay({ roll, spinning: true });
  assert(spinning.includes('die spin'), 'пока крутится — кубик в состоянии вращения');
  assert(!spinning.includes('провал'), 'исход до остановки не показывается');

  const stopped = overlay({ roll, spinning: false });
  assert(stopped.includes('⚃'), 'кубик остановился на выпавшей грани (4)');
  assert(stopped.includes(`${name} против пожара: 4 &gt; 2`), 'подпись называет игрока, причину и числа');
  assert(stopped.includes('провал'), 'исход назван словом');
  assert(stopped.includes('rollbox bad'), 'исход помечен цветом');

  const good = overlay({ roll: { ...roll, die: 1, ok: true }, spinning: false });
  assert(good.includes('rollbox ok'), 'успех помечен своим цветом');

  // Порог 0 (дух 2 Мэй минус 2 за «Взрывы») — единица проходит всё равно.
  const one = overlay({ roll: { ...roll, die: 1, target: 0, ok: true }, spinning: false });
  assert(one.includes('единица проходит всегда'),
    'выпавшая единица объяснена: иначе «1 > 0 — успех» читалось бы ошибкой');
}

// ============================================================
// Спец. действие: интерфейс не предлагает то, что движок отклонит
// ============================================================
// Живая находка: игрок стоял на гипоксии с тремя кубиками «спец», жал кнопку —
// и ничего не происходило. Движок отклонял по делу (доплата за тьму, запертый
// компьютер, жетон повреждения), а интерфейс об этом молчал.
{
  const ready = (mutate = () => {}) => {
    const G = baseG();
    G.phase = 'actions';
    const pid = Object.keys(G.players).find(p => G.players[p].character !== 'mei');
    const P = G.players[pid];
    G.activeCrew = pid;
    P.plan = { move: 0, search: 0, activate: 0, special: 3, door: 0,
      spent: { move: 0, search: 0, activate: 0, special: 0, door: 0 } };
    P.acted = false; P.bonusCubes = 0; P.pos = 14; P.inSpace = null;
    P.pendingHypoxia = 0; P.pendingDrop = 0; P.inventory = [];
    G.board[14].hazards.hypoxia = true;
    mutate(G, P, pid);
    return { html: render(viewFor(G, pid), pid), G, pid };
  };
  // Кнопку берём строго после её подписи: у строк «Шпионаж», «Гипоксия» и
  // «Тьма» разметка кнопок совпадает до символа, и поиск по всей странице
  // находил бы чужую.
  const clearBtn = (html, name = 'Гипоксия') => {
    const i = html.indexOf(`Убрать «${name}»`);
    if (i < 0) return null;
    const j = html.indexOf('<button', i);
    const k = html.indexOf('</button>', j);
    return (j < 0 || k < 0) ? null : html.slice(j, k + 9);
  };

  // Три кубика, чистая локация — действие доступно и цель названа.
  {
    const { html } = ready();
    assert(html.includes('Убрать «Гипоксия» · лок. 14'), 'цель названа прямо в подписи');
    const b = clearBtn(html);
    assert(b && !b.includes('disabled'), 'при трёх кубиках действие доступно');
    assert(b.includes('>3⬛<'), 'на кнопке настоящая цена — три кубика');
  }
  // Тьма добавляет кубик: трёх уже не хватает, и это сказано.
  {
    const { html } = ready((G) => { G.board[14].hazards.darkness = true; });
    const b = clearBtn(html);
    assert(b && b.includes('disabled'), 'с доплатой за тьму трёх кубиков мало — кнопка заблокирована');
    assert(b.includes('нужно кубиков: 4, есть 3'), 'сказано, сколько нужно и сколько есть');
    assert(b.includes('4⬛'), 'на кнопке общее число кубиков с доплатой — 4');
    assert(b.includes('3 базовых + 1 тьма'), 'в тултипе — расшифровка цены');
  }
  // «Вредоносная программа» — тот же лишний кубик.
  {
    const { html } = ready((G) => { G.eventOngoing = 'malware'; });
    const b = clearBtn(html);
    assert(b && b.includes('disabled'), '«вредоносная программа» тоже добавляет кубик');
  }
  // Запертый компьютер и жетон повреждения объясняются словами.
  {
    const { html } = ready((G) => { G.board[14].computerLocked = true; });
    const b = clearBtn(html);
    assert(b && b.includes('disabled') && b.includes('компьютер заблокирован'),
      'при запертом компьютере сказано именно это');
    // И цель не рекламируется: действие идёт через компьютер, а он заперт.
    assert(!html.includes('Убрать «Гипоксия» · лок.'),
      'при запертом компьютере локация целью не называется');
  }
  {
    const { html } = ready((G) => { G.board[14].damage = true; });
    const b = clearBtn(html);
    assert(b && b.includes('disabled') && b.includes('жетон повреждения'),
      'жетон повреждения назван причиной');
  }
  // Нечего убирать — тоже понятная причина, а не молчаливый отказ.
  {
    const { html } = ready((G) => { G.board[14].hazards.hypoxia = false; });
    const b = clearBtn(html);
    assert(b && b.includes('disabled') && b.includes('здесь нет фишки'),
      'когда убирать нечего, это сказано');
  }
  // Кубиков хватает ровно: доступно.
  {
    const { html } = ready((G, P) => { P.plan.special = 4; G.board[14].hazards.darkness = true; });
    const b = clearBtn(html);
    assert(b && !b.includes('disabled'), 'с четырьмя кубиками действие во тьме доступно');
  }
}

// ============================================================
// A2: цена на кнопке = то, что реально спишет движок (все комбинации)
// ============================================================
// Единая функция actionCost считает цену и для интерфейса, и для движка.
// Проверяем прямо: сколько показывает actionCost (столько и на кнопке) — ровно
// столько кубиков движок и спишет, во всех сочетаниях тьмы, «вредоносной
// программы» и способности Мэй.
{
  const mv = (name) => Adel.moves[name].move;
  const spentOf = (P) => Object.values(P.plan.spent).reduce((a, b) => a + b, 0);
  const setupAct = ({ dark, malware, char }) => {
    const G = baseG();
    G.phase = 'actions';
    const pid = Object.keys(G.players).find(p => G.players[p].character === char);
    const P = G.players[pid];
    G.activeCrew = pid;
    P.acted = false; P.bonusCubes = 0; P.inSpace = null;
    P.pendingHypoxia = 0; P.pendingDrop = 0; P.pos = 2;
    // кубиков заведомо хватает: база из своего пула, доплата — с любого
    P.plan = { move: 4, search: 4, activate: 4, special: 4, door: 4,
      spent: { move: 0, search: 0, activate: 0, special: 0, door: 0 } };
    if (dark) G.board[2].hazards.darkness = true;
    if (malware) G.eventOngoing = 'malware';
    return { G, P, pid };
  };
  // Как выполнить каждое действие; предусловия ставятся здесь же. На цену
  // (actionCost) они не влияют — только тьма/malware/персонаж.
  const RUN = {
    move: (G, P, pid) => mv('actMove')({ G, playerID: pid, random: makeRandom() }, 1),
    search: (G, P, pid) => mv('actSearch')({ G, playerID: pid, random: makeRandom() }, false),
    activate: (G, P, pid) => { P.inventory = [{ id: 'battery', faceUp: false }]; return mv('actActivate')({ G, playerID: pid, random: makeRandom() }, 0); },
    door: (G, P, pid) => { G.board[2].doors = [1]; return mv('actOpenDoor')({ G, playerID: pid, random: makeRandom() }, 1); },
    special: (G, P, pid) => { P.inventory = []; G.board[2].hazards.hypoxia = true; return mv('actSpecial')({ G, playerID: pid, random: makeRandom() }, { kind: 'clearHazard', hazard: 'hypoxia', loc: 2 }); },
  };
  for (const action of ['move', 'search', 'activate', 'door', 'special']) {
    for (const dark of [false, true]) {
      for (const malware of [false, true]) {
        for (const char of ['artem', 'mei']) {
          const { G, P, pid } = setupAct({ dark, malware, char });
          const tag = `${action} (тьма=${dark}, malware=${malware}, ${char})`;
          const shown = actionCost(G, pid, action).need;   // столько показывает кнопка
          const before = spentOf(P);
          const r = RUN[action](G, P, pid);
          assert(r !== 'INVALID_MOVE', `${tag}: действие выполнилось`);
          const deducted = spentOf(P) - before;
          assert(shown === deducted, `${tag}: на кнопке ${shown}⬛, движок списал ${deducted}`);
        }
      }
    }
  }
}

// --- A2: цена показана на самих кнопках обычных действий (с тьмой) ---
{
  const G = baseG();
  G.phase = 'actions';
  const pid = Object.keys(G.players).find(p => G.players[p].character === 'artem');
  const P = G.players[pid];
  G.activeCrew = pid;
  P.pos = 2; P.inSpace = null; P.acted = false; P.bonusCubes = 0;
  P.pendingHypoxia = 0; P.pendingDrop = 0;
  P.inventory = [{ id: 'battery', faceUp: false }];
  P.plan = { move: 2, search: 2, activate: 2, special: 0, door: 2,
    spent: { move: 0, search: 0, activate: 0, special: 0, door: 0 } };
  G.board[2].hazards.darkness = true;   // база 1 + тьма 1 = 2⬛ на каждой кнопке
  const html = render(viewFor(G, pid), pid);
  const btnAround = (word) => {
    const i = html.indexOf(word);
    if (i < 0) return null;
    const j = html.lastIndexOf('<button', i);
    const k = html.indexOf('</button>', i);
    return (j < 0 || k < 0) ? null : html.slice(j, k + 9);
  };
  const moveB = btnAround('клик по локации');
  assert(moveB && moveB.includes('2⬛'), 'на кнопке движения показана цена с тьмой (2⬛)');
  const searchB = btnAround('осмотреть локацию');
  assert(searchB && searchB.includes('2⬛'), 'на кнопке поиска показана цена с тьмой');
  const doorB = btnAround('Открыть дверь');
  assert(doorB && doorB.includes('2⬛'), 'на кнопке двери показана цена с тьмой');
  const actB = btnAround('Активировать');
  assert(actB && actB.includes('2⬛'), 'на кнопке активации показана цена с тьмой');
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

// --- Карточки предметов (ItemCard): thumb / full / faceDown / fallback ---
{
  const rc = (props) => strip(renderToString(React.createElement(ItemCard, props)));

  const thumb = rc({ id: 'axe', size: 'thumb' });
  assert(thumb.includes('itemcard thumb'), 'ItemCard thumb: класс миниатюры');
  assert(thumb.includes('<img') && thumb.includes('.webp'), 'ItemCard thumb: картинка-ассет webp');
  assert(thumb.includes('Топор'), 'ItemCard thumb: название в alt/подсказке');
  assert(thumb.includes('m-blue'), 'ItemCard: рамка цвета миссии (топор — синяя)');

  const full = rc({ id: 'medkit', size: 'full' });
  assert(full.includes('itemcard full'), 'ItemCard full: класс полной карточки');
  assert(full.includes('Аптечка'), 'ItemCard full: название');
  assert(full.includes(ITEM_EFFECTS.medkit), 'ItemCard full: текст эффекта из data.js');

  // faceDown — рубашка, названия нет (так рисуется чужой скрытый предмет).
  const back = rc({ id: 'axe', size: 'thumb', faceDown: true });
  assert(back.includes('itemcard back'), 'ItemCard faceDown: рубашка');
  assert(!back.includes('Топор'), 'ItemCard faceDown: название скрыто (рубашка, не карточка)');
  assert(rc({ id: 'hidden', size: 'thumb' }).includes('itemcard back'),
    'ItemCard id=hidden (как из playerView) → рубашка');

  // fallback — арта в манифесте нет: текст, без битой картинки и без падения.
  const fb = rc({ id: 'no_such_item', size: 'full' });
  assert(fb.includes('itemcard fallback'), 'ItemCard без арта: текстовый фолбэк');
  assert(!fb.includes('<img'), 'ItemCard фолбэк: без битой картинки');

  // note — у известного предмета скрыта только локация (маркер миссии).
  const noted = rc({ id: 'blue_card', size: 'thumb', note: '▩ локация скрыта' });
  assert(noted.includes('Синяя карта') && noted.includes('локация скрыта'),
    'ItemCard: предмет показан, скрыта лишь локация — пометкой');
}

// --- Точки показа: инвентарь, миссии, разведка рендерят карточки ---
{
  const G = baseG();
  G.phase = 'actions';
  const pid = Object.keys(G.players)[0];
  G.activeCrew = pid;
  const P = G.players[pid];
  P.pos = 6; P.inSpace = null;
  P.inventory = [{ id: 'battery', faceUp: true, charge: 2 }, { id: 'blue_card', faceUp: false }];
  P.plan = { move: 1, search: 1, activate: 1, special: 1, door: 0, spent: { move: 0, search: 0, activate: 0, special: 0, door: 0 } };
  P.knownItems = { 9: ['medkit'] };               // как после дрона/поиска
  const html = render(viewFor(G, pid), pid);

  assert(html.includes('Инвентарь') && html.includes('itemcard thumb'),
    'инвентарь показывает миниатюры карточек');
  assert(html.includes('Батарея'), 'свой предмет назван в карточке инвентаря');

  for (const s of MARKER_SLOTS) assert(html.includes(ITEMS[s].name), `маркер «${ITEMS[s].name}» показан в миссиях`);
  assert(html.includes('Топор') && html.includes('Шлем'), 'финальные топор и шлем — в шапках миссий');
  assert(html.includes('локация скрыта'), 'у скрытого маркера — пометка «локация скрыта»');

  assert(html.includes('Разведка') && html.includes('Аптечка'),
    'панель разведки показывает известный предмет карточкой (результат дрона/поиска)');
}

// --- Скрытое остаётся рубашкой: чужой закрытый предмет не раскрывается ---
{
  const G = baseG();
  G.phase = 'actions';
  const [me, other] = Object.keys(G.players);
  G.players[me].pos = 5; G.players[me].inSpace = null;        // терминал доставки
  G.players[other].pos = 9; G.players[other].inSpace = null;  // НЕ в одной локации
  G.players[other].inventory = [{ id: 'axe', faceUp: false }];
  G.activeCrew = me;
  G.players[me].plan = { move: 0, search: 0, activate: 0, special: 4, door: 0, spent: { move: 0, search: 0, activate: 0, special: 0, door: 0 } };

  const V = viewFor(G, me);
  assert(V.players[other].inventory[0].id === 'hidden', 'чужой закрытый предмет вырезан в playerView');
  const html = render(V, me);
  assert(html.includes('itemcard back'), 'на терминале доставки чужой скрытый предмет — рубашкой');
  assert(html.includes('забрать «предмет 1»'), 'в подписи «забрать» название не раскрыто');
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
