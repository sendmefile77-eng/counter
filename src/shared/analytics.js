const journal = require('./journal');
const { dateKeyFromDate, addDays } = require('./domain');

const submitted = new Set(['submitted', 'submitted_late', 'submitted_advance']);
const absence = new Set(['personal_permission', 'sick', 'vacation', 'day_off', 'holiday']);
const metrics = ['calendarWorkdays', 'workedDays', 'requestDays', 'documentDays', 'manualDays',
  'submittedOnTime', 'submittedLate', 'submittedAdvance', 'missed', 'pending', 'otherTasks',
  'personalPermission', 'sick', 'vacation', 'dayOff', 'holiday', 'absent', 'requestRequiredDays',
  'documentsReceived', 'actualRequestsReceived', 'complexRequests', 'unallocatedCredit'];
const statusMetric = { submitted: 'submittedOnTime', submitted_late: 'submittedLate', submitted_advance: 'submittedAdvance',
  missed: 'missed', pending: 'pending', other_tasks: 'otherTasks', personal_permission: 'personalPermission',
  sick: 'sick', vacation: 'vacation', day_off: 'dayOff', holiday: 'holiday' };
const receiptMetrics = new Set(['documentsReceived', 'actualRequestsReceived', 'complexRequests', 'unallocatedCredit']);

function rangeDates(startDate, endDate) {
  journal.datesBetween(startDate, startDate);
  journal.datesBetween(endDate, endDate);
  if (startDate > endDate) throw new Error('Дата «Від» має бути не пізнішою за дату «До».');
  const length = Math.round((Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86400000) + 1;
  if (length > 3660) throw new Error('Виберіть період до 3660 днів.');
  return Array.from({ length }, (_, i) => addDays(startDate, i));
}

function selectedEmployees(state, filter) {
  const scope = filter.scope || 'active';
  if (!['active', 'archive', 'all'].includes(scope)) throw new Error('Невідома група працівників.');
  const available = state.employees.filter((person) => scope === 'all' || (scope === 'active' ? person.active : !person.active));
  if (filter.employeeIds == null) return available;
  if (!Array.isArray(filter.employeeIds) || !filter.employeeIds.length) throw new Error('Оберіть хоча б одного працівника.');
  const ids = new Set(filter.employeeIds);
  if ([...ids].some((id) => !available.some((person) => person.id === id))) throw new Error('Працівник не входить до вибраної групи. Оновіть вибір.');
  return available.filter((person) => ids.has(person.id));
}

function blank() { return Object.fromEntries(metrics.map((key) => [key, 0])); }
function finalize(row) {
  row.requestRequiredDays = row.calendarWorkdays - row.otherTasks - row.absent;
  row.completionPercent = row.requestRequiredDays ? Math.round(row.requestDays * 1000 / row.requestRequiredDays) / 10 : null;
  return row;
}
function totalRows(rows) {
  const total = blank();
  for (const row of rows) for (const key of metrics) total[key] += row[key];
  return finalize(total);
}
function factFor(state, person, date) {
  const key = `${person.id}|${date}`;
  const record = state.records[key];
  const override = state.workdayOverrides?.[key];
  const working = state.settings.workdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay()) || Boolean(override);
  if (!working || (!journal.activeOn(person, date) && !record && !override)) return null;
  return { employeeId: person.id, name: person.name, date, status: record?.status || 'pending', record: record || null, override: Boolean(override) };
}
function addFact(row, fact) {
  row.calendarWorkdays += 1;
  const key = statusMetric[fact.status];
  if (key) row[key] += 1;
  if (absence.has(fact.status)) row.absent += 1;
  if (submitted.has(fact.status)) {
    row.requestDays += 1; row.workedDays += 1;
    row[fact.record?.receiptId ? 'documentDays' : 'manualDays'] += 1;
  }
  if (fact.status === 'other_tasks') row.workedDays += 1;
}
function addReceipt(row, receipt) {
  row.documentsReceived += 1;
  row.actualRequestsReceived += Number(receipt.actualRequestCount) || 0;
  row.complexRequests += receipt.complexTwoDay ? 1 : 0;
  row.unallocatedCredit += Number(receipt.unallocatedCredit) || 0;
}
function collect(state, people, dates) {
  const facts = [];
  const rows = people.map((person) => {
    const row = { employeeId: person.id, name: person.name, active: person.active, ...blank() };
    for (const date of dates) {
      const fact = factFor(state, person, date);
      if (fact) { facts.push(fact); addFact(row, fact); }
    }
    const receipts = dates.length ? state.receipts.filter((receipt) => receipt.employeeId === person.id
      && receipt.receivedDate >= dates[0] && receipt.receivedDate <= dates.at(-1)) : [];
    for (const receipt of receipts) addReceipt(row, receipt);
    return finalize(row);
  });
  return { rows, total: totalRows(rows), facts };
}
function bucketKey(date, groupBy) {
  if (groupBy === 'month') return date.slice(0, 7);
  if (groupBy === 'day') return date;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}
function buildTrend(state, people, dates, facts, groupBy) {
  const buckets = new Map();
  for (const date of dates) {
    const key = bucketKey(date, groupBy);
    if (!buckets.has(key)) buckets.set(key, { key, from: date, to: date, ...blank() });
    else buckets.get(key).to = date;
  }
  if (buckets.size > 124) throw new Error('Забагато точок на графіку. Оберіть тижні або місяці.');
  for (const fact of facts) addFact(buckets.get(bucketKey(fact.date, groupBy)), fact);
  const ids = new Set(people.map((person) => person.id));
  if (dates.length) for (const receipt of state.receipts) {
    if (ids.has(receipt.employeeId) && receipt.receivedDate >= dates[0] && receipt.receivedDate <= dates.at(-1)) {
      addReceipt(buckets.get(bucketKey(receipt.receivedDate, groupBy)), receipt);
    }
  }
  return [...buckets.values()].map(finalize);
}

function calculateAnalyticsReport(state, filter, now = new Date()) {
  const dates = rangeDates(filter.startDate, filter.endDate);
  const today = dateKeyFromDate(now);
  const people = selectedEmployees(state, filter);
  const actualDates = dates.filter((date) => date <= today);
  const futureDates = dates.filter((date) => date > today);
  const current = collect(state, people, actualDates);
  const requestedGroup = filter.groupBy || 'auto';
  if (!['auto', 'day', 'week', 'month'].includes(requestedGroup)) throw new Error('Невідомий крок графіка.');
  const groupBy = requestedGroup === 'auto' ? (actualDates.length <= 31 ? 'day' : actualDates.length <= 120 ? 'week' : 'month') : requestedGroup;
  const trend = buildTrend(state, people, actualDates, current.facts, groupBy);
  let comparison = null;
  if (filter.compare !== false && actualDates.length) {
    const endDate = addDays(actualDates[0], -1);
    const startDate = addDays(endDate, 1 - actualDates.length);
    const previous = collect(state, people, rangeDates(startDate, endDate));
    comparison = { startDate, endDate, total: previous.total,
      delta: Object.fromEntries(metrics.map((key) => [key, current.total[key] - previous.total[key]])),
      completionDelta: current.total.completionPercent == null || previous.total.completionPercent == null
        ? null : Math.round((current.total.completionPercent - previous.total.completionPercent) * 10) / 10 };
  }
  const ids = new Set(people.map((person) => person.id));
  const names = new Map(people.map((person) => [person.id, person.name]));
  const insideByReceipt = new Map();
  for (const fact of current.facts) if (submitted.has(fact.status) && fact.record?.receiptId) {
    const id = fact.record.receiptId;
    if (!insideByReceipt.has(id)) insideByReceipt.set(id, []);
    insideByReceipt.get(id).push(fact.date);
  }
  const receipts = state.receipts.filter((receipt) => ids.has(receipt.employeeId)).map((receipt) => ({
    ...receipt, name: names.get(receipt.employeeId), datesInside: insideByReceipt.get(receipt.id) || [],
    receivedInside: actualDates.length > 0 && receipt.receivedDate >= actualDates[0] && receipt.receivedDate <= actualDates.at(-1),
  })).filter((receipt) => receipt.receivedInside || receipt.datesInside.length)
    .sort((a, b) => b.receivedDate.localeCompare(a.receivedDate) || String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));
  return { startDate: filter.startDate, endDate: filter.endDate, asOfDate: today,
    effectiveEndDate: actualDates.at(-1) || null, employeeIds: [...ids], scope: filter.scope || 'active', groupBy,
    rows: current.rows, total: current.total, trend, comparison, receipts,
    futureCalendarDays: futureDates.length,
    futureWorkdays: people.reduce((sum, person) => sum + futureDates.filter((date) => factFor(state, person, date)).length, 0),
    filter: { startDate: filter.startDate, endDate: filter.endDate, scope: filter.scope || 'active',
      employeeIds: filter.employeeIds == null ? null : [...ids], groupBy: requestedGroup, compare: filter.compare !== false },
  };
}

function matches(fact, metric) {
  if (metric === 'calendarWorkdays') return true;
  if (metric === 'requestRequiredDays') return !absence.has(fact.status) && fact.status !== 'other_tasks';
  if (metric === 'workedDays') return submitted.has(fact.status) || fact.status === 'other_tasks';
  if (metric === 'requestDays') return submitted.has(fact.status);
  if (metric === 'documentDays') return submitted.has(fact.status) && Boolean(fact.record?.receiptId);
  if (metric === 'manualDays') return submitted.has(fact.status) && !fact.record?.receiptId;
  if (metric === 'absent') return absence.has(fact.status);
  return statusMetric[fact.status] === metric;
}

function getAnalyticsDetails(state, { filter, metric, employeeId = null, page = 0, pageSize = 25 }, now = new Date()) {
  if (!metrics.includes(metric)) throw new Error('Невідомий показник.');
  const people = selectedEmployees(state, filter);
  if (employeeId && !people.some((person) => person.id === employeeId)) throw new Error('Працівник не входить до звіту.');
  const selected = employeeId ? people.filter((person) => person.id === employeeId) : people;
  const today = dateKeyFromDate(now);
  const dates = rangeDates(filter.startDate, filter.endDate).filter((date) => date <= today);
  const receipts = new Map(state.receipts.map((receipt) => [receipt.id, receipt]));
  let items;
  if (receiptMetrics.has(metric)) {
    const names = new Map(selected.map((person) => [person.id, person.name]));
    items = dates.length ? state.receipts.filter((receipt) => names.has(receipt.employeeId)
      && receipt.receivedDate >= dates[0] && receipt.receivedDate <= dates.at(-1)
      && (metric !== 'unallocatedCredit' || receipt.unallocatedCredit > 0)
      && (metric !== 'complexRequests' || receipt.complexTwoDay)).map((receipt) => ({
      employeeId: receipt.employeeId, name: names.get(receipt.employeeId), date: receipt.receivedDate,
      receiptId: receipt.id, documentRef: receipt.documentRef || '', note: receipt.note || '', source: 'receipt',
      value: metric === 'documentsReceived' || metric === 'complexRequests' ? 1 : metric === 'actualRequestsReceived' ? Number(receipt.actualRequestCount) || 0 : Number(receipt.unallocatedCredit) || 0,
      dates: receipt.allocations.map((allocation) => allocation.date), status: '',
    })) : [];
  } else {
    items = collect(state, selected, dates).facts.filter((fact) => matches(fact, metric)).map((fact) => ({
      employeeId: fact.employeeId, name: fact.name, date: fact.date, status: fact.status, value: 1,
      receiptId: fact.record?.receiptId || null,
      documentRef: fact.record?.receiptId ? receipts.get(fact.record.receiptId)?.documentRef || 'Документ без назви / відсутній у базі' : '',
      source: fact.record?.receiptId ? 'receipt' : fact.record?.source || 'no_record', note: fact.record?.note || '', override: fact.override,
    }));
  }
  items.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'uk'));
  const size = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || 25)));
  const lastPage = Math.max(0, Math.ceil(items.length / size) - 1);
  const index = Math.min(lastPage, Math.max(0, Math.floor(Number(page) || 0)));
  return { metric, totalRows: items.length, totalValue: items.reduce((sum, item) => sum + item.value, 0),
    page: index, pageSize: size, pages: lastPage + 1, items: items.slice(index * size, (index + 1) * size) };
}

function csvEscape(value) {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
function buildAnalyticsCsv(report, view = 'workers') {
  let rows;
  if (view === 'workers') {
    const columns = [['calendarWorkdays', 'Робочі дні'], ['workedDays', 'Відпрацьовано'], ['requestDays', 'Закрито запитами'],
      ['documentDays', 'За документами'], ['manualDays', 'Без документа'], ['actualRequestsReceived', 'Отримано фактичних запитів'],
      ['documentsReceived', 'Отримано документів'], ['complexRequests', 'Складні запити'],
      ['submittedOnTime', 'Подав вчасно'], ['submittedLate', 'Із запізненням'], ['submittedAdvance', 'Наперед за дозволом'], ['otherTasks', 'Інші завдання'], ['missed', 'Пропуски'], ['pending', 'Без позначки'],
      ['personalPermission', 'Особисті справи'], ['sick', 'Лікарняний'], ['vacation', 'Відпустка'], ['dayOff', 'Відгул'], ['holiday', 'Свято'],
      ['requestRequiredDays', 'Норма запитів у днях'], ['completionPercent', 'Виконання норми, %'], ['unallocatedCredit', 'Нерозподілений залишок']];
    rows = [['Працівник', ...columns.map(([, label]) => label)],
      ...report.rows.map((row) => [row.name, ...columns.map(([key]) => row[key] ?? '')]),
      ['РАЗОМ', ...columns.map(([key]) => report.total[key] ?? '')]];
  } else if (view === 'trend') {
    rows = [['Від', 'До', 'Робочі дні', 'Закрито запитами', 'Інші завдання', 'Відсутність', 'Пропуски', 'Без позначки', 'Фактичні запити', 'Виконання, %'],
      ...report.trend.map((row) => [row.from, row.to, row.calendarWorkdays, row.requestDays, row.otherTasks, row.absent, row.missed, row.pending, row.actualRequestsReceived, row.completionPercent ?? ''])];
  } else if (view === 'documents') {
    rows = [['Дата отримання', 'Працівник', 'Документ', 'Отримано в періоді', 'Фактичні запити', 'Усього зараховано днів', 'Дні цього періоду', 'Дати цього періоду', 'Залишок'],
      ...report.receipts.map((receipt) => [receipt.receivedDate, receipt.name, receipt.documentRef, receipt.receivedInside ? 'Так' : 'Ні',
        receipt.actualRequestCount, receipt.allocations.length, receipt.datesInside.length, receipt.datesInside.join(', '), receipt.unallocatedCredit])];
  } else throw new Error('Невідомий вид експорту.');
  const meta = [['Звіт', report.startDate, report.endDate], ['Працівники', report.rows.map((row) => row.name).join(' · ') || 'Немає'], ['Результати враховано до', report.effectiveEndDate || 'Немає минулих / поточних днів'],
    ['Принцип', 'Запити рахуються за датою отримання документа; закриті дні — за датами табеля.']];
  return `\uFEFF${[...meta, [], ...rows].map((row) => row.map(csvEscape).join(';')).join('\r\n')}\r\n`;
}
module.exports = { calculateAnalyticsReport, getAnalyticsDetails, buildAnalyticsCsv };
