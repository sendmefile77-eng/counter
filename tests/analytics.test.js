const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../src/shared/domain');
const { calculateAnalyticsReport, getAnalyticsDetails, buildAnalyticsCsv } = require('../src/shared/analytics');
const now = new Date(2026, 9, 2, 12);
const filter = { startDate: '2026-09-28', endDate: '2026-10-02', scope: 'active', employeeIds: null, groupBy: 'auto', compare: true };
function fixture() {
  const created = new Date(2026, 8, 1, 9);
  const state = domain.defaultState(created); state.settings.automaticClose = false;
  const people = ['Іваненко', 'Петренко'].map((name) => domain.createEmployee(state, name, created));
  const [a, b] = people;
  domain.setManualStatus(state, { employeeId: a.id, date: '2026-09-28', status: 'submitted', note: 'Ручна історія' }, now);
  const old = domain.recordSubmission(state, { employeeId: a.id, requestCount: 2, documentRef: 'ДО-ПЕРІОДУ' }, new Date(2026, 8, 25, 12));
  domain.allocateReceiptForward(state, old.id, 1, new Date(2026, 8, 25, 12));
  const complex = domain.recordSubmission(state, { employeeId: a.id, requestCount: 1, complexTwoDay: true, documentRef: 'СКЛАДНИЙ' }, new Date(2026, 8, 30, 12));
  domain.allocateReceiptForward(state, complex.id, 1, new Date(2026, 8, 30, 12));
  domain.recordSubmission(state, { employeeId: a.id, requestCount: 1, documentRef: 'НОВИЙ' }, now);
  for (const [date, status] of [['2026-09-28', 'other_tasks'], ['2026-09-29', 'sick'], ['2026-09-30', 'missed'], ['2026-10-02', 'vacation']]) {
    domain.setManualStatus(state, { employeeId: b.id, date, status, note: 'Підстава' }, now);
  }
  return { state, people, old, complex };
}

test('report separates received requests, document days and manual history without inventing documents', () => {
  const { state, people } = fixture(); const report = calculateAnalyticsReport(state, filter, now);
  const a = report.rows.find((row) => row.employeeId === people[0].id);
  assert.equal(a.actualRequestsReceived, 2); assert.equal(a.documentsReceived, 2);
  assert.equal(a.requestDays, 5); assert.equal(a.documentDays, 4); assert.equal(a.manualDays, 1);
  assert.equal(a.workedDays, 5); assert.equal(a.complexRequests, 1);
  assert.equal(report.total.requestDays, report.total.documentDays + report.total.manualDays);
  const manual = getAnalyticsDetails(state, { filter, metric: 'manualDays' }, now);
  assert.equal(manual.totalValue, 1); assert.equal(manual.items[0].source, 'manual'); assert.equal(manual.items[0].note, 'Ручна історія');
});

test('norm excludes absences and other tasks, and total percentage is weighted by days', () => {
  const { state } = fixture(); const report = calculateAnalyticsReport(state, filter, now);
  assert.equal(report.total.calendarWorkdays, 10); assert.equal(report.total.workedDays, 6);
  assert.equal(report.total.absent, 2); assert.equal(report.total.otherTasks, 1);
  assert.equal(report.total.requestRequiredDays, 7); assert.equal(report.total.completionPercent, 71.4);
  assert.equal(report.rows[0].completionPercent, 100); assert.equal(report.rows[1].completionPercent, 0);
  assert.notEqual(report.total.completionPercent, 50, 'do not average worker percentages');
});

test('future dates do not become pending, misses or norm; future allocations are excluded until their date', () => {
  const { state, people } = fixture();
  const receipt = domain.recordSubmission(state, { employeeId: people[1].id, requestCount: 2 }, now);
  domain.allocateReceiptForward(state, receipt.id, receipt.unallocatedCredit, now);
  assert.ok(receipt.allocations.some((item) => item.date > '2026-10-02'));
  const before = calculateAnalyticsReport(state, filter, now);
  const extended = calculateAnalyticsReport(state, { ...filter, endDate: '2026-10-09' }, now);
  assert.deepEqual(extended.total, before.total); assert.equal(extended.futureCalendarDays, 7);
  assert.equal(extended.futureWorkdays, 10); assert.equal(extended.effectiveEndDate, '2026-10-02');
  assert.ok(extended.trend.every((bucket) => bucket.to <= '2026-10-02'));
  const future = calculateAnalyticsReport(state, { ...filter, startDate: '2026-10-05', endDate: '2026-10-09' }, now);
  assert.equal(future.total.pending, 0); assert.equal(future.total.requestRequiredDays, 0);
  assert.equal(future.total.completionPercent, null); assert.equal(future.comparison, null); assert.deepEqual(future.trend, []);
});

test('zero norm is not shown as 100%; an empty group and a calendar without workdays remain valid', () => {
  const { state } = fixture(); state.settings.workdays = [];
  const report = calculateAnalyticsReport(state, filter, now);
  assert.equal(report.total.requestRequiredDays, 0); assert.equal(report.total.completionPercent, null);
  const empty = calculateAnalyticsReport(domain.defaultState(now), filter, now);
  assert.equal(empty.rows.length, 0); assert.equal(empty.total.completionPercent, null);
  assert.ok(empty.trend.every((row) => row.calendarWorkdays === 0 && row.requestDays === 0));
});

test('comparison uses the immediately preceding equal calendar duration and the same selected people', () => {
  const { state, people } = fixture(); const report = calculateAnalyticsReport(state, { ...filter, employeeIds: [people[0].id] }, now);
  assert.equal(report.comparison.startDate, '2026-09-23'); assert.equal(report.comparison.endDate, '2026-09-27');
  assert.equal(report.comparison.total.requestDays, 1); assert.equal(report.comparison.total.calendarWorkdays, 3);
  assert.equal(report.comparison.delta.requestDays, 4); assert.equal(report.comparison.completionDelta, 66.7);
  assert.equal(calculateAnalyticsReport(state, { ...filter, compare: false }, now).comparison, null);
});

test('trend sums agree with the report for days, weeks and months, including received documents', () => {
  const { state } = fixture();
  for (const groupBy of ['day', 'week', 'month', 'auto']) {
    const report = calculateAnalyticsReport(state, { ...filter, groupBy }, now);
    for (const key of ['calendarWorkdays', 'requestDays', 'workedDays', 'documentDays', 'manualDays', 'missed', 'absent', 'pending', 'otherTasks', 'actualRequestsReceived', 'documentsReceived', 'requestRequiredDays']) {
      assert.equal(report.trend.reduce((sum, bucket) => sum + bucket[key], 0), report.total[key], `${groupBy}: ${key}`);
    }
    assert.equal(report.trend[0].from, filter.startDate); assert.equal(report.trend.at(-1).to, filter.endDate);
  }
});

test('every metric drilldown reconciles with the card and the worker row', () => {
  const { state, people } = fixture(); const report = calculateAnalyticsReport(state, filter, now);
  const keys = Object.keys(report.total).filter((key) => key !== 'completionPercent');
  for (const metric of keys) {
    const all = getAnalyticsDetails(state, { filter, metric }, now);
    assert.equal(all.totalValue, report.total[metric], metric);
    const one = getAnalyticsDetails(state, { filter, metric, employeeId: people[1].id }, now);
    assert.equal(one.totalValue, report.rows[1][metric], `worker: ${metric}`);
  }
});

test('documents received before the period remain visible if they close its days', () => {
  const { state, old } = fixture(); const report = calculateAnalyticsReport(state, filter, now);
  const receipt = report.receipts.find((item) => item.id === old.id);
  assert.equal(receipt.receivedInside, false); assert.deepEqual(receipt.datesInside, ['2026-09-29']);
  assert.equal(report.receipts.filter((item) => item.receivedInside).length, report.total.documentsReceived);
  const details = getAnalyticsDetails(state, { filter, metric: 'documentDays' }, now);
  assert.ok(details.items.some((item) => item.receiptId === old.id && item.documentRef === 'ДО-ПЕРІОДУ'));
});

test('unallocated credits have their own units and receipt-based evidence', () => {
  const { state, people } = fixture();
  const extra = domain.recordSubmission(state, { employeeId: people[1].id, requestCount: 3, documentRef: 'ЗАЛИШОК' }, new Date(2026, 9, 1, 12));
  assert.ok(extra.unallocatedCredit > 0);
  const report = calculateAnalyticsReport(state, filter, now);
  const details = getAnalyticsDetails(state, { filter, metric: 'unallocatedCredit' }, now);
  assert.equal(details.totalValue, report.total.unallocatedCredit);
  assert.ok(details.items.every((item) => item.value > 0 && item.receiptId));
});

test('active, archived, all and custom groups are explicit and unknown or out-of-scope IDs fail', () => {
  const { state, people } = fixture(); const archived = domain.createEmployee(state, 'Архівний', new Date(2026, 8, 1));
  domain.archiveEmployee(state, archived.id, new Date(2026, 8, 2));
  assert.equal(calculateAnalyticsReport(state, filter, now).rows.length, 2);
  assert.equal(calculateAnalyticsReport(state, { ...filter, scope: 'all' }, now).rows.length, 3);
  assert.equal(calculateAnalyticsReport(state, { ...filter, scope: 'archive' }, now).rows.length, 1);
  assert.equal(calculateAnalyticsReport(state, { ...filter, employeeIds: [people[0].id, people[0].id] }, now).rows.length, 1);
  for (const employeeIds of [[], ['missing'], [archived.id]]) assert.throws(() => calculateAnalyticsReport(state, { ...filter, employeeIds }, now));
  assert.throws(() => getAnalyticsDetails(state, { filter: { ...filter, employeeIds: [people[0].id] }, metric: 'missed', employeeId: people[1].id }, now));
});

test('individual working weekends and pre-employment historical records are included in norm and sources', () => {
  const { state, people } = fixture(); const a = people[0];
  domain.setWorkdayOverride(state, a.id, '2026-09-27', '', now);
  domain.setManualStatus(state, { employeeId: a.id, date: '2026-08-31', status: 'submitted' }, now);
  const report = calculateAnalyticsReport(state, { ...filter, startDate: '2026-08-30', employeeIds: [a.id] }, now);
  const legacy = domain.calculateStatistics(state, { startDate: '2026-08-30', endDate: filter.endDate, employeeId: a.id });
  for (const key of ['calendarWorkdays', 'workedDays', 'requestDays', 'requestRequiredDays', 'pending']) assert.equal(report.total[key], legacy.total[key], key);
  assert.ok(getAnalyticsDetails(state, { filter: { ...filter, startDate: '2026-09-27' }, metric: 'pending' }, now).items.some((item) => item.date === '2026-09-27' && item.override));
});

test('pagination clamps the page and keeps totals independent from the displayed slice', () => {
  const { state } = fixture(); const input = { filter, metric: 'calendarWorkdays', pageSize: 3 };
  const first = getAnalyticsDetails(state, { ...input, page: 0 }, now);
  const second = getAnalyticsDetails(state, { ...input, page: 1 }, now);
  const last = getAnalyticsDetails(state, { ...input, page: 1000 }, now);
  assert.equal(first.totalRows, 10); assert.equal(first.totalValue, 10); assert.equal(first.items.length, 3);
  assert.equal(last.page, 3); assert.equal(last.items.length, 1);
  assert.ok(first.items.every((a) => !second.items.some((b) => a.employeeId === b.employeeId && a.date === b.date)));
});

test('invalid dates and overlarge chart groups fail; automatic grouping supports long periods', () => {
  const { state } = fixture();
  for (const bad of [{ startDate: '2026-02-30' }, { startDate: '2026-10-04' }, { startDate: '2010-01-01' }, { groupBy: 'unknown' }, { scope: 'unknown' }]) {
    assert.throws(() => calculateAnalyticsReport(state, { ...filter, ...bad }, now));
  }
  assert.throws(() => calculateAnalyticsReport(state, { ...filter, startDate: '2025-01-01', groupBy: 'day' }, now), /Забагато точок/);
  assert.equal(calculateAnalyticsReport(state, { ...filter, startDate: '2025-01-01' }, now).groupBy, 'month');
  assert.throws(() => getAnalyticsDetails(state, { filter, metric: 'unknown' }, now));
});

test('all CSV views carry period context, Ukrainian headers and formula-safe names', () => {
  const { state, people } = fixture(); domain.renameEmployee(state, people[0].id, '=HYPERLINK("test"); Ім’я', now);
  const report = calculateAnalyticsReport(state, filter, now);
  for (const view of ['workers', 'trend', 'documents']) {
    const csv = buildAnalyticsCsv(report, view);
    assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('"2026-09-28";"2026-10-02"'));
    assert.ok(csv.includes('Результати враховано до')); assert.ok(csv.endsWith('\r\n'));
    assert.ok(!csv.includes('undefined')); assert.ok(!csv.includes('NaN'));
    if (view !== 'trend') assert.ok(csv.includes('"\'=HYPERLINK(""test""); Ім’я"'));
  }
  assert.ok(buildAnalyticsCsv(report, 'documents').includes('"Ні"'));
  assert.throws(() => buildAnalyticsCsv(report, 'unknown'));
});

test('reports, comparisons, details and exports do not mutate stored records', () => {
  const { state } = fixture(); const before = domain.clone(state);
  const report = calculateAnalyticsReport(state, filter, now);
  getAnalyticsDetails(state, { filter, metric: 'documentDays' }, now); buildAnalyticsCsv(report);
  assert.deepEqual(state, before);
});
