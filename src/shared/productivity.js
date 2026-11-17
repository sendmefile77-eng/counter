(function install(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./work') : root.LadWork,
    typeof module === 'object' && module.exports ? require('./presence') : root.LadPresence);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.LadProductivity = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function factory(work, presence) {
  const excluded = new Set([...presence.absent, ...presence.learning, 'arkan', 'special_assignment', 'day_duty', 'other_tasks']);
  const labels = { ...work.labels, day_duty: 'Денне реалізоване чергування', special_assignment: 'Окреме завдання', default_work: 'Робочий день за календарем' };
  function settings(input = {}) {
    const number = (key, fallback, min, max) => Number.isFinite(Number(input[key])) && Number(input[key]) >= min && Number(input[key]) <= max ? Number(input[key]) : fallback;
    return { daysPerObject: number('daysPerObject', 1.5, 0.1, 100), lowKpiPercent: number('lowKpiPercent', 80, 1, 200),
      minimumKpiDays: Math.round(number('minimumKpiDays', 10, 1, 366)), sickWindowDays: Math.round(number('sickWindowDays', 90, 7, 366)),
      sickEpisodeThreshold: Math.round(number('sickEpisodeThreshold', 3, 1, 100)), sickDaysThreshold: Math.round(number('sickDaysThreshold', 15, 1, 366)) };
  }
  function normalizeAdjustments(input, state) {
    if (input == null) return [];
    if (!Array.isArray(input)) throw Error('Некоректний журнал виправлень об’єктів.');
    const ids = new Set();
    return input.map(item => {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || !state.employees.some(p => p.id === item.employeeId)
        || !work.validDate(item.date) || !Number.isSafeInteger(item.delta) || Math.abs(item.delta) > 100000
        || typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 500 || !Number.isFinite(Date.parse(item.at))) throw Error('Некоректне виправлення кількості об’єктів.');
      ids.add(item.id);
      return { id: item.id, employeeId: item.employeeId, date: item.date, delta: item.delta, reason: item.reason.trim(), at: item.at, actor: String(item.actor || '').slice(0, 80) };
    });
  }
  function objectIndex(state) {
    const map = new Map();
    const add = (id, date, value) => { const key = id + '|' + date; map.set(key, (map.get(key) || 0) + value); };
    for (const item of state.workIntakes || []) add(item.employeeId, item.receivedDate, item.objectCount);
    for (const item of state.resultAdjustments || []) add(item.employeeId, item.date, item.delta);
    return map;
  }
  function dutyIndex(state) {
    const map = new Map();
    for (const schedule of state.dutySchedules || []) {
      const data = schedule.id === state.activeDutyScheduleId ? state.duties : schedule.data;
      for (const assignment of Object.values(data.assignments || {})) for (const id of assignment.employeeIds || []) {
        const key = id + '|' + assignment.date;
        const day = assignment.realizedEmployeeIds?.includes(id) && assignment.realizationModes?.[id] === 'day';
        map.set(key, { scheduled: true, day: day || map.get(key)?.day || false });
      }
    }
    return map;
  }
  function fact(state, person, date, today = work.dateKey(), index = objectIndex(state), duties = dutyIndex(state)) {
    const key = person.id + '|' + date, duty = duties.get(key), mark = presence.get(state, person.id, date);
    const old = state.records[key];
    const status = mark && mark.source !== 'calendar_presence' ? mark.status : excluded.has(old?.status) ? old.status : 'default_work';
    const historical = date < person.createdDate && (mark?.source === 'presence' || old && old.source !== 'automatic_close' || index.get(key) > 0);
    const active = work.activeOn(person, date) || Boolean(historical), scheduled = active && (work.isWorkday(state, person.id, date) || Boolean(duty)) && !(mark?.status === 'weekend' && mark.source !== 'calendar_presence');
    const actualStatus = duty?.day && !excluded.has(status) ? 'day_duty' : status;
    const actual = active && date <= today;
    return { employeeId: person.id, name: person.name, date, status: actualStatus, note: mark?.note || old?.note || '',
      scheduled, worked: Boolean(actual && scheduled && !excluded.has(actualStatus)), excluded: Boolean(actual && scheduled && excluded.has(actualStatus)),
      legacyResultUnknown: Boolean(actual && work.confirmed.has(old?.status) && !old.workIntakeId && !index.has(key)),
      objects: date <= today ? index.get(key) || 0 : 0, future: date > today, outside: !active, duty: Boolean(duty), dayDuty: Boolean(duty?.day) };
  }
  function setObjects(state, input, now = new Date()) {
    const person = state.employees.find(p => p.id === input?.employeeId), date = input?.date, count = Number(input?.count), reason = String(input?.reason || '').trim();
    if (!person || !work.validDate(date) || date > work.dateKey(now) || !work.trackableOn(person, date)) throw Error('Оберіть працівника та минулу або поточну дату в періоді роботи.');
    if (!Number.isSafeInteger(count) || count < 0 || count > 100000) throw Error('Кількість об’єктів: ціле число від 0 до 100000.');
    if (!reason || reason.length > 500) throw Error('Поясніть внесення або виправлення об’єктів (до 500 символів).');
    const before = objectIndex(state).get(person.id + '|' + date) || 0;
    if (input.expectedCount !== before) throw Error('Кількість змінилася. Відкрийте день і перевірте ще раз.');
    const id = globalThis.crypto.randomUUID(), at = now.toISOString(), actor = state.settings.operatorName || 'Керівник';
    state.resultAdjustments ||= [];
    state.resultAdjustments.push({ id, employeeId: person.id, date, delta: count - before, reason, at, actor });
    state.audit.push({ id: globalThis.crypto.randomUUID(), at, action: count === before ? 'object_result_verified' : 'object_result_corrected', details: { employeeId: person.id, date, before, count, reason, actor } });
    state.audit = state.audit.slice(-5000);
    return { before, count };
  }
  function blank() { return { calendarWorkdays: 0, workedDays: 0, objectsReceived: 0, legacyUnknownDays: 0, excludedDays: 0, reasons: {}, dates: [], onsiteDays: 0, zkpDays: 0, trainingDays: 0, arkanDays: 0, absent: 0, tasksCompleted: 0, overdueTasks: 0 }; }
  function add(row, item) {
    if (!item.future && item.scheduled) {
      row.calendarWorkdays++;
      if (item.worked) row.workedDays++;
      if (item.excluded) { row.excludedDays++; row.reasons[item.status] = (row.reasons[item.status] || 0) + 1; }
      if (item.status === 'zkp') row.zkpDays++;
      if (item.status === 'default_work' || item.status === 'onsite') row.onsiteDays++;
      if (presence.learning.has(item.status)) row.trainingDays++;
      if (item.status === 'arkan') row.arkanDays++;
      if (presence.absent.has(item.status)) row.absent++;
    }
    row.objectsReceived += item.objects;
    if (item.legacyResultUnknown) row.legacyUnknownDays++;
    row.dates.push(item);
  }
  function finish(row, rules) {
    row.expectedObjects = row.workedDays / rules.daysPerObject;
    row.kpi = row.workedDays && !row.legacyUnknownDays ? Math.round(row.objectsReceived * rules.daysPerObject * 1000 / row.workedDays) / 10 : null;
    row.kpiProvisional = row.workedDays < rules.minimumKpiDays;
    return row;
  }
  function taskSnapshot(tasks, asOf) {
    return tasks.filter(task => !task.createdAt || work.dateKey(new Date(task.createdAt)) <= asOf).map(task => {
      const copy = JSON.parse(JSON.stringify(task));
      const history = [...(task.history || [])].sort((a, b) => a.at.localeCompare(b.at));
      for (const event of history.slice().reverse()) if (work.dateKey(new Date(event.at)) > asOf) {
        for (const [key, change] of Object.entries(event.details?.changes || {})) copy[key] = change.before;
        if (event.type === 'status') copy.status = event.details.before;
      }
      const lastDone = history.filter(event => event.type === 'status' && event.details.status === 'done' && work.dateKey(new Date(event.at)) <= asOf).at(-1);
      copy.completedAt = copy.status === 'done' ? lastDone?.at || (task.completedAt && work.dateKey(new Date(task.completedAt)) <= asOf ? task.completedAt : null) : null;
      if (copy.status === 'done' && !copy.completedAt) copy.status = 'open';
      return copy;
    });
  }
  function report(state, filter, now = new Date()) {
    const dates = work.dates(filter.startDate, filter.endDate), today = work.dateKey(now), scope = filter.scope || 'active';
    if (!['active', 'all', 'archive'].includes(scope)) throw Error('Невідома група працівників.');
    if (filter.employeeIds != null && (!Array.isArray(filter.employeeIds) || filter.employeeIds.some(id => !state.employees.some(p => p.id === id)))) throw Error('Оберіть наявних працівників.');
    const ids = filter.employeeIds ? new Set(filter.employeeIds) : null;
    const people = state.employees.filter(p => (scope === 'all' || p.active === (scope === 'active')) && (!ids || ids.has(p.id)));
    const rules = settings(state.settings.productivity), index = objectIndex(state), duties = dutyIndex(state), facts = [], total = blank();
    const snapshotTasks = taskSnapshot(state.tasks || [], filter.endDate < today ? filter.endDate : today);
    const rows = people.map(person => {
      const row = { ...blank(), employeeId: person.id, name: person.name };
      for (const date of dates) { const value = fact(state, person, date, today, index, duties); facts.push(value); add(row, value); add(total, value); }
      const tasks = snapshotTasks.filter(task => task.assigneeIds.includes(person.id));
      row.tasksCompleted = tasks.filter(task => task.status === 'done' && task.completedAt && work.dateKey(new Date(task.completedAt)) >= filter.startDate && work.dateKey(new Date(task.completedAt)) <= filter.endDate).length;
      const cutoff = filter.endDate < today ? filter.endDate : today, clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      row.overdueTasks = tasks.filter(task => !['done', 'cancelled'].includes(task.status) && task.dueDate >= filter.startDate
        && (task.dueDate < cutoff || task.dueDate === cutoff && (cutoff < today || task.dueTime && task.dueTime < clock))).length;
      return finish(row, rules);
    });
    finish(total, rules);
    const groupBy = ['day', 'week', 'month'].includes(filter.groupBy) ? filter.groupBy : dates.length > 60 ? 'month' : 'week';
    const buckets = new Map();
    for (const item of facts) {
      const day = new Date(item.date + 'T12:00:00Z').getUTCDay();
      const key = groupBy === 'month' ? item.date.slice(0, 7) : groupBy === 'week' ? work.addDays(item.date, -((day + 6) % 7)) : item.date;
      if (!buckets.has(key)) buckets.set(key, { ...blank(), key, from: item.date, to: item.date });
      const bucket = buckets.get(key); bucket.to = item.date > bucket.to ? item.date : bucket.to; add(bucket, item);
    }
    const asOf = filter.endDate < today ? filter.endDate : today, riskStart = work.addDays(asOf, 1 - rules.sickWindowDays), anomalies = [];
    for (const row of rows) {
      if (row.kpi !== null && !row.kpiProvisional && row.kpi < rules.lowKpiPercent) anomalies.push({ employeeId: row.employeeId, name: row.name, kind: 'kpi', title: 'Низький KPI', detail: `${row.kpi}% за ${row.workedDays} робочих днів; поріг ${rules.lowKpiPercent}%`, dates: row.dates.filter(d => d.worked).map(d => d.date) });
      const person = people.find(p => p.id === row.employeeId), sick = work.dates(riskStart, asOf).filter(date => work.activeOn(person, date) && presence.get(state, person.id, date)?.status === 'sick');
      const episodes = sick.filter((date, i) => !i || work.addDays(sick[i - 1], 1) !== date).length;
      const sickWorkdays = sick.filter(date => work.isWorkday(state, person.id, date)).length;
      row.sickEpisodes = episodes; row.sickWindowDays = sickWorkdays;
      if (episodes >= rules.sickEpisodeThreshold || sickWorkdays >= rules.sickDaysThreshold) anomalies.push({ employeeId: row.employeeId, name: row.name, kind: 'sick', title: 'Лікарняні: перевірити частоту', detail: `${sickWorkdays} робочих днів, ${episodes} епізодів за ${rules.sickWindowDays} днів (${riskStart} — ${asOf}); пороги ${rules.sickDaysThreshold} днів / ${rules.sickEpisodeThreshold} епізоди`, dates: sick });
      if (row.overdueTasks) anomalies.push({ employeeId: row.employeeId, name: row.name, kind: 'tasks', title: 'Прострочені завдання періоду', detail: `${row.overdueTasks} завдань потребують перевірки`, dates: [] });
    }
    const result = { filter: { ...filter, scope, groupBy }, startDate: filter.startDate, endDate: filter.endDate, asOfDate: today, rows, total, facts,
      rules, anomalies, groupBy, trend: [...buckets.values()].map(b => finish(b, rules)), employeeIds: people.map(p => p.id),
      legacyDayCount: total.legacyUnknownDays,
      intakes: (state.workIntakes || []).filter(i => people.some(p => p.id === i.employeeId) && i.receivedDate >= filter.startDate && i.receivedDate <= filter.endDate) };
    const actualDays = dates.filter(date => date <= today).length;
    if (filter.compare && actualDays) {
      const previous = report(state, { ...filter, employeeIds: people.map(p=>p.id), startDate: work.addDays(filter.startDate, -actualDays), endDate: work.addDays(filter.startDate, -1), compare: false }, now);
      result.previous = { startDate: previous.startDate, endDate: previous.endDate, rows: previous.rows, total: previous.total };
    }
    return result;
  }
  function csv(data, view = 'workers') {
    const safe = value => { const text = String(value ?? ''); return '"' + (/^[=+@-]/.test(text.trimStart()) ? "'" : '') + text.replaceAll('"', '""') + '"'; };
    const lines = view === 'days' ? [['Працівник', 'Дата', 'Робочий день', 'Причина', 'Об’єкти', 'Пояснення'], ...data.facts.map(f => [f.name, f.date, Number(f.worked), labels[f.status] || f.status, f.objects, f.note])]
      : [['Працівник / період', 'Планові дні', 'Відпрацьовано', 'Причини виключення', 'Об’єкти', 'KPI %'], ...(view === 'trend' ? data.trend : data.rows).map(r => [r.name || r.key, r.calendarWorkdays, r.workedDays, Object.entries(r.reasons).map(([key, n]) => `${labels[key]}: ${n}`).join('; '), r.objectsReceived, r.kpi])];
    return '\ufeff' + lines.map(line => line.map(safe).join(';')).join('\r\n');
  }
  return { settings, excluded, labels, normalizeAdjustments, objectIndex, dutyIndex, fact, setObjects, taskSnapshot, report, csv };
}));
