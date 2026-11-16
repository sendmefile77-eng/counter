const planner = require('./planner');
const work = require('./work');
const productivity = require('./productivity');
const journal = require('./journal');
const html = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const dateIn = (date, from, to) => date >= from && date <= to;
const atDate = value => value ? planner.dateKey(new Date(value)) : '';
function dutyFacts(state, startDate, endDate, employeeId = '') {
  return (state.dutySchedules || []).flatMap(schedule => Object.values(schedule.id === state.activeDutyScheduleId ? state.duties.assignments : schedule.data.assignments)
    .filter(item => dateIn(item.date, startDate, endDate))
    .flatMap(item => (item.employeeIds || []).filter(id => !employeeId || id === employeeId).map(id => ({
      date: item.date, employeeId: id, name: state.employees.find(person => person.id === id)?.name || 'Працівник з історії',
      scheduleId: schedule.id, scheduleName: schedule.name, mode: item.realizationModes?.[id] || null, realized: (item.realizedEmployeeIds || []).includes(id),
    })))).sort((a, b) => a.date.localeCompare(b.date) || a.scheduleName.localeCompare(b.scheduleName, 'uk'));
}
function employeeOverview(state, input, now = new Date()) {
  const person = state.employees.find(employee => employee.id === input.employeeId);
  if (!person) throw new Error('Працівника не знайдено.');
  const startDate = input.startDate || `${planner.dateKey(now).slice(0, 7)}-01`, endDate = input.endDate || planner.dateKey(now);
  const dates = journal.datesBetween(startDate, endDate);
  if (dates.length > 366) throw new Error('Для картки працівника виберіть період до 366 днів.');
  const analytics = productivity.report(state, { startDate, endDate, scope: 'all', employeeIds: [person.id], compare: false }, now);
  return { employee: person, startDate, endDate, generatedAt: now.toISOString(), metrics: analytics.rows[0],
    days: dates.filter(date => date <= planner.dateKey(now)).map(date => journal.cell(state, person, date, planner.dateKey(now))),
     duties: dutyFacts(state, startDate, endDate, person.id),
    timeOff: (state.timeOffEntries || []).filter(entry => entry.employeeId === person.id && dateIn(entry.date, startDate, endDate)),
    tasks: planner.selectTasks(state, { employeeId: person.id, includeArchived: true }, now),
    workload: { openTasks: (state.tasks || []).filter(task => planner.active(task) && task.assigneeIds.includes(person.id)).length,
      overdueTasks: (state.tasks || []).filter(task => planner.active(task) && task.assigneeIds.includes(person.id) && planner.urgency(task, now).key === 'overdue').length } };
}
function weeklySummary(state, anchor = planner.dateKey(), now = new Date()) {
  if (!planner.validDate(anchor)) throw new Error('Некоректна дата тижня.');
  const { startDate, endDate } = planner.range(anchor, 'week'), today = planner.dateKey(now);
  const actualThrough = today < startDate ? null : today < endDate ? today : endDate;
  const asOf = actualThrough || today, tasks = productivity.taskSnapshot(state.tasks || [], asOf);
  const analytics = productivity.report(state, { startDate, endDate, scope: 'all', compare: false }, now);
  const scheduledTasks = tasks.filter(task => dateIn(task.dueDate, startDate, endDate));
  const completedTasks = actualThrough ? tasks.filter(task => task.status === 'done' && dateIn(atDate(task.completedAt), startDate, actualThrough)) : [];
  const overdueTasks = actualThrough ? scheduledTasks.filter(task => planner.active(task) && (task.dueDate < asOf || task.dueDate === asOf && planner.urgency(task, now).key === 'overdue')) : [];
  const decisions = scheduledTasks.filter(task => task.status === 'blocked' || !task.assigneeIds.length);
  const duties = dutyFacts(state, startDate, endDate);
  const people = analytics.rows.filter(row => row.calendarWorkdays || row.objectsReceived || scheduledTasks.some(task => task.assigneeIds.includes(row.employeeId))).map(row => ({ ...row,
    openTasks: scheduledTasks.filter(task => planner.active(task) && task.assigneeIds.includes(row.employeeId)).length,
    overdueTasks: overdueTasks.filter(task => task.assigneeIds.includes(row.employeeId)).length,
    tasksCompleted: completedTasks.filter(task => task.assigneeIds.includes(row.employeeId)).length,
    duties: duties.filter(item => item.employeeId === row.employeeId).length,
    realizedDuties: duties.filter(item => item.employeeId === row.employeeId && item.realized && item.date <= asOf).length }));
  return { startDate, endDate, today, generatedAt: now.toISOString(), actualThrough,
    scheduleId: state.activeDutyScheduleId, scheduleName: 'Усі графіки', rules: analytics.rules,
    analytics: analytics.total, people, scheduledTasks, completedTasks, overdueTasks, decisions, duties,
    upcomingTasks: planner.selectTasks(state, { startDate: planner.addDays(endDate, 1), endDate: planner.addDays(endDate, 7), status: 'active' }, now),
    missingRealizations: duties.filter(item => item.date < asOf && !item.realized), employees: state.employees };
}
function buildWeeklyCsv(report) {
  const safe = value => { const str = String(value ?? ''); return '"' + (/^[=+@-]/.test(str.trimStart()) ? "'" : '') + str.replaceAll('"', '""') + '"'; };
  const rows = [['ЛАД · Огляд тижня', report.startDate, report.endDate], ['Стан на', report.actualThrough || 'Тиждень ще не настав'],
    ['Працівник', 'Дні за календарем', 'Відпрацьовано', 'Причини виключення', 'Об’єкти', 'KPI %', 'Завдань виконано', 'Відкрито', 'Прострочено', 'Чергування / реалізовано'],
    ...report.people.map(p => [p.name, p.calendarWorkdays, p.workedDays, Object.entries(p.reasons).map(([key, n]) => `${productivity.labels[key]}: ${n}`).join('; '), p.objectsReceived, p.kpi, p.tasksCompleted, p.openTasks, p.overdueTasks, `${p.duties} / ${p.realizedDuties}`]),
    ['Завдання тижня', 'Строк', 'Статус', 'Опис'], ...report.scheduledTasks.map(task => [task.title, task.dueDate, task.status, task.description || ''])];
  return '\ufeff' + rows.map(row => row.map(safe).join(';')).join('\r\n');
}
function buildWeeklyHtml(report) {
  return `<!doctype html><html lang="uk"><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>ЛАД · Огляд тижня</title><style>body{font:14px Arial;color:#17283c;margin:28px}h1{font-size:28px}table{border-collapse:collapse;width:100%}th,td{padding:10px;border:1px solid #cad3de;text-align:left}th{background:#e8edf4}small{display:block;color:#526379}article{margin:20px 0}li{margin:8px 0}</style><h1>Огляд тижня</h1><p>${html(report.startDate)} — ${html(report.endDate)} · стан на ${html(report.actualThrough || 'тиждень ще не настав')}</p><p>Об’єктів: <b>${report.analytics.objectsReceived}</b> · відпрацьовано: <b>${report.analytics.workedDays}</b> · KPI: <b>${report.analytics.kpi ?? '—'}%</b></p><table><tr><th>Працівник</th><th>Дні роботи</th><th>Об’єкти</th><th>KPI</th><th>Завдання</th></tr>${report.people.map(p => `<tr><td>${html(p.name)}</td><td>${p.workedDays} із ${p.calendarWorkdays}<small>${html(Object.entries(p.reasons).map(([key, n]) => `${productivity.labels[key]}: ${n}`).join('; '))}</small></td><td>${p.objectsReceived}</td><td>${p.kpi ?? '—'}%</td><td>${p.tasksCompleted} виконано / ${p.overdueTasks} прострочено</td></tr>`).join('')}</table><article><h2>Завдання тижня</h2><ul>${report.scheduledTasks.map(task => `<li>${html(task.title)} · ${html(task.dueDate)} · ${html(task.status)}<p style="white-space:pre-wrap">${html(task.description || '')}</p></li>`).join('') || '<li>Завдань немає.</li>'}</ul></article></html>`;
}
module.exports = { employeeOverview, weeklySummary, buildWeeklyCsv, buildWeeklyHtml, dutyFacts };
