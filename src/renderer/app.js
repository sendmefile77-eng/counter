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

const appRoot = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const toastRoot = document.querySelector('#toast-root');

let snapshot = null;
let ui = {
  mode: 'widget',
  tab: 'today',
  month: localDateKey().slice(0, 7),
  analyticsStart: `${localDateKey().slice(0, 7)}-01`,
  analyticsEnd: localDateKey(),
  analyticsEmployee: '',
  analytics: null,
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

function formatDate(value, options = { day: 'numeric', month: 'long', year: 'numeric' }) {
  return new Intl.DateTimeFormat('uk-UA', options).format(dateFromKey(value));
}

function formatMonth(value) {
  return new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric' })
    .format(dateFromKey(`${value}-01`));
}

function activeEmployees() {
  return snapshot.employees.filter((employee) => employee.active);
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

function statusBadge(status) {
  return `<span class="status-badge" data-status="${status}">${h(STATUS_LABELS[status] || status)}</span>`;
}

function renderShell() {
  appRoot.innerHTML = `
    <section class="window-shell ${ui.mode}">
      <header class="titlebar">
        <div class="brand-mark">Щ</div>
        <div class="title-copy">
          <strong>Щоденний облік</strong>
          <span>Локальні дані · закриття о 18:00</span>
        </div>
        <div class="title-spacer"></div>
        <div class="window-actions">
          <button class="icon-button" data-action="toggle-mode" title="${ui.mode === 'widget' ? 'Відкрити журнал' : 'Повернутися до віджета'}">${ui.mode === 'widget' ? '▦' : '◉'}</button>
          <button class="icon-button" data-action="minimize" title="Згорнути">—</button>
          <button class="icon-button danger" data-action="close" title="Закрити">×</button>
        </div>
      </header>
      <main class="main-content">
        ${ui.mode === 'widget' ? renderWidget() : renderDashboard()}
      </main>
    </section>
  `;
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
  const today = localDateKey();
  const submitted = employees.filter((employee) => SUBMITTED_STATUSES.has(statusFor(employee.id, today))).length;
  const sectors = employees.map((employee, index) => {
    const status = statusFor(employee.id, today);
    const sweep = 360 / employees.length;
    const labelPoint = polar(300, 300, employees.length > 11 ? 195 : 202, (index + 0.5) * sweep);
    const dotPoint = polar(300, 300, employees.length > 11 ? 232 : 238, (index + 0.5) * sweep);
    return `
      <g class="sector" data-employee-id="${h(employee.id)}" tabindex="0" role="button" aria-label="${h(employee.name)}: ${h(STATUS_LABELS[status])}">
        <title>${h(employee.name)} · ${h(STATUS_LABELS[status])}\nЛівий клік — зарахувати 1 запит. Правий — інші дії.</title>
        <path d="${annularSectorPath(index, employees.length)}" fill="${STATUS_COLORS[status]}" opacity="0.91"></path>
        <circle class="status-dot" cx="${dotPoint.x}" cy="${dotPoint.y}" r="5" fill="${STATUS_COLORS[status]}"></circle>
        <text x="${labelPoint.x}" y="${labelPoint.y}" text-anchor="middle" dominant-baseline="central">${h(shortName(employee.name))}</text>
      </g>
    `;
  }).join('');
  return `
    <svg class="radial-svg" viewBox="0 0 600 600" aria-label="Стан працівників на сьогодні">
      ${sectors}
      <circle class="center-disc" cx="300" cy="300" r="104"></circle>
      <text class="center-date" x="300" y="260" text-anchor="middle">${h(formatDate(today, { day: 'numeric', month: 'long' }))}</text>
      <text class="center-value" x="300" y="313" text-anchor="middle">${submitted}/${employees.length}</text>
      <text class="center-caption" x="300" y="340" text-anchor="middle">подали запит</text>
    </svg>
  `;
}

function renderWidget() {
  const employees = activeEmployees();
  const statuses = employees.map((employee) => statusFor(employee.id));
  const submitted = statuses.filter((status) => SUBMITTED_STATUSES.has(status)).length;
  const missed = statuses.filter((status) => status === 'missed').length;
  const excused = statuses.filter((status) => VALID_ABSENCE_STATUSES.has(status)).length;
  return `
    <section class="widget-view">
      <div class="radial-wrap">
        ${employees.length ? renderRadial(employees) : `
          <div class="empty-widget">
            <h2>Додайте працівників</h2>
            <p>У віджеті можна розмістити до 15 людей. Після цього один клік на секторі зараховуватиме один запит.</p>
            <button class="button primary" data-action="open-employees">Додати першого працівника</button>
          </div>
        `}
      </div>
      <footer class="widget-footer">
        <div class="widget-summary">
          <div class="mini-stat"><strong>${submitted}</strong><span>подали</span></div>
          <div class="mini-stat"><strong>${missed}</strong><span>не подали</span></div>
          <div class="mini-stat"><strong>${excused}</strong><span>інші статуси</span></div>
        </div>
        <div class="footer-actions">
          <button class="button" data-action="undo">↶ Скасувати останнє</button>
          <button class="button primary" data-action="toggle-mode">Відкрити журнал</button>
        </div>
      </footer>
    </section>
  `;
}

function renderDashboard() {
  const nav = [
    ['today', '●', 'Сьогодні'],
    ['journal', '▦', 'Табель'],
    ['analytics', '⌁', 'Аналітика'],
    ['employees', '♙', 'Працівники'],
    ['data', '⇅', 'Дані'],
  ];
  return `
    <div class="dashboard-layout">
      <aside class="sidebar">
        ${nav.map(([id, icon, label]) => `
          <button class="nav-button ${ui.tab === id ? 'active' : ''}" data-tab="${id}"><span>${icon}</span>${label}</button>
        `).join('')}
        <div class="sidebar-spacer"></div>
        <div class="sidebar-note">Один клік у віджеті зараховує один запит. Додаткові одиниці закривають найближчі пропуски назад.</div>
      </aside>
      <section class="dashboard-content">
        ${renderActivePage()}
      </section>
    </div>
  `;
}

function renderActivePage() {
  if (ui.tab === 'journal') return renderJournalPage();
  if (ui.tab === 'analytics') return renderAnalyticsPage();
  if (ui.tab === 'employees') return renderEmployeesPage();
  if (ui.tab === 'data') return renderDataPage();
  return renderTodayPage();
}

function renderTodayPage() {
  const employees = activeEmployees();
  return `
    <div class="page-header">
      <div>
        <h1>Сьогодні, ${h(formatDate(localDateKey(), { day: 'numeric', month: 'long' }))}</h1>
        <p>Незаповнені робочі дні автоматично закриваються о 18:00.</p>
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
  const employees = snapshot.employees.filter((employee) => dates.some((date) => employeeActiveOnDate(employee, date)));
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
              return `<th class="${day === 0 || day === 6 ? 'weekend' : ''}" title="${h(formatDate(date))}">${Number(date.slice(-2))}</th>`;
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
                if (outsideEmployment || day === 0 || day === 6) {
                  return `<td class="matrix-cell weekend" title="Неробочий день">·</td>`;
                }
                const status = statusFor(employee.id, date);
                const record = recordFor(employee.id, date);
                const tooltip = `${employee.name}\n${formatDate(date)}\n${STATUS_LABELS[status]}${record?.documentRef ? `\n${record.documentRef}` : ''}${record?.note ? `\n${record.note}` : ''}`;
                return `<td class="matrix-cell cell-${status}" data-cell-employee="${h(employee.id)}" data-date="${date}" title="${h(tooltip)}">${STATUS_SYMBOLS[status]}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
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
    ${archived.length ? `
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
  return `
    <div class="page-header">
      <div><h1>Дані та резервні копії</h1><p>Програма не передає дані в інтернет.</p></div>
    </div>
    <section class="panel">
      <div class="data-actions">
        <div class="data-action"><h3>Резервна копія JSON</h3><p>Повна база: працівники, документи, статуси, розподіли та журнал змін.</p><button class="button primary" data-export="json">Зберегти копію</button></div>
        <div class="data-action"><h3>Таблиця CSV</h3><p>Плоска таблиця для відкриття в Excel або іншій програмі.</p><button class="button" data-export="csv">Експортувати таблицю</button></div>
        <div class="data-action"><h3>Відновлення</h3><p>Імпорт повної резервної копії JSON з іншого комп’ютера.</p><button class="button danger" data-action="import-data">Імпортувати копію</button></div>
      </div>
    </section>
    <section class="panel">
      <h2>Поведінка віджета</h2>
      <label class="check-row">
        <input id="always-on-top" type="checkbox" ${snapshot.settings.alwaysOnTop ? 'checked' : ''}>
        <span><strong>Завжди поверх інших вікон</strong><span>Віджет залишатиметься видимим під час роботи в інших програмах.</span></span>
      </label>
      <p class="panel-copy">Автоматичне закриття дня зафіксовано на 18:00. Якщо програма не працювала, пропущені дні будуть оброблені під час наступного запуску.</p>
      <p class="panel-copy">Локальний файл: ${h(snapshot.dataFilePath || 'системний каталог програми')}</p>
    </section>
  `;
}

function openModal(content, wide = false) {
  modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-close><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${content}</section></div>`;
}

function closeModal() {
  modalRoot.innerHTML = '';
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
      <div class="confirm-box">Після закриття поточного дня та найближчих попередніх пропусків залишилося <strong>${receipt.unallocatedCredit}</strong> одиниць. Зарахувати їх на найближчі майбутні робочі дні?</div>
      <p class="panel-copy">Без вашого підтвердження майбутні дні не зміняться, а залишок збережеться в записі документа.</p>
    </div>
    <footer class="modal-foot"><button class="button" type="button" data-close-modal>Ні, залишити нерозподіленими</button><button class="button primary" type="button" data-approve-future="${h(receipt.id)}" data-units="${receipt.unallocatedCredit}">Так, зарахувати наперед</button></footer>
  `);
}

function openStatusModal(employeeId, date) {
  const employee = employeeById(employeeId);
  const record = recordFor(employeeId, date);
  openModal(`
    <header class="modal-head"><div><h2>Статус дня</h2><p>${h(employee?.name || '')} · ${h(formatDate(date))}</p></div><button class="icon-button" type="button" data-close-modal>×</button></header>
    <div class="modal-body">
      <div>Поточний статус: ${statusBadge(record?.status || 'pending')}</div>
      ${date === localDateKey() ? `
        <div class="button-row">
          <button class="button success" data-modal-submit-one="${h(employeeId)}">+ Зарахувати 1 запит</button>
          <button class="button" data-modal-submission="${h(employeeId)}">Кілька / складний</button>
        </div>
      ` : ''}
      <label class="field"><span>Примітка до нового статусу</span><textarea id="status-note" maxlength="500" placeholder="Необов’язково">${h(record?.note || '')}</textarea></label>
      ${record?.receiptId ? `
        <div class="confirm-box">Цей день пов’язаний із зарахованим документом. Щоб не пошкодити розподіл запиту між датами, окреме ручне редагування заблоковано. За потреби скасуйте останнє зарахування.</div>
      ` : `<div class="status-grid">
        <button class="status-choice" data-set-status="missed" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Не подав</strong><span>Утворює незакритий пропуск</span></button>
        <button class="status-choice" data-set-status="other_tasks" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Інші завдання</strong><span>Рахується відпрацьованим днем</span></button>
        <button class="status-choice" data-set-status="personal_permission" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Особисті справи</strong><span>Окремий дозвіл керівника</span></button>
        <button class="status-choice" data-set-status="sick" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Лікарняний</strong><span>Не входить у норму</span></button>
        <button class="status-choice" data-set-status="vacation" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Відпустка</strong><span>Не входить у норму</span></button>
        <button class="status-choice" data-set-status="day_off" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Відгул</strong><span>Не входить у норму</span></button>
        <button class="status-choice" data-set-status="holiday" data-employee-id="${h(employeeId)}" data-date="${date}"><strong>Святковий / вихідний</strong><span>Не входить у норму</span></button>
      </div>`}
    </div>
    <footer class="modal-foot">
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

async function refresh({ analytics = ui.tab === 'analytics' } = {}) {
  snapshot = await window.counter.getSnapshot();
  if (analytics) {
    ui.analytics = await window.counter.getAnalytics({
      employeeId: ui.analyticsEmployee || null,
      startDate: ui.analyticsStart,
      endDate: ui.analyticsEnd,
    });
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
    if (action === 'minimize') return window.counter.minimize();
    if (action === 'close') return window.counter.close();
    if (action === 'undo') {
      await run(() => window.counter.undo(), 'Останню дію скасовано.', { undo: false });
      return;
    }
    if (action === 'import-data') {
      if (!window.confirm('Імпорт замінить поточну базу даних. Продовжити?')) return;
      const result = await run(() => window.counter.importData(), null, { undo: true });
      if (result && !result.canceled) showToast('Резервну копію імпортовано.', { undo: true });
      return;
    }
  }

  const tabButton = event.target.closest('[data-tab]');
  if (tabButton) {
    ui.tab = tabButton.dataset.tab;
    if (ui.tab === 'analytics' && !ui.analytics) {
      await refresh({ analytics: true });
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

  const archiveButton = event.target.closest('[data-archive-employee]');
  if (archiveButton) {
    if (!window.confirm('Прибрати працівника з активного віджета? Історія залишиться в архіві.')) return;
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

appRoot.addEventListener('contextmenu', (event) => {
  const sector = event.target.closest('.sector[data-employee-id]');
  if (!sector) return;
  event.preventDefault();
  openStatusModal(sector.dataset.employeeId, localDateKey());
});

appRoot.addEventListener('submit', async (event) => {
  event.preventDefault();
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
  renderShell();
});

refresh({ analytics: false }).catch((error) => {
  appRoot.innerHTML = `<section class="window-shell"><div class="empty-widget"><h2>Не вдалося запустити програму</h2><p>${h(error.message || String(error))}</p></div></section>`;
});
