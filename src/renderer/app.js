const STATUS_LABELS = LadWork.labels;

const STATUS_COLORS = {
  onsite:'#36bf76',zkp:'#36a8b7',
  working: '#36a8b7', planned_work: '#668ac9',
  pending: '#586b85',
  submitted: '#36bf76',
  submitted_late: '#82c967',
  submitted_advance: '#45b995',
  missed: '#df555d',
  other_tasks: '#36a8b7',
  personal_permission: '#dc76aa',
  sick: '#dd9340',
  vacation: '#9873d6',
  day_off: '#668ac9',
  holiday: '#60718a',
};

const STATUS_SYMBOLS = {
  onsite:'Р',zkp:'ЗКП',working:'Р', planned_work:'П',
  pending: '·',
  submitted: '✓',
  submitted_late: '◷',
  submitted_advance: '↗',
  missed: '×',
  other_tasks: 'ІЗ',
  personal_permission: 'ОС',
  sick: 'ЛК',
  vacation: 'ВП',
  day_off: 'ВГ',
  holiday: 'СВ',
  weekend: 'ВХ',
};

const VALID_ABSENCE_STATUSES = new Set([
  'other_tasks',
  'personal_permission',
  'sick',
  'vacation',
  'day_off',
  'holiday',
]);

const SUBMITTED_STATUSES = new Set(['submitted', 'submitted_late', 'submitted_advance']);

const DUTY_MARK_LABELS = {
  a: 'А',
  off: 'В',
  vacation: 'ВП',
  sick: 'ЛК',
  day_off: 'ВГ',
  personal: 'ОС',
  other: 'НД',
  planning_block: 'Не планувати',
};

const WEEKDAY_SHORT = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const DUTY_ROW_COLORS = [
  '104, 152, 214',
  '83, 166, 156',
  '145, 119, 190',
  '184, 143, 83',
  '73, 151, 176',
  '181, 105, 126',
  '103, 159, 109',
  '102, 126, 184',
  '171, 119, 87',
  '88, 155, 136',
  '158, 111, 156',
  '112, 145, 169',
  '145, 155, 94',
  '132, 108, 157',
  '164, 145, 105',
];

const appRoot = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const toastRoot = document.querySelector('#toast-root');
const backupFileInput = document.querySelector('#backup-file-input');

let snapshot = null;
let resizeGesture = null;
let widgetDialogExpanded = false;
let widgetWindowTransition = Promise.resolve();
let modalReturnFocus = null;
let ui = {
  mode: 'widget',
  widgetList: false,
  tab: 'today',
  todayQuery: '', todayFilter: 'all', settingsDraft: null,
  plannerAnchor: localDateKey(), plannerView: 'month', plannerStatus: 'active', plannerEmployee: '', plannerQuery: '', plannerPriority: '',
  plannerArchived: false, plannerPeriodOnly: false, plannerFocus: '',
  weeklyAnchor: localDateKey(), weekly: null, weeklyLoading: false, weeklyError: '', weeklyRevision: 0,
  profile: null, profileView: 'overview', profileRevision: 0,
  month: localDateKey().slice(0, 7),
  journalView: 'month', journalAnchor: localDateKey(),
  journalFrom: `${localDateKey().slice(0, 7)}-01`, journalTo: localDateKey(),
  journalQuery: '', journalFilter: 'all', journalArchived: false, journalCompact: false, journalHideWeekends: false,
  journalSelecting: false, journalSelected: [], journalSelectionAnchor: null, journalFocusedEmployeeId: '', journalBatchCells: null,
  analyticsStart: `${localDateKey().slice(0, 7)}-01`,
  analyticsEnd: localDateKey(),
  analyticsScope: 'active', analyticsEmployeeIds: null, analyticsGroup: 'auto', analyticsCompare: true,
  analytics: null, analyticsLoading: false, analyticsError: '', analyticsRevision: 0, analyticsDraft: null, analyticsRefreshPending: false,
  analyticsView: 'overview', analyticsQuery: '', analyticsRowFilter: 'all',
  analyticsSort: 'name', analyticsSortDirection: 1, analyticsColumns: 'simple', analyticsChart: 'days',
  analyticsDocumentView: 'received', analyticsDocumentQuery: '', analyticsDocumentPage: 0,
  analyticsDetail: null, analyticsDetailRevision: 0,
  backups: [],
  dataImportPending: false,
  dataImportError: '',
  dutyMonth: localDateKey().slice(0, 7),
  dutySelectedWeek: '',
  dutyFocusedEmployeeId: '',
  dutyPreview: null,
  dutyStats: null,
  dutyFairness: null,
  timeOffMonth: localDateKey().slice(0, 7),
  timeOffEmployee: '',
  timeOffFrom: `${localDateKey().slice(0, 7)}-01`,
  timeOffTo: localDateKey(),
  timeOffQuery: '',
  scrollPositions: {},
};

function h(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromKey(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function formatDate(value, options = null) {
  const configured = snapshot?.settings?.dateStyle;
  const resolvedOptions = options === undefined || options === null
    ? configured === 'numeric'
      ? { day: '2-digit', month: '2-digit', year: 'numeric' }
      : configured === 'short'
        ? { day: 'numeric', month: 'short', year: 'numeric' }
        : { day: 'numeric', month: 'long', year: 'numeric' }
    : options;
  return new Intl.DateTimeFormat('uk-UA', resolvedOptions).format(dateFromKey(value));
}

function formatMonth(value) {
  return new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' })
    .format(dateFromKey(`${value}-01`));
}

function activeEmployees() {
  return snapshot.employees.filter((employee) => employee.active);
}

function dutyParticipants() {
  const ids = new Set(snapshot.duties?.participantIds || []);
  return activeEmployees().filter((employee) => ids.has(employee.id));
}

function activeDutySchedule() {
  return (snapshot.dutySchedules || []).find((schedule) => (
    schedule.id === snapshot.activeDutyScheduleId
  )) || snapshot.dutySchedules?.[0] || { id: 'primary', name: 'Основний' };
}

function dutyRules() {
  return {
    weekdayDutyCount: 2,
    weekendDutyCount: 2,
    requiredByWeekday: {},
    preventConsecutiveDays: true,
    preventConsecutiveWeekends: true,
    minimumRestDays: 2,
    minimumRestMode: 'prefer',
    planningPriority: 'balanced',
    maximumDutiesPerWeek: 0,
    compensateNextWeek: true,
    avoidRepeatedPairs: true,
    pairHistoryPeriod: 'year',
    pairHistoryDays: 90,
    weekendRestWeeks: 1,
    compensationFrom: 1,
    compensationTarget: 2,
    shortageBehavior: 'leave_empty',
    ...snapshot.duties?.rules,
  };
}

function dutyRequiredCount(date) {
  const day = dateFromKey(date).getDay();
  if (Object.hasOwn(dutyRules().requiredByWeekday || {}, day)) return Number(dutyRules().requiredByWeekday[day]);
  return day === 0 || day === 6
    ? Number(dutyRules().weekendDutyCount ?? 2)
    : Number(dutyRules().weekdayDutyCount ?? 2);
}

function dutyWeekStart(date) {
  const value = dateFromKey(date);
  const day = value.getDay();
  value.setDate(value.getDate() + (day === 0 ? -6 : 1 - day));
  return localDateKey(value);
}

function selectedDutyWeek() {
  const startDate = dutyWeekStart(ui.dutySelectedWeek || nextWeekRange().startDate);
  return { startDate, endDate: shiftDate(startDate, 6) };
}

function hasClearableGeneratedDuty(assignment) {
  if (!String(assignment?.source || '').startsWith('generated')) return false;
  const preserved = new Set([
    ...(assignment.manualEmployeeIds || []),
    ...(assignment.realizedEmployeeIds || []),
  ]);
  return !(assignment.employeeIds?.length) || assignment.employeeIds.some((id) => !preserved.has(id));
}

function dutyWeekLocked(date) {
  return Boolean(snapshot.duties?.lockedWeeks?.[dutyWeekStart(date)]);
}

function statusColor(status) {
  return snapshot?.settings?.statusColors?.[status] || STATUS_COLORS[status] || '#586b85';
}

function closeTimeText() {
  return `${String(snapshot?.settings?.closeHour ?? 18).padStart(2, '0')}:${String(snapshot?.settings?.closeMinute ?? 0).padStart(2, '0')}`;
}

function configuredWorkday(date) {
  return (snapshot?.settings?.workdays || [1, 2, 3, 4, 5]).includes(dateFromKey(date).getDay());
}

function employeeById(employeeId) {
  return snapshot.employees.find((employee) => employee.id === employeeId);
}

function recordFor(employeeId, date = localDateKey()) {
  return LadWork.recordForDay(snapshot,employeeId,date,localDateKey());
}

function statusFor(employeeId, date = localDateKey()) {
  const employee = employeeById(employeeId);
  return employee ? CounterJournal.cell(snapshot, employee, date).status : 'pending';
}

function hasWorkdayOverride(employeeId, date) {
  return Boolean(snapshot.workdayOverrides?.[`${employeeId}|${date}`]);
}

function employeeActiveOnDate(employee, date) {
  if (Array.isArray(employee.activePeriods) && employee.activePeriods.length) {
    return employee.activePeriods.some((period) => date >= period.start && (!period.end || date < period.end));
  }
  return date >= employee.createdDate && (!employee.archivedDate || date < employee.archivedDate);
}

function shortName(name) {
  const surname = String(name || '').trim().split(/\s+/)[0] || '—';
  return surname.length > 11 ? `${surname.slice(0, 10)}…` : surname;
}

function monthShift(month, delta) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + delta, 1, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function daysInMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(year, monthNumber, 0).getDate();
}

function shiftDate(date, delta) {
  const value = dateFromKey(date);
  value.setDate(value.getDate() + delta);
  return localDateKey(value);
}

function nextWeekRange(now = new Date()) {
  const current = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const day = current.getDay();
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  current.setDate(current.getDate() + daysUntilMonday);
  const startDate = localDateKey(current);
  current.setDate(current.getDate() + 6);
  return { startDate, endDate: localDateKey(current) };
}

function statusBadge(status) {
  return `<span class="status-badge" data-status="${status}">${h(STATUS_LABELS[status] || status)}</span>`;
}

async function confirmAction(message, always = false) {
  if (!always && snapshot?.settings?.confirmDestructiveActions === false) return true;
  try { return await window.counter.confirmAction(message); }
  catch (error) { showToast(error.message || 'Не вдалося відкрити підтвердження.', { error:true }); return false; }
}

function rememberScrollPositions() {
  appRoot.querySelectorAll('[data-scroll-key]').forEach((element) => {
    ui.scrollPositions[element.dataset.scrollKey] = {
      left: element.scrollLeft,
      top: element.scrollTop,
    };
  });
}

function restoreScrollPositions() {
  appRoot.querySelectorAll('[data-scroll-key]').forEach((element) => {
    const saved = ui.scrollPositions[element.dataset.scrollKey];
    if (!saved) return;
    element.scrollLeft = saved.left;
    element.scrollTop = saved.top;
  });
}

function updateDutyScrollExtent() {
  const scroll = appRoot.querySelector('[data-scroll-key="duty-matrix"]');
  if (!scroll) return;
  const nameCell = scroll.querySelector('th.sticky-name');
  const firstDayCell = scroll.querySelector('th [data-duty-day]')?.closest('th');
  if (!nameCell || !firstDayCell) return;
  const weekWidth = firstDayCell.getBoundingClientRect().width * 7;
  const tailWidth = Math.max(
    0,
    scroll.clientWidth - nameCell.getBoundingClientRect().width - weekWidth,
  );
  scroll.style.setProperty('--duty-scroll-tail-width', `${Math.ceil(tailWidth)}px`);
}

function applyAppearance() {
  const settings = { ...snapshot?.settings, ...ui.settingsDraft };
  document.documentElement.dataset.theme = settings.interfaceTheme === 'light' ? 'light' : 'navy';
  document.documentElement.dataset.density = settings.interfaceDensity === 'compact' ? 'compact' : 'comfortable';
  document.documentElement.dataset.textSize = settings.interfaceTextSize === 'large' ? 'large' : 'standard';
}

function renderShell({ preserveDrafts = false } = {}) {
  const pageDrafts = preserveDrafts ? rememberPageDrafts() : [];
  rememberScrollPositions();
  applyAppearance();
  document.body.className = `mode-${ui.mode}`;
  const settings = snapshot?.settings || {};
  const colors = settings.statusColors || STATUS_COLORS;
  for (const [key, color] of Object.entries(colors)) {
    document.documentElement.style.setProperty(`--status-${key.replaceAll('_', '-')}`, color);
  }
  document.documentElement.style.setProperty('--duty-name-width', `${settings.dutyNameWidth || 180}px`);
  document.documentElement.style.setProperty('--duty-row-height', `${settings.dutyRowHeight || 46}px`);
  document.documentElement.style.setProperty('--duty-line-width', `${settings.dutyLineStrength || 2}px`);
  appRoot.innerHTML = `
    <section class="window-shell ${ui.mode}">
      ${ui.mode !== 'widget' ? `<header class="titlebar">
        <img class="brand-mark" src="lad-mark.svg" alt="">
        <div class="title-copy">
          <strong>ЛАД</strong>
          <span>Люди. Аналітика. Документи.</span>
        </div>
        <div class="title-spacer"></div>
        <button class="quick-search-button" data-action="quick-search" aria-label="Знайти розділ, працівника або завдання (Ctrl+K)">${NAV_ICONS.search}<span>Знайти або перейти</span><kbd>Ctrl K</kbd></button>
        <div class="window-actions">
          <button class="icon-button" data-action="undo" title="Скасувати останню дію" aria-label="Скасувати останню дію">↶</button>
          <button class="icon-button" data-action="toggle-fullscreen" title="${ui.mode === 'fullscreen' ? 'Вийти з повного екрана (F11)' : 'На весь екран (F11)'}" aria-label="${ui.mode === 'fullscreen' ? 'Вийти з повного екрана' : 'На весь екран'}">${ui.mode === 'fullscreen' ? NAV_ICONS.restore : NAV_ICONS.fullscreen}</button>
          <button class="icon-button" data-action="toggle-mode" title="Повернутися до віджета" aria-label="Повернутися до віджета">◉</button>
          <button class="icon-button" data-action="minimize" title="Згорнути" aria-label="Згорнути">—</button>
          <button class="icon-button danger" data-action="close" title="Закрити" aria-label="Закрити програму">×</button>
        </div>
      </header>` : ''}
      <main class="main-content">
        ${ui.mode === 'widget' ? renderWidget() : renderDashboard()}
      </main>
    </section>
  `;
  appRoot.querySelectorAll('[data-employee-row-color]').forEach((row) => row.style.setProperty('--employee-row-rgb', DUTY_ROW_COLORS[Number(row.dataset.employeeRowColor)]));
  appRoot.querySelectorAll('[data-legend-status]').forEach((swatch) => { swatch.style.backgroundColor = statusColor(swatch.dataset.legendStatus); });
  updateDutyScrollExtent();
  updateDrawOdds();
  appRoot.dataset.training = String(Boolean(snapshot.training?.active));
  restorePageDrafts(pageDrafts);
  applyInterfacePendingForms();
  restoreScrollPositions();
}

function polar(cx, cy, radius, angleDegrees) {
  const angle = (angleDegrees - 90) * Math.PI / 180;
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

function annularSectorPath(index, count, outerRadius = 270, innerRadius = 116) {
  const gap = count === 1 ? 0.25 : 0.65;
  const sweep = 360 / count;
  const startAngle = index * sweep + gap;
  const endAngle = (index + 1) * sweep - gap;
  const outerStart = polar(300, 300, outerRadius, startAngle);
  const outerEnd = polar(300, 300, outerRadius, endAngle);
  const innerEnd = polar(300, 300, innerRadius, endAngle);
  const innerStart = polar(300, 300, innerRadius, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

function renderRadial(employees) {
  const labels=employees.map(person=>employees.length>11?person.name.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('.')+'.':shortName(person.name));
  const sectors = employees.map((employee, index) => {
    const status = statusFor(employee.id, localDateKey());
    const sweep = 360 / employees.length;
    const labelPoint = polar(300, 300, employees.length > 11 ? 195 : 202, (index + 0.5) * sweep);
    const dotPoint = polar(300, 300, employees.length > 11 ? 232 : 238, (index + 0.5) * sweep);
    return `
      <g class="sector" data-employee-id="${h(employee.id)}" tabindex="0" role="button" aria-label="${h(employee.name)}: ${h(STATUS_LABELS[status])}">
        <title>${h(employee.name)} · ${h(STATUS_LABELS[status])}\nКлік — дії з роботою. Правий клік — статус дня.</title>
        <path d="${annularSectorPath(index, employees.length)}" fill="${statusColor(status)}" opacity="0.91"></path>
        <circle class="status-dot" cx="${dotPoint.x}" cy="${dotPoint.y}" r="5" fill="${statusColor(status)}"></circle>
        <text x="${labelPoint.x}" y="${labelPoint.y}" text-anchor="middle" dominant-baseline="central">${h(labels.filter(label=>label===labels[index]).length>1?labels[index]+(index+1):labels[index])}</text>
      </g>
    `;
  }).join('');
  return `
    <svg class="radial-svg" viewBox="0 0 600 600" aria-label="Стан працівників на сьогодні">
      ${sectors}
    </svg>
  `;
}

function renderWidget() {
  return renderWorkWidget();
}

const NAV_ICONS = {
  presence:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="3"></circle><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 9l2 2 4-4"></path></svg>',
  fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4M16 4h4v4M20 16v4h-4M8 20H4v-4"></path></svg>',
  restore: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="8" width="11" height="11" rx="1"></rect><path d="M9 8V5h10v10h-3"></path></svg>',
  planner: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h3M15 13v5M13 15.5h4"></path></svg>',
  weekly: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l3 3v15H6zM15 3v4h3M9 11h6M9 15h6M9 18h4"></path></svg>',
  consequences: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3zM12 9v5M12 17h.01"></path></svg>',
  draws: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9v12M17 14v7"></path><ellipse cx="7" cy="6" rx="2.5" ry="3"></ellipse><ellipse cx="17" cy="11" rx="2.5" ry="3"></ellipse></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m15.5 15.5 5 5"></path></svg>',
  today: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"></circle><path d="m9.4 12 1.7 1.8 3.8-4"></path></svg>',
  journal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14" rx="2"></rect><path d="M8 3.5v4M16 3.5v4M4 9.5h16M8 13h3M13 13h3M8 16h3"></path></svg>',
  duties: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="9" r="3"></circle><path d="M3.8 19c.5-3.2 2.2-5 5.2-5s4.7 1.8 5.2 5M15.8 7.3a3 3 0 0 1 0 5.4M16.4 14.4c2.1.5 3.3 2 3.8 4.6"></path></svg>',
  timeoff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h10V4H4zM14 7h3.5A2.5 2.5 0 0 1 20 9.5V20h-6M8 12h9M14 9l3 3-3 3"></path></svg>',
  analytics: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5h16M6.5 17V11M11 17V6M15.5 17v-4M20 17V8.5"></path></svg>',
  employees: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"></circle><circle cx="17" cy="10" r="2.5"></circle><path d="M3.5 19c.5-3.5 2.3-5.5 5.5-5.5s5 2 5.5 5.5M14.8 14.5c3.2-.7 5.2.8 5.7 4.5"></path></svg>',
  data: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9M9 4v6M15 14v6"></path></svg>',
  help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><path d="M9.8 9.5a2.5 2.5 0 1 1 3.7 2.2c-1 .6-1.5 1.1-1.5 2.3M12 17h.01"></path></svg>',
};

const NAV_ITEMS = [
  ['today', 'Огляд дня', 'Сьогоднішні статуси та швидкі дії'],
  ['journal', 'Табель', 'Позначки за днями та масові зміни'],
  ['duties', 'Чергування', 'Графіки, правила й пояснення призначень'],
  ['timeoff', 'Відлучення', 'Короткі відлучення з часом і причиною'],
  ['analytics', 'Аналітика', 'Робочі дні, проєкти та співробітники'],
  ['employees', 'Працівники', 'Склад команди, порядок та архів'],
  ['data', 'Налаштування', 'Вигляд, робочі дні та резервні копії'],
  ['help', 'Довідка', 'Позначення й пояснення роботи'],
  ['planner', 'Планувальник', 'Завдання, календар, строки й нагадування'],
  ['weekly', 'Тижневе зведення', 'Виконане, затримки й рішення для керівника'],
  ['draws', 'Тягнути сірник', 'Випадковий вибір виконавців та збережені протоколи'],
  ['consequences', 'Наслідки змін', 'Зачеплені чергування й завдання; заміни та обміни'],
  ['presence','Наявність','Де працівник: на роботі, ЗКП, відпустка, лікарняний або відгул'],
];

async function navigateToTab(tab) {
  if (!NAV_ITEMS.some(([id]) => id === tab)) return;
  if (ui.mode === 'widget') { ui.mode = 'dashboard'; await queueWidgetWindowMode('dashboard'); }
  ui.tab = tab;
  if (ui.tab === 'weekly') await loadWeeklySummary(ui.weeklyAnchor);
  else if (ui.tab === 'analytics' && !ui.analytics) await refresh({ analytics: true });
  else if (ui.tab === 'duties' && !ui.dutyStats && snapshot.duties?.initialized) await refresh({ duties: true });
  else if (ui.tab === 'data') await refresh({ analytics: false, duties: false });
  else renderShell();
}

function renderDashboard() {
  const navButton = ([id, label], index) => `<button class="nav-button ${ui.tab === id ? 'active' : ''}" data-tab="${id}" ${id === 'consequences' && snapshot.consequences?.total ? `data-notification-count="${snapshot.consequences.total > 99 ? '99+' : snapshot.consequences.total}"` : ''} title="${label}${index < 10 ? ` (Ctrl+${index === 9 ? 0 : index + 1})` : ''}" aria-label="${label}" ${ui.tab === id ? 'aria-current="page"' : ''}><span class="nav-icon">${NAV_ICONS[id]}</span><span class="nav-label">${label}${id === 'consequences' && snapshot.consequences?.total ? `<span class="count-pill">${snapshot.consequences.total}</span>` : ''}</span></button>`;
  return `
    <div class="dashboard-layout">
      <aside class="sidebar" aria-label="Робочий простір ЛАД">
        <div class="sidebar-identity"><img src="lad-mark.svg" alt=""><div><strong>ЛАД</strong><small>Порядок у щоденній роботі</small></div></div>
        <nav aria-label="Основні розділи"><div class="sidebar-caption">Щоденна робота</div>${['today','presence','planner','consequences','journal','duties','timeoff'].map(id => navButton(NAV_ITEMS.find(item => item[0] === id),NAV_ITEMS.findIndex(item => item[0] === id))).join('')}<div class="sidebar-caption">Команда й дані</div>${['weekly','analytics','employees','draws'].map(id => navButton(NAV_ITEMS.find(item => item[0] === id),NAV_ITEMS.findIndex(item => item[0] === id))).join('')}</nav>
        <div class="sidebar-spacer"></div>
        <nav aria-label="Параметри й допомога">${NAV_ITEMS.slice(6,8).map((item, i) => navButton(item, i + 6)).join('')}</nav>
        <div class="sidebar-note">
          <strong><i></i> Локальний режим</strong>
          <span>Дані на цьому комп’ютері</span>
          <small>ЛАД · ${h(snapshot.appVersion || 'версія невідома')}</small>
        </div>
      </aside>
      <section class="dashboard-content" data-scroll-key="page-${ui.tab}" aria-label="${h(NAV_ITEMS.find(([id]) => id === ui.tab)?.[1] || 'Огляд дня')}">
        <div class="page-view">${renderLearningIntro()}${renderRecoveryNotice()}${renderActivePage()}</div>
      </section>
    </div>
  `;
}

function renderActivePage() {
  if (ui.tab === 'presence') return renderPresencePage();
  if (ui.tab === 'consequences') return renderConsequencesPage();
  if (ui.tab === 'draws') return renderDrawPage();
  if (ui.tab === 'planner') return renderPlannerPage();
  if (ui.tab === 'weekly') return renderWeeklyPage();
  if (ui.tab === 'journal') return renderJournalPage();
  if (ui.tab === 'duties') return renderDutyPage();
  if (ui.tab === 'timeoff') return renderTimeOffPage();
  if (ui.tab === 'analytics') return renderAnalyticsPage();
  if (ui.tab === 'employees') return renderEmployeesPage();
  if (ui.tab === 'data') return renderDataPage();
  if (ui.tab === 'help') return renderHelpPage();
  return renderTodayPage();
}

function renderTodayPage() {
  return renderWorkTodayPage();
}

function journalRange() {
  if (ui.journalView === 'week') {
    const startDate = dutyWeekStart(ui.journalAnchor);
    return { startDate, endDate: shiftDate(startDate, 6) };
  }
  if (ui.journalView === 'period') return { startDate: ui.journalFrom, endDate: ui.journalTo };
  return { startDate: `${ui.month}-01`, endDate: `${ui.month}-${String(daysInMonth(ui.month)).padStart(2, '0')}` };
}

function journalVisibleReport() {
  const employees = snapshot.employees.filter((employee) => ui.journalArchived || employee.active);
  const report = CounterJournal.report(snapshot, { ...journalRange(), employeeIds: employees.map(({ id }) => id) }, localDateKey());
  report.rows = report.rows.filter((row) => row.name.toLocaleLowerCase('uk-UA').includes(ui.journalQuery.toLocaleLowerCase('uk-UA'))
    && (ui.journalFilter === 'all' || (ui.journalFilter === 'missed' && row.totals.missed > 0)
      || (ui.journalFilter === 'pending' && row.totals.pending > 0) || (ui.journalFilter === 'absent' && row.totals.absent > 0)));
  if (ui.journalHideWeekends) report.dates = report.dates.filter((date) => configuredWorkday(date)
    || report.rows.some((row) => row.cells.find((cell) => cell.date === date)?.override));
  report.totals = report.rows.reduce((totals, row) => {
    for (const [key, value] of Object.entries(row.totals)) totals[key] = (totals[key] || 0) + value;
    return totals;
  }, { submitted: 0, missed: 0, other: 0, absent: 0, pending: 0 });
  return report;
}

function renderJournalPage() {
  const report = journalVisibleReport();
  const visibleIds = new Set(report.rows.map((row) => row.employeeId));
  const visibleDates = new Set(report.dates);
  ui.journalSelected = ui.journalSelected.filter((cell) => visibleIds.has(cell.employeeId) && visibleDates.has(cell.date));
  const selected = new Set(ui.journalSelected.map((cell) => `${cell.employeeId}|${cell.date}`));
  const range = journalRange();
  const metricLabels = [['submitted', 'Відпрацьовано'], ['working', 'У роботі'], ['missed', 'Без обліку'], ['other', 'ІЗ'], ['absent', 'Відсутність'], ['pending', 'Очікує']];
  return `
    <div class="page-header"><div><h1>Табель виконання</h1><p>Натисніть клітинку, щоб відкрити статус дня. Для кількох днів скористайтеся масовою зміною або виділенням.</p></div><div class="button-row"><button class="button primary small" data-status-period>Масова зміна</button><button class="button small" data-export-journal ${!report.rows.length ? 'disabled' : ''}>Експорт CSV</button></div></div>
    <div class="journal-view-bar">
      <div class="button-row">${[['month', 'Місяць'], ['week', 'Тиждень'], ['period', 'Період']].map(([view, label]) => `<button class="button small ${ui.journalView === view ? 'primary' : ''}" data-journal-view="${view}" aria-pressed="${ui.journalView === view}">${label}</button>`).join('')}<button class="button small" data-journal-today>Сьогодні</button></div>
      ${ui.journalView === 'month' ? `<label class="field journal-date-field"><span>Перейти до місяця</span><input type="month" data-journal-month value="${ui.month}"></label>` : ui.journalView === 'week' ? `<label class="field journal-date-field"><span>Тиждень за датою</span><input type="date" data-journal-anchor value="${ui.journalAnchor}"></label>` : `<form id="journal-range-form" class="journal-range-form"><label class="field"><span>Від</span><input name="startDate" type="date" value="${ui.journalFrom}" required></label><label class="field"><span>До</span><input name="endDate" type="date" value="${ui.journalTo}" required></label><button class="button small" type="submit">Показати</button></form>`}
    </div>
    <div class="table-toolbar journal-period-toolbar"><button class="button small" data-month-shift="-1" ${ui.journalView === 'period' ? 'disabled' : ''}>← Попередній</button><div class="month-title">${ui.journalView === 'month' ? h(formatMonth(ui.month)) : `${h(formatDate(range.startDate))} — ${h(formatDate(range.endDate))}`}</div><button class="button small" data-month-shift="1" ${ui.journalView === 'period' ? 'disabled' : ''}>Наступний →</button></div>
    <div class="journal-controls">
      <label class="field journal-search"><span>Знайти працівника</span><input type="search" data-journal-search value="${h(ui.journalQuery)}" placeholder="Ім’я або прізвище"></label>
      <div class="button-row journal-filters">${[['all', 'Усі'], ['missed', 'З пропусками'], ['pending', 'Очікують'], ['absent', 'Відсутні']].map(([value, label]) => `<button class="button small ${ui.journalFilter === value ? 'primary' : ''}" data-journal-filter="${value}" aria-pressed="${ui.journalFilter === value}">${label}</button>`).join('')}</div>
      <details class="journal-display"><summary>Вигляд</summary><label><input type="checkbox" data-journal-setting="journalCompact" ${ui.journalCompact ? 'checked' : ''}>Компактні рядки</label><label><input type="checkbox" data-journal-setting="journalHideWeekends" ${ui.journalHideWeekends ? 'checked' : ''}>Сховати неробочі дні</label><label><input type="checkbox" data-journal-setting="journalArchived" ${ui.journalArchived ? 'checked' : ''}>Показати архів</label></details>
    </div>
    <div class="journal-summary">${metricLabels.map(([key, label]) => `<span>${label}: <strong>${report.totals[key]}</strong></span>`).join('')}<small>Підсумки у днях за період для показаних працівників. «Очікує» — лише до сьогодні.</small></div>
    <details class="journal-selection-bar" ${ui.journalSelecting || selected.size ? 'open' : ''}><summary>Виділення та масові дії${selected.size ? ` · вибрано ${selected.size} клітинок` : ''}</summary><div class="button-row"><button class="button small ${ui.journalSelecting ? 'primary' : ''}" data-journal-select-mode aria-pressed="${ui.journalSelecting}">${ui.journalSelecting ? 'Вийти з виділення' : 'Виділення клітинок'}</button><button class="button small" data-journal-select-all ${!report.rows.length ? 'disabled' : ''}>Вибрати показані</button><span data-journal-selection-count aria-live="polite">Виділено: ${selected.size}</span><button class="button small" data-journal-batch="status" ${!selected.size ? 'disabled' : ''}>Змінити статус</button><button class="button small" data-journal-batch="clear" ${!selected.size ? 'disabled' : ''}>Очистити ручні</button><button class="button small" data-journal-batch="make_workday" ${!selected.size ? 'disabled' : ''}>Зробити робочими</button><button class="button small" data-journal-batch="restore_weekend" ${!selected.size ? 'disabled' : ''}>Повернути вихідні</button><button class="button small ghost" data-journal-clear-selection ${!selected.size ? 'disabled' : ''}>Зняти вибір</button></div></details>
    <div class="table-scroll journal-scroll" data-scroll-key="journal-matrix">
      <table class="matrix journal-matrix ${ui.journalCompact ? 'journal-compact' : ''} ${ui.journalFocusedEmployeeId ? 'has-focused-row' : ''}"><thead><tr><th class="sticky-name">Працівник</th>${report.dates.map((date) => `<th class="${date === localDateKey() ? 'is-today' : ''} ${!configuredWorkday(date) ? 'weekend' : ''} ${dateFromKey(date).getDay() === 1 ? 'journal-week-start' : ''}"><button data-journal-column="${date}" title="Вибрати цей день для всіх показаних працівників"><strong>${Number(date.slice(-2))}</strong><small>${WEEKDAY_SHORT[dateFromKey(date).getDay()]}${ui.journalView !== 'month' ? ` · ${date.slice(5, 7)}` : ''}</small></button></th>`).join('')}${metricLabels.map(([, label]) => `<th class="journal-total">${label}</th>`).join('')}</tr></thead>
        <tbody>${report.rows.map((row, rowIndex) => `<tr class="${ui.journalFocusedEmployeeId === row.employeeId ? 'journal-row-focused' : ''}"><td class="sticky-name"><button data-journal-row="${h(row.employeeId)}" title="${h(row.name)} · у режимі виділення вибирає всі показані дні">${h(row.name)}</button></td>${report.dates.map((date, colIndex) => {
          const cell = row.cells.find((item) => item.date === date);
          const chosen = selected.has(`${row.employeeId}|${date}`);
          const tooltip = `${row.name}\n${formatDate(date)}\n${cell.status === 'outside' ? 'Поза періодом роботи' : STATUS_LABELS[cell.status] || 'Очікується'}${cell.override ? '\nОкремий робочий вихідний' : ''}${cell.protected ? '\nЗапис попереднього обліку' : ''}${cell.documentRef ? `\n${cell.documentRef}` : ''}${cell.note ? `\n${cell.note}` : ''}`;
          return `<td class="matrix-cell cell-${cell.status}${cell.override && cell.status === 'pending' ? ' cell-workday-override' : ''}${chosen ? ' journal-cell-selected' : ''}${cell.protected ? ' journal-cell-protected' : ''}${date === localDateKey() ? ' is-today' : ''}${dateFromKey(date).getDay() === 1 ? ' journal-week-start' : ''}" data-cell-employee="${h(row.employeeId)}" data-date="${date}" role="button" tabindex="${rowIndex === 0 && colIndex === 0 ? '0' : '-1'}" aria-pressed="${chosen}" aria-label="${h(tooltip.replaceAll('\n', ' · '))}" title="${h(tooltip)}">${cell.symbol}</td>`;
        }).join('')}${metricLabels.map(([key]) => `<td class="journal-total" title="${h(row.name)} · за показаний період">${row.totals[key]}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      ${!report.rows.length ? '<div class="empty-state">За цими умовами працівників немає. Змініть пошук або фільтр.</div>' : ''}
    </div>
    <details class="journal-legend"><summary>Позначення та керування</summary><div>${Object.entries(STATUS_SYMBOLS).map(([key, symbol]) => `<span><strong>${symbol}</strong> ${h(STATUS_LABELS[key])}</span>`).join('')}<span><strong>ВХ</strong> Вихідний</span><span><strong>РД</strong> Окремий робочий вихідний</span><span><strong>—</strong> Поза періодом роботи</span><span><strong>Крапка в кутку</strong> Запис попереднього обліку</span></div><p>У режимі виділення натискайте клітинки, імена та заголовки днів. Shift вибирає прямокутник. Звичайний клік поза цим режимом відкриває окремий день.</p></details>
  `;
}

function refreshJournalView() {
  const input = appRoot.querySelector('[data-journal-search]');
  const focused = document.activeElement === input;
  const position = input?.selectionStart;
  renderShell();
  if (focused) { const next = appRoot.querySelector('[data-journal-search]'); next?.focus(); if (position != null) next?.setSelectionRange(position, position); }
}

function clearJournalSelection() { ui.journalSelected = []; ui.journalSelectionAnchor = null; }

function selectJournalCell(employeeId, date, event = {}) {
  const target = { employeeId, date };
  let targets = [target];
  if (event.shiftKey && ui.journalSelectionAnchor) {
    const report = journalVisibleReport();
    targets = CounterJournal.rectangle(report.rows.map((row) => row.employeeId), report.dates, ui.journalSelectionAnchor, target);
  }
  const selection = new Map(ui.journalSelected.map((cell) => [`${cell.employeeId}|${cell.date}`, cell]));
  const key = `${employeeId}|${date}`;
  if (targets.length === 1 && selection.has(key) && !event.shiftKey) selection.delete(key);
  else for (const cell of targets) selection.set(`${cell.employeeId}|${cell.date}`, cell);
  ui.journalSelected = [...selection.values()];
  if (!event.shiftKey) ui.journalSelectionAnchor = target;
  // Keep the clicked cell and keyboard focus in place during selection.
  const keys = new Set(selection.keys());
  appRoot.querySelectorAll('[data-cell-employee]').forEach((cell) => {
    const selected = keys.has(`${cell.dataset.cellEmployee}|${cell.dataset.date}`);
    cell.classList.toggle('journal-cell-selected', selected);
    cell.setAttribute('aria-pressed', String(selected));
  });
  const counter = appRoot.querySelector('[data-journal-selection-count]');
  if (counter) counter.textContent = `Виділено: ${keys.size}`;
  appRoot.querySelectorAll('[data-journal-batch], [data-journal-clear-selection]').forEach((button) => { button.disabled = !keys.size; });
}

function dutyCell(employee, date) {
  const key = `${employee.id}|${date}`;
  const assignment = snapshot.duties.assignments[date];
  if (assignment?.employeeIds?.includes(employee.id)) {
    const realized = assignment.realizedEmployeeIds?.includes(employee.id);
    return {
      symbol: '1',
      className: realized ? 'duty-realized' : 'duty-assigned',
      title: realized ? 'Чергування реалізоване: були завдання' : 'Призначено чергування',
    };
  }
  if (snapshot.duties.aDays[key]) return { symbol: 'А', className: 'duty-a', title: 'Залучення «А»' };
  if (snapshot.duties.planningBlocks?.[key]) {
    return {
      symbol: '—',
      className: 'duty-planning-block',
      title: 'Не ставити в чергування цього дня; у статистиці не враховується',
    };
  }
  const unavailable = snapshot.duties.unavailable[key];
  if (unavailable) {
    return {
      symbol: DUTY_MARK_LABELS[unavailable.type] || 'НД',
      className: 'duty-unavailable',
      title: `Не бере участі: ${unavailable.type}`,
    };
  }
  if (snapshot.duties.aDays[`${employee.id}|${shiftDate(date, 1)}`]) {
    return { symbol: 'до/А', className: 'duty-after-a', title: 'Не можна чергувати напередодні «А»' };
  }
  const record = recordFor(employee.id, date);
  const linkedMarks = {
    personal_permission: 'ОС',
    sick: 'ЛК',
    vacation: 'ВП',
    day_off: 'ВГ',
    holiday: 'В',
  };
  if (['onsite','zkp'].includes(record?.status)) return {symbol:record.status==='zkp'?'ЗКП':'Р',className:'duty-presence',title:`Наявність: ${STATUS_LABELS[record.status]}. Чергування дозволено за наявністю.`};
  if (linkedMarks[record?.status]) {
    return { symbol: linkedMarks[record.status], className: 'duty-unavailable', title: STATUS_LABELS[record.status] };
  }
  return { symbol: '·', className: 'duty-empty', title: 'Доступний для чергування' };
}

function renderDutyScheduleToolbar() {
  const schedules = snapshot.dutySchedules || [{ id: 'primary', name: 'Основний' }];
  const active = activeDutySchedule();
  return `
    <section class="duty-schedule-toolbar panel compact-panel">
      <label class="field duty-schedule-field">
        <span>Окремий графік</span>
        <select data-duty-schedule-select>
          ${schedules.map((schedule) => `<option value="${h(schedule.id)}" ${schedule.id === active.id ? 'selected' : ''}>${h(schedule.name)}</option>`).join('')}
        </select>
      </label>
      <div class="duty-schedule-actions">
        <button class="button small" data-create-duty-schedule>+ Новий графік</button>
        <button class="button small" data-duty-rules>Правила</button>
        <details class="duty-schedule-more"><summary>Керування графіком</summary><div class="button-row">
        <button class="button small" data-copy-duty-schedule>Створити копію</button>
        <button class="button small" data-rename-duty-schedule>Перейменувати</button>
        <button class="button small danger" data-delete-duty-schedule ${schedules.length <= 1 ? 'disabled' : ''}>Видалити</button>
        </div></details>
      </div>
      <p>Учасники, позначки, історія, Σ, Р і автоматичне формування зберігаються окремо для кожного графіка.</p>
    </section>
  `;
}

function renderDutyPage() {
  const employees = activeEmployees();
  const scheduleToolbar = renderDutyScheduleToolbar();
  if (!employees.length) {
    return `<div class="page-header"><div><h1>Чергування</h1><p>Спочатку додайте працівників.</p></div></div>${scheduleToolbar}<div class="panel"><button class="button primary" data-action="open-employees">Додати працівника</button></div>`;
  }
  if (!snapshot.duties.initialized) {
    return `
      <div class="page-header">
        <div><h1>Початкові дані · ${h(activeDutySchedule().name)}</h1><p>Один раз введіть річні підсумки станом на кінець поточного тижня.</p></div>
      </div>
      ${scheduleToolbar}
      <form id="duty-history-form" class="panel duty-history-form">
        <div class="confirm-box">Ці числа стануть початковими значеннями колонок Σ і Р. Ручне заповнення старого календаря не додасть їх повторно; нові чергування з наступного тижня збільшуватимуть підсумки автоматично.</div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>У графіку</th><th>Працівник</th><th>Усього чергувань</th><th>Реалізованих</th></tr></thead>
            <tbody>${employees.map((employee) => `
              <tr data-duty-history-row="${h(employee.id)}">
                <td><input name="participantIds" type="checkbox" value="${h(employee.id)}" checked aria-label="Додати ${h(employee.name)} до графіка"></td>
                <td>${h(employee.name)}</td>
                <td><input name="total-${h(employee.id)}" type="number" min="0" step="1" value="0" required></td>
                <td><input name="realized-${h(employee.id)}" type="number" min="0" step="1" value="0" required></td>
              </tr>
            `).join('')}</tbody>
          </table>
        </div>
        <div class="form-actions"><button class="button primary" type="submit">Зберегти й відкрити графік</button></div>
      </form>
    `;
  }

  const participants = dutyParticipants();
  if (!participants.length) {
    return `<div class="page-header"><div><h1>Графік «${h(activeDutySchedule().name)}»</h1><p>У графіку немає активних учасників.</p></div><button class="button primary" data-duty-history>Обрати учасників</button></div>${scheduleToolbar}`;
  }

  const count = daysInMonth(ui.dutyMonth);
  const dutyYear = ui.dutyMonth.slice(0, 4);
  const dates = Array.from({ length: count }, (_, index) => `${ui.dutyMonth}-${String(index + 1).padStart(2, '0')}`);
  const stats = new Map((ui.dutyStats || []).map((row) => [row.employeeId, row]));
  const totals = participants.map((employee) => stats.get(employee.id)?.total || 0);
  const minTotal = Math.min(...totals);
  const maxTotal = Math.max(...totals);
  const incompleteDates = dates.filter((date) => {
    const assignment = snapshot.duties.assignments[date];
    return assignment
      && (assignment.employeeIds?.length || 0) < dutyRequiredCount(date)
      && !assignment.singleApproved;
  });
  const incompleteDateSet = new Set(incompleteDates);
  const fairness = ui.dutyFairness;
  const selectedWeek = selectedDutyWeek();
  const selectedWeekDays = Array.from({ length: 7 }, (_, offset) => shiftDate(selectedWeek.startDate, offset));
  const selectedWeekAssignments = selectedWeekDays.filter((date) => snapshot.duties.assignments[date]);
  const selectedWeekLocked = dutyWeekLocked(selectedWeek.startDate);
  return `
    <div class="page-header">
      <div>
        <h1>Графік «${h(activeDutySchedule().name)}»</h1>
        <p>Будні — ${dutyRules().weekdayDutyCount}, вихідні — ${dutyRules().weekendDutyCount} чергових${Object.keys(dutyRules().requiredByWeekday || {}).length ? '; є налаштування для окремих днів' : ''}. Правила діють для нових розрахунків.</p>
      </div>
      <button class="button" data-duty-history>Учасники й підсумки</button>
    </div>
    ${scheduleToolbar}
    ${renderConsequenceBanner()}
    <div class="metrics-grid duty-metrics">
      <div class="metric-card"><strong>${minTotal}–${maxTotal}</strong><span>діапазон за ${dutyYear} рік</span></div>
      <div class="metric-card"><strong>${totals.reduce((sum, value) => sum + value, 0)}</strong><span>чергувань за ${dutyYear} рік</span></div>
      <div class="metric-card"><strong>${participants.reduce((sum, employee) => sum + (stats.get(employee.id)?.realized || 0), 0)}</strong><span>реалізованих за рік</span></div>
    </div>
    <div class="table-toolbar">
      <button class="button small" data-duty-month-shift="-1">← Попередній</button>
      <div class="month-title">${h(formatMonth(ui.dutyMonth))}</div>
      <button class="button small" data-duty-month-shift="1">Наступний →</button>
    </div>
    <div class="duty-planner-toolbar panel compact-panel">
      <label class="field duty-week-field"><span>Тиждень для планування</span><input type="date" data-duty-week-select value="${selectedWeek.startDate}" aria-label="Оберіть дату тижня для планування"></label>
      <div class="duty-week-summary">${h(formatDate(selectedWeek.startDate))} — ${h(formatDate(selectedWeek.endDate))}${selectedWeekLocked ? ' · 🔒 заблоковано' : ''}</div>
      <div class="duty-week-actions">
        <button class="button small" data-find-duty-week>Перший незаповнений</button>
        <button class="button primary small" data-generate-duties ${selectedWeekLocked ? 'disabled' : ''}>Переглянути й сформувати</button>
        <details class="duty-schedule-more"><summary>Очистити тиждень</summary><div class="button-row"><button class="button small" data-clear-duty-week="generated" ${selectedWeekLocked || !selectedWeekAssignments.some((date) => hasClearableGeneratedDuty(snapshot.duties.assignments[date])) ? 'disabled' : ''}>Лише автоматичні</button><button class="button danger small" data-clear-duty-week="all" ${selectedWeekLocked || !selectedWeekAssignments.length ? 'disabled' : ''}>Усі призначення</button></div></details>
      </div>
    </div>
    <p class="duty-help">Натисніть ім’я, щоб виділити рядок. Клік по порожній клітинці призначає чергування; клік по призначеній відкриває окремі дії для виконання або зняття. Правий клік — «А», відсутність або заборона планування. Червона колонка означає нестачу чергового.</p>
    <div class="duty-legend">
      <span><b class="legend-duty">1</b> чергування</span><span><b class="legend-realized">1</b> реалізоване</span><span><b class="legend-a">А</b> залучення</span><span><b class="legend-planning-block">—</b> не планувати</span><span><b>В/ВП/ЛК/ВГ</b> відсутність</span>
    </div>
    <div class="table-scroll" data-scroll-key="duty-matrix">
      <table class="matrix duty-matrix ${ui.dutyFocusedEmployeeId ? 'has-focused-row' : ''}">
        <thead><tr>
          <th class="sticky-name">Працівник</th><th>Σ</th><th>Р</th>
          ${dates.map((date) => {
            const day = dateFromKey(date).getDay();
            const assignment = snapshot.duties.assignments[date];
            const incomplete = assignment
              && (assignment.employeeIds?.length || 0) < dutyRequiredCount(date)
              && !assignment.singleApproved;
            const locked = dutyWeekLocked(date);
            return `<th class="${date === localDateKey() ? 'is-today ' : ''}${day === 0 || day === 6 ? 'weekend ' : ''}${day === 1 ? 'duty-week-start ' : ''}${date >= selectedWeek.startDate && date <= selectedWeek.endDate ? 'duty-week-selected ' : ''}${incomplete ? 'duty-day-incomplete ' : ''}${locked ? 'duty-day-locked' : ''}"><button data-duty-day="${date}" title="${locked ? 'Тиждень заблоковано · ' : ''}Налаштувати склад на ${h(formatDate(date))}"><strong>${Number(date.slice(-2))}</strong><small>${locked ? '🔒' : WEEKDAY_SHORT[day]}</small></button></th>`;
          }).join('')}<th class="duty-scroll-tail" aria-hidden="true"></th>
        </tr></thead>
        <tbody>${participants.map((employee, employeeIndex) => {
          const rowStats = stats.get(employee.id) || { total: 0, realized: 0 };
          const focused = ui.dutyFocusedEmployeeId === employee.id;
          return `<tr class="${focused ? 'duty-row-focused' : ''}" data-employee-row-color="${employeeIndex % DUTY_ROW_COLORS.length}">
            <td class="sticky-name"><button class="duty-name-button" data-focus-duty-row="${h(employee.id)}" aria-pressed="${focused}" title="${h(employee.name)} · ${focused ? 'зняти виділення' : 'виділити рядок'}"><span class="employee-name-content"><i class="employee-row-marker" aria-hidden="true"></i>${h(shortName(employee.name))}</span></button></td>
            <td class="duty-total">${rowStats.total}</td><td class="duty-total duty-realized-total">${rowStats.realized}</td>
            ${dates.map((date) => {
              const cell = dutyCell(employee, date);
              const incompleteClass = incompleteDateSet.has(date) ? ' duty-column-incomplete' : '';
              const lockedClass = dutyWeekLocked(date) ? ' duty-cell-locked' : '';
              const todayClass = date === localDateKey() ? ' is-today' : '';
              const weekStartClass = dateFromKey(date).getDay() === 1 ? ' duty-week-start' : '';
              return `<td class="matrix-cell ${cell.className}${incompleteClass}${lockedClass}${todayClass}${weekStartClass}" data-duty-cell data-employee-id="${h(employee.id)}" data-date="${date}" role="button" tabindex="${employee === participants[0] && date === dates[0] ? '0' : '-1'}" aria-label="${h(employee.name)} · ${h(formatDate(date))} · ${h(cell.title)}" title="${h(employee.name)} · ${h(formatDate(date))} · ${h(cell.title)}${dutyWeekLocked(date) ? ' · тиждень заблоковано' : ''}">${cell.symbol}</td>`;
            }).join('')}<td class="duty-scroll-tail" aria-hidden="true"></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
    ${fairness ? `
      <section class="panel duty-fairness-panel">
        <div class="rules-heading"><div><h2>Справедливість розподілу</h2><p>${h(formatDate(fairness.startDate))} — ${h(formatDate(fairness.endDate))}</p></div><span class="status-badge" data-status="${fairness.spread <= 1 ? 'submitted' : 'missed'}">Різниця: ${fairness.spread}</span></div>
        <div class="table-scroll"><table class="data-table">
          <thead><tr><th>Працівник</th><th>Усього</th><th>Вихідні</th><th>Середній відпочинок</th><th>Останнє</th></tr></thead>
          <tbody>${fairness.rows.map((row) => `<tr><td>${h(employeeById(row.employeeId)?.name || '—')}</td><td>${row.total}</td><td>${row.weekends}</td><td>${row.averageRestDays === null ? '—' : `${row.averageRestDays} дн.`}</td><td>${row.lastDuty ? h(formatDate(row.lastDuty, { day: 'numeric', month: 'short' })) : '—'}</td></tr>`).join('')}</tbody>
        </table></div>
        <h3>Повторення пар</h3>
        <div class="pair-list">${fairness.pairs.slice(0, 12).map((pair) => `<span class="pair-chip ${pair.count > 1 ? 'repeated' : ''}">${h(pair.employeeIds.map((id) => employeeById(id)?.name || '—').join(' + '))} · ${pair.count}</span>`).join('') || '<span class="muted">Пар за цей період ще немає.</span>'}</div>
      </section>
    ` : ''}
  `;
}

function formatDuration(minutes) {
  const hours = Math.floor(Number(minutes || 0) / 60);
  const rest = Number(minutes || 0) % 60;
  if (!hours) return `${rest} хв`;
  if (!rest) return `${hours} год`;
  return `${hours} год ${rest} хв`;
}

function renderTimeOffPage() {
  const employees = activeEmployees();
  const query = ui.timeOffQuery.trim().toLocaleLowerCase('uk-UA');
  const entries = (snapshot.timeOffEntries || [])
    .filter((entry) => !ui.timeOffEmployee || entry.employeeId === ui.timeOffEmployee)
    .filter((entry) => !ui.timeOffFrom || entry.date >= ui.timeOffFrom)
    .filter((entry) => !ui.timeOffTo || entry.date <= ui.timeOffTo)
    .filter((entry) => !query || `${entry.destination} ${entry.note || ''}`.toLocaleLowerCase('uk-UA').includes(query))
    .sort((left, right) => (
      right.date.localeCompare(left.date)
      || right.startTime.localeCompare(left.startTime)
      || right.createdAt.localeCompare(left.createdAt)
    ));
  const totalMinutes = entries.reduce((sum, entry) => sum + entry.durationMinutes, 0);
  return `
    <div class="page-header">
      <div>
        <h1>Відлучення</h1>
        <p>Окремий журнал коротких відлучень: коли, куди та на скільки відпускали працівника.</p>
      </div>
    </div>
    <div class="confirm-box time-off-notice">Цей журнал не змінює табель, колір віджета, періоди роботи або кількість відпрацьованих днів. Повноденну відсутність, як і раніше, позначайте в табелі.</div>
    <form id="time-off-form" class="panel">
      <div class="form-grid time-off-form-grid">
        <label class="field"><span>Працівник</span><select name="employeeId" required><option value="">Оберіть працівника</option>${employees.map((employee) => `<option value="${h(employee.id)}">${h(employee.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Дата</span><input name="date" type="date" value="${localDateKey()}" required></label>
        <label class="field"><span>Від</span><input name="startTime" type="time" value="09:00" required></label>
        <label class="field"><span>До</span><input name="endTime" type="time" value="10:00" required></label>
        <label class="field time-off-destination"><span>Куди / причина</span><input name="destination" maxlength="200" placeholder="Наприклад, до лікаря" required></label>
        <label class="field time-off-note"><span>Примітка</span><input name="note" maxlength="500" placeholder="Необов’язково"></label>
      </div>
      <div class="form-actions"><button class="button primary" type="submit" ${employees.length ? '' : 'disabled'}>Додати запис</button></div>
    </form>
    <form id="time-off-filter-form" class="panel compact-panel time-off-filter-form">
      <div class="form-grid">
        <label class="field"><span>Працівник</span><select name="employeeId"><option value="">Усі працівники</option>${snapshot.employees.map((employee) => `<option value="${h(employee.id)}" ${ui.timeOffEmployee === employee.id ? 'selected' : ''}>${h(employee.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Від дати</span><input name="startDate" type="date" value="${h(ui.timeOffFrom)}"></label>
        <label class="field"><span>До дати</span><input name="endDate" type="date" value="${h(ui.timeOffTo)}"></label>
        <label class="field"><span>Куди / причина</span><input name="query" value="${h(ui.timeOffQuery)}" placeholder="Пошук у причині та примітці"></label>
      </div>
      <div class="form-actions"><button class="button primary small" type="submit">Застосувати фільтр</button><button class="button small" type="button" data-clear-time-off-filter>Очистити</button></div>
    </form>
    <div class="table-toolbar">
      <button class="button small" data-time-off-month-shift="-1">← Попередній</button>
      <div class="month-title">${h(formatMonth(ui.timeOffMonth))}</div>
      <button class="button small" data-time-off-month-shift="1">Наступний →</button>
      <span class="time-off-summary">${entries.length} записів · ${h(formatDuration(totalMinutes))}</span>
    </div>
    <section class="panel time-off-list-panel">
      <div class="table-scroll" data-scroll-key="time-off-table">
        <table class="data-table time-off-table">
          <thead><tr><th>Дата</th><th>Працівник</th><th>Час</th><th>Тривалість</th><th>Куди / причина</th><th>Примітка</th><th></th></tr></thead>
          <tbody>${entries.map((entry) => {
            const employee = employeeById(entry.employeeId);
            return `<tr><td>${h(formatDate(entry.date, { day: 'numeric', month: 'short', year: 'numeric' }))}</td><td>${h(employee?.name || 'Видалений працівник')}</td><td>${h(entry.startTime)}–${h(entry.endTime)}</td><td>${h(formatDuration(entry.durationMinutes))}</td><td>${h(entry.destination)}</td><td>${h(entry.note || '—')}</td><td><button class="button small" data-edit-time-off="${h(entry.id)}">Змінити</button> <button class="button small danger" data-delete-time-off="${h(entry.id)}" title="Видалити запис">Видалити</button></td></tr>`;
          }).join('') || '<tr><td colspan="7" class="muted">За обраним фільтром записів немає.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

const ANALYTICS_LABELS = {
  calendarWorkdays: 'Робочі дні', workedDays: 'Відпрацьовано', requestDays: 'Закрито запитами',
  documentDays: 'За документами', manualDays: 'Позначено без документа', actualRequestsReceived: 'Отримано запитів',
  documentsReceived: 'Отримано документів', missed: 'Незакриті пропуски', pending: 'Без позначки',
  absent: 'Відсутність', otherTasks: 'Інші завдання', requestRequiredDays: 'Норма запитів у днях',
  completionPercent: 'Виконання норми', unallocatedCredit: 'Нерозподілений залишок',
  sick: 'Лікарняний', vacation: 'Відпустка', personalPermission: 'Особисті справи', dayOff: 'Відгул', holiday: 'Свято',
  submittedOnTime: 'Подав вчасно', submittedLate: 'Із запізненням', submittedAdvance: 'Наперед за дозволом', complexRequests: 'Складні запити',
};

function analyticsAvailableEmployees(scope = ui.analyticsScope) {
  return snapshot.employees.filter((person) => scope === 'all' || (scope === 'active' ? person.active : !person.active));
}
function analyticsCurrentFilter() {
  return { startDate: ui.analyticsStart, endDate: ui.analyticsEnd, scope: ui.analyticsScope,
    employeeIds: ui.analyticsEmployeeIds, groupBy: ui.analyticsGroup, compare: ui.analyticsCompare };
}
function analyticsFormFilter(form = appRoot.querySelector('#analytics-form')) {
  if (!form) return analyticsCurrentFilter();
  const data = new FormData(form);
  const ids = data.getAll('employeeIds').map(String);
  const scope = form.dataset.scope || ui.analyticsScope;
  const all = analyticsAvailableEmployees(scope).map((person) => person.id);
  return { startDate: String(data.get('startDate') || ''), endDate: String(data.get('endDate') || ''), scope,
    employeeIds: ids.length === all.length && all.every((id) => ids.includes(id)) ? null : ids,
    groupBy: String(data.get('groupBy') || 'auto'), compare: data.get('compare') === 'on' };
}
async function loadAnalytics(filter = analyticsCurrentFilter(), { render = true } = {}) {
  if (!render && ui.analyticsLoading) { ui.analyticsRefreshPending = true; return null; }
  if (render) ui.analyticsDraft = filter;
  const revision = ++ui.analyticsRevision;
  ui.analyticsLoading = true;
  const notice = appRoot.querySelector('[data-analytics-loading]');
  if (notice) notice.textContent = 'Оновлення звіту…';
  const button = appRoot.querySelector('#analytics-form [type="submit"]');
  if (button) button.disabled = true;
  try {
    const report = await window.counter.getAnalyticsReport(filter);
    if (revision !== ui.analyticsRevision) return null;
    ui.analytics = report; ui.analyticsError = '';
    if (render) ui.analyticsDraft = null;
    ui.analyticsStart = filter.startDate; ui.analyticsEnd = filter.endDate; ui.analyticsScope = filter.scope;
    ui.analyticsEmployeeIds = filter.employeeIds; ui.analyticsGroup = filter.groupBy; ui.analyticsCompare = filter.compare;
    ui.analyticsDocumentPage = 0;
    return report;
  } catch (error) {
    if (revision === ui.analyticsRevision) { ui.analyticsError = error.message || String(error); showToast(ui.analyticsError, { error: true }); }
    return null;
  } finally {
    if (revision === ui.analyticsRevision) {
      ui.analyticsLoading = false;
      if (render) renderShell();
      else {
        if (notice?.isConnected) notice.textContent = ui.analyticsError ? `${ui.analyticsError} Показано останній успішний звіт.` : '';
        if (button?.isConnected) button.disabled = false;
      }
      if (ui.analyticsRefreshPending) { ui.analyticsRefreshPending = false; void loadAnalytics(analyticsCurrentFilter(), { render: false }).then(() => renderShell()); }
    }
  }
}
function analyticsNumber(value) { return value == null ? '—' : Number(value).toLocaleString('uk-UA', { maximumFractionDigits: 1 }); }
function analyticsValue(key, value) { return value == null ? '—' : `${analyticsNumber(value)}${key === 'completionPercent' ? '%' : ''}`; }
function analyticsDelta(key, report = ui.analytics) {
  if (!report?.comparison) return '';
  const delta = key === 'completionPercent' ? report.comparison.completionDelta : report.comparison.delta[key];
  if (delta == null) return '<small class="analytics-delta">Немає норми для порівняння</small>';
  return `<small class="analytics-delta">${delta > 0 ? '+' : ''}${analyticsNumber(delta)}${key === 'completionPercent' ? ' в. п.' : ''} до попереднього періоду</small>`;
}
function renderAnalyticsPage() {
  const draft = ui.analyticsDraft || analyticsCurrentFilter();
  const people = analyticsAvailableEmployees(draft.scope);
  const selected = draft.employeeIds;
  const count = selected ? selected.length : people.length;
  return `
    <div class="page-header"><div><h1>Статистика й аналітика</h1><p>Оберіть період і працівників. Натисніть показник, щоб перевірити його за датами та роботою.</p></div></div>
    <form id="analytics-form" data-scope="${draft.scope}" class="panel analytics-filter-panel">
      <div class="analytics-presets button-row">${[['today', 'Сьогодні'], ['week', 'Цей тиждень'], ['month', 'Цей місяць'], ['last_month', 'Минулий місяць'], ['30days', 'Останні 30 днів'], ['year', 'Цей рік']].map(([key, label]) => `<button class="button small" type="button" data-analytics-preset="${key}">${label}</button>`).join('')}</div>
      <div class="analytics-filter-grid"><label class="field"><span>Від дати</span><input type="date" name="startDate" value="${h(draft.startDate)}" required></label><label class="field"><span>До дати</span><input type="date" name="endDate" value="${h(draft.endDate)}" required></label><button class="button primary" type="submit" ${ui.analyticsLoading ? 'disabled' : ''}>Показати статистику</button></div>
      <div class="analytics-scope button-row" aria-label="Група працівників">${[['active', 'Активні'], ['all', 'Разом з архівом'], ['archive', 'Тільки архів']].map(([key, label]) => `<button class="button small ${draft.scope === key ? 'primary' : ''}" type="button" data-analytics-scope="${key}" aria-pressed="${draft.scope === key}">${label}</button>`).join('')}</div>
      <details class="analytics-worker-picker"><summary>Працівники: ${selected ? 'вибрано' : 'усі у групі'} ${count}. Змінити вибір</summary><div class="button-row"><button class="button small" type="button" data-analytics-pick="all">Вибрати всіх</button><button class="button small" type="button" data-analytics-pick="none">Зняти всіх</button></div><div class="analytics-worker-list">${people.map((person) => `<label class="check-row"><input name="employeeIds" type="checkbox" value="${h(person.id)}" ${!selected || selected.includes(person.id) ? 'checked' : ''}><span>${h(person.name)}${!person.active ? ' · архів' : ''}</span></label>`).join('') || '<p class="muted">У цій групі працівників немає.</p>'}</div></details>
      <details class="analytics-extra-options"><summary>Динаміка та порівняння</summary><fieldset class="analytics-options"><legend>Крок графіка</legend>${[['auto', 'Автоматично'], ['day', 'Дні'], ['week', 'Тижні'], ['month', 'Місяці']].map(([value, label]) => `<label><input type="radio" name="groupBy" value="${value}" ${draft.groupBy === value ? 'checked' : ''}>${label}</label>`).join('')}</fieldset><label class="check-row"><input name="compare" type="checkbox" ${draft.compare ? 'checked' : ''}><span>Порівняти з попереднім періодом такої самої тривалості</span></label><p class="muted">До 3660 днів у звіті та до 124 точок на графіку. Для довгого періоду обирайте місяці.</p></details>
      <p class="muted" data-analytics-loading aria-live="polite">${h(ui.analyticsError ? `${ui.analyticsError} Показано останній успішний звіт.` : ui.analyticsLoading ? 'Оновлення звіту…' : 'Зміни у фільтрах застосовуються кнопкою «Показати статистику».')}</p>
    </form>
    ${ui.analytics ? renderAnalyticsResult(ui.analytics) : '<section class="panel empty-state"><h2>Звіт ще не сформовано</h2><p>Виберіть період та натисніть «Показати статистику».</p></section>'}
  `;
}
function analyticsMetricButton(key, value, employeeId = '', extra = '') {
  return `<button class="analytics-number-button" ${!ui.analytics?.rows.length ? 'disabled' : ''} data-analytics-metric="${key}" ${employeeId ? `data-employee-id="${h(employeeId)}"` : ''} title="Переглянути розрахунок: ${h(ANALYTICS_LABELS[key])}">${analyticsValue(key, value)}${extra}</button>`;
}
function renderAnalyticsResult(report) {
  return renderWorkAnalytics(report);
}
function renderAnalyticsChart(report) {
  const isRequests = ui.analyticsChart === 'requests';
  const series = isRequests ? [['actualRequestsReceived', 'Фактичні запити']] : [['requestDays', 'Дні за запитами'], ['otherTasks', 'Інші завдання'], ['absent', 'Відсутність'], ['missed', 'Пропуски'], ['pending', 'Без позначки']];
  const maximum = Math.max(1, ...report.trend.map((row) => isRequests ? row.actualRequestsReceived : row.calendarWorkdays));
  const label = (row) => report.groupBy === 'month' ? formatMonth(row.key) : report.groupBy === 'day' ? formatDate(row.from) : `${formatDate(row.from)} — ${formatDate(row.to)}`;
  const groupLabel = { day: 'днями', week: 'тижнями', month: 'місяцями' }[report.groupBy];
  return `<section class="panel analytics-chart-panel"><div class="rules-heading"><div><h2>Динаміка за ${groupLabel}</h2><p>${isRequests ? 'Фактичні запити за датою отримання документа.' : 'Кожен відрізок — кількість робочих днів. Для всіх рядків однакова шкала.'} Натисніть період, щоб розгорнути його.</p></div><div class="button-row"><button class="button small ${!isRequests ? 'primary' : ''}" data-analytics-chart="days">Дні табеля</button><button class="button small ${isRequests ? 'primary' : ''}" data-analytics-chart="requests">Отримані запити</button></div></div>
    <div class="analytics-chart-legend">${series.map(([key, title]) => `<span class="analytics-legend-${key}">${title}</span>`).join('')}<span>Шкала: 0–${maximum} ${isRequests ? 'запитів' : 'дн.'}</span></div>
    <div class="analytics-chart-rows">${report.trend.map((row) => {
      let x = 0;
      const rectangles = series.map(([key]) => {
        const width = Math.round(row[key] / maximum * 5000) / 10;
        const rect = width ? `<rect class="analytics-bar-${key}" x="${x}" y="2" width="${width}" height="16"><title>${h(ANALYTICS_LABELS[key])}: ${row[key]}</title></rect>` : '';
        x += width; return rect;
      }).join('');
      const summary = isRequests ? `${row.actualRequestsReceived} запитів · ${row.documentsReceived} док.` : `${row.calendarWorkdays} дн. · ${row.missed} пропусків`;
      return `<div class="analytics-chart-row"><button class="analytics-period-link" data-analytics-bucket-from="${row.from}" data-analytics-bucket-to="${row.to}">${h(label(row))}</button><svg viewBox="0 0 500 20" preserveAspectRatio="none" role="img" aria-label="${h(label(row))}: ${h(series.map(([key]) => `${ANALYTICS_LABELS[key]} ${row[key]}`).join(', '))}"><rect class="analytics-bar-background" x="0" y="2" width="500" height="16"/>${rectangles}</svg><span>${summary}${!row.calendarWorkdays && !row.actualRequestsReceived ? ' · немає даних' : ''}</span></div>`;
    }).join('') || '<p class="muted">За цей період ще немає поточних або минулих днів.</p>'}</div></section>`;
}
function renderAnalyticsExplanation(report) {
  const t = report.total;
  return `<section class="panel analytics-explanation"><h2>Як читати ці цифри</h2><div class="analytics-explanation-grid"><div><h3>Запити та дні — різні величини</h3><p>Отримано <strong>${t.actualRequestsReceived} запитів</strong> за датами документів. У табелі закрито <strong>${t.requestDays} днів</strong> за датами днів: ${t.documentDays} за документами і ${t.manualDays} позначено без документа.</p><p>Документ може закрити дні іншого періоду. Ручна позначка «Подав» не створює отриманий документ чи фактичний запит.</p></div><div><h3>Що входить до норми</h3><p>${t.calendarWorkdays} робочих дн. − ${t.otherTasks} дн. інших завдань − ${t.absent} дн. відсутності = <strong>${t.requestRequiredDays} дн. норми запитів</strong>.</p><p>${t.requestRequiredDays ? `${t.requestDays} ÷ ${t.requestRequiredDays} × 100 = ${analyticsNumber(t.completionPercent)}%.` : 'Норми немає — відсоток не розраховується.'}</p><p>Відпрацьовано: ${t.requestDays} дн. запитів + ${t.otherTasks} дн. інших завдань = ${t.workedDays}.</p></div></div><details><summary>Без позначки, відсутність та залишок</summary><p>«Без позначки» — робочі дні до сьогодні без статусу; можуть включати минулі дні, якщо автозакриття вимкнено. Відсутність — лікарняний, відпустка, відгул, особисті справи та свято. Нерозподілений залишок — одиниці документів, отриманих у періоді, які ще не зараховано на дні.</p><p>Підсумки обчислюються за поточними записами; виправлення документів або табеля змінюють звіт.</p></details></section>`;
}
function analyticsVisibleRows(report = ui.analytics) {
  const rows = report.rows.filter((row) => row.name.toLocaleLowerCase('uk-UA').includes(ui.analyticsQuery.toLocaleLowerCase('uk-UA'))
    && (ui.analyticsRowFilter === 'all' || (row[ui.analyticsRowFilter] || 0) > 0));
  return rows.sort((a, b) => {
    if (ui.analyticsSort === 'name') return ui.analyticsSortDirection * a.name.localeCompare(b.name, 'uk');
    const av = a[ui.analyticsSort]; const bv = b[ui.analyticsSort];
    if (av == null || bv == null) return av == null && bv == null ? a.name.localeCompare(b.name, 'uk') : av == null ? 1 : -1;
    return ui.analyticsSortDirection * (av - bv) || a.name.localeCompare(b.name, 'uk');
  });
}
function renderAnalyticsWorkers(report) {
  const rows = analyticsVisibleRows(report);
  const simple = ['calendarWorkdays', 'workedDays', 'requestDays', 'actualRequestsReceived', 'missed', 'absent', 'pending', 'completionPercent'];
  const full = [...simple.slice(0, 4), 'documentDays', 'manualDays', 'otherTasks', 'submittedLate', 'submittedAdvance', ...simple.slice(4), 'sick', 'vacation', 'personalPermission', 'dayOff', 'holiday', 'requestRequiredDays', 'unallocatedCredit'];
  const columns = ui.analyticsColumns === 'full' ? full : simple;
  const header = (key, label) => `<th><button data-analytics-sort="${key}" title="Сортувати">${h(label)}${ui.analyticsSort === key ? ui.analyticsSortDirection === 1 ? ' ↑' : ' ↓' : ''}</button></th>`;
  return `<section class="panel"><div class="rules-heading"><div><h2>Працівники</h2><p>Натисніть число для списку дат, ім’я — для підсумку працівника.</p></div><div class="button-row"><button class="button small ${ui.analyticsColumns === 'simple' ? 'primary' : ''}" data-analytics-columns="simple">Основні показники</button><button class="button small ${ui.analyticsColumns === 'full' ? 'primary' : ''}" data-analytics-columns="full">Усі показники</button></div></div><div class="analytics-table-tools"><label class="field"><span>Пошук у таблиці</span><input type="search" data-analytics-search value="${h(ui.analyticsQuery)}" placeholder="Ім’я або прізвище"></label><div class="button-row">${[['all', 'Усі'], ['missed', 'З пропусками'], ['pending', 'Без позначки'], ['unallocatedCredit', 'Із залишком']].map(([key, label]) => `<button class="button small ${ui.analyticsRowFilter === key ? 'primary' : ''}" data-analytics-row-filter="${key}">${label}</button>`).join('')}</div></div><p class="muted">Показано ${rows.length} із ${report.rows.length}. Пошук і ці фільтри стосуються таблиці; картки та CSV містять увесь вибраний звіт.</p><div class="table-scroll analytics-workers-scroll"><table class="data-table analytics-workers-table"><thead><tr>${header('name', 'Працівник')}${columns.map((key) => header(key, ANALYTICS_LABELS[key])).join('')}</tr></thead><tbody>${rows.map((row) => `<tr><td><button class="analytics-name-link" data-analytics-worker="${h(row.employeeId)}">${h(row.name)}</button>${!row.active ? '<small class="muted">Архів</small>' : ''}</td>${columns.map((key) => `<td>${analyticsMetricButton(key, row[key], row.employeeId)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${columns.length + 1}">За цими умовами працівників немає.</td></tr>`}</tbody></table></div></section>`;
}
function renderAnalyticsDocuments(report) {
  const receipts = report.receipts.filter((receipt) => (ui.analyticsDocumentView === 'received' ? receipt.receivedInside : ui.analyticsDocumentView === 'allocated' ? receipt.datesInside.length > 0 : receipt.receivedInside && receipt.unallocatedCredit > 0)
    && `${receipt.name} ${receipt.documentRef || ''} ${receipt.note || ''}`.toLocaleLowerCase('uk-UA').includes(ui.analyticsDocumentQuery.toLocaleLowerCase('uk-UA')));
  const pages = Math.max(1, Math.ceil(receipts.length / 25));
  ui.analyticsDocumentPage = Math.min(pages - 1, ui.analyticsDocumentPage);
  return `<section class="panel"><h2>Документи та їхні дні</h2><div class="analytics-table-tools"><label class="field"><span>Пошук документів</span><input type="search" data-analytics-document-search value="${h(ui.analyticsDocumentQuery)}" placeholder="Працівник, номер або примітка"></label><div class="button-row">${[['received', 'Отримані у періоді'], ['allocated', 'Закрили дні періоду'], ['remaining', 'Із залишком']].map(([key, label]) => `<button class="button small ${ui.analyticsDocumentView === key ? 'primary' : ''}" data-analytics-documents="${key}">${label}</button>`).join('')}</div></div><p class="muted">«Дні цього періоду» рахуються за табелем. Документ, отриманий раніше, може закривати ці дні. CSV документів містить обидві групи з окремою ознакою отримання у періоді.</p><div class="table-scroll"><table class="data-table"><thead><tr><th>Отримано</th><th>Працівник / документ</th><th>Фактичні запити</th><th>Усього зараховано днів</th><th>Дні цього періоду</th><th>Залишок</th><th>Дії</th></tr></thead><tbody>${receipts.slice(ui.analyticsDocumentPage * 25, (ui.analyticsDocumentPage + 1) * 25).map((receipt) => `<tr><td>${h(formatDate(receipt.receivedDate))}${!receipt.receivedInside ? '<small class="muted">Поза періодом отримання</small>' : ''}</td><td>${h(receipt.name)}<br><strong>${h(receipt.documentRef || 'Без номера')}</strong></td><td>${receipt.actualRequestCount}</td><td>${receipt.allocations.length}</td><td>${receipt.datesInside.length}<details><summary>Дати</summary>${h(receipt.datesInside.map(formatDate).join(', ') || 'У цьому періоді немає')}</details></td><td>${receipt.unallocatedCredit}</td><td><button class="button small" data-correct-receipt="${h(receipt.id)}">Виправити</button>${receipt.unallocatedCredit ? `<button class="button small" data-allocate-receipt="${h(receipt.id)}">Розподілити</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7">За цими умовами документів немає.</td></tr>'}</tbody></table></div><div class="analytics-pagination"><button class="button small" data-analytics-document-page="-1" ${!ui.analyticsDocumentPage ? 'disabled' : ''}>← Назад</button><span>${receipts.length} док. · сторінка ${ui.analyticsDocumentPage + 1}/${pages}</span><button class="button small" data-analytics-document-page="1" ${ui.analyticsDocumentPage >= pages - 1 ? 'disabled' : ''}>Далі →</button></div></section>`;
}
function refreshAnalyticsView(selector = '') {
  const focused = selector && document.activeElement?.matches(selector);
  const position = focused ? document.activeElement.selectionStart : null;
  renderShell();
  if (focused) { const next = appRoot.querySelector(selector); next?.focus(); if (position != null) next?.setSelectionRange(position, position); }
}
function analyticsFormula(row) {
  return `<div class="confirm-box"><p>${row.calendarWorkdays} робочих дн. − ${row.otherTasks} дн. інших завдань − ${row.absent} дн. відсутності = <strong>${row.requestRequiredDays} дн. норми</strong>.</p><p>${row.requestRequiredDays ? `${row.requestDays} закритих дн. ÷ ${row.requestRequiredDays} × 100 = ${analyticsNumber(row.completionPercent)}%.` : 'Норми немає — відсоток не розраховується.'}</p></div>`;
}
function openAnalyticsWorker(employeeId) {
  const row = ui.analytics?.rows.find((item) => item.employeeId === employeeId);
  if (!row) return;
  openModal(`<header class="modal-head"><div><h2>${h(row.name)}</h2><p>${h(formatDate(ui.analytics.startDate))} — ${h(formatDate(ui.analytics.endDate))}</p></div><button class="icon-button" data-close-modal>×</button></header><div class="modal-body">${analyticsFormula(row)}<div class="analytics-worker-metrics">${Object.keys(ANALYTICS_LABELS).filter((key) => key !== 'completionPercent').map((key) => `<div><span>${h(ANALYTICS_LABELS[key])}</span>${analyticsMetricButton(key, row[key], employeeId)}</div>`).join('')}</div></div><footer class="modal-foot"><button class="button" data-close-modal>Закрити</button></footer>`, true);
}
async function openAnalyticsMetric(metric, employeeId = '') {
  const report = ui.analytics;
  if (!report || !ANALYTICS_LABELS[metric]) return;
  if (metric === 'completionPercent') {
    const row = employeeId ? report.rows.find((item) => item.employeeId === employeeId) : report.total;
    if (!row) return;
    openModal(`<header class="modal-head"><div><h2>Як розраховано виконання норми</h2><p>${employeeId ? h(row.name) : 'Усі вибрані працівники'}</p></div><button class="icon-button" data-close-modal>×</button></header><div class="modal-body">${analyticsFormula(row)}<p>Майбутні дні виключено. Відсутність та інші завдання не вимагають запиту. Загальний відсоток розраховується із сум днів, а не як середнє відсотків працівників.</p><div class="button-row">${['requestDays', 'requestRequiredDays', 'absent'].map((key) => `<button class="button small" data-analytics-metric="${key}" data-employee-id="${h(employeeId)}">${h(ANALYTICS_LABELS[key])}: ${row[key]}</button>`).join('')}</div></div><footer class="modal-foot"><button class="button" data-close-modal>Закрити</button></footer>`, true);
    return;
  }
  ui.analyticsDetail = { filter: { ...report.filter, employeeIds: [...report.employeeIds] }, metric, employeeId: employeeId || null, page: 0 };
  await loadAnalyticsDetails();
}
async function loadAnalyticsDetails() {
  const input = ui.analyticsDetail;
  if (!input) return;
  openModal('<div class="modal-body"><p>Завантаження розрахунку…</p><button class="button" data-close-modal>Закрити</button></div>', true);
  const revision = ui.analyticsDetailRevision;
  try {
    const result = await window.counter.getAnalyticsDetails(input);
    if (revision !== ui.analyticsDetailRevision || !modalRoot.querySelector('.modal')) return;
    input.page = result.page;
    const source = (item) => item.source === 'receipt' ? item.documentRef || 'Документ без номера' : item.source === 'automatic_close' ? 'Автоматичне закриття' : item.source === 'no_record' ? 'Статусу немає' : item.source === 'manual' ? 'Ручна позначка' : 'Позначка без документа';
    openModal(`<header class="modal-head"><div><h2>${h(ANALYTICS_LABELS[input.metric])}</h2><p>${h(formatDate(input.filter.startDate))} — ${h(formatDate(input.filter.endDate))} · ${input.employeeId ? h(employeeById(input.employeeId)?.name || '') : 'Усі вибрані працівники'}</p></div><button class="icon-button" data-close-modal>×</button></header><div class="modal-body"><p class="confirm-box">Підсумок: <strong>${result.totalValue}</strong>. Записів: ${result.totalRows}. Дані за поточним табелем.</p><div class="table-scroll"><table class="data-table"><thead><tr><th>Дата</th><th>Працівник</th><th>Статус / кількість</th><th>Підстава</th><th>Дії</th></tr></thead><tbody>${result.items.map((item) => `<tr><td>${h(formatDate(item.date))}</td><td>${h(item.name)}</td><td>${item.status ? h(STATUS_LABELS[item.status] || item.status) : item.value}${item.override ? '<small>Робочий вихідний</small>' : ''}</td><td>${h(source(item))}${item.note ? `<p>${h(item.note)}</p>` : ''}${item.dates ? `<details><summary>Дати зарахування</summary>${h(item.dates.map(formatDate).join(', ') || 'Немає')}</details>` : ''}</td><td>${item.status ? `<button class="button small" data-analytics-show-day="${item.date}" data-employee-id="${h(item.employeeId)}">У табель</button>` : `<button class="button small" data-correct-receipt="${h(item.receiptId)}">Документ</button>`}</td></tr>`).join('') || '<tr><td colspan="5">Записів за цим показником немає.</td></tr>'}</tbody></table></div></div><footer class="modal-foot three-way"><button class="button" data-analytics-detail-page="-1" ${!result.page ? 'disabled' : ''}>← Назад</button><span>Сторінка ${result.page + 1}/${result.pages}</span><button class="button" data-analytics-detail-page="1" ${result.page + 1 >= result.pages ? 'disabled' : ''}>Далі →</button></footer>`, true);
    modalRoot.querySelector('.modal').classList.add('analytics-detail-modal');
  } catch (error) { if (revision === ui.analyticsDetailRevision) { closeModal(); showToast(error.message || String(error), { error: true }); } }
}

function renderEmployeesPage() {
  const active = activeEmployees();
  const archived = snapshot.employees.filter((employee) => !employee.active);
  return `
    <div class="page-header">
      <div><h1>Працівники</h1><p>До 15 активних працівників. Картка відкривається натисканням імені; архів зберігає історію.</p></div>
      <span class="status-badge" data-status="submitted">${active.length}/15 активних</span>
    </div>
    <form id="employee-form" class="panel">
      <div class="form-grid">
        <label class="field"><span>ПІБ або коротке ім’я</span><input name="name" maxlength="80" autocomplete="off" placeholder="Наприклад, Іваненко О. В." ${active.length >= 15 ? 'disabled' : ''} required></label>
        <div class="field"><span>&nbsp;</span><button class="button primary" type="submit" ${active.length >= 15 ? 'disabled' : ''}>Додати працівника</button></div>
      </div>
      ${active.length >= 15 ? '<p class="employee-capacity" role="status">Усі 15 місць зайняті. Щоб додати іншу людину, спочатку переведіть когось до архіву через перевірку доступності.</p>' : ''}
    </form>
    <section class="panel">
      <h2>Активні</h2>
      <div class="employee-list">
        ${active.map((employee, index) => `<div class="employee-row"><div><strong><button class="employee-profile-link" data-employee-profile="${h(employee.id)}">${h(employee.name)}</button></strong><small>У віджеті з ${h(formatDate(employee.createdDate))}</small></div><div class="button-row"><button class="button small" data-move-employee="${h(employee.id)}" data-direction="-1" ${index === 0 ? 'disabled' : ''} title="Перемістити вище у списку та віджеті" aria-label="Перемістити ${h(employee.name)} вище">↑</button><button class="button small" data-move-employee="${h(employee.id)}" data-direction="1" ${index === active.length - 1 ? 'disabled' : ''} title="Перемістити нижче у списку та віджеті" aria-label="Перемістити ${h(employee.name)} нижче">↓</button><button class="button small" data-rename-employee="${h(employee.id)}">Змінити ім’я</button><button class="button small" data-staff-change="${h(employee.id)}">Доступність</button><button class="button small danger" data-archive-employee="${h(employee.id)}">До архіву</button></div></div>`).join('') || '<p class="muted">Активних працівників немає.</p>'}
      </div>
    </section>
    ${archived.length && snapshot.settings.showArchivedEmployees ? `
      <section class="panel">
        <h2>Архів</h2>
        <div class="employee-list">
          ${archived.map((employee) => `<div class="employee-row"><div><strong><button class="employee-profile-link" data-employee-profile="${h(employee.id)}">${h(employee.name)}</button></strong><small>Історію збережено</small></div><div class="button-row"><button class="button small" data-restore-employee="${h(employee.id)}">Повернути</button><button class="button small danger" data-delete-employee="${h(employee.id)}">Видалити</button></div></div>`).join('')}
        </div>
      </section>
    ` : ''}
  `;
}

async function openEmployeeDeletion(employeeId) {
  openManagementModal('<header class="modal-head"><h2>Видалення з архіву</h2><button class="icon-button" data-close-modal>×</button></header><div class="modal-body" role="status">Перевіряємо пов’язані записи…</div>');
  const revision=interfaceDialogRevision;
  try {
    const report=await window.counter.previewEmployeeDeletion(employeeId);
    if(revision!==interfaceDialogRevision)return;
    openManagementModal(`<header class="modal-head"><div><span class="page-eyebrow">Перевірка перед видаленням</span><h2>${h(report.name)}</h2></div><button class="icon-button" data-close-modal>×</button></header><div class="modal-body"><p>Працівника буде видалено з архіву разом із його обліком. Це змінить історичні підсумки.</p><ul><li>Позначки табеля: ${report.records}; наявності: ${report.presence}.</li><li>Записи роботи: ${report.work}; відлучення: ${report.timeOff}; записи попереднього обліку: ${report.receipts}.</li><li>Призначення у графіках: ${report.duties.length}, з них реалізовані: ${report.duties.filter(item=>item.realized).length}.</li></ul>${report.tasks.length?`<h3>Завдання збережуться · ${report.tasks.length}</h3><ul>${report.tasks.map(task=>`<li>${h(task.title)}${task.needsAssignee?' — потрібен новий відповідальний':''}</li>`).join('')}</ul><p>Працівника буде знято зі складу виконавців. Відкриті завдання без відповідального отримають стан «Потрібне рішення».</p>`:''}${report.protocols?`<p>Імена й результати у ${report.protocols} збережених протоколах жеребкування залишаться як історичний факт.</p>`:''}<p class="muted">Після видалення можна скасувати дію кнопкою «Скасувати».</p></div><footer class="modal-foot"><button class="button" data-close-modal>Залишити в архіві</button><button class="button danger" data-delete-employee-apply="${h(employeeId)}" data-delete-token="${h(report.token)}">Видалити працівника та його облік</button></footer>`);
  }catch(error){if(revision===interfaceDialogRevision){closeModal();showToast(error.message||String(error),{error:true});}}
}

async function handleEmployeeDeletionClick(event) {
  const deleteEmployeeButton=event.target.closest('[data-delete-employee]');
  if(deleteEmployeeButton){await openEmployeeDeletion(deleteEmployeeButton.dataset.deleteEmployee);return true;}
  const deleteEmployeeApply=event.target.closest('[data-delete-employee-apply]');
  if(deleteEmployeeApply){
    const id=deleteEmployeeApply.dataset.deleteEmployeeApply,owner=deleteEmployeeApply.closest('.modal');
    deleteEmployeeApply.disabled=true;
    const result=await run(()=>window.counter.deleteEmployee({employeeId:id,expectedToken:deleteEmployeeApply.dataset.deleteToken}),null);
    if(result){if(owner.isConnected)closeModal(owner);clearJournalSelection();ui.dutyFocusedEmployeeId='';ui.dutyStats=null;ui.dutyFairness=null;ui.analytics=null;ui.analyticsDraft=null;ui.analyticsEmployeeIds=null;ui.weekly=null;ui.profile=null;if(ui.plannerEmployee===id)ui.plannerEmployee='';if(ui.timeOffEmployee===id)ui.timeOffEmployee='';showToast('Працівника видалено з архіву.',{undo:true});}
    else if(owner.isConnected){deleteEmployeeApply.disabled=false;deleteEmployeeApply.textContent='Перевірити видалення ще раз';deleteEmployeeApply.removeAttribute('data-delete-employee-apply');deleteEmployeeApply.dataset.deleteEmployee=id;}
    return true;
  }

  return false;
}

function settingsFormInput(formElement) {
  const form = new FormData(formElement);
  const [closeHour, closeMinute] = String(form.get('closeTime') || '18:00').split(':').map(Number);
  return {
    closeHour, closeMinute, automaticClose: form.get('automaticClose') === 'on',
    workdays: form.getAll('workdays').map(Number), alwaysOnTop: form.get('alwaysOnTop') === 'on',
    confirmDestructiveActions: form.get('confirmDestructiveActions') === 'on',
    showArchivedEmployees: form.get('showArchivedEmployees') === 'on',
    dutyNameWidth: Number(form.get('dutyNameWidth')), dutyRowHeight: Number(form.get('dutyRowHeight')),
    dutyLineStrength: Number(form.get('dutyLineStrength')), backupRetention: Number(form.get('backupRetention')),
    dateStyle: String(form.get('dateStyle') || 'long'),
    interfaceTheme: String(form.get('interfaceTheme') || 'navy'),
    interfaceDensity: String(form.get('interfaceDensity') || 'comfortable'),
    interfaceTextSize: String(form.get('interfaceTextSize') || 'standard'),
    operatorName: String(form.get('operatorName') || 'Керівник'),
    taskRemindersEnabled: form.get('taskRemindersEnabled') === 'on',
    taskAttentionDays: Number(form.get('taskAttentionDays') || 3),
    statusColors: Object.fromEntries(Object.keys(STATUS_COLORS).map((key) => [key, String(form.get(`color-${key}`) || STATUS_COLORS[key])])),
  };
}

function captureSettingsDraft(form) {
  ui.settingsDraft = settingsFormInput(form);
  applyAppearance();
  const notice = form.querySelector('[data-settings-save-status]');
  if (notice) notice.textContent = 'Є незбережені зміни. Вигляд показано для попереднього перегляду.';
  form.querySelector('[data-discard-settings]')?.removeAttribute('disabled');
}

function renderDataPage() {
  const settings = { ...snapshot.settings, ...ui.settingsDraft };
  const weekdays = [
    [1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Нд'],
  ];
  const colorLabels = {
    onsite:'На роботі',zkp:'ЗКП',working:'У роботі', planned_work:'Запланована робота', pending:'Без позначки',submitted:'Відпрацьовано',submitted_late:'Роботу зараховано',
    submitted_advance:'Раніше зараховано',missed:'Роботу не позначено',other_tasks:'Інша робота',
    personal_permission: 'Особисті справи', sick: 'Лікарняний', vacation: 'Відпустка',
    day_off: 'Відгул', holiday: 'Свято / вихідний',
  };
  return `
    <div class="page-header">
      <div><h1>Налаштування</h1><p>Налаштуйте ЛАД під свою роботу. Зміни застосовуються після збереження.</p></div>
      <span class="app-version" data-app-version>ЛАД · версія ${h(snapshot.appVersion || 'невідома')}</span>
    </div>
    <nav class="settings-jumps" aria-label="Розділи налаштувань"><button class="button small" data-settings-jump="appearance">Вигляд</button><button class="button small" data-settings-jump="workdays">Робочий день</button><button class="button small" data-settings-jump="table">Віджет і таблиці</button><button class="button small" data-settings-jump="colors">Статуси</button><button class="button small" data-settings-jump="tasks">Завдання й нагадування</button><button class="button small" data-settings-jump="backups">Резервні копії</button></nav>
    <form id="settings-form">
      <section class="panel settings-appearance" id="settings-appearance"><h2>Ваш робочий простір</h2><p class="panel-copy">Зовнішній вигляд можна оцінити одразу. Збережіть налаштування, щоб використати їх наступного запуску.</p>
        <fieldset class="appearance-options"><legend>Тема</legend><div>${[['navy', 'Нічний ЛАД', 'Глибокий синій, сталь і золоті акценти'], ['light', 'Світла сталь', 'Світлі поверхні та контрастні таблиці']].map(([key, title, copy]) => `<label class="appearance-choice"><input type="radio" name="interfaceTheme" value="${key}" ${(settings.interfaceTheme || 'navy') === key ? 'checked' : ''}><span class="theme-swatch swatch-${key}" aria-hidden="true"><i></i><i></i><i></i></span><strong>${title}</strong><small>${copy}</small></label>`).join('')}</div></fieldset>
        <div class="appearance-row"><fieldset class="appearance-options"><legend>Щільність інтерфейсу</legend><div class="appearance-segments">${[['comfortable', 'Комфортна'], ['compact', 'Компактна']].map(([key, title]) => `<label><input type="radio" name="interfaceDensity" value="${key}" ${(settings.interfaceDensity || 'comfortable') === key ? 'checked' : ''}><span>${title}</span></label>`).join('')}</div></fieldset><fieldset class="appearance-options"><legend>Розмір тексту</legend><div class="appearance-segments">${[['standard', 'Звичайний'], ['large', 'Збільшений']].map(([key, title]) => `<label><input type="radio" name="interfaceTextSize" value="${key}" ${(settings.interfaceTextSize || 'standard') === key ? 'checked' : ''}><span>${title}</span></label>`).join('')}</div></fieldset></div>
      </section>
      <section class="panel" id="settings-tasks"><h2>Завдання й нагадування</h2><div class="form-grid"><label class="field"><span>Ім’я керівника / автора змін</span><input name="operatorName" value="${h(settings.operatorName || 'Керівник')}" maxlength="80"><small>Локальна позначка в історії завдань; це не обліковий запис.</small></label><label class="field"><span>Показувати найближчі строки за N днів</span><input type="number" name="taskAttentionDays" min="1" max="14" value="${settings.taskAttentionDays || 3}" required></label></div><label class="check-row"><input type="checkbox" name="taskRemindersEnabled" ${settings.taskRemindersEnabled !== false ? 'checked' : ''}><span><strong>Системні сповіщення про завдання</strong><span>Працюють, поки ЛАД запущений, зокрема коли вікно згорнуте. У Windows буде створено ярлик «ЛАД» у меню «Пуск» для сповіщень; автозапуск не вмикається.</span></span></label><p class="panel-copy">Відкладення нагадування не змінює строк. Після повного закриття програми прострочені завдання буде перевірено при наступному запуску. Блок «Потребує уваги» доступний навіть без системних сповіщень.</p>${snapshot.reminderStatus?.lastError ? `<p class="confirm-box">${h(snapshot.reminderStatus.lastError)}</p>` : ''}<button class="button small" type="button" data-test-reminder>Перевірити сповіщення</button></section>
      <section class="panel" id="settings-workdays">
        <h2>Час і робочі дні</h2>
        <div class="form-grid">
          <label class="field"><span>Час автоматичного закриття</span><input name="closeTime" type="time" value="${String(settings.closeHour).padStart(2, '0')}:${String(settings.closeMinute).padStart(2, '0')}" required></label>
          <label class="field"><span>Формат дати</span><select name="dateStyle"><option value="long" ${settings.dateStyle === 'long' ? 'selected' : ''}>24 серпня 2026</option><option value="short" ${settings.dateStyle === 'short' ? 'selected' : ''}>24 серп. 2026</option><option value="numeric" ${settings.dateStyle === 'numeric' ? 'selected' : ''}>24.08.2026</option></select></label>
        </div>
        <label class="check-row"><input name="automaticClose" type="checkbox" ${settings.automaticClose ? 'checked' : ''}><span><strong>Автоматично позначати дні без обліку</strong><span>Після заданого часу день без роботи чи позначки буде виділено для перевірки. Активний період роботи не створює пропусків.</span></span></label>
        <div class="weekday-settings">${weekdays.map(([value, label]) => `<label><input type="checkbox" name="workdays" value="${value}" ${settings.workdays.includes(value) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>
      </section>
      <section class="panel" id="settings-table">
        <h2>Віджет і таблиця</h2><p class="panel-copy">Команда, чергування або завдання · круглий вигляд чи панель.</p><button class="button" type="button" data-widget-options>Налаштувати віджет</button>
        <div class="settings-grid">
          <label class="check-row"><input name="alwaysOnTop" type="checkbox" ${settings.alwaysOnTop ? 'checked' : ''}><span><strong>Завжди поверх інших вікон</strong><span>Віджет залишається видимим поверх програм.</span></span></label>
          <label class="check-row"><input name="confirmDestructiveActions" type="checkbox" ${settings.confirmDestructiveActions ? 'checked' : ''}><span><strong>Підтверджувати небезпечні дії</strong><span>Видалення графіків, записів та імпорт бази потребують підтвердження.</span></span></label>
          <label class="check-row"><input name="showArchivedEmployees" type="checkbox" ${settings.showArchivedEmployees ? 'checked' : ''}><span><strong>Показувати архів працівників</strong><span>Архів залишається доступним на сторінці працівників.</span></span></label>
        </div>
        <div class="form-grid settings-number-grid">
          <label class="field"><span>Ширина колонки імен, px</span><input name="dutyNameWidth" type="number" min="130" max="320" value="${settings.dutyNameWidth}" required></label>
          <label class="field"><span>Висота рядка графіка, px</span><input name="dutyRowHeight" type="number" min="34" max="72" value="${settings.dutyRowHeight}" required></label>
          <label class="field"><span>Товщина кольорової лінії</span><select name="dutyLineStrength"><option value="1" ${settings.dutyLineStrength === 1 ? 'selected' : ''}>Тонка</option><option value="2" ${settings.dutyLineStrength === 2 ? 'selected' : ''}>Середня</option><option value="3" ${settings.dutyLineStrength === 3 ? 'selected' : ''}>Помітна</option></select></label>
          <label class="field"><span>Кількість копій кожного типу</span><input name="backupRetention" type="number" min="1" max="30" value="${settings.backupRetention}" required><small>Окремо щоденні та перед імпортом / відновленням; попереднє збереження — додатково.</small></label>
        </div>
      </section>
      <section class="panel" id="settings-colors">
        <h2>Кольори статусів</h2>
        <div class="color-settings">${Object.entries(colorLabels).map(([key, label]) => `<label><input type="color" name="color-${key}" value="${h(settings.statusColors[key])}"><span>${h(label)}</span></label>`).join('')}</div>
      </section>
      <div class="settings-save-actions"><span data-settings-save-status role="status">${ui.settingsDraft ? 'Є незбережені зміни.' : 'Усі налаштування збережено.'}</span><div class="button-row"><button class="button small" type="button" data-reset-settings>Стандартні налаштування</button><button class="button small" type="button" data-discard-settings ${ui.settingsDraft ? '' : 'disabled'}>Скасувати зміни</button><button class="button primary" type="submit">Зберегти</button></div></div>
    </form>
    <section class="panel" id="settings-backups">
      <h2>Резервні копії</h2>
      <p class="panel-copy settings-privacy">Програма не передає дані в інтернет. Усі записи зберігаються поруч із застосунком.</p>
      <div class="data-actions">
        <div class="data-action"><h3>Резервна копія JSON</h3><p>Повна база: працівники, робота співробітників, статуси, усі графіки, відлучення та журнал змін.</p><button class="button primary" data-export="json">Зберегти копію</button></div>
        <div class="data-action"><h3>Таблиця CSV</h3><p>Плоска таблиця для відкриття в Excel або іншій програмі.</p><button class="button" data-export="csv">Експортувати таблицю</button></div>
        <div class="data-action backup-drop-zone" data-backup-drop aria-busy="${ui.dataImportPending}"><h3>Відновлення</h3><p>Виберіть JSON-копію або перетягніть один файл у цей блок. Перед заміною бази файл буде перевірено.</p><button class="button danger" data-action="import-data" ${ui.dataImportPending ? 'disabled' : ''}>${ui.dataImportPending ? 'Перевіряємо копію…' : 'Імпортувати копію'}</button><small data-import-status role="status">${ui.dataImportPending ? 'Дочекайтеся завершення імпорту.' : h(ui.dataImportError) || 'Якщо вибір файла не відкривається, перетягніть копію сюди.'}</small></div>
      </div>
      <div class="backup-list"><h3>Доступні локальні копії</h3>
        ${(ui.backups || []).map((backup) => `<div class="backup-row"><span>${backup.kind === 'checkpoint' ? 'Перед імпортом / відновленням' : backup.id === 'previous' ? 'Попередня версія' : h(backup.id.slice(13, 23))} · ${h(new Date(backup.savedAt).toLocaleString('uk-UA'))} · ${backup.employees} працівників, ${backup.workEntries||0} робіт, ${backup.tasks || 0} завдань, ${backup.draws || 0} жеребкувань</span><button class="button small" data-restore-backup="${h(backup.id)}">Відновити</button></div>`).join('') || '<p class="muted">Локальних копій поки немає.</p>'}
      </div>
      <p class="panel-copy data-file-path"><strong>Локальний файл:</strong> ${h(snapshot.dataFilePath || 'системний каталог програми')}</p>
    </section>
    <section class="panel danger-zone">
      <div>
        <h2>Повне очищення</h2>
        <p class="panel-copy">Видаляє всіх працівників, табель, роботу, усі графіки чергувань, журнал «Відлучення», обмеження, підсумки та внутрішню резервну копію. Застосунок повернеться до першого запуску.</p>
      </div>
      <button class="button danger" data-action="reset-all-data">Обнулити всі дані</button>
    </section>
  `;
}

function renderHelpPage() {
  return `<div class="page-header"><div><h1>Як працює ЛАД</h1><p>Облік роботи, доступності, чергувань і завдань команди.</p></div></div>
  <section class="panel"><h2>Навчання з підказками</h2><p>Екскурсія підсвічує кнопки. Окремий навчальний приклад із вигаданими людьми допомагає перевірити відсутність, підміну й передачу завдання; після виходу повертаються ваші дані.</p><div class="button-row"><button class="button" data-start-guide="tour">Показати кнопки</button><button class="button primary" data-start-guide="practice">Пройти навчальний приклад</button></div></section><section class="panel"><h2>Почніть із роботи співробітника</h2><p>Вкажіть, над чим він працює, кількість проєктів, початок і орієнтовний строк. Наприклад, 5 проєктів можуть зайняти 7 робочих днів: кількість проєктів і тривалість можна змінювати незалежно.</p><p>Оновлюйте загальний прогрес, а після виконання підтвердьте завершення фактичною датою. Зміна обсягу, строку або зменшення прогресу потребує пояснення; воно залишається в історії.</p><button class="button primary" data-work-new>+ Додати роботу</button></section>
  <section class="panel"><h2>Табель і статистика</h2><p>Активна робота враховується за робочими днями від початку до фактичного завершення. Вихідні, відсутність і ручні позначки мають пріоритет. Орієнтовний строк лише нагадує перевірити роботу; після нього робота триває.</p><p>Кілька робіт в один день не множать робочі дні. Проєкти у завершених роботах рахуються за фактичною датою завершення. Майбутні дні не входять до фактичної статистики.</p><p>Для роботи без проєктів достатньо позначки «У роботі» або «Відпрацьовано» у табелі. Старі дані з резервних копій зберігаються.</p><div class="button-row"><button class="button" data-tab="journal">Табель</button><button class="button" data-tab="analytics">Статистика</button></div></section>
  <section class="panel"><h2>Ваш віджет</h2><p>Перемикайте «Команда», «Чергування» і «Завдання». Клік по співробітнику відкриває дії. Швидке зарахування дня вмикається окремо в налаштуваннях.</p><p>Круглий віджет можна замінити панеллю зі списком. Положення можна зафіксувати; перетягування доступне за заголовок. «Сховати» залишає програму й нагадування працювати, «Вийти» закриває ЛАД. Ctrl+Shift+L повертає віджет, якщо комбінація доступна.</p><button class="button" data-widget-options>Налаштувати віджет</button></section>
  <section class="panel"><h2>Чергування, строки й резервні копії</h2><p>Пояснення кожного чергування відкривається з дати графіка. Зміни доступності перевіряють потребу в підміні. Завдання мають строки й нагадування. Зберігайте JSON-копію перед перенесенням на інший комп’ютер.</p><button class="button" data-tab="data">Налаштування та резервні копії</button></section>`;
}

function queueWidgetWindowMode(mode) {
  widgetWindowTransition = widgetWindowTransition
    .catch(() => null)
    .then(() => window.counter.setWindowMode(mode))
    .catch((error) => showToast(error.message || String(error), { error: true }));
  return widgetWindowTransition;
}

function openModal(content, wide = false) {
  finishDrawReveal({close:false,focus:false});
  interfaceDialogRevision += 1;
  ui.profileRevision += 1;
  ui.analyticsDetailRevision += 1;
  toastRoot.querySelectorAll('.toast:not(.error)').forEach((toast) => toast.remove());
  if (!modalRoot.childElementCount) modalReturnFocus = document.activeElement;
  modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-close><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" tabindex="-1">${content}</section></div>`;
  const dialog = modalRoot.querySelector('[role="dialog"]');
  const heading = dialog.querySelector('h2');
  if (heading) { heading.id = 'lad-dialog-title'; dialog.setAttribute('aria-labelledby', heading.id); }
  dialog.querySelectorAll('[data-close-modal]').forEach((button) => { if (button.textContent.trim() === '×') button.setAttribute('aria-label', 'Закрити діалог'); });
  appRoot.setAttribute('inert', '');
  dialog.focus();
  if (ui.mode === 'widget' && !widgetDialogExpanded) {
    widgetDialogExpanded = true;
    queueWidgetWindowMode('dialog');
  }
}

function closeModal(owner = null) {
  if (owner && !modalRoot.contains(owner)) return;
  finishDrawReveal({close:false,focus:false});
  interfaceDialogRevision += 1;
  ui.analyticsDetailRevision += 1;
  ui.profileRevision += 1;
  modalRoot.innerHTML = '';
  appRoot.removeAttribute('inert');
  const identity = [...(modalReturnFocus?.attributes || [])].filter((attribute) => attribute.name.startsWith('data-'));
  const replacement = identity.length ? [...appRoot.querySelectorAll(`[${identity[0].name}]`)].find((element) => identity.every(({ name, value }) => element.getAttribute(name) === value)) : null;
  if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
  else if (replacement) replacement.focus();
  else appRoot.querySelector('.nav-button.active')?.focus();
  modalReturnFocus = null;
  ui.dutyPreview = null;
  if (widgetDialogExpanded) {
    widgetDialogExpanded = false;
    queueWidgetWindowMode('widget');
  }
}

function quickSearchItems(query = '') {
  const needle = query.trim().toLocaleLowerCase('uk-UA');
  const items = NAV_ITEMS.map(([id, label, description]) => ({ type: 'tab', id, label, description, icon: NAV_ICONS[id] }));
  for (const employee of activeEmployees()) items.push({ type: 'employee', id: employee.id, label: employee.name, description: 'Робота, завдання, чергування й табель', icon: NAV_ICONS.employees });
  for (const task of (snapshot.tasks || []).filter(LadPlanner.active)) items.push({ type:'task', id:task.id, label:task.title, description:`Завдання · ${taskDeadlineText(task)} · ${taskPeople(task)}`, searchText:`${task.title} ${task.description} ${task.documentRef} ${taskPeople(task)}`, icon:NAV_ICONS.planner });
  return items.filter((item) => (item.searchText || (item.type === 'employee' ? item.label : `${item.label} ${item.description}`)).toLocaleLowerCase('uk-UA').includes(needle));
}

function renderQuickSearchResults(query = '') {
  return quickSearchItems(query).map((item) => `<button class="quick-result" data-quick-type="${item.type}" data-quick-id="${h(item.id)}"><span class="nav-icon">${item.icon}</span><span><strong>${h(item.label)}</strong><small>${h(item.description)}</small></span><span aria-hidden="true">→</span></button>`).join('') || '<p class="empty-state">Нічого не знайдено. Спробуйте іншу назву або ім’я.</p>';
}

function openQuickSearch() {
  openModal(`<header class="modal-head"><div><h2>Знайти або перейти</h2><p>Розділ програми, працівник або завдання. Стрілки — вибір, Enter — відкрити.</p></div><button class="icon-button" data-close-modal>×</button></header><div class="quick-search-body"><label class="quick-search-input"><span class="sr-only">Назва розділу або ім’я</span>${NAV_ICONS.search}<input type="search" data-quick-query placeholder="Наприклад, чергування або Іваненко" autocomplete="off"></label><div class="quick-results" data-quick-results>${renderQuickSearchResults()}</div></div><footer class="modal-foot"><small>Esc — закрити</small></footer>`);
  modalRoot.querySelector('.modal').classList.add('quick-search-modal');
  modalRoot.querySelector('[data-quick-query]').focus();
}

function openDutyScheduleModal(mode = 'create') {
  const schedule = activeDutySchedule();
  const creating = mode === 'create';
  openModal(`
    <form id="duty-schedule-form" data-mode="${creating ? 'create' : 'rename'}" data-schedule-id="${h(schedule.id)}">
      <header class="modal-head"><div><h2>${creating ? 'Новий окремий графік' : 'Перейменувати графік'}</h2><p>${creating ? 'Матиме власних учасників, позначки, історію та підсумки' : h(schedule.name)}</p></div><button class="icon-button" type="button" data-close-modal>×</button></header>
      <div class="modal-body">
        <label class="field"><span>Назва графіка</span><input name="name" maxlength="80" value="${creating ? '' : h(schedule.name)}" placeholder="Наприклад, Друга зміна" autocomplete="off" required autofocus></label>
        ${creating ? '<div class="confirm-box">Поточний графік не зміниться. Новий відкриється порожнім, після чого ви окремо оберете його учасників і початкові підсумки.</div>' : ''}
      </div>
      <footer class="modal-foot"><button class="button" type="button" data-close-modal>Скасувати</button><button class="button primary" type="submit">${creating ? 'Створити графік' : 'Зберегти назву'}</button></footer>
    </form>
  `);
}

function openDutyCopyModal() {
  const schedule = activeDutySchedule();
  openModal(`
    <form id="duty-copy-form" data-schedule-id="${h(schedule.id)}">
      <header class="modal-head"><div><h2>Створити копію графіка</h2><p>${h(schedule.name)}</p></div><button class="icon-button" type="button" data-close-modal>×</button></header>
      <div class="modal-body">
        <label class="field"><span>Назва нового графіка</span><input name="name" maxlength="80" value="${h(`${schedule.name} — копія`)}" required autofocus></label>
        <div class="confirm-box">Буде скопійовано учасників і правила. Призначення, відсутності, блокування та статистика нового графіка почнуться з нуля.</div>
      </div>
      <footer class="modal-foot"><button class="button" type="button" data-close-modal>Скасувати</button><button class="button primary" type="submit">Створити копію</button></footer>
    </form>
  `);
}

function dutyRulesFormInput(formElement) {
  const form = new FormData(formElement);
  const numeric = (name) => Number(form.get(name));
  const checked = (name) => form.get(name) === 'on';
  return {
    weekdayDutyCount: numeric('weekdayDutyCount'),
    weekendDutyCount: numeric('weekendDutyCount'),
    requiredByWeekday: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, form.get(`required-day-${day}`)])
      .filter(([, value]) => value !== '' && value != null).map(([day, value]) => [day, Number(value)])),
    minimumRestDays: numeric('minimumRestDays'),
    minimumRestMode: String(form.get('minimumRestMode')),
    planningPriority: String(form.get('planningPriority')),
    maximumDutiesPerWeek: numeric('maximumDutiesPerWeek'),
    pairHistoryPeriod: String(form.get('pairHistoryPeriod')),
    pairHistoryDays: numeric('pairHistoryDays'),
    weekendRestWeeks: numeric('weekendRestWeeks'),
    compensationFrom: numeric('compensationFrom'),
    compensationTarget: numeric('compensationTarget'),
    shortageBehavior: String(form.get('shortageBehavior')),
    preventConsecutiveDays: checked('preventConsecutiveDays'),
    preventConsecutiveWeekends: checked('preventConsecutiveWeekends'),
    compensateNextWeek: checked('compensateNextWeek'),
    avoidRepeatedPairs: checked('avoidRepeatedPairs'),
  };
}

function updateDutyRulesSummary() {
  const form = modalRoot.querySelector('#duty-rules-form');
  if (!form) return;
  const rules = dutyRulesFormInput(form);
  const counts = [1, 2, 3, 4, 5, 6, 0].map((day) => rules.requiredByWeekday[day]
    ?? ([0, 6].includes(day) ? rules.weekendDutyCount : rules.weekdayDutyCount));
  const slots = counts.reduce((sum, count) => sum + count, 0);
  const people = dutyParticipants().length;
  const warnings = [];
  if (counts.some((count) => count > people)) warnings.push(`У графіку ${people} учасників: у деякі дні людей буде недостатньо.`);
  if (rules.maximumDutiesPerWeek > 0 && slots > people * rules.maximumDutiesPerWeek) {
    warnings.push(`Тижневий ліміт дозволяє лише ${people * rules.maximumDutiesPerWeek} призначень. Потрібно ${slots}.`);
  }
  if (!rules.preventConsecutiveDays && rules.minimumRestMode === 'require' && rules.minimumRestDays > 0) {
    warnings.push('Два дні поспіль усе ще неможливі через обов’язковий відпочинок. Щоб дозволити їх, задайте 0 днів або бажаний відпочинок.');
  }
  if (rules.compensateNextWeek && rules.maximumDutiesPerWeek > 0 && rules.compensationTarget > rules.maximumDutiesPerWeek) {
    warnings.push('Ціль компенсації більша за тижневий ліміт. Ліміт має перевагу.');
  }
  const summary = form.querySelector('[data-rules-summary]');
  summary.innerHTML = `<strong>${slots} призначень на тиждень · ${people} учасників</strong><span>${counts.map((count, index) => `${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'][index]}: ${count}`).join(' · ')}</span>${warnings.map((warning) => `<p>${h(warning)}</p>`).join('')}`;
}

function openDutyRulesModal(initialRules = dutyRules()) {
  const schedule = activeDutySchedule();
  const rules = initialRules;
  const numberField = (name, label, min, max, hint = '') => `<label class="field"><span>${label}</span><input name="${name}" type="number" min="${min}" max="${max}" step="1" value="${rules[name]}" required>${hint ? `<small>${hint}</small>` : ''}</label>`;
  const choices = (name, title, options) => `<fieldset class="rule-choices"><legend>${title}</legend><div>${options.map(([value, label, note]) => `<label class="rule-choice"><input type="radio" name="${name}" value="${value}" ${rules[name] === value ? 'checked' : ''}><span><strong>${label}</strong>${note ? `<small>${note}</small>` : ''}</span></label>`).join('')}</div></fieldset>`;
  openModal(`
    <form id="duty-rules-form" data-schedule-id="${h(schedule.id)}">
      <header class="modal-head"><div><h2>Правила графіка</h2><p>${h(schedule.name)} · зміни діятимуть під час наступного формування</p></div><button class="icon-button" type="button" aria-label="Закрити" data-close-modal>×</button></header>
      <div class="modal-body duty-rules-form">
        <div class="rules-summary" data-rules-summary aria-live="polite"></div>
        <section class="rule-section">
          <h3>Кількість людей</h3>
          <p class="muted">Від 0 до 15. Нуль означає день без чергувань. Для окремого дня порожнє поле успадковує загальне правило.</p>
          <div class="form-grid">
            ${numberField('weekdayDutyCount', 'Чергових у будні', 0, 15)}
            ${numberField('weekendDutyCount', 'Чергових у вихідні', 0, 15)}
          </div>
          <div class="duty-weekday-rules">
            ${[['Пн', 1], ['Вт', 2], ['Ср', 3], ['Чт', 4], ['Пт', 5], ['Сб', 6], ['Нд', 0]].map(([label, day]) => `<label class="field"><span>${label}</span><input type="number" name="required-day-${day}" min="0" max="15" step="1" value="${rules.requiredByWeekday?.[day] ?? ''}" placeholder="Загальне" aria-label="Чергових: ${label}, порожнє поле — загальне правило"></label>`).join('')}
          </div>
        </section>
        <section class="rule-section">
          <h3>Відпочинок і ліміти</h3>
          <div class="form-grid">
            ${numberField('minimumRestDays', 'Повних днів між чергуваннями', 0, 30, '0 — інтервал не враховується.')}
            ${numberField('maximumDutiesPerWeek', 'Максимум чергувань за тиждень', 0, 7, '0 — без окремого ліміту; діє решта правил.')}
          </div>
          ${choices('minimumRestMode', 'Як дотримуватися інтервалу', [
            ['prefer', 'Бажаний', 'Можна скоротити для заповнення графіка.'],
            ['require', 'Обов’язковий', 'За нестачі людей лишається прогалина.'],
          ])}
          <div class="settings-grid">
            <label class="check-row"><input name="preventConsecutiveDays" type="checkbox" ${rules.preventConsecutiveDays ? 'checked' : ''}><span><strong>Заборонити два дні поспіль</strong><span>Діє незалежно від бажаного відпочинку.</span></span></label>
            <label class="check-row"><input name="preventConsecutiveWeekends" type="checkbox" ${rules.preventConsecutiveWeekends ? 'checked' : ''}><span><strong>Робити перерву між уікендами</strong><span>Увімкніть і задайте тривалість нижче.</span></span></label>
          </div>
          ${numberField('weekendRestWeeks', 'Скільки уікендів пропустити після чергування', 1, 8, '1 — пропустити наступний уікенд; 2 — наступні два. Вимикається прапорцем вище.')}
        </section>
        <section class="rule-section">
          <h3>Розподіл навантаження</h3>
          ${choices('planningPriority', 'Основний пріоритет після заповнення місць', [
            ['balanced', 'Рівномірне навантаження', 'Найменша різниця між людьми.'],
            ['rest', 'Більше відпочинку', 'Спершу довший інтервал, потім рівномірність.'],
            ['rotation', 'Черга за порядком', 'Спершу циклічна черга, потім рівномірність.'],
            ['pairs', 'Різні пари', 'Спершу нові поєднання, потім рівномірність.'],
          ])}
          <label class="check-row"><input name="compensateNextWeek" type="checkbox" ${rules.compensateNextWeek ? 'checked' : ''}><span><strong>Компенсувати навантаження наступного тижня</strong><span>Пріоритет для людей з указаної кількості до цілі; обов’язкові правила не порушуються.</span></span></label>
          <div class="form-grid">
            ${numberField('compensationFrom', 'Якщо минулого тижня було', 0, 6, 'Кількість чергувань, зокрема 0.')}
            ${numberField('compensationTarget', 'Бажана кількість цього тижня', 1, 7)}
          </div>
        </section>
        <section class="rule-section">
          <h3>Повторення пар</h3>
          <label class="check-row"><input name="avoidRepeatedPairs" type="checkbox" ${rules.avoidRepeatedPairs ? 'checked' : ''}><span><strong>Уникати повторення пар</strong><span>Якщо чергових більше двох, враховуються всі пари у складі.</span></span></label>
          ${choices('pairHistoryPeriod', 'Яку історію враховувати', [
            ['month', 'Поточний місяць'], ['quarter', 'Поточний квартал'], ['year', 'Поточний рік'],
            ['rolling', 'Останні N днів'], ['all', 'Уся збережена історія'],
          ])}
          ${numberField('pairHistoryDays', 'N днів для історії пар', 1, 366, 'Використовується в режимі «Останні N днів».')}
        </section>
        <section class="rule-section">
          <h3>Якщо людей не вистачає</h3>
          ${choices('shortageBehavior', 'Дія генератора', [
            ['leave_empty', 'Призначити доступних', 'Заповнити можливі місця; решту позначити як дефіцит.'],
            ['require_full_day', 'Додавати лише повний склад', 'Якщо повний склад неможливий, нових людей цього дня не додавати.'],
          ])}
          <div class="confirm-box">Внесені вручну люди й готові дні зберігаються. Для перебудови вже заповненого тижня спочатку очистіть його. Разові винятки задаються у складі конкретного дня.</div>
        </section>
      </div>
      <footer class="modal-foot three-way"><button class="button" type="button" data-duty-rules-reset>Початкові правила</button><button class="button" type="button" data-close-modal>Скасувати</button><button class="button primary" type="submit">Зберегти правила</button></footer>
    </form>
  `, true);
  modalRoot.querySelector('.modal').classList.add('duty-rules-modal');
  updateDutyRulesSummary();
}

async function loadDutyExplanation(date) {
  try { return await window.counter.getDutyExplanation(date); }
  catch (error) { showToast(error.message || String(error), { error: true }); return snapshot.duties.assignments[date]?.explanation || null; }
}

function renderDutyExplanation(explanation, employeeId = null) {
  if (!explanation) return '<p class="muted">Пояснення ще не збережене. Відкрийте день повторно після оновлення програми.</p>';
  const selected = (explanation.selected || []).filter((item) => !employeeId || item.employeeId === employeeId);
  const rules = explanation.rules || dutyRules();
  const priority = { balanced: 'рівномірне навантаження', rest: 'відпочинок', rotation: 'циклічна черга', pairs: 'різні пари' }[rules.planningPriority];
  const exception = explanation.exception;
  const exceptions = exception && [
    exception.allowConsecutiveDay && 'два дні поспіль', exception.allowConsecutiveWeekend && 'скорочення перерви між уікендами',
    exception.allowRestGap && 'скорочення відпочинку', exception.allowWeeklyLimit && 'перевищення тижневого ліміту',
  ].filter(Boolean);
  return `
    <div class="duty-explanation">
      <div class="confirm-box">${explanation.reconstructed
        ? 'Пояснення відновлено за поточними даними. Початкові правила й оцінку старого призначення не було збережено.'
        : `Збережено разом із призначенням: ${h(new Date(explanation.createdAt).toLocaleString('uk-UA'))}. Наведено дані на той момент.`}</div>
      ${explanation.replacement ? `<section class="replacement-proof"><strong>${explanation.replacement.kind==='swap'?'Збережений обмін двома датами':'Збережена підміна'}</strong><p>Причина: ${h(explanation.replacement.reason)}. Автор: ${h(explanation.replacement.actor)} · ${h(new Date(explanation.replacement.createdAt).toLocaleString('uk-UA'))}</p>${replacementChangeHtml(explanation.replacement)}<ul>${explanation.replacement.reasons.map(reason=>`<li>${h(reason)}</li>`).join('')}</ul>${explanation.replacement.warnings.length?`<p>Враховані попередження: ${h(explanation.replacement.warnings.join('; '))}</p>`:''}</section>` : ''}
      <p class="muted">Потрібно чергових: ${explanation.requiredCount}. Пріоритет: ${h(priority)}. Відпочинок: ${rules.minimumRestDays} днів (${rules.minimumRestMode === 'require' ? 'обов’язковий' : 'бажаний'}). Тижневий ліміт: ${rules.maximumDutiesPerWeek || 'без окремого ліміту'}.</p>
      ${exceptions?.length ? `<div class="confirm-box">Разовий дозвіл: ${h(exceptions.join(', '))}. Причина: ${h(exception.note || 'не вказана')}.</div>` : ''}
      ${selected.map((item) => `<article><strong>${h(item.name || employeeById(item.employeeId)?.name || '—')}</strong><ul>${item.reasons.map((reason) => `<li>${h(reason)}</li>`).join('')}</ul>
        ${item.alternatives?.length ? `<details class="modal-details"><summary>Чому замість мене не поставили іншого</summary><div class="table-scroll"><table class="data-table explanation-table"><thead><tr><th>Працівник</th><th>Перевірка заміни</th></tr></thead><tbody>${item.alternatives.map((alternative) => `<tr><td>${h(alternative.name)}</td><td>${h(alternative.reasons.join('; '))}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
      </article>`).join('') || '<p class="muted">Чергових не призначено.</p>'}
      ${explanation.weekLoad?.length ? `<details class="modal-details"><summary>Навантаження всіх учасників за цей тиждень</summary><div class="table-scroll"><table class="data-table"><thead><tr><th>Працівник</th><th>Чергувань</th></tr></thead><tbody>${explanation.weekLoad.map((item) => `<tr><td>${h(item.name)}</td><td>${item.total}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
      ${explanation.decision ? `<details class="modal-details"><summary>Послідовність критеріїв і оцінка розрахунку</summary><p class="muted">${h(explanation.decision.scope)} Критерії порівнюються згори вниз; менше число краще.</p><div class="table-scroll"><table class="data-table"><thead><tr><th>Критерій</th><th>Оцінка</th></tr></thead><tbody>${explanation.decision.labels.map((label, index) => `<tr><td>${h(label)}</td><td>${explanation.decision.score[index]}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
      ${explanation.notSelected?.length && !employeeId ? `<details class="modal-details"><summary>Доступність інших учасників</summary>${explanation.notSelected.map((item) => `<div class="explanation-rejected"><strong>${h(item.name || employeeById(item.employeeId)?.name || '—')}</strong>: ${h(item.reasons.join('; '))}</div>`).join('')}</details>` : ''}
    </div>
  `;
}

function dutyExplanationText(explanation, employeeId = null) {
  const selected = explanation.selected.filter((item) => !employeeId || item.employeeId === employeeId);
  return [`Чергування ${explanation.date} · ${explanation.scheduleName}`, explanation.reconstructed
    ? 'Відновлено за поточними даними; первісну оцінку не збережено.' : `Дані на момент призначення: ${explanation.createdAt}`,
    ...selected.flatMap((item) => [item.name, ...item.reasons.map((reason) => `• ${reason}`),
      ...(item.alternatives || []).map((other) => `${other.name}: ${other.reasons.join('; ')}`)]),
    explanation.replacement ? `Зміна складу: ${explanation.replacement.kind==='swap'?'обмін двома датами':'підміна'}. Причина: ${explanation.replacement.reason}. Автор: ${explanation.replacement.actor}. Дати: ${explanation.replacement.changes.map(change=>change.date).join(', ')}. ${explanation.replacement.reasons.join(' ')}` : '',
    explanation.exception?.note ? `Причина разового винятку: ${explanation.exception.note}` : '',
  ].filter(Boolean).join('\n');
}

async function openDutyPreviewModal(startDate, endDate, pinnedAssignments = []) {
  let revision = null;
  try {
    const scheduleId = snapshot.activeDutyScheduleId;
    revision = openInterfaceLoading('Попередній перегляд графіка', `${formatDate(startDate)} — ${formatDate(endDate)}`);
    const preview = await window.counter.previewDuties({ startDate, endDate, pinnedAssignments });
    if (revision !== interfaceDialogRevision || scheduleId !== snapshot.activeDutyScheduleId) return false;
    ui.dutyPreview = {
      scheduleId: snapshot.activeDutyScheduleId,
      startDate,
      endDate,
      pinnedAssignments,
    };
    const shortageDetails = new Map((preview.shortageDetails || []).map((item) => [item.date, item]));
    openModal(`
      <header class="modal-head"><div><h2>Попередній перегляд графіка</h2><p>${h(formatDate(startDate))} — ${h(formatDate(endDate))}</p></div><button class="icon-button" type="button" data-close-modal>×</button></header>
      <div class="modal-body">
        <div class="preview-summary"><span>Різниця навантаження: <strong>${preview.fairness.spread}</strong></span><span>Повторених пар: <strong>${preview.fairness.repeatedPairCount}</strong></span><span>Дефіцитних днів: <strong>${preview.shortages.length}</strong></span></div>
        <div class="confirm-box">Закріплення нижче існують лише в цьому перегляді. Оберіть працівників і натисніть «Перерахувати», потім застосуйте перевірений графік. Готові дні не змінюються.</div>
        <div class="preview-days">${preview.assignments.map((assignment) => {
          const existing = snapshot.duties.assignments[assignment.date];
          const fixedIds = existing?.source === 'generated_shortage'
            ? (existing.employeeIds || []).filter((id) => existing.manualEmployeeIds?.includes(id)
              || existing.realizedEmployeeIds?.includes(id))
            : (existing?.employeeIds || []);
          const complete = existing?.singleApproved || fixedIds.length >= assignment.requiredCount;
          const available = dutyParticipants().filter((employee) => (
            !fixedIds.includes(employee.id) && !dutyRestrictionText(employee.id, assignment.date)
          ));
          const selectedPins = pinnedAssignments.find((entry) => entry.date === assignment.date)?.employeeIds || [];
          const slots = complete ? 0 : Math.max(0, assignment.requiredCount - fixedIds.length);
          const shortage = shortageDetails.get(assignment.date);
          return `<article class="preview-day ${shortage ? 'shortage' : ''}">
            <div class="preview-day-head"><strong>${h(formatDate(assignment.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</strong><small>Потрібно: ${assignment.requiredCount}</small></div>
            <div class="preview-day-content"><strong>${h(assignment.employeeIds.map((id) => employeeById(id)?.name || '—').join(' + ') || 'Не призначено')}</strong>
              ${slots ? `<div class="preview-pin-fields">${Array.from({ length: slots }, (_, index) => `<label><span>Закріпити ${index + 1}</span><select data-duty-pin="${assignment.date}" data-pin-slot="${index}"><option value="">Автоматично</option>${available.map((employee) => `<option value="${h(employee.id)}" ${selectedPins[index] === employee.id ? 'selected' : ''}>${h(employee.name)}</option>`).join('')}</select></label>`).join('')}</div>` : '<small>Склад дня вже зафіксовано.</small>'}
              ${shortage ? `<details class="preview-shortage-details"><summary>Бракує ${shortage.missing}: показати причини</summary><ul>${shortage.blocked.map((item) => `<li><strong>${h(employeeById(item.employeeId)?.name || '—')}</strong> — ${h(item.reasons.join('; '))}</li>`).join('')}${shortage.available.length ? `<li>Доступні окремо: ${h(shortage.available.map((id) => employeeById(id)?.name || '—').join(', '))}. Спробуйте інше закріплення або склад сусідніх днів.</li>` : ''}${shortage.searchLimited ? '<li>Пошук було обмежено; можливість заповнення цього місця остаточно не виключена.</li>' : ''}</ul></details>` : ''}
            </div>
          </article>`;
        }).join('')}</div>
        <div class="muted" data-duty-preview-pending>Ручні закріплення зберігаються лише після застосування графіка.</div>
      </div>
      <footer class="modal-foot three-way"><button class="button" type="button" data-close-modal>Скасувати</button><button class="button" type="button" data-recalculate-duty-preview>Перерахувати</button><button class="button primary" data-apply-duty-preview data-start-date="${startDate}" data-end-date="${endDate}">Застосувати графік</button></footer>
    `, true);
    return true;
  } catch (error) {
    if (revision !== interfaceDialogRevision) return false;
    closeModal();
    showToast(error.message || String(error), { error: true });
    return false;
  }
}

function openDutyHistoryModal() {
  const employees = activeEmployees();
  const selectedIds = new Set(snapshot.duties.participantIds || []);
  const currentYear = localDateKey().slice(0, 4);
  const baselineForCurrentYear = snapshot.duties.baselineYear === currentYear;
  const cutoff = baselineForCurrentYear ? snapshot.duties.baselineThroughDate : null;
  openModal(`
    <form id="duty-history-form">
      <header class="modal-head"><div><h2>Учасники й підсумки</h2><p>Річні дані для статистики та склад циклічної черги</p></div><button class="icon-button" type="button" data-close-modal>×</button></header>
      <div class="modal-body">
        <div class="confirm-box">Початкові Σ і Р враховані${cutoff ? ` станом на ${h(formatDate(cutoff))}` : ''}. Усі дежурства після цієї дати додаються автоматично. З 1 січня нового року підрахунок почнеться з нуля.</div>
        <div class="table-scroll"><table class="data-table">
          <thead><tr><th>У графіку</th><th>Працівник</th><th>Усього</th><th>Реалізованих</th></tr></thead>
          <tbody>${employees.map((employee) => {
            const baseline = baselineForCurrentYear
              ? snapshot.duties.baselines[employee.id] || { total: 0, realized: 0 }
              : { total: 0, realized: 0 };
            return `<tr data-duty-history-row="${h(employee.id)}"><td><input name="participantIds" type="checkbox" value="${h(employee.id)}" ${selectedIds.has(employee.id) ? 'checked' : ''} aria-label="Участь ${h(employee.name)} у графіку"></td><td>${h(employee.name)}</td><td><input name="total-${h(employee.id)}" type="number" min="0" step="1" value="${baseline.total}" required></td><td><input name="realized-${h(employee.id)}" type="number" min="0" step="1" value="${baseline.realized}" required></td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>
      <footer class="modal-foot"><button class="button" type="button" data-close-modal>Скасувати</button><button class="button primary" type="submit">Зберегти</button></footer>
    </form>
  `, true);
}

function dutyRestrictionText(employeeId, date) {
  const key = `${employeeId}|${date}`;
  if (snapshot.duties.aDays[key]) return '«А» цього дня';
  if (snapshot.duties.aDays[`${employeeId}|${shiftDate(date, 1)}`]) return 'наступного дня позначено «А»';
  if (snapshot.duties.planningBlocks?.[key]) return 'не ставити в чергування цього дня';
  const unavailable = snapshot.duties.unavailable[key];
  if (unavailable) return `позначка ${DUTY_MARK_LABELS[unavailable.type] || 'недоступний'}`;
  const record = recordFor(employeeId, date);
  if (LadPresence.absent.has(record?.status)) {
    return STATUS_LABELS[record.status];
  }
  return '';
}

async function openDutyDayModal(date) {
  const scheduleId = snapshot.activeDutyScheduleId;
  const revision = openInterfaceLoading('Склад чергових', formatDate(date));
  const explanation = await loadDutyExplanation(date);
  if (revision !== interfaceDialogRevision || scheduleId !== snapshot.activeDutyScheduleId) return;
  const assignment = snapshot.duties.assignments[date] || { employeeIds: [], singleApproved: false };
  const requiredCount = dutyRequiredCount(date);
  const missing = Math.max(0, requiredCount - assignment.employeeIds.length);
  const incomplete = missing > 0 && !assignment.singleApproved;
  const locked = dutyWeekLocked(date);
  const exception = snapshot.duties.dayExceptions?.[date] || {};
  openModal(`
    <form id="duty-day-form" data-date="${date}">
      <header class="modal-head"><div><h2>Склад чергових ${locked ? '· 🔒' : ''}</h2><p>${h(formatDate(date))} · тиждень від ${h(formatDate(dutyWeekStart(date)))}</p></div><button class="icon-button" type="button" data-close-modal>×</button></header>
      <div class="modal-body">
        ${locked ? '<div class="confirm-box duty-locked-notice">Тиждень заблоковано від випадкових змін. Для редагування спочатку розблокуйте його.</div>' : ''}
        <div class="confirm-box ${incomplete ? 'duty-shortage-modal' : ''}">${incomplete
          ? `Не вистачає ${missing} ${missing === 1 ? 'чергового' : 'чергових'}. Додайте доступних працівників до потрібної кількості або підтвердьте одиночне чергування.`
          : `Для цього дня потрібно: ${requiredCount}. ${requiredCount > 1 ? 'Якщо обрано одного, окремо підтвердьте одиночне чергування.' : 'Окремий дозвіл на одного не потрібен.'}`}</div>
        <div class="duty-picker">${dutyParticipants().map((employee) => {
          const restriction = dutyRestrictionText(employee.id, date);
          const checked = assignment.employeeIds.includes(employee.id);
          return `<label class="duty-pick ${restriction ? 'restricted' : ''}"><input type="checkbox" name="employeeIds" value="${h(employee.id)}" ${checked ? 'checked' : ''} ${restriction || locked ? 'disabled' : ''}><span><strong>${h(employee.name)}</strong>${restriction ? `<small>${h(restriction)}</small>` : '<small>Доступний</small>'}</span></label>`;
        }).join('')}</div>
        ${requiredCount > 1 ? `<label class="check-row"><input type="checkbox" name="singleApproved" ${assignment.singleApproved ? 'checked' : ''} ${locked ? 'disabled' : ''}><span><strong>Дозволяю чергування однієї людини</strong><span>Потрібно лише тоді, коли в списку залишено одного працівника.</span></span></label>` : ''}
        <button class="button" type="button" data-find-replacement="${date}">Знайти підміну або обмін</button>
        <label class="field"><span>Причина ручного призначення</span><textarea name="note" maxlength="500" placeholder="Наприклад, підміна на прохання працівника" ${locked ? 'disabled' : ''}>${h(assignment.note || '')}</textarea></label>
        <details class="modal-details" open><summary>Чому обрано саме цих працівників</summary>${renderDutyExplanation(explanation)}<button class="button small" type="button" data-copy-duty-explanation="${date}">Скопіювати пояснення дня</button></details>
        <section class="day-exception-box">
          <h3>Разовий виняток лише на цей день</h3>
          <div class="settings-grid">
            <label class="check-row"><input id="exception-consecutive" type="checkbox" ${exception.allowConsecutiveDay ? 'checked' : ''} ${locked ? 'disabled' : ''}><span><strong>Дозволити після попереднього дня</strong></span></label>
            <label class="check-row"><input id="exception-weekend" type="checkbox" ${exception.allowConsecutiveWeekend ? 'checked' : ''} ${locked ? 'disabled' : ''}><span><strong>Дозволити сусідній уікенд</strong></span></label>
            <label class="check-row"><input id="exception-rest" type="checkbox" ${exception.allowRestGap ? 'checked' : ''} ${locked ? 'disabled' : ''}><span><strong>Дозволити коротший відпочинок</strong></span></label>
            <label class="check-row"><input id="exception-limit" type="checkbox" ${exception.allowWeeklyLimit ? 'checked' : ''} ${locked ? 'disabled' : ''}><span><strong>Перевищити тижневий ліміт</strong></span></label>
          </div>
          <label class="field"><span>Причина винятку</span><input id="exception-note" maxlength="500" value="${h(exception.note || '')}" ${locked ? 'disabled' : ''}></label>
          ${locked ? '' : `<button class="button small" type="button" data-save-day-exception="${date}">Зберегти виняток</button>`}
        </section>
      </div>
      <footer class="modal-foot">
        <button class="button ${locked ? 'primary' : ''}" type="button" data-toggle-week-lock="${date}" data-locked="${locked ? 'true' : 'false'}">${locked ? 'Розблокувати тиждень' : 'Заблокувати тиждень'}</button>
        ${locked ? '' : `<button class="button danger" type="button" data-clear-duty-day="${date}">Очистити день</button><button class="button" type="button" data-close-modal>Скасувати</button><button class="button primary" type="submit">Зберегти склад</button>`}
      </footer>
    </form>
  `, true);
}

async function openDutyEmployeeModal(employeeId, date) {
  const explanation = await loadDutyExplanation(date);
  const employee = employeeById(employeeId);
  const key = `${employeeId}|${date}`;
  const assignment = snapshot.duties.assignments[date];
  const assigned = assignment?.employeeIds?.includes(employeeId);
  const realized = assignment?.realizedEmployeeIds?.includes(employeeId);
  const aDay = snapshot.duties.aDays[key];
  const unavailable = snapshot.duties.unavailable[key];
  const planningBlock = snapshot.duties.planningBlocks?.[key];
  const previousDuty = snapshot.duties.assignments[shiftDate(date, -1)]?.employeeIds?.includes(employeeId);
  const linkedRestriction = dutyRestrictionText(employeeId, date);
  openModal(`
    <header class="modal-head"><div><h2>Чергування працівника</h2><p>${h(employee?.name || '')} · ${h(formatDate(date))}</p></div><button class="icon-button" type="button" data-close-modal>×</button></header>
    <div class="modal-body">
      <div>Стан: <strong>${assigned ? (realized ? 'реалізоване чергування' : 'призначено чергування') : (linkedRestriction || 'доступний')}</strong></div>
      ${assigned ? `
        <details class="modal-details" open><summary>Чому я чергую цього дня</summary>${renderDutyExplanation(explanation, employeeId)}<button class="button small" type="button" data-copy-duty-explanation="${date}" data-explanation-employee="${h(employeeId)}">Скопіювати пояснення</button></details>
        <button class="button ${realized ? '' : 'success'}" data-set-duty-realized data-realized="${realized ? 'false' : 'true'}" data-date="${date}" data-employee-id="${h(employeeId)}">${realized ? 'Скасувати позначку виконання' : 'Позначити виконаним'}</button>
        <button class="button danger" data-remove-duty-assignment data-date="${date}" data-employee-id="${h(employeeId)}">Зняти чергування</button>
        <div class="button-row"><button class="button primary" data-find-replacement="${date}" data-replacement-employee="${h(employeeId)}">Знайти підміну / обмін</button><button class="button" data-staff-change="${h(employeeId)}" data-staff-date="${date}">Записати відсутність</button></div>
      ` : `
        <label class="field"><span>Примітка</span><textarea id="duty-restriction-note" maxlength="500" placeholder="Необов’язково">${h(aDay?.note || unavailable?.note || planningBlock?.note || '')}</textarea></label>
        <div class="status-grid duty-status-grid">
          <button class="status-choice planning-block-choice" data-set-duty-restriction="planning_block" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Не ставити</strong><span>Лише жовта заборона для планувальника; без статистики</span></button>
          <button class="status-choice" data-set-duty-restriction="a" data-employee-id="${h(employeeId)}" data-date="${date}" ${previousDuty ? 'disabled' : ''}><strong>А</strong><span>${previousDuty ? 'Заборонено після чергування попереднього дня' : 'Не чергує лише цього дня'}</span></button>
          <button class="status-choice" data-set-duty-restriction="off" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Вихідний</strong><span>Не бере участі в чергуванні</span></button>
          <button class="status-choice" data-set-duty-restriction="vacation" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Відпустка</strong><span>Недоступний</span></button>
          <button class="status-choice" data-set-duty-restriction="sick" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Лікарняний</strong><span>Недоступний</span></button>
          <button class="status-choice" data-set-duty-restriction="day_off" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Відгул</strong><span>Недоступний</span></button>
          <button class="status-choice" data-set-duty-restriction="personal" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Особисті справи</strong><span>Недоступний</span></button>
        </div>
      `}
    </div>
    <footer class="modal-foot">
      ${!assigned && (aDay || unavailable || planningBlock) ? `<button class="button danger" data-clear-duty-restriction data-employee-id="${h(employeeId)}" data-date="${date}">Очистити позначку</button>` : ''}
      <button class="button" data-open-duty-day="${date}">Налаштувати склад дня</button>
      <button class="button" data-close-modal>Закрити</button>
    </footer>
  `, true);
}

function openSubmissionModal(employeeId) {
  return openWorkForm(employeeId);
}

function receiptFormInput(form) {
  const data = new FormData(form);
  return {
    requestCount: Number(data.get('requestCount')),
    complexTwoDay: data.get('complexTwoDay') === 'on',
    documentRef: String(data.get('documentRef') || ''),
    note: String(data.get('note') || ''),
  };
}

function showReceiptPreview(container, result) {
  container.innerHTML = `Буде зараховано ${result.creditUnits} од.: <strong>${h(result.dates.map((date) => formatDate(date)).join(', ') || 'жодної дати')}</strong>. Нерозподілений залишок: <strong>${result.unallocatedCredit}</strong>.`;
}

function openReceiptCorrectionModal() {
  showToast('Облік документів замінено обліком роботи співробітників. Попередні записи збережено.');
}

function openStatusPeriodModal() { openJournalBatchModal(); }

function openJournalBatchModal(cells = null, action = 'status') {
  ui.journalBatchCells = cells ? cells.map((cell) => ({ ...cell })) : null;
  const range = journalRange();
  const workers = journalVisibleReport().rows;
  const defaultId = workers.some((row) => row.employeeId === ui.journalFocusedEmployeeId)
    ? ui.journalFocusedEmployeeId : workers[0]?.employeeId;
  const actions = [['status', 'Змінити статус'], ['clear', 'Очистити ручні'], ['make_workday', 'Зробити робочими'], ['restore_weekend', 'Повернути вихідні']];
  const statuses = ['vacation', 'sick', 'day_off', 'other_tasks', 'personal_permission', 'holiday', 'missed', 'working', 'submitted'];
  openModal(`
    <form id="journal-batch-form">
      <header class="modal-head"><div><h2>Масова зміна табеля</h2><p>${cells ? `${cells.length} вибраних клітинок · ${new Set(cells.map((cell) => cell.employeeId)).size} працівників` : 'Працівники, період та дні тижня'}</p></div><button class="icon-button" type="button" data-close-modal>×</button></header>
      <div class="modal-body">
        ${cells ? `<details class="journal-batch-scope"><summary>Перевірити вибрані клітинки (${cells.length})</summary><p>${h([...new Set(cells.map((cell) => employeeById(cell.employeeId)?.name))].join(', '))}</p><p>${h([...new Set(cells.map((cell) => cell.date))].sort().map(formatDate).join(', '))}</p></details>` : `
          <fieldset class="journal-worker-picker"><legend>Працівники з відкритого табеля</legend><button class="button small" type="button" data-journal-pick-workers>Вибрати / зняти всіх</button><div>${workers.map((row) => `<label class="check-row"><input name="employeeIds" type="checkbox" value="${h(row.employeeId)}" ${row.employeeId === defaultId ? 'checked' : ''}><span>${h(row.name)}</span></label>`).join('') || '<p>Немає працівників. Змініть фільтри табеля.</p>'}</div></fieldset>
          <div class="form-grid"><label class="field"><span>Від</span><input name="startDate" type="date" value="${range.startDate}" required></label><label class="field"><span>До</span><input name="endDate" type="date" value="${range.endDate}" required></label></div>
          <fieldset class="journal-weekdays"><legend>Дні тижня</legend>${[1, 2, 3, 4, 5, 6, 0].map((day) => `<label><input name="weekdays" type="checkbox" value="${day}" checked>${WEEKDAY_SHORT[day]}</label>`).join('')}</fieldset>`}
        <fieldset class="journal-choice-group"><legend>Дія</legend>${actions.map(([value, label]) => `<label><input name="action" type="radio" value="${value}" ${action === value ? 'checked' : ''}>${label}</label>`).join('')}</fieldset>
        <div data-journal-status-options ${action !== 'status' ? 'hidden' : ''}>
          <fieldset class="journal-choice-group"><legend>Новий статус</legend>${statuses.map((status) => `<label><input name="status" type="radio" value="${status}" ${status === 'vacation' ? 'checked' : ''}>${h(STATUS_LABELS[status])}</label>`).join('')}</fieldset>
          <label class="check-row"><input name="includeWeekends" type="checkbox"><span>Включити неробочі дні та зробити їх робочими для цих працівників</span></label>
          <label class="check-row"><input name="replaceExisting" type="checkbox" checked><span>Замінювати наявні позначки, крім захищених записів попереднього обліку</span></label>
        </div>
        <label class="field"><span>Причина зміни · обов’язкова для відсутності</span><textarea name="note" maxlength="500" placeholder="Причина або підстава"></textarea></label>
        <label class="check-row"><input name="skipBlocked" type="checkbox"><span><strong>Пропустити заблоковані клітинки</strong><span>За замовчуванням будь-який конфлікт зупиняє всю операцію. Причини буде показано до збереження.</span></span></label>
        <p class="confirm-box">Записи попереднього обліку захищені. Очищення прибирає ручні позначки; активна робота знову визначає статус. Автоматичну позначку без обліку виправляйте новим статусом. Минулі незакриті робочі дні після очищення можуть знову стати пропусками. Повернення вихідного прибирає його окремий робочий режим і позначку дня. Усі зміни зберігаються одним кроком скасування.</p>
        <div data-journal-batch-preview aria-live="polite">Перевірте клітинки перед застосуванням.</div>
      </div>
      <footer class="modal-foot three-way"><button class="button" type="button" data-close-modal>Скасувати</button><button class="button" type="button" data-preview-journal-batch>Перевірити клітинки</button><button class="button primary" type="submit" disabled>Застосувати</button></footer>
    </form>
  `, true);
  modalRoot.querySelector('.modal').classList.add('journal-batch-modal');
}

function journalBatchInput(form) {
  const data = new FormData(form);
  return {
    ...(ui.journalBatchCells ? { cells: ui.journalBatchCells } : {
      employeeIds: data.getAll('employeeIds').map(String), startDate: String(data.get('startDate') || ''),
      endDate: String(data.get('endDate') || ''), weekdays: data.getAll('weekdays').map(Number),
    }),
    action: String(data.get('action') || 'status'), status: String(data.get('status') || 'vacation'),
    note: String(data.get('note') || ''), includeWeekends: data.get('includeWeekends') === 'on',
    replaceExisting: data.get('replaceExisting') === 'on', skipBlocked: data.get('skipBlocked') === 'on',
  };
}

function invalidateJournalPreview(form) {
  delete form.dataset.previewToken;
  // Also discards a late reply from a preview started before this edit.
  form.dataset.previewRevision = String(Number(form.dataset.previewRevision || 0) + 1);
  form.querySelector('[type="submit"]').disabled = true;
  form.querySelector('[data-journal-status-options]').hidden = new FormData(form).get('action') !== 'status';
  form.querySelector('[data-journal-batch-preview]').textContent = 'Дані змінено. Перевірте клітинки ще раз.';
}

function renderJournalBatchPreview(result) {
  const labels = { ...STATUS_LABELS, workday: 'Робочий день', weekend: 'Вихідний', pending: 'Очікується' };
  const section = (title, items, changed) => `<details ${items.length && !changed ? 'open' : ''}><summary>${title}: ${items.length}</summary><div class="table-scroll"><table class="data-table"><thead><tr><th>Працівник</th><th>Дата</th><th>${changed ? 'Зміна' : 'Причина'}</th></tr></thead><tbody>${items.slice(0, 250).map((item) => `<tr><td>${h(item.name)}</td><td>${h(formatDate(item.date))}</td><td>${changed ? `${h(labels[item.from] || item.from)} → ${h(labels[item.to] || item.to)}${item.madeWorkday ? ' · стане робочим днем' : ''}` : h(item.reason)}</td></tr>`).join('')}</tbody></table></div>${items.length > 250 ? '<p>Показано перші 250 клітинок; кількість враховує всі.</p>' : ''}</details>`;
  return `<div class="confirm-box ${result.canApply ? 'success-box' : ''}"><strong>Буде змінено: ${result.count}. Заблоковано: ${result.blocked.length}. Пропущено: ${result.skipped.length}.</strong><p>${result.canApply ? 'Можна застосувати перевірені зміни.' : result.blocked.length ? 'Операція зупинена. Усуньте конфлікти або явно дозволіть пропуск заблокованих клітинок.' : 'Немає клітинок для зміни.'}</p></div>${renderBatchEffects(result)}${section('Зміни', result.changes, true)}${section('Конфлікти', result.blocked, false)}${section('Пропуски', result.skipped, false)}`;
}

function openEmployeeRenameModal(employeeId) {
  const employee = employeeById(employeeId);
  if (!employee) return;
  openModal(`<form id="employee-rename-form" data-employee-id="${h(employeeId)}"><header class="modal-head"><div><h2>Змінити ім’я</h2></div><button class="icon-button" type="button" data-close-modal>×</button></header><div class="modal-body"><label class="field"><span>Ім’я працівника</span><input name="name" maxlength="80" value="${h(employee.name)}" required></label></div><footer class="modal-foot"><button class="button" type="button" data-close-modal>Скасувати</button><button class="button primary" type="submit">Зберегти</button></footer></form>`);
}

function openTimeOffEditModal(entryId) {
  const entry = snapshot.timeOffEntries.find((item) => item.id === entryId);
  if (!entry) return;
  openModal(`<form id="time-off-edit-form" data-entry-id="${h(entry.id)}"><header class="modal-head"><div><h2>Змінити відлучення</h2></div><button class="icon-button" type="button" data-close-modal>×</button></header><div class="modal-body form-grid"><label class="field"><span>Працівник</span><select name="employeeId">${snapshot.employees.map((employee) => `<option value="${h(employee.id)}" ${employee.id === entry.employeeId ? 'selected' : ''}>${h(employee.name)}</option>`).join('')}</select></label><label class="field"><span>Дата</span><input name="date" type="date" value="${h(entry.date)}" required></label><label class="field"><span>Від</span><input name="startTime" type="time" value="${h(entry.startTime)}" required></label><label class="field"><span>До</span><input name="endTime" type="time" value="${h(entry.endTime)}" required></label><label class="field"><span>Куди / причина</span><input name="destination" maxlength="200" value="${h(entry.destination)}" required></label><label class="field"><span>Примітка</span><input name="note" maxlength="500" value="${h(entry.note || '')}"></label></div><footer class="modal-foot"><button class="button" type="button" data-close-modal>Скасувати</button><button class="button primary" type="submit">Зберегти</button></footer></form>`, true);
}

function openFutureApproval(receipt) {
  const employee = employeeById(receipt.employeeId);
  openModal(`
    <header class="modal-head"><div><h2>Є нерозподілений залишок</h2><p>${h(employee?.name || '')}</p></div><button class="icon-button" type="button" data-close-modal>×</button></header>
    <div class="modal-body">
      <div class="confirm-box">Після закриття поточного дня та найближчих попередніх пропусків залишилося <strong>${receipt.unallocatedCredit}</strong> одиниць.</div>
      <p class="panel-copy">Ви можете зарахувати залишок на найближчі вільні робочі дні назад або наперед. Без підтвердження він збережеться в записі документа.</p>
    </div>
    <footer class="modal-foot three-way">
      <button class="button" type="button" data-approve-backward="${h(receipt.id)}" data-units="${receipt.unallocatedCredit}">Зарахувати назад</button>
      <button class="button ghost" type="button" data-close-modal>Залишити залишок</button>
      <button class="button primary" type="button" data-approve-future="${h(receipt.id)}" data-units="${receipt.unallocatedCredit}">Зарахувати наперед</button>
    </footer>
  `);
}

function openStatusModal(employeeId, date) {
  const employee=employeeById(employeeId),record=recordFor(employeeId,date),override=hasWorkdayOverride(employeeId,date);
  const weekend=!configuredWorkday(date),editable=!weekend||override,absent=LadPresence.absent.has(presenceMark(employeeId,date)?.status);
  openModal(`<header class="modal-head"><div><h2>Статус робочого дня</h2><p>${h(employee?.name||'')} · ${h(formatDate(date))}</p></div><button class="icon-button" data-close-modal>×</button></header><div class="modal-body"><p>Поточний статус: ${statusBadge(statusFor(employeeId,date))}</p>
  ${weekend&&!override?`<p class="confirm-box">Це неробочий день календаря. Якщо людина працювала, спочатку зробіть його робочим.</p><button class="button primary" data-set-workday-override data-employee-id="${h(employeeId)}" data-date="${date}">Зробити робочим днем</button>`:''}
  ${editable?`<label class="field"><span>Пояснення нової позначки</span><textarea id="status-note" maxlength="500">${h(record?.source==='work'?'':record?.note||'')}</textarea></label>${record?.receiptId?'<p class="confirm-box">Позначку перенесено з попереднього обліку. Для ручного виправлення роботи вкажіть пояснення; попередня база залишається в резервній копії.</p>':''}<div class="status-grid">
  ${date<=localDateKey()?`<button class="status-choice" data-work-mark="working" data-employee-id="${h(employeeId)}" data-date="${date}" ${absent?'disabled':''}><strong>У роботі</strong><span>Робота триває цього дня</span></button><button class="status-choice submitted-choice" data-work-mark="submitted" data-employee-id="${h(employeeId)}" data-date="${date}" ${absent?'disabled':''}><strong>Відпрацьовано</strong><span>Підтверджена робота за день</span></button>`:''}
  ${[['missed','Роботу не позначено'],['other_tasks','Інша робота'],['personal_permission','Особисті справи'],['sick','Лікарняний'],['vacation','Відпустка'],['day_off','Відгул'],['holiday','Неробочий день']].map(([status,label])=>`<button class="status-choice" data-set-status="${status}" data-employee-id="${h(employeeId)}" data-date="${date}" ${record?.receiptId||absent&&['missed','other_tasks'].includes(status)?'disabled':''}><strong>${label}</strong><span>${['missed','other_tasks'].includes(status)?'Позначка табеля':'З перевіркою чергувань і завдань'}</span></button>`).join('')}</div>`:''}
  <button class="button" data-presence-edit="${h(employeeId)}" data-presence-cell-date="${date}">Наявність: на роботі / ЗКП / відсутність</button>
  ${record?.source==='presence'?'<p class="confirm-box">Цим днем керує «Наявність». Для зміни доступності відкрийте її позначку.</p>':''}
  ${record?.source==='work'?`<p class="muted">День пов’язано з роботою: ${h(record.note)}. Щоб змінити весь період, відкрийте відповідну роботу.</p>`:''}</div><footer class="modal-foot">${weekend&&override&&!record?.receiptId?`<button class="button danger" data-clear-workday-override data-employee-id="${h(employeeId)}" data-date="${date}">Повернути вихідний</button>`:''}${record&&!['work','presence'].includes(record.source)&&!record.receiptId?`<button class="button danger" data-clear-status data-employee-id="${h(employeeId)}" data-date="${date}">Очистити ручну позначку</button>`:''}<button class="button" data-work-new="${h(employeeId)}">+ Робота</button><button class="button" data-close-modal>Закрити</button></footer>`,true);
}

function showToast(message, { error = false, undo = false } = {}) {
  const toast = document.createElement('div');
  toast.className = `toast ${error ? 'error' : ''}`;
  toast.setAttribute('role',error ? 'alert' : 'status');
  toast.innerHTML = `<span>${h(message)}</span>${undo ? '<button data-toast-undo>Скасувати</button>' : ''}<button class="toast-dismiss" data-toast-dismiss aria-label="Закрити повідомлення">×</button>`;
  toastRoot.appendChild(toast);
  let remaining = error ? 10000 : 5000, started = Date.now(), timer;
  const pause = () => { if (timer) { clearTimeout(timer); timer = null; remaining = Math.max(0,remaining - (Date.now() - started)); } };
  const resume = () => { if (timer || toast.matches(':hover') || toast.contains(document.activeElement)) return; started = Date.now(); timer = setTimeout(() => toast.remove(),remaining); };
  toast.addEventListener('mouseenter',pause); toast.addEventListener('mouseleave',resume);
  toast.addEventListener('focusin',pause); toast.addEventListener('focusout',() => queueMicrotask(resume));
  resume();
}

async function refresh({ analytics = ui.tab === 'analytics', duties = ui.tab === 'duties' } = {}) {
  const previousScheduleId = snapshot?.activeDutyScheduleId;
  snapshot = await window.counter.getSnapshot();
  if (previousScheduleId && previousScheduleId !== snapshot.activeDutyScheduleId) {
    ui.dutySelectedWeek = '';
    ui.dutyFocusedEmployeeId = '';
  }
  if (analytics) await loadAnalytics(analyticsCurrentFilter(), { render: false });
  if (duties && snapshot.duties?.initialized) {
    const year = ui.dutyMonth.slice(0, 4);
    [ui.dutyStats, ui.dutyFairness] = await Promise.all([
      window.counter.getDutyStats(year),
      window.counter.getDutyFairness({ startDate: `${year}-01-01`, endDate: `${year}-12-31` }),
    ]);
  }
  if (ui.tab === 'weekly') await loadWeeklySummary(ui.weeklyAnchor);
  if (ui.tab === 'data') ui.backups = await window.counter.listBackups();
  renderShell({preserveDrafts:true});
}

async function run(action, successMessage, { undo = true, refreshAnalytics = false } = {}) {
  try {
    const result = await action();
    await refresh({ analytics: refreshAnalytics || ui.tab === 'analytics' });
    if (successMessage) showToast(successMessage, { undo });
    return result;
  } catch (error) {
    showToast(error.message || String(error), { error: true });
    return null;
  }
}

async function submitOne(employeeId) {
  if(snapshot.settings.widgetQuickMode) return markEmployeeWork(employeeId,'submitted');
  return openWorkActions(employeeId);
}

async function resizeWidgetBy(delta) {
  try {
    await window.counter.resizeWidget(window.innerWidth + delta, true);
  } catch (error) {
    showToast(error.message || String(error), { error: true });
  }
}

function dutyHistoryEntries(formElement) {
  const form = new FormData(formElement);
  return activeEmployees().map((employee) => ({
    employeeId: employee.id,
    total: Number(form.get(`total-${employee.id}`)),
    realized: Number(form.get(`realized-${employee.id}`)),
  }));
}

function dutyParticipantIds(formElement) {
  return new FormData(formElement).getAll('participantIds').map(String);
}

function handleAnalyticsClick(event) {
  const preset = event.target.closest('[data-analytics-preset]');
  if (preset) {
    const filter = analyticsFormFilter(); const today = localDateKey();
    const key = preset.dataset.analyticsPreset;
    filter.endDate = today;
    filter.startDate = key === 'today' ? today : key === 'week' ? dutyWeekStart(today) : key === '30days' ? shiftDate(today, -29) : key === 'year' ? `${today.slice(0, 4)}-01-01` : `${today.slice(0, 7)}-01`;
    if (key === 'last_month') { const month = monthShift(today.slice(0, 7), -1); filter.startDate = `${month}-01`; filter.endDate = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`; }
    void loadAnalytics(filter); return true;
  }
  const scope = event.target.closest('[data-analytics-scope]');
  if (scope) { void loadAnalytics({ ...analyticsFormFilter(), scope: scope.dataset.analyticsScope, employeeIds: null }); return true; }
  const pick = event.target.closest('[data-analytics-pick]');
  if (pick) {
    const form = pick.closest('form'); form.querySelectorAll('[name="employeeIds"]').forEach((box) => { box.checked = pick.dataset.analyticsPick === 'all'; });
    ui.analyticsDraft = analyticsFormFilter(form); updateAnalyticsDraftNotice(form); return true;
  }
  const metric = event.target.closest('[data-analytics-metric]');
  if (metric) { void openAnalyticsMetric(metric.dataset.analyticsMetric, metric.dataset.employeeId || ''); return true; }
  const worker = event.target.closest('[data-analytics-worker]');
  if (worker) { openAnalyticsWorker(worker.dataset.analyticsWorker); return true; }
  const view = event.target.closest('[data-analytics-view]');
  if (view) { ui.analyticsView = view.dataset.analyticsView; renderShell(); return true; }
  const chart = event.target.closest('[data-analytics-chart]');
  if (chart) { ui.analyticsChart = chart.dataset.analyticsChart; renderShell(); return true; }
  const bucket = event.target.closest('[data-analytics-bucket-from]');
  if (bucket) { void loadAnalytics({ ...ui.analytics.filter, startDate: bucket.dataset.analyticsBucketFrom, endDate: bucket.dataset.analyticsBucketTo }); return true; }
  const sort = event.target.closest('[data-analytics-sort]');
  if (sort) {
    ui.analyticsSortDirection = ui.analyticsSort === sort.dataset.analyticsSort ? -ui.analyticsSortDirection : sort.dataset.analyticsSort === 'name' ? 1 : -1;
    ui.analyticsSort = sort.dataset.analyticsSort; renderShell(); return true;
  }
  const rowFilter = event.target.closest('[data-analytics-row-filter]');
  if (rowFilter) { ui.analyticsRowFilter = rowFilter.dataset.analyticsRowFilter; renderShell(); return true; }
  const columns = event.target.closest('[data-analytics-columns]');
  if (columns) { ui.analyticsColumns = columns.dataset.analyticsColumns; renderShell(); return true; }
  const documents = event.target.closest('[data-analytics-documents]');
  if (documents) { ui.analyticsDocumentView = documents.dataset.analyticsDocuments; ui.analyticsDocumentPage = 0; renderShell(); return true; }
  const documentPage = event.target.closest('[data-analytics-document-page]');
  if (documentPage) { ui.analyticsDocumentPage = Math.max(0, ui.analyticsDocumentPage + Number(documentPage.dataset.analyticsDocumentPage)); renderShell(); return true; }
  const detailPage = event.target.closest('[data-analytics-detail-page]');
  if (detailPage && ui.analyticsDetail) { ui.analyticsDetail.page = Math.max(0, ui.analyticsDetail.page + Number(detailPage.dataset.analyticsDetailPage)); void loadAnalyticsDetails(); return true; }
  const day = event.target.closest('[data-analytics-show-day]');
  if (day) {
    const person = employeeById(day.dataset.employeeId); closeModal();
    ui.tab = 'journal'; ui.journalView = 'week'; ui.journalAnchor = day.dataset.analyticsShowDay;
    ui.journalQuery = person?.name || ''; ui.journalFilter = 'all'; ui.journalArchived = !person?.active;
    ui.journalFocusedEmployeeId = day.dataset.employeeId; clearJournalSelection(); renderShell(); return true;
  }
  const correction = event.target.closest('[data-correct-receipt]');
  if (correction && correction.closest('#modal-root')) { openReceiptCorrectionModal(correction.dataset.correctReceipt); return true; }
  const exportButton = event.target.closest('[data-export-analytics-view]');
  if (exportButton && ui.analytics && !ui.analyticsError) {
    const filter = { ...ui.analytics.filter, employeeIds: [...ui.analytics.employeeIds] };
    void run(() => window.counter.exportAnalyticsReport({ filter, view: exportButton.dataset.exportAnalyticsView }), null, { undo: false })
      .then((result) => { if (result && !result.canceled) showToast('Статистику експортовано.'); });
    return true;
  }
  return false;
}
function updateAnalyticsDraftNotice(form) {
  const count = form.querySelectorAll('[name="employeeIds"]:checked').length;
  const summary = form.querySelector('.analytics-worker-picker summary');
  if (summary) summary.textContent = `Працівники: вибрано ${count}. Змінити вибір`;
  const notice = form.querySelector('[data-analytics-loading]');
  if (notice) notice.textContent = 'Фільтри змінено. Натисніть «Показати статистику», щоб оновити цифри.';
}

function resetImportedViews() {
  presenceUi.revision++;
  Object.assign(presenceUi,{date:null,query:'',filter:'all',view:'month',draft:null,report:null,busy:false});
  workUi.filter='active';workUi.query='';
  Object.assign(ui, { settingsDraft:null, todayQuery:'', todayFilter:'all',
    analytics:null, analyticsEmployeeIds:null, analyticsDraft:null, analyticsDetail:null,
    analyticsError:'', analyticsLoading:false, dutyStats:null, dutyFairness:null, dutyPreview:null,
    dutyFocusedEmployeeId:'', dutySelectedWeek:'', journalFocusedEmployeeId:'', journalQuery:'',
    plannerEmployee:'', plannerQuery:'', plannerFocus:'', timeOffEmployee:'',
    weekly:null, weeklyError:'', weeklyLoading:false, profile:null });
  drawUi.draft = null; drawUi.resultId = ''; drawUi.query = ''; drawUi.page = 0;
  effectsUi.staffDraft=null; effectsUi.staffReport=null; effectsUi.employeeId='';
  effectsUi.scheduleId=''; effectsUi.page=0; effectsUi.replacementReport=null;
  ui.analyticsRevision += 1; ui.analyticsDetailRevision += 1;
  ui.weeklyRevision += 1; ui.profileRevision += 1;
  clearJournalSelection();
}

async function importBackupFiles(files) {
  if (ui.dataImportPending || !files.length) return;
  ui.dataImportError = '';
  if (files.length !== 1 || !/\.json$/i.test(files[0].name)) {
    ui.dataImportError = 'Виберіть один файл резервної копії з розширенням .json.';
    renderShell({ preserveDrafts:true });
    showToast(ui.dataImportError, { error:true });
    return;
  }
  ui.dataImportPending = true;
  backupFileInput.disabled = true;
  renderShell({ preserveDrafts:true });
  let imported = false;
  try {
    let content;
    try { content = await files[0].text(); }
    catch (_error) { throw new Error('Не вдалося прочитати файл. Скопіюйте його на цей комп’ютер і повторіть імпорт.'); }
    const result = await window.counter.importData({ name:files[0].name, content });
    if (result?.busy) throw new Error('Інша копія вже імпортується. Дочекайтеся завершення.');
    if (result && !result.canceled) {
      imported = true;
      resetImportedViews();
      await refresh();
      showToast('Резервну копію імпортовано.', { undo:true });
    }
  } catch (error) {
    ui.dataImportError = imported
      ? 'Копію імпортовано. Не вдалося оновити екран; відкрийте розділ повторно.'
      : error.message || String(error);
    showToast(ui.dataImportError, { error:true });
  } finally {
    ui.dataImportPending = false;
    backupFileInput.disabled = false;
    renderShell({ preserveDrafts:!imported });
  }
}

backupFileInput.addEventListener('change', () => {
  const files = [...backupFileInput.files];
  // Selecting the same copy after cancellation or an error must fire change again.
  backupFileInput.value = '';
  void importBackupFiles(files);
});

window.addEventListener('dragover', event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  const zone = event.target.closest('[data-backup-drop]');
  event.dataTransfer.dropEffect = zone && !ui.dataImportPending ? 'copy' : 'none';
  document.querySelector('[data-backup-drop]')?.classList.toggle('is-dragging', Boolean(zone) && !ui.dataImportPending);
});
window.addEventListener('dragleave', event => {
  if (!event.relatedTarget) document.querySelector('[data-backup-drop]')?.classList.remove('is-dragging');
});
window.addEventListener('drop', event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  // Never navigate away from the app when a file is dropped outside the target.
  event.preventDefault();
  document.querySelector('[data-backup-drop]')?.classList.remove('is-dragging');
  if (event.target.closest('[data-backup-drop]')) void importBackupFiles([...event.dataTransfer.files]);
});

appRoot.addEventListener('click', async (event) => {
  // File selection must start in the original user gesture, before async handlers.
  const importButton = event.target.closest('[data-action="import-data"]');
  if (importButton) {
    event.preventDefault();
    if (!ui.dataImportPending && !importButton.disabled) {
      backupFileInput.value = '';
      backupFileInput.click();
    }
    return;
  }
  if (await handleLearningClick(event)) return;
  if (await handlePresenceClick(event)) return;
  if (await handleWorkClick(event)) return;
  if (await handleChangesClick(event)) return;
  if (await handleEmployeeDeletionClick(event)) return;
  if (await handleDrawClick(event)) return;
  if (isManagementClick(event) && await handleManagementClick(event)) return;
  if (handleAnalyticsClick(event)) return;
  const todayFilter = event.target.closest('[data-today-filter]');
  if (todayFilter) { ui.todayFilter = todayFilter.dataset.todayFilter; renderShell(); return; }
  if (event.target.closest('[data-today-reset]')) { ui.todayQuery = ''; ui.todayFilter = 'all'; renderShell(); return; }
  if (event.target.closest('[data-discard-settings]')) { ui.settingsDraft = null; renderShell(); return; }
  const settingsJump = event.target.closest('[data-settings-jump]');
  if (settingsJump) { appRoot.querySelector(`#settings-${settingsJump.dataset.settingsJump}`)?.scrollIntoView?.({ block: 'start' }); return; }
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    const action = actionButton.dataset.action;
    if (action === 'quick-search') { openQuickSearch(); return; }
    if (action === 'toggle-mode') {
      ui.mode = ui.mode === 'widget' ? 'dashboard' : 'widget';
      await window.counter.setWindowMode(ui.mode);
      renderShell();
      return;
    }
    if (action === 'toggle-fullscreen') {
      const nextMode = ui.mode === 'fullscreen' ? 'dashboard' : 'fullscreen';
      if (await window.counter.setWindowMode(nextMode)) {
        ui.mode = nextMode;
        renderShell();
      }
      return;
    }
    if (action === 'open-employees') {
      ui.mode = 'dashboard';
      ui.tab = 'employees';
      await window.counter.setWindowMode('dashboard');
      renderShell();
      return;
    }
    if (action === 'toggle-widget-list') {
      ui.widgetList = !ui.widgetList;
      renderShell();
      return;
    }
    if (action === 'resize-decrease') return resizeWidgetBy(-40);
    if (action === 'resize-increase') return resizeWidgetBy(40);
    if (action === 'minimize') return window.counter.minimize();
    if (action === 'close') return window.counter.close();
    if (action === 'undo') {
      await run(() => window.counter.undo(), 'Останню дію скасовано.', { undo: false });
      return;
    }
    if (action === 'reset-all-data') {
      if (!(await confirmAction('Це назавжди видалить УСІ дані застосунку. Продовжити?', true))) return;
      if (!(await confirmAction('Останнє підтвердження: видалити працівників, табель, роботу, усі графіки чергувань, завдання, жеребкування й журнал «Відлучення» без можливості скасування?', true))) return;
      const result = await run(
        () => window.counter.resetAllData(),
        null,
        { undo: false },
      );
      if (result?.reset) {
        ui.tab = 'today';
        ui.settingsDraft = null; drawUi.draft = null; drawUi.resultId = ''; drawUi.query = ''; drawUi.page = 0; effectsUi.staffDraft=null; effectsUi.staffReport=null; effectsUi.employeeId=''; effectsUi.scheduleId=''; effectsUi.page=0; effectsUi.replacementReport=null;
        ui.todayQuery = ''; ui.todayFilter = 'all';
        ui.weekly = null; ui.weeklyRevision += 1; ui.weeklyError = ''; ui.profile = null; ui.profileRevision += 1;
        ui.plannerQuery = ''; ui.plannerEmployee = ''; ui.plannerStatus = 'active'; ui.plannerPriority = ''; ui.plannerFocus = ''; ui.plannerArchived = false;
        ui.analytics = null;
        ui.dutyStats = null;
        renderShell();
        showToast('Усі дані видалено. Застосунок повернуто до першого запуску.');
      }
      return;
    }
  }

  const tabButton = event.target.closest('[data-tab]');
  if (tabButton) {
    await navigateToTab(tabButton.dataset.tab);
    return;
  }

  const sector = event.target.closest('.sector[data-employee-id]');
  if (sector) return submitOne(sector.dataset.employeeId);

  const submitButton = event.target.closest('[data-submit-one]');
  if (submitButton) return submitOne(submitButton.dataset.submitOne);

  const submissionModal = event.target.closest('[data-submission-modal]');
  if (submissionModal) return openSubmissionModal(submissionModal.dataset.submissionModal);

  const statusModal = event.target.closest('[data-status-modal]');
  if (statusModal) return openStatusModal(statusModal.dataset.statusModal, statusModal.dataset.date);

  if (event.target.closest('[data-status-period]')) return openStatusPeriodModal();
  const journalView = event.target.closest('[data-journal-view]');
  if (journalView) {
    ui.journalView = journalView.dataset.journalView;
    clearJournalSelection(); renderShell(); return;
  }
  if (event.target.closest('[data-journal-today]')) {
    ui.month = localDateKey().slice(0, 7); ui.journalAnchor = localDateKey();
    ui.journalFrom = `${ui.month}-01`; ui.journalTo = localDateKey();
    clearJournalSelection(); renderShell();
    appRoot.querySelector('.journal-matrix .is-today')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
    return;
  }
  const journalFilter = event.target.closest('[data-journal-filter]');
  if (journalFilter) {
    ui.journalFilter = journalFilter.dataset.journalFilter;
    clearJournalSelection(); refreshJournalView(); return;
  }
  if (event.target.closest('[data-journal-select-mode]')) {
    ui.journalSelecting = !ui.journalSelecting; renderShell(); return;
  }
  if (event.target.closest('[data-journal-clear-selection]')) {
    clearJournalSelection(); renderShell(); return;
  }
  const journalColumn = event.target.closest('[data-journal-column]');
  const journalRow = event.target.closest('[data-journal-row]');
  if (event.target.closest('[data-journal-select-all]') || journalColumn || (journalRow && ui.journalSelecting)) {
    const report = journalVisibleReport();
    const rows = journalRow ? report.rows.filter((row) => row.employeeId === journalRow.dataset.journalRow) : report.rows;
    const dates = journalColumn ? [journalColumn.dataset.journalColumn] : report.dates;
    const cells = rows.flatMap((row) => dates.map((date) => ({ employeeId: row.employeeId, date })));
    const chosen = new Map(ui.journalSelected.map((cell) => [`${cell.employeeId}|${cell.date}`, cell]));
    const allChosen = cells.length > 0 && cells.every((cell) => chosen.has(`${cell.employeeId}|${cell.date}`));
    for (const cell of cells) {
      const key = `${cell.employeeId}|${cell.date}`;
      if (allChosen) chosen.delete(key); else chosen.set(key, cell);
    }
    ui.journalSelected = [...chosen.values()]; ui.journalSelecting = true;
    ui.journalSelectionAnchor = cells[0] || null;
    renderShell(); return;
  }
  if (journalRow) {
    ui.journalFocusedEmployeeId = ui.journalFocusedEmployeeId === journalRow.dataset.journalRow ? '' : journalRow.dataset.journalRow;
    renderShell(); return;
  }
  const journalBatch = event.target.closest('[data-journal-batch]');
  if (journalBatch && ui.journalSelected.length) return openJournalBatchModal(ui.journalSelected, journalBatch.dataset.journalBatch);
  if (event.target.closest('[data-export-journal]')) {
    const report = journalVisibleReport();
    const result = await run(() => window.counter.exportJournal({ ...journalRange(), employeeIds: report.rows.map((row) => row.employeeId) }), null, { undo: false });
    if (result && !result.canceled) showToast('Табель за відкритий період експортовано.');
    return;
  }
  const renameEmployeeButton = event.target.closest('[data-rename-employee]');
  if (renameEmployeeButton) return openEmployeeRenameModal(renameEmployeeButton.dataset.renameEmployee);
  const moveEmployeeButton = event.target.closest('[data-move-employee]');
  if (moveEmployeeButton) {
    await run(() => window.counter.moveEmployee(moveEmployeeButton.dataset.moveEmployee,
      Number(moveEmployeeButton.dataset.direction)), 'Порядок працівників оновлено.');
    return;
  }
  const correctReceiptButton = event.target.closest('[data-correct-receipt]');
  if (correctReceiptButton) return openReceiptCorrectionModal(correctReceiptButton.dataset.correctReceipt);

  const cell = event.target.closest('[data-cell-employee]');
  if (cell) {
    if (ui.journalSelecting || event.ctrlKey || event.metaKey || event.shiftKey) return selectJournalCell(cell.dataset.cellEmployee, cell.dataset.date, event);
    return openStatusModal(cell.dataset.cellEmployee, cell.dataset.date);
  }

  const monthButton = event.target.closest('[data-month-shift]');
  if (monthButton) {
    if (ui.journalView === 'week') ui.journalAnchor = shiftDate(ui.journalAnchor, 7 * Number(monthButton.dataset.monthShift));
    else ui.month = monthShift(ui.month, Number(monthButton.dataset.monthShift));
    clearJournalSelection();
    renderShell();
    return;
  }

  const timeOffMonthButton = event.target.closest('[data-time-off-month-shift]');
  if (timeOffMonthButton) {
    ui.timeOffMonth = monthShift(ui.timeOffMonth, Number(timeOffMonthButton.dataset.timeOffMonthShift));
    ui.timeOffFrom = `${ui.timeOffMonth}-01`;
    ui.timeOffTo = `${ui.timeOffMonth}-${String(daysInMonth(ui.timeOffMonth)).padStart(2, '0')}`;
    renderShell();
    return;
  }

  if (event.target.closest('[data-clear-time-off-filter]')) {
    ui.timeOffEmployee = '';
    ui.timeOffQuery = '';
    ui.timeOffFrom = `${ui.timeOffMonth}-01`;
    ui.timeOffTo = `${ui.timeOffMonth}-${String(daysInMonth(ui.timeOffMonth)).padStart(2, '0')}`;
    renderShell();
    return;
  }

  if (event.target.closest('[data-reset-settings]')) {
    ui.settingsDraft = {
        closeHour: 18,
        closeMinute: 0,
        automaticClose: true,
        workdays: [1, 2, 3, 4, 5],
        alwaysOnTop: true,
        dutyNameWidth: 180,
        dutyRowHeight: 46,
        dutyLineStrength: 2,
        confirmDestructiveActions: true,
        showArchivedEmployees: true,
        dateStyle: 'long',
        backupRetention: 7,
        interfaceTheme: 'navy', interfaceDensity: 'comfortable', interfaceTextSize: 'standard',
        statusColors: { ...STATUS_COLORS },
    };
    renderShell();
    showToast('Стандартні налаштування підготовлено. Натисніть «Зберегти», щоб застосувати.');
    return;
  }

  const restoreBackupButton = event.target.closest('[data-restore-backup]');
  if (restoreBackupButton) {
    if (!(await confirmAction('Відновити вибрану копію? Поточні дані буде замінено, але дію можна скасувати.', true))) return;
    await run(() => window.counter.restoreBackup(restoreBackupButton.dataset.restoreBackup),
      'Резервну копію відновлено.');
    return;
  }

  const deleteTimeOffButton = event.target.closest('[data-delete-time-off]');
  if (deleteTimeOffButton) {
    if (!(await confirmAction('Видалити цей запис із журналу «Відлучення»?'))) return;
    await run(
      () => window.counter.deleteTimeOffEntry(deleteTimeOffButton.dataset.deleteTimeOff),
      'Запис видалено.',
    );
    return;
  }
  const editTimeOffButton = event.target.closest('[data-edit-time-off]');
  if (editTimeOffButton) return openTimeOffEditModal(editTimeOffButton.dataset.editTimeOff);

  if (event.target.closest('[data-create-duty-schedule]')) {
    openDutyScheduleModal('create');
    return;
  }
  if (event.target.closest('[data-copy-duty-schedule]')) {
    openDutyCopyModal();
    return;
  }
  if (event.target.closest('[data-duty-rules]')) {
    openDutyRulesModal();
    return;
  }
  if (event.target.closest('[data-rename-duty-schedule]')) {
    openDutyScheduleModal('rename');
    return;
  }
  if (event.target.closest('[data-delete-duty-schedule]')) {
    const schedule = activeDutySchedule();
    if (!(await confirmAction(`Видалити графік «${schedule.name}» разом із його історією та позначками? Інші графіки не зміняться.`))) return;
    const result = await run(
      () => window.counter.deleteDutySchedule(schedule.id),
      `Графік «${schedule.name}» видалено.`,
    );
    return;
  }

  const dutyMonthButton = event.target.closest('[data-duty-month-shift]');
  if (dutyMonthButton) {
    ui.dutyMonth = monthShift(ui.dutyMonth, Number(dutyMonthButton.dataset.dutyMonthShift));
    await refresh({ analytics: false, duties: true });
    return;
  }

  const dutyHistoryButton = event.target.closest('[data-duty-history]');
  if (dutyHistoryButton) return openDutyHistoryModal();

  const dutyDayButton = event.target.closest('[data-duty-day]');
  if (dutyDayButton) return openDutyDayModal(dutyDayButton.dataset.dutyDay);

  const focusDutyRowButton = event.target.closest('[data-focus-duty-row]');
  if (focusDutyRowButton) {
    ui.dutyFocusedEmployeeId = ui.dutyFocusedEmployeeId === focusDutyRowButton.dataset.focusDutyRow
      ? '' : focusDutyRowButton.dataset.focusDutyRow;
    renderShell();
    return;
  }

  const dutyCellButton = event.target.closest('[data-duty-cell]');
  if (dutyCellButton) {
    const date = dutyCellButton.dataset.date;
    const assignment = snapshot.duties.assignments[date];
    const incomplete = assignment
      && (assignment.employeeIds?.length || 0) < dutyRequiredCount(date)
      && !assignment.singleApproved;
    if (incomplete || dutyWeekLocked(date)) {
      openDutyDayModal(date);
      return;
    }
    if (assignment?.employeeIds?.includes(dutyCellButton.dataset.employeeId)) {
      openDutyEmployeeModal(dutyCellButton.dataset.employeeId, date);
      return;
    }
    await run(
      () => window.counter.toggleDutyAssignment(dutyCellButton.dataset.employeeId, date),
      null,
    );
    return;
  }

  const generateDutiesButton = event.target.closest('[data-generate-duties]');
  if (generateDutiesButton) {
    const { startDate, endDate } = selectedDutyWeek();
    ui.dutyMonth = startDate.slice(0, 7);
    await openDutyPreviewModal(startDate, endDate);
    return;
  }

  if (event.target.closest('[data-find-duty-week]')) {
    ui.dutySelectedWeek = nextWeekRange().startDate;
    ui.dutyMonth = ui.dutySelectedWeek.slice(0, 7);
    await refresh({ analytics: false, duties: true });
    return;
  }

  const clearWeekButton = event.target.closest('[data-clear-duty-week]');
  if (clearWeekButton) {
    const mode = clearWeekButton.dataset.clearDutyWeek;
    const { startDate, endDate } = selectedDutyWeek();
    const days = Array.from({ length: 7 }, (_, offset) => shiftDate(startDate, offset));
    const affected = days.filter((date) => {
      const assignment = snapshot.duties.assignments[date];
      return assignment && (mode === 'all' || hasClearableGeneratedDuty(assignment));
    });
    const realized = mode === 'generated' ? 0 : affected.reduce((sum, date) => (
      sum + (snapshot.duties.assignments[date].realizedEmployeeIds?.length || 0)
    ), 0);
    if (!affected.length) return;
    const scope = mode === 'generated'
      ? 'лише автоматичні призначення (ручні та реалізовані залишаться)'
      : 'усі призначення';
    if (!(await confirmAction(`Очистити ${scope} за ${formatDate(startDate)} — ${formatDate(endDate)}? Зачеплено до ${affected.length} дн. і ${realized} реалізованих чергувань. Позначки відсутності, «А», заборони та правила залишаться. Дію можна скасувати.`, true))) return;
    const result = await run(() => window.counter.clearDutyWeek(startDate, mode), null);
    if (result) showToast(`Очищено ${result.removedDays} дн. графіка.`, { undo: result.removedDays > 0 });
    return;
  }

  const archiveButton = event.target.closest('[data-archive-employee]');
  if (archiveButton) {
    openStaffChange({kind:'archive',employeeId:archiveButton.dataset.archiveEmployee,reason:'Працівника переведено до архіву'});
    return;
  }

  const restoreButton = event.target.closest('[data-restore-employee]');
  if (restoreButton) {
    await run(() => window.counter.restoreEmployee(restoreButton.dataset.restoreEmployee), 'Працівника повернуто до віджета.');
    return;
  }

  const exportButton = event.target.closest('[data-export]');
  if (exportButton) {
    try {
      const result = await window.counter.exportData(exportButton.dataset.export);
      if (!result.canceled) showToast('Файл успішно збережено.');
    } catch (error) {
      showToast(error.message || String(error), { error: true });
    }
    return;
  }

  const allocateButton = event.target.closest('[data-allocate-receipt]');
  if (allocateButton) {
    const receipt = snapshot.receipts.find((item) => item.id === allocateButton.dataset.allocateReceipt);
    if (receipt) openFutureApproval(receipt);
  }
});

appRoot.addEventListener('pointerdown', (event) => {
  const handle = event.target.closest('[data-widget-resize]');
  if (!handle) return;
  event.preventDefault();
  resizeGesture = {
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    startSize: window.innerWidth,
    nextSize: window.innerWidth,
    frame: null,
  };
  handle.setPointerCapture?.(event.pointerId);
});

window.addEventListener('pointermove', (event) => {
  if (!resizeGesture || event.pointerId !== resizeGesture.pointerId) return;
  const delta = ((event.screenX - resizeGesture.startX) + (event.screenY - resizeGesture.startY)) / 2;
  resizeGesture.nextSize = Math.max(260, Math.min(700, Math.round(resizeGesture.startSize + delta)));
  if (resizeGesture.frame) return;
  resizeGesture.frame = window.requestAnimationFrame(async () => {
    if (!resizeGesture) return;
    resizeGesture.frame = null;
    try {
      await window.counter.resizeWidget(resizeGesture.nextSize, false);
    } catch (error) {
      showToast(error.message || String(error), { error: true });
    }
  });
});

window.addEventListener('pointerup', async (event) => {
  if (!resizeGesture || event.pointerId !== resizeGesture.pointerId) return;
  const finalSize = resizeGesture.nextSize;
  if (resizeGesture.frame) window.cancelAnimationFrame(resizeGesture.frame);
  resizeGesture = null;
  try {
    await window.counter.resizeWidget(finalSize, true);
  } catch (error) {
    showToast(error.message || String(error), { error: true });
  }
});

appRoot.addEventListener('contextmenu', (event) => {
  const journalCell = event.target.closest('[data-cell-employee]');
  if (journalCell) {
    event.preventDefault();
    openStatusModal(journalCell.dataset.cellEmployee, journalCell.dataset.date);
    return;
  }
  const dutyCell = event.target.closest('[data-duty-cell]');
  if (dutyCell) {
    event.preventDefault();
    openDutyEmployeeModal(dutyCell.dataset.employeeId, dutyCell.dataset.date);
    return;
  }
  const sector = event.target.closest('.sector[data-employee-id]');
  if (!sector) return;
  event.preventDefault();
  openStatusModal(sector.dataset.employeeId, localDateKey());
});

appRoot.addEventListener('keydown', (event) => {
  if (ui.tab === 'journal' && event.key === 'Escape' && ui.journalSelected.length) {
    clearJournalSelection(); renderShell(); return;
  }
  const sector = event.target.closest('.sector[data-employee-id]');
  if (sector && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openWorkActions(sector.dataset.employeeId);
    return;
  }
  const cell = event.target.closest('[data-cell-employee], [data-duty-cell]');
  if (!cell) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (cell.dataset.dutyCell !== undefined) openDutyEmployeeModal(cell.dataset.employeeId, cell.dataset.date);
    else if (ui.journalSelecting || event.ctrlKey || event.metaKey || event.shiftKey) selectJournalCell(cell.dataset.cellEmployee, cell.dataset.date, event);
    else openStatusModal(cell.dataset.cellEmployee, cell.dataset.date);
    return;
  }
  const offsets = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
  if (!offsets[event.key]) return;
  const rows = [...cell.closest('tbody').rows];
  const row = rows.indexOf(cell.parentElement);
  const cells = [...cell.parentElement.querySelectorAll('[data-cell-employee], [data-duty-cell]')];
  const column = cells.indexOf(cell);
  const [dr, dc] = offsets[event.key];
  const next = [...(rows[row + dr]?.querySelectorAll('[data-cell-employee], [data-duty-cell]') || [])][column + dc];
  if (!next) return;
  event.preventDefault();
  if (event.shiftKey && next.dataset.cellEmployee) {
    if (!ui.journalSelectionAnchor) ui.journalSelectionAnchor = { employeeId: cell.dataset.cellEmployee, date: cell.dataset.date };
    selectJournalCell(next.dataset.cellEmployee, next.dataset.date, event);
  }
  cell.tabIndex = -1;
  next.tabIndex = 0;
  next.focus();
  next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
});

appRoot.addEventListener('submit', event => submitInterfaceForm(event, async () => {
  if (await handlePresenceSubmit(event)) return;
  if (await handleWorkSubmit(event)) return;
  if (await handleChangesSubmit(event)) return;
  if (await handleDrawSubmit(event)) return;
  if (['task-form','task-status-form','planner-filter-form','profile-range-form','weekly-range-form'].includes(event.target.id) && await handleManagementSubmit(event)) return;
  if (event.target.id === 'journal-range-form') {
    const data = new FormData(event.target);
    try {
      const startDate = String(data.get('startDate') || ''); const endDate = String(data.get('endDate') || '');
      CounterJournal.datesBetween(startDate, endDate);
      ui.journalFrom = startDate; ui.journalTo = endDate;
      clearJournalSelection(); renderShell();
    } catch (error) { showToast(error.message, { error: true }); }
    return;
  }
  if (event.target.id === 'settings-form') {
    const settings = settingsFormInput(event.target);
    const result = await run(() => window.counter.updateSettings(settings), 'Налаштування збережено.');
    if (result) { ui.settingsDraft = null; renderShell(); }
    return;
  }
  if (event.target.id === 'time-off-filter-form') {
    const form = new FormData(event.target);
    ui.timeOffEmployee = String(form.get('employeeId') || '');
    ui.timeOffFrom = String(form.get('startDate') || '');
    ui.timeOffTo = String(form.get('endDate') || '');
    ui.timeOffQuery = String(form.get('query') || '');
    renderShell();
    return;
  }
  if (event.target.id === 'time-off-form') {
    const form = new FormData(event.target);
    const result = await run(
      () => window.counter.createTimeOffEntry({
        employeeId: String(form.get('employeeId') || ''),
        date: String(form.get('date') || ''),
        startTime: String(form.get('startTime') || ''),
        endTime: String(form.get('endTime') || ''),
        destination: String(form.get('destination') || ''),
        note: String(form.get('note') || ''),
      }),
      'Запис «Відлучення» додано.',
    );
    if (result) {
      ui.timeOffMonth = result.date.slice(0, 7);
      appRoot.querySelector('#time-off-form')?.reset();
      renderShell();
    }
    return;
  }
  if (event.target.id === 'duty-history-form') {
    await run(
      () => window.counter.initializeDuties(dutyHistoryEntries(event.target), dutyParticipantIds(event.target)),
      'Початкові підсумки чергувань збережено.',
    );
    return;
  }
  if (event.target.id === 'employee-form') {
    const form = new FormData(event.target);
    const employee = await run(() => window.counter.addEmployee(form.get('name')), 'Працівника додано.');
    if (employee) appRoot.querySelector('#employee-form')?.reset();
  }
  if (event.target.id === 'analytics-form') { await loadAnalytics(analyticsFormFilter(event.target)); }
}));

appRoot.addEventListener('input', (event) => {
  if (handlePresenceInput(event)) return;
  if (handleChangesInput(event)) return;
  captureDrawInput(event);
  if (event.target.matches('[data-draw-search]')) {
    const cursor = event.target.selectionStart; drawUi.query = event.target.value; drawUi.page = 0; renderShell();
    const input = appRoot.querySelector('[data-draw-search]'); input.focus(); if (cursor != null) input.setSelectionRange(cursor,cursor); return;
  }
  const settingsForm = event.target.closest('#settings-form');
  if (settingsForm) { captureSettingsDraft(settingsForm); return; }
  if(event.target.matches('[data-work-search]')) { workUi.query=event.target.value; const position=event.target.selectionStart; renderShell(); const next=appRoot.querySelector('[data-work-search]');next?.focus();if(position!=null)next?.setSelectionRange(position,position);return; }
  if (event.target.matches('[data-today-search]')) {
    const position = event.target.selectionStart;
    ui.todayQuery = event.target.value; renderShell();
    const input = appRoot.querySelector('[data-today-search]'); input?.focus();
    try { input?.setSelectionRange(position, position); } catch { /* Search inputs do not support selection on every platform. */ }
    return;
  }
  const analyticsForm = event.target.closest('#analytics-form');
  if (analyticsForm) { ui.analyticsDraft = analyticsFormFilter(analyticsForm); updateAnalyticsDraftNotice(analyticsForm); return; }
  if (event.target.matches('[data-analytics-search]')) { ui.analyticsQuery = event.target.value; refreshAnalyticsView('[data-analytics-search]'); return; }
  if (event.target.matches('[data-analytics-document-search]')) { ui.analyticsDocumentQuery = event.target.value; ui.analyticsDocumentPage = 0; refreshAnalyticsView('[data-analytics-document-search]'); return; }
  if (!event.target.matches('[data-journal-search]')) return;
  ui.journalQuery = event.target.value; clearJournalSelection(); refreshJournalView();
});

appRoot.addEventListener('change', async (event) => {
  if(event.target.matches('[data-widget-schedule]')){await run(()=>window.counter.switchDutySchedule(event.target.value),null,{undo:false});return;}
  if (handleWorkChange(event)) return;
  if (handlePresenceChange(event)) return;
  if (handleChangesChange(event)) return;
  if (handleManagementChange(event)) return;
  const settingsForm = event.target.closest('#settings-form');
  if (settingsForm) { captureSettingsDraft(settingsForm); return; }
  if (event.target.matches('[data-journal-month]')) {
    if (/^\d{4}-\d{2}$/.test(event.target.value)) { ui.month = event.target.value; clearJournalSelection(); renderShell(); }
    return;
  }
  if (event.target.matches('[data-journal-anchor]')) {
    if (event.target.value) { ui.journalAnchor = event.target.value; clearJournalSelection(); renderShell(); }
    return;
  }
  if (event.target.matches('[data-journal-setting]')) {
    const key = event.target.dataset.journalSetting;
    if (!['journalCompact', 'journalHideWeekends', 'journalArchived'].includes(key)) return;
    ui[key] = event.target.checked;
    if (key !== 'journalCompact') clearJournalSelection();
    renderShell(); return;
  }
  if (event.target.matches('[data-duty-schedule-select]')) {
    const result = await run(
      () => window.counter.switchDutySchedule(event.target.value),
      null,
      { undo: false },
    );
    if (result) {
      ui.dutySelectedWeek = '';
      ui.dutyFocusedEmployeeId = '';
      ui.dutyStats = null;
      await refresh({ duties: true });
    }
    return;
  }
  if (event.target.matches('[data-duty-week-select]')) {
    if (!event.target.value) return;
    ui.dutySelectedWeek = dutyWeekStart(event.target.value);
    ui.dutyMonth = ui.dutySelectedWeek.slice(0, 7);
    await refresh({ analytics: false, duties: true });
    return;
  }
  if (event.target.id === 'always-on-top') {
    try {
      await window.counter.setAlwaysOnTop(event.target.checked);
      snapshot.settings.alwaysOnTop = event.target.checked;
      showToast(event.target.checked ? 'Віджет закріплено поверх вікон.' : 'Закріплення вимкнено.');
    } catch (error) {
      showToast(error.message || String(error), { error: true });
    }
  }
});

modalRoot.addEventListener('input', (event) => {
  if (handlePresenceInput(event)) return;
  if (handleChangesInput(event)) return;
  if (event.target.matches('[data-quick-query]')) modalRoot.querySelector('[data-quick-results]').innerHTML = renderQuickSearchResults(event.target.value);
});

modalRoot.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeModal(); return; }
  if (event.key === 'Tab') {
    const dialog = modalRoot.querySelector('[role="dialog"]');
    const focusable = [...dialog.querySelectorAll('button, input, select, textarea, summary, a[href], [tabindex="0"]')].filter((element) => !element.disabled && element.type !== 'hidden' && !element.closest('[hidden]') && (typeof element.checkVisibility !== 'function' || element.checkVisibility({ checkVisibilityCSS: true })));
    const first = focusable[0]; const last = focusable.at(-1);
    if (!first) { event.preventDefault(); dialog.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
  }
  if (!modalRoot.querySelector('[data-quick-query]')) return;
  const buttons = [...modalRoot.querySelectorAll('[data-quick-type]')];
  const index = buttons.indexOf(document.activeElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const next = index < 0 ? (event.key === 'ArrowUp' ? buttons.length - 1 : 0) : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  } else if (event.key === 'Enter' && event.target.matches('[data-quick-query]')) { event.preventDefault(); buttons[0]?.click(); }
});

modalRoot.addEventListener('change', (event) => {
  if (handleWorkChange(event)) return;
  if (handlePresenceChange(event)) return;
  if (handleChangesChange(event)) return;
  if (handleManagementChange(event)) return;
  const batchForm = event.target.closest('#journal-batch-form');
  if (batchForm) invalidateJournalPreview(batchForm);
  if (!event.target.matches('[data-duty-pin]')) return;
  const apply = modalRoot.querySelector('[data-apply-duty-preview]');
  if (apply) apply.disabled = true;
  const notice = modalRoot.querySelector('[data-duty-preview-pending]');
  if (notice) notice.textContent = 'Закріплення змінено. Натисніть «Перерахувати», щоб побачити результат перед застосуванням.';
});

modalRoot.addEventListener('input', (event) => {
  const batchForm = event.target.closest('#journal-batch-form');
  if (batchForm) invalidateJournalPreview(batchForm);
  if (event.target.closest('#duty-rules-form')) updateDutyRulesSummary();
  const form = event.target.closest('#submission-form, #receipt-correction-form');
  if (!form) return;
  form.dataset.receiptPreviewRevision = String(Number(form.dataset.receiptPreviewRevision || 0) + 1);
  form.querySelector('[type="submit"]').disabled = true;
  const notice = form.querySelector('[data-submission-preview], [data-period-preview]');
  if (notice) notice.textContent = 'Дані змінено. Перевірте дати ще раз.';
});

modalRoot.addEventListener('click', async (event) => {
  if(event.target.closest('[data-action="close"]')){await window.counter.close();return;}
  if (await handlePresenceClick(event)) return;
  if (await handleWorkClick(event)) return;
  if (await handleChangesClick(event)) return;
  if (await handleEmployeeDeletionClick(event)) return;
  if (await handleDrawClick(event)) return;
  if (isManagementClick(event) && await handleManagementClick(event)) return;
  const quick = event.target.closest('[data-quick-type]');
  if (quick) {
    const { quickType, quickId } = quick.dataset;
    closeModal();
    if (quickType === 'employee') await openEmployeeProfile(quickId);
    else if (quickType === 'task') openTaskModal(quickId);
    else await navigateToTab(quickId);
    return;
  }
  if (handleAnalyticsClick(event)) return;
  const copyExplanation = event.target.closest('[data-copy-duty-explanation]');
  if (copyExplanation) {
    try {
      const explanation = await window.counter.getDutyExplanation(copyExplanation.dataset.copyDutyExplanation);
      await navigator.clipboard.writeText(dutyExplanationText(explanation, copyExplanation.dataset.explanationEmployee || null));
      showToast('Пояснення скопійовано.');
    } catch (error) { showToast(error.message || String(error), { error: true }); }
    return;
  }
  if (event.target.closest('[data-duty-rules-reset]')) {
    openDutyRulesModal({ weekdayDutyCount: 2, weekendDutyCount: 2, requiredByWeekday: {},
      minimumRestDays: 2, minimumRestMode: 'prefer', maximumDutiesPerWeek: 0,
      preventConsecutiveDays: true, preventConsecutiveWeekends: true, weekendRestWeeks: 1,
      planningPriority: 'balanced', compensateNextWeek: true, compensationFrom: 1, compensationTarget: 2,
      avoidRepeatedPairs: true, pairHistoryPeriod: 'year', pairHistoryDays: 90, shortageBehavior: 'leave_empty' });
    return;
  }
  if (event.target.matches('[data-modal-close]') || event.target.closest('[data-close-modal]')) {
    closeModal();
    return;
  }

  const previewSubmissionButton = event.target.closest('[data-preview-submission]');
  if (previewSubmissionButton) {
    const form = previewSubmissionButton.closest('form');
    if (previewSubmissionButton.disabled || !form?.reportValidity()) return;
    const revision = Number(form.dataset.receiptPreviewRevision || 0) + 1;
    form.dataset.receiptPreviewRevision = String(revision);
    previewSubmissionButton.disabled = true;
    form.querySelector('[type="submit"]').disabled = true;
    const input = receiptFormInput(form);
    const submitted = JSON.stringify(input);
    try {
      const result = form.id === 'receipt-correction-form'
        ? await window.counter.previewReceiptCorrection(form.dataset.receiptId, input)
        : await window.counter.previewSubmission({ ...input, employeeId: form.dataset.employeeId });
      if (!form.isConnected || Number(form.dataset.receiptPreviewRevision) !== revision || JSON.stringify(receiptFormInput(form)) !== submitted) return;
      showReceiptPreview(form.querySelector('[data-submission-preview]'), result);
      form.querySelector('[type="submit"]').disabled = false;
    } catch (error) {
      if (!form.isConnected || Number(form.dataset.receiptPreviewRevision) !== revision) return;
      form.querySelector('[type="submit"]').disabled = true;
      showToast(error.message || String(error), { error: true });
    } finally {
      if (previewSubmissionButton.isConnected) previewSubmissionButton.disabled = false;
    }
    return;
  }

  if (event.target.closest('[data-journal-pick-workers]')) {
    const form = event.target.closest('form');
    const boxes = [...form.querySelectorAll('[name="employeeIds"]')];
    const checked = !boxes.every((box) => box.checked);
    boxes.forEach((box) => { box.checked = checked; });
    invalidateJournalPreview(form); return;
  }
  const previewJournalButton = event.target.closest('[data-preview-journal-batch]');
  if (previewJournalButton) {
    const form = previewJournalButton.closest('form');
    if (!form.reportValidity()) return;
    invalidateJournalPreview(form);
    const revision = form.dataset.previewRevision;
    previewJournalButton.disabled = true;
    try {
      const result = await window.counter.previewJournalBatch(journalBatchInput(form));
      if (!form.isConnected || form.dataset.previewRevision !== revision) return;
      form.querySelector('[data-journal-batch-preview]').innerHTML = renderJournalBatchPreview(result);
      form.dataset.previewToken = result.token;
      form.querySelector('[type="submit"]').disabled = !result.canApply;
    } catch (error) { showToast(error.message || String(error), { error: true }); }
    finally { previewJournalButton.disabled = false; }
    return;
  }

  const applyPreviewButton = event.target.closest('[data-apply-duty-preview]');
  if (applyPreviewButton) {
    const draft = ui.dutyPreview;
    if (!draft || draft.scheduleId !== snapshot.activeDutyScheduleId
      || draft.startDate !== applyPreviewButton.dataset.startDate
      || draft.endDate !== applyPreviewButton.dataset.endDate) return;
    const result = await run(
      () => window.counter.generateDuties({
        startDate: draft.startDate,
        endDate: draft.endDate,
        pinnedAssignments: draft.pinnedAssignments,
      }),
      null,
    );
    if (result) {
      closeModal();
      showToast(result.shortages?.length
        ? `Графік застосовано частково: дефіцитних днів — ${result.shortages.length}.`
        : 'Перевірений графік застосовано.', { error: Boolean(result.shortages?.length), undo: true });
    }
    return;
  }

  if (event.target.closest('[data-recalculate-duty-preview]')) {
    const draft = ui.dutyPreview;
    if (!draft) return;
    const byDate = new Map();
    for (const select of modalRoot.querySelectorAll('[data-duty-pin]')) {
      if (!select.value) continue;
      const ids = byDate.get(select.dataset.dutyPin) || [];
      ids.push(select.value);
      byDate.set(select.dataset.dutyPin, ids);
    }
    const pinnedAssignments = [...byDate].map(([date, employeeIds]) => ({ date, employeeIds }));
    const scrollTop = modalRoot.querySelector('.modal')?.scrollTop || 0;
    if (await openDutyPreviewModal(draft.startDate, draft.endDate, pinnedAssignments)) {
      modalRoot.querySelector('.modal').scrollTop = scrollTop;
    }
    return;
  }

  const weekLockButton = event.target.closest('[data-toggle-week-lock]');
  if (weekLockButton) {
    const willLock = weekLockButton.dataset.locked !== 'true';
    if (willLock && !(await confirmAction('Заблокувати весь тиждень від змін?'))) return;
    const result = await run(
      () => window.counter.setDutyWeekLocked(weekLockButton.dataset.toggleWeekLock, willLock),
      willLock ? 'Тиждень заблоковано.' : 'Тиждень розблоковано.',
    );
    if (result) openDutyDayModal(weekLockButton.dataset.toggleWeekLock);
    return;
  }

  const saveExceptionButton = event.target.closest('[data-save-day-exception]');
  if (saveExceptionButton) {
    const date = saveExceptionButton.dataset.saveDayException;
    const result = await run(
      () => window.counter.setDutyDayException(date, {
        allowConsecutiveDay: modalRoot.querySelector('#exception-consecutive')?.checked,
        allowConsecutiveWeekend: modalRoot.querySelector('#exception-weekend')?.checked,
        allowRestGap: modalRoot.querySelector('#exception-rest')?.checked,
        allowWeeklyLimit: modalRoot.querySelector('#exception-limit')?.checked,
        note: modalRoot.querySelector('#exception-note')?.value || '',
      }),
      'Разовий виняток збережено.',
    );
    if (result !== undefined) openDutyDayModal(date);
    return;
  }

  const modalSubmitOne = event.target.closest('[data-modal-submit-one]');
  if (modalSubmitOne) {
    const employeeId = modalSubmitOne.dataset.modalSubmitOne;
    closeModal();
    await submitOne(employeeId);
    return;
  }

  const modalSubmission = event.target.closest('[data-modal-submission]');
  if (modalSubmission) {
    const employeeId = modalSubmission.dataset.modalSubmission;
    openSubmissionModal(employeeId);
    return;
  }

  const futureButton = event.target.closest('[data-approve-future]');
  if (futureButton) {
    const result = await run(
      () => window.counter.allocateForward(futureButton.dataset.approveFuture, Number(futureButton.dataset.units)),
      'Майбутні робочі дні зараховано з вашого дозволу.',
    );
    if (result) closeModal();
    return;
  }

  const backwardButton = event.target.closest('[data-approve-backward]');
  if (backwardButton) {
    const result = await run(
      () => window.counter.allocateBackward(backwardButton.dataset.approveBackward, Number(backwardButton.dataset.units)),
      'Попередні вільні робочі дні зараховано з вашого дозволу.',
    );
    if (result) closeModal();
    return;
  }

  const setWorkdayButton = event.target.closest('[data-set-workday-override]');
  if (setWorkdayButton) {
    const result = await run(
      () => window.counter.setWorkdayOverride(setWorkdayButton.dataset.employeeId, setWorkdayButton.dataset.date),
      'Вихідний зроблено робочим днем.',
    );
    if (result) closeModal();
    return;
  }

  const clearWorkdayButton = event.target.closest('[data-clear-workday-override]');
  if (clearWorkdayButton) {
    if (!(await confirmAction('Повернути позначку «ВХ»? Установлений вручну статус цього дня буде очищено.', true))) return;
    const result = await run(
      () => window.counter.clearWorkdayOverride(clearWorkdayButton.dataset.employeeId, clearWorkdayButton.dataset.date),
      'День знову позначено календарним вихідним.',
    );
    if (result !== null) closeModal();
    return;
  }

  const openDutyDayButton = event.target.closest('[data-open-duty-day]');
  if (openDutyDayButton) return openDutyDayModal(openDutyDayButton.dataset.openDutyDay);

  const removeDutyButton = event.target.closest('[data-remove-duty-assignment]');
  if (removeDutyButton) {
    const realized = snapshot.duties.assignments[removeDutyButton.dataset.date]
      ?.realizedEmployeeIds?.includes(removeDutyButton.dataset.employeeId);
    if (realized && !(await confirmAction('Зняти вже виконане чергування? Це змінить підсумки.', true))) return;
    const result = await run(
      () => window.counter.removeDutyAssignment(removeDutyButton.dataset.employeeId, removeDutyButton.dataset.date),
      'Позначку чергування знято.',
    );
    if (result) closeModal();
    return;
  }

  const realizedDutyButton = event.target.closest('[data-set-duty-realized]');
  if (realizedDutyButton) {
    const result = await run(() => window.counter.setDutyRealized(realizedDutyButton.dataset.date,
      realizedDutyButton.dataset.employeeId, realizedDutyButton.dataset.realized === 'true'),
    'Стан виконання чергування змінено.');
    if (result) closeModal();
    return;
  }

  const dutyRestrictionButton = event.target.closest('[data-set-duty-restriction]');
  if (dutyRestrictionButton) {
    const note = modalRoot.querySelector('#duty-restriction-note')?.value || '';
    const {employeeId,date,setDutyRestriction:type}=dutyRestrictionButton.dataset;
    const presenceTypes={vacation:'vacation',sick:'sick',day_off:'day_off',personal:'personal_permission'};
    if(presenceTypes[type]){openPresenceForm({employeeId,date,status:presenceTypes[type],reason:note});return;}
    const affected = snapshot.duties.assignments[date]?.employeeIds.includes(employeeId) || type==='a'&&snapshot.duties.assignments[shiftDate(date,-1)]?.employeeIds.includes(employeeId)
      || snapshot.tasks.some(task=>LadPlanner.active(task)&&task.assigneeIds.includes(employeeId)&&task.dueDate===date);
    if (affected) { openStaffChange({kind:'restriction',employeeId,startDate:date,endDate:date,type,scheduleId:snapshot.activeDutyScheduleId,reason:note}); return; }
    const result = await run(
      () => window.counter.setDutyRestriction({
        employeeId: dutyRestrictionButton.dataset.employeeId,
        date: dutyRestrictionButton.dataset.date,
        type: dutyRestrictionButton.dataset.setDutyRestriction,
        note,
      }),
      'Обмеження для графіка збережено.',
    );
    if (result) closeModal();
    return;
  }

  const clearDutyRestrictionButton = event.target.closest('[data-clear-duty-restriction]');
  if (clearDutyRestrictionButton) {
    const result = await run(
      () => window.counter.clearDutyRestriction(clearDutyRestrictionButton.dataset.employeeId, clearDutyRestrictionButton.dataset.date),
      'Позначку графіка очищено.',
    );
    if (result !== null) closeModal();
    return;
  }

  const clearDutyDayButton = event.target.closest('[data-clear-duty-day]');
  if (clearDutyDayButton) {
    if (!(await confirmAction('Очистити склад чергових на цей день?', true))) return;
    const result = await run(
      () => window.counter.setDutyAssignment({ date: clearDutyDayButton.dataset.clearDutyDay, employeeIds: [], singleApproved: false }),
      'Склад чергових очищено.',
    );
    if (result) closeModal();
    return;
  }

  const statusButton = event.target.closest('[data-set-status]');
  if (statusButton) {
    const note = modalRoot.querySelector('#status-note')?.value || '';
    const { employeeId, date, setStatus:status } = statusButton.dataset;
    if (Object.hasOwn(STAFF_STATUSES,status)) { openPresenceForm({employeeId,date,status,reason:note}); return; }
    const result = await run(
      () => window.counter.setStatus({
        employeeId: statusButton.dataset.employeeId,
        date: statusButton.dataset.date,
        status: statusButton.dataset.setStatus,
        note,
      }),
      'Статус дня оновлено.',
    );
    if (result) closeModal();
    return;
  }

  const clearButton = event.target.closest('[data-clear-status]');
  if (clearButton) {
    const result = await run(
      () => window.counter.clearStatus(clearButton.dataset.employeeId, clearButton.dataset.date),
      'Статус очищено.',
    );
    if (result !== null) closeModal();
  }
});

modalRoot.addEventListener('submit', event => submitInterfaceForm(event, async () => {
  if (await handlePresenceSubmit(event)) return;
  if (await handleWorkSubmit(event)) return;
  if (await handleChangesSubmit(event)) return;
  if (await handleDrawSubmit(event)) return;
  if (['task-form','task-status-form','planner-filter-form','profile-range-form','weekly-range-form'].includes(event.target.id) && await handleManagementSubmit(event)) return;
  if (event.target.id === 'employee-rename-form') {
    const result = await run(() => window.counter.renameEmployee(event.target.dataset.employeeId,
      new FormData(event.target).get('name')), 'Ім’я працівника виправлено.');
    if (result) closeModal(event.target);
    return;
  }
  if (event.target.id === 'time-off-edit-form') {
    const form = new FormData(event.target);
    const result = await run(() => window.counter.updateTimeOffEntry(event.target.dataset.entryId, {
      employeeId: String(form.get('employeeId') || ''), date: String(form.get('date') || ''),
      startTime: String(form.get('startTime') || ''), endTime: String(form.get('endTime') || ''),
      destination: String(form.get('destination') || ''), note: String(form.get('note') || ''),
    }), 'Запис відлучення оновлено.');
    if (result) {
      ui.timeOffMonth = result.date.slice(0, 7);
      ui.timeOffFrom = `${ui.timeOffMonth}-01`;
      ui.timeOffTo = `${ui.timeOffMonth}-${String(daysInMonth(ui.timeOffMonth)).padStart(2, '0')}`;
      closeModal(event.target);
      renderShell();
    }
    return;
  }
  if (event.target.id === 'journal-batch-form') {
    const form = event.target;
    if (!form.dataset.previewToken || form.querySelector('[type="submit"]').disabled) return;
    const payload = { ...journalBatchInput(form), expectedToken: form.dataset.previewToken };
    form.querySelector('[type="submit"]').disabled = true;
    const result = await run(() => window.counter.applyJournalBatch(payload), null);
    if (result) {
      clearJournalSelection(); closeModal(event.target); renderShell();
      showToast(`Оновлено ${result.count} клітинок. Пропущено: ${result.skipped.length + result.blocked.length}.${result.duties?.length ? ' Відкрийте «Наслідки змін», щоб обрати підміни.' : ''}`, { undo: true });
    } else if (form.isConnected) invalidateJournalPreview(form);
    return;
  }
  if (event.target.id === 'receipt-correction-form') {
    const result = await run(() => window.counter.correctReceipt(event.target.dataset.receiptId,
      receiptFormInput(event.target)), 'Документ виправлено.');
    if (result && modalRoot.contains(event.target)) { closeModal(event.target); if (result.unallocatedCredit > 0) openFutureApproval(result); }
    return;
  }
  if (event.target.id === 'duty-copy-form') {
    const form = new FormData(event.target);
    const result = await run(
      () => window.counter.duplicateDutySchedule(
        event.target.dataset.scheduleId,
        String(form.get('name') || ''),
      ),
      'Копію графіка створено.',
    );
    if (result) {
      ui.dutyStats = null;
      ui.dutyFairness = null;
      closeModal(event.target);
    }
    return;
  }
  if (event.target.id === 'duty-rules-form') {
    const result = await run(
      () => window.counter.updateDutyScheduleRules(event.target.dataset.scheduleId, dutyRulesFormInput(event.target)),
      'Правила цього графіка збережено.',
    );
    if (result) closeModal(event.target);
    return;
  }
  if (event.target.id === 'duty-schedule-form') {
    const form = new FormData(event.target);
    const name = String(form.get('name') || '');
    const creating = event.target.dataset.mode === 'create';
    const result = await run(
      () => creating
        ? window.counter.createDutySchedule(name)
        : window.counter.renameDutySchedule(event.target.dataset.scheduleId, name),
      creating ? 'Новий графік створено.' : 'Назву графіка оновлено.',
    );
    if (result) {
      ui.dutyStats = null;
      closeModal(event.target);
    }
    return;
  }
  if (event.target.id === 'duty-history-form') {
    const result = await run(
      () => window.counter.initializeDuties(dutyHistoryEntries(event.target), dutyParticipantIds(event.target)),
      'Початкові підсумки чергувань оновлено.',
    );
    if (result) closeModal(event.target);
    return;
  }
  if (event.target.id === 'duty-day-form') {
    const form = new FormData(event.target);
    const result = await run(
      () => window.counter.setDutyAssignment({
        date: event.target.dataset.date,
        employeeIds: form.getAll('employeeIds').map(String),
        singleApproved: form.get('singleApproved') === 'on',
        note: String(form.get('note') || ''),
      }),
      'Склад чергових збережено.',
    );
    if (result) closeModal(event.target);
    return;
  }
  if (event.target.id !== 'submission-form') return;
  const payload = { ...receiptFormInput(event.target), employeeId: event.target.dataset.employeeId };
  const receipt = await run(() => window.counter.recordSubmission(payload), 'Запити зараховано.');
  if (!receipt || !modalRoot.contains(event.target)) return;
  closeModal(event.target);
  if (receipt.unallocatedCredit > 0) openFutureApproval(receipt);
}));

toastRoot.addEventListener('click', async (event) => {
  if (event.target.closest('[data-toast-dismiss]')) { event.target.closest('.toast')?.remove(); return; }
  const button = event.target.closest('[data-toast-undo]');
  if (!button || button.disabled) return;
  button.disabled = true;
  const result = await run(() => window.counter.undo(), 'Останню дію скасовано.', { undo: false });
  if (result) button.closest('.toast')?.remove(); else button.disabled = false;
});

window.counter.onChanged(async (nextSnapshot) => {
  snapshot = nextSnapshot;
  if (ui.tab === 'weekly') await loadWeeklySummary(ui.weeklyAnchor);
  if (ui.tab === 'analytics') await loadAnalytics(analyticsCurrentFilter(), { render: false });
  if (ui.tab === 'duties' && snapshot.duties?.initialized) {
    try {
      const year = ui.dutyMonth.slice(0, 4);
      [ui.dutyStats, ui.dutyFairness] = await Promise.all([
        window.counter.getDutyStats(year),
        window.counter.getDutyFairness({ startDate: `${year}-01-01`, endDate: `${year}-12-31` }),
      ]);
    } catch (error) {
      showToast(error.message || String(error), { error: true });
    }
  }
  renderShell({preserveDrafts:true});
});

window.addEventListener('resize', updateDutyScrollExtent);

window.addEventListener('keydown', async (event) => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
    if (event.key.toLowerCase() === 'k') { event.preventDefault(); if (!modalRoot.childElementCount) openQuickSearch(); return; }
    const index = event.key === '0' ? 9 : Number(event.key) - 1;
    if (Number.isInteger(index) && index >= 0 && index < NAV_ITEMS.length && !modalRoot.childElementCount && !event.target.closest('input, textarea, select, [contenteditable="true"]')) { event.preventDefault(); await navigateToTab(NAV_ITEMS[index][0]); return; }
  }
  if (event.key !== 'F11' || ui.mode === 'widget') return;
  event.preventDefault();
  const nextMode = ui.mode === 'fullscreen' ? 'dashboard' : 'fullscreen';
  if (await window.counter.setWindowMode(nextMode)) {
    ui.mode = nextMode;
    renderShell();
  }
});

window.counter.onWindowModeChanged((mode) => {
  if(!['widget','dashboard','fullscreen'].includes(mode))return;
  ui.mode=mode;
  widgetDialogExpanded=mode==='widget'&&Boolean(modalRoot.childElementCount);
  if(widgetDialogExpanded)queueWidgetWindowMode('dialog');
  renderShell({preserveDrafts:true});
});

window.counter.onOpenTask?.(async id => { closeModal(); await navigateToTab('planner'); openTaskModal(id); });

let lastPlannerMinute = Math.floor(Date.now() / 60000);
setInterval(() => {
  const minute = Math.floor(Date.now() / 60000);
  if (!snapshot || minute === lastPlannerMinute) return;
  lastPlannerMinute = minute;
  if (!modalRoot.childElementCount && !document.activeElement?.closest('input, textarea, select') && (ui.mode === 'widget' || ['today', 'planner'].includes(ui.tab))) renderShell();
}, 10000);

refresh({ analytics: false }).catch((error) => {
  appRoot.innerHTML = `<section class="window-shell"><div class="empty-widget"><h2>Не вдалося запустити програму</h2><p>${h(error.message || String(error))}</p></div></section>`;
});
