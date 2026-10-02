const planner = require('./planner');
const { calculateAnalyticsReport } = require('./analytics');
const journal = require('./journal');
const html = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const dateIn = (date, from, to) => date >= from && date <= to;
const atDate = value => value ? planner.dateKey(new Date(value)) : '';
function dutyFacts(state, startDate, endDate, employeeId = '') {
  return (state.dutySchedules || []).flatMap(schedule => Object.values(schedule.id === state.activeDutyScheduleId ? state.duties.assignments : schedule.data.assignments)
    .filter(item => dateIn(item.date, startDate, endDate))
    .flatMap(item => (item.employeeIds || []).filter(id => !employeeId || id === employeeId).map(id => ({
      date: item.date, employeeId: id, name: state.employees.find(person => person.id === id)?.name || 'Працівник з історії',
      scheduleId: schedule.id, scheduleName: schedule.name, realized: (item.realizedEmployeeIds || []).includes(id),
    })))).sort((a, b) => a.date.localeCompare(b.date) || a.scheduleName.localeCompare(b.scheduleName, 'uk'));
}
function employeeOverview(state, input, now = new Date()) {
  const person = state.employees.find(employee => employee.id === input.employeeId);
  if (!person) throw new Error('Працівника не знайдено.');
  const startDate = input.startDate || `${planner.dateKey(now).slice(0, 7)}-01`, endDate = input.endDate || planner.dateKey(now);
  const dates = journal.datesBetween(startDate, endDate);
  if (dates.length > 366) throw new Error('Для картки працівника виберіть період до 366 днів.');
  const analytics = calculateAnalyticsReport(state, { startDate, endDate, scope: 'all', employeeIds: [person.id], compare: false }, now);
  return { employee: person, startDate, endDate, generatedAt: now.toISOString(), metrics: analytics.rows[0],
    days: dates.filter(date => date <= planner.dateKey(now)).map(date => journal.cell(state, person, date)),
    receipts: analytics.receipts, duties: dutyFacts(state, startDate, endDate, person.id),
    timeOff: (state.timeOffEntries || []).filter(entry => entry.employeeId === person.id && dateIn(entry.date, startDate, endDate)),
    tasks: planner.selectTasks(state, { employeeId: person.id, includeArchived: true }, now),
    workload: { openTasks: (state.tasks || []).filter(task => planner.active(task) && task.assigneeIds.includes(person.id)).length,
      overdueTasks: (state.tasks || []).filter(task => planner.active(task) && task.assigneeIds.includes(person.id) && planner.urgency(task, now).key === 'overdue').length } };
}
function weeklySummary(state, anchor = planner.dateKey(), now = new Date()) {
  if (!planner.validDate(anchor)) throw new Error('Некоректна дата тижня.');
  const { startDate, endDate } = planner.range(anchor, 'week'), today = planner.dateKey(now);
  const analytics = calculateAnalyticsReport(state, { startDate, endDate, scope: 'all', compare: false }, now);
  const scheduledTasks = (state.tasks || []).filter(task => dateIn(task.dueDate, startDate, endDate));
  const completedTasks = (state.tasks || []).filter(task => task.status === 'done' && dateIn(atDate(task.completedAt), startDate, endDate));
  const overdueTasks = planner.sortTasks((state.tasks || []).filter(task => planner.active(task) && planner.urgency(task, now).key === 'overdue'), now);
  const decisions = planner.sortTasks((state.tasks || []).filter(task => planner.active(task) && (task.status === 'blocked'
    || task.assigneeIds.some(id => !state.employees.find(person => person.id === id)?.active))), now);
  const duties = dutyFacts(state, startDate, endDate).filter(item => item.scheduleId === state.activeDutyScheduleId);
  const people = analytics.rows.map(row => ({ ...row,
    openTasks: (state.tasks || []).filter(task => planner.active(task) && task.assigneeIds.includes(row.employeeId)).length,
    overdueTasks: overdueTasks.filter(task => task.assigneeIds.includes(row.employeeId)).length,
    tasksCompleted: completedTasks.filter(task => task.assigneeIds.includes(row.employeeId)).length,
    duties: duties.filter(item => item.employeeId === row.employeeId).length,
    realizedDuties: duties.filter(item => item.employeeId === row.employeeId && item.realized).length }));
  return { startDate, endDate, today, generatedAt: now.toISOString(), actualThrough: today < startDate ? null : today < endDate ? today : endDate,
    scheduleId: state.activeDutyScheduleId, scheduleName: state.dutySchedules.find(item => item.id === state.activeDutyScheduleId)?.name,
    analytics: analytics.total, people, scheduledTasks, completedTasks, overdueTasks, decisions, duties,
    upcomingTasks: planner.selectTasks(state, { startDate: planner.addDays(endDate, 1), endDate: planner.addDays(endDate, 7), status: 'active' }, now),
    missingRealizations: duties.filter(item => item.date < today && !item.realized),
    employees: state.employees };
}
function buildWeeklyCsv(report) {
  const safe = value => { const str = String(value ?? ''); return `"${(/^[=+@-]/.test(str.trimStart()) ? "'" : '') + str.replaceAll('"', '""')}"`; };
  const rows = [
    ['ЛАД · Тижневе зведення', report.startDate, report.endDate], ['Сформовано', report.generatedAt],
    ['Факти обліку до', report.actualThrough || 'Період ще не настав'], ['Графік', report.scheduleName],
    ['Поточні завдання та їхні статуси — на час формування; спільне завдання враховано у кожного відповідального.'],
    ['Працівник', 'Запити отримано', 'Днів зараховано', 'Пропуски', 'Без позначки', 'Чергування', 'Реалізовано', 'Відкриті завдання зараз', 'Прострочено зараз', 'Завершено завдань за тиждень'],
    ...report.people.map(row => [row.name, row.actualRequestsReceived, row.requestDays, row.missed, row.pending, row.duties, row.realizedDuties, row.openTasks, row.overdueTasks, row.tasksCompleted]),
    [], ['Завдання зі строком у тижні', 'Строк', 'Час', 'Поточний статус', 'Відповідальні', 'Пріоритет', 'Пояснення'],
    ...report.scheduledTasks.map(task => [task.title, task.dueDate, task.dueTime, planner.STATUS_LABELS[task.status], task.assigneeIds.map(id => report.employees.find(person => person.id === id)?.name || id).join(', ') || 'Керівник', planner.PRIORITY_LABELS[task.priority], task.description]),
    [], ['Прострочені завдання зараз', 'Строк'], ...report.overdueTasks.map(task => [task.title, task.dueDate]),
    [], ['Потребує рішення зараз', 'Строк'], ...report.decisions.map(task => [task.title, task.dueDate]),
  ];
  return `\uFEFF${rows.map(row => row.map(safe).join(';')).join('\r\n')}\r\n`;
}
function buildWeeklyHtml(report) {
  const names = task => task.assigneeIds.map(id => report.employees.find(person => person.id === id)?.name || id).join(', ') || 'Керівник';
  const list = tasks => tasks.length ? `<ul>${tasks.map(task => `<li><strong>${html(task.title)}</strong> · ${html(task.dueDate)} ${html(task.dueTime)} · ${html(names(task))}${task.description ? `<p>${html(task.description)}</p>` : ''}${task.status === 'blocked' ? `<p>Потрібне рішення: ${html(task.history.findLast(entry => entry.type === 'status' && entry.details.status === 'blocked')?.details.reason || 'Перевірте історію завдання')}</p>` : ''}</li>`).join('')}</ul>` : '<p>Немає.</p>';
  return `<!doctype html><html lang="uk"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>ЛАД · Тижневе зведення</title><style>
  @page{size:A4;margin:16mm}body{font:12pt 'Segoe UI',Arial,sans-serif;color:#182b42;line-height:1.4}h1{font-size:23pt;margin:0}h2{break-after:avoid;font-size:15pt;color:#274f7c;margin:20px 0 6px}p{margin:6px 0}small{font-size:10pt;color:#47596d}table{width:100%;border-collapse:collapse;font-size:10pt;table-layout:fixed}th,td{padding:4px;border:1px solid #bac7d3;text-align:left;overflow-wrap:anywhere}th{background:#edf2f8}thead{display:table-header-group}tr,li{break-inside:avoid}ul{padding-left:20px}li{margin:8px 0}li p{white-space:pre-wrap}header{border-bottom:3px solid #b29353;padding-bottom:12px}.numbers{display:flex;gap:22px;margin:16px 0}.numbers strong{font-size:21pt;display:block}footer{margin-top:20px;border-top:1px solid #bac7d3;padding-top:8px}</style><header><h1>ЛАД</h1><p>Люди. Аналітика. Документи.</p><h2>Тижневе зведення · ${html(report.startDate)} — ${html(report.endDate)}</h2><small>Сформовано: ${html(new Date(report.generatedAt).toLocaleString('uk-UA'))}. Факти табеля — до ${html(report.actualThrough || 'початку періоду')}.</small></header>
  <div class="numbers"><div><strong>${report.completedTasks.length}</strong>завдань виконано за тиждень</div><div><strong>${report.overdueTasks.length}</strong>прострочено зараз</div><div><strong>${report.analytics.actualRequestsReceived}</strong>запитів отримано</div></div>
  <h2>Робота команди</h2><table><colgroup><col style="width:25%"><col style="width:11%"><col style="width:7%"><col style="width:13%"><col style="width:11%"><col style="width:15%"><col style="width:18%"></colgroup><thead><tr><th>Працівник</th><th>Запити</th><th>Дні</th><th>Пропуски</th><th>Очікує</th><th>Черг. / реаліз.</th><th>Відкриті / прострочені</th></tr></thead><tbody>${report.people.map(row => `<tr><td>${html(row.name)}</td><td>${row.actualRequestsReceived}</td><td>${row.requestDays}</td><td>${row.missed}</td><td>${row.pending}</td><td>${row.duties} / ${row.realizedDuties}</td><td>${row.openTasks} / ${row.overdueTasks}</td></tr>`).join('')}</tbody></table><small>Чергування: ${html(report.scheduleName)}. Запити — фактична кількість у документах; дні — зараховані дати табеля; «Очікує» — робочі дні без позначки до поточної дати. Спільні завдання показані у кожного відповідального.</small>
  <h2>Виконано за тиждень</h2>${list(report.completedTasks)}<h2>Прострочено на час формування</h2>${list(report.overdueTasks)}<h2>Потребує рішення або переназначення зараз</h2>${list(report.decisions)}<h2>Завдання наступного тижня</h2>${list(report.upcomingTasks)}<footer><small>Поточні статуси завдань відображено на час формування. Архівні працівники включені для збереження фактів періоду. Майбутні дні виключені з фактичного обліку. Документ можна друкувати зі збереженого PDF.</small></footer></html>`;
}
module.exports = { employeeOverview, weeklySummary, buildWeeklyCsv, buildWeeklyHtml, dutyFacts };
