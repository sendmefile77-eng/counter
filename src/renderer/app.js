const STATUS_LABELS = {
  pending: 'Очікується',
  submitted: 'Подав вчасно',
  submitted_late: 'Подав із запізненням',
  submitted_advance: 'Зараховано наперед',
  missed: 'Не подав',
  other_tasks: 'Залучений до інших завдань',
  personal_permission: 'Відпущений в особистих справах',
  sick: 'Лікарняний',
  vacation: 'Відпустка',
  day_off: 'Відгул',
  holiday: 'Вихідний або святковий день',
  weekend: 'Календарний вихідний',
};

const STATUS_COLORS = {
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

let snapshot = null;
let resizeGesture = null;
let widgetDialogExpanded = false;
let widgetWindowTransition = Promise.resolve();
let ui = {
  mode: 'widget',
  tab: 'today',
  month: localDateKey().slice(0, 7),
  analyticsStart: `${localDateKey().slice(0, 7)}-01`,
  analyticsEnd: localDateKey(),
  analyticsEmployee: '',
  analytics: null,
  dutyMonth: localDateKey().slice(0, 7),
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
  return snapshot.duties?.rules || {
    weekdayDutyCount: 2,
    weekendDutyCount: 2,
    preventConsecutiveDays: true,
    preventConsecutiveWeekends: true,
    minimumRestDays: 2,
    maximumDutiesPerWeek: 0,
    compensateNextWeek: true,
    avoidRepeatedPairs: true,
    pairHistoryPeriod: 'year',
  };
}

function dutyRequiredCount(date) {
  const day = dateFromKey(date).getDay();
  return day === 0 || day === 6
    ? Number(dutyRules().weekendDutyCount || 2)
    : Number(dutyRules().weekdayDutyCount || 2);
}

function dutyWeekStart(date) {
  const value = dateFromKey(date);
  const day = value.getDay();
  value.setDate(value.getDate() + (day === 0 ? -6 : 1 - day));
  return localDateKey(value);
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
  return snapshot.records[`${employeeId}|${date}`] || null;
}

function statusFor(employeeId, date = localDateKey()) {
  return recordFor(employeeId, date)?.status || 'pending';
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

function confirmAction(message, always = false) {
  if (!always && snapshot?.settings?.confirmDestructiveActions === false) return true;
  return window.confirm(message);
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

function renderShell() {
  rememberScrollPositions();
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
      ${ui.mode === 'dashboard' ? `<header class="titlebar">
        <div class="brand-mark">Щ</div>
        <div class="title-copy">
          <strong>Щоденний облік</strong>
          <span>Локальні дані · ${settings.automaticClose === false ? 'автозакриття вимкнено' : `закриття о ${String(settings.closeHour ?? 18).padStart(2, '0')}:${String(settings.closeMinute ?? 0).padStart(2, '0')}`}</span>
        </div>
        <div class="title-spacer"></div>
        <div class="window-actions">
          <button class="icon-button" data-action="toggle-mode" title="${ui.mode === 'widget' ? 'Відкрити журнал' : 'Повернутися до віджета'}">${ui.mode === 'widget' ? '▦' : '◉'}</button>
          <button class="icon-button" data-action="minimize" title="Згорнути">—</button>
          <button class="icon-button danger" data-action="close" title="Закрити">×</button>
        </div>
      </header>` : ''}
      <main class="main-content">
        ${ui.mode === 'widget' ? renderWidget() : renderDashboard()}
      </main>
    </section>
  `;
  updateDutyScrollExtent();
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
  const sectors = employees.map((employee, index) => {
    const status = statusFor(employee.id, localDateKey());
    const sweep = 360 / employees.length;
    const labelPoint = polar(300, 300, employees.length > 11 ? 195 : 202, (index + 0.5) * sweep);
    const dotPoint = polar(300, 300, employees.length > 11 ? 232 : 238, (index + 0.5) * sweep);
    return `
      <g class="sector" data-employee-id="${h(employee.id)}" tabindex="0" role="button" aria-label="${h(employee.name)}: ${h(STATUS_LABELS[status])}">
        <title>${h(employee.name)} · ${h(STATUS_LABELS[status])}\nЛівий клік — зарахувати 1 запит. Правий — інші дії.</title>
        <path d="${annularSectorPath(index, employees.length)}" fill="${statusColor(status)}" opacity="0.91"></path>
        <circle class="status-dot" cx="${dotPoint.x}" cy="${dotPoint.y}" r="5" fill="${statusColor(status)}"></circle>
        <text x="${labelPoint.x}" y="${labelPoint.y}" text-anchor="middle" dominant-baseline="central">${h(shortName(employee.name))}</text>
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
  const employees = activeEmployees();
  const statuses = employees.map((employee) => statusFor(employee.id));
  const submitted = statuses.filter((status) => SUBMITTED_STATUSES.has(status)).length;
  return `
    <section class="widget-view">
      <div class="widget-circle">
        <div class="radial-wrap">
          ${employees.length ? renderRadial(employees) : `
            <div class="empty-widget">
              <h2>Немає працівників</h2>
              <p>Відкрийте журнал і додайте до 15 людей.</p>
              <button class="button primary small" data-action="open-employees">Додати</button>
            </div>
          `}
        </div>
        ${employees.length ? `
          <div class="widget-center" data-widget-drag title="Перетягніть, щоб перемістити">
            <span>${h(formatDate(localDateKey(), { day: 'numeric', month: 'long' }))}</span>
            <strong>${submitted}/${employees.length}</strong>
            <small>подали запит</small>
          </div>
        ` : ''}
        <div class="widget-controls">
          <button data-action="resize-decrease" title="Зменшити">−</button>
          <button data-action="resize-increase" title="Збільшити">+</button>
          <button data-action="undo" title="Скасувати останнє">↶</button>
          <button data-action="toggle-mode" title="Відкрити журнал">▦</button>
          <button data-action="close" title="Закрити">×</button>
        </div>
        <div class="widget-resize-handle" data-widget-resize title="Потягніть, щоб змінити розмір">⌟</div>
      </div>
    </section>
  `;
}

const NAV_ICONS = {
  today: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"></circle><path d="m9.4 12 1.7 1.8 3.8-4"></path></svg>',
  journal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14" rx="2"></rect><path d="M8 3.5v4M16 3.5v4M4 9.5h16M8 13h3M13 13h3M8 16h3"></path></svg>',
  duties: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="9" r="3"></circle><path d="M3.8 19c.5-3.2 2.2-5 5.2-5s4.7 1.8 5.2 5M15.8 7.3a3 3 0 0 1 0 5.4M16.4 14.4c2.1.5 3.3 2 3.8 4.6"></path></svg>',
  timeoff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h10V4H4zM14 7h3.5A2.5 2.5 0 0 1 20 9.5V20h-6M8 12h9M14 9l3 3-3 3"></path></svg>',
  analytics: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5h16M6.5 17V11M11 17V6M15.5 17v-4M20 17V8.5"></path></svg>',
  employees: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"></circle><circle cx="17" cy="10" r="2.5"></circle><path d="M3.5 19c.5-3.5 2.3-5.5 5.5-5.5s5 2 5.5 5.5M14.8 14.5c3.2-.7 5.2.8 5.7 4.5"></path></svg>',
  data: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9M9 4v6M15 14v6"></path></svg>',
  help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><path d="M9.8 9.5a2.5 2.5 0 1 1 3.7 2.2c-1 .6-1.5 1.1-1.5 2.3M12 17h.01"></path></svg>',
};

function renderDashboard() {
  const nav = [
    ['today', 'Сьогодні'],
    ['journal', 'Табель'],
    ['duties', 'Чергування'],
    ['timeoff', 'Відпросився'],
    ['analytics', 'Аналітика'],
    ['employees', 'Працівники'],
    ['data', 'Налаштування'],
    ['help', 'Довідка'],
  ];
  return `
    <div class="dashboard-layout">
      <aside class="sidebar">
        <div class="sidebar-caption">Робочий простір</div>
        ${nav.map(([id, label]) => `
          <button class="nav-button ${ui.tab === id ? 'active' : ''}" data-tab="${id}" title="${label}">
            <span class="nav-icon">${NAV_ICONS[id]}</span>
            <span class="nav-label">${label}</span>
          </button>
        `).join('')}
        <div class="sidebar-spacer"></div>
        <div class="sidebar-note">
          <strong><i></i> Локальний режим</strong>
          <span>Дані зберігаються лише на цьому комп’ютері.</span>
        </div>
      </aside>
      <section class="dashboard-content">
        <div class="page-view">${renderActivePage()}</div>
      </section>
    </div>
  `;
}

function renderActivePage() {
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
  const employees = activeEmployees();
  return `
    <div class="page-header">
      <div>
        <h1>Сьогодні, ${h(formatDate(localDateKey(), { day: 'numeric', month: 'long' }))}</h1>
        <p>${snapshot.settings.automaticClose ? `Незаповнені робочі дні автоматично закриваються о ${closeTimeText()}.` : 'Автоматичне закриття робочого дня вимкнено.'}</p>
      </div>
      <button class="button" data-action="open-employees">Керувати працівниками</button>
    </div>
    ${employees.length ? `
      <div class="cards-grid">
        ${employees.map((employee) => {
          const status = statusFor(employee.id);
          return `
            <article class="employee-card">
              <div class="employee-card-head">
                <h3>${h(employee.name)}</h3>
                ${statusBadge(status)}
              </div>
              <button class="button success" data-submit-one="${h(employee.id)}">+ Зарахувати 1 запит</button>
              <div class="button-row">
                <button class="button small" data-submission-modal="${h(employee.id)}">Кілька / складний</button>
                <button class="button small ghost" data-status-modal="${h(employee.id)}" data-date="${localDateKey()}">Інший статус</button>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    ` : `
      <div class="panel">
        <h2>Список порожній</h2>
        <p class="panel-copy">Спочатку додайте хоча б одного працівника.</p>
        <button class="button primary" data-action="open-employees">Додати працівника</button>
      </div>
    `}
  `;
}

function renderJournalPage() {
  const count = daysInMonth(ui.month);
  const dates = Array.from({ length: count }, (_, index) => `${ui.month}-${String(index + 1).padStart(2, '0')}`);
  const employees = activeEmployees();
  return `
    <div class="page-header">
      <div>
        <h1>Табель виконання</h1>
        <p>Клікніть клітинку, щоб встановити або переглянути статус дня.</p>
      </div>
    </div>
    <div class="table-toolbar">
      <button class="button small" data-month-shift="-1">← Попередній</button>
      <div class="month-title">${h(formatMonth(ui.month))}</div>
      <button class="button small" data-month-shift="1">Наступний →</button>
    </div>
    <div class="table-scroll">
      <table class="matrix">
        <thead>
          <tr>
            <th class="sticky-name">Працівник</th>
            ${dates.map((date) => {
              const day = dateFromKey(date).getDay();
              return `<th class="${date === localDateKey() ? 'is-today ' : ''}${!configuredWorkday(date) ? 'weekend' : ''}" title="${h(formatDate(date))}">${Number(date.slice(-2))}</th>`;
            }).join('')}
          </tr>
        </thead>
        <tbody>
          ${employees.map((employee) => `
            <tr>
              <td class="sticky-name" title="${h(employee.name)}">${h(shortName(employee.name))}</td>
              ${dates.map((date) => {
                const day = dateFromKey(date).getDay();
                const outsideEmployment = !employeeActiveOnDate(employee, date);
                const weekend = !configuredWorkday(date);
                const workdayOverride = hasWorkdayOverride(employee.id, date);
                const todayClass = date === localDateKey() ? ' is-today' : '';
                if (weekend && !workdayOverride) {
                  return `<td class="matrix-cell cell-weekend${outsideEmployment ? ' cell-history' : ''}${todayClass}" data-cell-employee="${h(employee.id)}" data-date="${date}" title="${h(formatDate(date))} · календарний вихідний · клікніть, щоб зробити робочим">ВХ</td>`;
                }
                const status = statusFor(employee.id, date);
                const record = recordFor(employee.id, date);
                const tooltip = `${employee.name}\n${formatDate(date)}${outsideEmployment ? '\nІсторична дата — можна заповнити вручну' : ''}${workdayOverride ? '\nРобочий день замість вихідного' : ''}\n${STATUS_LABELS[status]}${record?.documentRef ? `\n${record.documentRef}` : ''}${record?.note ? `\n${record.note}` : ''}`;
                const symbol = workdayOverride && status === 'pending' ? 'РД' : STATUS_SYMBOLS[status];
                const overrideClass = `${workdayOverride && status === 'pending' ? ' cell-workday-override' : ''}${outsideEmployment ? ' cell-history' : ''}`;
                return `<td class="matrix-cell cell-${status}${overrideClass}${todayClass}" data-cell-employee="${h(employee.id)}" data-date="${date}" title="${h(tooltip)}">${symbol}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
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
        <button class="button small" data-copy-duty-schedule>Створити копію</button>
        <button class="button small" data-duty-rules>Правила</button>
        <button class="button small" data-rename-duty-schedule>Перейменувати</button>
        <button class="button small danger" data-delete-duty-schedule ${schedules.length <= 1 ? 'disabled' : ''}>Видалити</button>
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
        <div class="confirm-box">Ці числа стануть початковими значеннями колонок Σ і Р. Ручне заповнення старого календаря не додасть їх повторно; нові дежурства з наступного тижня збільшуватимуть підсумки автоматично.</div>
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
  return `
    <div class="page-header">
      <div>
        <h1>Графік «${h(activeDutySchedule().name)}»</h1>
        <p>Будні — ${dutyRules().weekdayDutyCount}, вихідні — ${dutyRules().weekendDutyCount} чергових. Решта обмежень задається окремо для цього графіка.</p>
      </div>
      <button class="button" data-duty-history>Учасники й підсумки</button>
    </div>
    ${scheduleToolbar}
    <div class="metrics-grid duty-metrics">
      <div class="metric-card"><strong>${minTotal}–${maxTotal}</strong><span>діапазон за ${dutyYear} рік</span></div>
      <div class="metric-card"><strong>${totals.reduce((sum, value) => sum + value, 0)}</strong><span>чергувань за ${dutyYear} рік</span></div>
      <div class="metric-card"><strong>${participants.reduce((sum, employee) => sum + (stats.get(employee.id)?.realized || 0), 0)}</strong><span>реалізованих за рік</span></div>
    </div>
    <div class="table-toolbar">
      <button class="button small" data-duty-month-shift="-1">← Попередній</button>
      <div class="month-title">${h(formatMonth(ui.dutyMonth))}</div>
      <button class="button small" data-duty-month-shift="1">Наступний →</button>
      <button class="button primary small" data-generate-duties>Переглянути наступний тиждень</button>
    </div>
    <p class="duty-help">Лівий клік по колу: порожньо → чергування → реалізоване чергування → порожньо. Правий клік — «А», відсутність або жовта заборона планування. Червона колонка означає нестачу чергового: натисніть її, щоб додати другого або дозволити одного.</p>
    <div class="duty-legend">
      <span><b class="legend-duty">1</b> чергування</span><span><b class="legend-realized">1</b> реалізоване</span><span><b class="legend-a">А</b> залучення</span><span><b class="legend-planning-block">—</b> не планувати</span><span><b>В/ВП/ЛК/ВГ</b> відсутність</span>
    </div>
    <div class="table-scroll" data-scroll-key="duty-matrix">
      <table class="matrix duty-matrix">
        <thead><tr>
          <th class="sticky-name">Працівник</th><th>Σ</th><th>Р</th>
          ${dates.map((date) => {
            const day = dateFromKey(date).getDay();
            const assignment = snapshot.duties.assignments[date];
            const incomplete = assignment
              && (assignment.employeeIds?.length || 0) < dutyRequiredCount(date)
              && !assignment.singleApproved;
            const locked = dutyWeekLocked(date);
            return `<th class="${date === localDateKey() ? 'is-today ' : ''}${day === 0 || day === 6 ? 'weekend ' : ''}${incomplete ? 'duty-day-incomplete ' : ''}${locked ? 'duty-day-locked' : ''}"><button data-duty-day="${date}" title="${locked ? 'Тиждень заблоковано · ' : ''}Налаштувати склад на ${h(formatDate(date))}"><strong>${Number(date.slice(-2))}</strong><small>${locked ? '🔒' : WEEKDAY_SHORT[day]}</small></button></th>`;
          }).join('')}<th class="duty-scroll-tail" aria-hidden="true"></th>
        </tr></thead>
        <tbody>${participants.map((employee, employeeIndex) => {
          const rowStats = stats.get(employee.id) || { total: 0, realized: 0 };
          const rowColor = DUTY_ROW_COLORS[employeeIndex % DUTY_ROW_COLORS.length];
          return `<tr style="--employee-row-rgb:${rowColor}">
            <td class="sticky-name" title="${h(employee.name)}"><span class="employee-name-content"><i class="employee-row-marker" aria-hidden="true"></i>${h(shortName(employee.name))}</span></td>
            <td class="duty-total">${rowStats.total}</td><td class="duty-total duty-realized-total">${rowStats.realized}</td>
            ${dates.map((date) => {
              const cell = dutyCell(employee, date);
              const incompleteClass = incompleteDateSet.has(date) ? ' duty-column-incomplete' : '';
              const lockedClass = dutyWeekLocked(date) ? ' duty-cell-locked' : '';
              const todayClass = date === localDateKey() ? ' is-today' : '';
              return `<td class="matrix-cell ${cell.className}${incompleteClass}${lockedClass}${todayClass}" data-duty-cell data-employee-id="${h(employee.id)}" data-date="${date}" title="${h(employee.name)} · ${h(formatDate(date))} · ${h(cell.title)}${dutyWeekLocked(date) ? ' · тиждень заблоковано' : ''}">${cell.symbol}</td>`;
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
        <h1>Відпросився</h1>
        <p>Окремий журнал коротких відлучень: коли, куди та на скільки відпускали працівника.</p>
      </div>
    </div>
    <div class="confirm-box time-off-notice">Цей журнал не змінює табель, колір віджета, норму запитів або кількість відпрацьованих днів. Повноденну відсутність, як і раніше, позначайте в табелі.</div>
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
            return `<tr><td>${h(formatDate(entry.date, { day: 'numeric', month: 'short', year: 'numeric' }))}</td><td>${h(employee?.name || 'Видалений працівник')}</td><td>${h(entry.startTime)}–${h(entry.endTime)}</td><td>${h(formatDuration(entry.durationMinutes))}</td><td>${h(entry.destination)}</td><td>${h(entry.note || '—')}</td><td><button class="button small danger" data-delete-time-off="${h(entry.id)}" title="Видалити запис">Видалити</button></td></tr>`;
          }).join('') || '<tr><td colspan="7" class="muted">За обраним фільтром записів немає.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAnalyticsPage() {
  const analytics = ui.analytics;
  return `
    <div class="page-header">
      <div>
        <h1>Статистика й аналітика</h1>
        <p>Фактичні запити та зараховані ними робочі дні рахуються окремо.</p>
      </div>
    </div>
    <form id="analytics-form" class="panel">
      <div class="form-grid">
        <label class="field">
          <span>Працівник</span>
          <select name="employeeId">
            <option value="">Усі працівники</option>
            ${snapshot.employees.map((employee) => `<option value="${h(employee.id)}" ${ui.analyticsEmployee === employee.id ? 'selected' : ''}>${h(employee.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Від дати</span><input type="date" name="startDate" value="${ui.analyticsStart}" required></label>
        <label class="field"><span>До дати</span><input type="date" name="endDate" value="${ui.analyticsEnd}" required></label>
        <div class="field"><span>&nbsp;</span><button class="button primary" type="submit">Сформувати</button></div>
      </div>
    </form>
    ${analytics ? renderAnalyticsResult(analytics) : `<div class="panel"><p class="panel-copy">Натисніть «Сформувати», щоб отримати розрахунок.</p></div>`}
  `;
}

function renderAnalyticsResult(analytics) {
  const total = analytics.total;
  const filteredReceipts = snapshot.receipts
    .filter((receipt) => receipt.receivedDate >= analytics.startDate && receipt.receivedDate <= analytics.endDate)
    .filter((receipt) => !analytics.employeeId || receipt.employeeId === analytics.employeeId)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return `
    <div class="metrics-grid">
      <div class="metric-card"><strong>${total.workedDays || 0}</strong><span>відпрацьованих днів</span></div>
      <div class="metric-card"><strong>${total.actualRequestsReceived || 0}</strong><span>фактичних запитів</span></div>
      <div class="metric-card"><strong>${total.requestDays || 0}</strong><span>днів закрито запитами</span></div>
      <div class="metric-card"><strong>${total.missed || 0}</strong><span>незакритих пропусків</span></div>
      <div class="metric-card"><strong>${total.completionPercent || 0}%</strong><span>виконання норми</span></div>
    </div>
    <section class="panel">
      <h2>Письмова аналітика</h2>
      <div class="analytics-text">
        ${analytics.rows.map((row) => `
          <div class="analytics-line">
            <strong>${h(row.name)}.</strong>
            За обраний період: ${row.calendarWorkdays} робочих днів, відпрацьовано ${row.workedDays}.
            Отримано ${row.actualRequestsReceived} фактичних запитів у ${row.documentsReceived} документах; ними закрито ${row.requestDays} днів.
            Вчасно — ${row.submittedOnTime}, із запізненням — ${row.submittedLate}, наперед за дозволом — ${row.submittedAdvance}.
            Інші завдання — ${row.otherTasks}, особисті справи — ${row.personalPermission}, незакриті пропуски — ${row.missed}, очікується сьогодні — ${row.pending}.
            Складних запитів із вагою у два дні — ${row.complexRequests}. Виконання норми — ${row.completionPercent}%.
          </div>
        `).join('') || '<p class="muted">Немає даних за обраний період.</p>'}
      </div>
    </section>
    <section class="panel">
      <h2>Показники за працівниками</h2>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Працівник</th><th>Робочі дні</th><th>Відпрацьовано</th><th>Запити</th><th>Закрито днів</th><th>Не подав</th><th>Інші завдання</th><th>Особисті справи</th><th>Виконання</th></tr></thead>
          <tbody>
            ${analytics.rows.map((row) => `<tr><td>${h(row.name)}</td><td>${row.calendarWorkdays}</td><td>${row.workedDays}</td><td>${row.actualRequestsReceived}</td><td>${row.requestDays}</td><td>${row.missed}</td><td>${row.otherTasks}</td><td>${row.personalPermission}</td><td>${row.completionPercent}%</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>
    <section class="panel">
      <h2>Аналітика документів і запитів</h2>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Дата</th><th>Працівник</th><th>Документ</th><th>Фактичні запити</th><th>Складний</th><th>Зараховано днів</th><th>Дати зарахування</th><th>Залишок</th></tr></thead>
          <tbody>
            ${filteredReceipts.map((receipt) => {
              const employee = employeeById(receipt.employeeId);
              return `<tr><td>${receipt.receivedDate}</td><td>${h(employee?.name || '—')}</td><td>${h(receipt.documentRef || '—')}</td><td>${receipt.actualRequestCount}</td><td>${receipt.complexTwoDay ? 'Так, 2 дні' : 'Ні'}</td><td>${receipt.allocations.length}</td><td>${h(receipt.allocations.map((item) => item.date).join(', ') || '—')}</td><td>${receipt.unallocatedCredit}${receipt.unallocatedCredit ? `<br><button class="button small" data-allocate-receipt="${h(receipt.id)}">Розподілити</button>` : ''}</td></tr>`;
            }).join('') || '<tr><td colspan="8">За обраний період документів немає.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderEmployeesPage() {
  const active = activeEmployees();
  const archived = snapshot.employees.filter((employee) => !employee.active);
  return `
    <div class="page-header">
      <div><h1>Працівники</h1><p>У круглому віджеті може бути до 15 активних секторів.</p></div>
      <span class="status-badge" data-status="submitted">${active.length}/15 активних</span>
    </div>
    <form id="employee-form" class="panel">
      <div class="form-grid">
        <label class="field"><span>ПІБ або коротке ім’я</span><input name="name" maxlength="80" autocomplete="off" placeholder="Наприклад, Іваненко О. В." required></label>
        <div class="field"><span>&nbsp;</span><button class="button primary" type="submit">Додати працівника</button></div>
      </div>
    </form>
    <section class="panel">
      <h2>Активні</h2>
      <div class="employee-list">
        ${active.map((employee) => `<div class="employee-row"><div><strong>${h(employee.name)}</strong><small>У віджеті з ${h(formatDate(employee.createdDate))}</small></div><button class="button small danger" data-archive-employee="${h(employee.id)}">Прибрати</button></div>`).join('') || '<p class="muted">Активних працівників немає.</p>'}
      </div>
    </section>
    ${archived.length && snapshot.settings.showArchivedEmployees ? `
      <section class="panel">
        <h2>Архів</h2>
        <div class="employee-list">
          ${archived.map((employee) => `<div class="employee-row"><div><strong>${h(employee.name)}</strong><small>Історію збережено</small></div><button class="button small" data-restore-employee="${h(employee.id)}">Повернути</button></div>`).join('')}
        </div>
      </section>
    ` : ''}
  `;
}

function renderDataPage() {
  const settings = snapshot.settings;
  const weekdays = [
    [1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Нд'],
  ];
  const colorLabels = {
    pending: 'Очікується', submitted: 'Подав', submitted_late: 'Із запізненням',
    submitted_advance: 'Наперед', missed: 'Не подав', other_tasks: 'Інші завдання',
    personal_permission: 'Особисті справи', sick: 'Лікарняний', vacation: 'Відпустка',
    day_off: 'Відгул', holiday: 'Свято / вихідний',
  };
  return `
    <div class="page-header">
      <div><h1>Налаштування</h1><p>Параметри програми. Позначення та пояснення винесено в окрему «Довідку».</p></div>
    </div>
    <form id="settings-form">
      <section class="panel">
        <h2>Час і робочі дні</h2>
        <div class="form-grid">
          <label class="field"><span>Час автоматичного закриття</span><input name="closeTime" type="time" value="${String(settings.closeHour).padStart(2, '0')}:${String(settings.closeMinute).padStart(2, '0')}" required></label>
          <label class="field"><span>Формат дати</span><select name="dateStyle"><option value="long" ${settings.dateStyle === 'long' ? 'selected' : ''}>24 серпня 2026</option><option value="short" ${settings.dateStyle === 'short' ? 'selected' : ''}>24 серп. 2026</option><option value="numeric" ${settings.dateStyle === 'numeric' ? 'selected' : ''}>24.08.2026</option></select></label>
        </div>
        <label class="check-row"><input name="automaticClose" type="checkbox" ${settings.automaticClose ? 'checked' : ''}><span><strong>Автоматично позначати пропуск</strong><span>Після заданого часу незаповнений робочий день стає червоним.</span></span></label>
        <div class="weekday-settings">${weekdays.map(([value, label]) => `<label><input type="checkbox" name="workdays" value="${value}" ${settings.workdays.includes(value) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>
      </section>
      <section class="panel">
        <h2>Віджет і таблиця</h2>
        <div class="settings-grid">
          <label class="check-row"><input name="alwaysOnTop" type="checkbox" ${settings.alwaysOnTop ? 'checked' : ''}><span><strong>Завжди поверх інших вікон</strong><span>Круглий віджет не ховається за програмами.</span></span></label>
          <label class="check-row"><input name="confirmDestructiveActions" type="checkbox" ${settings.confirmDestructiveActions ? 'checked' : ''}><span><strong>Підтверджувати небезпечні дії</strong><span>Видалення графіків, записів та імпорт бази потребують підтвердження.</span></span></label>
          <label class="check-row"><input name="showArchivedEmployees" type="checkbox" ${settings.showArchivedEmployees ? 'checked' : ''}><span><strong>Показувати архів працівників</strong><span>Архів залишається доступним на сторінці працівників.</span></span></label>
        </div>
        <div class="form-grid settings-number-grid">
          <label class="field"><span>Ширина колонки імен, px</span><input name="dutyNameWidth" type="number" min="130" max="320" value="${settings.dutyNameWidth}" required></label>
          <label class="field"><span>Висота рядка графіка, px</span><input name="dutyRowHeight" type="number" min="34" max="72" value="${settings.dutyRowHeight}" required></label>
          <label class="field"><span>Товщина кольорової лінії</span><select name="dutyLineStrength"><option value="1" ${settings.dutyLineStrength === 1 ? 'selected' : ''}>Тонка</option><option value="2" ${settings.dutyLineStrength === 2 ? 'selected' : ''}>Середня</option><option value="3" ${settings.dutyLineStrength === 3 ? 'selected' : ''}>Помітна</option></select></label>
          <label class="field"><span>Кількість щоденних копій</span><input name="backupRetention" type="number" min="1" max="30" value="${settings.backupRetention}" required></label>
        </div>
      </section>
      <section class="panel">
        <h2>Кольори статусів</h2>
        <div class="color-settings">${Object.entries(colorLabels).map(([key, label]) => `<label><input type="color" name="color-${key}" value="${h(settings.statusColors[key])}"><span>${h(label)}</span></label>`).join('')}</div>
      </section>
      <div class="form-actions settings-save-actions"><button class="button" type="button" data-reset-settings>Відновити стандартні</button><button class="button primary" type="submit">Зберегти налаштування</button></div>
    </form>
    <section class="panel">
      <h2>Резервні копії</h2>
      <p class="panel-copy settings-privacy">Програма не передає дані в інтернет. Усі записи зберігаються поруч із застосунком.</p>
      <div class="data-actions">
        <div class="data-action"><h3>Резервна копія JSON</h3><p>Повна база: працівники, документи, статуси, усі графіки, відлучення та журнал змін.</p><button class="button primary" data-export="json">Зберегти копію</button></div>
        <div class="data-action"><h3>Таблиця CSV</h3><p>Плоска таблиця для відкриття в Excel або іншій програмі.</p><button class="button" data-export="csv">Експортувати таблицю</button></div>
        <div class="data-action"><h3>Відновлення</h3><p>Імпорт повної резервної копії JSON з іншого комп’ютера.</p><button class="button danger" data-action="import-data">Імпортувати копію</button></div>
      </div>
      <p class="panel-copy data-file-path"><strong>Локальний файл:</strong> ${h(snapshot.dataFilePath || 'системний каталог програми')}</p>
    </section>
    <section class="panel danger-zone">
      <div>
        <h2>Повне очищення</h2>
        <p class="panel-copy">Видаляє всіх працівників, табель, документи, усі графіки чергувань, журнал «Відпросився», обмеження, підсумки та внутрішню резервну копію. Застосунок повернеться до першого запуску.</p>
      </div>
      <button class="button danger" data-action="reset-all-data">Обнулити всі дані</button>
    </section>
  `;
}

function renderHelpPage() {
  const settings = snapshot.settings;
  const closeTime = `${String(settings.closeHour).padStart(2, '0')}:${String(settings.closeMinute).padStart(2, '0')}`;
  return `
    <div class="page-header"><div><h1>Довідка та позначення</h1><p>Пояснення роботи програми без зміни її параметрів.</p></div></div>
    <section class="panel rules-panel">
      <div class="rules-grid">
        <article class="rule-card"><div class="rule-time">00:00</div><div><strong>Новий день</strong><p>Віджет переходить до поточної дати; попередня історія зберігається.</p></div></article>
        <article class="rule-card"><div class="rule-time danger">${closeTime}</div><div><strong>Автоматичне закриття</strong><p>${settings.automaticClose ? 'Незаповнений робочий день стає червоним.' : 'Зараз вимкнено в налаштуваннях.'}</p></div></article>
        <article class="rule-card"><div class="rule-icon">↶</div><div><strong>Додаткові одиниці</strong><p>Закривають найближчі попередні пропуски; наперед — лише після дозволу.</p></div></article>
        <article class="rule-card"><div class="rule-icon">◫</div><div><strong>Окремі графіки</strong><p>Кожен має власні правила, учасників, історію, блокування та підсумки.</p></div></article>
      </div>
      <h3 class="rules-subtitle">Кольори щоденного обліку</h3>
      <div class="legend-grid">${Object.entries(STATUS_LABELS).filter(([key]) => key !== 'weekend').map(([key, label]) => `<div class="legend-item"><span class="legend-swatch" style="background:${h(statusColor(key))}"></span><span><strong>${h(label)}</strong><small>${key === 'missed' ? 'Незаповнений день після часу закриття' : key === 'other_tasks' ? 'Зараховується як відпрацьований день' : 'Статус щоденного обліку'}</small></span></div>`).join('')}</div>
      <h3 class="rules-subtitle">Позначення чергувань</h3>
      <div class="legend-grid duty-legend-grid">
        <div class="legend-item"><span class="legend-duty duty"></span><span><strong>Синя «1»</strong><small>Призначене чергування</small></span></div>
        <div class="legend-item"><span class="legend-duty realized"></span><span><strong>Зелена «1»</strong><small>Реалізоване чергування</small></span></div>
        <div class="legend-item"><span class="legend-duty a-mark"></span><span><strong>«А»</strong><small>Залучення; після чергування наступного дня не ставиться</small></span></div>
        <div class="legend-item"><span class="legend-duty planning">—</span><span><strong>Не планувати</strong><small>Жовта заборона без впливу на статистику</small></span></div>
        <div class="legend-item"><span class="legend-duty unavailable">ВП</span><span><strong>Відсутність</strong><small>Працівник не бере участі в розподілі</small></span></div>
        <div class="legend-item"><span class="legend-duty unavailable">🔒</span><span><strong>Заблокований тиждень</strong><small>Зміни дозволені лише після розблокування</small></span></div>
      </div>
      <div class="workday-note"><strong>До відпрацьованих днів входять:</strong> дні, закриті запитами, та «Інші завдання». Особисті справи, лікарняний, відпустка, відгул, свято, вихідний і пропуск не зараховуються.</div>
    </section>
  `;
}

function queueWidgetWindowMode(mode) {
  widgetWindowTransition = widgetWindowTransition
    .catch(() => null)
    .then(() => window.counter.setWindowMode(mode))
    .catch((error) => showToast(error.message || String(error), { error: true }));
}

function openModal(content, wide = false) {
  modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-close><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${content}</section></div>`;
  if (ui.mode === 'widget' && !widgetDialogExpanded) {
    widgetDialogExpanded = true;
    queueWidgetWindowMode('dialog');
  }
}

function closeModal() {
  modalRoot.innerHTML = '';
  if (widgetDialogExpanded) {
    widgetDialogExpanded = false;
    queueWidgetWindowMode('widget');
  }
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

function openDutyRulesModal() {
  const schedule = activeDutySchedule();
  const rules = dutyRules();
  openModal(`
    <form id="duty-rules-form" data-schedule-id="${h(schedule.id)}">
      <header class="modal-head"><div><h2>Правила графіка</h2><p>${h(schedule.name)} · зміни не перераховують старі тижні</p></div><button class="icon-button" type="button" data-close-modal>×</button></header>
      <div class="modal-body duty-rules-form">
        <div class="form-grid">
          <label class="field"><span>Чергових у будні</span><select name="weekdayDutyCount"><option value="2" ${rules.weekdayDutyCount === 2 ? 'selected' : ''}>2</option><option value="1" ${rules.weekdayDutyCount === 1 ? 'selected' : ''}>1</option></select></label>
          <label class="field"><span>Чергових у вихідні</span><select name="weekendDutyCount"><option value="2" ${rules.weekendDutyCount === 2 ? 'selected' : ''}>2</option><option value="1" ${rules.weekendDutyCount === 1 ? 'selected' : ''}>1</option></select></label>
          <label class="field"><span>Мінімум повних днів відпочинку</span><input name="minimumRestDays" type="number" min="0" max="6" value="${rules.minimumRestDays}" required></label>
          <label class="field"><span>Максимум чергувань за тиждень</span><select name="maximumDutiesPerWeek"><option value="0" ${rules.maximumDutiesPerWeek === 0 ? 'selected' : ''}>Автоматично</option>${[1, 2, 3, 4, 5, 6, 7].map((value) => `<option value="${value}" ${rules.maximumDutiesPerWeek === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
          <label class="field"><span>Історія пар</span><select name="pairHistoryPeriod"><option value="month" ${rules.pairHistoryPeriod === 'month' ? 'selected' : ''}>Поточний місяць</option><option value="quarter" ${rules.pairHistoryPeriod === 'quarter' ? 'selected' : ''}>Поточний квартал</option><option value="year" ${rules.pairHistoryPeriod === 'year' ? 'selected' : ''}>Поточний рік</option></select></label>
        </div>
        <div class="settings-grid">
          <label class="check-row"><input name="preventConsecutiveDays" type="checkbox" ${rules.preventConsecutiveDays ? 'checked' : ''}><span><strong>Заборонити два дні поспіль</strong><span>Жорстке правило, крім разового винятку.</span></span></label>
          <label class="check-row"><input name="preventConsecutiveWeekends" type="checkbox" ${rules.preventConsecutiveWeekends ? 'checked' : ''}><span><strong>Заборонити сусідні уікенди</strong><span>Хто чергував у суботу або неділю, пропускає наступний уікенд.</span></span></label>
          <label class="check-row"><input name="compensateNextWeek" type="checkbox" ${rules.compensateNextWeek ? 'checked' : ''}><span><strong>Компенсувати наступного тижня</strong><span>Одне чергування дає пріоритет на два наступного тижня.</span></span></label>
          <label class="check-row"><input name="avoidRepeatedPairs" type="checkbox" ${rules.avoidRepeatedPairs ? 'checked' : ''}><span><strong>Уникати повторення пар</strong><span>Однакові поєднання використовуються в останню чергу.</span></span></label>
        </div>
        <div class="confirm-box">Якщо жорсткі правила не дозволяють знайти потрібну кількість людей, місце залишається порожнім, а колонка дня стає червоною.</div>
      </div>
      <footer class="modal-foot"><button class="button" type="button" data-close-modal>Скасувати</button><button class="button primary" type="submit">Зберегти правила</button></footer>
    </form>
  `, true);
}

function renderDutyExplanation(explanation) {
  if (!explanation) return '<p class="muted">Цей склад внесено вручну; автоматичного пояснення немає.</p>';
  return `
    <div class="duty-explanation">
      ${explanation.selected?.map((item) => `<article><strong>${h(employeeById(item.employeeId)?.name || '—')}</strong><ul>${item.reasons.map((reason) => `<li>${h(reason)}</li>`).join('')}</ul></article>`).join('') || '<p class="muted">Чергових не призначено.</p>'}
      ${explanation.notSelected?.length ? `<details><summary>Чому не обрано інших</summary>${explanation.notSelected.map((item) => `<div class="explanation-rejected"><strong>${h(employeeById(item.employeeId)?.name || '—')}</strong>: ${h(item.reasons.join('; '))}</div>`).join('')}</details>` : ''}
    </div>
  `;
}

async function openDutyPreviewModal(startDate, endDate) {
  try {
    const preview = await window.counter.previewDuties({ startDate, endDate });
    openModal(`
      <header class="modal-head"><div><h2>Попередній перегляд графіка</h2><p>${h(formatDate(startDate))} — ${h(formatDate(endDate))}</p></div><button class="icon-button" type="button" data-close-modal>×</button></header>
      <div class="modal-body">
        <div class="preview-summary"><span>Різниця навантаження: <strong>${preview.fairness.spread}</strong></span><span>Повторених пар: <strong>${preview.fairness.repeatedPairCount}</strong></span><span>Дефіцитних днів: <strong>${preview.shortages.length}</strong></span></div>
        <div class="preview-days">${preview.assignments.map((assignment) => `<article class="preview-day ${assignment.employeeIds.length < assignment.requiredCount && !assignment.singleApproved ? 'shortage' : ''}"><div><strong>${h(formatDate(assignment.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</strong><small>Потрібно: ${assignment.requiredCount}</small></div><span>${h(assignment.employeeIds.map((id) => employeeById(id)?.name || '—').join(' + ') || 'Не призначено')}</span></article>`).join('')}</div>
        <div class="confirm-box">Це лише розрахунок. Поточна база ще не змінена. Після застосування вже заповнені вручну дні залишаться без змін.</div>
      </div>
      <footer class="modal-foot"><button class="button" type="button" data-close-modal>Скасувати</button><button class="button primary" data-apply-duty-preview data-start-date="${startDate}" data-end-date="${endDate}">Застосувати графік</button></footer>
    `, true);
  } catch (error) {
    showToast(error.message || String(error), { error: true });
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
  if (['personal_permission', 'sick', 'vacation', 'day_off', 'holiday'].includes(record?.status)) {
    return STATUS_LABELS[record.status];
  }
  return '';
}

function openDutyDayModal(date) {
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
          ? `Не вистачає ${missing} ${missing === 1 ? 'чергового' : 'чергових'}. Додайте другого працівника або залиште одного й увімкніть окремий дозвіл нижче.`
          : `Для цього дня потрібно: ${requiredCount}. ${requiredCount === 2 ? 'Якщо обрано одного, окремо підтвердьте одиночне чергування.' : 'Окремий дозвіл на одного не потрібен.'}`}</div>
        <div class="duty-picker">${dutyParticipants().map((employee) => {
          const restriction = dutyRestrictionText(employee.id, date);
          const checked = assignment.employeeIds.includes(employee.id);
          return `<label class="duty-pick ${restriction ? 'restricted' : ''}"><input type="checkbox" name="employeeIds" value="${h(employee.id)}" ${checked ? 'checked' : ''} ${restriction || locked ? 'disabled' : ''}><span><strong>${h(employee.name)}</strong>${restriction ? `<small>${h(restriction)}</small>` : '<small>Доступний</small>'}</span></label>`;
        }).join('')}</div>
        ${requiredCount === 2 ? `<label class="check-row"><input type="checkbox" name="singleApproved" ${assignment.singleApproved ? 'checked' : ''} ${locked ? 'disabled' : ''}><span><strong>Дозволяю чергування однієї людини</strong><span>Потрібно лише тоді, коли в списку залишено одного працівника.</span></span></label>` : ''}
        <details class="modal-details" ${assignment.explanation ? 'open' : ''}><summary>Чому обрано саме цих працівників</summary>${renderDutyExplanation(assignment.explanation)}</details>
        <section class="day-exception-box">
          <h3>Разовий виняток лише на цей день</h3>
          <div class="settings-grid">
            <label class="check-row"><input id="exception-consecutive" type="checkbox" ${exception.allowConsecutiveDay ? 'checked' : ''} ${locked ? 'disabled' : ''}><span><strong>Дозволити після попереднього дня</strong></span></label>
            <label class="check-row"><input id="exception-weekend" type="checkbox" ${exception.allowConsecutiveWeekend ? 'checked' : ''} ${locked ? 'disabled' : ''}><span><strong>Дозволити сусідній уікенд</strong></span></label>
            <label class="check-row"><input id="exception-rest" type="checkbox" ${exception.allowRestGap ? 'checked' : ''} ${locked ? 'disabled' : ''}><span><strong>Ігнорувати бажаний відпочинок</strong></span></label>
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

function openDutyEmployeeModal(employeeId, date) {
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
        <div class="confirm-box">Реалізоване чергування позначається лише другим лівим кліком по синій одиниці.</div>
        <button class="button danger" data-remove-duty-assignment data-date="${date}" data-employee-id="${h(employeeId)}">Зняти чергування</button>
        <div class="confirm-box">Щоб установити «А» або відсутність, спочатку змініть склад чергових на цей день.</div>
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
  const employee = employeeById(employeeId);
  openModal(`
    <form id="submission-form" data-employee-id="${h(employeeId)}">
      <header class="modal-head"><div><h2>Зарахувати запити</h2><p>${h(employee?.name || '')}</p></div><button class="icon-button" type="button" data-close-modal>×</button></header>
      <div class="modal-body">
        <div class="form-grid">
          <label class="field"><span>Фактична кількість запитів</span><input name="requestCount" type="number" min="1" max="100" value="1" required></label>
          <label class="field"><span>Номер або назва документа</span><input name="documentRef" maxlength="120" placeholder="Необов’язково"></label>
        </div>
        <label class="check-row">
          <input name="complexTwoDay" type="checkbox">
          <span><strong>Дозволити зарахувати один складний запит за 2 робочі дні</strong><span>До фактичної кількості запитів додасться одна залікова одиниця. В аналітиці вони залишаться розділеними.</span></span>
        </label>
        <label class="field"><span>Примітка</span><textarea name="note" maxlength="500" placeholder="Причина складності або інше пояснення"></textarea></label>
        <div class="confirm-box">Поточний день закривається першим. Решта одиниць закриває найближчі попередні пропуски: від учора назад. Для майбутніх днів програма попросить окремий дозвіл.</div>
      </div>
      <footer class="modal-foot"><button class="button" type="button" data-close-modal>Скасувати</button><button class="button primary" type="submit">Зарахувати</button></footer>
    </form>
  `);
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
  const employee = employeeById(employeeId);
  const record = recordFor(employeeId, date);
  const day = dateFromKey(date).getDay();
  const calendarWeekend = !configuredWorkday(date);
  const workdayOverride = hasWorkdayOverride(employeeId, date);
  const canEditWorkday = !calendarWeekend || workdayOverride;
  openModal(`
    <header class="modal-head"><div><h2>Статус дня</h2><p>${h(employee?.name || '')} · ${h(formatDate(date))}</p></div><button class="icon-button" type="button" data-close-modal>×</button></header>
    <div class="modal-body">
      <div>Поточний статус: ${calendarWeekend && !workdayOverride ? statusBadge('weekend') : statusBadge(record?.status || 'pending')}</div>
      ${calendarWeekend && !workdayOverride ? `
        <div class="confirm-box">Субота й неділя автоматично позначаються «ВХ» і не входять до норми та відпрацьованих днів.</div>
        <button class="button primary" type="button" data-set-workday-override data-employee-id="${h(employeeId)}" data-date="${date}">Зробити робочим днем</button>
      ` : ''}
      ${calendarWeekend && workdayOverride ? `
        <div class="confirm-box success-box">Цей календарний вихідний вручну зроблено робочим. Він входить у норму${snapshot.settings.automaticClose ? ` й закривається о ${closeTimeText()} як звичайний робочий день` : '; автоматичне закриття зараз вимкнено'}.</div>
      ` : ''}
      ${date === localDateKey() && canEditWorkday ? `
        <div class="button-row">
          <button class="button success" data-modal-submit-one="${h(employeeId)}">+ Зарахувати 1 запит</button>
          <button class="button" data-modal-submission="${h(employeeId)}">Кілька / складний</button>
        </div>
      ` : ''}
      ${canEditWorkday ? `<label class="field"><span>Примітка до нового статусу</span><textarea id="status-note" maxlength="500" placeholder="Необов’язково">${h(record?.note || '')}</textarea></label>` : ''}
      ${canEditWorkday && record?.receiptId ? `
        <div class="confirm-box">Цей день пов’язаний із зарахованим документом. Щоб не пошкодити розподіл запиту між датами, окреме ручне редагування заблоковано. За потреби скасуйте останнє зарахування.</div>
      ` : canEditWorkday ? `<div class="status-grid">
        ${date < localDateKey() ? `<button class="status-choice submitted-choice" data-set-status="submitted" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Подав</strong><span>Ручна відмітка за минулий день</span></button>` : ''}
        <button class="status-choice" data-set-status="missed" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Не подав</strong><span>Утворює незакритий пропуск</span></button>
        <button class="status-choice" data-set-status="other_tasks" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Інші завдання</strong><span>Рахується відпрацьованим днем</span></button>
        <button class="status-choice" data-set-status="personal_permission" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Особисті справи</strong><span>Окремий дозвіл керівника</span></button>
        <button class="status-choice" data-set-status="sick" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Лікарняний</strong><span>Не входить у норму</span></button>
        <button class="status-choice" data-set-status="vacation" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Відпустка</strong><span>Не входить у норму</span></button>
        <button class="status-choice" data-set-status="day_off" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Відгул</strong><span>Не входить у норму</span></button>
        <button class="status-choice" data-set-status="holiday" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Святковий / вихідний</strong><span>Не входить у норму</span></button>
      </div>` : ''}
    </div>
    <footer class="modal-foot">
      ${calendarWeekend && workdayOverride && !record?.receiptId ? `<button class="button danger" type="button" data-clear-workday-override data-employee-id="${h(employeeId)}" data-date="${date}">Повернути «ВХ»</button>` : ''}
      ${record && !record.receiptId ? `<button class="button danger" type="button" data-clear-status data-employee-id="${h(employeeId)}" data-date="${date}">Очистити</button>` : ''}
      <button class="button" type="button" data-close-modal>Закрити</button>
    </footer>
  `, true);
}

function showToast(message, { error = false, undo = false } = {}) {
  const toast = document.createElement('div');
  toast.className = `toast ${error ? 'error' : ''}`;
  toast.innerHTML = `<span>${h(message)}</span>${undo ? '<button data-toast-undo>Скасувати</button>' : ''}`;
  toastRoot.appendChild(toast);
  setTimeout(() => toast.remove(), error ? 6500 : 4200);
}

async function refresh({ analytics = ui.tab === 'analytics', duties = ui.tab === 'duties' } = {}) {
  snapshot = await window.counter.getSnapshot();
  if (analytics) {
    ui.analytics = await window.counter.getAnalytics({
      employeeId: ui.analyticsEmployee || null,
      startDate: ui.analyticsStart,
      endDate: ui.analyticsEnd,
    });
  }
  if (duties && snapshot.duties?.initialized) {
    const year = ui.dutyMonth.slice(0, 4);
    [ui.dutyStats, ui.dutyFairness] = await Promise.all([
      window.counter.getDutyStats(year),
      window.counter.getDutyFairness({ startDate: `${year}-01-01`, endDate: `${year}-12-31` }),
    ]);
  }
  renderShell();
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
  const receipt = await run(
    () => window.counter.recordSubmission({ employeeId, requestCount: 1, complexTwoDay: false }),
    'Один запит зараховано.',
  );
  if (receipt?.unallocatedCredit > 0) openFutureApproval(receipt);
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

appRoot.addEventListener('click', async (event) => {
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    const action = actionButton.dataset.action;
    if (action === 'toggle-mode') {
      ui.mode = ui.mode === 'widget' ? 'dashboard' : 'widget';
      await window.counter.setWindowMode(ui.mode);
      renderShell();
      return;
    }
    if (action === 'open-employees') {
      ui.mode = 'dashboard';
      ui.tab = 'employees';
      await window.counter.setWindowMode('dashboard');
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
    if (action === 'import-data') {
      if (!confirmAction('Імпорт замінить поточну базу даних. Продовжити?')) return;
      const result = await run(() => window.counter.importData(), null, { undo: true });
      if (result && !result.canceled) showToast('Резервну копію імпортовано.', { undo: true });
      return;
    }
    if (action === 'reset-all-data') {
      if (!confirmAction('Це назавжди видалить УСІ дані застосунку. Продовжити?', true)) return;
      if (!confirmAction('Останнє підтвердження: видалити працівників, табель, документи, усі графіки чергувань і журнал «Відпросився» без можливості скасування?', true)) return;
      const result = await run(
        () => window.counter.resetAllData(),
        null,
        { undo: false },
      );
      if (result?.reset) {
        ui.tab = 'today';
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
    ui.tab = tabButton.dataset.tab;
    if (ui.tab === 'analytics' && !ui.analytics) {
      await refresh({ analytics: true });
    } else if (ui.tab === 'duties' && !ui.dutyStats && snapshot.duties?.initialized) {
      await refresh({ duties: true });
    } else {
      renderShell();
    }
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

  const cell = event.target.closest('[data-cell-employee]');
  if (cell) return openStatusModal(cell.dataset.cellEmployee, cell.dataset.date);

  const monthButton = event.target.closest('[data-month-shift]');
  if (monthButton) {
    ui.month = monthShift(ui.month, Number(monthButton.dataset.monthShift));
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
    const result = await run(
      () => window.counter.updateSettings({
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
        statusColors: { ...STATUS_COLORS },
      }),
      'Стандартні налаштування відновлено.',
    );
    if (result) renderShell();
    return;
  }

  const deleteTimeOffButton = event.target.closest('[data-delete-time-off]');
  if (deleteTimeOffButton) {
    if (!confirmAction('Видалити цей запис із журналу «Відпросився»?')) return;
    await run(
      () => window.counter.deleteTimeOffEntry(deleteTimeOffButton.dataset.deleteTimeOff),
      'Запис видалено.',
    );
    return;
  }

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
    if (!confirmAction(`Видалити графік «${schedule.name}» разом із його історією та позначками? Інші графіки не зміняться.`)) return;
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
    await run(
      () => window.counter.toggleDutyAssignment(dutyCellButton.dataset.employeeId, date),
      null,
    );
    return;
  }

  const generateDutiesButton = event.target.closest('[data-generate-duties]');
  if (generateDutiesButton) {
    const { startDate, endDate } = nextWeekRange();
    ui.dutyMonth = startDate.slice(0, 7);
    await openDutyPreviewModal(startDate, endDate);
    return;
  }

  const archiveButton = event.target.closest('[data-archive-employee]');
  if (archiveButton) {
    if (!confirmAction('Прибрати працівника з активного віджета? Історія залишиться в архіві.')) return;
    await run(() => window.counter.archiveEmployee(archiveButton.dataset.archiveEmployee), 'Працівника переміщено до архіву.');
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

appRoot.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.target.id === 'settings-form') {
    const form = new FormData(event.target);
    const [closeHour, closeMinute] = String(form.get('closeTime') || '18:00').split(':').map(Number);
    const statusColors = Object.fromEntries(Object.keys(STATUS_COLORS).map((key) => [
      key,
      String(form.get(`color-${key}`) || STATUS_COLORS[key]),
    ]));
    await run(
      () => window.counter.updateSettings({
        closeHour,
        closeMinute,
        automaticClose: form.get('automaticClose') === 'on',
        workdays: form.getAll('workdays').map(Number),
        alwaysOnTop: form.get('alwaysOnTop') === 'on',
        confirmDestructiveActions: form.get('confirmDestructiveActions') === 'on',
        showArchivedEmployees: form.get('showArchivedEmployees') === 'on',
        dutyNameWidth: Number(form.get('dutyNameWidth')),
        dutyRowHeight: Number(form.get('dutyRowHeight')),
        dutyLineStrength: Number(form.get('dutyLineStrength')),
        backupRetention: Number(form.get('backupRetention')),
        dateStyle: String(form.get('dateStyle') || 'long'),
        statusColors,
      }),
      'Налаштування збережено.',
    );
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
      'Запис «Відпросився» додано.',
    );
    if (result) {
      ui.timeOffMonth = result.date.slice(0, 7);
      event.target.reset();
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
    if (employee) event.target.reset();
  }
  if (event.target.id === 'analytics-form') {
    const form = new FormData(event.target);
    ui.analyticsEmployee = String(form.get('employeeId') || '');
    ui.analyticsStart = String(form.get('startDate'));
    ui.analyticsEnd = String(form.get('endDate'));
    await refresh({ analytics: true });
  }
});

appRoot.addEventListener('change', async (event) => {
  if (event.target.matches('[data-duty-schedule-select]')) {
    const result = await run(
      () => window.counter.switchDutySchedule(event.target.value),
      null,
      { undo: false },
    );
    if (result) {
      ui.dutyStats = null;
      await refresh({ duties: true });
    }
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

modalRoot.addEventListener('click', async (event) => {
  if (event.target.matches('[data-modal-close]') || event.target.closest('[data-close-modal]')) {
    closeModal();
    return;
  }

  const applyPreviewButton = event.target.closest('[data-apply-duty-preview]');
  if (applyPreviewButton) {
    const result = await run(
      () => window.counter.generateDuties({
        startDate: applyPreviewButton.dataset.startDate,
        endDate: applyPreviewButton.dataset.endDate,
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

  const weekLockButton = event.target.closest('[data-toggle-week-lock]');
  if (weekLockButton) {
    const willLock = weekLockButton.dataset.locked !== 'true';
    if (willLock && !confirmAction('Заблокувати весь тиждень від змін?')) return;
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
    if (!window.confirm('Повернути позначку «ВХ»? Установлений вручну статус цього дня буде очищено.')) return;
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
    const result = await run(
      () => window.counter.removeDutyAssignment(removeDutyButton.dataset.employeeId, removeDutyButton.dataset.date),
      'Позначку чергування знято.',
    );
    if (result) closeModal();
    return;
  }

  const dutyRestrictionButton = event.target.closest('[data-set-duty-restriction]');
  if (dutyRestrictionButton) {
    const note = modalRoot.querySelector('#duty-restriction-note')?.value || '';
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
    if (!window.confirm('Очистити склад чергових на цей день?')) return;
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

modalRoot.addEventListener('submit', async (event) => {
  event.preventDefault();
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
      closeModal();
    }
    return;
  }
  if (event.target.id === 'duty-rules-form') {
    const form = new FormData(event.target);
    const result = await run(
      () => window.counter.updateDutyScheduleRules(event.target.dataset.scheduleId, {
        weekdayDutyCount: Number(form.get('weekdayDutyCount')),
        weekendDutyCount: Number(form.get('weekendDutyCount')),
        minimumRestDays: Number(form.get('minimumRestDays')),
        maximumDutiesPerWeek: Number(form.get('maximumDutiesPerWeek')),
        pairHistoryPeriod: String(form.get('pairHistoryPeriod') || 'year'),
        preventConsecutiveDays: form.get('preventConsecutiveDays') === 'on',
        preventConsecutiveWeekends: form.get('preventConsecutiveWeekends') === 'on',
        compensateNextWeek: form.get('compensateNextWeek') === 'on',
        avoidRepeatedPairs: form.get('avoidRepeatedPairs') === 'on',
      }),
      'Правила цього графіка збережено.',
    );
    if (result) closeModal();
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
      closeModal();
    }
    return;
  }
  if (event.target.id === 'duty-history-form') {
    const result = await run(
      () => window.counter.initializeDuties(dutyHistoryEntries(event.target), dutyParticipantIds(event.target)),
      'Початкові підсумки чергувань оновлено.',
    );
    if (result) closeModal();
    return;
  }
  if (event.target.id === 'duty-day-form') {
    const form = new FormData(event.target);
    const result = await run(
      () => window.counter.setDutyAssignment({
        date: event.target.dataset.date,
        employeeIds: form.getAll('employeeIds').map(String),
        singleApproved: form.get('singleApproved') === 'on',
      }),
      'Склад чергових збережено.',
    );
    if (result) closeModal();
    return;
  }
  if (event.target.id !== 'submission-form') return;
  const form = new FormData(event.target);
  const payload = {
    employeeId: event.target.dataset.employeeId,
    requestCount: Number(form.get('requestCount')),
    complexTwoDay: form.get('complexTwoDay') === 'on',
    documentRef: String(form.get('documentRef') || ''),
    note: String(form.get('note') || ''),
  };
  const receipt = await run(() => window.counter.recordSubmission(payload), 'Запити зараховано.');
  if (!receipt) return;
  closeModal();
  if (receipt.unallocatedCredit > 0) openFutureApproval(receipt);
});

toastRoot.addEventListener('click', async (event) => {
  if (!event.target.matches('[data-toast-undo]')) return;
  await run(() => window.counter.undo(), 'Останню дію скасовано.', { undo: false });
  event.target.closest('.toast')?.remove();
});

window.counter.onChanged(async (nextSnapshot) => {
  snapshot = nextSnapshot;
  if (ui.tab === 'analytics') {
    try {
      ui.analytics = await window.counter.getAnalytics({
        employeeId: ui.analyticsEmployee || null,
        startDate: ui.analyticsStart,
        endDate: ui.analyticsEnd,
      });
    } catch (error) {
      showToast(error.message || String(error), { error: true });
    }
  }
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
  renderShell();
});

window.addEventListener('resize', updateDutyScrollExtent);

refresh({ analytics: false }).catch((error) => {
  appRoot.innerHTML = `<section class="window-shell"><div class="empty-widget"><h2>Не вдалося запустити програму</h2><p>${h(error.message || String(error))}</p></div></section>`;
});
