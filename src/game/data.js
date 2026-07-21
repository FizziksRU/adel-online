// ============================================================
// А.Д.Е.Л.Ь. — игровые данные (сторона «Фобос»)
// Состав сверен с физической коробкой целиком; расшифровка — в COMPONENTS.md.
// Суммы проверяются тестами: если правите числа, они должны сойтись.
// ============================================================

// --- Карта «Фобос»: переходы между локациями (из правил, проверено) ---
export const ADJ = {
  1: [2], 2: [1, 3, 6], 3: [2, 4], 4: [3, 9],
  5: [6], 6: [2, 5, 7], 7: [6, 8], 8: [7, 9],
  9: [4, 8, 10, 11], 10: [9, 13, 14], 11: [9, 17, 18], 12: [15, 19],
  13: [10, 16], 14: [10, 15], 15: [12, 14], 16: [13],
  17: [11, 20], 18: [11, 19], 19: [12, 18], 20: [17],
};

export const SECTORS = {
  green: [1, 2, 3, 4], yellow: [5, 6, 7, 8], grey: [9, 10, 11, 12],
  red: [13, 14, 15, 16], blue: [17, 18, 19, 20],
};
export const SECTOR_OF = {};
for (const [c, locs] of Object.entries(SECTORS)) locs.forEach(l => (SECTOR_OF[l] = c));
export const SECTOR_NAMES = { green: 'зелёный', yellow: 'жёлтый', grey: 'серый', red: 'красный', blue: 'синий' };

// Терминалы («Фобос»). Все шесть сверены с полем.
// Командный (лок. 1) отодвигает точку невозврата на одно деление вниз.
export const TERMINALS = {
  1: 'command', 5: 'delivery', 14: 'engineering', 16: 'repair', 18: 'medical', 20: 'central',
};
export const TERMINAL_NAMES = {
  delivery: 'Терминал доставки', engineering: 'Инженерный терминал', repair: 'Ремонтный терминал',
  medical: 'Медицинский терминал', central: 'Центральный терминал', command: 'Командный терминал',
};
export const LAB_LOC = 14;            // лаборатория «Фобоса»
export const BLUE_FINAL_LOC = 20;     // топор → центральный
export const RED_FINAL_LOC = 16;      // шлем → побег
export const ALARM_START = [3, 17];

// --- Открытый космос ---
// Внешняя часть поля — четыре секции по периметру корпуса. Границы секций
// приходятся на локации с люками, поэтому 13 и 17 выходят сразу в две секции:
//   A: дуга 1–3–4–13    B: 13–16–15–12    C: 12–19–20–17    D: 17–8–7–5
// Секции замкнуты в кольцо: от 5 обратно к 1 через нос корабля.
export const SPACE_SECTIONS = ['A', 'B', 'C', 'D'];
export const SPACE_NAMES = {
  A: 'Секция 1–13', B: 'Секция 13–12', C: 'Секция 12–17', D: 'Секция 17–5',
};
// Люки: шесть, по числу жетонов закрытых люков в коробке.
export const HATCHES = {
  3: ['A'], 13: ['A', 'B'], 15: ['B'], 19: ['C'], 17: ['C', 'D'], 7: ['D'],
};
export const SPACE_ADJ = { A: ['B', 'D'], B: ['A', 'C'], C: ['B', 'D'], D: ['C', 'A'] };
// Локации, примыкающие к секции снаружи: из них можно убрать жетон повреждения
// специальным действием, находясь в открытом космосе.
export const SPACE_NEAR = {
  A: [1, 3, 4, 13], B: [13, 16, 15, 12], C: [12, 19, 20, 17], D: [17, 8, 7, 5],
};

// --- Персонажи (из правил; четвёртый — заглушка) ---
export const CHARACTERS = {
  mei: { id: 'mei', name: 'Мэй Чжао', spirit: 2, start: 'extinguisher', invLoss: [4], special: 'cheap_special' },
  emma: { id: 'emma', name: 'Эмма Рончони', spirit: 3, start: 'medkit', invLoss: [2, 4], special: 'medic' },
  artem: { id: 'artem', name: 'Артём Коровин', spirit: 4, start: 'battery', invLoss: [2, 4], special: null },
};

// --- Предметы ---
export const ITEMS = {
  // ключевые
  blue_card: { name: 'Синяя карта', kind: 'key', mission: 'blue' },
  id_badge: { name: 'Удостоверение', kind: 'key', mission: 'blue' },
  axe: { name: 'Топор', kind: 'key', mission: 'blue', final: true },
  chipItem: { name: 'Чип', kind: 'key', mission: 'red' },
  toolbox: { name: 'Ящик с инструментами', kind: 'key', mission: 'red' },
  helmet: { name: 'Шлем', kind: 'key', mission: 'red', final: true },
  lens: { name: 'Линза-сетчатка', kind: 'key', mission: 'both' },
  // прочие
  stims: { name: 'Стимуляторы', kind: 'oneshot' },
  drone: { name: 'Дрон слежения', kind: 'charged' },
  medkit: { name: 'Аптечка', kind: 'oneshot' },
  extinguisher: { name: 'Огнетушитель', kind: 'oneshot' },
  battery: { name: 'Батарея', kind: 'charged' },
  teddy: { name: 'Плюшевый мишка', kind: 'permanent' },
  parts: { name: 'Детали', kind: 'oneshot' },
  suit: { name: 'Скафандр', kind: 'charged' },
  flashlight: { name: 'Фонарь', kind: 'charged' },
};

export const LAB_STACK = ['extinguisher', 'suit', 'flashlight', 'battery', 'drone'];

// Полный состав жетонов предметов в коробке — всего 32 (проверяется тестом).
export const ITEM_COUNTS = {
  // ключевые — по одному
  blue_card: 1, id_badge: 1, axe: 1, chipItem: 1, toolbox: 1, helmet: 1, lens: 1,
  // прочие
  stims: 3, drone: 2, flashlight: 3, medkit: 2, teddy: 1,
  parts: 3, suit: 3, extinguisher: 4, battery: 4,
};

// В каждую локацию кладётся один жетон: 7 ключевых + обязательные две детали
// и батарея + RANDOM_DRAW случайных = 20.
export const BOARD_FIXED = ['parts', 'parts', 'battery'];
export const RANDOM_DRAW = 10;

// Из чего тянутся эти случайные жетоны: всё, что осталось в куче после
// стопки лаборатории, ключевых предметов, обязательных жетонов поля и
// стартовых предметов персонажей, участвующих в партии. Незанятые жетоны
// уходят обратно в коробку не глядя.
export function randomPool(charIds = Object.keys(CHARACTERS)) {
  const left = { ...ITEM_COUNTS };
  const take = (id) => {
    // Молча уйти в минус нельзя: пул бы просто усох, и ошибка в составе
    // всплыла бы посреди партии нехваткой жетонов.
    if (!(left[id] > 0)) throw new Error(`в коробке не хватает жетона «${id}» для раскладки`);
    left[id] -= 1;
  };
  for (const [id, item] of Object.entries(ITEMS)) if (item.kind === 'key') take(id);
  for (const id of LAB_STACK) take(id);
  for (const id of BOARD_FIXED) take(id);
  for (const id of charIds) take(CHARACTERS[id].start);
  const pool = [];
  for (const [id, n] of Object.entries(left)) for (let i = 0; i < n; i++) pool.push(id);
  return pool;
}

// --- Фишки опасности ---
export const HAZARDS = ['fire', 'hypoxia', 'darkness', 'lockdown', 'spy', 'door'];
export const HAZARD_NAMES = {
  fire: 'Пожар', hypoxia: 'Гипоксия', darkness: 'Тьма',
  lockdown: 'Блокировка', spy: 'Шпионаж', door: 'Заблокир. дверь',
};
// Значки опасностей — одни и те же на карте корабля и на ячейках консоли,
// чтобы «что лежит на поле» и «что доступно АДЕЛЬ» читались одинаково.
export const HAZARD_ICON = {
  fire: '🔥', hypoxia: '🫁', darkness: '🌑', lockdown: '🔒', spy: '👁', door: '🚪',
};
// Однобуквенные обозначения оставлены как запасной вариант: значки в некоторых
// шрифтах сливаются, и тогда буквы читаются надёжнее.
export const HAZARD_SHORT = {
  fire: 'П', hypoxia: 'Г', darkness: 'Т', lockdown: 'Б', spy: 'Ш', door: 'З',
};
// Состав мешочка — сверен с коробкой, в сумме ровно 52 фишки.
export const BAG_COUNTS = {
  fire: 12,      // «огонь»
  hypoxia: 11,   // «кислород»
  door: 10,      // «закрытие дверей»
  darkness: 7,   // «свет»
  spy: 6,        // «шпионаж»
  lockdown: 6,   // «компьютер»
};
// --- Консоль АДЕЛЬ ---
// Сетка ячеек, сгруппированных по цене выкладывания в энергии. Ячеек каждого
// вида ровно столько, сколько фишек этого вида в мешочке (в сумме 52), — это
// проверяется тестом. Дешёвые виды (шпионаж, двери) живут слева, дорогие
// (свет, блокировка) — справа, поэтому набор возможностей АДЕЛЬ смещается
// к дорогим по мере накопления фишек.
export const CONSOLE_LAYOUT = {
  2: { spy: 3, door: 1 },
  3: { spy: 2, door: 2, fire: 1 },
  4: { spy: 1, door: 2, fire: 2 },
  5: { door: 5, fire: 3, hypoxia: 2 },
  6: { fire: 6, hypoxia: 2, darkness: 2 },
  7: { hypoxia: 6, darkness: 3, lockdown: 1 },
  8: { hypoxia: 1, darkness: 2, lockdown: 2 },
  9: { lockdown: 3 },
};
export const CONSOLE_COSTS = Object.keys(CONSOLE_LAYOUT).map(Number).sort((a, b) => a - b);
// Порядок видов в колонке снизу вверх — как на планшете.
export const CONSOLE_ORDER = ['spy', 'door', 'fire', 'hypoxia', 'darkness', 'lockdown'];

// --- Действия экипажа (4 кубика распределяются между ними в планировании) ---
export const CUBE_ACTIONS = ['move', 'search', 'activate', 'special', 'door'];
export const ACTION_NAMES = {
  move: 'Движение', search: 'Поиск', activate: 'Активация', special: 'Спец.', door: 'Дверь',
};

// --- Колода событий ---
export const EVENTS = {
  stress: { name: 'Стресс', kind: 'ongoing', text: '−1 к духу на все проверки до конца хода.' },
  maneuver: { name: 'Манёвр уклонения', kind: 'instant', text: 'Каждый член экипажа проходит проверку духа, иначе рана.' },
  malware: { name: 'Вредоносная программа', kind: 'ongoing', text: 'Все спец. действия требуют +1 кубик в этот ход.' },
  drift: { name: 'Дрейф', kind: 'instant', text: 'Точка невозврата сдвигается на 1 вверх.' },
  silence: { name: 'Тишина', kind: 'instant', text: 'Ничего не происходит (аномалии могут сработать).' },
  collision: { name: 'Столкновение', kind: 'instant', text: 'd20 → жетон повреждения; раны находящимся там.' },
};

// Все 25 карт событий поимённо. У каждой свой цвет-шестиугольник (по нему
// работают спецкарта АДЕЛЬ «Перегрузка сектора» и аномалия «Атака») и, у части
// карт, значок паники — то есть паника привязана к КАРТЕ, а не к типу события.
// Цвета разложены поровну: ровно по пять карт каждого цвета.
export const EVENT_DECK = [
  { id: 'collision', color: 'green' },
  { id: 'collision', color: 'red', panic: true },
  { id: 'collision', color: 'blue' },
  { id: 'collision', color: 'yellow', panic: true },

  { id: 'malware', color: 'yellow', panic: true },
  { id: 'malware', color: 'grey' },
  { id: 'malware', color: 'green', panic: true },
  { id: 'malware', color: 'red' },

  { id: 'stress', color: 'green' },
  { id: 'stress', color: 'blue' },
  { id: 'stress', color: 'red', panic: true },
  { id: 'stress', color: 'grey', panic: true },

  // «Тишина» убирается из колоды при игре вчетвером и впятером
  { id: 'silence', color: 'red' },
  { id: 'silence', color: 'grey', panic: true },
  { id: 'silence', color: 'yellow', panic: true },
  { id: 'silence', color: 'blue' },
  { id: 'silence', color: 'green' },

  { id: 'drift', color: 'grey', panic: true },
  { id: 'drift', color: 'blue' },
  { id: 'drift', color: 'yellow', panic: true },
  { id: 'drift', color: 'red' },

  { id: 'maneuver', color: 'blue', panic: true },
  { id: 'maneuver', color: 'green', panic: true },
  { id: 'maneuver', color: 'yellow' },
  { id: 'maneuver', color: 'grey' },
];

// --- Колода АДЕЛЬ: 20 карт локаций + 7 специальных = 27 (сверено с коробкой) ---
// Пары сверены с коробкой. Колода устроена строго: каждая из 20 локаций
// встречается ровно дважды — один раз в паре «шаг 5» и один раз в паре
// «шаг 10». Значит, любую локацию АДЕЛЬ может накрыть ровно двумя картами.
// Структура проверяется тестом.
export const ADEL_CARDS = [
  // шаг 5
  [1, 6], [2, 7], [3, 8], [4, 9], [5, 10],
  [11, 16], [12, 17], [13, 18], [14, 19], [15, 20],
  // шаг 10
  [1, 11], [2, 12], [3, 13], [4, 14], [5, 15],
  [6, 16], [7, 17], [8, 18], [9, 19], [10, 20],
].map(([a, b], i) => ({ id: `L${i + 1}`, type: 'loc', locs: [a, b] }));
// Специальные карты замешиваются в общую колоду АДЕЛЬ и приходят в руку при
// доборе наравне с картами локаций — отдельной «выкладки» специальных карт нет.
// Это видно по самим картам: одна сбрасывает «эту карту и ещё до трёх с руки»,
// другая возвращает карту «из сброса на верх колоды».
//
// Стоимость фишки на картах не печатается — она считывается с консоли (берётся
// самая дорогая фишка нужного вида). Поле cost — это СОБСТВЕННАЯ цена карты в
// энергии. Где какая цена платится, задаётся в hazardCardRules: у карт локаций
// и «Перегрузки сектора» — консольная, у «Распространения» — только своя
// (иначе выкладывание стоило бы 8–11⚡ и карта была бы мёртвой), у карт без
// выкладывания фишки — тоже только своя.
export const ADEL_SPECIALS = [
  {
    id: 'S_energy', type: 'special', name: 'Подзарядка', cost: 0,
    text: 'Прибавьте 5 к запасу энергии.',
  },
  {
    id: 'S_color', type: 'special', name: 'Перегрузка сектора', cost: 0,
    text: 'Выложите фишку в любую локацию сектора, чей цвет совпадает с цветом текущего события. Оплата — по консоли.',
  },
  {
    id: 'S_recall', type: 'special', name: 'Восстановление данных', cost: 3,
    text: 'Верните одну карту из своего сброса на верх колоды. Колода не перемешивается.',
  },
  {
    id: 'S_spread', type: 'special', name: 'Распространение', cost: 3,
    text: 'Выложите с консоли «пожар» или «гипоксию» в локацию, соседнюю с той, где уже есть фишка того же вида. Стоит 3 энергии независимо от того, насколько дорога сама фишка.',
  },
  {
    id: 'S_redraw', type: 'special', name: 'Пересборка руки', cost: 3,
    text: 'Сбросьте эту карту и до трёх других с руки, затем возьмите столько же новых.',
  },
  {
    id: 'S_rechip', type: 'special', name: 'Дефрагментация', cost: 3,
    text: 'Верните из сброса на консоль до трёх фишек опасности — по обычным правилам, в самые дешёвые свободные ячейки.',
  },
  {
    id: 'S_reshuffle', type: 'special', name: 'Пересчёт вероятностей', cost: 3,
    text: 'Перетасуйте колоду событий и откройте новую верхнюю карту. Отмена события, если она была, пропадает.',
  },
];

// Сколько специальных карт убирается в коробку при подготовке. В буклете есть
// правило «уберите две специальные карты для первой партии»; мы играем полным
// набором, но число вынесено сюда, чтобы включить укороченный вариант одной
// правкой. Сколько карт остаётся в игре, считается от длины массива.
export const SPECIALS_REMOVED = 0;

export const ADEL_HAND_LIMIT = 4;      // предел руки АДЕЛЬ
export const SPECIAL_ENERGY_GAIN = 5;  // «Подзарядка»
export const SPECIAL_REDRAW_MAX = 3;   // «Пересборка руки»: сверх самой карты
export const SPECIAL_RECHIP_MAX = 3;   // «Дефрагментация»: фишек за раз
// Виды фишек, которые умеет расселять «Распространение».
export const SPREAD_HAZARDS = ['fire', 'hypoxia'];

// --- Аномалии ---
// Цвета на обороте жетонов сверены с коробкой. Чтобы активировать аномалию,
// АДЕЛЬ платит ANOMALY_COST энергии и сбрасывает с поля по одной фишке из
// сектора каждого указанного цвета. Число цветов у жетонов разное — от двух
// до четырёх: чем сильнее эффект, тем дороже.
// Жетонов повреждений в коробке четыре — больше на поле оказаться не может.
export const DAMAGE_TOKENS = 4;

export const ANOMALY_COST = 5;
export const ANOMALIES = {
  close_hatches: { name: 'Закрыть люки!', colors: ['green', 'blue', 'grey'], text: 'Все люки закрыты; открыть — спец. действием.' },
  kill_terminals: { name: 'Деактивированные терминалы', colors: ['blue', 'grey'], text: 'Терминалы тревоги отключены (красная сторона).' },
  drained: { name: 'Разряженные батареи', colors: ['green', 'red'], text: 'Предметы с зарядом получают −1 к заряду при активации.' },
  explosions: { name: 'Взрывы', colors: ['yellow', 'blue', 'red'], text: '−2 к духу на проверках против ран от «пожара».' },
  panic: { name: 'Паника', colors: ['green', 'red', 'yellow', 'grey'], text: 'Когда на событии есть значок паники — все проходят проверку духа, иначе рана.' },
  attack: { name: 'Атака', colors: ['yellow', 'green', 'red'], text: 'Раз в фазу АДЕЛЬ она может дополнительно выложить фишку в локацию цвета события (за энергию).' },
};

// --- Маркеры миссий ---
// Слоты скрытых маркеров: 5 предметов, локации распределяются случайно из 1..20
// кроме 16 и 20 (их маркеров не существует).
export const MARKER_SLOTS = ['toolbox', 'id_badge', 'lens', 'chipItem', 'blue_card'];
export const MARKER_LOC_POOL = Array.from({ length: 20 }, (_, i) => i + 1).filter(l => l !== 16 && l !== 20);

// Кто из экипажа изначально знает локацию каждого ключевого предмета.
// Индексы — порядок хода с нуля (#1 → 0).
const MARKER_TABLE = {
  // Экипаж из двух. Строки для двоих в буклете нет (там разбираются составы
  // от трёх членов экипажа), поэтому раскладка задана владельцем коробки:
  // каждый знает по одному предмету синей и красной миссии, а линзу-сетчатку
  // — «середину» шкалы миссий — с самого начала знают оба. Где лежит сам
  // предмет, при этом по-прежнему не знает никто.
  2: { id_badge: [0], toolbox: [0], blue_card: [1], chipItem: [1], lens: [0, 1] },
  // Экипаж из трёх — официальный пример из правил (шаг 8 подготовки):
  // первый знает ящик и удостоверение, второй — синюю карту и чип,
  // третий — линзу.
  3: { toolbox: [0], id_badge: [0], blue_card: [1], chipItem: [1], lens: [2] },
};
export function markerAssignments(nCrew) {
  const table = MARKER_TABLE[nCrew];
  if (!table) {
    throw new Error(`таблицы маркеров для ${nCrew} членов экипажа нет; поддержаны: ${CREW_SIZES.join(', ')}`);
  }
  return table;
}

// Размер партии. Поддержаны составы АДЕЛЬ + 2 и АДЕЛЬ + 3: в коробке четыре
// планшета персонажей, но четвёртый не разобран, а строки таблицы маркеров
// для 4–5 членов экипажа в буклете не читаются.
export const CREW_SIZES = Object.keys(MARKER_TABLE).map(Number).sort((a, b) => a - b);
export const MIN_TABLE = CREW_SIZES[0] + 1;
export const MAX_TABLE = CREW_SIZES[CREW_SIZES.length - 1] + 1;
// Состав по умолчанию для лобби.
export const CREW_SIZE = 3;
export const TABLE_SIZE = CREW_SIZE + 1;

export function turnsFor(nPlayers) { return nPlayers >= 5 ? 12 : nPlayers === 4 ? 15 : 18; }
export function energyFor(nPlayers) { return nPlayers >= 5 ? 15 : 10; }
export function chipsPerTurn(nPlayers) { return nPlayers >= 5 ? 4 : 3; }
export const ENERGY_MAX = 50;
