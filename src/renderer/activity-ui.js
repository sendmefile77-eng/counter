const activityUi = {
  startDate: '', endDate: '', employeeId: '', query: '', onlyAnomalies: false,
  view: 'days', page: 0, report: null, loading: false, busy: false, error: '', revision: 0,
  sort: 'date', direction: -1,
};
const activityFileInput = document.querySelector('#activity-file-input');
const activityDuration = ms => {
  if (ms == null) return '—';
  if (ms > 0 && ms < 60000) return '<1 хв';
  const minutes = Math.round(ms / 60000);
  return `${Math.floor(minutes / 60)} год ${String(minutes % 60).padStart(2, '0')} хв`;
};
const activityShortTime = time => time ? time.slice(0, 5) : '—';
function activityEmployeeOptions(selected = '', includeUnassigned = false) {
  return `<option value="">${includeUnassigned ? 'Усі працівники й джерела' : 'Не призначено'}</option>`
    + (includeUnassigned ? `<option value="unassigned" ${selected === 'unassigned' ? 'selected' : ''}>Непризначені джерела</option>` : '')
    + snapshot.employees.map(person => `<option value="${h(person.id)}" ${selected === person.id ? 'selected' : ''}>${h(person.name)}${person.active ? '' : ' · архів'}</option>`).join('');
}
function activityFilter() {
  return { startDate: activityUi.startDate, endDate: activityUi.endDate,
    employeeId: activityUi.employeeId, query: activityUi.query, onlyAnomalies: activityUi.onlyAnomalies };
}
function ensureActivityRange() {
  if (activityUi.startDate && activityUi.endDate) return;
  const imports = snapshot.activity?.imports || [];
  activityUi.endDate = imports.map(item => item.endDate).sort().at(-1) || localDateKey();
  const first = imports.map(item => item.startDate).sort()[0] || activityUi.endDate;
  const earliest = new Date(Date.parse(activityUi.endDate + 'T00:00:00Z') - 365 * 86400000).toISOString().slice(0, 10);
  activityUi.startDate = first < earliest ? earliest : first;
}
async function loadActivityReport({ render = true } = {}) {
  ensureActivityRange();
  const revision = ++activityUi.revision;
  activityUi.loading = true;
  if (render) renderShell();
  try {
    const report = await window.counter.getActivityReport(activityFilter());
    if (revision !== activityUi.revision) return;
    activityUi.report = report; activityUi.error = '';
  } catch (error) {
    if (revision === activityUi.revision) { activityUi.error = error.message || String(error); activityUi.report = null; }
  } finally {
    if (revision === activityUi.revision) { activityUi.loading = false; if (render && ui.tab === 'activity') renderShell(); }
  }
}

function activityPager(count) {
  const pages = Math.max(1, Math.ceil(count / 50));
  activityUi.page = Math.min(activityUi.page, pages - 1);
  return `<div class="activity-pager"><span>${count ? activityUi.page * 50 + 1 : 0}–${Math.min(count, (activityUi.page + 1) * 50)} із ${count}</span><div><button class="button small" data-activity-page="-1" ${activityUi.page ? '' : 'disabled'} aria-label="Попередні записи">←</button><span>${activityUi.page + 1} / ${pages}</span><button class="button small" data-activity-page="1" ${activityUi.page + 1 < pages ? '' : 'disabled'} aria-label="Наступні записи">→</button></div></div>`;
}
function activityStatus(row) {
  if (row.future) return 'Майбутня дата';
  if (row.inProgress && row.status !== 'review') return 'День триває';
  return { 'no-data': 'Немає даних', review: 'Перевірити', off: 'Поза нормою дня', observed: 'Є записи' }[row.status];
}
function activityDayTable(report) {
  const rows = report.rows.slice().sort((a, b) => {
    const key = activityUi.sort;
    const av = a[key], bv = b[key];
    if (av == null || bv == null) return av == null ? bv == null ? 0 : 1 : -1;
    return (typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), 'uk-UA')) * activityUi.direction;
  });
  const pager = activityPager(rows.length);
  const head = (key, text) => `<th><button data-activity-sort="${key}">${text}${activityUi.sort === key ? activityUi.direction < 0 ? ' ↓' : ' ↑' : ''}</button></th>`;
  const body = rows.slice(activityUi.page * 50, activityUi.page * 50 + 50).map(row => `<tr class="activity-row-${row.status}">
    <td><button class="activity-day-link" data-activity-day="${h(row.date)}" data-activity-group="${h(row.groupKey)}">${row.date.split('-').reverse().join('.')}</button></td>
    <td><strong>${h(row.name)}</strong>${row.employeeId ? '' : '<small class="activity-warning">Не призначено працівнику</small>'}<small>${h(row.presence)}${row.recordCount ? ` · ${row.recordCount} записів` : ''}</small></td>
    <td><span class="activity-state activity-state-${row.status}">${activityStatus(row)}</span><small>${h(row.anomalies.slice(0, 2).map(item => item.label).join('; '))}${row.anomalies.length > 2 ? `; ще ${row.anomalies.length - 2}` : ''}</small></td>
    <td class="activity-numeric">${activityShortTime(row.first)} → ${activityShortTime(row.last)}</td>
    <td class="activity-numeric"><strong>${activityDuration(row.activeMs)}</strong><small>норма ${activityDuration(row.expectedMs)}</small>${row.missingCount || row.cappedCount ? `<small title="Без тривалості: ${row.missingCount}; обмежено довгі записи: ${row.cappedCount}">${row.missingCount ? `${row.missingCount} без тривалості` : `${row.cappedCount} обмежено`}</small>` : ''}</td>
    <td class="activity-numeric ${row.deficitMs > report.settings.toleranceMinutes * 60000 ? 'activity-warning' : ''}" title="Різниця між нормою та оцінкою за історією">${activityDuration(row.deficitMs)}${row.inProgress ? '<small>Підсумок о 18:00</small>' : ''}</td>
    <td>${row.recordCount ? row.longGaps.length : '—'}<small>${row.maxGapMs ? 'до ' + activityDuration(row.maxGapMs) : ''}</small></td>
  </tr>`).join('');
  return `<div class="activity-table-wrap"><table class="activity-table activity-day-table"><thead><tr>${head('date', 'Дата')}${head('name', 'Працівник / записи')}<th>Стан і відхилення</th><th>Перший → останній</th>${head('activeMs', 'Оцінка / норма')}${head('deficitMs', 'Бракує до норми')}${head('maxGapMs', 'Довгі паузи')}</tr></thead><tbody>${body || '<tr><td colspan="7" class="activity-empty">Немає записів за цими фільтрами.</td></tr>'}</tbody></table></div>${pager}`;
}
function activityJournalTable(report) {
  const pager = activityPager(report.journal.length);
  return `<div class="activity-table-wrap"><table class="activity-table activity-journal"><thead><tr><th>Дата й час</th><th>Працівник / джерело</th><th>Браузер</th><th>Сторінка</th><th>Адреса</th><th>Тривалість у джерелі</th></tr></thead><tbody>${report.journal.slice(activityUi.page * 50, activityUi.page * 50 + 50).map(visit => `<tr><td>${h(formatDate(visit.date))}<small>${h(visit.time)}</small></td><td>${h(visit.name)}<small>${h(visit.source)}</small></td><td>${h(visit.browser)}</td><td class="activity-page-title">${h(visit.title || 'Без назви')}</td><td><span class="activity-url" title="${h(visit.url)}">${h(visit.url)}</span></td><td>${visit.durationMs == null ? 'Невідомо' : activityDuration(visit.durationMs)}${visit.capped ? '<small class="activity-warning">В оцінці обмежено</small>' : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="activity-empty">Немає відвідувань за цим періодом.</td></tr>'}</tbody></table></div>${pager}`;
}
function activitySiteTable(report) {
  const pager = activityPager(report.sites.length);
  return `<p class="activity-note">Тривалість тут — сума значень джерела. Вона може включати перетини й відкриті вкладки.</p><div class="activity-table-wrap"><table class="activity-table"><thead><tr><th>Працівник / джерело</th><th>Сайт</th><th>Записів</th><th>Сума тривалостей у джерелі</th><th>Без тривалості</th></tr></thead><tbody>${report.sites.slice(activityUi.page * 50, activityUi.page * 50 + 50).map(site => `<tr><td>${h(site.name)}</td><td><strong>${h(site.domain)}</strong></td><td>${site.recordCount}</td><td>${activityDuration(site.durationMs)}</td><td>${site.missingCount}</td></tr>`).join('') || '<tr><td colspan="5" class="activity-empty">Немає сайтів за цим періодом.</td></tr>'}</tbody></table></div>${pager}`;
}
function activityUploads(report) {
  return `<section class="activity-source-list"><h2>Джерела та працівники</h2><p class="muted">Прив’язка запам’ятовується для наступних файлів. Кілька браузерів або комп’ютерів одного працівника об’єднуються в один день.</p>${report.sources.map(source => `<div class="activity-source"><div><strong>${h(source.label)}</strong><small>${h(source.browser)} · ${source.recordCount} записів${source.userProfile ? ' · ' + h(source.userProfile) : ''}</small></div><label class="field"><span>Працівник</span><select data-activity-assign="${h(source.id)}" ${activityUi.busy ? 'disabled' : ''}>${activityEmployeeOptions(source.employeeId)}</select></label></div>`).join('') || '<p class="muted">Джерела з’являться після імпорту.</p>'}</section><section class="activity-upload-list"><h2>Історія завантажень</h2><p class="muted">Видалення завантаження прибирає лише його внесок. Записи з інших файлів залишаються.</p>${report.imports.map(item => `<article class="activity-upload"><div><strong>${h(item.name)}</strong><small>${h(formatDate(item.startDate))}–${h(formatDate(item.endDate))} · ${h(item.encoding)} · ${h(new Date(item.importedAt).toLocaleString('uk-UA'))}</small><small>Збережено ${item.retainedCount} унікальних записів · нових при імпорті ${item.newCount} · повторів ${item.duplicateCount}${item.issues.length ? ` · проблемних рядків ${item.issues.length}` : ''}</small>${item.issues.length ? `<details><summary>Проблемні рядки</summary><ul>${item.issues.map(issue => `<li>Рядок ${issue.row}: ${h(issue.message)}</li>`).join('')}</ul></details>` : ''}</div><button class="button danger small" data-activity-remove="${h(item.id)}">Видалити завантаження</button></article>`).join('') || '<p class="muted">Поки немає завантажень.</p>'}</section>`;
}
function renderActivityPage() {
  ensureActivityRange();
  const report = activityUi.report, rules = report?.settings || snapshot.activity?.settings;
  const totals = report?.totals;
  return `<header class="page-header"><div><span class="page-eyebrow">Робочий день за історією браузера</span><h1>Моніторинг активності</h1><p>${h(rules?.startTime || '09:00')}–${h(rules?.endTime || '18:00')} · обід ${h(rules?.lunchStart || '13:00')}–${h(rules?.lunchEnd || '14:00')} · норма 8 годин</p></div><div class="activity-actions"><button class="button" data-activity-settings>Правила</button><button class="button" data-activity-export="csv" ${report?.rows.length ? '' : 'disabled'}>CSV</button><button class="button" data-activity-export="xlsx" ${report?.rows.length ? '' : 'disabled'}>Excel</button><button class="button primary" data-activity-pick ${activityUi.busy ? 'disabled' : ''}>Додати CSV</button></div></header>
    <button class="activity-drop" data-activity-drop data-activity-pick ${activityUi.busy ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m-4 4 4-4 4 4M4 15v5h16v-5"/></svg><span><strong>${activityUi.busy ? 'Читаємо файли…' : 'Перетягніть сюди файли історії браузера'}</strong><small>Один або кілька CSV · перевірка повторів перед збереженням</small></span></button>
    <form id="activity-filter-form" class="panel activity-filter"><label class="field"><span>Від</span><input name="startDate" type="date" value="${h(activityUi.startDate)}" required></label><label class="field"><span>До</span><input name="endDate" type="date" value="${h(activityUi.endDate)}" required></label><label class="field activity-filter-person"><span>Працівник</span><select name="employeeId">${activityEmployeeOptions(activityUi.employeeId, true)}</select></label><label class="field activity-filter-search"><span>Пошук</span><input name="query" type="search" value="${h(activityUi.query)}" placeholder="Працівник, сайт або сторінка"></label><label class="activity-checkbox"><input name="onlyAnomalies" type="checkbox" ${activityUi.onlyAnomalies ? 'checked' : ''}> Дні з відхиленнями</label><button class="button" type="submit">Показати</button></form>
    ${totals ? `<div class="activity-metrics"><div><span>Днів із записами</span><strong>${totals.observedDays}</strong><small>${totals.noDataDays} без даних</small></div><div><span>Оцінка активності</span><strong>${activityDuration(totals.activeMs)}</strong><small>за вибраний період</small></div><div><span>Днів із відхиленнями</span><strong class="${totals.anomalyDays ? 'activity-warning' : ''}">${totals.anomalyDays}</strong><small>потребують перевірки</small></div><div><span>Унікальних записів</span><strong>${totals.recordCount}</strong><small>${totals.unassignedSources ? `${totals.unassignedSources} джерел без працівника` : 'джерела прив’язано'}</small></div></div>` : ''}
    <p class="activity-note">Оцінка за браузерною історією. Перетини об’єднано, обід виключено. Відсутність записів може означати роботу поза браузером.</p>
    <section class="panel activity-results"><div class="activity-tabs" role="group" aria-label="Подання моніторингу">${[['days', 'За днями'], ['sites', 'Сайти'], ['journal', 'Журнал'], ['uploads', 'Завантаження й джерела']].map(([view, label]) => `<button class="button ${activityUi.view === view ? 'primary' : ''}" data-activity-view="${view}" aria-pressed="${activityUi.view === view}">${label}</button>`).join('')}<span role="status">${activityUi.loading ? 'Оновлюємо…' : ''}</span></div>${activityUi.error ? `<p class="activity-error" role="alert">${h(activityUi.error)}</p>` : report ? activityUi.view === 'uploads' ? activityUploads(report) : activityUi.view === 'journal' ? activityJournalTable(report) : activityUi.view === 'sites' ? activitySiteTable(report) : activityDayTable(report) : '<div class="activity-empty"><h2>Почніть із файлів CSV</h2><p>Додайте вигрузки, призначте джерела працівникам і відкрийте потрібний день.</p></div>'}</section>`;
}

function pickActivityFiles() {
  if (activityUi.busy) return;
  activityFileInput.value = ''; activityFileInput.click();
}
activityFileInput.addEventListener('change', () => {
  const files = [...activityFileInput.files]; activityFileInput.value = '';
  void importActivityFiles(files);
});
async function importActivityFiles(files) {
  if (activityUi.busy || !files.length) return;
  activityUi.busy = true;
  renderShell();
  try {
    if (files.length > 50 || files.some(file => !/\.csv$/i.test(file.name) || !file.size || file.size > 32 * 1024 * 1024)
      || files.reduce((sum, file) => sum + file.size, 0) > 64 * 1024 * 1024) {
      throw Error('Виберіть до 50 CSV, кожен до 32 МБ, разом до 64 МБ.');
    }
    const payload = [];
    for (const file of files) payload.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    const preview = await window.counter.previewActivityImport(payload);
    openActivityImport(preview);
  } catch (error) { showToast(error.message || String(error), { error: true }); }
  finally { activityUi.busy = false; renderShell({ preserveDrafts: true }); }
}
function openActivityImport(preview) {
  const pending = preview.files.some(file => !file.duplicateFile);
  openModal(`<form id="activity-import-form" data-token="${h(preview.token)}" data-start="${h(preview.startDate)}" data-end="${h(preview.endDate)}"><header class="modal-head"><div><span class="page-eyebrow">Перевірка імпорту</span><h2>${preview.files.length} файлів · ${preview.newCount} нових записів</h2><p>Спочатку перевірте джерела й призначте працівників.</p></div><button class="icon-button" type="button" data-close-modal aria-label="Закрити">×</button></header><div class="modal-body activity-import-body"><div class="activity-import-files">${preview.files.map(file => `<article class="activity-import-file"><strong>${h(file.name)}</strong><span class="activity-state ${file.duplicateFile ? 'activity-state-no-data' : 'activity-state-observed'}">${file.duplicateFile ? 'Повтор файлу · пропустимо' : `${file.newCount} нових · ${file.duplicateCount} повторів`}</span><small>${h(formatDate(file.startDate))}–${h(formatDate(file.endDate))} · ${h(file.encoding)} · ${file.validCount} придатних рядків</small>${file.issues.length ? `<details><summary class="activity-warning">Проблемних рядків: ${file.issues.length}</summary><ul>${file.issues.map(issue => `<li>Рядок ${issue.row}: ${h(issue.message)}</li>`).join('')}</ul></details>` : ''}</article>`).join('')}</div>${preview.sources.length ? `<label class="field"><span>Призначити всі джерела одному працівнику</span><select data-activity-bulk>${activityEmployeeOptions()}</select></label><div class="activity-import-sources">${preview.sources.map(source => `<div class="activity-source"><div><strong>${h(source.label)}</strong><small>${h(source.browser)}${source.userProfile ? ' · ' + h(source.userProfile) : ''}</small></div><label class="field"><span>Працівник</span><select name="source:${h(source.id)}" data-activity-source>${activityEmployeeOptions(source.employeeId)}</select></label></div>`).join('')}</div>` : '<p>Усі вибрані файли вже враховано. Повторна загрузка не змінить показники.</p>'}<p class="activity-note">Час читається як у CSV, без зміни часового поясу. Непризначені джерела залишаться окремо.</p>${preview.issueCount ? `<label class="activity-checkbox"><input name="acceptIssues" type="checkbox" required> Імпортувати справні рядки; ${preview.issueCount} проблемних рядків залишити в журналі перевірки.</label>` : ''}</div><footer class="modal-foot"><button class="button" type="button" data-close-modal>Закрити</button><button class="button primary" type="submit" ${pending ? '' : 'disabled'}>Імпортувати</button></footer></form>`, true);
}
document.addEventListener('change', async event => {
  if (event.target.matches('[data-activity-bulk]')) {
    event.target.closest('form').querySelectorAll('[data-activity-source]').forEach(select => { select.value = event.target.value; });
  }
  if (event.target.matches('[data-activity-assign]')) {
    const select = event.target, sourceId = select.dataset.activityAssign, employeeId = select.value;
    select.disabled = true;
    await run(() => window.counter.assignActivitySource(sourceId, employeeId), 'Прив’язку джерела збережено.');
  }
});

function openActivitySettings() {
  const rules = snapshot.activity.settings;
  const field = (key, label, min, max, note) => `<label class="field"><span>${label}</span><input name="${key}" type="number" min="${min}" max="${max}" step="1" value="${rules[key]}" required><small>${note}</small></label>`;
  openModal(`<form id="activity-settings-form"><header class="modal-head"><div><h2>Правила моніторингу</h2><p>09:00–18:00 · обід 13:00–14:00 · 8 робочих годин</p></div><button class="icon-button" type="button" data-close-modal aria-label="Закрити">×</button></header><div class="modal-body activity-settings-grid">${field('toleranceMinutes', 'Допустиме відхилення, хв', 0, 60, 'Для першого запису після 09:00 та останнього до 18:00.')}${field('gapMinutes', 'Довга пауза від, хв', 1, 240, 'Обід виключається; пауза означає відсутність браузерних спостережень.')}${field('maxVisitMinutes', 'Межа одного відвідування в оцінці, хв', 1, 120, 'Довгі записи обмежуються, щоб відкрита вкладка не закривала години без спостережень.')}${field('missingVisitMinutes', 'Запис без тривалості в оцінці, хв', 0, 15, '0 — лише факт відвідування. Інше значення — явне припущення для оцінки.')}<p class="activity-note">Відомі тривалості та вихідні записи зберігаються без зміни. Оцінка перераховується за цими правилами й не змінює табель.</p></div><footer class="modal-foot"><button class="button" type="button" data-close-modal>Скасувати</button><button class="button primary" type="submit">Зберегти правила</button></footer></form>`);
}

async function openActivityDay(date, groupKey) {
  try {
    const detail = await window.counter.getActivityDay({ date, groupKey }), { row, settings: rules } = detail;
    const midnight = Date.parse(date + 'T00:00:00Z');
    const span = (from, to, kind, title) => `<rect x="${(from - midnight) / 86400000 * 1000}" y="8" width="${Math.max(0.7, (to - from) / 86400000 * 1000)}" height="30" class="activity-timeline-${kind}"><title>${h(title)}</title></rect>`;
    const lunchStart = Date.parse(date + 'T' + rules.lunchStart + ':00Z'), lunchEnd = Date.parse(date + 'T' + rules.lunchEnd + ':00Z');
    const start = Date.parse(date + 'T' + rules.startTime + ':00Z'), end = Date.parse(date + 'T' + rules.endTime + ':00Z');
    const marks = detail.journal.map(visit => `<line x1="${(visit.timestamp - midnight) / 86400000 * 1000}" x2="${(visit.timestamp - midnight) / 86400000 * 1000}" y1="2" y2="45" class="activity-timeline-mark"><title>${h(visit.time + ' · ' + visit.browser + ' · ' + (visit.title || visit.domain))}</title></line>`).join('');
    const sortedGaps = row.gaps.slice().sort((a, b) => b.durationMs - a.durationMs);
    openModal(`<header class="modal-head"><div><span class="page-eyebrow">${h(formatDate(date))} · ${h(row.presence)}</span><h2>${h(row.name)}</h2><p>Перший запис ${row.first || '—'} · останній ${row.last || '—'} · ${row.recordCount} записів</p></div><button class="icon-button" type="button" data-close-modal aria-label="Закрити">×</button></header><div class="modal-body activity-day-detail"><div class="activity-detail-totals"><div><small>Оцінка активності</small><strong>${activityDuration(row.activeMs)}</strong></div><div><small>Норма</small><strong>${activityDuration(row.expectedMs)}</strong></div><div><small>Бракує до норми (оцінка)</small><strong>${activityDuration(row.deficitMs)}</strong></div></div><div class="activity-timeline" role="img" aria-label="Шкала дня: записи, оцінка активності, паузи та обід"><svg viewBox="0 0 1000 48" preserveAspectRatio="none">${span(start, end, 'work', 'Робочий графік')}${row.gaps.map(gap => span(gap.start, gap.end, 'gap', `${gap.from}–${gap.to}: без спостережень`)).join('')}${row.intervals.map(interval => span(interval.start, interval.end, 'active', `${interval.from}–${interval.to}: оцінка активності`)).join('')}${span(lunchStart, lunchEnd, 'lunch', 'Обід не враховується')}${marks}</svg><div class="activity-time-labels">${['00:00', '06:00', '12:00', '18:00', '24:00'].map(label => `<span>${label}</span>`).join('')}</div></div><div class="activity-legend"><span class="activity-legend-active">Оцінка активності</span><span class="activity-legend-gap">Без спостережень</span><span class="activity-legend-lunch">Обід</span><span>Вертикальні риски — записи історії</span></div>${row.anomalies.length ? `<h3>Відхилення</h3><ul>${row.anomalies.map(item => `<li>${h(item.label)}${item.durationMs == null ? '' : ' · ' + activityDuration(item.durationMs)}</li>`).join('')}</ul>` : `<p>${row.recordCount ? 'Відхилень за поточними правилами не знайдено.' : 'Немає даних за цей день. Це не позначка відсутності.'}</p>`}${row.gaps.length ? `<details open><summary>Проміжки без спостережень · від довших · ${row.gaps.length}</summary><div class="activity-gap-list">${sortedGaps.map(gap => `<div class="${gap.durationMs >= rules.gapMinutes * 60000 ? 'activity-warning' : ''}"><span>${h(gap.from)}–${h(gap.to)}</span><strong>${activityDuration(gap.durationMs)}</strong><small>${gap.kind === 'start' ? 'На початку дня' : gap.kind === 'end' ? 'Наприкінці дня' : 'Між спостереженнями'}</small></div>`).join('')}</div></details>` : ''}<p class="activity-note">Межа відвідування ${rules.maxVisitMinutes} хв; для запису без тривалості ${rules.missingVisitMinutes} хв. Без тривалості: ${row.missingCount}; довгих записів обмежено: ${row.cappedCount}. Оцінка не підтверджує фактичну тривалість роботи.</p><details><summary>Усі відвідування · ${detail.journal.length}</summary><div class="activity-day-visits">${detail.journal.map(visit => `<article><time>${h(visit.time)}</time><div><strong>${h(visit.title || visit.domain)}</strong><small>${h(visit.browser)} · ${visit.durationMs == null ? 'Тривалість невідома' : activityDuration(visit.durationMs)}</small><span class="activity-url" title="${h(visit.url)}">${h(visit.url)}</span></div></article>`).join('')}</div></details></div><footer class="modal-foot"><button class="button primary" data-close-modal>Закрити</button></footer>`, true);
  } catch (error) { showToast(error.message || String(error), { error: true }); }
}

async function handleActivityClick(event) {
  const view = event.target.closest('[data-activity-view]');
  if (view) { activityUi.view = view.dataset.activityView; activityUi.page = 0; renderShell(); return true; }
  const page = event.target.closest('[data-activity-page]');
  if (page) { activityUi.page = Math.max(0, activityUi.page + Number(page.dataset.activityPage)); renderShell(); return true; }
  const sort = event.target.closest('[data-activity-sort]');
  if (sort) { activityUi.direction = activityUi.sort === sort.dataset.activitySort ? -activityUi.direction : 1; activityUi.sort = sort.dataset.activitySort; activityUi.page = 0; renderShell(); return true; }
  if (event.target.closest('[data-activity-settings]')) { openActivitySettings(); return true; }
  const day = event.target.closest('[data-activity-day]');
  if (day) { await openActivityDay(day.dataset.activityDay, day.dataset.activityGroup); return true; }
  const remove = event.target.closest('[data-activity-remove]');
  if (remove) {
    if (await confirmAction('Видалити це завантаження? Записи, які є в інших файлах, залишаться. Дію можна скасувати.', true)) {
      await run(() => window.counter.removeActivityImport(remove.dataset.activityRemove), 'Завантаження видалено.');
    }
    return true;
  }
  const exportButton = event.target.closest('[data-activity-export]');
  if (exportButton) {
    try { const result = await window.counter.exportActivity(activityFilter(), exportButton.dataset.activityExport); if (result) showToast('Звіт збережено.'); }
    catch (error) { showToast(error.message || String(error), { error: true }); }
    return true;
  }
  return false;
}
async function handleActivitySubmit(event) {
  const form = event.target, data = new FormData(form);
  if (form.id === 'activity-filter-form') {
    activityUi.startDate = String(data.get('startDate')); activityUi.endDate = String(data.get('endDate'));
    activityUi.employeeId = String(data.get('employeeId') || ''); activityUi.query = String(data.get('query') || '');
    activityUi.onlyAnomalies = data.has('onlyAnomalies'); activityUi.page = 0;
    await loadActivityReport(); return true;
  }
  if (form.id === 'activity-settings-form') {
    const input = Object.fromEntries(['toleranceMinutes', 'gapMinutes', 'maxVisitMinutes', 'missingVisitMinutes'].map(key => [key, Number(data.get(key))]));
    const result = await run(() => window.counter.updateActivitySettings(input), 'Правила збережено; оцінку перераховано.');
    if (result) closeModal(form); return true;
  }
  if (form.id === 'activity-import-form') {
    const assignments = Object.fromEntries([...data].filter(([key]) => key.startsWith('source:')).map(([key, value]) => [key.slice(7), value || null]));
    const result = await run(() => window.counter.importActivity({ token: form.dataset.token, assignments, acceptIssues: data.has('acceptIssues') }), null);
    if (result) {
      activityUi.endDate = result.endDate;
      const earliest = new Date(Date.parse(result.endDate + 'T00:00:00Z') - 365 * 86400000).toISOString().slice(0, 10);
      activityUi.startDate = result.startDate < earliest ? earliest : result.startDate;
      activityUi.employeeId = ''; activityUi.query = ''; activityUi.onlyAnomalies = false; activityUi.page = 0;
      closeModal(form); await loadActivityReport();
      showToast(`Додано ${result.newCount} записів із ${result.importedFiles} файлів. Повторів записів: ${result.duplicateCount}; повторів файлів: ${result.skippedFiles}.`, { undo: true });
    }
    return true;
  }
  return false;
}
