// Дымовой тест: локальная партия на 4 игроков, полный цикл хода
import bgioClient from 'boardgame.io/dist/cjs/client.js';
const { Client } = bgioClient;
import bgioMp from 'boardgame.io/dist/cjs/multiplayer.js';
const { Local } = bgioMp;
import { Adel } from '../src/game/index.js';
import { ADJ, CUBE_ACTIONS } from '../src/game/data.js';

const mk = (pid) => Client({ game: Adel, numPlayers: 4, multiplayer: Local(), playerID: pid });
const clients = ['0', '1', '2', '3'].map(mk);
clients.forEach(c => c.start());
const [adel, c1, c2, c3] = clients;

const G = () => adel.getState().G;
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); console.error(G().log.slice(-8)); process.exit(1); } };

assert(G().phase === 'planning', 'начинаем с планирования');
assert(G().turnNo === 15, '15 ходов на 4 игроков, got ' + G().turnNo);
assert(Object.keys(G().players).length === 3, '3 члена экипажа');
for (let l = 1; l <= 20; l++) assert(G().board[l].items.length === 1, 'предмет в каждой локации');

// планы
c1.moves.commitPlan({ move: 2, search: 1, activate: 0, special: 0, door: 1 });
// ширмы закрыты: чужой план не виден даже союзнику по экипажу
assert(c2.getState().G.players['1'].plan === null, 'план игрока 1 скрыт от игрока 2 в фазу планирования');
for (const c of [c2, c3]) c.moves.commitPlan({ move: 2, search: 1, activate: 0, special: 0, door: 1 });
assert(G().phase === 'adel', 'после планов — фаза АДЕЛЬ, got ' + G().phase);

// Аргументы ходов вырезаны из журнала boardgame.io. Без redact АДЕЛЬ прочитала
// бы план экипажа прямо в логе, и фильтрация playerView была бы бесполезна.
const commits = (adel.getState().log || []).filter(e => e.action?.payload?.type === 'commitPlan');
assert(commits.length > 0, 'ходы commitPlan попадают в журнал');
assert(commits.every(e => !e.action.payload.args), 'аргументы commitPlan вырезаны из журнала (redact)');

// АДЕЛЬ выкладывает фишки вслепую: ширмы открываются только в фазу розыгрыша
for (const pid of ['1', '2', '3']) {
  assert(adel.getState().G.players[pid].plan === null, `план игрока ${pid} скрыт от АДЕЛЬ в её фазу`);
  if (pid !== '1') assert(c1.getState().G.players[pid].plan === null, `план игрока ${pid} скрыт от игрока 1 в фазу АДЕЛЬ`);
}
assert(c1.getState().G.players['1'].plan !== null, 'свой план игрок 1 видит');

// АДЕЛЬ играет карту, если есть подходящая фишка
const hand = adel.getState().G.adel.hand;
const conRows = Object.entries(G().adel.console).filter(([, r]) => r.length);
if (hand.length && conRows.length) {
  const card = hand.find(c => c.type === 'loc');
  const [hz] = conRows.find(([h]) => h !== 'door' && h !== 'lockdown') || [];
  if (card && hz) {
    adel.moves.adelPlayCard(card.id, { type: hz, target: { loc: card.locs[0] } });
    assert(G().board[card.locs[0]].hazards[hz] === true, 'фишка выложена на поле');
  }
}
adel.moves.adelEndPhase();
assert(G().phase === 'actions', 'фаза действий, got ' + G().phase);
assert(G().adel.hand.length === 4, 'рука АДЕЛЬ добрана до 4, got ' + G().adel.hand.length);

// ширмы открыты — теперь планы видны всем
assert(adel.getState().G.players['1'].plan !== null, 'в фазу действий план игрока 1 виден АДЕЛЬ');

// Гипоксия могла отнять кубик: пока он не отдан, игрок не может ни действовать,
// ни завершить ход. Отдаём наименее нужный, чтобы движение и поиск остались.
const HYPOXIA_ORDER = ['door', 'activate', 'special', 'search', 'move'];
const settleHypoxia = (client, pid) => {
  for (let guard = 0; G().players[pid].pendingHypoxia && guard < 5; guard++) {
    const plan = G().players[pid].plan;
    const k = HYPOXIA_ORDER.find(a => plan[a] - plan.spent[a] > 0);
    if (!k) break;
    client.moves.payHypoxia(k);
  }
};

// экипаж ходит по очереди
c1.moves.claimActive();
assert(G().activeCrew === '1', 'игрок 1 активен');
settleHypoxia(c1, '1');

// цель выбираем среди реально открытых проёмов: АДЕЛЬ могла заблокировать дверь
const from = G().players['1'].pos;
const dest = ADJ[from].find(d => !G().board[from].doors.includes(d) && !G().board[d].doors.includes(from));
assert(dest != null, 'из локации ' + from + ' есть хотя бы один открытый проём');
c1.moves.actMove(dest);
assert(G().players['1'].pos === dest, `игрок перешёл в локацию ${dest}, а стоит в ${G().players['1'].pos}`);

c1.moves.actSearch(true);
settleHypoxia(c1, '1');
c1.moves.finishTurn();
assert(G().players['1'].acted, 'игрок 1 завершил действия');
for (const [client, pid] of [[c2, '2'], [c3, '3']]) {
  client.moves.claimActive();
  settleHypoxia(client, pid);
  client.moves.finishTurn();
}
assert(G().turnNo === 14 || G().winner, 'ход перещёлкнулся: ' + G().turnNo + ' winner=' + G().winner);
assert(G().phase === 'planning' || G().winner, 'новый ход — планирование');

// скрытая информация: экипаж не видит руку АДЕЛЬ
const v1 = c1.getState().G;
assert(v1.adel.hand.every(c => c.id === 'hidden'), 'рука АДЕЛЬ скрыта от экипажа');
assert(typeof v1.adel.bag === 'number', 'состав мешочка скрыт');
const hiddenMarkers = Object.values(v1.missions.markers).filter(m => m.loc === null).length;
assert(hiddenMarkers >= 2, 'часть маркеров скрыта от игрока 1: скрыто ' + hiddenMarkers);
const va = adel.getState().G;
const hiddenItemsFromAdel = Object.values(va.board).every(L => L.items.every(it => it.faceUp || it.known || it.id === 'hidden'));
assert(hiddenItemsFromAdel, 'предметы на поле скрыты от АДЕЛЬ (кроме шпионажа)');

// ---------- второй поддерживаемый состав: АДЕЛЬ + 2 члена экипажа ----------
// Через настоящий boardgame.io: сервер должен принимать стол на троих, а
// раскладка — собираться под двух членов экипажа.
{
  // Свой matchID обязателен: Local() держит один общий стол на весь процесс,
  // и без него клиенты подключились бы к уже идущей партии на четверых.
  const mk3 = (pid) => Client({ game: Adel, numPlayers: 3, multiplayer: Local(), playerID: pid, matchID: 'table3' });
  const cl3 = ['0', '1', '2'].map(mk3);
  cl3.forEach(c => c.start());
  const [adel3, p1, p2] = cl3;
  const G3 = () => adel3.getState().G;

  assert(Object.keys(G3().players).length === 2, 'в экипаже двое');
  assert(G3().turnNo === 18, 'на троих даётся 18 ходов, got ' + G3().turnNo);

  // Локацию линзы знают оба члена экипажа, а по одному предмету каждой миссии —
  // только свой владелец.
  const lensSeen = [p1, p2].map(c => c.getState().G.missions.markers.lens.loc);
  assert(lensSeen.every(l => l != null), 'локацию линзы видят оба члена экипажа');
  assert(adel3.getState().G.missions.markers.lens.loc == null, 'АДЕЛЬ линзу не видит');
  const hiddenFrom1 = Object.values(p1.getState().G.missions.markers).filter(m => m.loc === null).length;
  assert(hiddenFrom1 === 2, 'от первого скрыты два чужих маркера, скрыто ' + hiddenFrom1);

  // Полный ход: планы → фаза АДЕЛЬ → действия → новый ход.
  for (const c of [p1, p2]) c.moves.commitPlan({ move: 2, search: 1, activate: 0, special: 0, door: 1 });
  assert(G3().phase === 'adel', 'после планов — фаза АДЕЛЬ, got ' + G3().phase);
  adel3.moves.adelEndPhase();
  assert(G3().phase === 'actions', 'фаза действий, got ' + G3().phase);

  const HYP = ['door', 'activate', 'special', 'search', 'move'];
  for (const [c, pid] of [[p1, '1'], [p2, '2']]) {
    c.moves.claimActive();
    for (let guard = 0; G3().players[pid].pendingHypoxia && guard < 5; guard++) {
      const pl = G3().players[pid].plan;
      const k = HYP.find(a => pl[a] - pl.spent[a] > 0);
      if (!k) break;
      c.moves.payHypoxia(k);
    }
    for (let guard = 0; G3().players[pid].pendingDrop && guard < 5; guard++) c.moves.dropItem(0);
    c.moves.finishTurn();
  }
  assert(G3().turnNo === 17 || G3().winner, 'ход перещёлкнулся: ' + G3().turnNo);

  // Предметы напарника закрыты, пока они не в одной локации.
  const v = p1.getState().G;
  assert(v.players['2'].inventory.every(it => it.id === 'hidden' || it.faceUp),
    'инвентарь напарника скрыт, пока не встретились');

  cl3.forEach(c => c.stop());
}

console.log('SMOKE OK ✓  журнал (хвост):');
console.log(G().log.slice(-6).join('\n'));
clients.forEach(c => c.stop());
